/**
 * Analytics Builder — shared types
 * Used by BE actions, expression engine, and FE components.
 */

// ─── Simple (legacy) metric keys ─────────────────────────────────────────────

/** The original 6 built-in metrics. Kept as alias for backward compat. */
export type SimpleMetricKey =
  | 'revenue'      // SUM(sales_orders.total_amount) excluding cancelled — order-level
  | 'advertising'  // SUM(ad_daily_performance.spend) all campaigns
  | 'cogs'         // SUM(inventory_cogs_allocations.amount)
  | 'operating'    // SUM(expenses.amount) WHERE category='Operating'
  | 'orders'       // COUNT(DISTINCT order_id) from sales_orders, excluding cancelled
  | 'units'        // SUM(quantity) from sales_orders, excluding cancelled

/** @deprecated Use SimpleMetricKey or MetricRef instead */
export type MetricKey = SimpleMetricKey

export const ALL_METRIC_KEYS: SimpleMetricKey[] = [
  'revenue',
  'advertising',
  'cogs',
  'operating',
  'orders',
  'units',
]

/** Labels for the 6 simple metrics (kept for backward compat / basics section) */
export const METRIC_LABELS: Record<SimpleMetricKey, string> = {
  revenue: 'Revenue',
  advertising: 'Advertising',
  cogs: 'COGS',
  operating: 'Operating',
  orders: 'Orders',
  units: 'Units',
}

/** Format hint for the 6 simple metrics */
export const METRIC_FORMAT: Record<SimpleMetricKey, 'currency' | 'number'> = {
  revenue: 'currency',
  advertising: 'currency',
  cogs: 'currency',
  operating: 'currency',
  orders: 'number',
  units: 'number',
}

// ─── MetricRef — the new parameterized metric reference ───────────────────────

export type MetricRef =
  /** Built-in simple metric (backward-compat with SimpleMetricKey) */
  | { kind: 'metric';              key: SimpleMetricKey }
  /** Ad spend filtered by campaign_type in ad_daily_performance */
  | { kind: 'ads_spend';           campaignType: 'all' | 'product' | 'live' | 'aware' }
  /** Expense amount filtered by category + subcategory */
  | { kind: 'expense_subcategory'; category: 'Operating' | 'COGS' | 'Advertising' | 'Tax'; subcategory: string }
  /** Sales funnel status breakdown — UNAVAILABLE (needs BE status query) */
  | { kind: 'funnel';              metric: 'orders' | 'revenue' | 'units'; status: 'all' | 'cancel' | 'refund' | 'ship' }
  /** Platform/marketplace fees placeholder — UNAVAILABLE (no data source) */
  | { kind: 'fees';                key: string }
  /** VAT placeholder — UNAVAILABLE (no data source) */
  | { kind: 'vat';                 key: string }

// ─── Availability ─────────────────────────────────────────────────────────────

/**
 * Returns true if the BE can currently fetch this metric.
 * Unavailable refs should be shown as disabled chips in the UI.
 * Run is blocked when any canvas metric is !isMetricAvailable.
 *
 * NOTE: expense_subcategory is always available — if subcategory has no matching
 * expenses, the BE simply returns 0. Use the "example-warning" UX pattern
 * (amber badge) to hint that a subcategory name may not match DB data.
 */
export function isMetricAvailable(ref: MetricRef): boolean {
  switch (ref.kind) {
    case 'metric':              return true
    case 'ads_spend':           return true
    case 'expense_subcategory': return true
    case 'funnel':              return false
    case 'fees':                return false
    case 'vat':                 return false
    default:                    return false
  }
}

export function getUnavailableReason(ref: MetricRef): string | null {
  if (isMetricAvailable(ref)) return null
  switch (ref.kind) {
    case 'funnel': return 'Needs status-based query (not yet implemented)'
    case 'fees':   return 'No data source yet'
    case 'vat':    return 'No data source yet'
    default:       return 'Unavailable'
  }
}

// ─── Slot name (expression context key) ──────────────────────────────────────

/**
 * Returns a stable identifier used as:
 *  1. Expression context key (what users type in the expression field)
 *  2. Key in AnalyticsRow.metrics record
 *  3. React element key (via getMetricRefKey)
 *
 * Slot names are valid JS identifiers (a-z, 0-9, underscore).
 * Simple metrics keep their original key names for backward compat.
 */
export function getMetricSlot(ref: MetricRef): string {
  switch (ref.kind) {
    case 'metric':
      return ref.key

    case 'ads_spend':
      return ref.campaignType === 'all' ? 'ads_all' : `ads_${ref.campaignType}`

    case 'expense_subcategory': {
      // Prefix: op_ / co_ / ad_ based on first 2 chars of category
      const catPrefix = ref.category.slice(0, 2).toLowerCase()
      const sub = ref.subcategory
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 15)
      return `x_${catPrefix}_${sub}`
    }

    case 'funnel':
      return `fn_${ref.metric}_${ref.status}`

    case 'fees':
      return `fees_${ref.key.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 15)}`

    case 'vat':
      return `vat_${ref.key.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 15)}`
  }
}

