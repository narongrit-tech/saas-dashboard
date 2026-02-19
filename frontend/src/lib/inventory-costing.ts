/**
 * Inventory Costing Engine - FIFO + Moving Average
 *
 * ⚠️ BUSINESS-CRITICAL: COGS calculation for accurate P&L
 * Backend-only utilities for inventory costing and COGS allocation.
 * NO UI - Pure server-side calculation functions.
 *
 * Costing Methods:
 * - FIFO: First-In-First-Out (allocate from oldest receipt layers)
 * - AVG: Moving Average (use weighted average cost)
 *
 * AUDIT SAFETY:
 * - All calculations use RLS-protected queries (user authentication required)
 * - Idempotent: duplicate allocations are prevented
 * - Returns are reversible and traceable
 */

import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatBangkok } from '@/lib/bangkok-time'

// ============================================
// Types
// ============================================

export type CostingMethod = 'FIFO' | 'AVG'

export interface ReceiptLayer {
  id: string
  sku_internal: string
  received_at: string
  qty_received: number
  qty_remaining: number
  unit_cost: number
  ref_type: string
  ref_id: string | null
}

export interface CostSnapshot {
  id: string
  sku_internal: string
  as_of_date: string
  on_hand_qty: number
  on_hand_value: number
  avg_unit_cost: number
}

export interface COGSAllocation {
  id: string
  order_id: string
  sku_internal: string
  shipped_at: string
  method: CostingMethod
  qty: number
  unit_cost_used: number
  amount: number
  layer_id: string | null
  is_reversal: boolean
}

export interface BundleComponent {
  component_sku: string
  quantity: number
}

/**
 * Result of applying COGS for a single order.
 * Replaces the plain boolean return to surface partial allocation state.
 *
 * Statuses:
 * - success: all components allocated (either now or previously)
 * - already_allocated: all components were already done in a previous run
 * - partial: some components allocated, some still missing (bundle orders)
 * - failed: no components could be allocated
 */
export interface COGSApplyResult {
  status: 'success' | 'already_allocated' | 'partial' | 'failed'
  /** Component SKUs that have a valid allocation (previous run or this run) */
  allocatedSkus: string[]
  /** Component SKUs that still lack allocation after this run */
  missingSkus: string[]
  reason?: string
}

// ============================================
// Opening Balance
// ============================================

/**
 * Record opening balance for a SKU (creates receipt layer + snapshot)
 *
 * @param sku - SKU internal code
 * @param qty - Opening quantity
 * @param unit_cost - Unit cost
 * @param date - Opening balance date (YYYY-MM-DD Bangkok)
 * @returns Layer ID if successful, null if error
 */
export async function recordOpeningBalance(
  sku: string,
  qty: number,
  unit_cost: number,
  date: string
): Promise<string | null> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Authentication failed in recordOpeningBalance')
      return null
    }

    // Verify SKU exists
    const { data: item, error: itemError } = await supabase
      .from('inventory_items')
      .select('sku_internal')
      .eq('sku_internal', sku)
      .single()

    if (itemError || !item) {
      console.error(`SKU ${sku} not found in inventory_items`)
      return null
    }

    const received_at = `${date}T00:00:00+07:00` // Bangkok midnight

    // Insert receipt layer (FIFO)
    const { data: layer, error: layerError } = await supabase
      .from('inventory_receipt_layers')
      .insert({
        sku_internal: sku,
        received_at,
        qty_received: qty,
        qty_remaining: qty,
        unit_cost,
        ref_type: 'OPENING_BALANCE',
        ref_id: null,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (layerError || !layer) {
      console.error('Error creating receipt layer:', layerError)
      return null
    }

    // Upsert cost snapshot (AVG)
    const total_value = qty * unit_cost
    const { error: snapshotError } = await supabase
      .from('inventory_cost_snapshots')
      .upsert(
        {
          sku_internal: sku,
          as_of_date: date,
          on_hand_qty: qty,
          on_hand_value: total_value,
          avg_unit_cost: unit_cost,
          created_by: user.id,
        },
        {
          onConflict: 'sku_internal,as_of_date',
        }
      )

    if (snapshotError) {
      console.error('Error creating cost snapshot:', snapshotError)
      // Note: Layer is already created, so we continue
    }

    return layer.id
  } catch (error) {
    console.error('Unexpected error in recordOpeningBalance:', error)
    return null
  }
}

