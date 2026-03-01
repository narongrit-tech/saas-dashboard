'use server'

import { createClient } from '@/lib/supabase/server'
import { formatBangkok, getBangkokNow } from '@/lib/bangkok-time'
import { sanitizeCSVField } from '@/lib/csv'
import { evaluateExpression } from '@/lib/analytics-expression'
import {
  isMetricAvailable,
  getMetricSlot,
  getMetricLabel,
  migrateDefinition,
} from '@/types/analytics-builder'
import type {
  AnalyticsDefinition,
  AnalyticsRow,
  AnalyticsPreset,
  MetricRef,
  RunAnalyticsResult,
  ExportAnalyticsResult,
  PresetActionResult,
  SubcategoryListResult,
} from '@/types/analytics-builder'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bangkokDayRange(date: string) {
  return {
    start: `${date}T00:00:00+07:00`,
    end: `${date}T23:59:59.999+07:00`,
  }
}

function toBangkokDateStr(ts: string): string {
  return formatBangkok(new Date(ts), 'yyyy-MM-dd')
}

function buildDateList(start: string, end: string): string[] {
  const dates: string[] = []
  const cur = new Date(`${start}T00:00:00+07:00`)
  const last = new Date(`${end}T00:00:00+07:00`)
  while (cur <= last) {
    dates.push(formatBangkok(cur, 'yyyy-MM-dd'))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

// ─── Per-metric fetchers ──────────────────────────────────────────────────────

async function fetchRevenue(
  supabase: ReturnType<typeof createClient>,
  start: string,
  end: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const { data, error } = await supabase
    .from('sales_orders')
    .select('order_date, total_amount')
    .gte('order_date', bangkokDayRange(start).start)
    .lte('order_date', bangkokDayRange(end).end)
    .neq('status', 'cancelled')
  if (error) { console.error('[analytics] fetchRevenue:', error); return result }
  for (const row of data ?? []) {
    const d = toBangkokDateStr(row.order_date)
    result.set(d, (result.get(d) ?? 0) + (row.total_amount ?? 0))
  }
  return result
}

async function fetchAdvertising(
  supabase: ReturnType<typeof createClient>,
  start: string,
  end: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const { data, error } = await supabase
    .from('ad_daily_performance')
    .select('ad_date, spend')
    .gte('ad_date', start)
    .lte('ad_date', end)
  if (error) { console.error('[analytics] fetchAdvertising:', error); return result }
  for (const row of data ?? []) {
    const d = row.ad_date as string
    result.set(d, (result.get(d) ?? 0) + (row.spend ?? 0))
  }
  return result
}

async function fetchCOGS(
  supabase: ReturnType<typeof createClient>,
  start: string,
  end: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const { data, error } = await supabase
    .from('inventory_cogs_allocations')
    .select('shipped_at, amount')
    .gte('shipped_at', bangkokDayRange(start).start)
    .lte('shipped_at', bangkokDayRange(end).end)
  if (error) { console.error('[analytics] fetchCOGS:', error); return result }
  for (const row of data ?? []) {
    const d = toBangkokDateStr(row.shipped_at)
    result.set(d, (result.get(d) ?? 0) + (row.amount ?? 0))
  }
  return result
}

async function fetchOperating(
  supabase: ReturnType<typeof createClient>,
  start: string,
  end: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const { data, error } = await supabase
    .from('expenses')
    .select('expense_date, amount')
    .gte('expense_date', start)
    .lte('expense_date', end)
    .eq('category', 'Operating')
  if (error) { console.error('[analytics] fetchOperating:', error); return result }
  for (const row of data ?? []) {
    const d = row.expense_date as string
    result.set(d, (result.get(d) ?? 0) + (row.amount ?? 0))
  }
  return result
}

async function fetchOrders(
  supabase: ReturnType<typeof createClient>,
  start: string,
  end: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const { data, error } = await supabase
    .from('sales_orders')
    .select('order_date, order_id')
    .gte('order_date', bangkokDayRange(start).start)
    .lte('order_date', bangkokDayRange(end).end)
    .neq('status', 'cancelled')
  if (error) { console.error('[analytics] fetchOrders:', error); return result }
  const dayOrderSets = new Map<string, Set<string>>()
  for (const row of data ?? []) {
    const d = toBangkokDateStr(row.order_date)
    if (!dayOrderSets.has(d)) dayOrderSets.set(d, new Set())
    dayOrderSets.get(d)!.add(row.order_id)
  }
  for (const [d, s] of dayOrderSets) result.set(d, s.size)
  return result
}

async function fetchUnits(
  supabase: ReturnType<typeof createClient>,
  start: string,
  end: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const { data, error } = await supabase
    .from('sales_orders')
    .select('order_date, quantity')
    .gte('order_date', bangkokDayRange(start).start)
    .lte('order_date', bangkokDayRange(end).end)
    .neq('status', 'cancelled')
  if (error) { console.error('[analytics] fetchUnits:', error); return result }
  for (const row of data ?? []) {
    const d = toBangkokDateStr(row.order_date)
    result.set(d, (result.get(d) ?? 0) + (row.quantity ?? 0))
  }
  return result
}

// ─── New: Ads by campaign type ────────────────────────────────────────────────

async function fetchAdsByType(
  supabase: ReturnType<typeof createClient>,
  start: string,
  end: string,
  campaignType: 'all' | 'product' | 'live' | 'aware'
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  let query = supabase
    .from('ad_daily_performance')
    .select('ad_date, spend')
    .gte('ad_date', start)
    .lte('ad_date', end)
  if (campaignType !== 'all') {
    query = query.eq('campaign_type', campaignType)
  }
  const { data, error } = await query
  if (error) { console.error('[analytics] fetchAdsByType:', error); return result }
  for (const row of data ?? []) {
    const d = row.ad_date as string
    result.set(d, (result.get(d) ?? 0) + (row.spend ?? 0))
  }
  return result
}

// ─── New: Expense by subcategory ──────────────────────────────────────────────

async function fetchExpenseSubcategory(
  supabase: ReturnType<typeof createClient>,
  start: string,
  end: string,
  category: string,
  subcategory: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const { data, error } = await supabase
    .from('expenses')
    .select('expense_date, amount')
    .gte('expense_date', start)
    .lte('expense_date', end)
    .eq('category', category)
    .eq('subcategory', subcategory)
  if (error) { console.error('[analytics] fetchExpenseSubcategory:', error); return result }
  for (const row of data ?? []) {
    const d = row.expense_date as string
    result.set(d, (result.get(d) ?? 0) + (row.amount ?? 0))
  }
  return result
}

// ─── New: List distinct subcategories ─────────────────────────────────────────

export async function getExpenseSubcategories(category?: string): Promise<SubcategoryListResult> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    let query = supabase
      .from('expenses')
      .select('subcategory')
      .not('subcategory', 'is', null)
      .order('subcategory', { ascending: true })
    if (category) {
      query = query.eq('category', category)
    }
    const { data, error } = await query
    if (error) return { success: false, error: error.message }

    // Deduplicate in JS (no DISTINCT in Supabase JS client)
    const seen = new Set<string>()
    const subcategories: string[] = []
    for (const row of data ?? []) {
      const s = row.subcategory as string
      if (s && !seen.has(s)) { seen.add(s); subcategories.push(s) }
    }
    return { success: true, data: subcategories }
  } catch (error) {
    console.error('[analytics] getExpenseSubcategories:', error)
    return { success: false, error: 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

// ─── MetricRef dispatcher ─────────────────────────────────────────────────────

function dispatchFetcher(
  supabase: ReturnType<typeof createClient>,
  ref: MetricRef,
  start: string,
  end: string
): Promise<Map<string, number>> {
  switch (ref.kind) {
    case 'metric':
      switch (ref.key) {
        case 'revenue':     return fetchRevenue(supabase, start, end)
        case 'advertising': return fetchAdvertising(supabase, start, end)
        case 'cogs':        return fetchCOGS(supabase, start, end)
        case 'operating':   return fetchOperating(supabase, start, end)
        case 'orders':      return fetchOrders(supabase, start, end)
        case 'units':       return fetchUnits(supabase, start, end)
      }
      break
    case 'ads_spend':
      return fetchAdsByType(supabase, start, end, ref.campaignType)
    case 'expense_subcategory':
      return fetchExpenseSubcategory(supabase, start, end, ref.category, ref.subcategory)
    default:
      // funnel / fees / vat — unavailable, should not be dispatched
      return Promise.resolve(new Map())
  }
}

// ─── runAnalyticsBuilder ──────────────────────────────────────────────────────

export async function runAnalyticsBuilder(
  definition: AnalyticsDefinition
): Promise<RunAnalyticsResult> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    // Migrate old string[] presets to MetricRef[] on the way in
    const migrated = migrateDefinition(definition)
    const { metrics, expression, dateRange: dr } = migrated
    const { start, end } = dr

    if (!start || !end || start > end) return { success: false, error: 'ช่วงวันที่ไม่ถูกต้อง' }

    // Only dispatch fetchers for available metrics
    const availableRefs = metrics.filter(isMetricAvailable)
    const slots = availableRefs.map(getMetricSlot)
    const fetches = availableRefs.map((ref) => dispatchFetcher(supabase, ref, start, end))
    const resolved = await Promise.all(fetches)
    const metricMaps = Object.fromEntries(
      slots.map((slot, i) => [slot, resolved[i]])
    ) as Record<string, Map<string, number>>

    const dates = buildDateList(start, end)
    const rows: AnalyticsRow[] = dates.map((date) => {
      const metricValues: Record<string, number> = {}
      for (const ref of metrics) {
        const slot = getMetricSlot(ref)
        metricValues[slot] = Math.round((metricMaps[slot]?.get(date) ?? 0) * 100) / 100
      }

      let computed: number | null = null
      if (expression.trim()) {
        try {
          computed = evaluateExpression(expression, metricValues)
        } catch {
          computed = null
        }
      }

      return { date, metrics: metricValues, computed }
    })

    return { success: true, rows }
  } catch (error) {
    console.error('[analytics] runAnalyticsBuilder:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

// ─── exportAnalyticsBuilderCSV ────────────────────────────────────────────────

export async function exportAnalyticsBuilderCSV(
  definition: AnalyticsDefinition
): Promise<ExportAnalyticsResult> {
  try {
    const runResult = await runAnalyticsBuilder(definition)
    if (!runResult.success || !runResult.rows) {
      return { success: false, error: runResult.error }
    }

    const migrated = migrateDefinition(definition)
    const { metrics, expression, expressionLabel } = migrated
    const computedLabel = expressionLabel?.trim() || (expression.trim() ? 'Computed' : '')

    const metricHeaders = metrics.map((ref) => getMetricLabel(ref))
    const headers = ['Date', ...metricHeaders, ...(computedLabel ? [computedLabel] : [])]

    const csvRows = runResult.rows.map((row) => {
      const metricCells = metrics.map((ref) =>
        sanitizeCSVField(row.metrics[getMetricSlot(ref)] ?? 0)
      )
      const computedCell = computedLabel ? [sanitizeCSVField(row.computed ?? '')] : []
      return [sanitizeCSVField(row.date), ...metricCells, ...computedCell].join(',')
    })

    // UTF-8 BOM for Excel Thai
    const csvContent = '\uFEFF' + [headers.join(','), ...csvRows].join('\n')

    const now = getBangkokNow()
    const dateStr = formatBangkok(now, 'yyyyMMdd-HHmmss')
    const filename = `analytics-builder-${dateStr}.csv`

    return { success: true, csv: csvContent, filename }
  } catch (error) {
    console.error('[analytics] exportAnalyticsBuilderCSV:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

// ─── Preset CRUD ──────────────────────────────────────────────────────────────

export async function listAnalyticsPresets(): Promise<PresetActionResult> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { data, error } = await supabase
      .from('analytics_presets')
      .select('id, name, definition, created_at, updated_at, last_used_at')
      .order('updated_at', { ascending: false })

    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as AnalyticsPreset[] }
  } catch (error) {
    console.error('[analytics] listAnalyticsPresets:', error)
    return { success: false, error: 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

export async function createAnalyticsPreset(
  name: string,
  definition: AnalyticsDefinition
): Promise<PresetActionResult> {
  try {
    if (!name?.trim()) return { success: false, error: 'กรุณาระบุชื่อ preset' }

    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { data, error } = await supabase
      .from('analytics_presets')
      .insert({ name: name.trim(), definition, created_by: user.id })
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as AnalyticsPreset }
  } catch (error) {
    console.error('[analytics] createAnalyticsPreset:', error)
    return { success: false, error: 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

export async function updateAnalyticsPreset(
  id: string,
  updates: { name?: string; definition?: AnalyticsDefinition }
): Promise<PresetActionResult> {
  try {
    if (!id) return { success: false, error: 'ไม่พบ preset id' }

    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const payload: Record<string, unknown> = {}
    if (updates.name !== undefined) payload.name = updates.name.trim()
    if (updates.definition !== undefined) payload.definition = updates.definition

    const { data, error } = await supabase
      .from('analytics_presets')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as AnalyticsPreset }
  } catch (error) {
    console.error('[analytics] updateAnalyticsPreset:', error)
    return { success: false, error: 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

export async function deleteAnalyticsPreset(id: string): Promise<PresetActionResult> {
  try {
    if (!id) return { success: false, error: 'ไม่พบ preset id' }

    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { error } = await supabase
      .from('analytics_presets')
      .delete()
      .eq('id', id)

    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (error) {
    console.error('[analytics] deleteAnalyticsPreset:', error)
    return { success: false, error: 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

export async function touchAnalyticsPreset(id: string): Promise<void> {
  try {
    const supabase = createClient()
    await supabase
      .from('analytics_presets')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', id)
  } catch {
    // non-critical — silently ignore
  }
}
