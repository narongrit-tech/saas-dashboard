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
  tax: number
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
 * - Tax       = expenses WHERE category = 'Tax'
 * - Net       = GMV - AdSpend - COGS - Operating - Tax
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
    const [gmvByDate, cogsByDate, adRes, opRes, taxRes] = await Promise.all([
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

      supabase
        .from('expenses')
        .select('expense_date, amount')
        .gte('expense_date', startDateStr)
        .lte('expense_date', endDateStr)
        .eq('category', 'Tax'),
    ])

    if (adRes.error) throw new Error(`Wallet spend query failed: ${adRes.error.message}`)
    if (opRes.error) throw new Error(`Operating expenses query failed: ${opRes.error.message}`)
    if (taxRes.error) throw new Error(`Tax expenses query failed: ${taxRes.error.message}`)

    // Aggregate ad spend, operating, and tax per day
    // (GMV and COGS are already Maps from their respective fetch functions)
    const adByDate  = new Map<string, number>()
    const opByDate  = new Map<string, number>()
    const taxByDate = new Map<string, number>()

    adRes.data?.forEach((row) => {
      adByDate.set(row.date, (adByDate.get(row.date) || 0) + Math.max(0, row.amount || 0))
    })
    opRes.data?.forEach((row) => {
      opByDate.set(row.expense_date, (opByDate.get(row.expense_date) || 0) + Math.max(0, row.amount || 0))
    })
    taxRes.data?.forEach((row) => {
      taxByDate.set(row.expense_date, (taxByDate.get(row.expense_date) || 0) + Math.max(0, row.amount || 0))
    })

    // Build trend array
    const trend: PerformanceTrendDay[] = safeDays.map((d) => {
      const dateStr  = format(d, 'yyyy-MM-dd')
      const gmv      = round2(gmvByDate.get(dateStr) || 0)
      const adSpend  = round2(adByDate.get(dateStr) || 0)
      const cogs     = round2(Math.max(0, cogsByDate.get(dateStr) || 0))
      const op       = round2(opByDate.get(dateStr) || 0)
      const tax      = round2(taxByDate.get(dateStr) || 0)
      const net      = round2(gmv - adSpend - cogs - op - tax)
      return { date: format(d, 'dd/MM'), dateStr, gmv, adSpend, net }
    })

    // Summary totals
    const totalGMV     = safeDays.reduce((s, d) => s + Math.max(0, gmvByDate.get(format(d, 'yyyy-MM-dd'))   || 0), 0)
    const totalAdSpend = safeDays.reduce((s, d) => s + Math.max(0, adByDate.get(format(d, 'yyyy-MM-dd'))    || 0), 0)
    const totalCOGS    = safeDays.reduce((s, d) => s + Math.max(0, cogsByDate.get(format(d, 'yyyy-MM-dd'))  || 0), 0)
    const totalOp      = safeDays.reduce((s, d) => s + Math.max(0, opByDate.get(format(d, 'yyyy-MM-dd'))    || 0), 0)
    const totalTax     = safeDays.reduce((s, d) => s + Math.max(0, taxByDate.get(format(d, 'yyyy-MM-dd'))   || 0), 0)

    return {
      success: true,
      data: {
        summary: {
          gmv:        round2(totalGMV),
          adSpend:    round2(totalAdSpend),
          cogs:       round2(totalCOGS),
          operating:  round2(totalOp),
          tax:        round2(totalTax),
          netProfit:  round2(totalGMV - totalAdSpend - totalCOGS - totalOp - totalTax),
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

// ─── Operating Filter (row-level picker) ─────────────────────────────────────

/** Single Operating expense row returned to the picker modal. */
export interface OperatingExpenseRow {
  id: string
  expense_date: string
  subcategory: string | null
  amount: number
  description: string | null
  expense_status: 'DRAFT' | 'PAID'
  paid_date: string | null
  vendor: string | null
}

/**
 * Fetch Operating expense rows for the picker modal.
 * Always constrains to category = 'Operating' and [from, to] date range.
 * Returns up to pageSize rows (max 200) plus total count.
 */
export async function getOperatingExpenseRows(params: {
  from: string
  to: string
  status?: 'All' | 'DRAFT' | 'PAID'
  subcategory?: string       // exact match; omit / '' = all
  q?: string                 // search in description + notes
  page?: number              // 1-based, default 1
  pageSize?: number          // default 50, capped at 200
}): Promise<{ success: boolean; data?: { rows: OperatingExpenseRow[]; total: number }; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { from, to, status, subcategory, q, page = 1, pageSize = 50 } = params
    const safePgSz = Math.min(Math.max(pageSize, 1), 200)

    let query = supabase
      .from('expenses')
      .select('id, expense_date, subcategory, amount, description, expense_status, paid_date, vendor', { count: 'exact' })
      .eq('category', 'Operating')
      .gte('expense_date', from)
      .lte('expense_date', to)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (status && status !== 'All') {
      query = query.eq('expense_status', status)
    }
    if (subcategory && subcategory !== '' && subcategory !== 'All') {
      query = query.eq('subcategory', subcategory)
    }
    if (q && q.trim()) {
      query = query.or(`description.ilike.%${q.trim()}%,notes.ilike.%${q.trim()}%`)
    }

    const fromIdx = (page - 1) * safePgSz
    query = query.range(fromIdx, fromIdx + safePgSz - 1)

    const { data, error, count } = await query
    if (error) throw new Error(`Operating rows query failed: ${error.message}`)

    return {
      success: true,
      data: {
        rows: (data ?? []) as OperatingExpenseRow[],
        total: count ?? 0,
      },
    }
  } catch (error) {
    console.error('[getOperatingExpenseRows] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

/**
 * Payload for getOperatingFiltered — two mutually exclusive modes:
 *  'ids'  — sum exactly these expense IDs (RLS-safe; no date range needed)
 *  'all'  — sum all Operating in [from,to] matching optional filters,
 *            excluding the listed IDs (used for selectAll + excludedIds pattern)
 */
export type OperatingFilterPayload =
  | { mode: 'ids'; selectedIds: string[] }
  | {
      mode: 'all'
      excludedIds: string[]
      status?: 'DRAFT' | 'PAID'       // omit = all statuses
      subcategory?: string             // omit = all subcategories
      q?: string                       // omit = no text search
    }

/**
 * Compute the filtered Operating total server-side.
 * Supports two modes via OperatingFilterPayload (see type definition above).
 */
export async function getOperatingFiltered(
  from: string,
  to: string,
  payload: OperatingFilterPayload
): Promise<{ success: boolean; data?: { total: number }; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    let query = supabase.from('expenses').select('amount').eq('category', 'Operating')

    if (payload.mode === 'ids') {
      // Sum exact IDs — RLS still applies via auth
      query = query.in('id', payload.selectedIds)
    } else {
      // Sum all in range matching filters, minus excluded IDs
      query = query.gte('expense_date', from).lte('expense_date', to)
      if (payload.status) query = query.eq('expense_status', payload.status)
      if (payload.subcategory) query = query.eq('subcategory', payload.subcategory)
      if (payload.q?.trim()) {
        query = query.or(`description.ilike.%${payload.q.trim()}%,notes.ilike.%${payload.q.trim()}%`)
      }
      if (payload.excludedIds.length > 0) {
        query = query.filter('id', 'not.in', `(${payload.excludedIds.join(',')})`)
      }
    }

    const { data, error } = await query
    if (error) throw new Error(`Operating filtered query failed: ${error.message}`)

    const total = (data ?? []).reduce((s, row) => s + Math.max(0, (row.amount as number) || 0), 0)
    return { success: true, data: { total: round2(total) } }
  } catch (error) {
    console.error('[getOperatingFiltered] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

/**
 * Return sorted distinct subcategory values for Operating expenses in [from,to].
 * Called once when the picker modal opens to populate the subcategory dropdown.
 */
export async function getOperatingSubcategories(
  from: string,
  to: string
): Promise<{ success: boolean; data?: string[]; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    // Fetch only the subcategory column; Supabase may cap rows but subcategories
    // are a small distinct set — 1000 rows is far more than enough distinct values.
    const { data, error } = await supabase
      .from('expenses')
      .select('subcategory')
      .eq('category', 'Operating')
      .gte('expense_date', from)
      .lte('expense_date', to)
      .not('subcategory', 'is', null)
      .range(0, 999)

    if (error) throw new Error(`Subcategories query failed: ${error.message}`)

    const unique = Array.from(new Set((data ?? []).map((r) => r.subcategory as string))).sort()
    return { success: true, data: unique }
  } catch (error) {
    console.error('[getOperatingSubcategories] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

// ─── Expense Picker — Generalized (all categories) ────────────────────────────

/** Single expense row returned to the generic expense picker modal. */
export interface ExpensePickerRow {
  id: string
  expense_date: string
  category: string
  subcategory: string | null
  amount: number
  description: string | null
  expense_status: 'DRAFT' | 'PAID'
  paid_date: string | null
  vendor: string | null
}

/**
 * Fetch paginated expense rows for the picker modal.
 * category='ALL' (or omitted) means no category filter → all categories.
 */
export async function getExpensePickerRows(params: {
  from: string
  to: string
  category?: string            // 'ALL' or specific; omit/ALL = no filter
  status?: 'All' | 'DRAFT' | 'PAID'
  subcategory?: string         // 'ALL' or specific; omit/ALL = no filter
  q?: string
  page?: number                // 1-based
  pageSize?: number            // 10 | 25 | 50 | 100
}): Promise<{ success: boolean; data?: { rows: ExpensePickerRow[]; total: number }; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { from, to, category, status, subcategory, q, page = 1, pageSize = 25 } = params
    const safePgSz = ([10, 25, 50, 100] as number[]).includes(pageSize) ? pageSize : 25

    let query = supabase
      .from('expenses')
      .select(
        'id, expense_date, category, subcategory, amount, description, expense_status, paid_date, vendor',
        { count: 'exact' },
      )
      .gte('expense_date', from)
      .lte('expense_date', to)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (category && category !== 'ALL') query = query.eq('category', category)
    if (status && status !== 'All') query = query.eq('expense_status', status)
    if (subcategory && subcategory !== 'ALL') query = query.eq('subcategory', subcategory)
    if (q?.trim()) query = query.or(`description.ilike.%${q.trim()}%,notes.ilike.%${q.trim()}%`)

    const fromIdx = (page - 1) * safePgSz
    query = query.range(fromIdx, fromIdx + safePgSz - 1)

    const { data, error, count } = await query
    if (error) throw new Error(`Expense picker rows query failed: ${error.message}`)

    return { success: true, data: { rows: (data ?? []) as ExpensePickerRow[], total: count ?? 0 } }
  } catch (error) {
    console.error('[getExpensePickerRows] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

/**
 * Compute a filtered expense total server-side.
 * mode='all':  sum all rows matching [from,to] + filters, minus excludedIds
 * mode='some': sum exactly the given selectedIds (date range enforced for RLS safety)
 *
 * Uses range(0, 9999) — safe for a small-business dashboard (< 10,000 expenses in range).
 */
export async function getExpensePickerTotal(
  from: string,
  to: string,
  state: {
    mode: 'all' | 'some'
    category?: string
    status?: 'All' | 'DRAFT' | 'PAID'
    subcategory?: string
    q?: string
    selectedIds?: string[]
    excludedIds?: string[]
  },
): Promise<{ success: boolean; data?: { total: number }; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    if (state.mode === 'some') {
      const ids = state.selectedIds ?? []
      if (ids.length === 0) return { success: true, data: { total: 0 } }
      const { data, error } = await supabase
        .from('expenses')
        .select('amount')
        .in('id', ids)
        .gte('expense_date', from)
        .lte('expense_date', to)
        .range(0, Math.min(ids.length + 99, 4999))
      if (error) throw new Error(`Expense picker total (ids) failed: ${error.message}`)
      const total = (data ?? []).reduce((s, r) => s + Math.max(0, (r.amount as number) || 0), 0)
      return { success: true, data: { total: round2(total) } }
    }

    // mode = 'all'
    let query = supabase
      .from('expenses')
      .select('amount')
      .gte('expense_date', from)
      .lte('expense_date', to)

    if (state.category && state.category !== 'ALL') query = query.eq('category', state.category)
    if (state.status && state.status !== 'All') query = query.eq('expense_status', state.status)
    if (state.subcategory && state.subcategory !== 'ALL') query = query.eq('subcategory', state.subcategory)
    if (state.q?.trim()) query = query.or(`description.ilike.%${state.q.trim()}%,notes.ilike.%${state.q.trim()}%`)
    if ((state.excludedIds ?? []).length > 0) {
      query = query.filter('id', 'not.in', `(${state.excludedIds!.join(',')})`)
    }
    query = query.range(0, 9999)

    const { data, error } = await query
    if (error) throw new Error(`Expense picker total (all) failed: ${error.message}`)

    const total = (data ?? []).reduce((s, r) => s + Math.max(0, (r.amount as number) || 0), 0)
    return { success: true, data: { total: round2(total) } }
  } catch (error) {
    console.error('[getExpensePickerTotal] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

/**
 * Distinct subcategory values in [from,to], optionally filtered by category.
 * Used to populate the subcategory dropdown in the picker modal.
 */
export async function getExpensePickerSubcategories(
  from: string,
  to: string,
  category?: string,
): Promise<{ success: boolean; data?: string[]; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    let query = supabase
      .from('expenses')
      .select('subcategory')
      .gte('expense_date', from)
      .lte('expense_date', to)
      .not('subcategory', 'is', null)
      .range(0, 999)

    if (category && category !== 'ALL') query = query.eq('category', category)

    const { data, error } = await query
    if (error) throw new Error(`Expense picker subcategories query failed: ${error.message}`)

    const unique = Array.from(new Set((data ?? []).map((r) => r.subcategory as string))).sort()
    return { success: true, data: unique }
  } catch (error) {
    console.error('[getExpensePickerSubcategories] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

/**
 * Distinct category values for expenses in [from,to].
 * Used to populate the category dropdown in the picker modal.
 */
export async function getExpensePickerCategories(
  from: string,
  to: string,
): Promise<{ success: boolean; data?: string[]; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { data, error } = await supabase
      .from('expenses')
      .select('category')
      .gte('expense_date', from)
      .lte('expense_date', to)
      .not('category', 'is', null)
      .range(0, 999)

    if (error) throw new Error(`Expense picker categories query failed: ${error.message}`)

    const unique = Array.from(new Set((data ?? []).map((r) => r.category as string))).sort()
    return { success: true, data: unique }
  } catch (error) {
    console.error('[getExpensePickerCategories] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}