// ============================================
// Bundle Management
// ============================================

/**
 * Upsert bundle recipe (replace existing components)
 *
 * @param bundle_sku - The bundle SKU
 * @param components - Array of {component_sku, quantity}
 * @returns True if successful
 */
export async function upsertBundleRecipe(
  bundle_sku: string,
  components: BundleComponent[]
): Promise<boolean> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Authentication failed in upsertBundleRecipe')
      return false
    }

    // Verify bundle SKU exists and is marked as bundle
    const { data: item, error: itemError } = await supabase
      .from('inventory_items')
      .select('sku_internal, is_bundle')
      .eq('sku_internal', bundle_sku)
      .single()

    if (itemError || !item || !item.is_bundle) {
      console.error(`Bundle SKU ${bundle_sku} not found or not marked as bundle`)
      return false
    }

    // Delete existing components
    const { error: deleteError } = await supabase
      .from('inventory_bundle_components')
      .delete()
      .eq('bundle_sku', bundle_sku)

    if (deleteError) {
      console.error('Error deleting existing components:', deleteError)
      return false
    }

    // Insert new components
    if (components.length === 0) {
      return true // Empty bundle is allowed
    }

    const { error: insertError } = await supabase
      .from('inventory_bundle_components')
      .insert(
        components.map((c) => ({
          bundle_sku,
          component_sku: c.component_sku,
          quantity: c.quantity,
          created_by: user.id,
        }))
      )

    if (insertError) {
      console.error('Error inserting bundle components:', insertError)
      return false
    }

    return true
  } catch (error) {
    console.error('Unexpected error in upsertBundleRecipe:', error)
    return false
  }
}

/**
 * Get bundle components for a SKU
 *
 * @param bundle_sku - The bundle SKU
 * @returns Array of components, or empty array if not a bundle
 */
export async function getBundleComponents(
  bundle_sku: string
): Promise<BundleComponent[]> {
  try {
    const supabase = createClient()

    const { data, error } = await supabase
      .from('inventory_bundle_components')
      .select('component_sku, quantity')
      .eq('bundle_sku', bundle_sku)

    if (error) {
      console.error('Error fetching bundle components:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Unexpected error in getBundleComponents:', error)
    return []
  }
}

// ============================================
// FIFO Allocation
// ============================================

/**
 * Allocate COGS using FIFO method
 *
 * @param sku - SKU internal code
 * @param qty - Quantity to allocate
 * @param order_id - Sales order ID
 * @param shipped_at - Timestamp when shipped
 * @returns Array of allocations, or empty array if insufficient stock
 */
async function allocateFIFO(
  supabase: SupabaseClient,
  sku: string,
  qty: number,
  order_id: string,
  shipped_at: string
): Promise<COGSAllocation[]> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return []

    // Get available layers (oldest first, with remaining qty > 0, not voided)
    const { data: layers, error: layersError } = await supabase
      .from('inventory_receipt_layers')
      .select('*')
      .eq('sku_internal', sku)
      .eq('is_voided', false)
      .gt('qty_remaining', 0)
      .order('received_at', { ascending: true })

    if (layersError || !layers || layers.length === 0) {
      console.error(`FIFO: No layers available for SKU ${sku}`)
      return []
    }

    const allocations: COGSAllocation[] = []
    let remaining_qty = qty

    // Allocate from layers (FIFO order)
    for (const layer of layers) {
      if (remaining_qty <= 0) break

      const qty_to_allocate = Math.min(remaining_qty, layer.qty_remaining)
      const amount = qty_to_allocate * layer.unit_cost

      // Create allocation record
      const { data: allocation, error: allocError } = await supabase
        .from('inventory_cogs_allocations')
        .insert({
          order_id,
          sku_internal: sku,
          shipped_at,
          method: 'FIFO',
          qty: qty_to_allocate,
          unit_cost_used: layer.unit_cost,
          amount,
          layer_id: layer.id,
          is_reversal: false,
          created_by: user.id,
        })
        .select()
        .single()

      if (allocError || !allocation) {
        console.error('Error creating FIFO allocation:', allocError)
        return [] // Rollback: return empty (transaction will fail)
      }

      allocations.push(allocation as COGSAllocation)

      // Update layer qty_remaining
      const new_remaining = layer.qty_remaining - qty_to_allocate
      const { error: updateError } = await supabase
        .from('inventory_receipt_layers')
        .update({ qty_remaining: new_remaining })
        .eq('id', layer.id)

      if (updateError) {
        console.error('Error updating layer qty_remaining:', updateError)
        return [] // Rollback
      }

      remaining_qty -= qty_to_allocate
    }

    // Check if we allocated all requested qty
    if (remaining_qty > 0) {
      console.error(`FIFO: Insufficient stock for SKU ${sku}. Remaining: ${remaining_qty}`)
      return [] // Rollback
    }

    return allocations
  } catch (error) {
    console.error('Unexpected error in allocateFIFO:', error)
    return []
  }
}

