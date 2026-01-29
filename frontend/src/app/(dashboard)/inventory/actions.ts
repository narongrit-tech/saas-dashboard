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