/** Stable React element key — same as slot */
export function getMetricRefKey(ref: MetricRef): string {
  return getMetricSlot(ref)
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export function getMetricLabel(ref: MetricRef): string {
  switch (ref.kind) {
    case 'metric':
      return METRIC_LABELS[ref.key]

    case 'ads_spend': {
      const ct = ref.campaignType
      if (ct === 'all') return 'Ads (All)'
      return `Ads (${ct.charAt(0).toUpperCase() + ct.slice(1)})`
    }

    case 'expense_subcategory':
      return `${ref.subcategory} (${ref.category})`

    case 'funnel': {
      const mLabel: Record<string, string> = { orders: 'Orders', revenue: 'Revenue', units: 'Units' }
      const sLabel: Record<string, string> = { all: 'All', cancel: 'Cancelled', refund: 'Refunded', ship: 'Shipped' }
      return `${sLabel[ref.status]} ${mLabel[ref.metric]}`
    }

    case 'fees':
      return `Fees (${ref.key})`

    case 'vat':
      return `VAT (${ref.key})`
  }
}

export function getMetricFormat(ref: MetricRef): 'currency' | 'number' {
  switch (ref.kind) {
    case 'metric':
      return METRIC_FORMAT[ref.key]
    case 'ads_spend':
      return 'currency'
    case 'expense_subcategory':
      return 'currency'
    case 'funnel':
      return ref.metric === 'revenue' ? 'currency' : 'number'
    case 'fees':
      return 'currency'
    case 'vat':
      return 'currency'
  }
}

// ─── Backward compat migration ───────────────────────────────────────────────

/**
 * Migrates an old preset definition (metrics: string[]) to the new MetricRef[] format.
 * Safe to call on already-new-format definitions (MetricRef[] is passed through).
 */
export function migrateDefinition(def: unknown): AnalyticsDefinition {
  if (!def || typeof def !== 'object') {
    return { metrics: [], expression: '', dateRange: { start: '', end: '' }, dimension: 'date' }
  }
  const d = def as Record<string, unknown>

  let metrics: MetricRef[] = []
  if (Array.isArray(d.metrics)) {
    metrics = d.metrics.map((m: unknown): MetricRef => {
      // Old format: plain string → wrap as simple metric ref
      if (typeof m === 'string') {
        return { kind: 'metric', key: m as SimpleMetricKey }
      }
      // New format: already a MetricRef object
      return m as MetricRef
    })
  }

  const dr = d.dateRange as { start: string; end: string } | undefined

  return {
    metrics,
    expression: typeof d.expression === 'string' ? d.expression : '',
    expressionLabel: typeof d.expressionLabel === 'string' ? d.expressionLabel : undefined,
    dateRange: dr ?? { start: '', end: '' },
    dimension: d.dimension === 'product' ? 'product' : 'date',
  }
}

// ─── Core data types ──────────────────────────────────────────────────────────

export interface AnalyticsDefinition {
  /** Metrics on the canvas (MetricRef objects, ordered) */
  metrics: MetricRef[]
  /** Math expression using slot names, e.g. "revenue - cogs - ads_product" */
  expression: string
  /** Human-readable label for the computed column (optional) */
  expressionLabel?: string
  /** Date range, YYYY-MM-DD, Bangkok calendar dates */
  dateRange: { start: string; end: string }
  /** Dimension: 'date' (available) | 'product' (not yet implemented in BE) */
  dimension: 'date' | 'product'
}

export interface AnalyticsRow {
  date: string
  /** Keyed by slot name from getMetricSlot(ref) */
  metrics: Record<string, number>
  computed: number | null
}

// ─── Preset ───────────────────────────────────────────────────────────────────

export interface AnalyticsPreset {
  id: string
  name: string
  definition: AnalyticsDefinition
  created_at: string
  updated_at: string
  last_used_at: string | null
}

// ─── Action result types ──────────────────────────────────────────────────────

export interface RunAnalyticsResult {
  success: boolean
  error?: string
  rows?: AnalyticsRow[]
}

export interface ExportAnalyticsResult {
  success: boolean
  error?: string
  csv?: string
  filename?: string
}

export interface PresetActionResult {
  success: boolean
  error?: string
  data?: AnalyticsPreset | AnalyticsPreset[]
}

export interface SubcategoryListResult {
  success: boolean
  error?: string
  data?: string[]
}