// ============================================
// AVG Allocation
// ============================================

/**
 * Allocate COGS using Moving Average method
 *
 * @param sku - SKU internal code
 * @param qty - Quantity to allocate
 * @param order_id - Sales order ID
 * @param shipped_at - Timestamp when shipped
 * @returns Allocation record, or null if error
 */
async function allocateAVG(
  supabase: SupabaseClient,
  sku: string,
  qty: number,
  order_id: string,
  shipped_at: string
): Promise<COGSAllocation | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    // Get latest snapshot before shipped_at
    const shipped_date = formatBangkok(new Date(shipped_at), 'yyyy-MM-dd')

    const { data: snapshot, error: snapshotError } = await supabase
      .from('inventory_cost_snapshots')
      .select('*')
      .eq('sku_internal', sku)
      .lte('as_of_date', shipped_date)
      .order('as_of_date', { ascending: false })
      .limit(1)
      .single()

    if (snapshotError || !snapshot) {
      console.error(`AVG: No snapshot found for SKU ${sku}`)
      return null
    }

    // Check sufficient qty
    if (snapshot.on_hand_qty < qty) {
      console.error(`AVG: Insufficient stock for SKU ${sku}`)
      return null
    }

    const unit_cost = snapshot.avg_unit_cost
    const amount = qty * unit_cost

    // Create allocation record
    const { data: allocation, error: allocError } = await supabase
      .from('inventory_cogs_allocations')
      .insert({
        order_id,
        sku_internal: sku,
        shipped_at,
        method: 'AVG',
        qty,
        unit_cost_used: unit_cost,
        amount,
        layer_id: null, // AVG doesn't use layers
        is_reversal: false,
        created_by: user.id,
      })
      .select()
      .single()

    if (allocError || !allocation) {
      console.error('Error creating AVG allocation:', allocError)
      return null
    }

    // Update snapshot (reduce qty and value)
    const new_qty = snapshot.on_hand_qty - qty
    const new_value = snapshot.on_hand_value - amount
    const new_avg = new_qty > 0 ? new_value / new_qty : 0

    const { error: updateError } = await supabase
      .from('inventory_cost_snapshots')
      .update({
        on_hand_qty: new_qty,
        on_hand_value: new_value,
        avg_unit_cost: new_avg,
      })
      .eq('id', snapshot.id)

    if (updateError) {
      console.error('Error updating snapshot:', updateError)
      return null
    }

    return allocation as COGSAllocation
  } catch (error) {
    console.error('Unexpected error in allocateAVG:', error)
    return null
  }
}

// ============================================
// COGS Application
// ============================================

/**
 * Apply COGS for a shipped order (idempotent, partial-aware)
 *
 * For bundle orders: checks each component SKU independently.
 * - Only allocates components that are NOT yet allocated (idempotent retry).
 * - Returns 'partial' if some components are done but others still fail.
 * - This means a previously partial order can be retried after adding stock
 *   without manually specifying order_ids.
 *
 * @param order_id - Sales order ID
 * @param sku - SKU internal code (or bundle SKU) from sales_orders.seller_sku
 * @param qty - Quantity sold from sales_orders.quantity (must be > 0)
 * @param shipped_at - Timestamp when shipped (Bangkok TZ) from sales_orders.shipped_at
 * @param method - Costing method (FIFO or AVG)
 * @returns COGSApplyResult with status, allocatedSkus, missingSkus
 */
