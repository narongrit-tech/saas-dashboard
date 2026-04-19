'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { revalidatePath } from 'next/cache'
import {
  type AttributionDiagnostics,
  type AttributionSurfaceState,
  buildAttributionLimitedMessage,
  createAttributionDiagnostics,
  getAttributionSurfaceState,
  getAttributionQueryMeta,
  logAttributionDiagnostics,
} from '../attribution-query-utils'
import { normalizeContentOpsStatus } from '../status-utils'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImportBatch {
  id: string
  created_at: string
  created_by: string
  source_file_name: string
  source_sheet_name: string
  source_file_hash: string | null
  status: 'processing' | 'staged' | 'normalized' | 'failed'
  raw_row_count: number
  staged_row_count: number
  normalized_row_count: number
  skipped_row_count: number
  error_count: number
  notes: string | null
  metadata: Record<string, unknown>
}

export interface ContentFact {
  id: string
  created_by: string
  import_batch_id: string | null
  order_id: string
  sku_id: string
  product_id: string
  content_id: string
  content_type: string | null
  product_name: string | null
  currency: string | null
  order_date: string | null
  order_settlement_status: string
  attribution_type: string
  gmv: number | null
  total_earned_amount: number | null
  total_commission_amount: number | null
  is_successful: boolean
  is_cancelled: boolean
}

export interface AttributionRow {
  created_by: string
  order_id: string
  product_id: string
  content_id: string
  content_type: string | null
  product_name: string | null
  currency: string | null
  order_date: string | null
  normalized_status: string
  business_bucket: string
  is_realized: boolean
  is_open: boolean
  is_lost: boolean
  gmv: number | null
  commission: number | null
  actual_commission_total: number | null
  source_fact_count: number
  content_candidate_count: number
}

export interface CostRow {
  id: string
  created_at: string
  created_by: string
  content_id: string
  product_id: string | null
  cost_type: 'ads' | 'creator' | 'misc'
  amount: number
  currency: string
  cost_date: string
  notes: string | null
}

export interface ProfitRow {
  created_by: string
  content_id: string
  product_id: string
  currency: string
  total_orders: number
  successful_orders: number
  open_orders: number
  lost_orders: number
  gmv_realized: number
  gmv_open: number
  gmv_lost: number
  commission_realized: number
  commission_open: number
  commission_lost: number
  ads_cost: number
  creator_cost: number
  other_cost: number
  total_cost: number
  profit: number
  roi: number | null
}

export interface PipelineStatus {
  batches: number
  stagingRows: number
  factRows: number
  attributionRows: number | null
  attributionState: AttributionSurfaceState
  attributionMessage: string | null
  attributionDiagnostics: AttributionDiagnostics | null
  costs: number
  costAllocations: number
  profitSummaryRows: number
  unallocatedCosts: number
}

export interface VerificationResult {
  check: string
  description: string
  rowCount: number
  passed: boolean
  sampleRows: Record<string, unknown>[]
  error?: string
}

// ─── Pipeline Status ──────────────────────────────────────────────────────────

