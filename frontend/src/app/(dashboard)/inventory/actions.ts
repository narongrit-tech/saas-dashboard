'use server'

/**
 * Inventory Module - Server Actions
 *
 * Server-side actions for inventory management UI
 * - Product management (SKU master)
 * - Opening balance
 * - Bundle recipes
 * - View movements and allocations
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getTodayBangkokString, getFirstDayOfMonthBangkokString } from '@/lib/bangkok-date-range'
import {
  recordOpeningBalance as recordOpeningBalanceCore,
  upsertBundleRecipe as upsertBundleRecipeCore,
  getBundleComponents as getBundleComponentsCore,
  applyCOGSForOrderShipped as applyCOGSForOrderShippedCore,
  applyReturnReverseCOGS as applyReturnReverseCOGSCore,
  type BundleComponent,
  type CostingMethod,
} from '@/lib/inventory-costing'

// ============================================
// Product Management
// ============================================

/**
 * Create or update inventory item (SKU)
 */
export async function upsertInventoryItem(data: {
  sku_internal: string
  product_name: string
  base_cost_per_unit: number
  is_bundle: boolean
}) {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Upsert item
    const { error } = await supabase.from('inventory_items').upsert(
      {
        sku_internal: data.sku_internal,
        product_name: data.product_name,
        base_cost_per_unit: data.base_cost_per_unit,
        is_bundle: data.is_bundle,
        created_by: user.id,
      },
      {
        onConflict: 'sku_internal',
      }
    )

    if (error) {
      console.error('Error upserting inventory item:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/inventory')
    return { success: true }
  } catch (error) {
    console.error('Unexpected error in upsertInventoryItem:', error)
    return { success: false, error: 'Unexpected error' }
  }
}

/**
 * Get all inventory items
 */
