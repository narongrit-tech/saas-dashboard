'use server'

import { createClient } from '@/lib/supabase/server'
import { format, subDays, addDays, parseISO, isValid, startOfDay } from 'date-fns'
import { getBangkokNow } from '@/lib/bangkok-time'
import { toBangkokDateString } from '@/lib/bangkok-date-range'
import { fetchGMVByDay, fetchGMVByDayPaid } from '@/lib/sales-metrics'

// ─── Shared Types ─────────────────────────────────────────────────────────────

export type GmvBasis  = 'created' | 'paid'
export type CogsBasis = 'shipped' | 'created'

export interface PerformanceSummary {
  gmv: number
  adSpend: number
  cogs: number
  operating: number
  netProfit: number
  roas: number
  startDate: string
  endDate: string
  gmvBasis: GmvBasis
  cogsBasis: CogsBasis
}

export interface PerformanceTrendDay {
  date: string      // chart x-axis label e.g. "01/03"
  dateStr: string   // YYYY-MM-DD
  gmv: number
  adSpend: number
  net: number
}

export interface AdsBreakdownRow {
  dateStr: string
  dayLabel: string  // dd/MM
  spend: number
  gmv: number       // attributed GMV from ad_daily_performance.revenue (0 if !hasRevenue)
  roas: number      // gmv / spend, 0 if spend=0 or !hasRevenue
}

export interface AdsBreakdownType {
  totalSpend: number
  totalGmv: number
  roas: number
  spendRange: { min: number; max: number }
  roasRange: { min: number; max: number }
  byDay: AdsBreakdownRow[]
  hasRevenue: boolean  // true if ad_daily_performance has rows for this date range + tab
}

