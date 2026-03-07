'use server'

import { createClient } from '@/lib/supabase/server'
import { format, subDays, addDays, parseISO, isValid, startOfDay } from 'date-fns'
import { getBangkokNow } from '@/lib/bangkok-time'
import { toBangkokDateString } from '@/lib/bangkok-date-range'
import { fetchGMVByDay, fetchGMVByDayPaid } from '@/lib/sales-metrics'

// ─── Shared Types ─────────────────────────────────────────────────────────────

export type GmvBasis      = 'created' | 'paid'
export type CogsBasis     = 'shipped' | 'created'
export type RevenueBasis     = 'gmv' | 'cashin' | 'bank'
export type RevenueChannel   = 'tiktok' | 'shopee' | 'other'

export interface MarketplaceCashIn {
  total:  number   // tiktok + shopee
  tiktok: number   // settlement_transactions.settlement_amount
  shopee: number   // shopee_order_settlements.net_payout
}

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

// ─── COGS Drilldown ────────────────────────────────────────────────────────────

/** Per-SKU allocation summary row (aggregated from inventory_cogs_allocations). */
export interface CogsAllocationRow {
  sku_internal: string
  qty_total: number       // net qty (Math.max(0,...) per row → excludes reversals, consistent with dashboard)
  total_cost: number      // net cost
  avg_unit_cost: number   // total_cost / qty_total
}

/** Per-subcategory COGS expense summary. */
export interface CogsExpensesBreakdownRow {
  subcategory: string     // '(ไม่ระบุ)' when null
  total: number
}

/**
 * Aggregate inventory_cogs_allocations by sku_internal for the given date range + basis.
 *
 * basis='shipped'  → filter by shipped_at timestamp in [from, to] (Bangkok)
 * basis='created'  → resolve sales_orders in [from, to] by COALESCE(created_time, order_date),
 *                    then chunk-query allocations by order UUID (mirrors fetchCOGSByCreatedDate)
 *
 * Uses Math.max(0, amount/qty) to match the dashboard COGS total exactly
 * (reversals are clamped to 0, not deducted).
 */