export async function getInventoryItems() {
  try {
    const supabase = createClient()

    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .order('sku_internal', { ascending: true })

    if (error) {
      console.error('Error fetching inventory items:', error)
      return { success: false, error: error.message, data: [] }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error('Unexpected error in getInventoryItems:', error)
    return { success: false, error: 'Unexpected error', data: [] }
  }
}

/**
 * Delete inventory item
 */
export async function deleteInventoryItem(sku_internal: string) {
  try {
    const supabase = createClient()

    const { error } = await supabase
      .from('inventory_items')
      .delete()
      .eq('sku_internal', sku_internal)

    if (error) {
      console.error('Error deleting inventory item:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/inventory')
    return { success: true }
  } catch (error) {
    console.error('Unexpected error in deleteInventoryItem:', error)
    return { success: false, error: 'Unexpected error' }
  }
}

// ============================================
// Opening Balance
// ============================================

/**
 * Record opening balance for a SKU
 */
export async function recordOpeningBalance(data: {
  sku_internal: string
  qty: number
  unit_cost: number
  date: string // YYYY-MM-DD
}) {
  try {
    const layer_id = await recordOpeningBalanceCore(
      data.sku_internal,
      data.qty,
      data.unit_cost,
      data.date
    )

    if (!layer_id) {
      return { success: false, error: 'Failed to record opening balance' }
    }

    revalidatePath('/inventory')
    return { success: true, layer_id }
  } catch (error) {
    console.error('Unexpected error in recordOpeningBalance:', error)
    return { success: false, error: 'Unexpected error' }
  }
}

/**
 * Get receipt layers (for audit view)
 * @param sku_internal - Optional SKU filter
 * @param include_voided - Include voided layers (default: false)
 */
export async function getReceiptLayers(sku_internal?: string, include_voided = false) {
  try {
    const supabase = createClient()

    let query = supabase
      .from('inventory_receipt_layers')
      .select('*')
      .order('received_at', { ascending: false })

    if (sku_internal) {
      query = query.eq('sku_internal', sku_internal)
    }

    // Filter out voided layers unless explicitly requested
    if (!include_voided) {
      query = query.eq('is_voided', false)
    }

    const { data, error } = await query.limit(100)

    if (error) {
      console.error('Error fetching receipt layers:', error)
      return { success: false, error: error.message, data: [] }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error('Unexpected error in getReceiptLayers:', error)
    return { success: false, error: 'Unexpected error', data: [] }
  }
}

/**
 * Update opening balance layer (only if not yet consumed)
 */
export async function updateOpeningBalanceLayer(
  layer_id: string,
  data: {
    received_at: string // ISO timestamp
    qty_received: number
    unit_cost: number
  }
) {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Get the layer and validate
    const { data: layer, error: fetchError } = await supabase
      .from('inventory_receipt_layers')
      .select('*')
      .eq('id', layer_id)
      .single()

    if (fetchError || !layer) {
      return { success: false, error: 'Layer not found' }
    }

    // Validation 1: Must be OPENING_BALANCE
    if (layer.ref_type !== 'OPENING_BALANCE') {
      return { success: false, error: 'Can only edit opening balance layers' }
    }

    // Validation 2: Must not be voided
    if (layer.is_voided) {
      return { success: false, error: 'Cannot edit voided layer' }
    }

    // Validation 3: Must not be consumed (qty_remaining == qty_received)
    if (layer.qty_remaining !== layer.qty_received) {
      return {
        success: false,
        error: 'Cannot edit layer that has been partially consumed',
      }
    }

    // Validation 4: Must not have any allocations referencing this layer
    const { data: allocations, error: allocError } = await supabase
      .from('inventory_cogs_allocations')
      .select('id')
      .eq('layer_id', layer_id)
      .limit(1)

    if (allocError) {
      return { success: false, error: 'Error checking allocations' }
    }

    if (allocations && allocations.length > 0) {
      return {
        success: false,
        error: 'Cannot edit layer that has COGS allocations',
      }
    }

    // Update the layer
    const { error: updateError } = await supabase
      .from('inventory_receipt_layers')
      .update({
        received_at: data.received_at,
        qty_received: data.qty_received,
        qty_remaining: data.qty_received, // Keep them equal
        unit_cost: data.unit_cost,
      })
      .eq('id', layer_id)

    if (updateError) {
      console.error('Error updating layer:', updateError)
      return { success: false, error: updateError.message }
    }

    revalidatePath('/inventory')
    return { success: true }
  } catch (error) {
    console.error('Unexpected error in updateOpeningBalanceLayer:', error)
    return { success: false, error: 'Unexpected error' }
  }
}

/**
 * Void (soft delete) opening balance layer (only if not yet consumed)
 */
export async function voidOpeningBalanceLayer(layer_id: string) {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Get the layer and validate
    const { data: layer, error: fetchError } = await supabase
      .from('inventory_receipt_layers')
      .select('*')
      .eq('id', layer_id)
      .single()

    if (fetchError || !layer) {
      return { success: false, error: 'Layer not found' }
    }

    // Validation 1: Must be OPENING_BALANCE
    if (layer.ref_type !== 'OPENING_BALANCE') {
      return { success: false, error: 'Can only void opening balance layers' }
    }

    // Validation 2: Must not be already voided
    if (layer.is_voided) {
      return { success: false, error: 'Layer is already voided' }
    }

    // Validation 3: Must not be consumed (qty_remaining == qty_received)
    if (layer.qty_remaining !== layer.qty_received) {
      return {
        success: false,
        error: 'Cannot void layer that has been partially consumed',
      }
    }

    // Validation 4: Must not have any allocations referencing this layer
    const { data: allocations, error: allocError } = await supabase
      .from('inventory_cogs_allocations')
      .select('id')
      .eq('layer_id', layer_id)
      .limit(1)

    if (allocError) {
      return { success: false, error: 'Error checking allocations' }
    }

    if (allocations && allocations.length > 0) {
      return {
        success: false,
        error: 'Cannot void layer that has COGS allocations',
      }
    }

    // Void the layer
    const { error: voidError } = await supabase
      .from('inventory_receipt_layers')
      .update({
        is_voided: true,
        voided_at: new Date().toISOString(),
        voided_by: user.id,
      })
      .eq('id', layer_id)

    if (voidError) {
      console.error('Error voiding layer:', voidError)
      return { success: false, error: voidError.message }
    }

    revalidatePath('/inventory')
    return { success: true }
  } catch (error) {
    console.error('Unexpected error in voidOpeningBalanceLayer:', error)
    return { success: false, error: 'Unexpected error' }
  }
}

// ============================================
// Bundle Management
// ============================================

/**
 * Upsert bundle recipe
 */
export async function upsertBundleRecipe(data: {
  bundle_sku: string
  components: BundleComponent[]
}) {
  try {
    const success = await upsertBundleRecipeCore(data.bundle_sku, data.components)

    if (!success) {
      return { success: false, error: 'Failed to upsert bundle recipe' }
    }

    revalidatePath('/inventory')
    return { success: true }
  } catch (error) {
    console.error('Unexpected error in upsertBundleRecipe:', error)
    return { success: false, error: 'Unexpected error' }
  }
}

/**
 * Get bundle components
 */
export async function getBundleComponents(bundle_sku: string) {
  try {
    const components = await getBundleComponentsCore(bundle_sku)
    return { success: true, data: components }
  } catch (error) {
    console.error('Unexpected error in getBundleComponents:', error)
    return { success: false, error: 'Unexpected error', data: [] }
  }
}

/**
 * Get all bundles
 */
export async function getBundles() {
  try {
    const supabase = createClient()

    const { data, error } = await supabase
      .from('inventory_items')
      .select('sku_internal, product_name, base_cost_per_unit')
      .eq('is_bundle', true)
      .order('sku_internal', { ascending: true })

    if (error) {
      console.error('Error fetching bundles:', error)
      return { success: false, error: error.message, data: [] }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error('Unexpected error in getBundles:', error)
    return { success: false, error: 'Unexpected error', data: [] }
  }
}

// ============================================
// COGS Allocations (View Only)
// ============================================

/**
 * Get COGS allocations (for audit view)
 */
export async function getCOGSAllocations(order_id?: string) {
  try {
    const supabase = createClient()

    let query = supabase
      .from('inventory_cogs_allocations')
      .select('*')
      .order('shipped_at', { ascending: false })

    if (order_id) {
      query = query.eq('order_id', order_id)
    }

    const { data, error } = await query.limit(100)

    if (error) {
      console.error('Error fetching COGS allocations:', error)
      return { success: false, error: error.message, data: [] }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error('Unexpected error in getCOGSAllocations:', error)
    return { success: false, error: 'Unexpected error', data: [] }
  }
}

// ============================================
// Manual COGS Actions (for testing/admin)
// ============================================

/**
 * Manually apply COGS for an order (admin/testing only)
 */
export async function applyCOGSForOrder(data: {
  order_id: string
  sku_internal: string
  qty: number
  shipped_at: string // ISO timestamp
  method: CostingMethod
}) {
  try {
    const success = await applyCOGSForOrderShippedCore(
      data.order_id,
      data.sku_internal,
      data.qty,
      data.shipped_at,
      data.method
    )

    if (!success) {
      return { success: false, error: 'Failed to apply COGS' }
    }

    revalidatePath('/inventory')
    revalidatePath('/daily-pl')
    return { success: true }
  } catch (error) {
    console.error('Unexpected error in applyCOGSForOrder:', error)
    return { success: false, error: 'Unexpected error' }
  }
}

/**
 * Manually apply return reversal (admin/testing only)
 */
export async function applyReturnReversal(data: {
  order_id: string
  sku_internal: string
  return_qty: number
  return_date: string // YYYY-MM-DD
  method: CostingMethod
}) {
  try {
    const success = await applyReturnReverseCOGSCore(
      data.order_id,
      data.sku_internal,
      data.return_qty,
      data.return_date,
      data.method
    )

    if (!success) {
      return { success: false, error: 'Failed to apply return reversal' }
    }

    revalidatePath('/inventory')
    revalidatePath('/daily-pl')
    return { success: true }
  } catch (error) {
    console.error('Unexpected error in applyReturnReversal:', error)
    return { success: false, error: 'Unexpected error' }
  }
}

// ============================================
// Admin Actions
// ============================================

/**
 * Apply COGS for all eligible orders in date range (Bangkok time)
 * Admin-only function with pagination support for large ranges
 */
export async function applyCOGSMTD(params: {
  method?: CostingMethod
  startDate?: string
  endDate?: string
} = {}) {
  const method = params.method || 'FIFO'
  try {
    const supabase = createClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return {
        success: false,
        error: 'ไม่พบข้อมูลผู้ใช้',
        data: null,
      }
    }

    // Check admin role
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (roleError || roleData?.role !== 'admin') {
      return {
        success: false,
        error: 'ไม่มีสิทธิ์เข้าถึงฟังก์ชันนี้ (Admin only)',
        data: null,
      }
    }

    // Get date range (Bangkok timezone)
    let startDateISO: string
    let endDateISO: string

    if (params.startDate && params.endDate) {
      // Use provided dates
      startDateISO = params.startDate
      endDateISO = params.endDate

      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/
      if (!dateRegex.test(startDateISO) || !dateRegex.test(endDateISO)) {
        return {
          success: false,
          error: 'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)',
          data: null,
        }
      }

      // Validate start <= end
      if (startDateISO > endDateISO) {
        return {
          success: false,
          error: 'วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด',
          data: null,
        }
      }
    } else {
      // Default to current month (MTD)
      const now = new Date()
      const bangkokTime = new Date(
        now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })
      )
      // SAFE: Use Bangkok timezone for date strings
      startDateISO = getFirstDayOfMonthBangkokString()
      endDateISO = getTodayBangkokString()
    }

    console.log(`Apply COGS Range: ${startDateISO} to ${endDateISO}`)

    // Fetch all orders in date range using pagination
    // CRITICAL: Use pagination to avoid query limits truncating results
    const PAGE_SIZE = 1000
    let allOrders: any[] = []
    let currentPage = 0
    let hasMore = true

    while (hasMore) {
      const from = currentPage * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      console.log(`Fetching orders page ${currentPage + 1} (${from}-${to})`)

      const { data: pageOrders, error: ordersError } = await supabase
        .from('sales_orders')
        .select('order_id, seller_sku, quantity, shipped_at, status_group')
        .not('shipped_at', 'is', null)
        .neq('status_group', 'ยกเลิกแล้ว')
        .gte('shipped_at', `${startDateISO}T00:00:00+07:00`)
        .lte('shipped_at', `${endDateISO}T23:59:59+07:00`)
        .order('shipped_at', { ascending: true })
        .order('order_id', { ascending: true })
        .range(from, to)

      if (ordersError) {
        console.error('Error fetching orders:', ordersError)
        return {
          success: false,
          error: ordersError.message,
          data: null,
        }
      }

      if (pageOrders && pageOrders.length > 0) {
        allOrders = allOrders.concat(pageOrders)
        console.log(`  Fetched ${pageOrders.length} orders (total so far: ${allOrders.length})`)
      }

      // Check if we have more pages
      hasMore = pageOrders && pageOrders.length === PAGE_SIZE
      currentPage++

      // Safety: stop after 100 pages (100k orders)
      if (currentPage >= 100) {
        console.warn('Reached maximum page limit (100 pages, 100k orders)')
        hasMore = false
      }
    }

    const orders = allOrders

    if (!orders || orders.length === 0) {
      return {
        success: true,
        data: {
          total: 0,
          eligible: 0,
          successful: 0,
          skipped: 0,
          failed: 0,
          errors: [],
          message: `ไม่มี orders ที่ shipped ในช่วง ${startDateISO} ถึง ${endDateISO}`,
        },
      }
    }

    console.log(`Found ${orders.length} total shipped orders in range`)

    // Filter out orders that already have COGS allocations
    // CRITICAL: Use chunked queries to avoid "Bad Request" with large IN lists
    const order_ids = orders.map((o) => o.order_id)
    const allocatedOrderIds = new Set<string>()

    if (order_ids.length === 0) {
      console.log('No orders to check for existing allocations')
    } else {
      // Chunk order_ids to avoid PostgREST "Bad Request" (query too large)
      const CHUNK_SIZE = 200
      const chunks: string[][] = []
      for (let i = 0; i < order_ids.length; i += CHUNK_SIZE) {
        chunks.push(order_ids.slice(i, i + CHUNK_SIZE))
      }

      console.log(
        `Checking existing allocations in ${chunks.length} chunks (${order_ids.length} orders total, chunk size: ${CHUNK_SIZE})`
      )
      console.log(`  First order_id: ${order_ids[0]}, Last: ${order_ids[order_ids.length - 1]}`)

      // Query each chunk
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex]
        const { data: chunkAllocations, error: allocError } = await supabase
          .from('inventory_cogs_allocations')
          .select('order_id')
          .in('order_id', chunk)
          .eq('is_reversal', false)

        if (allocError) {
          console.error(
            `Error checking existing allocations (chunk ${chunkIndex + 1}/${chunks.length}):`,
            allocError
          )
          console.error('  Error details:', JSON.stringify(allocError, null, 2))
          return {
            success: false,
            error: `Failed to check existing allocations (chunk ${chunkIndex + 1}/${chunks.length}): ${allocError.message || 'Bad Request'}`,
            data: null,
          }
        }

        // Add to allocated set
        if (chunkAllocations) {
          for (const row of chunkAllocations) {
            allocatedOrderIds.add(String(row.order_id))
          }
        }

        console.log(
          `  Chunk ${chunkIndex + 1}/${chunks.length}: Found ${chunkAllocations?.length || 0} allocated (total so far: ${allocatedOrderIds.size})`
        )
      }

      console.log(`Found ${allocatedOrderIds.size} orders already allocated (total)`)
    }

    // Prepare result summary
    const summary = {
      total: orders.length,
      eligible: 0,
      successful: 0,
      skipped: 0,
      failed: 0,
      errors: [] as Array<{ order_id: string; reason: string }>,
    }

    // Process each order
    for (const order of orders) {
      const order_id = order.order_id
      const sku = order.seller_sku
      const qty = order.quantity
      const shipped_at = order.shipped_at

      // Skip if already allocated
      if (allocatedOrderIds.has(order_id)) {
        summary.skipped++
        summary.errors.push({
          order_id,
          reason: 'already_allocated',
        })
        continue
      }

      // Validate seller_sku
      if (!sku || sku.trim() === '') {
        summary.skipped++
        summary.errors.push({
          order_id,
          reason: 'missing_seller_sku',
        })
        continue
      }

      // Validate quantity
      if (qty == null || !Number.isFinite(qty) || qty <= 0) {
        summary.skipped++
        summary.errors.push({
          order_id,
          reason: `invalid_quantity_${qty}`,
        })
        continue
      }

      // Validate shipped_at (should always be true due to query filter)
      if (!shipped_at) {
        summary.skipped++
        summary.errors.push({
          order_id,
          reason: 'missing_shipped_at',
        })
        continue
      }

      // This order is eligible
      summary.eligible++

      // Apply COGS
      try {
        const success = await applyCOGSForOrderShippedCore(
          order_id,
          sku,
          qty,
          shipped_at,
          method
        )

        if (success) {
          summary.successful++
          console.log(`✓ Order ${order_id}: COGS applied (SKU: ${sku}, Qty: ${qty})`)
        } else {
          summary.failed++
          summary.errors.push({
            order_id,
            reason: 'applyCOGS_returned_false',
          })
          console.error(`✗ Order ${order_id}: Failed to apply COGS`)
        }
      } catch (error) {
        summary.failed++
        summary.errors.push({
          order_id,
          reason: error instanceof Error ? error.message : 'unknown_error',
        })
        console.error(`✗ Order ${order_id}: Exception:`, error)
      }
    }

    console.log('Apply COGS MTD Summary:', summary)

    revalidatePath('/inventory')
    revalidatePath('/sales')
    revalidatePath('/daily-pl')

    return {
      success: true,
      data: summary,
    }
  } catch (error) {
    console.error('Unexpected error in applyCOGSMTD:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      data: null,
    }
  }
}

