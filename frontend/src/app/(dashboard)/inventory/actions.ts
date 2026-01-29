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
 * Apply COGS for all eligible orders in current month (MTD)
 * Admin-only function
 */
export async function applyCOGSMTD(method: CostingMethod = 'FIFO') {
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

    // Get MTD date range (Bangkok timezone)
    const now = new Date()
    const bangkokTime = new Date(
      now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })
    )
    const startOfMonth = new Date(
      bangkokTime.getFullYear(),
      bangkokTime.getMonth(),
      1
    )
    const startOfMonthISO = startOfMonth.toISOString().split('T')[0]
    const todayISO = bangkokTime.toISOString().split('T')[0]

    console.log(`Apply COGS MTD: ${startOfMonthISO} to ${todayISO}`)

    // Get eligible orders (shipped in MTD, not cancelled, has seller_sku, quantity>0)
    const { data: orders, error: ordersError } = await supabase
      .from('sales_orders')
      .select('order_id, seller_sku, quantity, shipped_at, status_group')
      .not('shipped_at', 'is', null)
      .neq('status_group', 'ยกเลิกแล้ว')
      .gte('shipped_at', `${startOfMonthISO}T00:00:00+07:00`)
      .lte('shipped_at', `${todayISO}T23:59:59+07:00`)

    if (ordersError) {
      console.error('Error fetching orders:', ordersError)
      return {
        success: false,
        error: ordersError.message,
        data: null,
      }
    }

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
          message: 'ไม่มี orders ที่ shipped ใน MTD',
        },
      }
    }

    console.log(`Found ${orders.length} shipped orders in MTD`)

    // Filter out orders that already have COGS allocations
    const order_ids = orders.map((o) => o.order_id)
    const { data: existingAllocations, error: allocError } = await supabase
      .from('inventory_cogs_allocations')
      .select('order_id')
      .in('order_id', order_ids)
      .eq('is_reversal', false)

    if (allocError) {
      console.error('Error checking existing allocations:', allocError)
      return {
        success: false,
        error: allocError.message,
        data: null,
      }
    }

    const allocatedOrderIds = new Set(
      existingAllocations?.map((a) => a.order_id) || []
    )
    console.log(`Found ${allocatedOrderIds.size} orders already allocated`)

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
// Stock In (Inbound Receipts)
// ============================================

/**
 * Create stock in document and receipt layer for a SKU
 *
 * @param params - Stock in parameters
 * @returns Success/error result
 */
export async function createStockInForSku(params: {
  sku_internal: string
  received_at: string // ISO date string
  qty: number
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

    const { sku_internal, received_at, qty, unit_cost, reference, supplier, note } = params

    // Validate: qty > 0
    if (qty <= 0) {
      return { success: false, error: 'Quantity ต้องมากกว่า 0' }
    }

    // Validate: unit_cost >= 0
    if (unit_cost < 0) {
      return { success: false, error: 'Unit cost ต้องไม่ติดลบ' }
    }

    // Validate: reference is required
    if (!reference || reference.trim() === '') {
      return { success: false, error: 'Reference จำเป็นต้องระบุ' }
    }

    // Validate: SKU exists
    const { data: item, error: itemError } = await supabase
      .from('inventory_items')
      .select('sku_internal, is_bundle')
      .eq('sku_internal', sku_internal)
      .single()

    if (itemError || !item) {
      return { success: false, error: `SKU ${sku_internal} ไม่พบในระบบ` }
    }

    // Validate: SKU is not a bundle
    if (item.is_bundle) {
      return { success: false, error: 'ไม่สามารถ Stock In สำหรับ Bundle SKU ได้ (Stock In component SKUs แทน)' }
    }

    // Insert inventory_stock_in_documents
    const { data: doc, error: docError } = await supabase
      .from('inventory_stock_in_documents')
      .insert({
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
      return { success: false, error: 'เกิดข้อผิดพลาดในการสร้าง stock in document' }
    }

    const doc_id = doc.id

    // Insert inventory_receipt_layers
    const { data: layer, error: layerError } = await supabase
      .from('inventory_receipt_layers')
      .insert({
        sku_internal,
        received_at,
        qty_received: qty,
        qty_remaining: qty,
        unit_cost,
        ref_type: 'PURCHASE',
        ref_id: doc_id,
        is_voided: false,
      })
      .select('id')
      .single()

    if (layerError || !layer) {
      console.error('Error creating receipt layer:', layerError)
      // Rollback: delete the document we just created
      await supabase.from('inventory_stock_in_documents').delete().eq('id', doc_id)
      return { success: false, error: 'เกิดข้อผิดพลาดในการสร้าง receipt layer' }
    }

    const layer_id = layer.id

    console.log(`✓ Stock In created: SKU=${sku_internal}, Qty=${qty}, Doc=${doc_id}, Layer=${layer_id}`)

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