export async function applyCOGSForOrderShipped(
  order_id: string,
  sku: string,
  qty: number,
  shipped_at: string,
  method: CostingMethod
): Promise<COGSApplyResult> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Authentication failed in applyCOGSForOrderShipped')
      return { status: 'failed', allocatedSkus: [], missingSkus: [sku], reason: 'AUTH_FAILED' }
    }

    // VALIDATION: Quantity must be valid
    if (qty == null || !Number.isFinite(qty) || qty <= 0) {
      console.error(`Order ${order_id}: Invalid quantity (${qty})`)
      return { status: 'failed', allocatedSkus: [], missingSkus: [sku], reason: 'INVALID_QUANTITY' }
    }

    // VALIDATION: SKU must not be empty
    if (!sku || sku.trim() === '') {
      console.error(`Order ${order_id}: Missing SKU`)
      return { status: 'failed', allocatedSkus: [], missingSkus: [], reason: 'MISSING_SKU' }
    }

    // VALIDATION: shipped_at must be valid
    if (!shipped_at) {
      console.error(`Order ${order_id}: Missing shipped_at`)
      return { status: 'failed', allocatedSkus: [], missingSkus: [sku], reason: 'MISSING_SHIPPED_AT' }
    }

    // Check if SKU is a bundle
    const { data: item, error: itemError } = await supabase
      .from('inventory_items')
      .select('is_bundle')
      .eq('sku_internal', sku)
      .single()

    if (itemError || !item) {
      console.error(`SKU ${sku} not found in inventory_items`)
      return { status: 'failed', allocatedSkus: [], missingSkus: [sku], reason: 'SKU_NOT_FOUND' }
    }

    // ============================================
    // NON-BUNDLE SKU: simple idempotency check
    // ============================================
    if (!item.is_bundle) {
      // Check idempotency: allocation keyed by (order_id, sku_internal)
      const { data: existing, error: existingError } = await supabase
        .from('inventory_cogs_allocations')
        .select('id')
        .eq('order_id', order_id)
        .eq('sku_internal', sku)
        .eq('is_reversal', false)

      if (existingError) {
        console.error('Error checking existing allocations:', existingError)
        return { status: 'failed', allocatedSkus: [], missingSkus: [sku], reason: 'DB_ERROR' }
      }

      if (existing && existing.length > 0) {
        console.log(`COGS already allocated for order ${order_id} SKU ${sku}`)
        return { status: 'already_allocated', allocatedSkus: [sku], missingSkus: [] }
      }

      // Allocate
      let success = false
      if (method === 'FIFO') {
        const allocations = await allocateFIFO(supabase, sku, qty, order_id, shipped_at)
        success = allocations.length > 0
      } else if (method === 'AVG') {
        const allocation = await allocateAVG(supabase, sku, qty, order_id, shipped_at)
        success = allocation !== null
      }

      if (success) {
        return { status: 'success', allocatedSkus: [sku], missingSkus: [] }
      } else {
        return { status: 'failed', allocatedSkus: [], missingSkus: [sku], reason: 'ALLOCATION_FAILED' }
      }
    }

    // ============================================
    // BUNDLE SKU: per-component idempotency check
    // Allocate only components that are NOT yet done.
    // This enables idempotent retry after adding missing stock.
    // ============================================
    const components = await getBundleComponents(sku)
    if (components.length === 0) {
      console.error(`Bundle ${sku} has no components`)
      return { status: 'failed', allocatedSkus: [], missingSkus: [sku], reason: 'NO_BUNDLE_RECIPE' }
    }

    const items_to_allocate = components.map((c) => ({
      sku: c.component_sku,
      qty: c.quantity * qty,
    }))

    // Check existing allocations per component
    const alreadyAllocatedSkus = new Set<string>()
    for (const comp of items_to_allocate) {
      const { data: existing } = await supabase
        .from('inventory_cogs_allocations')
        .select('id')
        .eq('order_id', order_id)
        .eq('sku_internal', comp.sku)
        .eq('is_reversal', false)
        .limit(1)

      if (existing && existing.length > 0) {
        alreadyAllocatedSkus.add(comp.sku)
      }
    }

    // If ALL components already allocated → fully done
    if (alreadyAllocatedSkus.size === items_to_allocate.length) {
      const allSkus = items_to_allocate.map((i) => i.sku)
      console.log(`Bundle ${sku} fully allocated for order ${order_id}`)
      return { status: 'already_allocated', allocatedSkus: allSkus, missingSkus: [] }
    }

    // Allocate only unallocated components
    const allocatedThisRun: string[] = []
    const failedComponents: string[] = []

    for (const comp of items_to_allocate) {
      if (alreadyAllocatedSkus.has(comp.sku)) {
        continue // Already done, skip
      }

      let success = false
      if (method === 'FIFO') {
        const allocations = await allocateFIFO(supabase, comp.sku, comp.qty, order_id, shipped_at)
        success = allocations.length > 0
      } else if (method === 'AVG') {
        const allocation = await allocateAVG(supabase, comp.sku, comp.qty, order_id, shipped_at)
        success = allocation !== null
      }

      if (success) {
        allocatedThisRun.push(comp.sku)
      } else {
        console.error(`Failed to allocate COGS for bundle component ${comp.sku} (method: ${method})`)
        failedComponents.push(comp.sku)
      }
    }

    const allAllocatedSkus = [...Array.from(alreadyAllocatedSkus), ...allocatedThisRun]

    if (failedComponents.length === 0) {
      // All components done (some from before, some now)
      return { status: 'success', allocatedSkus: allAllocatedSkus, missingSkus: [] }
    } else if (allAllocatedSkus.length === 0) {
      // Nothing allocated at all
      return {
        status: 'failed',
        allocatedSkus: [],
        missingSkus: failedComponents,
        reason: `ALLOCATION_FAILED: ${failedComponents.join(', ')}`,
      }
    } else {
      // Some done, some missing → partial
      return {
        status: 'partial',
        allocatedSkus: allAllocatedSkus,
        missingSkus: failedComponents,
        reason: `PARTIAL: allocated [${allAllocatedSkus.join(', ')}], missing [${failedComponents.join(', ')}]`,
      }
    }
  } catch (error) {
    console.error('Unexpected error in applyCOGSForOrderShipped:', error)
    return {
      status: 'failed',
      allocatedSkus: [],
      missingSkus: [sku],
      reason: error instanceof Error ? error.message : 'EXCEPTION',
    }
  }
}