export async function getPipelineStatus(): Promise<{ data: PipelineStatus | null; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'Unauthenticated' }

  const [batches, staging, facts, costs, allocations, profit] = await Promise.all([
    supabase.from('tiktok_affiliate_import_batches').select('id', { count: 'exact', head: true }).eq('created_by', user.id),
    supabase.from('tiktok_affiliate_order_raw_staging').select('id', { count: 'exact', head: true }).eq('created_by', user.id),
    supabase.from('content_order_facts').select('id', { count: 'exact', head: true }).eq('created_by', user.id),
    supabase.from('tt_content_costs').select('id', { count: 'exact', head: true }).eq('created_by', user.id),
    supabase.from('tt_content_cost_allocations').select('id', { count: 'exact', head: true }).eq('created_by', user.id),
    supabase.from('content_profit_attribution_summary').select('content_id', { count: 'exact', head: true }).eq('created_by', user.id),
  ])

  const unallocated = await supabase
    .from('tt_content_cost_allocations')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .eq('allocation_status', 'unallocated')

  // attribution is a view — count via facts as proxy
  let attributionState: AttributionSurfaceState = facts.count ? 'partial' : 'no_data'
  let attributionMessage = facts.count
    ? 'Partial: attribution probe has not run yet.'
    : 'No normalized facts available for attribution.'
  let attributionRows: number | null = facts.count ? null : 0
  let attributionDiagnostics: AttributionDiagnostics | null = null

  if ((facts.count ?? 0) > 0) {
    const attributionProbeStartedAt = Date.now()
    const attributionProbe = await supabase
      .from('content_order_attribution')
      .select('order_id')
      .eq('created_by', user.id)
      .limit(1)

    const attributionProbeDurationMs = Date.now() - attributionProbeStartedAt
    const attributionQuery = getAttributionQueryMeta(
      attributionProbe.error,
      attributionProbe.data?.length ?? 0,
      'Attribution'
    )

    attributionDiagnostics = createAttributionDiagnostics({
      queryPath: 'stable_probe',
      durationMs: attributionProbeDurationMs,
      degraded: true,
      timedOut: attributionQuery.state === 'timed_out',
      totalMode: 'skipped',
      summaryMode: 'probe',
    })
    attributionState = getAttributionSurfaceState(
      attributionQuery,
      attributionProbe.data?.length ?? 0,
      true
    )
    attributionRows = attributionState === 'no_data' ? 0 : null
    attributionMessage =
      attributionState === 'partial'
        ? `${buildAttributionLimitedMessage('Attribution', { probeOnly: true })} ${attributionDiagnostics.queryPath} completed in ${attributionDiagnostics.durationMs} ms.`
        : attributionState === 'no_data'
        ? 'No attribution rows found.'
        : `${attributionQuery.message ?? 'Attribution query failed.'} ${attributionDiagnostics.queryPath} completed in ${attributionDiagnostics.durationMs} ms.`

    logAttributionDiagnostics('tiktok_affiliate_pipeline_probe', attributionState, attributionDiagnostics, attributionMessage)
  }

  return {
    data: {
      batches: batches.count ?? 0,
      stagingRows: staging.count ?? 0,
      factRows: facts.count ?? 0,
      attributionRows,
      attributionState,
      attributionMessage,
      attributionDiagnostics,
      costs: costs.count ?? 0,
      costAllocations: allocations.count ?? 0,
      profitSummaryRows: profit.count ?? 0,
      unallocatedCosts: unallocated.count ?? 0,
    },
    error: null,
  }
}

// ─── Batches ─────────────────────────────────────────────────────────────────

export async function getBatches(limit = 50, offset = 0): Promise<{ data: ImportBatch[]; total: number; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: [], total: 0, error: 'Unauthenticated' }

  const { data, count, error } = await supabase
    .from('tiktok_affiliate_import_batches')
    .select('*', { count: 'exact' })
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return { data: [], total: 0, error: error.message }
  return { data: (data ?? []) as ImportBatch[], total: count ?? 0, error: null }
}

// ─── Facts ───────────────────────────────────────────────────────────────────

export async function getFacts(
  filters: { contentId?: string; status?: string; batchId?: string } = {},
  limit = 50,
  offset = 0
): Promise<{ data: ContentFact[]; total: number; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: [], total: 0, error: 'Unauthenticated' }

  let query = supabase
    .from('content_order_facts')
    .select('id,created_by,import_batch_id,order_id,sku_id,product_id,content_id,content_type,product_name,currency,order_date,order_settlement_status,attribution_type,gmv,total_earned_amount,total_commission_amount,is_successful,is_cancelled', { count: 'exact' })
    .eq('created_by', user.id)

  if (filters.contentId) query = query.eq('content_id', filters.contentId)
  if (filters.status) {
    const normalizedStatus = normalizeContentOpsStatus(filters.status)
    if (!normalizedStatus) {
      return { data: [], total: 0, error: `Unsupported status filter: ${filters.status}` }
    }
    query = query.eq('order_settlement_status', normalizedStatus)
  }
  if (filters.batchId) query = query.eq('import_batch_id', filters.batchId)

  const { data, count, error } = await query
    .order('order_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return { data: [], total: 0, error: error.message }
  return { data: (data ?? []) as ContentFact[], total: count ?? 0, error: null }
}

export async function getDistinctContentIds(): Promise<string[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('content_order_facts')
    .select('content_id')
    .eq('created_by', user.id)
    .order('content_id')
    .limit(500)

  if (!data) return []
  return [...new Set(data.map((r) => r.content_id).filter(Boolean))]
}

// ─── Attribution ─────────────────────────────────────────────────────────────