export interface PerformanceDashboardData {
  summary: PerformanceSummary
  trend: PerformanceTrendDay[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Validate YYYY-MM-DD string (not future, not before 2020) */
function isValidDateParam(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = parseISO(s)
  if (!isValid(d)) return false
  if (d.getFullYear() < 2020) return false
  const today = getBangkokNow()
  today.setHours(23, 59, 59, 999)
  return d <= today
}

/** Build ordered Date[] from from..to (inclusive), capped at 365 days */
function buildDateRange(from: string, to: string): Date[] {
  const days: Date[] = []
  let cursor = startOfDay(parseISO(from))
  const endDay = startOfDay(parseISO(to))
  while (cursor <= endDay) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return days.slice(0, 365)
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Fetch COGS amounts bucketed by the order's creation date (COALESCE created_time, order_date).
 *
 * Used for cogsBasis='created' (decision view): shows COGS on the day the customer
 * ordered rather than the day the item shipped. Useful for aligning COGS with daily
 * ad spend / GMV when reviewing campaign performance.
 *
 * Implementation (orders-first, correct direction):
 *  1. Paginated query of sales_orders filtered by order_date in [from, to] (Bangkok)
 *  2. Client-side COALESCE(created_time, order_date) exact cohort filter
 *  3. Chunk-query inventory_cogs_allocations using .filter('order_id::text','in',...)
 *     (order_id is VARCHAR(100) storing sales_orders.id as UUID string)
 *  4. Bucket allocation amounts by the order's created date
 */
async function fetchCOGSByCreatedDate(
  supabase: ReturnType<typeof createClient>,
  from: string,
  to: string
): Promise<Map<string, number>> {
  const PAGE_SIZE = 1000

  // Step A: Paginated fetch of sales_orders with order_date in range
  const allOrderLines: Array<{ id: string; created_time: string | null; order_date: string | null }> = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('sales_orders')
      .select('id, created_time, order_date')
      .gte('order_date', `${from}T00:00:00+07:00`)
      .lte('order_date', `${to}T23:59:59.999+07:00`)
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw new Error(`COGS (created) order query failed: ${error.message}`)
    if (!data || data.length === 0) { hasMore = false; break }

    allOrderLines.push(...data)
    hasMore = data.length === PAGE_SIZE
    offset += PAGE_SIZE
  }

  // Client-side COALESCE(created_time, order_date) cohort filter → uuid → YYYY-MM-DD
  const orderCreatedMap = new Map<string, string>()
  for (const o of allOrderLines) {
    const effective = o.created_time || o.order_date
    if (!effective) continue
    const dateStr = toBangkokDateString(new Date(effective))
    if (dateStr >= from && dateStr <= to) orderCreatedMap.set(o.id, dateStr)
  }

  if (orderCreatedMap.size === 0) return new Map()

  // Step B: Chunk-query allocations using correct VARCHAR→UUID join pattern
  const orderUuids = [...orderCreatedMap.keys()]
  const cogsByDate  = new Map<string, number>()
  const CHUNK = 200
  let totalAllocRows = 0

  for (let i = 0; i < orderUuids.length; i += CHUNK) {
    const chunk = orderUuids.slice(i, i + CHUNK)
    const { data: allocData, error: allocError } = await supabase
      .from('inventory_cogs_allocations')
      .select('order_id, amount')
      .filter('order_id::text', 'in', `(${chunk.join(',')})`)

    if (allocError) throw new Error(`COGS allocation lookup failed: ${allocError.message}`)
    totalAllocRows += allocData?.length ?? 0

    for (const row of allocData ?? []) {
      const createdDate = orderCreatedMap.get(String(row.order_id))
      if (!createdDate) continue
      cogsByDate.set(createdDate, (cogsByDate.get(createdDate) || 0) + Math.max(0, row.amount || 0))
    }
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('[COGS] fetchCOGSByCreatedDate', {
      mode: 'created (COALESCE created_time, order_date)',
      range: `${from} → ${to}`,
      orderLines: allOrderLines.length,
      ordersInRange: orderCreatedMap.size,
      pages: Math.ceil(offset / PAGE_SIZE) || 1,
      allocRows: totalAllocRows,
    })
  }

  return cogsByDate
}

/** Fetch all active ADS wallet IDs for the authenticated user */
async function getAdsWalletIds(supabase: ReturnType<typeof createClient>): Promise<string[]> {
  const { data } = await supabase
    .from('wallets')
    .select('id')
    .eq('wallet_type', 'ADS')
    .eq('is_active', true)
  return (data ?? []).map((w: { id: string }) => w.id)
}

// ─── Performance Dashboard ─────────────────────────────────────────────────────

/**
 * Fetch summary cards + trend chart data for Performance Dashboard.
 *
 * Formula (Economic P&L):
 * - GMV      = sales_orders (exclude cancelled)
 * - Ad Spend = wallet_ledger SPEND/OUT from ADS wallets
 * - COGS     = inventory_cogs_allocations.amount
 * - Operating = expenses WHERE category = 'Operating'
 * - Net       = GMV - AdSpend - COGS - Operating
 * - ROAS      = GMV / AdSpend
 *
 * @param fromDate YYYY-MM-DD (Bangkok). Defaults to 6 days ago.
 * @param toDate   YYYY-MM-DD (Bangkok). Defaults to today.
 */
export async function getPerformanceDashboard(
  fromDate?: string,
  toDate?: string,
  gmvBasis: GmvBasis  = 'created',
  cogsBasis: CogsBasis = 'shipped'
): Promise<{ success: boolean; data?: PerformanceDashboardData; error?: string }> {
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
    const startDateStr = isValidDateParam(fromDate) ? fromDate : format(subDays(today, 6), 'yyyy-MM-dd')
    const endDateStr   = isValidDateParam(toDate)   ? toDate   : format(today, 'yyyy-MM-dd')
    const safeDays     = buildDateRange(startDateStr, endDateStr)

    const startTimestamp = `${startDateStr}T00:00:00+07:00`
    const endTimestamp   = `${endDateStr}T23:59:59+07:00`

    // Fetch ADS wallet IDs first (needed for spend query)
    const adsWalletIds = await getAdsWalletIds(supabase)

    // COGS promise — normalised to Map<string,number> for both modes
    const cogsMapPromise: Promise<Map<string, number>> = cogsBasis === 'created'
      ? fetchCOGSByCreatedDate(supabase, startDateStr, endDateStr)
      : supabase
          .from('inventory_cogs_allocations')
          .select('shipped_at, amount')
          .gte('shipped_at', startTimestamp)
          .lte('shipped_at', endTimestamp)
          .then((res) => {
            if (res.error) throw new Error(`COGS query failed: ${res.error.message}`)
            const m = new Map<string, number>()
            for (const row of res.data ?? []) {
              const date = (row.shipped_at as string).split('T')[0]
              m.set(date, (m.get(date) || 0) + Math.max(0, (row.amount as number) || 0))
            }
            return m
          })

    // Fetch all sources in parallel
    // GMV branches on gmvBasis; COGS branches on cogsBasis (both already Promises)
    const [gmvByDate, cogsByDate, adRes, opRes] = await Promise.all([
      gmvBasis === 'paid'
        ? fetchGMVByDayPaid(supabase, startDateStr, endDateStr)
        : fetchGMVByDay(supabase, startDateStr, endDateStr),

      cogsMapPromise,

      adsWalletIds.length > 0
        ? supabase
            .from('wallet_ledger')
            .select('date, amount')
            .in('wallet_id', adsWalletIds)
            .eq('entry_type', 'SPEND')
            .eq('direction', 'OUT')
            .gte('date', startDateStr)
            .lte('date', endDateStr)
        : Promise.resolve({ data: [] as Array<{ date: string; amount: number }>, error: null }),

      supabase
        .from('expenses')
        .select('expense_date, amount')
        .gte('expense_date', startDateStr)
        .lte('expense_date', endDateStr)
        .eq('category', 'Operating'),
    ])

    if (adRes.error) throw new Error(`Wallet spend query failed: ${adRes.error.message}`)
    if (opRes.error) throw new Error(`Operating expenses query failed: ${opRes.error.message}`)

    // Aggregate ad spend + operating per day
    // (GMV and COGS are already Maps from their respective fetch functions)
    const adByDate = new Map<string, number>()
    const opByDate = new Map<string, number>()

    adRes.data?.forEach((row) => {
      adByDate.set(row.date, (adByDate.get(row.date) || 0) + Math.max(0, row.amount || 0))
    })
    opRes.data?.forEach((row) => {
      opByDate.set(row.expense_date, (opByDate.get(row.expense_date) || 0) + Math.max(0, row.amount || 0))
    })

    // Build trend array
    const trend: PerformanceTrendDay[] = safeDays.map((d) => {
      const dateStr  = format(d, 'yyyy-MM-dd')
      const gmv      = round2(gmvByDate.get(dateStr) || 0)
      const adSpend  = round2(adByDate.get(dateStr) || 0)
      const cogs     = round2(Math.max(0, cogsByDate.get(dateStr) || 0))
      const op       = round2(opByDate.get(dateStr) || 0)
      const net      = round2(gmv - adSpend - cogs - op)
      return { date: format(d, 'dd/MM'), dateStr, gmv, adSpend, net }
    })

    // Summary totals
    const totalGMV     = safeDays.reduce((s, d) => s + Math.max(0, gmvByDate.get(format(d, 'yyyy-MM-dd'))  || 0), 0)
    const totalAdSpend = safeDays.reduce((s, d) => s + Math.max(0, adByDate.get(format(d, 'yyyy-MM-dd'))   || 0), 0)
    const totalCOGS    = safeDays.reduce((s, d) => s + Math.max(0, cogsByDate.get(format(d, 'yyyy-MM-dd')) || 0), 0)
    const totalOp      = safeDays.reduce((s, d) => s + Math.max(0, opByDate.get(format(d, 'yyyy-MM-dd'))   || 0), 0)

    return {
      success: true,
      data: {
        summary: {
          gmv:        round2(totalGMV),
          adSpend:    round2(totalAdSpend),
          cogs:       round2(totalCOGS),
          operating:  round2(totalOp),
          netProfit:  round2(totalGMV - totalAdSpend - totalCOGS - totalOp),
          roas:       totalAdSpend > 0 ? round2(totalGMV / totalAdSpend) : 0,
          startDate:  startDateStr,
          endDate:    endDateStr,
          gmvBasis,
          cogsBasis,
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

// ─── Ads Breakdown ─────────────────────────────────────────────────────────────

/**
 * Fetch Ads Breakdown for a specific tab (all / product / live).
 *
 * Spend source: wallet_ledger (ADS wallets, SPEND/OUT).
 * Tab split via note: "Product Ads Spend%" / "Live Ads Spend%".
 * Revenue source: ad_daily_performance.revenue (optional — may have 0 rows).
 *
 * @param from YYYY-MM-DD start date (Bangkok)
 * @param to   YYYY-MM-DD end date (Bangkok)
 * @param tab  'all' | 'product' | 'live'
 */
export async function getAdsBreakdown(
  from: string,
  to: string,
  tab: 'all' | 'product' | 'live'
): Promise<{ success: boolean; data?: AdsBreakdownType; error?: string }> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    if (!isValidDateParam(from) || !isValidDateParam(to)) {
      return { success: false, error: 'ช่วงวันที่ไม่ถูกต้อง' }
    }

    // Fetch ADS wallet IDs first
    const adsWalletIds = await getAdsWalletIds(supabase)

    // Build spend query from wallet_ledger with optional note filter for product/live
    const spendPromise = adsWalletIds.length > 0
      ? (() => {
          let q = supabase
            .from('wallet_ledger')
            .select('date, amount')
            .in('wallet_id', adsWalletIds)
            .eq('entry_type', 'SPEND')
            .eq('direction', 'OUT')
            .gte('date', from)
            .lte('date', to)
          if (tab === 'product') q = q.ilike('note', 'Product Ads Spend%')
          if (tab === 'live')    q = q.ilike('note', 'Live Ads Spend%')
          return q
        })()
      : Promise.resolve({ data: [] as Array<{ date: string; amount: number }>, error: null })

    // Fetch revenue from ad_daily_performance (optional — may have 0 rows)
    let revenueQuery = supabase
      .from('ad_daily_performance')
      .select('ad_date, revenue')
      .gte('ad_date', from)
      .lte('ad_date', to)
    if (tab !== 'all') {
      revenueQuery = revenueQuery.eq('campaign_type', tab)
    }

    const [spendRes, revenueRes] = await Promise.all([spendPromise, revenueQuery])

    if (spendRes.error)   throw new Error(`Wallet spend query failed: ${spendRes.error.message}`)
    if (revenueRes.error) throw new Error(`Revenue query failed: ${revenueRes.error.message}`)

    const hasRevenue = (revenueRes.data?.length ?? 0) > 0

    // Aggregate spend per date
    const spendByDate = new Map<string, number>()
    for (const row of spendRes.data ?? []) {
      spendByDate.set(row.date, (spendByDate.get(row.date) || 0) + Math.max(0, row.amount || 0))
    }

    // Aggregate revenue per date (only when hasRevenue)
    const gmvByDate = new Map<string, number>()
    if (hasRevenue) {
      for (const row of revenueRes.data ?? []) {
        gmvByDate.set(row.ad_date, (gmvByDate.get(row.ad_date) || 0) + Math.max(0, row.revenue || 0))
      }
    }

    // Build byDay for full date range
    const safeDays = buildDateRange(from, to)
    const byDay: AdsBreakdownRow[] = safeDays.map((d) => {
      const dateStr = format(d, 'yyyy-MM-dd')
      const spend   = round2(spendByDate.get(dateStr) ?? 0)
      const gmv     = hasRevenue ? round2(gmvByDate.get(dateStr) ?? 0) : 0
      return {
        dateStr,
        dayLabel: format(d, 'dd/MM'),
        spend,
        gmv,
        roas: spend > 0 && gmv > 0 ? round2(gmv / spend) : 0,
      }
    })

    const totalSpend = round2(byDay.reduce((s, r) => s + r.spend, 0))
    const totalGmv   = round2(byDay.reduce((s, r) => s + r.gmv, 0))
    const totalRoas  = totalSpend > 0 && totalGmv > 0 ? round2(totalGmv / totalSpend) : 0

    const activeDays     = byDay.filter((r) => r.spend > 0)
    const activeRoasDays = activeDays.filter((r) => r.roas > 0)

    const spendRange = activeDays.length > 0
      ? { min: Math.min(...activeDays.map((r) => r.spend)), max: Math.max(...activeDays.map((r) => r.spend)) }
      : { min: 0, max: 0 }

    const roasRange = activeRoasDays.length > 0
      ? { min: Math.min(...activeRoasDays.map((r) => r.roas)), max: Math.max(...activeRoasDays.map((r) => r.roas)) }
      : { min: 0, max: 0 }

    return {
      success: true,
      data: { totalSpend, totalGmv, roas: totalRoas, spendRange, roasRange, byDay, hasRevenue },
    }
  } catch (error) {
    console.error('[getAdsBreakdown] error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}