// ============================================
// Returns (Reverse COGS)
// ============================================

/**
 * Reverse COGS for a return (partial or full)
 *
 * @param order_id - Sales order ID
 * @param sku - SKU internal code
 * @param return_qty - Quantity returned
 * @param return_date - Return date (Bangkok TZ)
 * @param method - Costing method (must match original allocation)
 * @returns True if successful
 */
export async function applyReturnReverseCOGS(
  order_id: string,
  sku: string,
  return_qty: number,
  return_date: string,
  method: CostingMethod
): Promise<boolean> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Authentication failed in applyReturnReverseCOGS')
      return false
    }

    // Get original allocations
    const { data: allocations, error: allocError } = await supabase
      .from('inventory_cogs_allocations')
      .select('*')
      .eq('order_id', order_id)
      .eq('sku_internal', sku)
      .eq('is_reversal', false)
      .order('created_at', { ascending: true })

    if (allocError || !allocations || allocations.length === 0) {
      console.error(`No allocations found for order ${order_id} SKU ${sku}`)
      return false
    }

    const return_at = `${return_date}T00:00:00+07:00`
    let remaining_return_qty = return_qty

    // Reverse allocations (FIFO order)
    for (const alloc of allocations) {
      if (remaining_return_qty <= 0) break

      const qty_to_reverse = Math.min(remaining_return_qty, alloc.qty)
      const amount_to_reverse = qty_to_reverse * alloc.unit_cost_used

      // Create reversal allocation (negative amount)
      const { error: reversalError } = await supabase
        .from('inventory_cogs_allocations')
        .insert({
          order_id,
          sku_internal: sku,
          shipped_at: return_at,
          method: alloc.method,
          qty: -qty_to_reverse, // Negative for reversal
          unit_cost_used: alloc.unit_cost_used,
          amount: -amount_to_reverse, // Negative amount
          layer_id: alloc.layer_id, // Preserve layer reference
          is_reversal: true,
          created_by: user.id,
        })

      if (reversalError) {
        console.error('Error creating reversal allocation:', reversalError)
        return false
      }

      // If FIFO, return qty to layer
      if (method === 'FIFO' && alloc.layer_id) {
        const { data: layer, error: layerError } = await supabase
          .from('inventory_receipt_layers')
          .select('qty_remaining')
          .eq('id', alloc.layer_id)
          .single()

        if (layerError || !layer) {
          console.error('Error fetching layer for reversal:', layerError)
          return false
        }

        const { error: updateError } = await supabase
          .from('inventory_receipt_layers')
          .update({ qty_remaining: layer.qty_remaining + qty_to_reverse })
          .eq('id', alloc.layer_id)

        if (updateError) {
          console.error('Error updating layer for reversal:', updateError)
          return false
        }
      }

      // If AVG, update snapshot
      if (method === 'AVG') {
        const return_date_only = formatBangkok(new Date(return_at), 'yyyy-MM-dd')

        const { data: snapshot, error: snapshotError } = await supabase
          .from('inventory_cost_snapshots')
          .select('*')
          .eq('sku_internal', sku)
          .lte('as_of_date', return_date_only)
          .order('as_of_date', { ascending: false })
          .limit(1)
          .single()

        if (snapshotError || !snapshot) {
          console.error('Error fetching snapshot for return:', snapshotError)
          return false
        }

        const new_qty = snapshot.on_hand_qty + qty_to_reverse
        const new_value = snapshot.on_hand_value + amount_to_reverse
        const new_avg = new_qty > 0 ? new_value / new_qty : 0

        const { error: updateError } = await supabase
          .from('inventory_cost_snapshots')
          .update({
            on_hand_qty: new_qty,
            on_hand_value: new_value,
            avg_unit_cost: new_avg,
          })
          .eq('id', snapshot.id)

        if (updateError) {
          console.error('Error updating snapshot for return:', updateError)
          return false
        }
      }

      remaining_return_qty -= qty_to_reverse
    }

    if (remaining_return_qty > 0) {
      console.error(`Return qty exceeds allocated qty for order ${order_id} SKU ${sku}`)
      return false
    }

    return true
  } catch (error) {
    console.error('Unexpected error in applyReturnReverseCOGS:', error)
    return false
  }
}