export async function getAttribution(
  filters: { contentId?: string; bucket?: string } = {},
  limit = 50,
  offset = 0
): Promise<{
  data: AttributionRow[]
  total: number | null
  totalKnown: boolean
  hasMore: boolean
  state: AttributionSurfaceState
  notice: string | null
  error: string | null
  diagnostics: AttributionDiagnostics
}> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return {
      data: [],
      total: null,
      totalKnown: false,
      hasMore: false,
      state: 'failed',
      notice: null,
      error: 'Unauthenticated',
      diagnostics: createAttributionDiagnostics({
        queryPath: 'tiktok_affiliate_attribution_unauthenticated',
        durationMs: 0,
        degraded: false,
        timedOut: false,
        totalMode: 'skipped',
        summaryMode: 'skipped',
      }),
    }
  }

  const startedAt = Date.now()
  // Fetch only the columns rendered by the attribution page.
  // Dropping is_realized, is_open, is_lost, commission reduces view computation cost.
  let query = supabase
    .from('content_order_attribution')
    .select('order_id,product_id,content_id,content_type,product_name,currency,order_date,normalized_status,business_bucket,gmv,actual_commission_total,source_fact_count,content_candidate_count')
    .eq('created_by', user.id)

  if (filters.contentId) query = query.eq('content_id', filters.contentId)
  if (filters.bucket) query = query.eq('business_bucket', filters.bucket)

  const { data, error } = await query
    .order('order_date', { ascending: false })
    .range(offset, offset + limit)

  const durationMs = Date.now() - startedAt

  if (error) {
    const attributionQuery = getAttributionQueryMeta(error, null, 'Attribution')
    const diagnostics = createAttributionDiagnostics({
      queryPath: 'stable_page_slice',
      durationMs,
      degraded: false,
      timedOut: attributionQuery.state === 'timed_out',
      totalMode: 'skipped',
      summaryMode: 'skipped',
    })
    const state = getAttributionSurfaceState(attributionQuery, 0, false)
    logAttributionDiagnostics('tiktok_affiliate_attribution_rows', state, diagnostics, attributionQuery.message)
    return {
      data: [],
      total: null,
      totalKnown: false,
      hasMore: false,
      state,
      notice: null,
      error: attributionQuery.message,
      diagnostics,
    }
  }
  const rawRows = (data ?? []) as AttributionRow[]
  const hasMore = rawRows.length > limit
  const rows = rawRows.slice(0, limit)
  const totalKnown = !hasMore && (offset === 0 || rows.length > 0)
  const total = totalKnown ? offset + rows.length : null
  const queryMeta = getAttributionQueryMeta(null, rows.length, 'Attribution')
  const diagnostics = createAttributionDiagnostics({
    queryPath: 'stable_page_slice',
    durationMs,
    degraded: hasMore,
    timedOut: false,
    totalMode: totalKnown ? 'derived_last_page' : 'skipped',
    summaryMode: 'skipped',
  })
  const state = getAttributionSurfaceState(queryMeta, rows.length, diagnostics.degraded)
  const notice = state === 'partial'
    ? buildAttributionLimitedMessage('Attribution', { exactTotals: totalKnown })
    : null

  logAttributionDiagnostics('tiktok_affiliate_attribution_rows', state, diagnostics, notice)

  return {
    data: rows,
    total,
    totalKnown,
    hasMore,
    state,
    notice,
    error: null,
    diagnostics,
  }
}

// ─── Costs ───────────────────────────────────────────────────────────────────

export async function getCosts(): Promise<{ data: CostRow[]; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: [], error: 'Unauthenticated' }

  const { data, error } = await supabase
    .from('tt_content_costs')
    .select('*')
    .eq('created_by', user.id)
    .order('cost_date', { ascending: false })
    .limit(200)

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as CostRow[], error: null }
}

export async function insertCost(formData: FormData): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Unauthenticated' }

  const content_id = formData.get('content_id') as string
  const product_id = (formData.get('product_id') as string) || null
  const cost_type = formData.get('cost_type') as 'ads' | 'creator' | 'misc'
  const amount = parseFloat(formData.get('amount') as string)
  const currency = (formData.get('currency') as string).toUpperCase()
  const cost_date = formData.get('cost_date') as string
  const notes = (formData.get('notes') as string) || null

  if (!content_id || !cost_type || isNaN(amount) || amount < 0 || !currency || !cost_date) {
    return { success: false, error: 'Missing required fields or invalid amount' }
  }
  if (!['ads', 'creator', 'misc'].includes(cost_type)) {
    return { success: false, error: 'cost_type must be ads, creator, or misc' }
  }

  const { error } = await supabase.from('tt_content_costs').insert({
    created_by: user.id,
    content_id,
    product_id: product_id || null,
    cost_type,
    amount,
    currency,
    cost_date,
    notes,
  })

  if (error) return { success: false, error: error.message }
  revalidatePath('/content-ops/tiktok-affiliate/costs')
  revalidatePath('/content-ops/tiktok-affiliate/profit')
  return { success: true, error: null }
}