/**
 * Check if current user is admin (for inventory module)
 */
export async function checkIsInventoryAdmin(): Promise<{
  success: boolean
  isAdmin: boolean
  error?: string
}> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, isAdmin: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    // Check user_roles table for admin role
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (error) {
      // If no role found, user is not admin
      if (error.code === 'PGRST116') {
        return { success: true, isAdmin: false }
      }
      console.error('Error checking admin status:', error)
      return { success: false, isAdmin: false, error: error.message }
    }

    return { success: true, isAdmin: data?.role === 'admin' }
  } catch (error) {
    console.error('Unexpected error in checkIsInventoryAdmin:', error)
    return {
      success: false,
      isAdmin: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

// ============================================
// On Hand Inventory
// ============================================

/**
 * Get on hand quantities for all SKUs or a specific SKU
 * Computed as sum(qty_remaining) from non-voided receipt layers
 *
 * @param sku_internal - Optional SKU to filter by
 * @returns Map of SKU -> on hand quantity
 */
export async function getInventoryOnHand(
  sku_internal?: string
): Promise<{ success: boolean; error?: string; data: Record<string, number> }> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้', data: {} }
    }

    // Build query
    let query = supabase
      .from('inventory_receipt_layers')
      .select('sku_internal, qty_remaining')
      .eq('is_voided', false)

    // Filter by SKU if provided
    if (sku_internal) {
      query = query.eq('sku_internal', sku_internal)
    }

    const { data: layers, error: layersError } = await query

    if (layersError) {
      console.error('Error fetching receipt layers:', layersError)
      return { success: false, error: layersError.message, data: {} }
    }

    // Aggregate by SKU
    const onHandMap: Record<string, number> = {}

    if (layers && layers.length > 0) {
      for (const layer of layers) {
        const sku = layer.sku_internal
        const qty = layer.qty_remaining || 0

        if (onHandMap[sku]) {
          onHandMap[sku] += qty
        } else {
          onHandMap[sku] = qty
        }
      }
    }

    return { success: true, data: onHandMap }
  } catch (error) {
    console.error('Unexpected error in getInventoryOnHand:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      data: {},
    }
  }
}

