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
  type COGSApplyResult,
} from '@/lib/inventory-costing'
import {
  createCogsRun,
  completeCogsRunSuccess,
  completeCogsRunFailed,
  updateCogsRunProgress,
  createNotificationForRun,
} from './cogs-run-actions'

// ============================================
// COGS Allocation — Hobby-safe helpers
// ============================================

/**
 * Max eligible orders to process per single server-action invocation.
 * Keeps wall-clock time well inside Vercel Hobby's 60 s function limit:
 *   200 non-bundle orders × ~50 ms (single RPC) ≈ 10 s + ~5 s setup overhead.
 * Increase to 400 on Pro (pair with maxDuration = 300 in layout.tsx).
 */
const ORDERS_PER_CHUNK = 200

/**
 * Call the FIFO or AVG allocation RPC directly using the caller-supplied
 * Supabase client and already-known userId.
 * Eliminates the two redundant auth.getUser() calls that live inside
 * applyCOGSForOrderShipped and allocateFIFO/allocateAVG.
 */
async function _allocateRPC(
  supabase: ReturnType<typeof createClient>,
  method: CostingMethod,
  userId: string,
  orderUuid: string,
  sku: string,
  qty: number,
  shippedAt: string
): Promise<boolean> {
  const rpcName = method === 'FIFO' ? 'allocate_cogs_fifo' : 'allocate_cogs_avg'
  const { data, error } = await supabase.rpc(rpcName, {
    p_order_id: orderUuid,
    p_sku: sku,
    p_qty: qty,
    p_shipped_at: shippedAt,
    p_user_id: userId,
  })
  if (error) {
    console.error(`_allocateRPC ${rpcName} error:`, error.message)
    return false
  }
  const status = (data as { status?: string } | null)?.status
  return status === 'success' || status === 'already_allocated'
}

/**
 * Allocate COGS for a bundle order using pre-loaded component definitions.
 *
 * FIFO: delegates to allocate_cogs_bundle_fifo — a single Postgres transaction
 * covering all components. Either all allocations commit or none do (atomic).
 * Stale partial rows from a previous failed run are cleaned up inside the RPC.
 *
 * AVG: falls back to the sequential per-component path (snapshot-based, partial
 * state is acceptable because AVG snapshots track running balance independently).
 */
async function _allocateBundleOrderCOGS(
  supabase: ReturnType<typeof createClient>,
  method: CostingMethod,
  userId: string,
  orderUuid: string,
  bundleSku: string,
  qty: number,
  shippedAt: string,
  components: Array<{ component_sku: string; quantity: number }>
): Promise<COGSApplyResult> {
  if (components.length === 0) {
    return { status: 'failed', allocatedSkus: [], missingSkus: [bundleSku], reason: 'NO_BUNDLE_RECIPE' }
  }

  const items   = components.map((c) => ({ sku: c.component_sku, qty: c.quantity * qty }))
  const allSkus = items.map((i) => i.sku)

  // ── FIFO: single atomic RPC — all components or none ──────────────────────────
  if (method === 'FIFO') {
    const { data, error } = await supabase.rpc('allocate_cogs_bundle_fifo', {
      p_order_id:   orderUuid,
      p_components: items,        // [{sku, qty}] serialised as JSONB by Supabase client
      p_shipped_at: shippedAt,
      p_user_id:    userId,
    })

    if (error) {
      const msg = error.message ?? ''
      // Parse: insufficient_stock:SKU available=X required=Y
      const insuffMatch = msg.match(/insufficient_stock:(\S+)/)
      if (insuffMatch) {
        const failedSku = insuffMatch[1]
        return {
          status: 'failed',
          allocatedSkus: [],
          missingSkus: allSkus,
          reason: `INSUFFICIENT_STOCK: ${failedSku}`,
        }
      }
      if (msg.includes('invalid_input')) {
        return { status: 'failed', allocatedSkus: [], missingSkus: allSkus, reason: 'NO_BUNDLE_RECIPE' }
      }
      // Detect if the RPC function itself is missing (migration-090 not applied to DB)
      if (msg.toLowerCase().includes('does not exist') || msg.toLowerCase().includes('could not find the function')) {
        console.error(`_allocateBundleOrderCOGS: allocate_cogs_bundle_fifo NOT FOUND in DB — migration-090 must be applied in Supabase SQL Editor`)
        return { status: 'failed', allocatedSkus: [], missingSkus: allSkus, reason: 'RPC_NOT_FOUND: apply migration-090' }
      }
      console.error(`_allocateBundleOrderCOGS RPC error for ${bundleSku}:`, msg)
      return {
        status: 'failed',
        allocatedSkus: [],
        missingSkus: allSkus,
        reason: `ALLOCATION_FAILED: ${msg.slice(0, 120)}`,
      }
    }

    const status = (data as { status?: string } | null)?.status
    if (status === 'already_allocated') {
      return { status: 'already_allocated', allocatedSkus: allSkus, missingSkus: [] }
    }
    if (status === 'success') {
      return { status: 'success', allocatedSkus: allSkus, missingSkus: [] }
    }
    return { status: 'failed', allocatedSkus: [], missingSkus: allSkus, reason: 'ALLOCATION_FAILED' }
  }

  // ── AVG: sequential per-component (snapshot-based, existing behaviour) ────────
  const alreadyDone = new Set<string>()
  for (const comp of items) {
    const { data: existing } = await supabase
      .from('inventory_cogs_allocations')
      .select('id')
      .filter('order_id::text', 'eq', orderUuid)
      .eq('sku_internal', comp.sku)
      .eq('is_reversal', false)
      .limit(1)
    if (existing && existing.length > 0) alreadyDone.add(comp.sku)
  }

  if (alreadyDone.size === items.length) {
    return { status: 'already_allocated', allocatedSkus: allSkus, missingSkus: [] }
  }

  const allocated: string[] = []
  const failed: string[] = []

  for (const comp of items) {
    if (alreadyDone.has(comp.sku)) continue
    const ok = await _allocateRPC(supabase, method, userId, orderUuid, comp.sku, comp.qty, shippedAt)
    if (ok) allocated.push(comp.sku)
    else failed.push(comp.sku)
  }

  const allDone = [...Array.from(alreadyDone), ...allocated]
  if (failed.length === 0)
    return { status: 'success', allocatedSkus: allDone, missingSkus: [] }
  if (allDone.length === 0)
    return { status: 'failed', allocatedSkus: [], missingSkus: failed, reason: `ALLOCATION_FAILED: ${failed.join(',')}` }
  return { status: 'partial', allocatedSkus: allDone, missingSkus: failed, reason: `PARTIAL: allocated [${allDone.join(',')}], missing [${failed.join(',')}]` }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Check if current user has inventory admin role
 * Used for gating admin-only operations like voiding opening balances
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
      return { success: false, isAdmin: false }
    }

    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (roleError) {
      return { success: false, isAdmin: false }
    }

    return { success: true, isAdmin: roleData?.role === 'admin' }
  } catch (error) {
    console.error('Error checking admin status:', error)
    return { success: false, isAdmin: false }
  }
}

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
 * Update unit_cost of a STOCK_IN layer — only if not yet consumed (no allocations)
 */
export async function updateStockInLayerCost(
  layer_id: string,
  unit_cost: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    const { data: layer, error: fetchError } = await supabase
      .from('inventory_receipt_layers')
      .select('*')
      .eq('id', layer_id)
      .single()

    if (fetchError || !layer) {
      return { success: false, error: 'Layer not found' }
    }

    if (layer.ref_type !== 'STOCK_IN') {
      return { success: false, error: 'Can only edit STOCK_IN layers' }
    }

    if (layer.is_voided) {
      return { success: false, error: 'Cannot edit voided layer' }
    }

    if (layer.qty_remaining !== layer.qty_received) {
      return { success: false, error: 'Cannot edit layer that has been partially consumed' }
    }

    const { data: allocations, error: allocError } = await supabase
      .from('inventory_cogs_allocations')
      .select('id')
      .eq('layer_id', layer_id)
      .limit(1)

    if (allocError) {
      return { success: false, error: 'Error checking allocations' }
    }

    if (allocations && allocations.length > 0) {
      return { success: false, error: 'Cannot edit layer that has COGS allocations' }
    }

    if (unit_cost <= 0) {
      return { success: false, error: 'Unit cost must be greater than 0' }
    }

    const { error: updateError } = await supabase
      .from('inventory_receipt_layers')
      .update({ unit_cost })
      .eq('id', layer_id)

    if (updateError) {
      console.error('Error updating STOCK_IN layer cost:', updateError)
      return { success: false, error: updateError.message }
    }

    revalidatePath('/inventory')
    return { success: true }
  } catch (error) {
    console.error('Unexpected error in updateStockInLayerCost:', error)
    return { success: false, error: 'Unexpected error' }
  }
}

/**
 * Void (soft delete) opening balance layer (only if not yet consumed)
 */
/**
 * Void opening balance layer with COGS reversal (admin only)
 *
 * SAFE: Marks layer as voided and reverses all COGS allocations from it
 * IDEMPOTENT: Can be called multiple times safely
 *
 * @param layer_id - Layer to void
 * @param reason - User-provided reason (required, min 10 chars)
 */
