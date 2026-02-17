'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  OrderSearchResult,
  ReturnSubmitPayload,
  ReturnType,
  OrderLineItem,
} from '@/types/returns'

/**
 * Search orders for return processing
 * Searches by external_order_id or tracking_number
 * Returns orders with line items and qty_returned
 */
export async function searchOrdersForReturn(
  query: string
): Promise<{ data: OrderSearchResult[] | null; error: string | null }> {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return { data: null, error: 'Not authenticated' }
    }

    // Normalize query (trim, lowercase)
    const normalized = query.trim()
    if (!normalized) {
      return { data: [], error: null }
    }

    // Search strategy:
    // 1. Exact match by external_order_id (case-insensitive)
    // 2. Exact match by tracking_number (case-insensitive)
    // 3. Fallback: ILIKE search on both fields

    // Build query - search across external_order_id and tracking_number
    const { data: orderLines, error: searchError } = await supabase
      .from('sales_orders')
      .select(
        `
        id,
        order_id,
        external_order_id,
        tracking_number,
        source_platform,
        marketplace,
        status_group,
        platform_status,
        shipped_at,
        delivered_at,
        order_date,
        sku,
        seller_sku,
        product_name,
        quantity,
        unit_price,
        total_amount,
        created_by
      `
      )
      .eq('created_by', user.id)
      .or(
        `external_order_id.ilike.%${normalized}%,tracking_number.ilike.%${normalized}%`
      )
      .order('order_date', { ascending: false })
      .limit(50) // Limit to avoid performance issues

    if (searchError) {
      console.error('[searchOrdersForReturn] Search error:', searchError)
      return { data: null, error: searchError.message }
    }

    if (!orderLines || orderLines.length === 0) {
      return { data: [], error: null }
    }

    // Group by order_id (or external_order_id if available)
    const ordersMap = new Map<string, OrderSearchResult>()

    for (const line of orderLines) {
      const orderKey = line.external_order_id || line.order_id

      if (!ordersMap.has(orderKey)) {
        // Create new order entry
        ordersMap.set(orderKey, {
          id: line.id, // Representative line item id
          order_id: line.order_id,
          external_order_id: line.external_order_id,
          tracking_number: line.tracking_number,
          source_platform: line.source_platform,
          marketplace: line.marketplace,
          status_group: line.status_group,
          platform_status: line.platform_status,
          shipped_at: line.shipped_at,
          delivered_at: line.delivered_at,
          order_date: line.order_date,
          line_items: [],
          created_by: line.created_by,
        })
      }

      // Add line item
      const order = ordersMap.get(orderKey)!
      order.line_items.push({
        id: line.id,
        sku: line.sku || '',
        seller_sku: line.seller_sku,
        product_name: line.product_name,
        quantity: line.quantity,
        qty_returned: 0, // Will populate next
        unit_price: line.unit_price,
        total_amount: line.total_amount,
      })
    }

    // Get qty_returned for each line item
    const lineItemIds = orderLines.map((l) => l.id)

    const { data: returns, error: returnsError } = await supabase
      .from('inventory_returns')
      .select('order_id, sku, qty')
      .in('order_id', lineItemIds)

    if (returnsError) {
      console.error('[searchOrdersForReturn] Returns error:', returnsError)
      // Continue without returns data (qty_returned = 0)
    }

    // Aggregate qty_returned by order_id + sku
    const returnsMap = new Map<string, number>()
    if (returns) {
      for (const ret of returns) {
        const key = `${ret.order_id}|${ret.sku}`
        returnsMap.set(key, (returnsMap.get(key) || 0) + ret.qty)
      }
    }

    // Populate qty_returned
    const results = Array.from(ordersMap.values())
    for (const order of results) {
      for (const item of order.line_items) {
        const key = `${item.id}|${item.sku}`
        item.qty_returned = returnsMap.get(key) || 0
      }
    }

    return { data: results, error: null }
  } catch (error) {
    console.error('[searchOrdersForReturn] Unexpected error:', error)
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Submit return transaction
 * Creates return records and reverses COGS/inventory as needed
 */
export async function submitReturn(
  payload: ReturnSubmitPayload
): Promise<{ success: boolean; error: string | null }> {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Validate payload
    if (!payload.items || payload.items.length === 0) {
      return { success: false, error: 'No items to return' }
    }

    // Get line items to validate
    const lineItemIds = payload.items.map((i) => i.line_item_id)
    const { data: lineItems, error: fetchError } = await supabase
      .from('sales_orders')
      .select('id, sku, seller_sku, quantity, shipped_at, created_by')
      .in('id', lineItemIds)

    if (fetchError) {
      console.error('[submitReturn] Fetch error:', fetchError)
      return { success: false, error: fetchError.message }
    }

    if (!lineItems || lineItems.length === 0) {
      return { success: false, error: 'Line items not found' }
    }

    // Check ownership
    const notOwned = lineItems.filter((l) => l.created_by !== user.id)
    if (notOwned.length > 0) {
      return { success: false, error: 'Cannot return orders you do not own' }
    }

    // Get existing returns for validation
    const { data: existingReturns, error: returnsError } = await supabase
      .from('inventory_returns')
      .select('order_id, sku, qty')
      .in('order_id', lineItemIds)

    if (returnsError) {
      console.error('[submitReturn] Returns fetch error:', returnsError)
      // Continue without existing returns (assume 0)
    }

    // Build map: line_item_id|sku -> qty_returned
    const returnsMap = new Map<string, number>()
    if (existingReturns) {
      for (const ret of existingReturns) {
        const key = `${ret.order_id}|${ret.sku}`
        returnsMap.set(key, (returnsMap.get(key) || 0) + ret.qty)
      }
    }

    // Validate each item
    for (const item of payload.items) {
      const lineItem = lineItems.find((l) => l.id === item.line_item_id)
      if (!lineItem) {
        return {
          success: false,
          error: `Line item ${item.line_item_id} not found`,
        }
      }

      // Check qty
      if (item.qty <= 0) {
        return {
          success: false,
          error: `Return quantity must be positive for SKU ${item.sku}`,
        }
      }

      const key = `${item.line_item_id}|${item.sku}`
      const qtyAlreadyReturned = returnsMap.get(key) || 0
      const qtyAvailable = lineItem.quantity - qtyAlreadyReturned

      if (item.qty > qtyAvailable) {
        return {
          success: false,
          error: `Cannot return ${item.qty} units of SKU ${item.sku}. Only ${qtyAvailable} available (sold: ${lineItem.quantity}, already returned: ${qtyAlreadyReturned})`,
        }
      }

      // Validate return type
      if (item.return_type === 'CANCEL_BEFORE_SHIP' && lineItem.shipped_at) {
        return {
          success: false,
          error: `Cannot use CANCEL_BEFORE_SHIP for SKU ${item.sku}. Order already shipped.`,
        }
      }
    }

    // All validations passed - proceed with transaction
    // Note: Supabase doesn't support transactions via client library
    // We'll do best-effort sequential operations

    const returnRecords = payload.items.map((item) => ({
      order_id: item.line_item_id, // sales_orders.id (UUID)
      sku: item.sku,
      qty: item.qty,
      return_type: item.return_type,
      note: payload.note || null,
      created_by: user.id,
      returned_at: new Date().toISOString(),
    }))

    // Insert return records
    const { error: insertError } = await supabase
      .from('inventory_returns')
      .insert(returnRecords)

    if (insertError) {
      console.error('[submitReturn] Insert error:', insertError)
      return { success: false, error: insertError.message }
    }

    // TODO: For RETURN_RECEIVED type:
    // - Create inventory movement (RETURN_IN)
    // - Create COGS reversal in inventory_cogs_allocations
    // This requires integration with inventory costing engine
    // For MVP, we just track the return record

    revalidatePath('/returns')

    return { success: true, error: null }
  } catch (error) {
    console.error('[submitReturn] Unexpected error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
