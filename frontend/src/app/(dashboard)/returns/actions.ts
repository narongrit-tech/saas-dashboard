'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  OrderSearchResult,
  ReturnSubmitPayload,
  ReturnType,
  OrderLineItem,
  QueueItem,
  RecentReturn,
  UndoReturnPayload,
  SkuMappingRow,
} from '@/types/returns'

/**
 * Internal helper: resolve sku_internal from inventory_sku_mappings
 * given a channel and marketplace_sku.
 */
const _resolveSkuInternal = async (
  supabase: any,
  userId: string,
  channel: string,
  marketplace_sku: string,
): Promise<{ sku_internal: string | null; error?: string }> => {
  if (!marketplace_sku) return { sku_internal: null, error: 'marketplace_sku is empty' }
  const { data, error } = await supabase
    .from('inventory_sku_mappings')
    .select('sku_internal')
    .eq('created_by', userId)
    .eq('channel', channel)
    .eq('marketplace_sku', marketplace_sku)
    .maybeSingle()
  if (error) return { sku_internal: null, error: error.message }
  if (!data) return { sku_internal: null, error: `ไม่พบ mapping สำหรับ ${channel} SKU: ${marketplace_sku}` }
  return { sku_internal: data.sku_internal }
}

/**
 * Internal helper: for a RETURN_RECEIVED inventory_returns record,
 * - Insert inventory_receipt_layers with ref_type='RETURN', ref_id=returnId
 * - Insert COGS reversal using Method B (weighted avg unit_cost from original allocations)
 * Idempotent: safe to call multiple times (guards via pre-checks + unique index).
 * Returns { success, warning? }
 */