export async function voidOpeningBalanceWithReversal(
  layer_id: string,
  reason: string
): Promise<{ success: boolean; error?: string; warning?: string }> {
  try {
    const supabase = createClient()

    // ============================================
    // 1. AUTH + ADMIN CHECK
    // ============================================
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Check admin role
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (roleError || roleData?.role !== 'admin') {
      return { success: false, error: 'Admin access required' }
    }

    // Validate reason
    if (!reason || reason.trim().length < 10) {
      return { success: false, error: 'Reason must be at least 10 characters' }
    }

    // ============================================
    // 2. GET LAYER AND VALIDATE
    // ============================================
    const { data: layer, error: fetchError } = await supabase
      .from('inventory_receipt_layers')
      .select('*')
      .eq('id', layer_id)
      .single()

    if (fetchError || !layer) {
      return { success: false, error: 'Layer not found' }
    }

    // Check: Must be OPENING_BALANCE
    if (layer.ref_type !== 'OPENING_BALANCE') {
      return { success: false, error: 'Can only void opening balance layers' }
    }

    // IDEMPOTENCY: If already voided, return success
    if (layer.is_voided) {
      return {
        success: true,
        warning: 'Layer was already voided',
      }
    }

    // ============================================
    // 3. FIND ALLOCATIONS (NON-REVERSED)
    // ============================================
    const { data: allocations, error: allocError } = await supabase
      .from('inventory_cogs_allocations')
      .select('id, order_id, qty, method, layer_id')
      .eq('layer_id', layer_id)
      .is('reversed_at', null)
      .eq('is_reversal', false)

    if (allocError) {
      return { success: false, error: 'Error checking allocations' }
    }

    const allocationCount = allocations?.length || 0
    const hasAllocations = allocationCount > 0

    // ============================================
    // 4. MARK LAYER AS VOIDED
    // ============================================
    const { error: voidError } = await supabase
      .from('inventory_receipt_layers')
      .update({
        is_voided: true,
        voided_at: new Date().toISOString(),
        voided_by: user.id,
        void_reason: reason.trim(),
      })
      .eq('id', layer_id)

    if (voidError) {
      console.error('Error voiding layer:', voidError)
      return { success: false, error: voidError.message }
    }

    // ============================================
    // 5. REVERSE ALLOCATIONS (IF ANY)
    // ============================================
    if (hasAllocations) {
      const reversal_reason = `Opening balance voided: ${reason}`
      const reversed_at = new Date().toISOString()

      // Mark all allocations as reversed
      const { error: reverseError } = await supabase
        .from('inventory_cogs_allocations')
        .update({
          reversed_at,
          reversed_by: user.id,
          reversed_reason: reversal_reason,
        })
        .in(
          'id',
          allocations.map((a) => a.id)
        )

      if (reverseError) {
        console.error('Error reversing allocations:', reverseError)
        return {
          success: false,
          error: 'Layer voided but failed to reverse allocations. Contact admin.',
        }
      }

      console.log(`Reversed ${allocationCount} allocations for layer ${layer_id}`)
    }

    // ============================================
    // 6. REBUILD INVENTORY SNAPSHOTS (AVG METHOD)
    // ============================================
    const rebuildStartDate = layer.received_at.split('T')[0] // Extract YYYY-MM-DD
    const rebuildEndDate = getTodayBangkokString()

    const { error: rebuildError } = await supabase.rpc('rebuild_inventory_snapshots', {
      p_user_id: user.id,
      p_sku_internal: layer.sku_internal,
      p_start_date: rebuildStartDate,
      p_end_date: rebuildEndDate,
    })

    if (rebuildError) {
      console.error('Error rebuilding snapshots:', rebuildError)
      // Non-fatal: void succeeded, but snapshots need manual rebuild
      return {
        success: true,
        warning: `Layer voided successfully, but snapshot rebuild failed. Run manual inventory rebuild for SKU ${layer.sku_internal}.`,
      }
    }

    // ============================================
    // 7. REVALIDATE PATHS
    // ============================================
    revalidatePath('/inventory')
    revalidatePath('/daily-pl')

    return {
      success: true,
      warning: hasAllocations
        ? `Voided layer and reversed ${allocationCount} COGS allocation(s)`
        : undefined,
    }
  } catch (error) {
    console.error('Unexpected error in voidOpeningBalanceWithReversal:', error)
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
    const result = await applyCOGSForOrderShippedCore(
      data.order_id,
      data.sku_internal,
      data.qty,
      data.shipped_at,
      data.method
    )

    if (result.status === 'failed') {
      return { success: false, error: result.reason || 'Failed to apply COGS' }
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
  /**
   * 'fresh'    — ignore any previous failed run; always start from pass1/offset0.
   *              Use this for explicit "Start fresh" or "Reset and rerun" flows.
   * 'continue' — (default) resume from the most recent failed run for the same
   *              date range if one exists, otherwise start fresh.
   */
  mode?: 'fresh' | 'continue'
} = {}) {
  const method = params.method || 'FIFO'
  const mode   = params.mode   || 'continue'
  let run_id: string | null = null
  let cogs_run_id: string | null = null

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

    console.log(`[applyCOGSMTD] Apply COGS Range: ${startDateISO} to ${endDateISO}`)

    // ============================================
    // GUARD: prevent concurrent runs; auto-fail stale ones
    // ============================================
    const { data: existingRun } = await supabase
      .from('cogs_allocation_runs')
      .select('id, created_at, updated_at')
      .eq('status', 'running')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingRun) {
      const lastActivityMs = Date.now() - new Date(existingRun.updated_at ?? existingRun.created_at).getTime()
      const STALE_MS = 10 * 60 * 1000 // 10 minutes with no progress = stale

      if (lastActivityMs > STALE_MS) {
        console.warn(`[applyCOGSMTD] Auto-failing stale run ${existingRun.id} (inactive ${Math.round(lastActivityMs / 1000)}s)`)
        await completeCogsRunFailed(existingRun.id, `Auto-failed: no activity for ${Math.round(lastActivityMs / 60000)} min`)
        // Fall through and allow new run
      } else {
        console.warn(`[applyCOGSMTD] Blocked: active run ${existingRun.id} still in progress`)
        return {
          success: false,
          error: `มี COGS run ที่กำลังทำงานอยู่แล้ว (id: ${existingRun.id}) กรุณารอให้เสร็จก่อน`,
          data: null,
        }
      }
    }

    // ============================================
    // CREATE COGS_ALLOCATION_RUN (notification tracking)
    // ============================================
    const cogsRunResult = await createCogsRun({
      triggerSource: 'DATE_RANGE',
      dateFrom: startDateISO,
      dateTo: endDateISO,
    })
    if (cogsRunResult.success && cogsRunResult.runId) {
      cogs_run_id = cogsRunResult.runId
      console.log(`Created cogs_allocation_run: ${cogs_run_id}`)
    }

    // ============================================
    // CREATE RUN RECORD (for logging)
    // ============================================
    const { data: runData, error: runError } = await supabase
      .from('inventory_cogs_apply_runs')
      .insert({
        start_date: startDateISO,
        end_date: endDateISO,
        method,
        total: 0,
        eligible: 0,
        successful: 0,
        skipped: 0,
        failed: 0,
        partial: 0,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (runError || !runData) {
      console.error('Failed to create run record:', runError)
      // Non-fatal: continue without logging
    } else {
      run_id = runData.id
      console.log(`Created run record: ${run_id}`)
    }

    // ──────────────────────────────────────────────────────────────────────
    // RESUME DETECTION
    // mode='continue': find most recent failed run for the same date range
    //   so re-runs continue from where the previous timed-out run left off.
    // mode='fresh': skip this lookup entirely — always start from offset 0.
    //   Use this after a ledger reset or when the user explicitly wants fresh.
    // ──────────────────────────────────────────────────────────────────────
    let prevFailedRun: { id: string; summary_json: unknown } | null = null
    if (mode !== 'fresh') {
      const { data: pfr } = await supabase
        .from('cogs_allocation_runs')
        .select('id, summary_json')
        .eq('status', 'failed')
        .eq('trigger_source', 'DATE_RANGE')
        .eq('date_from', startDateISO)
        .eq('date_to', endDateISO)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      prevFailedRun = pfr
    }

    console.log(`[applyCOGSMTD] mode=${mode} prevFailedRun=${prevFailedRun?.id ?? 'none (skipped — fresh mode)'}`)

    type PrevProgress = {
      offset_completed?: number
      total_so_far?: number
      successful_so_far?: number
      skipped_so_far?: number
      failed_so_far?: number
      // Two-pass state (bundle-first ordering)
      current_pass?: 1 | 2
      pass1_completed?: boolean
      pass1_offset_completed?: number
    }
    const prevProgress: PrevProgress =
      (prevFailedRun?.summary_json as PrevProgress | null) ?? {}

    // Two-pass resume detection
    // pass1_completed=true means pass 1 finished, resume pass 2 from offset_completed
    // pass1_completed=false/missing means resume pass 1 from pass1_offset_completed
    const pass1AlreadyDone = prevProgress.pass1_completed === true
    const startPass1Offset = pass1AlreadyDone
      ? 0
      : (typeof prevProgress.pass1_offset_completed === 'number' ? prevProgress.pass1_offset_completed : 0)
    const startPass2Offset = pass1AlreadyDone
      ? (typeof prevProgress.offset_completed === 'number' ? prevProgress.offset_completed : 0)
      : 0

    const isResuming = startPass1Offset > 0 || startPass2Offset > 0 || pass1AlreadyDone
    if (isResuming) {
      console.log(
        `[applyCOGSMTD] Resuming (prev failed run: ${prevFailedRun!.id}) — ` +
        `pass1_done=${pass1AlreadyDone}, pass1_offset=${startPass1Offset}, pass2_offset=${startPass2Offset}, ` +
        `prev_total=${prevProgress.total_so_far ?? 0}, prev_successful=${prevProgress.successful_so_far ?? 0}`
      )
    } else {
      console.log('[applyCOGSMTD] Starting fresh — bundle-first two-pass run')
    }

    // ── Hard guard: fresh mode must never inherit non-zero offsets ─────────────
    if (mode === 'fresh') {
      console.log(
        `[applyCOGSMTD] FRESH GUARD: run=${cogs_run_id} startPass1=${startPass1Offset} startPass2=${startPass2Offset} pass1Done=${pass1AlreadyDone}`
      )
      if (startPass1Offset !== 0 || startPass2Offset !== 0 || pass1AlreadyDone) {
        const guardMsg =
          `[FRESH_GUARD] mode=fresh but inherited non-zero offsets — ` +
          `pass1=${startPass1Offset} pass2=${startPass2Offset} pass1Done=${pass1AlreadyDone} — THIS IS A BUG`
        console.error(guardMsg)
        if (cogs_run_id) await completeCogsRunFailed(cogs_run_id, guardMsg)
        return { success: false, error: guardMsg, data: null }
      }
      console.log(`[applyCOGSMTD] FRESH GUARD OK — run ${cogs_run_id} confirmed starting from offset 0`)
    }

    // ──────────────────────────────────────────────────────────────────────
    // PRE-FETCH BUNDLE CONTEXT (once, before the processing loop)
    // ──────────────────────────────────────────────────────────────────────
    const { data: bundleItemsData_outer } = await supabase
      .from('inventory_items')
      .select('sku_internal')
      .eq('is_bundle', true)

    const bundleSkuSet = new Set<string>((bundleItemsData_outer || []).map((i) => i.sku_internal))
    console.log(`[applyCOGSMTD] Bundle SKUs: ${bundleSkuSet.size} found`)

    const bundleComponentsMap = new Map<string, Array<{ component_sku: string; quantity: number }>>()
    if (bundleSkuSet.size > 0) {
      const { data: allComponents } = await supabase
        .from('inventory_bundle_components')
        .select('bundle_sku, component_sku, quantity')
        .in('bundle_sku', Array.from(bundleSkuSet))
      for (const row of allComponents ?? []) {
        if (!bundleComponentsMap.has(row.bundle_sku)) bundleComponentsMap.set(row.bundle_sku, [])
        bundleComponentsMap.get(row.bundle_sku)!.push({ component_sku: row.component_sku, quantity: row.quantity })
      }
      console.log(`[applyCOGSMTD] Pre-loaded components for ${bundleComponentsMap.size} bundle SKUs`)
    }

    // ── Fresh mode: TypeScript-level partial bundle pre-cleanup ───────────────────
    // Runs BEFORE pass 1. Cleans partial rows from prior sequential runs or failed
    // RPCs so the atomic RPC (or the pre-validation in it) starts with a clean slate.
    // Works even if migration-090 (allocate_cogs_bundle_fifo) is not yet applied.
    if (mode === 'fresh' && bundleSkuSet.size > 0) {
      console.log('[applyCOGSMTD] fresh pre-clean: scanning for partial bundle allocations...')
      const { data: preBundleOrders } = await supabase
        .from('sales_orders')
        .select('id, seller_sku')
        .in('seller_sku', Array.from(bundleSkuSet))
        .gte('order_date', `${startDateISO}T00:00:00+07:00`)
        .lte('order_date', `${endDateISO}T23:59:59+07:00`)
        .not('shipped_at', 'is', null)
        .neq('status_group', 'ยกเลิกแล้ว')
        .limit(2000)

      if (preBundleOrders && preBundleOrders.length > 0) {
        const preBundleIds = preBundleOrders.map((o) => o.id)
        const { data: preAllocs } = await supabase
          .from('inventory_cogs_allocations')
          .select('id, order_id, sku_internal, qty, layer_id')
          .in('order_id', preBundleIds)
          .eq('is_reversal', false)

        const preAllocMap = new Map<string, Array<{ id: string; sku_internal: string; qty: number; layer_id: string | null }>>()
        for (const row of preAllocs ?? []) {
          const oid = String(row.order_id)
          if (!preAllocMap.has(oid)) preAllocMap.set(oid, [])
          preAllocMap.get(oid)!.push({ id: row.id, sku_internal: row.sku_internal, qty: Number(row.qty), layer_id: row.layer_id ?? null })
        }

        let prePartialFixed = 0
        for (const order of preBundleOrders) {
          const rows = preAllocMap.get(order.id) ?? []
          if (rows.length === 0) continue
          const expectedCount = bundleComponentsMap.get(order.seller_sku)?.length ?? 0
          const allocatedSkuCount = new Set(rows.map((r) => r.sku_internal)).size
          if (allocatedSkuCount > 0 && allocatedSkuCount < expectedCount) {
            // Restore qty_remaining on each layer, then delete the stale rows
            for (const row of rows) {
              if (!row.layer_id) continue
              const { data: layer } = await supabase
                .from('inventory_receipt_layers')
                .select('qty_remaining')
                .eq('id', row.layer_id)
                .single()
              if (layer) {
                await supabase
                  .from('inventory_receipt_layers')
                  .update({ qty_remaining: Number(layer.qty_remaining) + row.qty })
                  .eq('id', row.layer_id)
              }
            }
            const ids = rows.map((r) => r.id)
            await supabase.from('inventory_cogs_allocations').delete().in('id', ids)
            prePartialFixed++
          }
        }
        console.log(`[applyCOGSMTD] fresh pre-clean: ${prePartialFixed}/${preBundleOrders.length} bundle orders had partial state — cleaned`)
      }
    }

    // ──────────────────────────────────────────────────────────────────────
    // SHARED TYPES (used across all loop iterations)
    // ──────────────────────────────────────────────────────────────────────
    interface SkipReasonEntry {
      code: string
      label: string
      count: number
      samples: Array<{ order_id: string; sku?: string; detail?: string }>
    }
    type RunItem = {
      order_id: string
      sku: string | null
      qty: number | null
      status: 'successful' | 'skipped' | 'failed' | 'partial'
      reason: string | null
      missing_skus: string[]
      allocated_skus: string[]
    }

    // Accumulated totals across ALL windows (seed from previous failed run if resuming)
    const accSkipReasons = new Map<string, SkipReasonEntry>()
    const allRunItems: RunItem[] = []
    const accSummary = {
      total: isResuming ? (prevProgress.total_so_far ?? 0) : 0,
      eligible: 0,
      successful: isResuming ? (prevProgress.successful_so_far ?? 0) : 0,
      skipped: isResuming ? (prevProgress.skipped_so_far ?? 0) : 0,
      failed: isResuming ? (prevProgress.failed_so_far ?? 0) : 0,
      partial: 0,
      errors: [] as Array<{ order_id: string; reason: string }>,
    }

    const addSkipReason = (code: string, label: string, order_id: string, sku?: string, detail?: string) => {
      if (!accSkipReasons.has(code)) {
        accSkipReasons.set(code, { code, label, count: 0, samples: [] })
      }
      const entry = accSkipReasons.get(code)!
      entry.count += 1
      if (entry.samples.length < 20) {
        entry.samples.push({ order_id, sku, detail })
      }
    }

    // ──────────────────────────────────────────────────────────────────────
    // TWO-PASS PROCESSING LOOP (bundle-first ordering)
    //
    // Pass 1 — Bundle orders only (.in seller_sku bundleSkuSet):
    //   Allocates component stock for all bundles before direct-SKU orders run.
    //   Prevents direct-SKU demand from consuming component stock needed by bundles.
    //
    // Pass 2 — All remaining orders (seller_sku NOT in bundles):
    //   Non-bundle orders get FIFO allocation from whatever component stock remains.
    //   Any bundle orders that appear will fast-return 'already_allocated'.
    // ──────────────────────────────────────────────────────────────────────
    const LOOP_START_MS = Date.now()
    const TIMEOUT_MS = 50_000 // 50 s safety margin for Vercel Hobby 60 s limit
    const bundleSkuArray = Array.from(bundleSkuSet)

    // ── Shared order processor (used by both passes) ──────────────────────
    const processOrderWindow = async (
      orders: Array<{
        id: string; order_id: string; seller_sku: string | null
        quantity: number | null; shipped_at: string | null
        order_date: string; status_group: string | null
      }>,
      preCheckedAllocatedIds: Set<string>
    ) => {
      for (const order of orders) {
        const order_uuid = order.id
        const order_id   = order.order_id
        const sku        = order.seller_sku
        const qty        = order.quantity
        const shipped_at = order.shipped_at
        const isBundle   = sku !== null && bundleSkuSet.has(sku)

        if (!isBundle && preCheckedAllocatedIds.has(order_uuid)) {
          accSummary.skipped++
          accSummary.errors.push({ order_id, reason: 'already_allocated' })
          addSkipReason('ALREADY_ALLOCATED', 'เคย allocate แล้ว (idempotent skip)', order_id, sku ?? undefined)
          allRunItems.push({ order_id, sku: sku || null, qty: qty || null, status: 'skipped', reason: 'ALREADY_ALLOCATED', missing_skus: [], allocated_skus: sku ? [sku] : [] })
          continue
        }
        if (!sku || sku.trim() === '') {
          accSummary.skipped++
          accSummary.errors.push({ order_id, reason: 'missing_seller_sku' })
          addSkipReason('MISSING_SKU', 'ไม่มี seller_sku ใน order', order_id)
          allRunItems.push({ order_id, sku: null, qty: qty || null, status: 'skipped', reason: 'MISSING_SKU', missing_skus: [], allocated_skus: [] })
          continue
        }
        if (qty == null || !Number.isFinite(qty) || qty <= 0) {
          accSummary.skipped++
          accSummary.errors.push({ order_id, reason: `invalid_quantity_${qty}` })
          addSkipReason('INVALID_QUANTITY', 'quantity ไม่ถูกต้อง (null/zero/negative)', order_id, sku, `qty=${qty}`)
          allRunItems.push({ order_id, sku, qty: qty || null, status: 'skipped', reason: 'INVALID_QUANTITY', missing_skus: [], allocated_skus: [] })
          continue
        }
        if (!shipped_at) {
          accSummary.skipped++
          accSummary.errors.push({ order_id, reason: 'missing_shipped_at' })
          addSkipReason('NOT_SHIPPED', 'ยังไม่ได้ shipped (ไม่มี shipped_at)', order_id, sku)
          allRunItems.push({ order_id, sku, qty: qty || null, status: 'skipped', reason: 'NOT_SHIPPED', missing_skus: [], allocated_skus: [] })
          continue
        }

        accSummary.eligible++

        try {
          const result: COGSApplyResult = isBundle
            ? await _allocateBundleOrderCOGS(
                supabase, method, user.id, order_uuid, sku, qty, shipped_at,
                bundleComponentsMap.get(sku) ?? []
              )
            : (await _allocateRPC(supabase, method, user.id, order_uuid, sku, qty, shipped_at))
              ? { status: 'success', allocatedSkus: [sku], missingSkus: [] }
              : { status: 'failed', allocatedSkus: [], missingSkus: [sku], reason: 'ALLOCATION_FAILED' }

          if (result.status === 'success') {
            accSummary.successful++
            allRunItems.push({ order_id, sku, qty, status: 'successful', reason: null, missing_skus: [], allocated_skus: result.allocatedSkus })
            console.log(`✓ ${order_id} (${order_uuid}): COGS applied (${sku} ×${qty})`)
          } else if (result.status === 'already_allocated') {
            accSummary.skipped++
            accSummary.errors.push({ order_id, reason: 'already_allocated' })
            addSkipReason('ALREADY_ALLOCATED', 'เคย allocate แล้ว (idempotent skip)', order_id, sku)
            allRunItems.push({ order_id, sku, qty, status: 'skipped', reason: 'ALREADY_ALLOCATED', missing_skus: [], allocated_skus: result.allocatedSkus })
            // Log first 5 bundle already_allocated so we can confirm they are fully done, not failed
            if (isBundle && accSummary.skipped <= 5) {
              console.log(`[BUNDLE SKIP] ${order_id} (${sku}): already_allocated — all components present in DB`)
            }
          } else if (result.status === 'partial') {
            accSummary.partial++
            accSummary.errors.push({ order_id, reason: result.reason || 'PARTIAL' })
            addSkipReason('PARTIAL_ALLOCATION', `bundle allocate ได้บางส่วน (missing: ${result.missingSkus.join(', ')})`, order_id, sku, result.reason)
            allRunItems.push({ order_id, sku, qty, status: 'partial', reason: result.reason || 'PARTIAL_ALLOCATION', missing_skus: result.missingSkus, allocated_skus: result.allocatedSkus })
            console.warn(`~ ${order_id} (${order_uuid}): Partial COGS`)
          } else {
            accSummary.failed++
            accSummary.errors.push({ order_id, reason: result.reason || 'applyCOGS_failed' })
            addSkipReason('ALLOCATION_FAILED', 'ไม่สามารถ allocate ได้ (SKU ไม่มี/stock ไม่พอ/bundle ไม่มี recipe)', order_id, sku, result.reason)
            allRunItems.push({ order_id, sku, qty, status: 'failed', reason: result.reason || 'ALLOCATION_FAILED', missing_skus: result.missingSkus, allocated_skus: result.allocatedSkus })
            console.error(`✗ ${order_id} (${order_uuid}): Failed (reason: ${result.reason})`)
          }
        } catch (orderErr) {
          accSummary.failed++
          const errorMsg = orderErr instanceof Error ? orderErr.message : 'unknown_error'
          accSummary.errors.push({ order_id, reason: errorMsg })
          addSkipReason('EXCEPTION', 'เกิด exception ระหว่าง allocate', order_id, sku, errorMsg)
          allRunItems.push({ order_id, sku: sku || null, qty: qty || null, status: 'failed', reason: 'EXCEPTION', missing_skus: sku ? [sku] : [], allocated_skus: [] })
          console.error(`✗ ${order_id}: Exception:`, orderErr)
        }
      }
    }

    // ── PASS 1: Bundle orders only ────────────────────────────────────────
    let pass1Complete = pass1AlreadyDone
    let pass1CurrentOffset = startPass1Offset

    if (!pass1Complete && bundleSkuArray.length > 0) {
      console.log(`[applyCOGSMTD] Pass 1 (bundles) start — ${bundleSkuArray.length} bundle SKUs, offset=${pass1CurrentOffset}`)
      while (true) {
        const elapsed = Date.now() - LOOP_START_MS
        if (elapsed > TIMEOUT_MS) {
          const msg = `Timeout in Pass 1 (bundles) after ${Math.round(elapsed / 1000)}s — offset=${pass1CurrentOffset}. Re-run to resume.`
          console.warn(`[applyCOGSMTD] ${msg}`)
          if (cogs_run_id) await completeCogsRunFailed(cogs_run_id, msg)
          return { success: false, needsResume: true, error: msg, data: null }
        }

        console.log(`[applyCOGSMTD] Pass 1 window: range(${pass1CurrentOffset}, ${pass1CurrentOffset + ORDERS_PER_CHUNK - 1})`)
        const { data: windowOrders, error: p1Error } = await supabase
          .from('sales_orders')
          .select('id, order_id, seller_sku, quantity, shipped_at, order_date, status_group')
          .not('shipped_at', 'is', null)
          .neq('status_group', 'ยกเลิกแล้ว')
          .gte('order_date', `${startDateISO}T00:00:00+07:00`)
          .lte('order_date', `${endDateISO}T23:59:59+07:00`)
          .in('seller_sku', bundleSkuArray)
          .order('order_date', { ascending: true })
          .order('order_id', { ascending: true })
          .range(pass1CurrentOffset, pass1CurrentOffset + ORDERS_PER_CHUNK - 1)

        if (p1Error) {
          const errMsg = `Pass 1 fetch error: ${p1Error.message}`
          console.error('[applyCOGSMTD]', errMsg)
          if (cogs_run_id) await completeCogsRunFailed(cogs_run_id, errMsg)
          return { success: false, error: errMsg, data: null }
        }

        const p1Orders = windowOrders ?? []
        console.log(`[applyCOGSMTD] Pass 1: fetched ${p1Orders.length} bundle orders`)
        if (p1Orders.length === 0) break

        await processOrderWindow(p1Orders, new Set())
        accSummary.total += p1Orders.length

        if (cogs_run_id) {
          await updateCogsRunProgress(cogs_run_id, {
            _phase: 'pass1',
            current_pass: 1,
            pass1_completed: false,
            pass1_offset_completed: pass1CurrentOffset + p1Orders.length,
            total_so_far: accSummary.total,
            successful_so_far: accSummary.successful,
            skipped_so_far: accSummary.skipped,
            failed_so_far: accSummary.failed,
            date_from: startDateISO,
            date_to: endDateISO,
            method,
          })
        }

        console.log(`[applyCOGSMTD] Pass 1 window done (offset=${pass1CurrentOffset}): count=${p1Orders.length} | successful=${accSummary.successful} skipped=${accSummary.skipped} failed=${accSummary.failed} partial=${accSummary.partial}`)
        pass1CurrentOffset += ORDERS_PER_CHUNK
        if (p1Orders.length < ORDERS_PER_CHUNK) break
      }
      pass1Complete = true
      console.log('[applyCOGSMTD] Pass 1 complete — all bundle orders processed first')
    } else if (bundleSkuArray.length === 0) {
      pass1Complete = true
      console.log('[applyCOGSMTD] Pass 1 skipped — no bundle SKUs registered')
    }

    // ── PASS 2: Non-bundle orders (direct SKU allocations) ────────────────
    let pass2CurrentOffset = startPass2Offset
    console.log(`[applyCOGSMTD] Pass 2 (non-bundle) start, offset=${pass2CurrentOffset}`)

    while (true) {
      const elapsed = Date.now() - LOOP_START_MS
      if (elapsed > TIMEOUT_MS) {
        const msg = `Timeout in Pass 2 after ${Math.round(elapsed / 1000)}s — ${accSummary.total} orders processed (offset=${pass2CurrentOffset}). Re-run to continue.`
        console.warn(`[applyCOGSMTD] ${msg}`)
        if (cogs_run_id) await completeCogsRunFailed(cogs_run_id, msg)
        return { success: false, needsResume: true, error: msg, data: null }
      }

      console.log(`[applyCOGSMTD] Pass 2 window: range(${pass2CurrentOffset}, ${pass2CurrentOffset + ORDERS_PER_CHUNK - 1})`)
      const { data: windowOrders, error: p2Error } = await supabase
        .from('sales_orders')
        .select('id, order_id, seller_sku, quantity, shipped_at, order_date, status_group')
        .not('shipped_at', 'is', null)
        .neq('status_group', 'ยกเลิกแล้ว')
        .gte('order_date', `${startDateISO}T00:00:00+07:00`)
        .lte('order_date', `${endDateISO}T23:59:59+07:00`)
        .order('order_date', { ascending: true })
        .order('order_id', { ascending: true })
        .range(pass2CurrentOffset, pass2CurrentOffset + ORDERS_PER_CHUNK - 1)

      if (p2Error) {
        const errMsg = `Pass 2 fetch error: ${p2Error.message}`
        console.error('[applyCOGSMTD]', errMsg)
        if (cogs_run_id) await completeCogsRunFailed(cogs_run_id, errMsg)
        return { success: false, error: errMsg, data: null }
      }

      const p2Orders = windowOrders ?? []
      console.log(`[applyCOGSMTD] Pass 2: fetched ${p2Orders.length} orders (offset=${pass2CurrentOffset})`)
      if (p2Orders.length === 0) break

      // Per-window pre-check for already-allocated non-bundle orders
      const nonBundleOrderIds = p2Orders
        .filter((o) => o.seller_sku && !bundleSkuSet.has(o.seller_sku))
        .map((o) => o.id)

      const allocatedOrderIds = new Set<string>()
      if (nonBundleOrderIds.length > 0) {
        const { data: existingAllocs, error: allocError } = await supabase
          .from('inventory_cogs_allocations')
          .select('order_id')
          .filter('order_id::text', 'in', `(${nonBundleOrderIds.join(',')})`)
          .eq('is_reversal', false)

        if (allocError) {
          const errMsg = `Pass 2 alloc-check error: ${allocError.message || 'Bad Request'}`
          console.error('[applyCOGSMTD]', errMsg)
          if (cogs_run_id) await completeCogsRunFailed(cogs_run_id, errMsg)
          return { success: false, error: errMsg, data: null }
        }

        for (const row of existingAllocs ?? []) {
          allocatedOrderIds.add(String(row.order_id))
        }
        console.log(`[applyCOGSMTD] Pass 2: ${allocatedOrderIds.size} of ${nonBundleOrderIds.length} non-bundle already allocated`)
      }

      await processOrderWindow(p2Orders, allocatedOrderIds)
      accSummary.total += p2Orders.length

      if (cogs_run_id) {
        await updateCogsRunProgress(cogs_run_id, {
          _phase: 'pass2',
          current_pass: 2,
          pass1_completed: true,
          pass1_offset_completed: pass1CurrentOffset,
          offset_completed: pass2CurrentOffset + p2Orders.length,
          total_so_far: accSummary.total,
          successful_so_far: accSummary.successful,
          skipped_so_far: accSummary.skipped,
          failed_so_far: accSummary.failed,
          date_from: startDateISO,
          date_to: endDateISO,
          method,
        })
      }

      console.log(`[applyCOGSMTD] Pass 2 window done (offset=${pass2CurrentOffset}): count=${p2Orders.length} | total=${accSummary.total} successful=${accSummary.successful} skipped=${accSummary.skipped} failed=${accSummary.failed}`)
      pass2CurrentOffset += ORDERS_PER_CHUNK
      if (p2Orders.length < ORDERS_PER_CHUNK) break
    } // end Pass 2

    // ──────────────────────────────────────────────────────────────────────
    // FINALIZE: save run log + complete the run
    // ──────────────────────────────────────────────────────────────────────
    const skipReasonsArray = Array.from(accSkipReasons.values()).sort((a, b) => b.count - a.count)
    console.log('[applyCOGSMTD] All windows processed. Final summary:', accSummary)

    // Save run items to DB
    if (run_id && allRunItems.length > 0) {
      console.log(`Saving ${allRunItems.length} run items...`)
      const BATCH_SIZE = 1000
      for (let i = 0; i < allRunItems.length; i += BATCH_SIZE) {
        const batch = allRunItems.slice(i, i + BATCH_SIZE)
        const { error: insertError } = await supabase
          .from('inventory_cogs_apply_run_items')
          .insert(batch.map((item) => ({
            run_id,
            order_id: item.order_id,
            sku: item.sku,
            qty: item.qty,
            status: item.status,
            reason: item.reason,
            missing_skus: item.missing_skus,
            allocated_skus: item.allocated_skus,
          })))
        if (insertError) {
          console.error(`Failed to insert run items batch ${i / BATCH_SIZE + 1}:`, insertError)
        } else {
          console.log(`Inserted run items batch ${i / BATCH_SIZE + 1} (${batch.length} items)`)
        }
      }
    }

    // Update run summary
    if (run_id) {
      console.log(`[applyCOGSMTD] Final: total=${accSummary.total} eligible=${accSummary.eligible} successful=${accSummary.successful} skipped=${accSummary.skipped} failed=${accSummary.failed} partial=${accSummary.partial}`)
      const { error: updateError } = await supabase
        .from('inventory_cogs_apply_runs')
        .update({
          total: accSummary.total,
          eligible: accSummary.eligible,
          successful: accSummary.successful,
          skipped: accSummary.skipped,
          failed: accSummary.failed,
          partial: accSummary.partial,
        })
        .eq('id', run_id)
      if (updateError) console.error('Failed to update run counts:', updateError)
    }

    revalidatePath('/inventory')
    revalidatePath('/sales')
    revalidatePath('/daily-pl')

    if (cogs_run_id) {
      await completeCogsRunSuccess(cogs_run_id, {
        total: accSummary.total,
        eligible: accSummary.eligible,
        successful: accSummary.successful,
        skipped: accSummary.skipped,
        failed: accSummary.failed,
        partial: accSummary.partial,
        skip_reasons: skipReasonsArray,
        date_from: startDateISO,
        date_to: endDateISO,
        method,
      })
      await createNotificationForRun(cogs_run_id, {
        total: accSummary.total,
        successful: accSummary.successful,
        skipped: accSummary.skipped,
        failed: accSummary.failed,
      })
    }

    return {
      success: true,
      data: {
        ...accSummary,
        skip_reasons: skipReasonsArray,
        run_id,
        cogs_run_id,
        needsResume: false,
        cogsRunId: cogs_run_id,
        processedCount: accSummary.eligible,
      },
    }
  } catch (error) {
    console.error('Unexpected error in applyCOGSMTD:', error)

    // Mark cogs_allocation_run as failed if it was created
    if (typeof cogs_run_id === 'string' && cogs_run_id) {
      await completeCogsRunFailed(
        cogs_run_id,
        error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด'
      )
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      data: null,
    }
  }
}

// ============================================
// resumeAllocateMTD — continue a chunked DATE_RANGE run
// ============================================

/**
 * Resume a chunked Allocate MTD run that returned needsResume=true.
 * Re-queries unallocated orders for the same date range and processes the
 * next ORDERS_PER_CHUNK. Idempotency guarantees already-allocated orders
 * are skipped without extra DB work (non-bundle: pre-check; bundle: per-component RPC).
 *
 * Does NOT create a new cogs_allocation_runs row.
 * When all orders are processed, marks the existing run as success.
 */
export async function resumeAllocateMTD(params: {
  cogsRunId: string
  startDate: string
  endDate: string
  method?: CostingMethod
}): Promise<{
  success: boolean
  error?: string
  data: null | {
    total: number
    eligible: number
    successful: number
    skipped: number
    failed: number
    partial: number
    needsResume: boolean
    cogsRunId: string
    startDate: string
    endDate: string
    method: string
    run_id: null
    cogs_run_id: string
    skip_reasons: object[]
  }
}> {
  const method = params.method || 'FIFO'
  const { cogsRunId, startDate: startDateISO, endDate: endDateISO } = params

  try {
    const supabase = createClient()

    // Auth + admin check
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้', data: null }

    const { data: roleData, error: roleError } = await supabase
      .from('user_roles').select('role').eq('user_id', user.id).single()
    if (roleError || roleData?.role !== 'admin')
      return { success: false, error: 'ไม่มีสิทธิ์เข้าถึงฟังก์ชันนี้ (Admin only)', data: null }

    // Verify the run exists and is still running (team RLS enforced)
    const { data: runRow } = await supabase
      .from('cogs_allocation_runs')
      .select('id, status')
      .eq('id', cogsRunId)
      .single()

    if (!runRow) return { success: false, error: `ไม่พบ COGS run: ${cogsRunId}`, data: null }
    if (runRow.status !== 'running')
      return { success: false, error: `COGS run ${cogsRunId} is already ${runRow.status}`, data: null }

    // Re-fetch orders for the date range (same query as applyCOGSMTD)
    const PAGE_SIZE = 1000
    let allOrders: any[] = []
    let currentPage = 0
    let hasMore = true
    while (hasMore) {
      const from = currentPage * PAGE_SIZE
      const { data: pageOrders, error: ordersError } = await supabase
        .from('sales_orders')
        .select('id, order_id, seller_sku, quantity, shipped_at, order_date, status_group')
        .not('shipped_at', 'is', null)
        .neq('status_group', 'ยกเลิกแล้ว')
        .gte('order_date', `${startDateISO}T00:00:00+07:00`)
        .lte('order_date', `${endDateISO}T23:59:59+07:00`)
        .order('order_date', { ascending: true })
        .order('order_id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)
      if (ordersError) {
        await completeCogsRunFailed(cogsRunId, ordersError.message)
        return { success: false, error: ordersError.message, data: null }
      }
      if (pageOrders?.length) allOrders = allOrders.concat(pageOrders)
      hasMore = pageOrders?.length === PAGE_SIZE
      currentPage++
      if (currentPage >= 100) { hasMore = false }
    }

    const orders = allOrders
    if (orders.length === 0) {
      await completeCogsRunSuccess(cogsRunId, { total: 0, eligible: 0, successful: 0, skipped: 0, failed: 0, partial: 0, skip_reasons: [] })
      await createNotificationForRun(cogsRunId, { total: 0, successful: 0, skipped: 0, failed: 0 })
      return { success: true, data: { total: 0, eligible: 0, successful: 0, skipped: 0, failed: 0, partial: 0, needsResume: false, cogsRunId, startDate: startDateISO, endDate: endDateISO, method, run_id: null, cogs_run_id: cogsRunId, skip_reasons: [] } }
    }

    // Pre-fetch bundle context (same as applyCOGSMTD)
    const { data: bundleItemsData } = await supabase.from('inventory_items').select('sku_internal').eq('is_bundle', true)
    const bundleSkuSet = new Set<string>((bundleItemsData || []).map((i) => i.sku_internal))

    const bundleComponentsMap = new Map<string, Array<{ component_sku: string; quantity: number }>>()
    if (bundleSkuSet.size > 0) {
      const { data: allComponents } = await supabase
        .from('inventory_bundle_components').select('bundle_sku, component_sku, quantity').in('bundle_sku', Array.from(bundleSkuSet))
      for (const row of allComponents ?? []) {
        if (!bundleComponentsMap.has(row.bundle_sku)) bundleComponentsMap.set(row.bundle_sku, [])
        bundleComponentsMap.get(row.bundle_sku)!.push({ component_sku: row.component_sku, quantity: row.quantity })
      }
    }

    // Bulk alloc pre-check for non-bundle orders
    const nonBundleOrderIds = orders.filter((o) => o.seller_sku && !bundleSkuSet.has(o.seller_sku)).map((o) => o.id)
    const allocatedOrderIds = new Set<string>()
    if (nonBundleOrderIds.length > 0) {
      const CHUNK_SIZE = 200
      for (let i = 0; i < nonBundleOrderIds.length; i += CHUNK_SIZE) {
        const chunk = nonBundleOrderIds.slice(i, i + CHUNK_SIZE)
        const { data: chunkAllocs, error: allocError } = await supabase
          .from('inventory_cogs_allocations').select('order_id')
          .filter('order_id::text', 'in', `(${chunk.join(',')})`)
          .eq('is_reversal', false)
        if (allocError) {
          await completeCogsRunFailed(cogsRunId, allocError.message)
          return { success: false, error: allocError.message, data: null }
        }
        for (const row of chunkAllocs ?? []) allocatedOrderIds.add(String(row.order_id))
      }
    }

    // Same summary + loop structure as applyCOGSMTD
    interface SkipReason { code: string; label: string; count: number; samples: Array<{ order_id: string; sku?: string; detail?: string }> }
    const skipReasons = new Map<string, SkipReason>()
    const addSkipReason = (code: string, label: string, order_id: string, sku?: string, detail?: string) => {
      if (!skipReasons.has(code)) skipReasons.set(code, { code, label, count: 0, samples: [] })
      const entry = skipReasons.get(code)!
      entry.count += 1
      if (entry.samples.length < 20) entry.samples.push({ order_id, sku, detail })
    }

    const summary = { total: orders.length, eligible: 0, successful: 0, skipped: 0, failed: 0, partial: 0, errors: [] as Array<{ order_id: string; reason: string }> }
    let eligibleProcessedCount = 0
    let needsResume = false

    for (const order of orders) {
      const order_uuid = order.id
      const order_id = order.order_id
      const sku = order.seller_sku
      const qty = order.quantity
      const shipped_at = order.shipped_at
      const isBundle = sku && bundleSkuSet.has(sku)

      if (!isBundle && allocatedOrderIds.has(order_uuid)) {
        summary.skipped++
        summary.errors.push({ order_id, reason: 'already_allocated' })
        addSkipReason('ALREADY_ALLOCATED', 'เคย allocate แล้ว (idempotent skip)', order_id, sku)
        continue
      }
      if (!sku || sku.trim() === '') { summary.skipped++; addSkipReason('MISSING_SKU', 'ไม่มี seller_sku', order_id); continue }
      if (qty == null || !Number.isFinite(qty) || qty <= 0) { summary.skipped++; addSkipReason('INVALID_QUANTITY', 'quantity ไม่ถูกต้อง', order_id, sku, `qty=${qty}`); continue }
      if (!shipped_at) { summary.skipped++; addSkipReason('NOT_SHIPPED', 'ไม่มี shipped_at', order_id, sku); continue }

      if (eligibleProcessedCount >= ORDERS_PER_CHUNK) { needsResume = true; break }

      summary.eligible++
      eligibleProcessedCount++

      try {
        const result: COGSApplyResult = isBundle
          ? await _allocateBundleOrderCOGS(supabase, method, user.id, order_uuid, sku, qty, shipped_at, bundleComponentsMap.get(sku) ?? [])
          : (await _allocateRPC(supabase, method, user.id, order_uuid, sku, qty, shipped_at))
            ? { status: 'success', allocatedSkus: [sku], missingSkus: [] }
            : { status: 'failed', allocatedSkus: [], missingSkus: [sku], reason: 'ALLOCATION_FAILED' }

        if (result.status === 'success') {
          summary.successful++
        } else if (result.status === 'already_allocated') {
          summary.skipped++; addSkipReason('ALREADY_ALLOCATED', 'เคย allocate แล้ว', order_id, sku)
        } else if (result.status === 'partial') {
          summary.partial++; addSkipReason('PARTIAL_ALLOCATION', `bundle partial (missing: ${result.missingSkus.join(',')})`, order_id, sku, result.reason)
        } else {
          summary.failed++; addSkipReason('ALLOCATION_FAILED', 'allocate ไม่ได้', order_id, sku, result.reason)
        }
      } catch (err) {
        summary.failed++
        addSkipReason('EXCEPTION', 'exception ระหว่าง allocate', order_id, sku, err instanceof Error ? err.message : 'unknown')
      }
    }

    const skipReasonsArray = Array.from(skipReasons.values()).sort((a, b) => b.count - a.count)
    console.log(`[resumeAllocateMTD] chunk complete: ${eligibleProcessedCount} eligible, needsResume=${needsResume}`)

    if (needsResume) {
      await updateCogsRunProgress(cogsRunId, {
        _phase: 'in_progress',
        chunk_successful: summary.successful,
        chunk_skipped: summary.skipped,
        chunk_failed: summary.failed,
        total_orders_in_range: summary.total,
        date_from: startDateISO,
        date_to: endDateISO,
      })
      return { success: true, data: { ...summary, skip_reasons: skipReasonsArray, needsResume: true, cogsRunId, startDate: startDateISO, endDate: endDateISO, method, run_id: null, cogs_run_id: cogsRunId } }
    }

    // Final chunk — complete the run
    revalidatePath('/inventory')
    revalidatePath('/sales')
    revalidatePath('/daily-pl')

    const notifSummary = { total: summary.total, eligible: summary.eligible, successful: summary.successful, skipped: summary.skipped, failed: summary.failed, partial: summary.partial, skip_reasons: skipReasonsArray, date_from: startDateISO, date_to: endDateISO, method }
    await completeCogsRunSuccess(cogsRunId, notifSummary)
    await createNotificationForRun(cogsRunId, { total: summary.total, successful: summary.successful, skipped: summary.skipped, failed: summary.failed })

    return { success: true, data: { ...summary, skip_reasons: skipReasonsArray, needsResume: false, cogsRunId, startDate: startDateISO, endDate: endDateISO, method, run_id: null, cogs_run_id: cogsRunId } }

  } catch (error) {
    console.error('Unexpected error in resumeAllocateMTD:', error)
    if (params.cogsRunId) {
      await completeCogsRunFailed(params.cogsRunId, error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด')
    }
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด', data: null }
  }
}

// ============================================
// COGS Apply Run Log (History & Export)
// ============================================

/**
 * Get COGS apply run history
 *
 * @param limit - Number of runs to fetch (default: 20)
 * @returns List of recent runs
 */
export async function getCogsApplyRuns(
  limit = 20
): Promise<{
  success: boolean
  error?: string
  data: Array<{
    id: string
    start_date: string
    end_date: string
    method: string
    total: number
    eligible: number
    successful: number
    skipped: number
    failed: number
    partial: number
    created_at: string
  }>
}> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้', data: [] }
    }

    // Fetch runs (RLS will filter to user's runs)
    const { data: runs, error: runsError } = await supabase
      .from('inventory_cogs_apply_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (runsError) {
      console.error('Error fetching runs:', runsError)
      return { success: false, error: runsError.message, data: [] }
    }

    return { success: true, data: runs || [] }
  } catch (error) {
    console.error('Unexpected error in getCogsApplyRuns:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      data: [],
    }
  }
}