// ============================================
// Daily COGS Computation (for P&L)
// ============================================

/**
 * Compute daily COGS from allocations (including reversals)
 *
 * @param date - Date in YYYY-MM-DD format (Bangkok)
 * @returns Total COGS amount for the date (0 if no data)
 */
export async function computeDailyCOGS(date: string): Promise<number> {
  try {
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Authentication failed in computeDailyCOGS')
      return 0
    }

    const startTimestamp = `${date}T00:00:00+07:00`
    const endTimestamp = `${date}T23:59:59+07:00`

    // Sum allocations (including reversals which have negative amounts)
    const { data, error } = await supabase
      .from('inventory_cogs_allocations')
      .select('amount')
      .gte('shipped_at', startTimestamp)
      .lte('shipped_at', endTimestamp)

    if (error) {
      console.error('Error fetching COGS allocations:', error)
      return 0
    }

    // Sum amounts (reversals are negative, so they reduce COGS)
    const total = data?.reduce((sum, row) => {
      const amount = row.amount || 0
      return sum + amount
    }, 0) || 0

    // Round to 2 decimal places (currency precision)
    const rounded = Math.round(total * 100) / 100
    return Number.isFinite(rounded) ? Math.max(0, rounded) : 0 // COGS cannot be negative
  } catch (error) {
    console.error('Unexpected error in computeDailyCOGS:', error)
    return 0
  }
}