const _processReturnReceived = async (
  supabase: any,
  userId: string,
  returnId: string,       // inventory_returns.id (UUID)
  orderIdUuid: string,    // sales_orders.id (UUID) = inventory_returns.order_id
  skuInternal: string,    // canonical sku_internal (not marketplace sku)
  qty: number,            // inventory_returns.qty
  returnedAt: string,     // inventory_returns.returned_at (ISO string)
): Promise<{ success: boolean; warning?: string; alreadyDone?: boolean }> => {
  // 1) Check idempotency: skip if receipt layer already exists
  const { data: existingLayer } = await supabase
    .from('inventory_receipt_layers')
    .select('id')
    .eq('ref_type', 'RETURN')
    .eq('ref_id', returnId)
    .or('is_voided.is.null,is_voided.eq.false')
    .maybeSingle()

  if (existingLayer) {
    return { success: true, alreadyDone: true }
  }

  // 2) Resolve sales_orders.order_id (VARCHAR string) from sales_orders.id (UUID)
  const { data: soRow, error: soError } = await supabase
    .from('sales_orders')
    .select('order_id')
    .eq('id', orderIdUuid)
    .single()

  if (soError || !soRow) {
    console.error(`[_processReturnReceived] Cannot resolve sales_orders for ${orderIdUuid}:`, soError)
    return { success: false, warning: `sales_order not found for UUID ${orderIdUuid}` }
  }

  const soOrderIdStr = soRow.order_id as string

  // 3) Get original COGS allocations for this order+skuInternal (Method B weighted avg)
  const { data: allocs, error: allocsError } = await supabase
    .from('inventory_cogs_allocations')
    .select('qty, unit_cost_used, amount, method')
    .eq('order_id', soOrderIdStr)
    .eq('sku_internal', skuInternal)
    .eq('is_reversal', false)

  let unitCost = 0
  let cogsMethod = 'FIFO'
  let warning: string | undefined

  if (allocsError || !allocs || allocs.length === 0) {
    warning = `No COGS allocations found for order ${soOrderIdStr} SKU ${skuInternal} — unit_cost set to 0`
    console.warn(`[_processReturnReceived] ${warning}`)
  } else {
    const totalQty  = allocs.reduce((s: number, a: any) => s + Number(a.qty), 0)
    const totalAmt  = allocs.reduce((s: number, a: any) => s + Number(a.amount), 0)
    unitCost   = totalQty > 0 ? totalAmt / totalQty : 0
    cogsMethod = allocs[0].method || 'FIFO'
    if (totalQty === 0) {
      warning = `COGS qty sum=0 for order ${soOrderIdStr} SKU ${skuInternal} — unit_cost set to 0`
      console.warn(`[_processReturnReceived] ${warning}`)
    }
  }

  // 4) Insert receipt layer (return stock inbound)
  const { data: newLayer, error: layerError } = await supabase
    .from('inventory_receipt_layers')
    .insert({
      sku_internal:  skuInternal,
      received_at:   returnedAt,
      qty_received:  qty,
      qty_remaining: qty,
      unit_cost:     unitCost,
      ref_type:      'RETURN',
      ref_id:        returnId,
      created_by:    userId,
      is_voided:     false,
    })
    .select('id')
    .single()

  if (layerError) {
    // 23505 = unique_violation (already exists — idempotent)
    if ((layerError as any)?.code === '23505') {
      return { success: true, alreadyDone: true }
    }
    console.error(`[_processReturnReceived] Receipt layer insert failed:`, layerError)
    return { success: false, warning: layerError.message }
  }

  const receiptLayerId = newLayer!.id

  // 5) Check idempotency: skip COGS reversal if already exists (linked via layer_id)
  const { data: existingCOGSReversal } = await supabase
    .from('inventory_cogs_allocations')
    .select('id')
    .eq('layer_id', receiptLayerId)
    .eq('is_reversal', true)
    .maybeSingle()

  if (!existingCOGSReversal) {
    const reversalAmount = -(qty * unitCost)
    const { error: cogsError } = await supabase
      .from('inventory_cogs_allocations')
      .insert({
        order_id:       soOrderIdStr,
        sku_internal:   skuInternal,
        shipped_at:     returnedAt,
        method:         cogsMethod,
        qty:            -qty,
        unit_cost_used: unitCost,
        amount:         reversalAmount,
        layer_id:       receiptLayerId,   // links reversal to this return's layer
        is_reversal:    true,
        created_by:     userId,
      })

    if (cogsError) {
      console.error(`[_processReturnReceived] COGS reversal insert failed:`, cogsError)
      // Non-fatal: receipt layer was created; log warning
      warning = (warning ? warning + ' | ' : '') + `COGS reversal failed: ${cogsError.message}`
    }
  }

  return { success: true, warning }
}

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

    // Get line items to validate (include source_platform for channel resolution)
    const lineItemIds = payload.items.map((i) => i.line_item_id)
    const { data: lineItems, error: fetchError } = await supabase
      .from('sales_orders')
      .select('id, sku, seller_sku, quantity, shipped_at, source_platform, created_by')
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

    // Resolve sku_internal for each item
    const skuResolutionMap = new Map<string, string>()  // line_item_id -> sku_internal
    const skuErrors: string[] = []

    for (const item of payload.items) {
      const lineItem = lineItems.find((l) => l.id === item.line_item_id)
      if (!lineItem) continue

      const channel = lineItem.source_platform === 'shopee' ? 'shopee' : 'tiktok'
      const marketplaceSku = item.sku  // the marketplace variant id

      // If seller_sku exists on the line item, it IS the sku_internal — use it directly
      if (lineItem.seller_sku) {
        skuResolutionMap.set(item.line_item_id, lineItem.seller_sku)
      } else {
        const { sku_internal, error: resolveError } = await _resolveSkuInternal(
          supabase, user.id, channel, marketplaceSku,
        )
        if (!sku_internal) {
          skuErrors.push(`SKU ${marketplaceSku}: ${resolveError}`)
        } else {
          skuResolutionMap.set(item.line_item_id, sku_internal)
        }
      }
    }

    if (skuErrors.length > 0) {
      return {
        success: false,
        error: `กรุณาตั้งค่า SKU mapping ก่อน:\n${skuErrors.join('\n')}`,
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
      marketplace_sku: item.sku,  // store marketplace sku
      sku_internal: skuResolutionMap.get(item.line_item_id) || null,
      qty: item.qty,
      return_type: item.return_type,
      note: payload.note || null,
      created_by: user.id,
      returned_at: new Date().toISOString(),
    }))

    // Insert return records (get back IDs for receipt layer creation)
    const { data: insertedReturns, error: insertError } = await supabase
      .from('inventory_returns')
      .insert(returnRecords)
      .select('id, order_id, sku, marketplace_sku, sku_internal, qty, return_type, returned_at')

    if (insertError) {
      console.error('[submitReturn] Insert error:', insertError)
      return { success: false, error: insertError.message }
    }

    // For RETURN_RECEIVED: create receipt layer + COGS reversal (Method B)
    if (insertedReturns && insertedReturns.length > 0) {
      for (const ret of insertedReturns) {
        if (ret.return_type !== 'RETURN_RECEIVED') continue
        const result = await _processReturnReceived(
          supabase,
          user.id,
          ret.id,
          ret.order_id,
          ret.sku_internal || ret.sku,  // fallback to old sku if sku_internal not set
          ret.qty,
          ret.returned_at || new Date().toISOString(),
        )
        if (!result.success) {
          console.error(`[submitReturn] Receipt layer/COGS failed for return ${ret.id}:`, result.warning)
          // Non-fatal: return record was created, backfill can fix this later
        } else if (result.warning) {
          console.warn(`[submitReturn] Warning for return ${ret.id}:`, result.warning)
        }
      }
    }

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