/**
 * Get COGS apply run details (items)
 *
 * @param run_id - Run ID
 * @param filters - Optional filters (status, order_id search)
 * @returns Run items
 */
export async function getCogsApplyRunDetails(
  run_id: string,
  filters?: {
    status?: 'successful' | 'skipped' | 'failed' | 'partial'
    orderIdSearch?: string
  }
): Promise<{
  success: boolean
  error?: string
  data: Array<{
    id: string
    order_id: string
    sku: string | null
    qty: number | null
    status: string
    reason: string | null
    missing_skus: string[]
    allocated_skus: string[]
    created_at: string
  }>
}> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้', data: [] }
    }

    // Build query
    let query = supabase
      .from('inventory_cogs_apply_run_items')
      .select('*')
      .eq('run_id', run_id)

    // Apply filters
    if (filters?.status) {
      query = query.eq('status', filters.status)
    }

    if (filters?.orderIdSearch) {
      query = query.ilike('order_id', `%${filters.orderIdSearch}%`)
    }

    // Order by status, then order_id
    query = query.order('status').order('order_id')

    const { data: items, error: itemsError } = await query

    if (itemsError) {
      console.error('Error fetching run items:', itemsError)
      return { success: false, error: itemsError.message, data: [] }
    }

    return { success: true, data: items || [] }
  } catch (error) {
    console.error('Unexpected error in getCogsApplyRunDetails:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      data: [],
    }
  }
}

