'use server'

import { createClient } from '@/lib/supabase/server'
import { InternalAffiliate, CreateAffiliateInput, UpdateAffiliateInput, AffiliateReportSummary, AffiliateReportFilters } from '@/types/affiliates'
import { unstable_noStore as noStore } from 'next/cache'

interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Get all internal affiliates for current user
 */
export async function getInternalAffiliates(): Promise<ActionResult<InternalAffiliate[]>> {
  noStore() // Prevent caching
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    const { data, error } = await supabase
      .from('internal_affiliates')
      .select('*')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching internal affiliates:', error)
      return { success: false, error: `เกิดข้อผิดพลาด: ${error.message}` }
    }

    return { success: true, data: data as InternalAffiliate[] }
  } catch (error) {
    console.error('Unexpected error in getInternalAffiliates:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด'
    }
  }
}

/**
 * Create new internal affiliate
 */
export async function createInternalAffiliate(input: CreateAffiliateInput): Promise<ActionResult<InternalAffiliate>> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // Validate input
    if (!input.channel_id || input.channel_id.trim() === '') {
      return { success: false, error: 'กรุณากรอก Channel ID' }
    }

    // Check for duplicate channel_id
    const { data: existing } = await supabase
      .from('internal_affiliates')
      .select('id')
      .eq('created_by', user.id)
      .eq('channel_id', input.channel_id.trim())
      .single()

    if (existing) {
      return { success: false, error: 'Channel ID นี้มีอยู่แล้ว' }
    }

    // Insert
    const { data, error } = await supabase
      .from('internal_affiliates')
      .insert({
        channel_id: input.channel_id.trim(),
        display_name: input.display_name?.trim() || null,
        notes: input.notes?.trim() || null,
        created_by: user.id
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating affiliate:', error)
      return { success: false, error: `เกิดข้อผิดพลาด: ${error.message}` }
    }

    return { success: true, data: data as InternalAffiliate }
  } catch (error) {
    console.error('Unexpected error in createInternalAffiliate:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด'
    }
  }
}

/**
 * Update internal affiliate
 */
export async function updateInternalAffiliate(
  id: string,
  input: UpdateAffiliateInput
): Promise<ActionResult<InternalAffiliate>> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // Check if affiliate exists and belongs to user
    const { data: existing, error: fetchError } = await supabase
      .from('internal_affiliates')
      .select('id, created_by')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return { success: false, error: 'ไม่พบรายการ affiliate ที่ต้องการแก้ไข' }
    }

    if (existing.created_by !== user.id) {
      return { success: false, error: 'คุณไม่มีสิทธิ์แก้ไข affiliate นี้' }
    }

    // Build update object
    const updateData: any = {}
    if (input.channel_id !== undefined) updateData.channel_id = input.channel_id.trim()
    if (input.display_name !== undefined) updateData.display_name = input.display_name?.trim() || null
    if (input.is_active !== undefined) updateData.is_active = input.is_active
    if (input.notes !== undefined) updateData.notes = input.notes?.trim() || null

    // Check for duplicate channel_id (if changing)
    if (input.channel_id) {
      const { data: duplicate } = await supabase
        .from('internal_affiliates')
        .select('id')
        .eq('created_by', user.id)
        .eq('channel_id', input.channel_id.trim())
        .neq('id', id)
        .single()

      if (duplicate) {
        return { success: false, error: 'Channel ID นี้มีอยู่แล้ว' }
      }
    }

    // Update
    const { data, error } = await supabase
      .from('internal_affiliates')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating affiliate:', error)
      return { success: false, error: `เกิดข้อผิดพลาด: ${error.message}` }
    }

    return { success: true, data: data as InternalAffiliate }
  } catch (error) {
    console.error('Unexpected error in updateInternalAffiliate:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด'
    }
  }
}

/**
 * Delete internal affiliate
 */
export async function deleteInternalAffiliate(id: string): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // Check if affiliate exists and belongs to user
    const { data: existing, error: fetchError } = await supabase
      .from('internal_affiliates')
      .select('id, created_by')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return { success: false, error: 'ไม่พบรายการ affiliate ที่ต้องการลบ' }
    }

    if (existing.created_by !== user.id) {
      return { success: false, error: 'คุณไม่มีสิทธิ์ลบ affiliate นี้' }
    }

    // Delete
    const { error } = await supabase
      .from('internal_affiliates')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting affiliate:', error)
      return { success: false, error: `เกิดข้อผิดพลาด: ${error.message}` }
    }

    return { success: true }
  } catch (error) {
    console.error('Unexpected error in deleteInternalAffiliate:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด'
    }
  }
}

/**
 * Get affiliate performance report
 * Joins internal_affiliates with order_attribution to show GMV and commission breakdown
 */
export async function getAffiliateReport(
  filters: AffiliateReportFilters = {}
): Promise<ActionResult<AffiliateReportSummary[]>> {
  noStore() // Prevent caching
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // Build query to join internal_affiliates with order_attribution
    let query = supabase
      .from('internal_affiliates')
      .select(`
        channel_id,
        display_name,
        order_attribution!inner (
          order_id,
          commission_amt,
          commission_amt_organic,
          commission_amt_shop_ad
        )
      `)
      .eq('created_by', user.id)
      .eq('is_active', true)

    // Apply filters on order_attribution
    if (filters.startDate || filters.endDate) {
      // Need to filter by order date (requires join with sales_orders)
      // For now, we'll fetch all and filter client-side
      // TODO: Optimize with proper SQL join
    }

    if (filters.affiliateId) {
      query = query.eq('id', filters.affiliateId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching affiliate report:', error)
      return { success: false, error: `เกิดข้อผิดพลาด: ${error.message}` }
    }

    // Aggregate data per affiliate
    const affiliateMap = new Map<string, AffiliateReportSummary>()

    for (const row of data || []) {
      const channelId = row.channel_id
      if (!affiliateMap.has(channelId)) {
        affiliateMap.set(channelId, {
          channel_id: channelId,
          display_name: row.display_name,
          total_orders: 0,
          total_gmv: 0,
          commission_organic: 0,
          commission_shop_ad: 0,
          commission_total: 0,
          avg_commission_pct: 0
        })
      }

      const summary = affiliateMap.get(channelId)!
      const attribution = row.order_attribution as any

      if (Array.isArray(attribution)) {
        // Multiple orders for this affiliate
        for (const attr of attribution) {
          summary.total_orders += 1
          summary.commission_organic += attr.commission_amt_organic || 0
          summary.commission_shop_ad += attr.commission_amt_shop_ad || 0
          summary.commission_total += attr.commission_amt || 0
        }
      } else if (attribution) {
        // Single order
        summary.total_orders += 1
        summary.commission_organic += attribution.commission_amt_organic || 0
        summary.commission_shop_ad += attribution.commission_amt_shop_ad || 0
        summary.commission_total += attribution.commission_amt || 0
      }
    }

    // Convert to array and calculate avg commission %
    const report = Array.from(affiliateMap.values()).map(summary => ({
      ...summary,
      avg_commission_pct: summary.total_gmv > 0
        ? (summary.commission_total / summary.total_gmv) * 100
        : 0
    }))

    // Sort by commission total (descending)
    report.sort((a, b) => b.commission_total - a.commission_total)

    return { success: true, data: report }
  } catch (error) {
    console.error('Unexpected error in getAffiliateReport:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด'
    }
  }
}