// ============================================
// Bundle On Hand (Available Sets)
// ============================================

export interface BundleOnHandInfo {
  available_sets: number
  limiting_component?: string
  components: Array<{
    sku: string
    required_per_set: number
    on_hand: number
    possible_sets: number
  }>
}

/**
 * Get bundle on hand (available sets) for all bundle SKUs
 * Computed from component inventory availability
 *
 * Formula: min over components( floor(component_on_hand / component.quantity) )
 *
 * @returns Map of bundle_sku -> BundleOnHandInfo
 */
export async function getBundleOnHand(): Promise<{
  success: boolean
  error?: string
  data: Record<string, BundleOnHandInfo>
}> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้', data: {} }
    }

    // 1. Get all bundle SKUs
    const { data: items, error: itemsError } = await supabase
      .from('inventory_items')
      .select('sku_internal, is_bundle')
      .eq('is_bundle', true)

    if (itemsError) {
      console.error('Error fetching bundle items:', itemsError)
      return { success: false, error: itemsError.message, data: {} }
    }

    if (!items || items.length === 0) {
      return { success: true, data: {} } // No bundles
    }

    const bundleSkus = items.map((i) => i.sku_internal)

    // 2. Fetch components for all bundles
    const { data: components, error: componentsError } = await supabase
      .from('inventory_bundle_components')
      .select('bundle_sku, component_sku, quantity')
      .in('bundle_sku', bundleSkus)

    if (componentsError) {
      console.error('Error fetching bundle components:', componentsError)
      return { success: false, error: componentsError.message, data: {} }
    }

    // 3. Collect all unique component SKUs
    const componentSkus = Array.from(
      new Set((components || []).map((c) => c.component_sku))
    )

    // 4. Fetch on-hand for all component SKUs in one query
    let componentOnHand: Record<string, number> = {}

    if (componentSkus.length > 0) {
      const { data: layers, error: layersError } = await supabase
        .from('inventory_receipt_layers')
        .select('sku_internal, qty_remaining')
        .in('sku_internal', componentSkus)
        .eq('is_voided', false)

      if (layersError) {
        console.error('Error fetching component layers:', layersError)
        return { success: false, error: layersError.message, data: {} }
      }

      // Aggregate by SKU
      if (layers && layers.length > 0) {
        for (const layer of layers) {
          const sku = layer.sku_internal
          const qty = layer.qty_remaining || 0

          if (componentOnHand[sku]) {
            componentOnHand[sku] += qty
          } else {
            componentOnHand[sku] = qty
          }
        }
      }
    }

    // 5. Compute available sets for each bundle
    const bundleOnHandMap: Record<string, BundleOnHandInfo> = {}

    for (const bundleSku of bundleSkus) {
      const bundleComponents = (components || []).filter(
        (c) => c.bundle_sku === bundleSku
      )

      if (bundleComponents.length === 0) {
        // No components defined
        bundleOnHandMap[bundleSku] = {
          available_sets: 0,
          components: [],
        }
        continue
      }

      // Calculate possible sets per component
      const componentInfo = bundleComponents.map((c) => {
        const onHand = componentOnHand[c.component_sku] || 0
        const requiredPerSet = c.quantity
        const possibleSets = requiredPerSet > 0 ? Math.floor(onHand / requiredPerSet) : 0

        return {
          sku: c.component_sku,
          required_per_set: requiredPerSet,
          on_hand: onHand,
          possible_sets: possibleSets,
        }
      })

      // Find minimum (limiting component)
      let minSets = Infinity
      let limitingComponent: string | undefined

      for (const comp of componentInfo) {
        if (comp.possible_sets < minSets) {
          minSets = comp.possible_sets
          limitingComponent = comp.sku
        }
      }

      const availableSets = minSets === Infinity ? 0 : minSets

      bundleOnHandMap[bundleSku] = {
        available_sets: availableSets,
        limiting_component: limitingComponent,
        components: componentInfo,
      }
    }

    return { success: true, data: bundleOnHandMap }
  } catch (error) {
    console.error('Unexpected error in getBundleOnHand:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      data: {},
    }
  }
}