/**
 * Export COGS apply run items as CSV
 *
 * @param run_id - Run ID
 * @param filters - Optional filters (status, order_id search)
 * @returns CSV content and filename
 */
export async function exportCogsApplyRunCSV(
  run_id: string,
  filters?: {
    status?: 'successful' | 'skipped' | 'failed' | 'partial'
    orderIdSearch?: string
  }
): Promise<{
  success: boolean
  error?: string
  csv?: string
  filename?: string
}> {
  try {
    // Get run details
    const runResult = await getCogsApplyRunDetails(run_id, filters)

    if (!runResult.success) {
      return { success: false, error: runResult.error }
    }

    const items = runResult.data

    if (items.length === 0) {
      return { success: false, error: 'ไม่มีข้อมูลสำหรับ export' }
    }

    // Build CSV with UTF-8 BOM for Excel Thai support
    const BOM = '\uFEFF'
    const headers = ['order_id', 'sku', 'qty', 'status', 'reason', 'missing_skus', 'allocated_skus', 'created_at']
    const rows = items.map((item) => [
      item.order_id,
      item.sku || '',
      item.qty?.toString() || '',
      item.status,
      item.reason || '',
      (item.missing_skus || []).join(';'),
      (item.allocated_skus || []).join(';'),
      item.created_at,
    ])

    // Format CSV
    const csvLines = [
      headers.join(','),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      ),
    ]

    const csv = BOM + csvLines.join('\n')

    // Generate filename with timestamp
    const now = new Date()
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const statusSuffix = filters?.status ? `-${filters.status}` : ''
    const filename = `cogs-run-${run_id.slice(0, 8)}${statusSuffix}-${timestamp}.csv`

    return { success: true, csv, filename }
  } catch (error) {
    console.error('Unexpected error in exportCogsApplyRunCSV:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

// ============================================
// On Hand Inventory
// ============================================

/**
 * Get inventory availability maps (on_hand, reserved, available)
 *
 * BUSINESS RULES:
 * - On Hand: Sum(qty_remaining) from inventory_receipt_layers (physical stock)
 * - Reserved: Sum(qty) from sales_orders WHERE shipped_at IS NULL AND status_group != 'ยกเลิกแล้ว'
 *   - Bundles are exploded into component SKUs
 * - Available: On Hand - Reserved
 *
 * @returns Object with on_hand_map, reserved_map, available_map
 */
export async function getInventoryAvailabilityMaps(): Promise<{
  success: boolean
  error?: string
  data: {
    on_hand_map: Record<string, number>
    reserved_map: Record<string, number>
    available_map: Record<string, number>
  }
}> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return {
        success: false,
        error: 'ไม่พบข้อมูลผู้ใช้',
        data: { on_hand_map: {}, reserved_map: {}, available_map: {} },
      }
    }

    // ============================================
    // 1. GET ON HAND (existing logic)
    // ============================================
    const onHandResult = await getInventoryOnHand()
    if (!onHandResult.success) {
      return {
        success: false,
        error: onHandResult.error,
        data: { on_hand_map: {}, reserved_map: {}, available_map: {} },
      }
    }

    const on_hand_map = onHandResult.data

    // ============================================
    // 2. GET RESERVED (from sales_orders)
    // ============================================
    // Query: unshipped, non-cancelled orders
    const { data: orders, error: ordersError } = await supabase
      .from('sales_orders')
      .select('seller_sku, quantity')
      .is('shipped_at', null) // Only unshipped (reserved)
      .neq('status_group', 'ยกเลิกแล้ว') // Exclude cancelled

    if (ordersError) {
      console.error('Error fetching reserved orders:', ordersError)
      return {
        success: false,
        error: ordersError.message,
        data: { on_hand_map, reserved_map: {}, available_map: {} },
      }
    }

    // Get all inventory items (to check if bundle)
    const { data: items, error: itemsError } = await supabase
      .from('inventory_items')
      .select('sku_internal, is_bundle')

    if (itemsError) {
      console.error('Error fetching inventory items:', itemsError)
      return {
        success: false,
        error: itemsError.message,
        data: { on_hand_map, reserved_map: {}, available_map: {} },
      }
    }

    // Create lookup map for bundle detection
    const itemsMap = new Map<string, { is_bundle: boolean }>()
    for (const item of items || []) {
      itemsMap.set(item.sku_internal, { is_bundle: item.is_bundle })
    }

    // Get all bundle components
    const { data: bundleComponents, error: bundleError } = await supabase
      .from('inventory_bundle_components')
      .select('bundle_sku, component_sku, quantity')

    if (bundleError) {
      console.error('Error fetching bundle components:', bundleError)
      return {
        success: false,
        error: bundleError.message,
        data: { on_hand_map, reserved_map: {}, available_map: {} },
      }
    }

    // Create bundle lookup map
    const bundleMap = new Map<string, Array<{ component_sku: string; quantity: number }>>()
    for (const bc of bundleComponents || []) {
      if (!bundleMap.has(bc.bundle_sku)) {
        bundleMap.set(bc.bundle_sku, [])
      }
      bundleMap.get(bc.bundle_sku)!.push({
        component_sku: bc.component_sku,
        quantity: bc.quantity,
      })
    }

    // Aggregate reserved quantities
    const reserved_map: Record<string, number> = {}

    for (const order of orders || []) {
      const sku = order.seller_sku
      const qty = order.quantity || 0

      if (!sku || sku.trim() === '' || qty <= 0) {
        continue // Skip invalid orders
      }

      // Check if SKU is a bundle
      const item = itemsMap.get(sku)
      if (!item) {
        // SKU not in master list, treat as regular SKU
        reserved_map[sku] = (reserved_map[sku] || 0) + qty
        continue
      }

      if (item.is_bundle) {
        // Explode bundle into components
        const components = bundleMap.get(sku) || []
        for (const component of components) {
          const component_qty = component.quantity * qty
          reserved_map[component.component_sku] =
            (reserved_map[component.component_sku] || 0) + component_qty
        }
      } else {
        // Regular SKU
        reserved_map[sku] = (reserved_map[sku] || 0) + qty
      }
    }

    // ============================================
    // VERIFICATION LOG
    // ============================================
    const unshippedCount = orders?.length || 0
    const bundleOrdersCount = orders?.filter(o => {
      const item = itemsMap.get(o.seller_sku || '')
      return item?.is_bundle
    }).length || 0

    console.log(`[Inventory Availability] Reservation Verification:`, {
      total_unshipped_orders: unshippedCount,
      bundle_orders: bundleOrdersCount,
      reserved_skus: Object.keys(reserved_map).length,
      top_reserved: Object.entries(reserved_map)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([sku, qty]) => ({ sku, reserved_qty: qty })),
    })

    // ============================================
    // 3. CALCULATE AVAILABLE = ON HAND - RESERVED
    // ============================================
    const available_map: Record<string, number> = {}

    // Get all unique SKUs from both maps
    const allSkus = new Set([...Object.keys(on_hand_map), ...Object.keys(reserved_map)])

    allSkus.forEach((sku) => {
      const onHand = on_hand_map[sku] || 0
      const reserved = reserved_map[sku] || 0
      available_map[sku] = onHand - reserved
    })

    return {
      success: true,
      data: {
        on_hand_map,
        reserved_map,
        available_map,
      },
    }
  } catch (error) {
    console.error('Unexpected error in getInventoryAvailabilityMaps:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      data: { on_hand_map: {}, reserved_map: {}, available_map: {} },
    }
  }
}

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

// ============================================
// Safe SKU Rename
// ============================================

/**
 * Check if SKU can be safely renamed
 *
 * A SKU can be renamed ONLY if it has NOT been used in any inventory operations:
 * - No receipt layers (stock in)
 * - No COGS allocations (sales)
 * - No bundle component usage (if component)
 * - No sales orders (source data)
 *
 * @param sku_internal - SKU to check
 * @returns Eligibility result with reasons
 */
export async function checkSkuRenameEligibility(
  sku_internal: string
): Promise<{
  success: boolean
  error?: string
  data: {
    eligible: boolean
    reasons: string[]
    blockers: Array<{
      category: string
      count: number
      message: string
    }>
  }
}> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return {
        success: false,
        error: 'ไม่พบข้อมูลผู้ใช้',
        data: { eligible: false, reasons: ['ไม่ได้ล็อกอิน'], blockers: [] },
      }
    }

    // Check if SKU exists
    const { data: item, error: itemError } = await supabase
      .from('inventory_items')
      .select('sku_internal, product_name, is_bundle')
      .eq('sku_internal', sku_internal)
      .single()

    if (itemError || !item) {
      return {
        success: false,
        error: 'SKU not found',
        data: { eligible: false, reasons: ['SKU ไม่มีในระบบ'], blockers: [] },
      }
    }

    const blockers: Array<{ category: string; count: number; message: string }> = []

    // ============================================
    // CHECK 1: Receipt Layers
    // ============================================
    const { data: layers, error: layersError } = await supabase
      .from('inventory_receipt_layers')
      .select('id')
      .eq('sku_internal', sku_internal)
      .limit(1)

    if (layersError) {
      console.error('Error checking receipt layers:', layersError)
    } else if (layers && layers.length > 0) {
      const { count } = await supabase
        .from('inventory_receipt_layers')
        .select('*', { count: 'exact', head: true })
        .eq('sku_internal', sku_internal)

      blockers.push({
        category: 'receipt_layers',
        count: count || 0,
        message: `มี Receipt Layers (Stock In) จำนวน ${count} รายการ`,
      })
    }

    // ============================================
    // CHECK 2: COGS Allocations
    // ============================================
    const { data: allocations, error: allocError } = await supabase
      .from('inventory_cogs_allocations')
      .select('id')
      .eq('sku_internal', sku_internal)
      .limit(1)

    if (allocError) {
      console.error('Error checking COGS allocations:', allocError)
    } else if (allocations && allocations.length > 0) {
      const { count } = await supabase
        .from('inventory_cogs_allocations')
        .select('*', { count: 'exact', head: true })
        .eq('sku_internal', sku_internal)

      blockers.push({
        category: 'cogs_allocations',
        count: count || 0,
        message: `มี COGS Allocations จำนวน ${count} รายการ`,
      })
    }

    // ============================================
    // CHECK 3: Bundle Components (as bundle_sku)
    // ============================================
    if (item.is_bundle) {
      const { data: bundleComps, error: bundleError } = await supabase
        .from('inventory_bundle_components')
        .select('id')
        .eq('bundle_sku', sku_internal)
        .limit(1)

      if (bundleError) {
        console.error('Error checking bundle components:', bundleError)
      } else if (bundleComps && bundleComps.length > 0) {
        const { count } = await supabase
          .from('inventory_bundle_components')
          .select('*', { count: 'exact', head: true })
          .eq('bundle_sku', sku_internal)

        blockers.push({
          category: 'bundle_recipe',
          count: count || 0,
          message: `มี Bundle Recipe จำนวน ${count} components (ลบ recipe ก่อนถ้าต้องการ rename)`,
        })
      }
    }

    // ============================================
    // CHECK 4: Bundle Components (as component_sku)
    // ============================================
    const { data: asComponent, error: compError } = await supabase
      .from('inventory_bundle_components')
      .select('bundle_sku')
      .eq('component_sku', sku_internal)

    if (compError) {
      console.error('Error checking as component:', compError)
    } else if (asComponent && asComponent.length > 0) {
      const bundleSkus = asComponent.map((c) => c.bundle_sku).join(', ')
      blockers.push({
        category: 'used_as_component',
        count: asComponent.length,
        message: `ถูกใช้เป็น component ใน bundles: ${bundleSkus}`,
      })
    }

    // ============================================
    // CHECK 5: Sales Orders
    // ============================================
    const { data: orders, error: ordersError } = await supabase
      .from('sales_orders')
      .select('order_id')
      .eq('seller_sku', sku_internal)
      .limit(1)

    if (ordersError) {
      console.error('Error checking sales orders:', ordersError)
    } else if (orders && orders.length > 0) {
      const { count } = await supabase
        .from('sales_orders')
        .select('*', { count: 'exact', head: true })
        .eq('seller_sku', sku_internal)

      blockers.push({
        category: 'sales_orders',
        count: count || 0,
        message: `มี Sales Orders จำนวน ${count} รายการที่ใช้ SKU นี้`,
      })
    }

    // ============================================
    // DECISION
    // ============================================
    const eligible = blockers.length === 0

    const reasons: string[] = []
    if (eligible) {
      reasons.push('✓ ไม่มี Receipt Layers')
      reasons.push('✓ ไม่มี COGS Allocations')
      reasons.push('✓ ไม่มี Bundle Recipe (หรือไม่ถูกใช้เป็น component)')
      reasons.push('✓ ไม่มี Sales Orders')
      reasons.push('SKU นี้ปลอดภัยที่จะ rename')
    } else {
      reasons.push('❌ SKU นี้เคยถูกใช้งานแล้ว ไม่สามารถ rename ได้:')
      for (const blocker of blockers) {
        reasons.push(`  - ${blocker.message}`)
      }
    }

    return {
      success: true,
      data: {
        eligible,
        reasons,
        blockers,
      },
    }
  } catch (error) {
    console.error('Unexpected error in checkSkuRenameEligibility:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      data: { eligible: false, reasons: ['เกิดข้อผิดพลาดในระบบ'], blockers: [] },
    }
  }
}

