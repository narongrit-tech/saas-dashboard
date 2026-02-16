'use server'

import { createClient } from '@/lib/supabase/server'
import { unstable_noStore as noStore } from 'next/cache'

export interface AffiliatePerformance {
  channel_id: string
  display_name: string | null
  is_internal: boolean
  total_orders: number
  total_gmv: number
  commission_organic: number
  commission_shop_ad: number
  commission_total: number
  avg_order_value: number
}

export interface AffiliateReportData {
  internal_rows: AffiliatePerformance[]
  external_aggregate: {
    total_count: number
    total_orders: number
    total_gmv: number
    commission_organic: number
    commission_shop_ad: number
    commission_total: number
  }
  external_top10: AffiliatePerformance[]
}

export interface AffiliateReportFilters {
  startDate?: string
  endDate?: string
  includeExternal?: boolean // Include external affiliates (not in internal_affiliates table)
}

interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Get comprehensive affiliate performance report
 * Joins order_attribution with sales_orders to calculate GMV
 * Shows both internal affiliates and external affiliates
 */
export async function getAffiliatePerformanceReport(
  filters: AffiliateReportFilters = {}
): Promise<ActionResult<AffiliatePerformance[]>> {
  noStore()
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // Step 1: Get internal affiliates list
    const { data: internalAffiliates } = await supabase
      .from('internal_affiliates')
      .select('channel_id, display_name')
      .eq('created_by', user.id)
      .eq('is_active', true)

    const internalChannelIds = new Set(
      (internalAffiliates || []).map(a => a.channel_id)
    )

    // Step 2: Get order_attribution data
    let attrQuery = supabase
      .from('order_attribution')
      .select('order_id, affiliate_channel_id, commission_amt, commission_amt_organic, commission_amt_shop_ad')
      .eq('created_by', user.id)
      .not('affiliate_channel_id', 'is', null)

    const { data: attributions, error: attrError } = await attrQuery

    if (attrError) {
      console.error('Error fetching order attribution:', attrError)
      return { success: false, error: `เกิดข้อผิดพลาด: ${attrError.message}` }
    }

    if (!attributions || attributions.length === 0) {
      return { success: true, data: [] }
    }

    // Step 3: Get sales_orders data (for GMV calculation)
    const orderIds = Array.from(new Set(attributions.map(a => a.order_id)))

    // Fetch in batches (max 200 per query to avoid PostgREST limits)
    const batchSize = 200
    const orderBatches = []
    for (let i = 0; i < orderIds.length; i += batchSize) {
      orderBatches.push(orderIds.slice(i, i + batchSize))
    }

    let allOrders: any[] = []
    for (const batch of orderBatches) {
      // Query by order_id
      let orderQuery1 = supabase
        .from('sales_orders')
        .select('order_id, external_order_id, total_amount, order_date')
        .eq('created_by', user.id)
        .in('order_id', batch)

      // Apply date filters
      if (filters.startDate) {
        orderQuery1 = orderQuery1.gte('order_date', filters.startDate)
      }
      if (filters.endDate) {
        orderQuery1 = orderQuery1.lte('order_date', filters.endDate)
      }

      // Query by external_order_id
      let orderQuery2 = supabase
        .from('sales_orders')
        .select('order_id, external_order_id, total_amount, order_date')
        .eq('created_by', user.id)
        .in('external_order_id', batch)

      // Apply date filters
      if (filters.startDate) {
        orderQuery2 = orderQuery2.gte('order_date', filters.startDate)
      }
      if (filters.endDate) {
        orderQuery2 = orderQuery2.lte('order_date', filters.endDate)
      }

      // Execute both queries in parallel
      const [result1, result2] = await Promise.all([orderQuery1, orderQuery2])

      if (result1.data) {
        allOrders = allOrders.concat(result1.data)
      }
      if (result2.data) {
        allOrders = allOrders.concat(result2.data)
      }

      if (result1.error) {
        console.error('Error fetching sales orders by order_id:', result1.error)
      }
      if (result2.error) {
        console.error('Error fetching sales orders by external_order_id:', result2.error)
      }
    }

    // Deduplicate orders (same order might match both order_id and external_order_id)
    const uniqueOrders = Array.from(
      new Map(allOrders.map(o => [o.order_id, o])).values()
    )

    // Build order map (map both order_id and external_order_id to order data)
    const orderMap = new Map<string, any>()
    for (const order of uniqueOrders) {
      if (order.order_id) {
        orderMap.set(order.order_id, order)
      }
      if (order.external_order_id) {
        orderMap.set(order.external_order_id, order)
      }
    }

    // Step 4: Aggregate data per affiliate
    const affiliateMap = new Map<string, AffiliatePerformance>()

    for (const attr of attributions) {
      const channelId = attr.affiliate_channel_id || 'unknown'
      const isInternal = internalChannelIds.has(channelId)

      // Skip external affiliates if filter is set
      if (!filters.includeExternal && !isInternal) {
        continue
      }

      // Find matching order
      const order = orderMap.get(attr.order_id)
      if (!order) {
        // Order not found or filtered out by date range
        continue
      }

      if (!affiliateMap.has(channelId)) {
        // Find display name from internal_affiliates
        const internalAffiliate = internalAffiliates?.find(a => a.channel_id === channelId)

        affiliateMap.set(channelId, {
          channel_id: channelId,
          display_name: internalAffiliate?.display_name || null,
          is_internal: isInternal,
          total_orders: 0,
          total_gmv: 0,
          commission_organic: 0,
          commission_shop_ad: 0,
          commission_total: 0,
          avg_order_value: 0
        })
      }

      const performance = affiliateMap.get(channelId)!

      performance.total_orders += 1
      performance.total_gmv += order.total_amount || 0
      performance.commission_organic += attr.commission_amt_organic || 0
      performance.commission_shop_ad += attr.commission_amt_shop_ad || 0
      performance.commission_total += attr.commission_amt || 0
    }

    // Step 4: Calculate averages and sort
    const report = Array.from(affiliateMap.values()).map(perf => ({
      ...perf,
      avg_order_value: perf.total_orders > 0 ? perf.total_gmv / perf.total_orders : 0
    }))

    // Sort by commission total (descending)
    report.sort((a, b) => b.commission_total - a.commission_total)

    console.log('[Affiliate Report] Generated report', {
      totalAffiliates: report.length,
      internalCount: report.filter(r => r.is_internal).length,
      externalCount: report.filter(r => !r.is_internal).length,
      totalCommission: report.reduce((sum, r) => sum + r.commission_total, 0)
    })

    return { success: true, data: report }
  } catch (error) {
    console.error('Unexpected error in getAffiliatePerformanceReport:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด'
    }
  }
}

