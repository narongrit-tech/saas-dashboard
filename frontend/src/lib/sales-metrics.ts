/**
 * Shared sales metrics utilities — server-side only.
 *
 * Used by Performance Dashboard and Sales GMV cards to ensure identical
 * "GMV (Orders Created)" calculations across pages.
 */

import { toBangkokDateString } from '@/lib/bangkok-date-range'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawOrderLine {
  external_order_id: string | null
  order_id: string
  order_amount: number | null
  total_amount: number | null
  created_time: string | null
  order_date: string | null
}

interface OrderBucket {
  order_amounts: number[]   // Non-null order_amount values seen (for uniformity check)
  line_total_sum: number    // SUM(total_amount) across all lines
  effectiveDate: string     // YYYY-MM-DD Bangkok date of COALESCE(created_time, order_date)
}

// ─── fetchGMVByDay ────────────────────────────────────────────────────────────

/**
 * Fetch GMV broken down by Bangkok calendar day, using the canonical
 * "GMV (Orders Created)" logic — identical to getSalesGMVSummary:
 *
 *   1. Server-side pre-filter: order_date in [from, to] (broader, catches created_time=NULL)
 *   2. Paginated 1 000 rows/page — no Supabase 1 000-row cap
 *   3. Client-side COALESCE(created_time, order_date) date filter (exact cohort)
 *   4. Per-order dedup keyed by external_order_id or order_id
 *   5. GMV per order = order_amount when all lines agree, else SUM(total_amount)
 *   6. All orders included (cancelled orders have amount 0 by design)
 *
 * @param supabase  Authenticated Supabase client (RLS enforces user isolation)
 * @param from      YYYY-MM-DD start (Bangkok)
 * @param to        YYYY-MM-DD end   (Bangkok)
 * @returns         Map<YYYY-MM-DD, gmv>
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchGMVByDay(supabase: any, from: string, to: string): Promise<Map<string, number>> {
  const PAGE_SIZE = 1000
  // Cover full last day in Bangkok (23:59:59.999 +07:00)
  const serverEndDate = `${to}T23:59:59.999+07:00`

  // ── Paginated fetch ──────────────────────────────────────────────────────
  const allLines: RawOrderLine[] = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('sales_orders')
      .select('external_order_id, order_id, order_amount, total_amount, created_time, order_date')
      .gte('order_date', `${from}T00:00:00+07:00`)
      .lte('order_date', serverEndDate)
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw new Error(`GMV query failed: ${error.message}`)
    if (!data || data.length === 0) { hasMore = false; break }

    allLines.push(...(data as RawOrderLine[]))
    hasMore = data.length === PAGE_SIZE
    offset += PAGE_SIZE
  }

  // ── Client-side COALESCE(created_time, order_date) cohort filter ─────────
  const cohortLines = allLines.filter((line) => {
    const effectiveDate = line.created_time || line.order_date
    if (!effectiveDate) return false
    const dateStr = toBangkokDateString(new Date(effectiveDate))
    return dateStr >= from && dateStr <= to
  })

  if (process.env.NODE_ENV === 'development') {
    console.log('[GMV] fetchGMVByDay', {
      mode: 'created (COALESCE created_time, order_date)',
      range: `${from} → ${to}`,
      rawLines: allLines.length,
      cohortLines: cohortLines.length,
      pages: Math.ceil(offset / PAGE_SIZE) || 1,
    })
  }

  // ── Per-order aggregation ────────────────────────────────────────────────
  const orderMap = new Map<string, OrderBucket>()

  for (const line of cohortLines) {
    const key = line.external_order_id || line.order_id
    if (!key) continue

    const lineTotal    = Math.max(0, Number(line.total_amount  ?? 0))
    const lineOrderAmt = line.order_amount != null && Number(line.order_amount) > 0
      ? Number(line.order_amount)
      : null
    const effectiveDate = toBangkokDateString(
      new Date(line.created_time || line.order_date || from)
    )

    const existing = orderMap.get(key)
    if (!existing) {
      orderMap.set(key, {
        order_amounts:  lineOrderAmt != null ? [lineOrderAmt] : [],
        line_total_sum: lineTotal,
        effectiveDate,
      })
    } else {
      existing.line_total_sum += lineTotal
      if (lineOrderAmt != null) existing.order_amounts.push(lineOrderAmt)
    }
  }

  // ── Build gmvByDate map ──────────────────────────────────────────────────
  const gmvByDate = new Map<string, number>()

  for (const bucket of orderMap.values()) {
    let gmv: number
    if (bucket.order_amounts.length > 0) {
      const first   = bucket.order_amounts[0]
      const allSame = bucket.order_amounts.every((a) => a === first)
      gmv = allSame ? first : bucket.line_total_sum
    } else {
      gmv = bucket.line_total_sum
    }
    const prev = gmvByDate.get(bucket.effectiveDate) ?? 0
    gmvByDate.set(bucket.effectiveDate, Math.round((prev + Math.max(0, gmv)) * 100) / 100)
  }

  return gmvByDate
}

// ─── fetchGMVByCreatedTime ────────────────────────────────────────────────────

/**
 * Fetch GMV broken down by Bangkok calendar day, bucketed strictly by
 * `created_time`.
 *
 * Used by Performance Dashboard — intentionally excludes orders with
 * created_time = NULL and never falls back to order_date or paid_time.
 * This gives a pure "media performance" view: each order is attributed
 * to the day the customer placed it.
 *
 * @param supabase  Authenticated Supabase client (RLS enforces user isolation)
 * @param from      YYYY-MM-DD start (Bangkok)
 * @param to        YYYY-MM-DD end   (Bangkok)
 * @returns         Map<YYYY-MM-DD, gmv>
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchGMVByCreatedTime(supabase: any, from: string, to: string): Promise<Map<string, number>> {
  const PAGE_SIZE = 1000
  const startTS   = `${from}T00:00:00+07:00`
  const endTS     = `${to}T23:59:59.999+07:00`

  const allLines: Array<{
    external_order_id: string | null
    order_id: string
    order_amount: number | null
    total_amount: number | null
    created_time: string
  }> = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('sales_orders')
      .select('external_order_id, order_id, order_amount, total_amount, created_time')
      .not('created_time', 'is', null)
      .gte('created_time', startTS)
      .lte('created_time', endTS)
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw new Error(`GMV (created_time) query failed: ${error.message}`)
    if (!data || data.length === 0) { hasMore = false; break }
    allLines.push(...data)
    hasMore = data.length === PAGE_SIZE
    offset += PAGE_SIZE
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('[GMV] fetchGMVByCreatedTime', {
      mode: 'strict created_time (no fallback)',
      range: `${from} → ${to}`,
      lines: allLines.length,
      pages: Math.ceil(offset / PAGE_SIZE) || 1,
    })
  }

  // ── Per-order aggregation (same dedup logic as fetchGMVByDay) ────────────
  const orderMap = new Map<string, { order_amounts: number[]; line_total_sum: number; effectiveDate: string }>()

  for (const line of allLines) {
    const key = line.external_order_id || line.order_id
    if (!key) continue

    const lineTotal    = Math.max(0, Number(line.total_amount ?? 0))
    const lineOrderAmt = line.order_amount != null && Number(line.order_amount) > 0
      ? Number(line.order_amount) : null
    const effectiveDate = toBangkokDateString(new Date(line.created_time))

    const existing = orderMap.get(key)
    if (!existing) {
      orderMap.set(key, {
        order_amounts:  lineOrderAmt != null ? [lineOrderAmt] : [],
        line_total_sum: lineTotal,
        effectiveDate,
      })
    } else {
      existing.line_total_sum += lineTotal
      if (lineOrderAmt != null) existing.order_amounts.push(lineOrderAmt)
    }
  }

  const gmvByDate = new Map<string, number>()
  for (const bucket of orderMap.values()) {
    let gmv: number
    if (bucket.order_amounts.length > 0) {
      const first   = bucket.order_amounts[0]
      const allSame = bucket.order_amounts.every((a) => a === first)
      gmv = allSame ? first : bucket.line_total_sum
    } else {
      gmv = bucket.line_total_sum
    }
    const prev = gmvByDate.get(bucket.effectiveDate) ?? 0
    gmvByDate.set(bucket.effectiveDate, Math.round((prev + Math.max(0, gmv)) * 100) / 100)
  }

  return gmvByDate
}

// ─── fetchGMVByDayPaid ────────────────────────────────────────────────────────

/**
 * Fetch GMV broken down by Bangkok calendar day, filtered by paid_time.
 *
 * Only orders with a non-null paid_time that falls within [from, to] in Bangkok
 * timezone are included. Uses the same per-order dedup + amount logic as
 * fetchGMVByDay.
 *
 * Orders without paid_time (e.g. Shopee orders with no confirmed payment record)
 * are excluded — this is intentional for the "Paid Date" view.
 *
 * @param supabase  Authenticated Supabase client (RLS enforces user isolation)
 * @param from      YYYY-MM-DD start (Bangkok)
 * @param to        YYYY-MM-DD end   (Bangkok)
 * @returns         Map<YYYY-MM-DD, gmv>
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchGMVByDayPaid(supabase: any, from: string, to: string): Promise<Map<string, number>> {
  const PAGE_SIZE     = 1000
  const startTS       = `${from}T00:00:00+07:00`
  const endTS         = `${to}T23:59:59.999+07:00`

  // ── Paginated fetch ──────────────────────────────────────────────────────
  const allLines: Array<{
    external_order_id: string | null
    order_id: string
    order_amount: number | null
    total_amount: number | null
    paid_time: string
  }> = []
  let offset  = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('sales_orders')
      .select('external_order_id, order_id, order_amount, total_amount, paid_time')
      .not('paid_time', 'is', null)
      .gte('paid_time', startTS)
      .lte('paid_time', endTS)
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw new Error(`GMV (paid) query failed: ${error.message}`)
    if (!data || data.length === 0) { hasMore = false; break }

    allLines.push(...data)
    hasMore = data.length === PAGE_SIZE
    offset += PAGE_SIZE
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('[GMV] fetchGMVByDayPaid', {
      mode: 'paid (paid_time)',
      range: `${from} → ${to}`,
      lines: allLines.length,
      pages: Math.ceil(offset / PAGE_SIZE) || 1,
    })
  }

  // ── Per-order aggregation ────────────────────────────────────────────────
  const orderMap = new Map<string, { order_amounts: number[]; line_total_sum: number; effectiveDate: string }>()

  for (const line of allLines) {
    const key = line.external_order_id || line.order_id
    if (!key) continue

    const lineTotal    = Math.max(0, Number(line.total_amount ?? 0))
    const lineOrderAmt = line.order_amount != null && Number(line.order_amount) > 0
      ? Number(line.order_amount)
      : null
    const effectiveDate = toBangkokDateString(new Date(line.paid_time))

    const existing = orderMap.get(key)
    if (!existing) {
      orderMap.set(key, {
        order_amounts:  lineOrderAmt != null ? [lineOrderAmt] : [],
        line_total_sum: lineTotal,
        effectiveDate,
      })
    } else {
      existing.line_total_sum += lineTotal
      if (lineOrderAmt != null) existing.order_amounts.push(lineOrderAmt)
    }
  }

  // ── Build gmvByDate map ──────────────────────────────────────────────────
  const gmvByDate = new Map<string, number>()

  for (const bucket of orderMap.values()) {
    let gmv: number
    if (bucket.order_amounts.length > 0) {
      const first   = bucket.order_amounts[0]
      const allSame = bucket.order_amounts.every((a) => a === first)
      gmv = allSame ? first : bucket.line_total_sum
    } else {
      gmv = bucket.line_total_sum
    }
    const prev = gmvByDate.get(bucket.effectiveDate) ?? 0
    gmvByDate.set(bucket.effectiveDate, Math.round((prev + Math.max(0, gmv)) * 100) / 100)
  }

  return gmvByDate
}
