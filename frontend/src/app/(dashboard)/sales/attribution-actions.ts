'use server'

/**
 * Attribution Actions for Sales Orders
 * Fetch attribution data in batch to avoid N+1 queries
 */

import { createClient } from '@/lib/supabase/server'
import { OrderAttribution } from '@/types/profit-reports'

/**
 * Batch fetch attributions for multiple order IDs
 * Returns a Map for efficient lookup
 */
export async function batchFetchAttributions(
  orderIds: string[]
): Promise<Map<string, OrderAttribution>> {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user || orderIds.length === 0) {
    return new Map()
  }

  const { data: attributions, error } = await supabase
    .from('order_attribution')
    .select('*')
    .eq('created_by', user.id)
    .in('order_id', orderIds)

  if (error) {
    console.error('Error fetching attributions:', error)
    return new Map()
  }

  // Convert to Map for O(1) lookup
  const attributionMap = new Map<string, OrderAttribution>()
  for (const attr of attributions || []) {
    attributionMap.set(attr.order_id, attr as OrderAttribution)
  }

  return attributionMap
}

/**
 * Get attribution for a single order
 */
export async function getOrderAttribution(orderId: string): Promise<OrderAttribution | null> {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data, error } = await supabase
    .from('order_attribution')
    .select('*')
    .eq('created_by', user.id)
    .eq('order_id', orderId)
    .single()

  if (error || !data) return null

  return data as OrderAttribution
}