/**
 * Get returns queue: orders that likely need returns processing
 * Uses heuristics to identify orders that may need review
 */
export async function getReturnsQueue(filters?: {
  dateFrom?: string // ISO date
  dateTo?: string // ISO date
  statusGroups?: string[] // e.g., ['delivered', 'completed']
  includeCancelled?: boolean
}): Promise<{ data: QueueItem[] | null; error: string | null }> {
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

    // Default date range: last 30 days
    const dateTo = filters?.dateTo || new Date().toISOString().split('T')[0]
    const dateFrom =
      filters?.dateFrom ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    // Build query for orders
    let query = supabase
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
        payment_status,
        shipped_at,
        delivered_at,
        order_date,
        quantity,
        created_by
      `
      )
      .eq('created_by', user.id)
      .gte('order_date', dateFrom)
      .lte('order_date', dateTo)
      .not('shipped_at', 'is', null) // Must have shipped

    // Status group filter
    if (filters?.statusGroups && filters.statusGroups.length > 0) {
      query = query.in('status_group', filters.statusGroups)
    } else {
      // Default: delivered/completed orders
      query = query.in('status_group', ['delivered', 'completed'])
    }

    // Payment status filter: look for refund indicators
    // Note: This is heuristic - adjust based on actual data patterns
    if (!filters?.includeCancelled) {
      // Optionally filter by payment_status containing 'refund'
      // This is a soft filter, may need adjustment
    }

    query = query.order('shipped_at', { ascending: false }).limit(100)

    const { data: orderLines, error: fetchError } = await query

    if (fetchError) {
      console.error('[getReturnsQueue] Fetch error:', fetchError)
      return { data: null, error: fetchError.message }
    }

    if (!orderLines || orderLines.length === 0) {
      return { data: [], error: null }
    }

    // Get existing returns for these orders
    const orderLineIds = orderLines.map((o) => o.id)
    const { data: returns, error: returnsError } = await supabase
      .from('inventory_returns')
      .select('order_id, qty')
      .in('order_id', orderLineIds)
      .eq('action_type', 'RETURN')

    if (returnsError) {
      console.error('[getReturnsQueue] Returns error:', returnsError)
      // Continue without returns data
    }

    // Build map: order_line_id -> total_returned_qty
    const returnsMap = new Map<string, number>()
    if (returns) {
      for (const ret of returns) {
        returnsMap.set(ret.order_id, (returnsMap.get(ret.order_id) || 0) + ret.qty)
      }
    }

    // Group by external_order_id or order_id
    const queueMap = new Map<string, QueueItem>()

    for (const line of orderLines) {
      const orderKey = line.external_order_id || line.order_id
      const returnedQty = returnsMap.get(line.id) || 0
      const remainingQty = line.quantity - returnedQty

      if (!queueMap.has(orderKey)) {
        queueMap.set(orderKey, {
          id: line.id,
          order_id: line.order_id,
          external_order_id: line.external_order_id,
          tracking_number: line.tracking_number,
          source_platform: line.source_platform,
          marketplace: line.marketplace,
          status_group: line.status_group,
          platform_status: line.platform_status,
          payment_status: line.payment_status,
          shipped_at: line.shipped_at,
          delivered_at: line.delivered_at,
          order_date: line.order_date,
          sold_qty: line.quantity,
          returned_qty: returnedQty,
          remaining_qty: remainingQty,
          created_by: line.created_by,
        })
      } else {
        // Aggregate quantities
        const existing = queueMap.get(orderKey)!
        existing.sold_qty += line.quantity
        existing.returned_qty += returnedQty
        existing.remaining_qty += remainingQty
      }
    }

    // Filter: only show orders with remaining_qty > 0
    const results = Array.from(queueMap.values()).filter(
      (item) => item.remaining_qty > 0
    )

    return { data: results, error: null }
  } catch (error) {
    console.error('[getReturnsQueue] Unexpected error:', error)
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get recent returns: last 20 return records
 */
export async function getRecentReturns(): Promise<{
  data: RecentReturn[] | null
  error: string | null
}> {
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

    // Fetch recent returns
    const { data: returns, error: fetchError } = await supabase
      .from('inventory_returns')
      .select(
        `
        id,
        order_id,
        sku,
        qty,
        return_type,
        note,
        returned_at,
        action_type,
        reversed_return_id,
        created_by
      `
      )
      .eq('created_by', user.id)
      .order('returned_at', { ascending: false })
      .limit(20)

    if (fetchError) {
      console.error('[getRecentReturns] Fetch error:', fetchError)
      return { data: null, error: fetchError.message }
    }

    if (!returns || returns.length === 0) {
      return { data: [], error: null }
    }

    // Get order info for display (external_order_id, tracking_number)
    const orderIdsSet = new Set(returns.map((r) => r.order_id))
    const orderIds = Array.from(orderIdsSet)
    const { data: orders, error: ordersError } = await supabase
      .from('sales_orders')
      .select('id, external_order_id, tracking_number')
      .in('id', orderIds)

    if (ordersError) {
      console.error('[getRecentReturns] Orders error:', ordersError)
      // Continue without order info
    }

    // Build map: order_id -> order info
    const ordersMap = new Map<string, { external_order_id: string | null; tracking_number: string | null }>()
    if (orders) {
      for (const order of orders) {
        ordersMap.set(order.id, {
          external_order_id: order.external_order_id,
          tracking_number: order.tracking_number,
        })
      }
    }

    // Enrich returns with order info
    const results: RecentReturn[] = returns.map((ret) => {
      const orderInfo = ordersMap.get(ret.order_id)
      return {
        ...ret,
        action_type: (ret.action_type || 'RETURN') as 'RETURN' | 'UNDO',
        external_order_id: orderInfo?.external_order_id || null,
        tracking_number: orderInfo?.tracking_number || null,
      }
    })

    return { data: results, error: null }
  } catch (error) {
    console.error('[getRecentReturns] Unexpected error:', error)
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Undo a return: create reversal record
 * Reverses stock/COGS for RETURN_RECEIVED type
 */
export async function undoReturn(
  payload: UndoReturnPayload
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

    // Fetch original return
    const { data: originalReturn, error: fetchError } = await supabase
      .from('inventory_returns')
      .select('*')
      .eq('id', payload.return_id)
      .eq('created_by', user.id)
      .single()

    if (fetchError || !originalReturn) {
      console.error('[undoReturn] Fetch error:', fetchError)
      return { success: false, error: 'Return not found or not owned by user' }
    }

    // Validate: must be RETURN action (not already UNDO)
    if (originalReturn.action_type === 'UNDO') {
      return { success: false, error: 'Cannot undo an undo action' }
    }

    // Validate: not already undone
    const { data: existingUndo, error: undoCheckError } = await supabase
      .from('inventory_returns')
      .select('id')
      .eq('reversed_return_id', payload.return_id)
      .eq('action_type', 'UNDO')
      .maybeSingle()

    if (undoCheckError) {
      console.error('[undoReturn] Undo check error:', undoCheckError)
      return { success: false, error: undoCheckError.message }
    }

    if (existingUndo) {
      return { success: false, error: 'This return has already been undone' }
    }

    // Create undo record
    const undoRecord = {
      order_id: originalReturn.order_id,
      sku: originalReturn.sku,
      qty: originalReturn.qty,
      return_type: originalReturn.return_type,
      note: `UNDO: ${originalReturn.note || '(no note)'}`,
      created_by: user.id,
      returned_at: new Date().toISOString(),
      action_type: 'UNDO',
      reversed_return_id: originalReturn.id,
    }

    const { error: insertError } = await supabase
      .from('inventory_returns')
      .insert([undoRecord])

    if (insertError) {
      console.error('[undoReturn] Insert error:', insertError)
      return { success: false, error: insertError.message }
    }

    // TODO: For RETURN_RECEIVED type:
    // - Create inventory movement OUT (reverse the stock in)
    // - Create COGS allocation with is_reversal=true (to negate the previous reversal)
    // This requires integration with inventory costing engine
    // For MVP, we just track the undo record

    revalidatePath('/returns')

    return { success: true, error: null }
  } catch (error) {
    console.error('[undoReturn] Unexpected error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Backfill: create missing inventory_receipt_layers and COGS reversals
 * for existing RETURN_RECEIVED records that were created before this fix.
 * Admin-only. Idempotent (safe to run multiple times).
 */
export async function backfillMissingReturnStock(): Promise<{
  success: boolean
  error?: string
  data: {
    total: number
    processed: number
    skipped: number
    failed: number
    warnings: string[]
  } | null
}> {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Not authenticated', data: null }

    // Admin check
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (roleData?.role !== 'admin') {
      return { success: false, error: 'Admin only', data: null }
    }

    // Fetch all active RETURN_RECEIVED returns (include marketplace_sku, sku_internal)
    const { data: allReturns, error: fetchErr } = await supabase
      .from('inventory_returns')
      .select('id, order_id, sku, marketplace_sku, sku_internal, qty, return_type, returned_at')
      .eq('created_by', user.id)
      .eq('action_type', 'RETURN')
      .is('reversed_return_id', null)
      .eq('return_type', 'RETURN_RECEIVED')

    if (fetchErr || !allReturns) {
      return { success: false, error: fetchErr?.message || 'Fetch failed', data: null }
    }

    if (allReturns.length === 0) {
      return { success: true, data: { total: 0, processed: 0, skipped: 0, failed: 0, warnings: [] } }
    }

    // Fetch existing receipt layers for these returns
    const returnIds = allReturns.map((r: any) => r.id)
    const { data: existingLayers } = await supabase
      .from('inventory_receipt_layers')
      .select('ref_id')
      .eq('ref_type', 'RETURN')
      .in('ref_id', returnIds)
      .or('is_voided.is.null,is_voided.eq.false')

    const processedSet = new Set<string>((existingLayers || []).map((l: any) => l.ref_id))

    // Find returns that need processing (no receipt layer yet)
    const needsProcessing = allReturns.filter((r: any) => !processedSet.has(r.id))

    const summary = {
      total: allReturns.length,
      processed: 0,
      skipped: allReturns.length - needsProcessing.length,
      failed: 0,
      warnings: [] as string[],
    }

    // Pre-fetch source_platform for all order UUIDs (to resolve correct channel)
    const orderUuids = [...new Set(needsProcessing.map((r: any) => r.order_id))]
    const channelMap = new Map<string, string>() // order_id UUID -> channel string
    if (orderUuids.length > 0) {
      const { data: orderRows } = await supabase
        .from('sales_orders')
        .select('id, source_platform')
        .in('id', orderUuids)
      for (const row of orderRows || []) {
        const ch = row.source_platform === 'shopee' ? 'shopee'
          : row.source_platform === 'lazada' ? 'lazada'
          : 'tiktok'
        channelMap.set(row.id, ch)
      }
    }

    for (const ret of needsProcessing) {
      let skuInternal = ret.sku_internal

      if (!skuInternal) {
        const marketplaceSku = ret.marketplace_sku || ret.sku
        const channel = channelMap.get(ret.order_id) || 'tiktok'
        const { sku_internal: resolved, error: resolveErr } = await _resolveSkuInternal(
          supabase, user.id, channel, marketplaceSku,
        )
        if (!resolved) {
          summary.failed++
          summary.warnings.push(`[${ret.id}] ต้องการ SKU mapping [${channel}] สำหรับ ${marketplaceSku}: ${resolveErr}`)
          continue
        }
        skuInternal = resolved
        // Update the return record with resolved sku_internal
        await supabase.from('inventory_returns')
          .update({ sku_internal: skuInternal, marketplace_sku: marketplaceSku })
          .eq('id', ret.id)
          .eq('created_by', user.id)
      }

      const result = await _processReturnReceived(
        supabase,
        user.id,
        ret.id,
        ret.order_id,
        skuInternal,
        ret.qty,
        ret.returned_at || new Date().toISOString(),
      )
      if (result.alreadyDone) {
        summary.skipped++
      } else if (result.success) {
        summary.processed++
        if (result.warning) summary.warnings.push(`[${ret.id}] ${result.warning}`)
      } else {
        summary.failed++
        if (result.warning) summary.warnings.push(`[${ret.id}] FAILED: ${result.warning}`)
      }
    }

    console.log('[backfillMissingReturnStock] Summary:', summary)
    return { success: true, data: summary }
  } catch (error) {
    console.error('[backfillMissingReturnStock] Unexpected error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null }
  }
}

// ---------------------------------------------------------------------------
// SKU Mappings CRUD
// ---------------------------------------------------------------------------

/**
 * List all SKU mappings owned by the current user
 */
export async function getSkuMappings(): Promise<{
  data: SkuMappingRow[] | null
  error: string | null
}> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { data: null, error: 'Not authenticated' }

    const { data, error } = await supabase
      .from('inventory_sku_mappings')
      .select('id, channel, marketplace_sku, sku_internal, created_at, updated_at')
      .eq('created_by', user.id)
      .order('channel')
      .order('marketplace_sku')

    if (error) {
      console.error('[getSkuMappings] error:', error)
      return { data: null, error: error.message }
    }

    return { data: data as SkuMappingRow[], error: null }
  } catch (err) {
    console.error('[getSkuMappings] unexpected:', err)
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Upsert a SKU mapping (insert or update on conflict channel+marketplace_sku)
 */
export async function upsertSkuMapping(payload: {
  id?: string
  channel: string
  marketplace_sku: string
  sku_internal: string
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Not authenticated' }

    if (!payload.channel || !payload.marketplace_sku || !payload.sku_internal) {
      return { success: false, error: 'channel, marketplace_sku และ sku_internal จำเป็นต้องระบุ' }
    }

    const record = {
      channel: payload.channel.trim(),
      marketplace_sku: payload.marketplace_sku.trim(),
      sku_internal: payload.sku_internal.trim(),
      created_by: user.id,
      updated_at: new Date().toISOString(),
    }

    let queryError: any

    if (payload.id) {
      // Update existing row (owner-check via created_by = user.id in RLS)
      const { error } = await supabase
        .from('inventory_sku_mappings')
        .update({ channel: record.channel, marketplace_sku: record.marketplace_sku, sku_internal: record.sku_internal, updated_at: record.updated_at })
        .eq('id', payload.id)
        .eq('created_by', user.id)
      queryError = error
    } else {
      // Insert with upsert on (created_by, channel, marketplace_sku)
      const { error } = await supabase
        .from('inventory_sku_mappings')
        .upsert(record, { onConflict: 'created_by,channel,marketplace_sku' })
      queryError = error
    }

    if (queryError) {
      console.error('[upsertSkuMapping] error:', queryError)
      return { success: false, error: queryError.message }
    }

    revalidatePath('/sku-mappings')
    return { success: true, error: null }
  } catch (err) {
    console.error('[upsertSkuMapping] unexpected:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Delete a SKU mapping by id (owner must match via RLS)
 */
export async function deleteSkuMapping(
  id: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Not authenticated' }

    const { error } = await supabase
      .from('inventory_sku_mappings')
      .delete()
      .eq('id', id)
      .eq('created_by', user.id)

    if (error) {
      console.error('[deleteSkuMapping] error:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/sku-mappings')
    return { success: true, error: null }
  } catch (err) {
    console.error('[deleteSkuMapping] unexpected:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Get inventory items for SKU mapping dropdown
 * Returns sku_internal + product_name from inventory_items
 */
export async function getInventoryItemsForMapping(): Promise<{
  data: { sku_internal: string; product_name: string }[] | null
  error: string | null
}> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { data: null, error: 'Not authenticated' }

    const { data, error } = await supabase
      .from('inventory_items')
      .select('sku_internal, product_name')
      .eq('created_by', user.id)
      .order('sku_internal')

    if (error) {
      console.error('[getInventoryItemsForMapping] error:', error)
      return { data: null, error: error.message }
    }

    return {
      data: (data || []).map((r: any) => ({
        sku_internal: r.sku_internal as string,
        product_name: (r.product_name as string) || '',
      })),
      error: null,
    }
  } catch (err) {
    console.error('[getInventoryItemsForMapping] unexpected:', err)
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