/**
 * Get summary stats for affiliate report
 */
export async function getAffiliateReportSummary(
  filters: AffiliateReportFilters = {}
): Promise<ActionResult<{
  total_affiliates: number
  total_orders: number
  total_gmv: number
  total_commission: number
  commission_organic: number
  commission_shop_ad: number
}>> {
  noStore()
  try {
    const result = await getAffiliatePerformanceReport(filters)

    if (!result.success || !result.data) {
      return { success: false, error: result.error }
    }

    const summary = result.data.reduce(
      (acc, perf) => ({
        total_affiliates: acc.total_affiliates + 1,
        total_orders: acc.total_orders + perf.total_orders,
        total_gmv: acc.total_gmv + perf.total_gmv,
        total_commission: acc.total_commission + perf.commission_total,
        commission_organic: acc.commission_organic + perf.commission_organic,
        commission_shop_ad: acc.commission_shop_ad + perf.commission_shop_ad
      }),
      {
        total_affiliates: 0,
        total_orders: 0,
        total_gmv: 0,
        total_commission: 0,
        commission_organic: 0,
        commission_shop_ad: 0
      }
    )

    return { success: true, data: summary }
  } catch (error) {
    console.error('Unexpected error in getAffiliateReportSummary:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด'
    }
  }
}

/**
 * Get structured affiliate report data with internal/external separation
 * Returns internal affiliates as individual rows, external as aggregate + top 10
 */
export async function getAffiliateReportStructured(
  filters: AffiliateReportFilters = {}
): Promise<ActionResult<AffiliateReportData>> {
  noStore()
  try {
    const result = await getAffiliatePerformanceReport({ ...filters, includeExternal: true })

    if (!result.success || !result.data) {
      return { success: false, error: result.error }
    }

    const allData = result.data

    // Separate internal and external
    const internal_rows = allData.filter(p => p.is_internal)
    const external_rows = allData.filter(p => !p.is_internal)

    // Sort internal by commission_total descending
    internal_rows.sort((a, b) => b.commission_total - a.commission_total)

    // Sort external by commission_total descending and take top 10
    external_rows.sort((a, b) => b.commission_total - a.commission_total)
    const external_top10 = external_rows.slice(0, 10)

    // Aggregate all external affiliates
    const external_aggregate = external_rows.reduce(
      (acc, perf) => ({
        total_count: acc.total_count + 1,
        total_orders: acc.total_orders + perf.total_orders,
        total_gmv: acc.total_gmv + perf.total_gmv,
        commission_organic: acc.commission_organic + perf.commission_organic,
        commission_shop_ad: acc.commission_shop_ad + perf.commission_shop_ad,
        commission_total: acc.commission_total + perf.commission_total
      }),
      {
        total_count: 0,
        total_orders: 0,
        total_gmv: 0,
        commission_organic: 0,
        commission_shop_ad: 0,
        commission_total: 0
      }
    )

    console.log('[Affiliate Report Structured]', {
      internal_count: internal_rows.length,
      external_count: external_aggregate.total_count,
      external_top10_count: external_top10.length
    })

    return {
      success: true,
      data: {
        internal_rows,
        external_aggregate,
        external_top10
      }
    }
  } catch (error) {
    console.error('Unexpected error in getAffiliateReportStructured:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด'
    }
  }
}