export async function deleteCost(costId: string): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Unauthenticated' }

  const { error } = await supabase
    .from('tt_content_costs')
    .delete()
    .eq('id', costId)
    .eq('created_by', user.id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/content-ops/tiktok-affiliate/costs')
  return { success: true, error: null }
}

// ─── Profit ───────────────────────────────────────────────────────────────────

export async function getProfit(): Promise<{ data: ProfitRow[]; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: [], error: 'Unauthenticated' }

  const { data, error } = await supabase
    .from('content_profit_attribution_summary')
    .select('*')
    .eq('created_by', user.id)
    .order('profit', { ascending: false })
    .limit(200)

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as ProfitRow[], error: null }
}

export async function runProfitRefresh(): Promise<{
  success: boolean
  result: { attribution_row_count: number; cost_allocation_row_count: number; summary_row_count: number; unallocated_cost_row_count: number } | null
  error: string | null
}> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, result: null, error: 'Unauthenticated' }

  const { data, error } = await supabase.rpc('refresh_content_profit_layer', {
    p_created_by: user.id,
  })

  if (error) return { success: false, result: null, error: error.message }

  const row = Array.isArray(data) ? data[0] : data
  revalidatePath('/content-ops/tiktok-affiliate/profit')
  revalidatePath('/content-ops/tiktok-affiliate')
  return {
    success: true,
    result: row ?? null,
    error: null,
  }
}

// ─── Verification ─────────────────────────────────────────────────────────────

