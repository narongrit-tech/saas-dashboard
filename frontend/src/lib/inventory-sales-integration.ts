/**
 * Inventory + Sales Integration
 *
 * Helper functions to apply COGS for shipped sales orders.
 * Reads from sales_orders table and calls inventory costing engine.
 *
 * FINAL RULES (LOCKED):
 * 1. sku_internal = sales_orders.seller_sku
 * 2. quantity = sales_orders.quantity (NO fallback)
 * 3. Apply COGS only when shipped_at IS NOT NULL
 * 4. Skip status_group = 'ยกเลิกแล้ว'
 * 5. Validate quantity > 0
 */

import { createClient } from '@/lib/supabase/server'
import { applyCOGSForOrderShipped, type CostingMethod } from '@/lib/inventory-costing'

/**
 * Result summary for COGS application
 */
export interface COGSApplicationResult {
  total_orders: number
  successful: number
  skipped: number
  failed: number
  errors: Array<{ order_id: string; reason: string }>
}

/**
 * Apply COGS for shipped orders (batch processing)
 *
 * Queries sales_orders for shipped orders and applies COGS allocation.
 *
 * @param order_ids - Optional array of specific order IDs to process
 * @param method - Costing method (FIFO or AVG)
 * @returns Summary result
 */
export async function applyCOGSForShippedOrders(
  order_ids?: string[],
  method: CostingMethod = 'FIFO'
): Promise<COGSApplicationResult> {
  const result: COGSApplicationResult = {
    total_orders: 0,
    successful: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }

  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Authentication failed in applyCOGSForShippedOrders')
      return result
    }

    // Build query for shipped orders
    let query = supabase
      .from('sales_orders')
      .select('order_id, seller_sku, quantity, shipped_at, status_group')
      .not('shipped_at', 'is', null) // Only shipped orders
      .neq('status_group', 'ยกเลิกแล้ว') // Skip cancelled

    // Filter by specific order IDs if provided
    if (order_ids && order_ids.length > 0) {
      query = query.in('order_id', order_ids)
    }

    const { data: orders, error: ordersError } = await query

    if (ordersError) {
      console.error('Error fetching orders:', ordersError)
      return result
    }

    if (!orders || orders.length === 0) {
      console.log('No shipped orders to process')
      return result
    }

    result.total_orders = orders.length
    console.log(`Processing ${orders.length} shipped orders...`)

    // Process each order
    for (const order of orders) {
      const order_id = order.order_id
      const sku = order.seller_sku
      const qty = order.quantity
      const shipped_at = order.shipped_at

      // Validate: seller_sku must exist
      if (!sku || sku.trim() === '') {
        console.warn(`Order ${order_id}: Missing seller_sku. Skipping.`)
        result.skipped++
        result.errors.push({
          order_id,
          reason: 'Missing seller_sku',
        })
        continue
      }

      // Validate: quantity must be valid
      if (qty == null || !Number.isFinite(qty) || qty <= 0) {
        console.warn(`Order ${order_id}: Invalid quantity (${qty}). Skipping.`)
        result.skipped++
        result.errors.push({
          order_id,
          reason: `Invalid quantity: ${qty}`,
        })
        continue
      }

      // Validate: shipped_at must exist (should always be true due to query filter)
      if (!shipped_at) {
        console.warn(`Order ${order_id}: Missing shipped_at. Skipping.`)
        result.skipped++
        result.errors.push({
          order_id,
          reason: 'Missing shipped_at',
        })
        continue
      }

      // Apply COGS
      try {
        const success = await applyCOGSForOrderShipped(
          order_id,
          sku,
          qty,
          shipped_at,
          method
        )

        if (success) {
          result.successful++
          console.log(`✓ Order ${order_id}: COGS applied (SKU: ${sku}, Qty: ${qty})`)
        } else {
          result.failed++
          result.errors.push({
            order_id,
            reason: 'applyCOGSForOrderShipped returned false',
          })
          console.error(`✗ Order ${order_id}: Failed to apply COGS`)
        }
      } catch (error) {
        result.failed++
        result.errors.push({
          order_id,
          reason: error instanceof Error ? error.message : 'Unknown error',
        })
        console.error(`✗ Order ${order_id}: Exception:`, error)
      }
    }

    console.log('COGS Application Summary:', {
      total: result.total_orders,
      successful: result.successful,
      skipped: result.skipped,
      failed: result.failed,
    })

    return result
  } catch (error) {
    console.error('Unexpected error in applyCOGSForShippedOrders:', error)
    return result
  }
}

/**
 * Apply COGS for a single order (by order_id)
 *
 * @param order_id - Sales order ID
 * @param method - Costing method (FIFO or AVG)
 * @returns True if successful
 */
export async function applyCOGSForSingleOrder(
  order_id: string,
  method: CostingMethod = 'FIFO'
): Promise<boolean> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Authentication failed in applyCOGSForSingleOrder')
      return false
    }

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('sales_orders')
      .select('order_id, seller_sku, quantity, shipped_at, status_group')
      .eq('order_id', order_id)
      .single()

    if (orderError || !order) {
      console.error(`Order ${order_id} not found`)
      return false
    }

    // Validate: must be shipped
    if (!order.shipped_at) {
      console.error(`Order ${order_id}: Not shipped yet (shipped_at is null)`)
      return false
    }

    // Validate: not cancelled
    if (order.status_group === 'ยกเลิกแล้ว') {
      console.error(`Order ${order_id}: Order is cancelled (status_group = ยกเลิกแล้ว)`)
      return false
    }

    // Validate: seller_sku must exist
    if (!order.seller_sku || order.seller_sku.trim() === '') {
      console.error(`Order ${order_id}: Missing seller_sku`)
      return false
    }

    // Validate: quantity must be valid
    if (
      order.quantity == null ||
      !Number.isFinite(order.quantity) ||
      order.quantity <= 0
    ) {
      console.error(`Order ${order_id}: Invalid quantity (${order.quantity})`)
      return false
    }

    // Apply COGS
    const success = await applyCOGSForOrderShipped(
      order.order_id,
      order.seller_sku,
      order.quantity,
      order.shipped_at,
      method
    )

    if (success) {
      console.log(
        `✓ Order ${order_id}: COGS applied (SKU: ${order.seller_sku}, Qty: ${order.quantity})`
      )
    } else {
      console.error(`✗ Order ${order_id}: Failed to apply COGS`)
    }

    return success
  } catch (error) {
    console.error(`Unexpected error in applyCOGSForSingleOrder:`, error)
    return false
  }
}