/**
 * Safely rename a SKU (main or bundle)
 *
 * SAFETY: Only renames if SKU has NOT been used (checked via checkSkuRenameEligibility)
 *
 * @param old_sku - Current SKU
 * @param new_sku - New SKU name
 * @returns Success result with details
 */
export async function renameInventorySku(
  old_sku: string,
  new_sku: string
): Promise<{
  success: boolean
  error?: string
  data?: {
    updated_tables: string[]
    row_counts: Record<string, number>
  }
}> {
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
    // VALIDATION
    // ============================================

    // Trim and validate
    const oldSkuTrimmed = old_sku.trim().toUpperCase()
    const newSkuTrimmed = new_sku.trim().toUpperCase()

    if (!oldSkuTrimmed || !newSkuTrimmed) {
      return { success: false, error: 'SKU ต้องไม่เป็นค่าว่าง' }
    }

    if (oldSkuTrimmed === newSkuTrimmed) {
      return { success: false, error: 'SKU เดิมและใหม่ต้องไม่เหมือนกัน' }
    }

    // Check if old SKU exists
    const { data: oldItem, error: oldError } = await supabase
      .from('inventory_items')
      .select('sku_internal, is_bundle')
      .eq('sku_internal', oldSkuTrimmed)
      .single()

    if (oldError || !oldItem) {
      return { success: false, error: `SKU เดิม "${oldSkuTrimmed}" ไม่พบในระบบ` }
    }

    // Check if new SKU already exists
    const { data: existingNew, error: newError } = await supabase
      .from('inventory_items')
      .select('sku_internal')
      .eq('sku_internal', newSkuTrimmed)
      .single()

    if (existingNew) {
      return { success: false, error: `SKU ใหม่ "${newSkuTrimmed}" มีอยู่ในระบบแล้ว` }
    }

    // ============================================
    // ELIGIBILITY CHECK
    // ============================================
    const eligibilityResult = await checkSkuRenameEligibility(oldSkuTrimmed)

    if (!eligibilityResult.success) {
      return {
        success: false,
        error: 'ไม่สามารถตรวจสอบสิทธิ์ในการ rename ได้: ' + eligibilityResult.error,
      }
    }

    if (!eligibilityResult.data.eligible) {
      const reasons = eligibilityResult.data.reasons.join('\n')
      return {
        success: false,
        error: `ไม่สามารถ rename SKU นี้ได้เพราะเคยถูกใช้งานแล้ว:\n\n${reasons}`,
      }
    }

    // ============================================
    // RENAME (Transaction)
    // ============================================
    const row_counts: Record<string, number> = {}
    const updated_tables: string[] = []

    // 1. Update inventory_items.sku_internal
    const { error: updateItemError } = await supabase
      .from('inventory_items')
      .update({ sku_internal: newSkuTrimmed, updated_at: new Date().toISOString() })
      .eq('sku_internal', oldSkuTrimmed)

    if (updateItemError) {
      console.error('Error updating inventory_items:', updateItemError)
      return { success: false, error: 'ไม่สามารถอัปเดต inventory_items: ' + updateItemError.message }
    }

    updated_tables.push('inventory_items')
    row_counts['inventory_items'] = 1

    // 2. Update inventory_bundle_components (bundle_sku)
    if (oldItem.is_bundle) {
      const { error: updateBundleError, count: bundleCount } = await supabase
        .from('inventory_bundle_components')
        .update({ bundle_sku: newSkuTrimmed, updated_at: new Date().toISOString() })
        .eq('bundle_sku', oldSkuTrimmed)

      if (updateBundleError) {
        console.error('Error updating bundle_sku:', updateBundleError)
        // Non-fatal: continue
      } else if (bundleCount && bundleCount > 0) {
        updated_tables.push('inventory_bundle_components (bundle_sku)')
        row_counts['bundle_components_bundle'] = bundleCount
      }
    }

    // 3. Update inventory_bundle_components (component_sku)
    const { error: updateCompError, count: compCount } = await supabase
      .from('inventory_bundle_components')
      .update({ component_sku: newSkuTrimmed, updated_at: new Date().toISOString() })
      .eq('component_sku', oldSkuTrimmed)

    if (updateCompError) {
      console.error('Error updating component_sku:', updateCompError)
      // Non-fatal: continue
    } else if (compCount && compCount > 0) {
      updated_tables.push('inventory_bundle_components (component_sku)')
      row_counts['bundle_components_component'] = compCount
    }

    console.log(`✓ SKU renamed: ${oldSkuTrimmed} -> ${newSkuTrimmed}`)
    console.log('  Updated tables:', updated_tables)
    console.log('  Row counts:', row_counts)

    revalidatePath('/inventory')

    return {
      success: true,
      data: {
        updated_tables,
        row_counts,
      },
    }
  } catch (error) {
    console.error('Unexpected error in renameInventorySku:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

// ============================================
// COGS Coverage Checker (Allocation Audit)
// ============================================

export interface COGSCoverageStats {
  expected_lines: number
  expected_qty: number
  allocated_lines: number
  allocated_qty: number
  missing_lines: number
  coverage_percent: number
  duplicate_count: number
}

export interface MissingAllocation {
  order_id: string
  seller_sku: string
  quantity: number
  shipped_at: string
  status_group: string | null
}

/**
 * Get COGS coverage statistics for a date range
 * Compares expected allocations (from sales_orders) vs actual allocations
 *
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @returns Coverage statistics
 */
export async function getCOGSCoverageStats(
  startDate: string,
  endDate: string
): Promise<{ success: boolean; error?: string; data: COGSCoverageStats | null }> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้', data: null }
    }

    // ============================================
    // 1. Get expected lines (from sales_orders)
    // ============================================
    const { data: expectedOrders, error: expectedError } = await supabase
      .from('sales_orders')
      .select('order_id, seller_sku, quantity')
      .not('shipped_at', 'is', null)
      .neq('status_group', 'ยกเลิกแล้ว')
      .gte('shipped_at', `${startDate}T00:00:00+07:00`)
      .lte('shipped_at', `${endDate}T23:59:59+07:00`)

    if (expectedError) {
      console.error('Error fetching expected orders:', expectedError)
      return { success: false, error: expectedError.message, data: null }
    }

    const expected_lines = expectedOrders?.length || 0
    const expected_qty = expectedOrders?.reduce((sum, o) => sum + (o.quantity || 0), 0) || 0

    // ============================================
    // 2. Get allocated lines (from inventory_cogs_allocations)
    // ============================================
    const { data: allocations, error: allocationsError } = await supabase
      .from('inventory_cogs_allocations')
      .select('order_id, sku_internal, qty')
      .eq('is_reversal', false)
      .gte('shipped_at', `${startDate}T00:00:00+07:00`)
      .lte('shipped_at', `${endDate}T23:59:59+07:00`)

    if (allocationsError) {
      console.error('Error fetching allocations:', allocationsError)
      return { success: false, error: allocationsError.message, data: null }
    }

    // Count unique (order_id, sku) pairs
    const allocatedPairs = new Set<string>()
    let allocated_qty = 0

    if (allocations && allocations.length > 0) {
      for (const alloc of allocations) {
        const pairKey = `${alloc.order_id}|${alloc.sku_internal}`
        allocatedPairs.add(pairKey)
        allocated_qty += alloc.qty || 0
      }
    }

    const allocated_lines = allocatedPairs.size

    // ============================================
    // 3. Calculate missing lines
    // ============================================
    const missing_lines = expected_lines - allocated_lines

    // ============================================
    // 4. Calculate coverage percentage
    // ============================================
    const coverage_percent = expected_lines > 0 ? (allocated_lines / expected_lines) * 100 : 100

    // ============================================
    // 5. Count duplicates (order_id, sku pairs with > 1 allocation)
    // ============================================
    const pairCounts = new Map<string, number>()

    if (allocations && allocations.length > 0) {
      for (const alloc of allocations) {
        const pairKey = `${alloc.order_id}|${alloc.sku_internal}`
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1)
      }
    }

    let duplicate_count = 0
    for (const count of Array.from(pairCounts.values())) {
      if (count > 1) {
        duplicate_count++
      }
    }

    return {
      success: true,
      data: {
        expected_lines,
        expected_qty,
        allocated_lines,
        allocated_qty,
        missing_lines,
        coverage_percent,
        duplicate_count,
      },
    }
  } catch (error) {
    console.error('Unexpected error in getCOGSCoverageStats:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      data: null,
    }
  }
}

/**
 * Get list of missing COGS allocations
 * Returns orders that should have allocations but don't
 *
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @returns List of missing allocation records
 */
export async function getMissingAllocations(
  startDate: string,
  endDate: string
): Promise<{ success: boolean; error?: string; data: MissingAllocation[] }> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้', data: [] }
    }

    // ============================================
    // 1. Get expected orders
    // ============================================
    const { data: expectedOrders, error: expectedError } = await supabase
      .from('sales_orders')
      .select('order_id, seller_sku, quantity, shipped_at, status_group')
      .not('shipped_at', 'is', null)
      .neq('status_group', 'ยกเลิกแล้ว')
      .gte('shipped_at', `${startDate}T00:00:00+07:00`)
      .lte('shipped_at', `${endDate}T23:59:59+07:00`)
      .order('shipped_at', { ascending: false })

    if (expectedError) {
      console.error('Error fetching expected orders:', expectedError)
      return { success: false, error: expectedError.message, data: [] }
    }

    if (!expectedOrders || expectedOrders.length === 0) {
      return { success: true, data: [] }
    }

    // ============================================
    // 2. Get allocated pairs
    // ============================================
    const { data: allocations, error: allocationsError } = await supabase
      .from('inventory_cogs_allocations')
      .select('order_id, sku_internal')
      .eq('is_reversal', false)
      .gte('shipped_at', `${startDate}T00:00:00+07:00`)
      .lte('shipped_at', `${endDate}T23:59:59+07:00`)

    if (allocationsError) {
      console.error('Error fetching allocations:', allocationsError)
      return { success: false, error: allocationsError.message, data: [] }
    }

    const allocatedPairs = new Set<string>()

    if (allocations && allocations.length > 0) {
      for (const alloc of allocations) {
        const pairKey = `${alloc.order_id}|${alloc.sku_internal}`
        allocatedPairs.add(pairKey)
      }
    }

    // ============================================
    // 3. Find missing allocations
    // ============================================
    const missingAllocations: MissingAllocation[] = []

    for (const order of expectedOrders) {
      const pairKey = `${order.order_id}|${order.seller_sku}`

      if (!allocatedPairs.has(pairKey)) {
        missingAllocations.push({
          order_id: order.order_id,
          seller_sku: order.seller_sku,
          quantity: order.quantity,
          shipped_at: order.shipped_at,
          status_group: order.status_group,
        })
      }
    }

    return { success: true, data: missingAllocations }
  } catch (error) {
    console.error('Unexpected error in getMissingAllocations:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      data: [],
    }
  }
}

/**
 * Export missing allocations to CSV (server-side)
 *
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @returns CSV file content
 */
export async function exportMissingAllocationsCSV(
  startDate: string,
  endDate: string
): Promise<{ success: boolean; error?: string; csv?: string; filename?: string }> {
  try {
    // Get missing allocations
    const result = await getMissingAllocations(startDate, endDate)

    if (!result.success) {
      return { success: false, error: result.error }
    }

    const data = result.data

    // Build CSV
    const headers = ['order_id', 'sku', 'qty', 'shipped_at', 'order_status']
    const rows = data.map((row) => [
      row.order_id,
      row.seller_sku,
      row.quantity.toString(),
      row.shipped_at,
      row.status_group || '',
    ])

    // Format CSV
    const csvLines = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ]

    const csv = csvLines.join('\n')
    const filename = `missing-cogs-allocations-${startDate}-to-${endDate}.csv`

    return { success: true, csv, filename }
  } catch (error) {
    console.error('Unexpected error in exportMissingAllocationsCSV:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

// ============================================
// Clear Partial COGS Allocations (Admin Only)
// ============================================

/**
 * Clear partial COGS allocations for an order (admin only).
 *
 * Use this when a bundle order is stuck in 'partial' state and you want to
 * start fresh (e.g., wrong SKU mapping, bundle recipe changed).
 *
 * Safety: Creates reversal records for all existing allocations (for audit trail)
 * and restores FIFO layer qty_remaining. P&L nets to zero for this order.
 *
 * After clearing, the order can be re-processed by running Apply COGS again.
 *
 * @param order_id - Order ID to clear
 * @returns Success with count of cleared allocations
 */
export async function clearPartialCOGSAllocations(
  order_id: string
): Promise<{ success: boolean; error?: string; cleared: number }> {
  try {
    const supabase = createClient()

    // Auth + admin check
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้', cleared: 0 }
    }

    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (roleError || roleData?.role !== 'admin') {
      return { success: false, error: 'Admin access required', cleared: 0 }
    }

    if (!order_id || order_id.trim() === '') {
      return { success: false, error: 'order_id is required', cleared: 0 }
    }

    // Get all non-reversal allocations for this order
    const { data: allocations, error: fetchError } = await supabase
      .from('inventory_cogs_allocations')
      .select('id, sku_internal, qty, unit_cost_used, amount, layer_id, method, shipped_at')
      .eq('order_id', order_id)
      .eq('is_reversal', false)
      .is('reversed_at', null)

    if (fetchError) {
      return { success: false, error: fetchError.message, cleared: 0 }
    }

    if (!allocations || allocations.length === 0) {
      return { success: true, cleared: 0 }
    }

    const reversal_reason = `Partial allocation cleared by admin (order: ${order_id})`
    const reversed_at = new Date().toISOString()

    // Mark original allocations as reversed (audit trail)
    const { error: reverseError } = await supabase
      .from('inventory_cogs_allocations')
      .update({
        reversed_at,
        reversed_by: user.id,
        reversed_reason: reversal_reason,
      })
      .in('id', allocations.map((a) => a.id))

    if (reverseError) {
      console.error('Error marking allocations as reversed:', reverseError)
      return { success: false, error: reverseError.message, cleared: 0 }
    }

    // Create reversal records for each allocation (for P&L to net to zero)
    const reversalRecords = allocations.map((alloc) => ({
      order_id,
      sku_internal: alloc.sku_internal,
      shipped_at: alloc.shipped_at,
      method: alloc.method,
      qty: -alloc.qty,
      unit_cost_used: alloc.unit_cost_used,
      amount: -alloc.amount,
      layer_id: alloc.layer_id,
      is_reversal: true,
      created_by: user.id,
    }))

    const { error: insertError } = await supabase
      .from('inventory_cogs_allocations')
      .insert(reversalRecords)

    if (insertError) {
      console.error('Error creating reversal records:', insertError)
      return { success: false, error: insertError.message, cleared: 0 }
    }

    // Restore FIFO layer qty_remaining for each allocation that used a layer
    for (const alloc of allocations) {
      if (alloc.layer_id && alloc.method === 'FIFO' && alloc.qty > 0) {
        const { data: layer } = await supabase
          .from('inventory_receipt_layers')
          .select('qty_remaining')
          .eq('id', alloc.layer_id)
          .single()

        if (layer) {
          await supabase
            .from('inventory_receipt_layers')
            .update({ qty_remaining: layer.qty_remaining + alloc.qty })
            .eq('id', alloc.layer_id)
        }
      }
    }

    console.log(`Admin cleared ${allocations.length} partial allocations for order ${order_id}`)

    revalidatePath('/inventory')
    revalidatePath('/daily-pl')

    return { success: true, cleared: allocations.length }
  } catch (error) {
    console.error('Unexpected error in clearPartialCOGSAllocations:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      cleared: 0,
    }
  }
}

// ============================================
// Apply COGS for a specific Import Batch
// ============================================

/**
 * Apply COGS for all eligible orders in a specific import batch.
 * Uses the same processing loop as applyCOGSMTD but scoped to a single batch.
 * Idempotent: safe to run multiple times.
 */
// ============================================
// Fix Missing SKU
// ============================================

/**
 * Get orders with missing seller_sku in a date range that haven't been allocated yet.
 * Used by the Fix Missing SKU dialog.
 */
export async function getMissingSkuOrders(params: {
  startDate: string
  endDate: string
}): Promise<{
  success: boolean
  error?: string
  data: Array<{
    order_uuid: string
    order_id: string
    quantity: number
    shipped_at: string
  }> | null
}> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้', data: null }

    const { startDate, endDate } = params
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return { success: false, error: 'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)', data: null }
    }

    // Fetch orders with missing seller_sku (null or empty string) in date range
    const { data: orders, error: ordersError } = await supabase
      .from('sales_orders')
      .select('id, order_id, quantity, shipped_at')
      .not('shipped_at', 'is', null)
      .neq('status_group', 'ยกเลิกแล้ว')
      .gte('shipped_at', `${startDate}T00:00:00+07:00`)
      .lte('shipped_at', `${endDate}T23:59:59+07:00`)
      .or('seller_sku.is.null,seller_sku.eq.')
      .order('shipped_at', { ascending: true })
      .limit(500)

    if (ordersError) return { success: false, error: ordersError.message, data: null }
    if (!orders || orders.length === 0) return { success: true, data: [] }

    // Filter out already-allocated orders (check inventory_cogs_allocations by order UUID)
    const orderUuids = orders.map(o => String(o.id))
    const allocatedSet = new Set<string>()
    const CHUNK = 200

    for (let i = 0; i < orderUuids.length; i += CHUNK) {
      const chunk = orderUuids.slice(i, i + CHUNK)
      const { data: allocs } = await supabase
        .from('inventory_cogs_allocations')
        .select('order_id')
        .filter('order_id::text', 'in', `(${chunk.join(',')})`)
        .eq('is_reversal', false)

      if (allocs) {
        for (const a of allocs) allocatedSet.add(String(a.order_id))
      }
    }

    const result = orders
      .filter(o => !allocatedSet.has(String(o.id)))
      .map(o => ({
        order_uuid: String(o.id),
        order_id: o.order_id as string,
        quantity: o.quantity as number,
        shipped_at: o.shipped_at as string,
      }))

    return { success: true, data: result }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาด',
      data: null,
    }
  }
}