export async function runVerification(): Promise<VerificationResult[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const uid = user.id
  const results: VerificationResult[] = []

  async function check(
    label: string,
    description: string,
    fn: () => Promise<{ data: unknown[] | null; error: { message: string } | null }>
  ) {
    try {
      const { data, error } = await fn()
      if (error) {
        results.push({ check: label, description, rowCount: -1, passed: false, sampleRows: [], error: error.message })
        return
      }
      const rows = data ?? []
      results.push({ check: label, description, rowCount: rows.length, passed: rows.length === 0, sampleRows: rows.slice(0, 5) as Record<string, unknown>[] })
    } catch (err) {
      results.push({ check: label, description, rowCount: -1, passed: false, sampleRows: [], error: String(err) })
    }
  }

  // Check 1: Duplicate winners in attribution
  await check(
    'Attribution grain uniqueness',
    'No duplicate (order_id, product_id) winners for the same user',
    async () => supabase
      .from('content_order_attribution')
      .select('order_id,product_id')
      .eq('created_by', uid)
      .limit(1000)
      .then(({ data, error }) => {
        if (error || !data) return { data: [], error }
        const seen = new Map<string, number>()
        for (const r of data) {
          const k = `${r.order_id}|${r.product_id}`
          seen.set(k, (seen.get(k) ?? 0) + 1)
        }
        const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => ({ key: k }))
        return { data: dupes, error: null }
      })
  )

  // Check 2: Null/blank business keys in attribution
  await check(
    'Attribution key completeness',
    'No null/blank order_id, product_id, content_id, or currency in attribution',
    async () => supabase
      .from('content_order_attribution')
      .select('order_id,product_id,content_id,currency')
      .eq('created_by', uid)
      .or('order_id.is.null,product_id.is.null,content_id.is.null,currency.is.null')
      .limit(10)
  )

  // Check 3: Profit formula
  await check(
    'Profit formula',
    'profit = commission_realized − total_cost for all summary rows',
    async () => supabase
      .from('content_profit_attribution_summary')
      .select('content_id,product_id,currency,commission_realized,total_cost,profit')
      .eq('created_by', uid)
      .limit(500)
      .then(({ data, error }) => {
        if (error || !data) return { data: [], error }
        const bad = data.filter((r) => {
          const expected = Math.round((r.commission_realized - r.total_cost) * 100) / 100
          return Math.abs((r.profit ?? 0) - expected) > 0.01
        })
        return { data: bad, error: null }
      })
  )

  // Check 4: ROI nullability
  await check(
    'ROI nullability',
    'roi IS NULL when total_cost = 0; roi IS NOT NULL when total_cost > 0',
    async () => supabase
      .from('content_profit_attribution_summary')
      .select('content_id,product_id,currency,total_cost,roi')
      .eq('created_by', uid)
      .limit(500)
      .then(({ data, error }) => {
        if (error || !data) return { data: [], error }
        const bad = data.filter((r) => {
          if (r.total_cost === 0 && r.roi !== null) return true
          if (r.total_cost > 0 && r.roi === null) return true
          return false
        })
        return { data: bad, error: null }
      })
  )

  // Check 5: Summary grain uniqueness
  await check(
    'Summary grain uniqueness',
    'No duplicate (content_id, product_id, currency) in profit summary',
    async () => supabase
      .from('content_profit_attribution_summary')
      .select('content_id,product_id,currency')
      .eq('created_by', uid)
      .limit(1000)
      .then(({ data, error }) => {
        if (error || !data) return { data: [], error }
        const seen = new Map<string, number>()
        for (const r of data) {
          const k = `${r.content_id}|${r.product_id}|${r.currency}`
          seen.set(k, (seen.get(k) ?? 0) + 1)
        }
        const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => ({ key: k }))
        return { data: dupes, error: null }
      })
  )

  // Check 6: Unallocated costs (informational — always "pass" but shows count)
  await check(
    'Unallocated costs (informational)',
    'Costs with no matching attribution basis — these are preserved, not hidden. Non-zero is expected if cost_date has no order data.',
    async () => supabase
      .from('tt_content_cost_allocations')
      .select('cost_id,content_id,currency,cost_date,allocation_method,allocated_amount')
      .eq('created_by', uid)
      .eq('allocation_status', 'unallocated')
      .limit(20)
      .then(({ data, error }) => ({ data: data ?? [], error }))
  )

  // Mark check 6 as always passing (informational)
  const last = results[results.length - 1]
  if (last?.check === 'Unallocated costs (informational)') {
    last.passed = true
  }

  // Check 7: Facts → attribution row count agreement
  // Uses a bounded probe (limit 1) on content_order_attribution instead of count:exact
  // to avoid query timeouts on large fact volumes.
  await check(
    'Facts vs attribution coverage',
    'content_order_attribution has rows when content_order_facts has rows',
    async () => {
      const [factsRes, attrProbe] = await Promise.all([
        supabase.from('content_order_facts').select('id', { count: 'exact', head: true }).eq('created_by', uid),
        supabase.from('content_order_attribution').select('order_id').eq('created_by', uid).limit(1),
      ])
      if (attrProbe.error) {
        return { data: [], error: attrProbe.error }
      }
      const factsCount = factsRes.count ?? 0
      const attrHasRows = (attrProbe.data?.length ?? 0) > 0
      if (factsCount > 0 && !attrHasRows) {
        return { data: [{ issue: `${factsCount} facts exist but 0 attribution rows found` }], error: null }
      }
      return { data: [], error: null }
    }
  )

  // Check 8: Cost conservation
  await check(
    'Cost conservation',
    'Each cost row total_cost = sum of its allocation slices (allocated + unallocated)',
    async () => {
      const [costsRes, allocRes] = await Promise.all([
        supabase.from('tt_content_costs').select('id,amount').eq('created_by', uid).limit(500),
        supabase.from('tt_content_cost_allocations').select('cost_id,allocated_amount').eq('created_by', uid).limit(2000),
      ])
      if (costsRes.error || allocRes.error) return { data: [], error: costsRes.error ?? allocRes.error }
      const costs = costsRes.data ?? []
      const allocs = allocRes.data ?? []

      const allocByCost = new Map<string, number>()
      for (const a of allocs) {
        allocByCost.set(a.cost_id, (allocByCost.get(a.cost_id) ?? 0) + (a.allocated_amount ?? 0))
      }

      const bad = costs.filter((c) => {
        const total = allocByCost.get(c.id) ?? 0
        return Math.abs(total - c.amount) > 0.01
      })
      return { data: bad.map((c) => ({ cost_id: c.id, expected: c.amount, actual: allocByCost.get(c.id) ?? 0 })), error: null }
    }
  )

  return results
}

