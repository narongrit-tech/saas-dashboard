'use server'

import { createClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'
import { th } from 'date-fns/locale'
import { getBangkokNow, startOfDayBangkok } from '@/lib/bangkok-time'

export interface PerformanceSummary {
  gmv: number
  adSpend: number
  cogs: number
  operating: number
  netProfit: number
  roas: number
  startDate: string
  endDate: string
}

export interface PerformanceTrendDay {
  date: string      // short label e.g. "จ"
  dateStr: string   // YYYY-MM-DD
  gmv: number
  adSpend: number
  net: number
}

export interface PerformanceDashboardData {
  summary: PerformanceSummary
  trend: PerformanceTrendDay[]
}

/**
 * Get Performance Dashboard data for last 7 days (Bangkok timezone)
 *
 * Formula (Economic P&L):
 * - GMV      = sales_orders (exclude cancelled)
 * - Ad Spend = ad_daily_performance.spend
 * - COGS     = inventory_cogs_allocations.amount
 * - Operating = expenses WHERE category = 'Operating'
 * - Net       = GMV - AdSpend - COGS - Operating
 * - ROAS      = GMV / AdSpend
 */
export async function getPerformanceDashboard(): Promise<{
  success: boolean
  data?: PerformanceDashboardData
  error?: string
}> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    const today = getBangkokNow()

    // Build last 7 days array (day-6 … today)
    const last7Days: Date[] = []
    for (let i = 6; i >= 0; i--) {
      last7Days.push(startOfDayBangkok(subDays(today, i)))
    }

    const startDateStr = format(last7Days[0], 'yyyy-MM-dd')
    const endDateStr = format(today, 'yyyy-MM-dd')
    const startTimestamp = `${startDateStr}T00:00:00+07:00`
    const endTimestamp = `${endDateStr}T23:59:59+07:00`

    // --- Fetch all sources in parallel ---
    const [salesRes, adRes, cogsRes, opRes] = await Promise.all([
      supabase
        .from('sales_orders')
        .select('order_date, total_amount')
        .gte('order_date', startTimestamp)
        .lte('order_date', endTimestamp)
        .neq('status', 'cancelled'),

      supabase
        .from('ad_daily_performance')
        .select('ad_date, spend')
        .gte('ad_date', startDateStr)
        .lte('ad_date', endDateStr),

      supabase
        .from('inventory_cogs_allocations')
        .select('shipped_at, amount')
        .gte('shipped_at', startTimestamp)
        .lte('shipped_at', endTimestamp),

      supabase
        .from('expenses')
        .select('expense_date, amount')
        .gte('expense_date', startDateStr)
        .lte('expense_date', endDateStr)
        .eq('category', 'Operating'),
    ])

    if (salesRes.error) throw new Error(`Sales query failed: ${salesRes.error.message}`)
    if (adRes.error) throw new Error(`Ads query failed: ${adRes.error.message}`)
    if (cogsRes.error) throw new Error(`COGS query failed: ${cogsRes.error.message}`)
    if (opRes.error) throw new Error(`Operating expenses query failed: ${opRes.error.message}`)

    // --- Aggregate per day ---
    const gmvByDate = new Map<string, number>()
    const adByDate = new Map<string, number>()
    const cogsByDate = new Map<string, number>()
    const opByDate = new Map<string, number>()

    salesRes.data?.forEach((row) => {
      const date = row.order_date.split('T')[0]
      gmvByDate.set(date, (gmvByDate.get(date) || 0) + Math.max(0, row.total_amount || 0))
    })

    adRes.data?.forEach((row) => {
      const date = row.ad_date
      adByDate.set(date, (adByDate.get(date) || 0) + Math.max(0, row.spend || 0))
    })

    cogsRes.data?.forEach((row) => {
      const date = row.shipped_at.split('T')[0]
      // COGS allocations can include reversals (negative), sum them as-is
      cogsByDate.set(date, (cogsByDate.get(date) || 0) + (row.amount || 0))
    })

    opRes.data?.forEach((row) => {
      const date = row.expense_date
      opByDate.set(date, (opByDate.get(date) || 0) + Math.max(0, row.amount || 0))
    })

    // --- Build trend array ---
    const trend: PerformanceTrendDay[] = last7Days.map((d) => {
      const dateStr = format(d, 'yyyy-MM-dd')
      const dayLabel = format(d, 'EEE', { locale: th })
      const gmv = Math.round((gmvByDate.get(dateStr) || 0) * 100) / 100
      const adSpend = Math.round((adByDate.get(dateStr) || 0) * 100) / 100
      const cogs = Math.round(Math.max(0, cogsByDate.get(dateStr) || 0) * 100) / 100
      const op = Math.round((opByDate.get(dateStr) || 0) * 100) / 100
      const net = Math.round((gmv - adSpend - cogs - op) * 100) / 100
      return { date: dayLabel, dateStr, gmv, adSpend, net }
    })

    // --- Summary totals ---
    const totalGMV = last7Days.reduce(
      (s, d) => s + Math.max(0, gmvByDate.get(format(d, 'yyyy-MM-dd')) || 0),
      0
    )
    const totalAdSpend = last7Days.reduce(
      (s, d) => s + Math.max(0, adByDate.get(format(d, 'yyyy-MM-dd')) || 0),
      0
    )
    const totalCOGS = last7Days.reduce((s, d) => {
      const raw = cogsByDate.get(format(d, 'yyyy-MM-dd')) || 0
      return s + Math.max(0, raw)
    }, 0)
    const totalOp = last7Days.reduce(
      (s, d) => s + Math.max(0, opByDate.get(format(d, 'yyyy-MM-dd')) || 0),
      0
    )

    const round2 = (n: number) => Math.round(n * 100) / 100

    const netProfit = round2(totalGMV - totalAdSpend - totalCOGS - totalOp)
    const roas = totalAdSpend > 0 ? round2(totalGMV / totalAdSpend) : 0

    return {
      success: true,
      data: {
        summary: {
          gmv: round2(totalGMV),
          adSpend: round2(totalAdSpend),
          cogs: round2(totalCOGS),
          operating: round2(totalOp),
          netProfit,
          roas,
          startDate: startDateStr,
          endDate: endDateStr,
        },
        trend,
      },
    }
  } catch (error) {
    console.error('[getPerformanceDashboard] error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}