/**
 * Get all inventory items for use in SKU selection dropdown.
 */
export async function getInventoryItemsForSku(): Promise<{
  success: boolean
  data: Array<{ sku_internal: string; product_name: string }> | null
}> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, data: null }

    const { data, error } = await supabase
      .from('inventory_items')
      .select('sku_internal, product_name')
      .order('sku_internal', { ascending: true })

    if (error) return { success: false, data: null }
    return { success: true, data: data || [] }
  } catch {
    return { success: false, data: null }
  }
}

/**
 * Save seller_sku updates for missing-sku orders then immediately run COGS for those orders.
 * Admin only. Idempotent: already-allocated orders are skipped gracefully.
 */
export async function saveSkusAndAllocate(params: {
  updates: Array<{ order_uuid: string; sku_internal: string }>
  method?: CostingMethod
}): Promise<{
  success: boolean
  error?: string
  data: {
    total: number
    eligible: number
    successful: number
    skipped: number
    failed: number
    partial: number
    errors: Array<{ order_id: string; reason: string }>
    skip_reasons: Array<{
      code: string
      label: string
      count: number
      samples: Array<{ order_id: string; sku?: string; detail?: string }>
    }>
    run_id: string | null
    cogs_run_id: string | null
  } | null
}> {
  const method: CostingMethod = params.method || 'FIFO'
  let run_id: string | null = null
  let cogs_run_id: string | null = null

  try {
    const supabase = createClient()

    // Auth check
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้', data: null }
    }

    // Admin check
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (roleError || roleData?.role !== 'admin') {
      return { success: false, error: 'ไม่มีสิทธิ์เข้าถึงฟังก์ชันนี้ (Admin only)', data: null }
    }

    const { updates } = params
    if (!updates || updates.length === 0) {
      return { success: false, error: 'ไม่มีข้อมูล updates', data: null }
    }

    // Validate all sku_internal values exist in inventory_items
    const skuInternals = Array.from(new Set(updates.map((u) => u.sku_internal)))
    const { data: validSkus, error: skuError } = await supabase
      .from('inventory_items')
      .select('sku_internal')
      .in('sku_internal', skuInternals)

    if (skuError) {
      return { success: false, error: `ตรวจสอบ SKU ล้มเหลว: ${skuError.message}`, data: null }
    }

    const validSkuSet = new Set((validSkus || []).map((s: { sku_internal: string }) => s.sku_internal))
    const invalidSkus = skuInternals.filter(s => !validSkuSet.has(s))
    if (invalidSkus.length > 0) {
      return { success: false, error: `SKU ไม่มีในระบบ: ${invalidSkus.join(', ')}`, data: null }
    }

    // Create cogs_allocation_run (notification tracking)
    const cogsRunResult = await createCogsRun({ triggerSource: 'DATE_RANGE' })
    if (cogsRunResult.success && cogsRunResult.runId) {
      cogs_run_id = cogsRunResult.runId
    }

    // Create legacy run record
    const { data: runData, error: runError } = await supabase
      .from('inventory_cogs_apply_runs')
      .insert({
        start_date: null,
        end_date: null,
        method,
        total: 0,
        eligible: 0,
        successful: 0,
        skipped: 0,
        failed: 0,
        partial: 0,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (!runError && runData) {
      run_id = runData.id
    }

    // ── UPDATE seller_sku (grouped by SKU to minimise DB round-trips) ──
    const skuGroups = new Map<string, string[]>()
    for (const { order_uuid, sku_internal } of updates) {
      if (!skuGroups.has(sku_internal)) skuGroups.set(sku_internal, [])
      skuGroups.get(sku_internal)!.push(order_uuid)
    }

    const skuGroupEntries = Array.from(skuGroups.entries())
    for (const [sku, uuids] of skuGroupEntries) {
      const { error: updateError } = await supabase
        .from('sales_orders')
        .update({ seller_sku: sku })
        .in('id', uuids)
        .eq('created_by', user.id)  // RLS guard

      if (updateError) {
        console.error(`saveSkusAndAllocate: failed to update seller_sku for SKU ${sku}:`, updateError)
      }
    }

    // ── FETCH updated orders ──
    const orderUuids = updates.map(u => u.order_uuid)
    const { data: orders, error: ordersError } = await supabase
      .from('sales_orders')
      .select('id, order_id, seller_sku, quantity, shipped_at, status_group')
      .in('id', orderUuids)

    if (ordersError) {
      if (cogs_run_id) await completeCogsRunFailed(cogs_run_id, ordersError.message)
      return { success: false, error: ordersError.message, data: null }
    }

    if (!orders || orders.length === 0) {
      const emptySummary = {
        total: 0, eligible: 0, successful: 0, skipped: 0, failed: 0, partial: 0,
        errors: [], skip_reasons: [], run_id, cogs_run_id,
      }
      if (cogs_run_id) {
        await completeCogsRunSuccess(cogs_run_id, emptySummary)
        await createNotificationForRun(cogs_run_id, { total: 0, successful: 0, skipped: 0, failed: 0 })
      }
      return { success: true, data: emptySummary }
    }

    // ── FETCH bundle SKUs ──
    const { data: bundleItemsData } = await supabase
      .from('inventory_items')
      .select('sku_internal')
      .eq('is_bundle', true)

    const bundleSkuSet = new Set<string>((bundleItemsData || []).map((i: { sku_internal: string }) => i.sku_internal))

    // ── CHECK EXISTING ALLOCATIONS (non-bundle only) ──
    const nonBundleOrderIds = orders
      .filter((o: { seller_sku: string | null }) => o.seller_sku && !bundleSkuSet.has(o.seller_sku))
      .map((o: { id: unknown }) => String(o.id))

    const allocatedOrderIds = new Set<string>()

    if (nonBundleOrderIds.length > 0) {
      const CHUNK_SIZE = 200
      for (let i = 0; i < nonBundleOrderIds.length; i += CHUNK_SIZE) {
        const chunk = nonBundleOrderIds.slice(i, i + CHUNK_SIZE)
        const { data: chunkAllocs } = await supabase
          .from('inventory_cogs_allocations')
          .select('order_id')
          .filter('order_id::text', 'in', `(${chunk.join(',')})`)
          .eq('is_reversal', false)

        if (chunkAllocs) {
          for (const row of chunkAllocs) allocatedOrderIds.add(String(row.order_id))
        }
      }
    }

    // ── PROCESS ORDERS (same loop pattern as applyCOGSForBatch) ──
    const summary = {
      total: orders.length,
      eligible: 0,
      successful: 0,
      skipped: 0,
      failed: 0,
      partial: 0,
      errors: [] as Array<{ order_id: string; reason: string }>,
    }

    interface _SkipReason {
      code: string
      label: string
      count: number
      samples: Array<{ order_id: string; sku?: string; detail?: string }>
    }
    const skipReasons = new Map<string, _SkipReason>()

    const addSkipReason = (code: string, label: string, order_id: string, sku?: string, detail?: string) => {
      if (!skipReasons.has(code)) {
        skipReasons.set(code, { code, label, count: 0, samples: [] })
      }
      const r = skipReasons.get(code)!
      r.count++
      if (r.samples.length < 5) r.samples.push({ order_id, sku, detail })
    }

    const runItems: Array<{
      order_id: string
      sku: string | null
      qty: number | null
      status: 'successful' | 'skipped' | 'failed' | 'partial'
      reason: string | null
      missing_skus: string[]
      allocated_skus: string[]
    }> = []

    for (const order of orders) {
      const order_uuid = String(order.id)
      const order_id   = order.order_id
      const sku        = order.seller_sku
      const qty        = order.quantity
      const shipped_at = order.shipped_at

      const isBundle = sku && bundleSkuSet.has(sku)

      if (!isBundle && allocatedOrderIds.has(order_uuid)) {
        summary.skipped++
        summary.errors.push({ order_id, reason: 'already_allocated' })
        addSkipReason('ALREADY_ALLOCATED', 'เคย allocate แล้ว (idempotent skip)', order_id, sku)
        runItems.push({ order_id, sku: sku || null, qty: qty || null, status: 'skipped', reason: 'ALREADY_ALLOCATED', missing_skus: [], allocated_skus: sku ? [sku] : [] })
        continue
      }

      if (!sku || sku.trim() === '') {
        summary.skipped++
        summary.errors.push({ order_id, reason: 'missing_seller_sku' })
        addSkipReason('MISSING_SKU', 'ไม่มี seller_sku ใน order', order_id)
        runItems.push({ order_id, sku: null, qty: qty || null, status: 'skipped', reason: 'MISSING_SKU', missing_skus: [], allocated_skus: [] })
        continue
      }

      if (qty == null || !Number.isFinite(qty) || qty <= 0) {
        summary.skipped++
        summary.errors.push({ order_id, reason: `invalid_quantity_${qty}` })
        addSkipReason('INVALID_QUANTITY', 'quantity ไม่ถูกต้อง (null/zero/negative)', order_id, sku, `qty=${qty}`)
        runItems.push({ order_id, sku: sku || null, qty: qty || null, status: 'skipped', reason: 'INVALID_QUANTITY', missing_skus: [], allocated_skus: [] })
        continue
      }

      if (!shipped_at) {
        summary.skipped++
        summary.errors.push({ order_id, reason: 'missing_shipped_at' })
        addSkipReason('NOT_SHIPPED', 'ยังไม่ได้ shipped (ไม่มี shipped_at)', order_id, sku)
        runItems.push({ order_id, sku: sku || null, qty: qty || null, status: 'skipped', reason: 'NOT_SHIPPED', missing_skus: [], allocated_skus: [] })
        continue
      }

      summary.eligible++

      try {
        const result = await applyCOGSForOrderShippedCore(order_uuid, sku, qty, shipped_at, method)

        if (result.status === 'success') {
          summary.successful++
          runItems.push({ order_id, sku: sku || null, qty: qty || null, status: 'successful', reason: null, missing_skus: [], allocated_skus: result.allocatedSkus })
        } else if (result.status === 'already_allocated') {
          summary.skipped++
          summary.errors.push({ order_id, reason: 'already_allocated' })
          addSkipReason('ALREADY_ALLOCATED', 'เคย allocate แล้ว (idempotent skip)', order_id, sku)
          runItems.push({ order_id, sku: sku || null, qty: qty || null, status: 'skipped', reason: 'ALREADY_ALLOCATED', missing_skus: [], allocated_skus: result.allocatedSkus })
        } else if (result.status === 'partial') {
          summary.partial++
          summary.errors.push({ order_id, reason: result.reason || 'PARTIAL' })
          addSkipReason('PARTIAL_ALLOCATION', `bundle allocate ได้บางส่วน (missing: ${result.missingSkus.join(', ')})`, order_id, sku, result.reason)
          runItems.push({ order_id, sku: sku || null, qty: qty || null, status: 'partial', reason: result.reason || 'PARTIAL_ALLOCATION', missing_skus: result.missingSkus, allocated_skus: result.allocatedSkus })
        } else {
          summary.failed++
          summary.errors.push({ order_id, reason: result.reason || 'applyCOGS_failed' })
          addSkipReason('ALLOCATION_FAILED', 'ไม่สามารถ allocate ได้ (SKU ไม่มี/stock ไม่พอ/bundle ไม่มี recipe)', order_id, sku, result.reason)
          runItems.push({ order_id, sku: sku || null, qty: qty || null, status: 'failed', reason: result.reason || 'ALLOCATION_FAILED', missing_skus: result.missingSkus, allocated_skus: result.allocatedSkus })
        }
      } catch (loopErr) {
        summary.failed++
        const errMsg = loopErr instanceof Error ? loopErr.message : 'unknown_error'
        summary.errors.push({ order_id, reason: errMsg })
        addSkipReason('EXCEPTION', 'เกิด exception ระหว่าง allocate', order_id, sku, errMsg)
        runItems.push({ order_id, sku: sku || null, qty: qty || null, status: 'failed', reason: 'EXCEPTION', missing_skus: [sku], allocated_skus: [] })
      }
    }

    const skipReasonsArray = Array.from(skipReasons.values()).sort((a, b) => b.count - a.count)

    // ── SAVE RUN LOG ──
    if (run_id && runItems.length > 0) {
      const BATCH_SIZE = 1000
      for (let i = 0; i < runItems.length; i += BATCH_SIZE) {
        const batch = runItems.slice(i, i + BATCH_SIZE)
        await supabase.from('inventory_cogs_apply_run_items').insert(
          batch.map(item => ({
            run_id,
            order_id: item.order_id,
            sku: item.sku,
            qty: item.qty,
            status: item.status,
            reason: item.reason,
            missing_skus: item.missing_skus,
            allocated_skus: item.allocated_skus,
          }))
        )
      }

      await supabase.from('inventory_cogs_apply_runs').update({
        total: summary.total,
        eligible: summary.eligible,
        successful: summary.successful,
        skipped: summary.skipped,
        failed: summary.failed,
        partial: summary.partial,
      }).eq('id', run_id)
    }

    revalidatePath('/inventory')
    revalidatePath('/sales')
    revalidatePath('/daily-pl')

    // ── COMPLETE COGS_ALLOCATION_RUN ──
    if (cogs_run_id) {
      const notifSummary = {
        total: summary.total,
        eligible: summary.eligible,
        successful: summary.successful,
        skipped: summary.skipped,
        failed: summary.failed,
        partial: summary.partial,
        skip_reasons: skipReasonsArray,
      }
      await completeCogsRunSuccess(cogs_run_id, notifSummary)
      await createNotificationForRun(cogs_run_id, {
        total: summary.total,
        successful: summary.successful,
        skipped: summary.skipped,
        failed: summary.failed,
      })
    }

    return {
      success: true,
      data: { ...summary, skip_reasons: skipReasonsArray, run_id, cogs_run_id },
    }
  } catch (error) {
    console.error('Unexpected error in saveSkusAndAllocate:', error)
    if (typeof cogs_run_id === 'string' && cogs_run_id) {
      await completeCogsRunFailed(
        cogs_run_id,
        error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด'
      )
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      data: null,
    }
  }
}

export async function applyCOGSForBatch(importBatchId: string): Promise<{
  success: boolean
  error?: string
  data: {
    total: number
    eligible: number
    successful: number
    skipped: number
    failed: number
    partial: number
    errors: Array<{ order_id: string; reason: string }>
    skip_reasons: Array<{ code: string; label: string; count: number; samples: Array<{ order_id: string; sku?: string; detail?: string }> }>
    run_id: string | null
    cogs_run_id: string | null
  } | null
}> {
  const method: CostingMethod = 'FIFO'
  let run_id: string | null = null
  let cogs_run_id: string | null = null

  try {
    const supabase = createClient()

    // Auth check
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้', data: null }
    }

    // Admin check
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

    // ── PRE-VALIDATE: Fetch orders BEFORE creating cogs_allocation_run ──
    // Never create a "running" row without first confirming there is work to do.
    console.log(`[applyCOGSForBatch] Pre-validating import_batch_id=${importBatchId}`)
    const PAGE_SIZE = 1000
    let allOrders: any[] = []
    let currentPage = 0
    let hasMore = true

    while (hasMore) {
      const from = currentPage * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      const { data: pageOrders, error: ordersError } = await supabase
        .from('sales_orders')
        .select('id, order_id, seller_sku, quantity, shipped_at, status_group')
        .eq('import_batch_id', importBatchId)
        .neq('status_group', 'ยกเลิกแล้ว')
        .not('shipped_at', 'is', null)
        .order('shipped_at', { ascending: true })
        .order('order_id', { ascending: true })
        .range(from, to)

      if (ordersError) {
        console.error(`[applyCOGSForBatch] Error fetching orders (import_batch_id=${importBatchId}):`, ordersError)
        return { success: false, error: ordersError.message, data: null }
      }

      if (pageOrders && pageOrders.length > 0) {
        allOrders = allOrders.concat(pageOrders)
      }

      hasMore = !!(pageOrders && pageOrders.length === PAGE_SIZE)
      currentPage++
      if (currentPage >= 100) hasMore = false
    }

    const orders = allOrders

    if (orders.length === 0) {
      console.log(`[applyCOGSForBatch] No shipped orders found for import_batch_id=${importBatchId} — no run created`)
      return {
        success: false,
        error: `ไม่พบ orders ที่ shipped สำหรับ import batch นี้ (batch_id: ${importBatchId}) — กรุณาตรวจสอบว่า orders มีสถานะ shipped แล้ว`,
        data: null,
      }
    }

    console.log(`[applyCOGSForBatch] Found ${orders.length} shipped orders for import_batch_id=${importBatchId}`)

    // ── PRE-VALIDATE: Fetch bundle context ──
    const { data: bundleItemsData } = await supabase
      .from('inventory_items')
      .select('sku_internal')
      .eq('is_bundle', true)

    const bundleSkuSet = new Set<string>((bundleItemsData || []).map((i) => i.sku_internal))

    // ── PRE-VALIDATE: Check existing allocations (non-bundle only) ──
    // Use sales_orders.id (uuid) as the canonical key for inventory_cogs_allocations
    const nonBundleOrderIds = orders
      .filter((o) => o.seller_sku && !bundleSkuSet.has(o.seller_sku))
      .map((o) => o.id)

    const allocatedOrderIds = new Set<string>()

    if (nonBundleOrderIds.length > 0) {
      const CHUNK_SIZE = 200
      for (let i = 0; i < nonBundleOrderIds.length; i += CHUNK_SIZE) {
        const chunk = nonBundleOrderIds.slice(i, i + CHUNK_SIZE)
        const { data: chunkAllocs, error: allocError } = await supabase
          .from('inventory_cogs_allocations')
          .select('order_id')
          .filter('order_id::text', 'in', `(${chunk.join(',')})`)
          .eq('is_reversal', false)

        if (allocError) {
          console.error(`[applyCOGSForBatch] Error checking allocations (import_batch_id=${importBatchId}):`, allocError)
          return { success: false, error: allocError.message, data: null }
        }

        if (chunkAllocs) {
          for (const row of chunkAllocs) {
            allocatedOrderIds.add(String(row.order_id))
          }
        }
      }
    }

    // Count eligible orders before creating run.
    // Eligible = shipped (already guaranteed by query) AND not yet allocated.
    // Orders with missing seller_sku or invalid quantity are NOT excluded here —
    // those will be processed and skipped (MISSING_SKU / INVALID_QUANTITY) inside
    // the loop. Excluding them here would falsely block Shopee batches where SKU
    // mapping has not been set up yet.
    const totalShipped = orders.length
    const totalAllocated = orders.filter((o) => {
      const isBundle = o.seller_sku && bundleSkuSet.has(o.seller_sku)
      return !isBundle && allocatedOrderIds.has(o.id)
    }).length
    // Bundles are always eligible (partial allocations can be retried)
    const eligibleCount = orders.filter((o) => {
      const isBundle = o.seller_sku && bundleSkuSet.has(o.seller_sku)
      if (isBundle) return true
      return !allocatedOrderIds.has(o.id)
    }).length

    console.log(
      `[applyCOGSForBatch] Pre-validation (import_batch_id=${importBatchId}): ` +
      `total_shipped=${totalShipped}, total_allocated=${totalAllocated}, eligible=${eligibleCount}`
    )

    if (eligibleCount === 0) {
      console.log(`[applyCOGSForBatch] No eligible orders in import_batch_id=${importBatchId} — all ${totalShipped} shipped orders are already allocated`)
      return {
        success: false,
        error: `ไม่มี orders ที่ eligible ใน batch นี้ — ${totalShipped} orders shipped แต่ allocated ทั้งหมดแล้ว (ไม่จำเป็นต้องรันซ้ำ)`,
        data: null,
      }
    }

    console.log(`[applyCOGSForBatch] Pre-validation passed: ${eligibleCount} eligible of ${totalShipped} shipped (import_batch_id=${importBatchId})`)

    // ── GUARD: check for concurrent running IMPORT_BATCH run for same batch ──
    const { data: existingBatchRun } = await supabase
      .from('cogs_allocation_runs')
      .select('id, created_at, updated_at')
      .eq('status', 'running')
      .eq('trigger_source', 'IMPORT_BATCH')
      .eq('import_batch_id', importBatchId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingBatchRun) {
      const lastActivityMs = Date.now() - new Date(existingBatchRun.updated_at ?? existingBatchRun.created_at).getTime()
      const STALE_MS = 10 * 60 * 1000
      if (lastActivityMs > STALE_MS) {
        console.warn(`[applyCOGSForBatch] Auto-failing stale cogs_run_id=${existingBatchRun.id} for import_batch_id=${importBatchId} (inactive ${Math.round(lastActivityMs / 60000)} min)`)
        await completeCogsRunFailed(existingBatchRun.id, `Auto-failed: no activity for ${Math.round(lastActivityMs / 60000)} min (import_batch_id=${importBatchId})`)
        // Fall through and allow new run
      } else {
        return {
          success: false,
          error: `มี COGS run สำหรับ batch นี้ที่กำลังทำงานอยู่ (cogs_run_id: ${existingBatchRun.id}, import_batch_id: ${importBatchId})`,
          data: null,
        }
      }
    }

    // ── CREATE cogs_allocation_runs row (only after pre-validation passes) ──
    const cogsRunResult = await createCogsRun({
      triggerSource: 'IMPORT_BATCH',
      importBatchId,
    })
    if (cogsRunResult.success && cogsRunResult.runId) {
      cogs_run_id = cogsRunResult.runId
      console.log(`[applyCOGSForBatch] Created cogs_allocation_runs row: cogs_run_id=${cogs_run_id}, import_batch_id=${importBatchId}`)
    } else {
      console.error(`[applyCOGSForBatch] Failed to create cogs_allocation_runs row for import_batch_id=${importBatchId}:`, cogsRunResult.error)
    }

    // Create legacy run record
    const { data: runData, error: runError } = await supabase
      .from('inventory_cogs_apply_runs')
      .insert({
        start_date: null,
        end_date: null,
        method,
        total: 0,
        eligible: 0,
        successful: 0,
        skipped: 0,
        failed: 0,
        partial: 0,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (!runError && runData) {
      run_id = runData.id
    }

    // ── PROCESS LOOP (with timeout safety) ──
    const LOOP_START_MS = Date.now()
    const TIMEOUT_MS = 50_000 // 50s safety margin for Vercel Hobby 60s limit
    interface BatchSkipReason {
      code: string
      label: string
      count: number
      samples: Array<{ order_id: string; sku?: string; detail?: string }>
    }

    const skipReasons = new Map<string, BatchSkipReason>()

    const addSkipReason = (
      code: string,
      label: string,
      order_id: string,
      sku?: string,
      detail?: string
    ) => {
      if (!skipReasons.has(code)) {
        skipReasons.set(code, { code, label, count: 0, samples: [] })
      }
      const reason = skipReasons.get(code)!
      reason.count++
      if (reason.samples.length < 5) {
        reason.samples.push({ order_id, sku, detail })
      }
    }

    const runItems: Array<{
      order_id: string
      sku: string | null
      qty: number | null
      status: 'successful' | 'skipped' | 'failed' | 'partial'
      reason: string | null
      missing_skus: string[]
      allocated_skus: string[]
    }> = []

    const summary = {
      total: orders.length,
      eligible: 0,
      successful: 0,
      skipped: 0,
      failed: 0,
      partial: 0,
      errors: [] as Array<{ order_id: string; reason: string }>,
    }

    for (const order of orders) {
      // ── Timeout safety ──
      const elapsed = Date.now() - LOOP_START_MS
      if (elapsed > TIMEOUT_MS) {
        const elapsedSec = Math.round(elapsed / 1000)
        const msg = `Timeout after ${elapsedSec}s — ประมวลผล ${summary.successful} orders สำเร็จ จาก ${orders.length} ทั้งหมด (cogs_run_id=${cogs_run_id ?? 'none'}, import_batch_id=${importBatchId})`
        console.warn(`[applyCOGSForBatch] ${msg}`)
        if (cogs_run_id) {
          await completeCogsRunFailed(cogs_run_id, msg)
        }
        return { success: false, error: msg, data: null }
      }

      const order_uuid = order.id          // UUID primary key — used for RPC + allocation checks
      const order_id   = order.order_id   // TikTok/external order ID — for logging only
      const sku = order.seller_sku
      const qty = order.quantity
      const shipped_at = order.shipped_at
      const isBundle = sku && bundleSkuSet.has(sku)

      if (!isBundle && allocatedOrderIds.has(order_uuid)) {
        summary.skipped++
        summary.errors.push({ order_id, reason: 'already_allocated' })
        addSkipReason('ALREADY_ALLOCATED', 'เคย allocate แล้ว (idempotent skip)', order_id, sku)
        runItems.push({
          order_id, sku: sku || null, qty: qty || null,
          status: 'skipped', reason: 'ALREADY_ALLOCATED',
          missing_skus: [], allocated_skus: sku ? [sku] : [],
        })
        continue
      }

      if (!sku || sku.trim() === '') {
        summary.skipped++
        summary.errors.push({ order_id, reason: 'missing_seller_sku' })
        addSkipReason('MISSING_SKU', 'ไม่มี seller_sku ใน order', order_id)
        runItems.push({
          order_id, sku: null, qty: qty || null,
          status: 'skipped', reason: 'MISSING_SKU',
          missing_skus: [], allocated_skus: [],
        })
        continue
      }

      if (qty == null || !Number.isFinite(qty) || qty <= 0) {
        summary.skipped++
        summary.errors.push({ order_id, reason: `invalid_quantity_${qty}` })
        addSkipReason('INVALID_QUANTITY', 'quantity ไม่ถูกต้อง (null/zero/negative)', order_id, sku, `qty=${qty}`)
        runItems.push({
          order_id, sku: sku || null, qty: qty || null,
          status: 'skipped', reason: 'INVALID_QUANTITY',
          missing_skus: [], allocated_skus: [],
        })
        continue
      }

      if (!shipped_at) {
        summary.skipped++
        summary.errors.push({ order_id, reason: 'missing_shipped_at' })
        addSkipReason('NOT_SHIPPED', 'ยังไม่ได้ shipped (ไม่มี shipped_at)', order_id, sku)
        runItems.push({
          order_id, sku: sku || null, qty: qty || null,
          status: 'skipped', reason: 'NOT_SHIPPED',
          missing_skus: [], allocated_skus: [],
        })
        continue
      }

      summary.eligible++

      // order_uuid (UUID) is passed to RPC; order_id (TikTok ID) is for logging only
      try {
        const result = await applyCOGSForOrderShippedCore(order_uuid, sku, qty, shipped_at, method)

        if (result.status === 'success') {
          summary.successful++
          runItems.push({
            order_id, sku: sku || null, qty: qty || null,
            status: 'successful', reason: null,
            missing_skus: [], allocated_skus: result.allocatedSkus,
          })
        } else if (result.status === 'already_allocated') {
          summary.skipped++
          summary.errors.push({ order_id, reason: 'already_allocated' })
          addSkipReason('ALREADY_ALLOCATED', 'เคย allocate แล้ว (idempotent skip)', order_id, sku)
          runItems.push({
            order_id, sku: sku || null, qty: qty || null,
            status: 'skipped', reason: 'ALREADY_ALLOCATED',
            missing_skus: [], allocated_skus: result.allocatedSkus,
          })
        } else if (result.status === 'partial') {
          summary.partial++
          summary.errors.push({ order_id, reason: result.reason || 'PARTIAL' })
          addSkipReason(
            'PARTIAL_ALLOCATION',
            `bundle allocate ได้บางส่วน (missing: ${result.missingSkus.join(', ')})`,
            order_id, sku, result.reason
          )
          runItems.push({
            order_id, sku: sku || null, qty: qty || null,
            status: 'partial', reason: result.reason || 'PARTIAL_ALLOCATION',
            missing_skus: result.missingSkus, allocated_skus: result.allocatedSkus,
          })
        } else {
          summary.failed++
          summary.errors.push({ order_id, reason: result.reason || 'applyCOGS_failed' })
          addSkipReason(
            'ALLOCATION_FAILED',
            'ไม่สามารถ allocate ได้ (SKU ไม่มี/stock ไม่พอ/bundle ไม่มี recipe)',
            order_id, sku, result.reason
          )
          runItems.push({
            order_id, sku: sku || null, qty: qty || null,
            status: 'failed', reason: result.reason || 'ALLOCATION_FAILED',
            missing_skus: result.missingSkus, allocated_skus: result.allocatedSkus,
          })
        }
      } catch (err) {
        summary.failed++
        const errorMsg = err instanceof Error ? err.message : 'unknown_error'
        summary.errors.push({ order_id, reason: errorMsg })
        addSkipReason('EXCEPTION', 'เกิด exception ระหว่าง allocate', order_id, sku, errorMsg)
        runItems.push({
          order_id, sku: sku || null, qty: qty || null,
          status: 'failed', reason: 'EXCEPTION',
          missing_skus: [sku], allocated_skus: [],
        })
      }
    }

    const skipReasonsArray = Array.from(skipReasons.values()).sort((a, b) => b.count - a.count)

    // ── Save legacy run items ──
    if (run_id && runItems.length > 0) {
      const BATCH_SIZE = 1000
      for (let i = 0; i < runItems.length; i += BATCH_SIZE) {
        const batch = runItems.slice(i, i + BATCH_SIZE)
        const itemsToInsert = batch.map((item) => ({
          run_id,
          order_id: item.order_id,
          sku: item.sku,
          qty: item.qty,
          status: item.status,
          reason: item.reason,
          missing_skus: item.missing_skus,
          allocated_skus: item.allocated_skus,
        }))

        const { error: insertError } = await supabase
          .from('inventory_cogs_apply_run_items')
          .insert(itemsToInsert)

        if (insertError) {
          console.error(`Failed to insert batch run items (batch ${i / BATCH_SIZE + 1}):`, insertError)
        }
      }

      await supabase
        .from('inventory_cogs_apply_runs')
        .update({
          total: summary.total,
          eligible: summary.eligible,
          successful: summary.successful,
          skipped: summary.skipped,
          failed: summary.failed,
          partial: summary.partial,
        })
        .eq('id', run_id)
    }

    revalidatePath('/inventory')
    revalidatePath('/sales')
    revalidatePath('/daily-pl')

    // ── Complete cogs_allocation_run (success) ──
    if (cogs_run_id) {
      const notifSummary = {
        total: summary.total,
        eligible: summary.eligible,
        successful: summary.successful,
        skipped: summary.skipped,
        failed: summary.failed,
        partial: summary.partial,
        import_batch_id: importBatchId,
        skip_reasons: skipReasonsArray,
      }
      console.log(`[applyCOGSForBatch] Completing cogs_run_id=${cogs_run_id} as success (import_batch_id=${importBatchId}): ${summary.successful} successful, ${summary.skipped} skipped, ${summary.failed} failed`)
      await completeCogsRunSuccess(cogs_run_id, notifSummary)
      await createNotificationForRun(cogs_run_id, {
        total: summary.total,
        successful: summary.successful,
        skipped: summary.skipped,
        failed: summary.failed,
      })
    }

    return {
      success: true,
      data: {
        ...summary,
        skip_reasons: skipReasonsArray,
        run_id,
        cogs_run_id,
      },
    }
  } catch (error) {
    console.error(`[applyCOGSForBatch] Unexpected error (import_batch_id=${importBatchId}):`, error)

    if (typeof cogs_run_id === 'string' && cogs_run_id) {
      await completeCogsRunFailed(
        cogs_run_id,
        error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด'
      )
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      data: null,
    }
  }
}

// ============================================================
// Manual Stock Adjustments
// ============================================================

/**
 * ADJUST_IN: creates a receipt layer (ref_type='ADJUST_IN', unit_cost=0)
 * and an inventory_adjustments record with layer_id set.
 * Admin-only.
 */
export async function createAdjustIn(params: {
  sku_internal: string
  quantity: number
  reason: string
  adjusted_at: string // ISO timestamp with +07:00 suffix
}): Promise<{ success: boolean; error?: string; data?: { layer_id: string; adjustment_id: string } }> {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Not authenticated' }

    const adminResult = await checkIsInventoryAdmin()
    if (!adminResult.success || !adminResult.isAdmin) {
      return { success: false, error: 'Admin permission required' }
    }

    const sku = params.sku_internal.trim().toUpperCase()
    if (!sku) return { success: false, error: 'SKU is required' }

    const qty = Number(params.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      return { success: false, error: 'Quantity must be greater than 0' }
    }

    const reason = params.reason.trim()
    if (!reason) return { success: false, error: 'Reason is required' }

    // Validate SKU exists and is not a bundle
    const { data: item, error: itemError } = await supabase
      .from('inventory_items')
      .select('sku_internal, is_bundle')
      .eq('sku_internal', sku)
      .single()

    if (itemError || !item) {
      return { success: false, error: `SKU ${sku} not found` }
    }
    if (item.is_bundle) {
      return { success: false, error: 'Cannot adjust bundle SKUs directly — adjust component SKUs instead' }
    }

    // Create receipt layer with created_by so RLS INSERT policy (created_by = auth.uid()) passes
    const { data: layer, error: layerError } = await supabase
      .from('inventory_receipt_layers')
      .insert({
        sku_internal: sku,
        received_at: params.adjusted_at,
        qty_received: qty,
        qty_remaining: qty,
        unit_cost: 0,
        ref_type: 'ADJUST_IN',
        ref_id: null,
        is_voided: false,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (layerError || !layer) {
      return { success: false, error: layerError?.message ?? 'Failed to create receipt layer' }
    }

    // Create adjustment record (layer_id set)
    const { data: adj, error: adjError } = await supabase
      .from('inventory_adjustments')
      .insert({
        sku_internal: sku,
        adjustment_type: 'ADJUST_IN',
        quantity: qty,
        reason,
        adjusted_at: params.adjusted_at,
        layer_id: layer.id,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (adjError || !adj) {
      // Best-effort rollback: void the layer
      await supabase
        .from('inventory_receipt_layers')
        .update({ is_voided: true, voided_at: new Date().toISOString(), void_reason: 'Adjustment insert failed — auto-rollback' })
        .eq('id', layer.id)
      return { success: false, error: adjError?.message ?? 'Failed to create adjustment record' }
    }

    revalidatePath('/inventory')
    return { success: true, data: { layer_id: layer.id, adjustment_id: adj.id } }
  } catch (err) {
    console.error('Unexpected error in createAdjustIn:', err)
    return { success: false, error: 'Unexpected error' }
  }
}

/**
 * ADJUST_OUT: drains existing FIFO receipt layers (oldest first, non-voided,
 * qty_remaining > 0) and records the adjustment.
 * Fails if available stock < requested quantity.
 * Admin-only.
 *
 * NOTE: The drain + insert is not atomic (no DB transaction from Supabase JS client).
 * If the adjustment insert fails after layers are drained, stock is decremented
 * without an audit record. TODO: wrap in a DB function for full atomicity.
 */
export async function createAdjustOut(params: {
  sku_internal: string
  quantity: number
  reason: string
  adjusted_at: string // ISO timestamp with +07:00 suffix
}): Promise<{ success: boolean; error?: string; data?: { adjustment_id: string; layers_drained: number } }> {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Not authenticated' }

    const adminResult = await checkIsInventoryAdmin()
    if (!adminResult.success || !adminResult.isAdmin) {
      return { success: false, error: 'Admin permission required' }
    }

    const sku = params.sku_internal.trim().toUpperCase()
    if (!sku) return { success: false, error: 'SKU is required' }

    const qty = Number(params.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      return { success: false, error: 'Quantity must be greater than 0' }
    }

    const reason = params.reason.trim()
    if (!reason) return { success: false, error: 'Reason is required' }

    // Validate SKU exists and is not a bundle
    const { data: item, error: itemError } = await supabase
      .from('inventory_items')
      .select('sku_internal, is_bundle')
      .eq('sku_internal', sku)
      .single()

    if (itemError || !item) {
      return { success: false, error: `SKU ${sku} not found` }
    }
    if (item.is_bundle) {
      return { success: false, error: 'Cannot adjust bundle SKUs directly — adjust component SKUs instead' }
    }

    // Fetch non-voided layers with remaining stock, FIFO order
    const { data: layers, error: layersError } = await supabase
      .from('inventory_receipt_layers')
      .select('id, qty_remaining')
      .eq('sku_internal', sku)
      .eq('is_voided', false)
      .gt('qty_remaining', 0)
      .order('received_at', { ascending: true })

    if (layersError) {
      return { success: false, error: layersError.message }
    }

    const available = (layers ?? []).reduce((sum, l) => sum + Number(l.qty_remaining), 0)
    if (available < qty) {
      return {
        success: false,
        error: `สต็อกไม่พอ: มีอยู่ ${available.toFixed(2)} แต่ขอลด ${qty}`,
      }
    }

    // Drain FIFO
    let remaining = qty
    let layersDrained = 0
    const drainedUpdates: Array<{ id: string; oldQty: number; newQty: number }> = []

    for (const layer of layers ?? []) {
      if (remaining <= 0) break
      const drain = Math.min(remaining, Number(layer.qty_remaining))
      const newQty = Number(layer.qty_remaining) - drain

      const { error: updateError } = await supabase
        .from('inventory_receipt_layers')
        .update({ qty_remaining: newQty })
        .eq('id', layer.id)

      if (updateError) {
        // Attempt to restore already-drained layers
        for (const restored of drainedUpdates) {
          await supabase
            .from('inventory_receipt_layers')
            .update({ qty_remaining: restored.oldQty })
            .eq('id', restored.id)
        }
        return { success: false, error: `Failed to drain layer ${layer.id}: ${updateError.message}` }
      }

      drainedUpdates.push({ id: layer.id, oldQty: Number(layer.qty_remaining), newQty })
      remaining -= drain
      layersDrained += 1
    }

    // Insert adjustment record (layer_id=null for OUT — may span multiple layers)
    const { data: adj, error: adjError } = await supabase
      .from('inventory_adjustments')
      .insert({
        sku_internal: sku,
        adjustment_type: 'ADJUST_OUT',
        quantity: qty,
        reason,
        adjusted_at: params.adjusted_at,
        layer_id: null,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (adjError || !adj) {
      return { success: false, error: adjError?.message ?? 'Failed to create adjustment record' }
    }

    revalidatePath('/inventory')
    return { success: true, data: { adjustment_id: adj.id, layers_drained: layersDrained } }
  } catch (err) {
    console.error('Unexpected error in createAdjustOut:', err)
    return { success: false, error: 'Unexpected error' }
  }
}

/**
 * Fetch adjustment records for the current user, newest first.
 */
export async function getAdjustments(limit = 100): Promise<{
  success: boolean
  error?: string
  data: Array<{
    id: string
    sku_internal: string
    adjustment_type: string
    quantity: number
    reason: string
    adjusted_at: string
    layer_id: string | null
    created_at: string
  }>
}> {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Not authenticated', data: [] }

    const { data, error } = await supabase
      .from('inventory_adjustments')
      .select('id, sku_internal, adjustment_type, quantity, reason, adjusted_at, layer_id, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      return { success: false, error: error.message, data: [] }
    }

    return { success: true, data: data ?? [] }
  } catch (err) {
    console.error('Unexpected error in getAdjustments:', err)
    return { success: false, error: 'Unexpected error', data: [] }
  }
}

// ============================================
// Admin: Reset COGS Ledger (service-role, admin only)
// ============================================

import { createServiceClient } from '@/lib/supabase/service'

/**
 * Admin-only: Reset COGS ledger and rebuild receipt-layer state.
 *
 * Mirrors migration-086 logic but runs from the application layer via service role.
 * Safe to run at any time — derives source-of-truth from receipt layers + adjustments.
 *
 * WHAT THIS DOES:
 *   1. DELETE inventory_cogs_allocations (re-computable)
 *   2. DELETE inventory_cost_snapshots   (re-computable by AVG method)
 *   3. RESTORE qty_remaining = qty_received on all non-voided receipt layers
 *   4. REPLAY ADJUST_OUT drains (FIFO order) to re-apply manual stock-outs
 *   5. Mark stale 'running' cogs_allocation_runs as 'failed'
 *
 * WHAT THIS DOES NOT TOUCH:
 *   inventory_receipt_layers rows (not deleted — stock receipts are source of truth)
 *   inventory_adjustments rows (not deleted — audit trail)
 *   inventory_items, inventory_bundle_components, sales_orders
 *
 * After running: trigger Apply COGS (MTD) from the UI to rebuild allocations.
 */
export async function adminResetCogsLedger(): Promise<{
  success: boolean
  error?: string
  summary?: {
    allocations_deleted: number
    snapshots_deleted: number
    layers_restored: number
    adjust_outs_replayed: number
    stale_runs_failed: number
  }
}> {
  try {
    const supabase = createClient()

    // Auth + admin check (user session)
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Not authenticated' }

    const adminResult = await checkIsInventoryAdmin()
    if (!adminResult.success || !adminResult.isAdmin) {
      return { success: false, error: 'Admin permission required' }
    }

    // Service role client — bypasses RLS for reset writes
    const svc = createServiceClient()

    // 1. Delete all COGS allocations
    const { count: allocCount, error: allocErr } = await svc
      .from('inventory_cogs_allocations')
      .delete({ count: 'exact' })
      .eq('created_by', user.id)
    if (allocErr) return { success: false, error: `Failed to delete allocations: ${allocErr.message}` }

    // 2. Delete all cost snapshots
    const { count: snapCount, error: snapErr } = await svc
      .from('inventory_cost_snapshots')
      .delete({ count: 'exact' })
      .eq('created_by', user.id)
    if (snapErr) return { success: false, error: `Failed to delete snapshots: ${snapErr.message}` }

    // 3. Restore qty_remaining = qty_received on all non-voided layers
    const { data: layers, error: layerFetchErr } = await svc
      .from('inventory_receipt_layers')
      .select('id, qty_received')
      .eq('created_by', user.id)
      .eq('is_voided', false)
    if (layerFetchErr) return { success: false, error: `Failed to fetch layers: ${layerFetchErr.message}` }

    let layersRestored = 0
    if (layers && layers.length > 0) {
      for (const layer of layers) {
        const { error: restoreErr } = await svc
          .from('inventory_receipt_layers')
          .update({ qty_remaining: layer.qty_received })
          .eq('id', layer.id)
        if (restoreErr) {
          console.error(`Failed to restore layer ${layer.id}:`, restoreErr.message)
        } else {
          layersRestored++
        }
      }
    }

    // 4. Replay ADJUST_OUT drains in chronological FIFO order
    const { data: adjOuts, error: adjFetchErr } = await svc
      .from('inventory_adjustments')
      .select('id, sku_internal, quantity, adjusted_at')
      .eq('created_by', user.id)
      .eq('adjustment_type', 'ADJUST_OUT')
      .order('adjusted_at', { ascending: true })
    if (adjFetchErr) return { success: false, error: `Failed to fetch adjustments: ${adjFetchErr.message}` }

    let adjOutsReplayed = 0
    for (const adj of adjOuts ?? []) {
      let remaining = adj.quantity

      // Fetch and drain FIFO layers for this SKU
      const { data: skuLayers, error: skuLayerErr } = await svc
        .from('inventory_receipt_layers')
        .select('id, qty_remaining')
        .eq('sku_internal', adj.sku_internal)
        .eq('created_by', user.id)
        .eq('is_voided', false)
        .gt('qty_remaining', 0)
        .order('received_at', { ascending: true })

      if (skuLayerErr) {
        console.error(`Replay ADJUST_OUT ${adj.id}: layer fetch error`, skuLayerErr.message)
        continue
      }

      for (const sl of skuLayers ?? []) {
        if (remaining <= 0) break
        const drain = Math.min(remaining, Number(sl.qty_remaining))
        await svc
          .from('inventory_receipt_layers')
          .update({ qty_remaining: Number(sl.qty_remaining) - drain })
          .eq('id', sl.id)
        remaining -= drain
      }

      if (remaining > 0) {
        console.warn(`Replay ADJUST_OUT ${adj.id}: SKU=${adj.sku_internal} still needed ${remaining} units after all layers — deficit left as-is`)
      }

      adjOutsReplayed++
    }

    // 5. Mark stale 'running' cogs_allocation_runs as failed
    const { count: staleCount, error: staleErr } = await svc
      .from('cogs_allocation_runs')
      .update({
        status: 'failed',
        error_message: 'Retroactively failed by adminResetCogsLedger — ledger was reset',
        updated_at: new Date().toISOString(),
      }, { count: 'exact' })
      .eq('created_by', user.id)
      .eq('status', 'running')
    if (staleErr) console.error('Failed to mark stale runs:', staleErr.message)

    revalidatePath('/inventory')

    return {
      success: true,
      summary: {
        allocations_deleted: allocCount ?? 0,
        snapshots_deleted:   snapCount  ?? 0,
        layers_restored:     layersRestored,
        adjust_outs_replayed: adjOutsReplayed,
        stale_runs_failed:   staleCount ?? 0,
      },
    }
  } catch (err) {
    console.error('Unexpected error in adminResetCogsLedger:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Unexpected error' }
  }
}

// ============================================
// Admin: Reset stale partial bundle allocations for a date range
// ============================================

/**
 * Admin-only: Clean up stale partial bundle allocations for a specific date range.
 *
 * "Partial" means: a bundle order has SOME but not ALL component SKUs allocated.
 * This is broken state — the order can never be correctly P&L'd and will block
 * future reruns from completing cleanly.
 *
 * WHAT THIS DOES (targeted — not a full ledger reset):
 *   1. Find all bundle orders in the date range
 *   2. For each: check if allocation is partial (some components allocated, not all)
 *   3. For each partial order:
 *      a. Restore qty_remaining on each consumed receipt layer (+= allocated qty)
 *      b. Delete the stale partial allocation rows for that order
 *   4. Mark failed cogs_allocation_runs for the date range with a reset note
 *      so the continue-offset logic won't try to resume a stale position
 *
 * WHAT THIS DOES NOT TOUCH:
 *   - Fully allocated (complete) bundle orders
 *   - Non-bundle order allocations
 *   - receipt layers source rows (never deleted)
 *   - inventory_adjustments (audit trail)
 *
 * After running: use applyCOGSMTD({ mode: 'fresh', startDate, endDate }) to rerun.
 */
export async function adminResetStaleCogsRange(
  dateFrom: string,
  dateTo: string
): Promise<{
  success: boolean
  error?: string
  summary?: {
    bundle_orders_checked: number
    partial_orders_found: number
    allocation_rows_deleted: number
    layers_restored: number
    runs_marked_reset: number
  }
}> {
  try {
    const supabase = createClient()

    // Auth + admin check
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Not authenticated' }

    const adminResult = await checkIsInventoryAdmin()
    if (!adminResult.success || !adminResult.isAdmin) {
      return { success: false, error: 'Admin permission required' }
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
      return { success: false, error: 'Invalid date format (expected YYYY-MM-DD)' }
    }

    const svc = createServiceClient()

    // ── 1. Fetch bundle SKUs + component map ──────────────────────────────────
    const { data: bundleItems } = await svc
      .from('inventory_items')
      .select('sku_internal')
      .eq('is_bundle', true)
    const bundleSkus = (bundleItems ?? []).map((i) => i.sku_internal)

    if (bundleSkus.length === 0) {
      return {
        success: true,
        summary: { bundle_orders_checked: 0, partial_orders_found: 0, allocation_rows_deleted: 0, layers_restored: 0, runs_marked_reset: 0 },
      }
    }

    const { data: allComponents } = await svc
      .from('inventory_bundle_components')
      .select('bundle_sku, component_sku')
      .in('bundle_sku', bundleSkus)

    const componentCountMap = new Map<string, number>()
    for (const c of allComponents ?? []) {
      componentCountMap.set(c.bundle_sku, (componentCountMap.get(c.bundle_sku) ?? 0) + 1)
    }

    // ── 2. Fetch bundle orders in date range (shipped, owned by this user) ────
    const { data: bundleOrders } = await svc
      .from('sales_orders')
      .select('id, seller_sku')
      .in('seller_sku', bundleSkus)
      .gte('order_date', `${dateFrom}T00:00:00+07:00`)
      .lte('order_date', `${dateTo}T23:59:59+07:00`)
      .not('shipped_at', 'is', null)
      .eq('created_by', user.id)
      .limit(2000)

    if (!bundleOrders || bundleOrders.length === 0) {
      return {
        success: true,
        summary: { bundle_orders_checked: 0, partial_orders_found: 0, allocation_rows_deleted: 0, layers_restored: 0, runs_marked_reset: 0 },
      }
    }

    const orderUuids = bundleOrders.map((o) => o.id)

    // ── 3. Fetch all allocation rows for those orders (one query) ─────────────
    const { data: allocations } = await svc
      .from('inventory_cogs_allocations')
      .select('id, order_id, sku_internal, qty, layer_id')
      .in('order_id', orderUuids)
      .eq('is_reversal', false)
      .eq('created_by', user.id)

    // Build per-order allocation map
    const orderAllocMap = new Map<string, Array<{ id: string; sku_internal: string; qty: number; layer_id: string | null }>>()
    for (const row of allocations ?? []) {
      const orderId = String(row.order_id)
      if (!orderAllocMap.has(orderId)) orderAllocMap.set(orderId, [])
      orderAllocMap.get(orderId)!.push({
        id: row.id,
        sku_internal: row.sku_internal,
        qty: Number(row.qty),
        layer_id: row.layer_id,
      })
    }

    // ── 4. Identify partial orders ────────────────────────────────────────────
    const partialOrders: Array<{ orderUuid: string; bundleSku: string }> = []
    for (const order of bundleOrders) {
      const expectedCount = componentCountMap.get(order.seller_sku) ?? 0
      const orderRows = orderAllocMap.get(order.id) ?? []
      const allocatedSkuCount = new Set(orderRows.map((r) => r.sku_internal)).size

      if (orderRows.length > 0 && allocatedSkuCount < expectedCount) {
        partialOrders.push({ orderUuid: order.id, bundleSku: order.seller_sku })
      }
    }

    // ── 5. Clean each partial order ───────────────────────────────────────────
    let allocationsDeleted = 0
    let layersRestored = 0

    for (const { orderUuid } of partialOrders) {
      const rows = orderAllocMap.get(orderUuid) ?? []

      // Restore qty_remaining for each layer referenced by a stale allocation row
      for (const row of rows) {
        if (!row.layer_id) continue
        const { data: layer } = await svc
          .from('inventory_receipt_layers')
          .select('qty_remaining')
          .eq('id', row.layer_id)
          .single()
        if (layer) {
          await svc
            .from('inventory_receipt_layers')
            .update({ qty_remaining: Number(layer.qty_remaining) + row.qty })
            .eq('id', row.layer_id)
          layersRestored++
        }
      }

      // Delete the stale allocation rows for this order
      const rowIds = rows.map((r) => r.id)
      if (rowIds.length > 0) {
        const { count } = await svc
          .from('inventory_cogs_allocations')
          .delete({ count: 'exact' })
          .in('id', rowIds)
        allocationsDeleted += count ?? 0
      }
    }

    // ── 6. Mark failed cogs_allocation_runs for this range as reset ───────────
    // This prevents the continue-offset logic from reading stale offsets.
    const { count: runsReset } = await svc
      .from('cogs_allocation_runs')
      .update({
        error_message: `Retroactively failed by adminResetStaleCogsRange (${dateFrom} – ${dateTo}) — ledger was reset`,
        updated_at: new Date().toISOString(),
      }, { count: 'exact' })
      .eq('created_by', user.id)
      .eq('status', 'failed')
      .eq('trigger_source', 'DATE_RANGE')
      .eq('date_from', dateFrom)
      .eq('date_to', dateTo)

    revalidatePath('/inventory')

    return {
      success: true,
      summary: {
        bundle_orders_checked: bundleOrders.length,
        partial_orders_found: partialOrders.length,
        allocation_rows_deleted: allocationsDeleted,
        layers_restored: layersRestored,
        runs_marked_reset: runsReset ?? 0,
      },
    }
  } catch (err) {
    console.error('Unexpected error in adminResetStaleCogsRange:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Unexpected error' }
  }
}