// ─── Product Master (derived from facts) ─────────────────────────────────────

export interface ProductSummary {
  product_id: string
  product_name: string | null
  shop_code: string | null
  shop_name: string | null
  total_order_items: number
  settled_order_items: number
  total_gmv: number | null
  total_commission: number | null  // sum of total_earned_amount from facts at last refresh
  currency: string | null
  first_seen_at: string | null
  last_seen_at: string | null
}

export interface ShopSummary {
  shop_code: string
  shop_name: string | null
  total_products: number
  total_order_items: number
  settled_order_items: number
  total_gmv: number | null
  total_commission: number | null  // sum of total_earned_amount from facts at last refresh
  currency: string | null
  first_seen_at: string | null
  last_seen_at: string | null
}

export async function getProductMaster(
  limit = 200,
  offset = 0
): Promise<{ data: ProductSummary[]; total: number; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: [], total: 0, error: 'Unauthenticated' }

  // Reads from tt_product_master — the persistent product registry.
  // Populated and updated by refresh_tt_product_shop_master(). May be stale
  // if a new import batch has not yet triggered a refresh.
  const { data, count, error } = await supabase
    .from('tt_product_master')
    .select(
      'product_id,product_name,shop_code,shop_name,total_order_items,settled_order_items,total_gmv,total_commission,currency,first_seen_at,last_seen_at',
      { count: 'exact' }
    )
    .eq('created_by', user.id)
    .order('total_order_items', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return { data: [], total: 0, error: error.message }

  const rows: ProductSummary[] = (data ?? []).map((r) => ({
    product_id: r.product_id,
    product_name: r.product_name ?? null,
    shop_code: r.shop_code ?? null,
    shop_name: r.shop_name ?? null,
    total_order_items: r.total_order_items ?? 0,
    settled_order_items: r.settled_order_items ?? 0,
    total_gmv: r.total_gmv ?? null,
    total_commission: r.total_commission ?? null,
    currency: r.currency ?? null,
    first_seen_at: r.first_seen_at ?? null,
    last_seen_at: r.last_seen_at ?? null,
  }))

  return { data: rows, total: count ?? 0, error: null }
}

export async function getShopMaster(
  limit = 500,
  offset = 0
): Promise<{ data: ShopSummary[]; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: [], error: 'Unauthenticated' }

  // Reads from tt_shop_master — the persistent shop registry.
  // Populated and updated by refresh_tt_product_shop_master(). May be stale
  // if a new import batch has not yet triggered a refresh.
  const { data, error } = await supabase
    .from('tt_shop_master')
    .select(
      'shop_code,shop_name,total_products,total_order_items,settled_order_items,total_gmv,total_commission,currency,first_seen_at,last_seen_at'
    )
    .eq('created_by', user.id)
    .order('total_order_items', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return { data: [], error: error.message }

  const rows: ShopSummary[] = (data ?? []).map((r) => ({
    shop_code: r.shop_code,
    shop_name: r.shop_name ?? null,
    total_products: r.total_products ?? 0,
    total_order_items: r.total_order_items ?? 0,
    settled_order_items: r.settled_order_items ?? 0,
    total_gmv: r.total_gmv ?? null,
    total_commission: r.total_commission ?? null,
    currency: r.currency ?? null,
    first_seen_at: r.first_seen_at ?? null,
    last_seen_at: r.last_seen_at ?? null,
  }))

  return { data: rows, error: null }
}

// ─── Master Refresh ──────────────────────────────────────────────────────────

export async function runMasterRefresh(): Promise<{
  success: boolean
  result: { products_upserted: number; shops_upserted: number } | null
  error: string | null
}> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, result: null, error: 'Unauthenticated' }

  // Calls the DB function that rebuilds tt_product_master and tt_shop_master
  // from content_order_facts via idempotent upsert. Safe to call multiple times.
  const { data, error } = await supabase.rpc('refresh_tt_product_shop_master', {
    p_created_by: user.id,
  })

  if (error) return { success: false, result: null, error: error.message }

  const row = Array.isArray(data) ? data[0] : data
  revalidatePath('/content-ops/products')
  revalidatePath('/content-ops/shops')
  revalidatePath('/content-ops/tiktok-affiliate')
  return {
    success: true,
    result: row ? { products_upserted: row.products_upserted, shops_upserted: row.shops_upserted } : null,
    error: null,
  }
}