// ============================================
// Stock In (Inbound Receipts)
// ============================================

/**
 * Create stock in document and receipt layer for a SKU
 *
 * IMPORTANT: This function creates TWO records atomically:
 * 1) inventory_stock_in_documents (with item_id, quantity, unit_cost)
 * 2) inventory_receipt_layers (with sku_internal, qty_received, qty_remaining)
 *
 * Receipt layers use sku_internal directly (NO item_id column in that table)
 *
 * @param params - Stock in parameters
 * @returns Success/error result
 */
export async function createStockInForSku(params: {
  sku_internal?: string
  sku?: string // alias
  quantity?: number
  qty?: number // alias
  received_at: string // ISO date string
  unit_cost: number
  reference: string
  supplier?: string
  note?: string
}): Promise<{ success: boolean; error?: string; data?: { doc_id: string; layer_id: string } }> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    // ============================================
    // NORMALIZE SKU: trim + uppercase
    // ============================================
    const normalizedSku = String(params.sku_internal ?? params.sku ?? '').trim().toUpperCase()

    if (!normalizedSku) {
      return { success: false, error: 'SKU is required' }
    }

    // ============================================
    // NORMALIZE QUANTITY SAFELY
    // ============================================
    const rawQty = params.quantity ?? params.qty
    const quantity = Number(rawQty)

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return {
        success: false,
        error: `Invalid quantity: ${rawQty}. Quantity must be a positive number.`
      }
    }

    const { received_at, unit_cost, reference, supplier, note } = params

    // Validate: unit_cost >= 0
    if (!Number.isFinite(unit_cost) || unit_cost < 0) {
      return { success: false, error: 'Unit cost ต้องเป็นตัวเลขและไม่ติดลบ' }
    }

    // Validate: reference is required
    if (!reference || reference.trim() === '') {
      return { success: false, error: 'Reference จำเป็นต้องระบุ' }
    }

    // ============================================
    // RESOLVE item_id from sku_internal
    // ============================================
    const { data: item, error: itemError } = await supabase
      .from('inventory_items')
      .select('id, sku_internal, is_bundle')
      .eq('sku_internal', normalizedSku)
      .single()

    if (itemError || !item) {
      console.error('Item lookup failed:', itemError)
      return {
        success: false,
        error: `Inventory item not found: ${normalizedSku}`
      }
    }

    // Validate: SKU is not a bundle
    if (item.is_bundle) {
      return {
        success: false,
        error: 'ไม่สามารถ Stock In สำหรับ Bundle SKU ได้ (Stock In component SKUs แทน)'
      }
    }

    const item_id = item.id

    // ============================================
    // INSERT stock in document WITH quantity
    // ============================================
    const { data: doc, error: docError } = await supabase
      .from('inventory_stock_in_documents')
      .insert({
        item_id,       // ✅ Include item_id
        quantity,      // ✅ Include quantity (NOT NULL)
        unit_cost,     // ✅ Include unit_cost
        received_at,
        reference,
        supplier: supplier || null,
        note: note || null,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (docError || !doc) {
      console.error('Error creating stock in document:', docError)
      return {
        success: false,
        error: `เกิดข้อผิดพลาดในการสร้าง stock in document: ${docError?.message || 'Unknown'}`
      }
    }

    const doc_id = doc.id

    // ============================================
    // INSERT receipt layer (ALWAYS after document)
    // Uses REAL schema: sku_internal (NO item_id)
    // ============================================
    const { data: layer, error: layerError } = await supabase
      .from('inventory_receipt_layers')
      .insert({
        sku_internal: normalizedSku,  // ✅ Use sku_internal (NO item_id in this table!)
        received_at,
        qty_received: quantity,       // ✅ Use normalized quantity
        qty_remaining: quantity,      // ✅ Initially all remaining
        unit_cost,
        ref_type: 'STOCK_IN',         // ✅ Use 'STOCK_IN' (not 'PURCHASE')
        ref_id: doc_id,
        is_voided: false,
      })
      .select('id')
      .single()

    if (layerError || !layer) {
      console.error('Error creating receipt layer:', layerError)
      // Rollback: delete the document we just created
      await supabase.from('inventory_stock_in_documents').delete().eq('id', doc_id)
      return {
        success: false,
        error: `เกิดข้อผิดพลาดในการสร้าง receipt layer: ${layerError?.message || 'Unknown'}`
      }
    }

    const layer_id = layer.id

    console.log(`✓ Stock In created: SKU=${normalizedSku}, Qty=${quantity}, Doc=${doc_id}, Layer=${layer_id}`)

    // Revalidate paths
    revalidatePath('/inventory')

    return {
      success: true,
      data: { doc_id, layer_id },
    }
  } catch (error) {
    console.error('Unexpected error in createStockInForSku:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}