export async function getCogsAllocationBreakdown(params: {
  from: string
  to: string
  basis: CogsBasis  // 'shipped' | 'created'
}): Promise<{
  success: boolean
  data?: { rows: CogsAllocationRow[]; totalCost: number; totalQty: number }
  error?: string
}> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { from, to, basis } = params
    const skuMap = new Map<string, { qty: number; cost: number }>()

    const accumulate = (sku: string, qty: number, cost: number) => {
      const cur = skuMap.get(sku) ?? { qty: 0, cost: 0 }
      cur.qty  += Math.max(0, qty)
      cur.cost += Math.max(0, cost)
      skuMap.set(sku, cur)
    }

    if (basis === 'shipped') {
      // ── Shipped basis: direct filter by shipped_at ──────────────────────
      const startTs = `${from}T00:00:00+07:00`
      const endTs   = `${to}T23:59:59+07:00`

      const { data, error } = await supabase
        .from('inventory_cogs_allocations')
        .select('sku_internal, qty, amount')
        .gte('shipped_at', startTs)
        .lte('shipped_at', endTs)
        .range(0, 9999)

      if (error) throw new Error(`COGS allocation (shipped) failed: ${error.message}`)

      for (const row of data ?? []) {
        accumulate(row.sku_internal as string, Number(row.qty) || 0, Number(row.amount) || 0)
      }
    } else {
      // ── Order (created) basis: resolve orders first, then chunk-query allocations ──
      const PAGE_SIZE = 1000
      const allOrderIds: string[] = []
      let offset = 0
      let hasMore = true

      while (hasMore) {
        const { data: orders, error } = await supabase
          .from('sales_orders')
          .select('id, created_time, order_date')
          .gte('order_date', `${from}T00:00:00+07:00`)
          .lte('order_date', `${to}T23:59:59.999+07:00`)
          .range(offset, offset + PAGE_SIZE - 1)

        if (error) throw new Error(`COGS (order basis) order query failed: ${error.message}`)
        if (!orders || orders.length === 0) { hasMore = false; break }

        for (const o of orders) {
          const effective = o.created_time || o.order_date
          if (!effective) continue
          const dateStr = toBangkokDateString(new Date(effective))
          if (dateStr >= from && dateStr <= to) allOrderIds.push(o.id)
        }

        hasMore = orders.length === PAGE_SIZE
        offset += PAGE_SIZE
      }

      if (allOrderIds.length > 0) {
        const CHUNK = 200
        for (let i = 0; i < allOrderIds.length; i += CHUNK) {
          const chunk = allOrderIds.slice(i, i + CHUNK)
          const { data: allocs, error } = await supabase
            .from('inventory_cogs_allocations')
            .select('sku_internal, qty, amount')
            .filter('order_id::text', 'in', `(${chunk.join(',')})`)

          if (error) throw new Error(`COGS allocation (order) chunk query failed: ${error.message}`)

          for (const row of allocs ?? []) {
            accumulate(row.sku_internal as string, Number(row.qty) || 0, Number(row.amount) || 0)
          }
        }
      }
    }

    // Build output rows sorted by total_cost desc
    const rows: CogsAllocationRow[] = Array.from(skuMap.entries())
      .map(([sku_internal, { qty, cost }]) => ({
        sku_internal,
        qty_total:     Math.round(qty  * 10000) / 10000,
        total_cost:    round2(cost),
        avg_unit_cost: qty > 0 ? round2(cost / qty) : 0,
      }))
      .sort((a, b) => b.total_cost - a.total_cost)

    const totalCost = round2(rows.reduce((s, r) => s + r.total_cost, 0))
    const totalQty  = Math.round(rows.reduce((s, r) => s + r.qty_total, 0) * 10000) / 10000

    return { success: true, data: { rows, totalCost, totalQty } }
  } catch (error) {
    console.error('[getCogsAllocationBreakdown] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

/**
 * Group expenses WHERE category='COGS' by subcategory for the given date range.
 * Used for the mini breakdown header in the COGS drilldown modal Tab 2.
 */
export async function getCogsExpensesBreakdown(params: {
  from: string
  to: string
}): Promise<{
  success: boolean
  data?: { rows: CogsExpensesBreakdownRow[]; total: number }
  error?: string
}> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { data, error } = await supabase
      .from('expenses')
      .select('subcategory, amount')
      .eq('category', 'COGS')
      .gte('expense_date', params.from)
      .lte('expense_date', params.to)
      .range(0, 4999)

    if (error) throw new Error(`COGS expenses breakdown failed: ${error.message}`)

    const subMap = new Map<string, number>()
    for (const row of data ?? []) {
      const sub = (row.subcategory as string | null) ?? '(ไม่ระบุ)'
      subMap.set(sub, (subMap.get(sub) || 0) + Math.max(0, Number(row.amount) || 0))
    }

    const rows: CogsExpensesBreakdownRow[] = Array.from(subMap.entries())
      .map(([subcategory, total]) => ({ subcategory, total: round2(total) }))
      .sort((a, b) => b.total - a.total)

    const total = round2(rows.reduce((s, r) => s + r.total, 0))
    return { success: true, data: { rows, total } }
  } catch (error) {
    console.error('[getCogsExpensesBreakdown] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

// ─── Marketplace Cash-In ────────────────────────────────────────────────────────

/**
 * Fetch actual marketplace cash-in for a date range.
 *
 * Total:     cashflow_daily_summary.actual_sum  WHERE date IN [from, to]
 *            — verified source of truth; matches Wallet Cashflow "Actual Total" exactly.
 * Breakdown: settlement_transactions.settlement_amount grouped by marketplace column
 *            — same underlying data; used only for TikTok/Shopee split display.
 *
 * Date filtering: inclusive on both ends (gte/lte), same as getDailyCashflowSummary.
 * Timezone: cashflow_daily_summary.date is already Bangkok-date-bucketed (YYYY-MM-DD).
 * settlement_transactions.settled_time uses `+07:00` suffix for Bangkok boundaries.
 */
export async function getMarketplaceCashIn(
  from: string,
  to: string,
): Promise<{ success: boolean; data?: MarketplaceCashIn; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const startTs = `${from}T00:00:00+07:00`
    const endTs   = `${to}T23:59:59+07:00`

    // Fetch total + breakdown in parallel
    const [summaryRes, txnRes] = await Promise.all([
      // Total from pre-aggregated source — identical to Wallet Cashflow Actual Total
      supabase
        .from('cashflow_daily_summary')
        .select('actual_sum')
        .gte('date', from)
        .lte('date', to)
        .range(0, 999),

      // Breakdown by marketplace (settlement_transactions bucketed by the same Bangkok day range)
      supabase
        .from('settlement_transactions')
        .select('settlement_amount, marketplace')
        .gte('settled_time', startTs)
        .lte('settled_time', endTs)
        .range(0, 9999),
    ])

    if (summaryRes.error) throw new Error(`Cash-in summary query failed: ${summaryRes.error.message}`)
    if (txnRes.error)     throw new Error(`Cash-in breakdown query failed: ${txnRes.error.message}`)

    // Total from cashflow_daily_summary (authoritative)
    const total = (summaryRes.data ?? []).reduce(
      (s, r) => s + Math.max(0, Number(r.actual_sum) || 0), 0,
    )

    // Breakdown by marketplace from settlement_transactions
    let tiktok = 0, shopee = 0
    for (const row of txnRes.data ?? []) {
      const amt = Math.max(0, Number(row.settlement_amount) || 0)
      const mkt = (row.marketplace as string | null) ?? 'tiktok'
      if (mkt === 'shopee') shopee += amt
      else tiktok += amt  // 'tiktok' or null → TikTok bucket
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[Cash In] source=cashflow_daily_summary total=${round2(total)}`,
        `| breakdown settlement_txn tiktok=${round2(tiktok)} shopee=${round2(shopee)}`,
        `| range [${from}, ${to}]`,
      )
    }

    return {
      success: true,
      data: { total: round2(total), tiktok: round2(tiktok), shopee: round2(shopee) },
    }
  } catch (error) {
    console.error('[getMarketplaceCashIn] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

// ─── Bank Inflow Revenue ────────────────────────────────────────────────────────

export interface BankInflowRow {
  id: string
  txn_date: string
  description: string | null
  deposit: number
  bank_channel: string | null  // bank_transactions.channel (ATM/Transfer etc.)
  // From bank_txn_classifications (null = not yet classified)
  include_as_revenue: boolean
  revenue_channel: RevenueChannel | null
  revenue_type: string | null
  note: string | null
}

export interface BankInflowRevenueTotals {
  total: number
  tiktok: number
  shopee: number
  other: number
}

/**
 * Paginated bank inflow rows (deposit > 0) for the date range, merged with
 * user's revenue classifications from bank_txn_classifications.
 *
 * Two-step: fetch bank_transactions (paginated) then batch-fetch classifications.
 */
export async function getBankInflowRows(params: {
  from: string
  to: string
  q?: string
  page?: number
  pageSize?: number
}): Promise<{ success: boolean; data?: { rows: BankInflowRow[]; total: number }; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { from, to, q, page = 1, pageSize = 25 } = params
    const safePgSz = ([10, 25, 50, 100] as number[]).includes(pageSize) ? pageSize : 25
    const fromIdx  = (page - 1) * safePgSz

    let query = supabase
      .from('bank_transactions')
      .select('id, txn_date, description, deposit, channel', { count: 'exact' })
      .gt('deposit', 0)
      .gte('txn_date', from)
      .lte('txn_date', to)
      .order('txn_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (q?.trim()) query = query.ilike('description', `%${q.trim()}%`)
    query = query.range(fromIdx, fromIdx + safePgSz - 1)

    const { data: txns, error: txnError, count } = await query
    if (txnError) throw new Error(`Bank inflow rows query failed: ${txnError.message}`)

    const ids = (txns ?? []).map((t) => t.id as string)

    // Fetch classifications for this page's transactions
    let classMap = new Map<string, { include_as_revenue: boolean; revenue_channel: RevenueChannel | null; revenue_type: string | null; note: string | null }>()
    if (ids.length > 0) {
      const { data: cls, error: clsErr } = await supabase
        .from('bank_txn_classifications')
        .select('bank_transaction_id, include_as_revenue, revenue_channel, revenue_type, note')
        .in('bank_transaction_id', ids)
      if (clsErr) throw new Error(`Bank classification query failed: ${clsErr.message}`)
      for (const c of cls ?? []) {
        classMap.set(c.bank_transaction_id as string, {
          include_as_revenue: c.include_as_revenue as boolean,
          revenue_channel:    (c.revenue_channel as RevenueChannel | null) ?? null,
          revenue_type:       (c.revenue_type as string | null) ?? null,
          note:               (c.note as string | null) ?? null,
        })
      }
    }

    const rows: BankInflowRow[] = (txns ?? []).map((t) => {
      const cls = classMap.get(t.id as string)
      return {
        id:                 t.id as string,
        txn_date:           t.txn_date as string,
        description:        (t.description as string | null) ?? null,
        deposit:            Math.max(0, (t.deposit as number) || 0),
        bank_channel:       (t.channel as string | null) ?? null,
        include_as_revenue: cls?.include_as_revenue ?? false,
        revenue_channel:    cls?.revenue_channel ?? null,
        revenue_type:       cls?.revenue_type ?? null,
        note:               cls?.note ?? null,
      }
    })

    return { success: true, data: { rows, total: count ?? 0 } }
  } catch (error) {
    console.error('[getBankInflowRows] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

/**
 * Save (upsert) a bank transaction's revenue classification.
 * Uses (bank_transaction_id, created_by) as the conflict key.
 */
export async function upsertBankTxnClassification(params: {
  bank_transaction_id: string
  include_as_revenue: boolean
  revenue_channel?: RevenueChannel | null
  revenue_type?: string | null
  note?: string | null
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { error } = await supabase
      .from('bank_txn_classifications')
      .upsert(
        {
          bank_transaction_id: params.bank_transaction_id,
          include_as_revenue:  params.include_as_revenue,
          revenue_channel:     params.revenue_channel ?? null,
          revenue_type:        params.revenue_type ?? null,
          note:                params.note ?? null,
          created_by:          user.id,
          updated_at:          new Date().toISOString(),
        },
        { onConflict: 'bank_transaction_id,created_by' },
      )

    if (error) throw new Error(`Upsert bank txn classification failed: ${error.message}`)
    return { success: true }
  } catch (error) {
    console.error('[upsertBankTxnClassification] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

/**
 * Compute the bank-inflow revenue total for the date range.
 *
 * Two-step:
 * 1. Fetch all bank_txn_classifications WHERE include_as_revenue=true (no date filter)
 * 2. Fetch bank_transactions for those IDs WHERE txn_date IN [from,to] AND deposit > 0
 * 3. Sum deposits, broken down by revenue_channel
 */
export async function getBankInflowRevenueTotal(
  from: string,
  to: string,
): Promise<{ success: boolean; data?: BankInflowRevenueTotals; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    // Step 1: All classifications where include_as_revenue = true
    const { data: classified, error: clsErr } = await supabase
      .from('bank_txn_classifications')
      .select('bank_transaction_id, revenue_channel')
      .eq('include_as_revenue', true)
      .range(0, 9999)

    if (clsErr) throw new Error(`Bank classification query failed: ${clsErr.message}`)
    if (!classified || classified.length === 0) {
      return { success: true, data: { total: 0, tiktok: 0, shopee: 0, other: 0 } }
    }

    const channelById = new Map<string, RevenueChannel | null>(
      (classified ?? []).map((c) => [c.bank_transaction_id as string, (c.revenue_channel as RevenueChannel | null) ?? null]),
    )

    // Step 2: Fetch matching transactions in date range
    const txnIds = Array.from(channelById.keys())
    const { data: txns, error: txnErr } = await supabase
      .from('bank_transactions')
      .select('id, deposit')
      .in('id', txnIds)
      .gte('txn_date', from)
      .lte('txn_date', to)
      .gt('deposit', 0)
      .range(0, 9999)

    if (txnErr) throw new Error(`Bank transactions query failed: ${txnErr.message}`)

    let total = 0, tiktok = 0, shopee = 0, other = 0
    for (const t of txns ?? []) {
      const amt     = Math.max(0, (t.deposit as number) || 0)
      const channel = channelById.get(t.id as string) ?? null
      total  += amt
      if      (channel === 'tiktok') tiktok += amt
      else if (channel === 'shopee') shopee += amt
      else                           other  += amt
    }

    return {
      success: true,
      data: { total: round2(total), tiktok: round2(tiktok), shopee: round2(shopee), other: round2(other) },
    }
  } catch (error) {
    console.error('[getBankInflowRevenueTotal] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}
