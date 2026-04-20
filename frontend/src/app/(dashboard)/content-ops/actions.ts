'use server'

import { unstable_noStore as noStore } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  type AttributionDiagnostics,
  type AttributionSurfaceState,
  buildAttributionLimitedMessage,
  createAttributionDiagnostics,
  getAttributionQueryMeta,
  getAttributionSurfaceState,
  logAttributionDiagnostics,
} from './attribution-query-utils'
import { getBangkokToday, offsetDate, buildDayArray } from './date-utils'
import {
  CONTENT_OPS_STATUS_LABELS,
  normalizeContentOpsStatus,
} from './status-utils'

// ─── Status mapping ────────────────────────────────────────────────────────────

function mapStatusBucket(status: string): 'settled' | 'pending' | 'awaiting_payment' | 'ineligible' | 'other' {
  const normalized = normalizeContentOpsStatus(status)
  return normalized ?? 'other'
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface OverviewStats {
  totalOrderItems: number
  uniqueProducts: number
  uniqueShops: number
  uniqueContentIds: number
}

export interface StatusBucket {
  key: 'settled' | 'pending' | 'awaiting_payment' | 'ineligible' | 'other'
  label: string
  count: number
  percent: number
}

export interface TopProductRow {
  productId: string
  productName: string | null
  orderItems: number
  shopCount: number
  sharePercent: number
}

export interface TopShopRow {
  shopCode: string
  shopName: string | null
  orderItems: number
  productCount: number
  sharePercent: number
}

export interface HealthSnapshotItem {
  label: string
  status: 'ok' | 'warning' | 'error' | 'info'
  description: string
  href?: string
}

export interface OverviewData {
  stats: OverviewStats
  statusBreakdown: StatusBucket[]
  topProducts: TopProductRow[]
  topShops: TopShopRow[]
  healthSnapshot: HealthSnapshotItem[]
}

// ─── Overview ──────────────────────────────────────────────────────────────────

export async function getOverviewData(): Promise<{ data: OverviewData | null; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'Unauthenticated' }

  // Parallel: facts aggregation + cost health check
  const [factsRes, costsRes] = await Promise.all([
    supabase
      .from('content_order_facts')
      .select('product_id,product_name,shop_code,shop_name,content_id,order_settlement_status')
      .eq('created_by', user.id)
      .limit(200000),
    supabase
      .from('tt_content_costs')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', user.id),
  ])

  if (factsRes.error) return { data: null, error: factsRes.error.message }

  const rows = factsRes.data ?? []
  const costsCount = costsRes.count ?? 0

  // Aggregate all in one pass
  const productIds = new Set<string>()
  const shopCodes = new Set<string>()
  const contentIds = new Set<string>()
  const statusCounts = new Map<string, number>()
  const productMap = new Map<string, { name: string | null; items: number; shops: Set<string> }>()
  const shopMap = new Map<string, { name: string | null; items: number; products: Set<string> }>()

  for (const r of rows) {
    if (r.product_id) productIds.add(r.product_id)
    if (r.shop_code) shopCodes.add(r.shop_code)
    if (r.content_id) contentIds.add(r.content_id)

    const bucket = mapStatusBucket(r.order_settlement_status ?? '')
    statusCounts.set(bucket, (statusCounts.get(bucket) ?? 0) + 1)

    if (r.product_id) {
      const p = productMap.get(r.product_id) ?? { name: null, items: 0, shops: new Set() }
      p.items++
      if (!p.name && r.product_name) p.name = r.product_name
      if (r.shop_code) p.shops.add(r.shop_code)
      productMap.set(r.product_id, p)
    }

    if (r.shop_code) {
      const s = shopMap.get(r.shop_code) ?? { name: null, items: 0, products: new Set() }
      s.items++
      if (!s.name && r.shop_name) s.name = r.shop_name
      if (r.product_id) s.products.add(r.product_id)
      shopMap.set(r.shop_code, s)
    }
  }

  const total = rows.length

  const statusBreakdown: StatusBucket[] = (['settled', 'pending', 'awaiting_payment', 'ineligible'] as const).map((key) => ({
    key,
    label: CONTENT_OPS_STATUS_LABELS[key],
    count: statusCounts.get(key) ?? 0,
    percent: total > 0 ? Math.round(((statusCounts.get(key) ?? 0) / total) * 1000) / 10 : 0,
  }))

  const topProducts: TopProductRow[] = [...productMap.entries()]
    .map(([productId, v]) => ({
      productId,
      productName: v.name,
      orderItems: v.items,
      shopCount: v.shops.size,
      sharePercent: total > 0 ? Math.round((v.items / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.orderItems - a.orderItems)
    .slice(0, 10)

  const topShops: TopShopRow[] = [...shopMap.entries()]
    .map(([shopCode, v]) => ({
      shopCode,
      shopName: v.name,
      orderItems: v.items,
      productCount: v.products.size,
      sharePercent: total > 0 ? Math.round((v.items / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.orderItems - a.orderItems)
    .slice(0, 10)

  const healthSnapshot: HealthSnapshotItem[] = [
    {
      label: 'Orders imported',
      status: total > 0 ? 'ok' : 'warning',
      description: total > 0 ? `${total.toLocaleString()} order items imported and normalized` : 'No order data — upload a file first',
      href: '/content-ops/analysis/orders',
    },
    {
      label: 'Product mapping',
      status: productIds.size > 0 ? 'ok' : 'warning',
      description: productIds.size > 0 ? `${productIds.size} products mapped from order data` : 'No products found',
      href: '/content-ops/products',
    },
    {
      label: 'Showcase connection',
      status: 'warning',
      description: 'Not connected — showcase data not available',
    },
    {
      label: 'Studio snapshot',
      status: 'info',
      description: 'File-based sync only — not live',
      href: '/content-ops/library',
    },
    {
      label: 'Cost data',
      status: costsCount > 0 ? 'ok' : 'warning',
      description: costsCount > 0 ? `${costsCount} cost rows entered` : 'No costs entered — profit cannot be calculated',
      href: '/content-ops/tiktok-affiliate/costs',
    },
  ]

  return {
    data: { stats: { totalOrderItems: total, uniqueProducts: productIds.size, uniqueShops: shopCodes.size, uniqueContentIds: contentIds.size }, statusBreakdown, topProducts, topShops, healthSnapshot },
    error: null,
  }
}


// ─── Product detail ────────────────────────────────────────────────────────────

export interface ProductDetailStats {
  productId: string
  productName: string | null
  totalOrderItems: number
  shopCount: number
  settledCount: number
  settledPercent: number
  topShopName: string | null
}

export interface RelatedOrderRow {
  orderId: string
  skuId: string | null
  shopName: string | null
  status: string
  contentId: string
}

export interface ProductDetail {
  stats: ProductDetailStats
  statusBreakdown: StatusBucket[]
  topShops: Array<{ label: string; value: number; href?: string }>
  topContentIds: Array<{ label: string; value: number }>
  relatedOrders: RelatedOrderRow[]
}

export async function getProductDetail(
  productId: string
): Promise<{ data: ProductDetail | null; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'Unauthenticated' }

  // ── Source 1: tt_product_master (identity) ────────────────────────────────────
  // Used for: canonical product_name — resolves to most recent non-null name across
  // all import batches, which is more stable than scanning individual fact rows.
  // NOT used for counts: master stats may be stale between refresh runs.
  //
  // ── Source 2: content_order_facts (metrics) ────────────────────────────────────
  // Used for: all counts (totalOrderItems, settledCount, shopCount), status
  // breakdown, top shops list, top content IDs, related orders.
  // Facts are always current — no refresh required.
  const [masterRes, factsRes] = await Promise.all([
    supabase
      .from('tt_product_master')
      .select('product_id,product_name,shop_code,shop_name')
      .eq('created_by', user.id)
      .eq('product_id', productId)
      .maybeSingle(),
    supabase
      .from('content_order_facts')
      .select('order_id,sku_id,product_name,shop_code,shop_name,content_id,order_settlement_status,is_successful')
      .eq('created_by', user.id)
      .eq('product_id', productId),
  ])

  if (factsRes.error) return { data: null, error: factsRes.error.message }

  const rows = factsRes.data ?? []
  const master = masterRes.data  // null when master refresh has not yet run

  if (!master && rows.length === 0) return { data: null, error: 'Product not found' }

  // Aggregate facts for all derived metrics
  const shopMap = new Map<string, { name: string | null; count: number }>()
  const contentMap = new Map<string, number>()
  const statusCounts = new Map<string, number>()
  let productNameFromFacts: string | null = null
  let settledCount = 0

  for (const r of rows) {
    if (!productNameFromFacts && r.product_name) productNameFromFacts = r.product_name
    if (r.is_successful) settledCount++
    const bucket = mapStatusBucket(r.order_settlement_status ?? '')
    statusCounts.set(bucket, (statusCounts.get(bucket) ?? 0) + 1)
    if (r.shop_code) {
      const s = shopMap.get(r.shop_code) ?? { name: null, count: 0 }
      s.count++
      if (!s.name && r.shop_name) s.name = r.shop_name
      shopMap.set(r.shop_code, s)
    }
    if (r.content_id) {
      contentMap.set(r.content_id, (contentMap.get(r.content_id) ?? 0) + 1)
    }
  }

  const topShopEntry = [...shopMap.entries()].sort((a, b) => b[1].count - a[1].count)[0]
  const total = rows.length

  // Identity from master (canonical); fallback to first non-null value in facts
  const productName = master?.product_name ?? productNameFromFacts

  const stats: ProductDetailStats = {
    productId,
    productName,
    totalOrderItems: total,
    shopCount: shopMap.size,
    settledCount,
    settledPercent: total > 0 ? Math.round((settledCount / total) * 1000) / 10 : 0,
    topShopName: topShopEntry ? (topShopEntry[1].name ?? topShopEntry[0]) : null,
  }

  const statusBreakdown: StatusBucket[] = (['settled', 'pending', 'awaiting_payment', 'ineligible'] as const).map((key) => ({
    key,
    label: CONTENT_OPS_STATUS_LABELS[key],
    count: statusCounts.get(key) ?? 0,
    percent: total > 0 ? Math.round(((statusCounts.get(key) ?? 0) / total) * 1000) / 10 : 0,
  }))

  const topShops = [...shopMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([code, v]) => ({
      label: v.name ?? code,
      value: v.count,
      href: `/content-ops/shops/${encodeURIComponent(code)}`,
    }))

  const topContentIds = [...contentMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => ({ label: id, value: count }))

  const relatedOrders: RelatedOrderRow[] = rows.slice(0, 10).map((r) => ({
    orderId: r.order_id,
    skuId: r.sku_id ?? null,
    shopName: r.shop_name ?? r.shop_code ?? null,
    status: r.order_settlement_status,
    contentId: r.content_id,
  }))

  return { data: { stats, statusBreakdown, topShops, topContentIds, relatedOrders }, error: null }
}


// ─── Shop detail ───────────────────────────────────────────────────────────────

export interface ShopDetailStats {
  shopCode: string
  shopName: string | null
  totalOrderItems: number
  productCount: number
  settledCount: number
  settledPercent: number
  topProductName: string | null
}

export interface ShopDetail {
  stats: ShopDetailStats
  statusBreakdown: StatusBucket[]
  topProducts: Array<{ label: string; value: number; href?: string }>
  topContentIds: Array<{ label: string; value: number }>
  relatedOrders: RelatedOrderRow[]
}

export async function getShopDetail(
  shopCode: string
): Promise<{ data: ShopDetail | null; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'Unauthenticated' }

  // ── Source 1: tt_shop_master (identity) ───────────────────────────────────────
  // Used for: canonical shop_name — resolves to most recent non-null name across
  // all import batches, more stable than scanning individual fact rows.
  // NOT used for counts: master stats may be stale between refresh runs.
  //
  // ── Source 2: content_order_facts (metrics) ────────────────────────────────────
  // Used for: all counts (totalOrderItems, settledCount, productCount), status
  // breakdown, top products list, top content IDs, related orders.
  // Facts are always current — no refresh required.
  const [masterRes, factsRes] = await Promise.all([
    supabase
      .from('tt_shop_master')
      .select('shop_code,shop_name')
      .eq('created_by', user.id)
      .eq('shop_code', shopCode)
      .maybeSingle(),
    supabase
      .from('content_order_facts')
      .select('order_id,sku_id,product_id,product_name,shop_name,content_id,order_settlement_status,is_successful')
      .eq('created_by', user.id)
      .eq('shop_code', shopCode),
  ])

  if (factsRes.error) return { data: null, error: factsRes.error.message }

  const rows = factsRes.data ?? []
  const master = masterRes.data  // null when master refresh has not yet run

  if (!master && rows.length === 0) return { data: null, error: 'Shop not found' }

  // Aggregate facts for all derived metrics
  const productMap = new Map<string, { name: string | null; count: number }>()
  const contentMap = new Map<string, number>()
  const statusCounts = new Map<string, number>()
  let shopNameFromFacts: string | null = null
  let settledCount = 0

  for (const r of rows) {
    if (!shopNameFromFacts && r.shop_name) shopNameFromFacts = r.shop_name
    if (r.is_successful) settledCount++
    const bucket = mapStatusBucket(r.order_settlement_status ?? '')
    statusCounts.set(bucket, (statusCounts.get(bucket) ?? 0) + 1)
    if (r.product_id) {
      const p = productMap.get(r.product_id) ?? { name: null, count: 0 }
      p.count++
      if (!p.name && r.product_name) p.name = r.product_name
      productMap.set(r.product_id, p)
    }
    if (r.content_id) {
      contentMap.set(r.content_id, (contentMap.get(r.content_id) ?? 0) + 1)
    }
  }

  const topProductEntry = [...productMap.entries()].sort((a, b) => b[1].count - a[1].count)[0]
  const total = rows.length

  // Identity from master (canonical); fallback to first non-null value in facts
  const shopName = master?.shop_name ?? shopNameFromFacts

  const stats: ShopDetailStats = {
    shopCode,
    shopName,
    totalOrderItems: total,
    productCount: productMap.size,
    settledCount,
    settledPercent: total > 0 ? Math.round((settledCount / total) * 1000) / 10 : 0,
    topProductName: topProductEntry ? (topProductEntry[1].name ?? topProductEntry[0]) : null,
  }

  const statusBreakdown: StatusBucket[] = (['settled', 'pending', 'awaiting_payment', 'ineligible'] as const).map((key) => ({
    key,
    label: CONTENT_OPS_STATUS_LABELS[key],
    count: statusCounts.get(key) ?? 0,
    percent: total > 0 ? Math.round(((statusCounts.get(key) ?? 0) / total) * 1000) / 10 : 0,
  }))

  const topProducts = [...productMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([id, v]) => ({
      label: v.name ?? id,
      value: v.count,
      href: `/content-ops/products/${encodeURIComponent(id)}`,
    }))

  const topContentIds = [...contentMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => ({ label: id, value: count }))

  const relatedOrders: RelatedOrderRow[] = rows.slice(0, 10).map((r) => ({
    orderId: r.order_id,
    skuId: r.sku_id ?? null,
    shopName,
    status: r.order_settlement_status,
    contentId: r.content_id,
  }))

  return { data: { stats, statusBreakdown, topProducts, topContentIds, relatedOrders }, error: null }
}

// ─── Orders Explorer ───────────────────────────────────────────────────────────

export interface ExplorerRow {
  id: string
  orderId: string
  skuId: string | null
  productId: string
  productName: string | null
  shopCode: string | null
  shopName: string | null
  status: string
  contentId: string
  orderDate: string | null
}

export async function getOrdersExplorer(
  filters: { query?: string; productId?: string; shopCode?: string; status?: string; contentId?: string; from?: string; to?: string } = {},
  limit = 50,
  offset = 0
): Promise<{ data: ExplorerRow[]; total: number; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: [], total: 0, error: 'Unauthenticated' }

  let q = supabase
    .from('content_order_facts')
    .select('id,order_id,sku_id,product_id,product_name,shop_code,shop_name,content_id,order_settlement_status,order_date', { count: 'exact' })
    .eq('created_by', user.id)

  if (filters.from) q = q.gte('order_date', filters.from)
  if (filters.to) q = q.lte('order_date', filters.to)
  if (filters.productId) q = q.eq('product_id', filters.productId)
  if (filters.shopCode) q = q.eq('shop_code', filters.shopCode)
  if (filters.contentId) q = q.eq('content_id', filters.contentId)
  if (filters.status) {
    const normalizedStatus = normalizeContentOpsStatus(filters.status)
    if (!normalizedStatus) {
      return { data: [], total: 0, error: `Unsupported status filter: ${filters.status}` }
    }
    q = q.eq('order_settlement_status', normalizedStatus)
  }
  if (filters.query) q = q.or(`order_id.ilike.%${filters.query}%,product_name.ilike.%${filters.query}%,content_id.ilike.%${filters.query}%`)

  const { data, count, error } = await q
    .order('order_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return { data: [], total: 0, error: error.message }

  const rows: ExplorerRow[] = (data ?? []).map((r) => ({
    id: r.id,
    orderId: r.order_id,
    skuId: r.sku_id ?? null,
    productId: r.product_id,
    productName: r.product_name ?? null,
    shopCode: r.shop_code ?? null,
    shopName: r.shop_name ?? null,
    status: r.order_settlement_status,
    contentId: r.content_id,
    orderDate: r.order_date ?? null,
  }))

  return { data: rows, total: count ?? 0, error: null }
}

// ─── Attribution full ──────────────────────────────────────────────────────────

export interface AttributionSummary {
  mappedRows: number
  uniqueContentIds: number
  uniqueProducts: number
  mode: 'exact' | 'page_slice'
}

export interface AttributionFullRow {
  orderId: string
  productId: string
  productName: string | null
  contentId: string
  shopName: string | null
  normalizedStatus: string
  businessBucket: string
  orderItems: number
  settledItems: number
  orderDate: string | null
}

export async function getAttributionFull(
  filters: { contentId?: string; bucket?: string } = {},
  limit = 50,
  offset = 0
): Promise<{
  data: AttributionFullRow[]
  summary: AttributionSummary
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
      summary: { mappedRows: 0, uniqueContentIds: 0, uniqueProducts: 0, mode: 'page_slice' },
      total: null,
      totalKnown: false,
      hasMore: false,
      state: 'failed',
      notice: null,
      error: 'Unauthenticated',
      diagnostics: createAttributionDiagnostics({
        queryPath: 'analysis_attribution_unauthenticated',
        durationMs: 0,
        degraded: false,
        timedOut: false,
        totalMode: 'skipped',
        summaryMode: 'skipped',
      }),
    }
  }

  const startedAt = Date.now()
  let q = supabase
    .from('content_order_attribution')
    .select('order_id,product_id,product_name,content_id,currency,order_date,normalized_status,business_bucket,is_realized,source_fact_count')
    .eq('created_by', user.id)

  if (filters.contentId) q = q.eq('content_id', filters.contentId)
  if (filters.bucket) q = q.eq('business_bucket', filters.bucket)

  const { data, error } = await q
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
    logAttributionDiagnostics('analysis_attribution_rows', state, diagnostics, attributionQuery.message)

    return {
      data: [],
      summary: { mappedRows: 0, uniqueContentIds: 0, uniqueProducts: 0, mode: 'page_slice' },
      total: null,
      totalKnown: false,
      hasMore: false,
      state,
      notice: null,
      error: attributionQuery.message,
      diagnostics,
    }
  }

  // Compute summary from current page — for full summary, we'd need all rows
  // Use a separate count query for unique content IDs and products
  const rawRows = data ?? []
  const hasMore = rawRows.length > limit
  const pageRows = rawRows.slice(0, limit)
  const totalKnown = !hasMore && (offset === 0 || pageRows.length > 0)
  const total = totalKnown ? offset + pageRows.length : null
  const summaryMode: AttributionSummary['mode'] = offset === 0 && !hasMore ? 'exact' : 'page_slice'
  const queryMeta = getAttributionQueryMeta(null, pageRows.length, 'Attribution')
  const diagnostics = createAttributionDiagnostics({
    queryPath: 'stable_page_slice',
    durationMs,
    degraded: hasMore || summaryMode !== 'exact',
    timedOut: false,
    totalMode: totalKnown ? 'derived_last_page' : 'skipped',
    summaryMode: summaryMode === 'exact' ? 'exact' : 'page_slice',
  })
  const state = getAttributionSurfaceState(queryMeta, pageRows.length, diagnostics.degraded)
  const notice = state === 'partial'
    ? buildAttributionLimitedMessage('Attribution', {
        exactTotals: totalKnown,
        exactSummary: summaryMode === 'exact',
      })
    : null

  const rows: AttributionFullRow[] = pageRows.map((r) => ({
    orderId: r.order_id,
    productId: r.product_id,
    productName: r.product_name ?? null,
    contentId: r.content_id,
    shopName: null,
    normalizedStatus: r.normalized_status,
    businessBucket: r.business_bucket,
    orderItems: r.source_fact_count ?? 1,
    settledItems: r.is_realized ? (r.source_fact_count ?? 1) : 0,
    orderDate: r.order_date ?? null,
  }))

  const summary: AttributionSummary = {
    mappedRows: summaryMode === 'exact' && total !== null ? total : pageRows.length,
    uniqueContentIds: new Set(pageRows.map((r) => r.content_id)).size,
    uniqueProducts: new Set(pageRows.map((r) => r.product_id)).size,
    mode: summaryMode,
  }

  logAttributionDiagnostics('analysis_attribution_rows', state, diagnostics, notice)

  return {
    data: rows,
    summary,
    total,
    totalKnown,
    hasMore,
    state,
    notice,
    error: null,
    diagnostics,
  }
}

// ─── Data Health ───────────────────────────────────────────────────────────────

export interface PipelineStatusItem {
  label: string
  status: 'ok' | 'warning' | 'error'
  detail: string
}

export interface KnownGapItem {
  title: string
  severity: 'high' | 'medium' | 'low'
  description: string
}

export interface CoverageMetricItem {
  label: string
  value: number | null
  suffix: string
}

export interface TechnicalNextAction {
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
}

export interface DataHealthData {
  pipeline: PipelineStatusItem[]
  knownGaps: KnownGapItem[]
  coverageMetrics: CoverageMetricItem[]
  nextActions: TechnicalNextAction[]
}

export async function getDataHealth(): Promise<{ data: DataHealthData | null; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'Unauthenticated' }

  const [factsRes, batchesRes, costsRes, profitRes] = await Promise.all([
    supabase.from('content_order_facts').select('id,product_id,shop_code,content_id', { count: 'exact' }).eq('created_by', user.id).limit(200000),
    supabase.from('tiktok_affiliate_import_batches').select('id', { count: 'exact', head: true }).eq('created_by', user.id),
    supabase.from('tt_content_costs').select('id', { count: 'exact', head: true }).eq('created_by', user.id),
    supabase.from('content_profit_attribution_summary').select('content_id', { count: 'exact', head: true }).eq('created_by', user.id),
  ])

  const factRows = factsRes.data ?? []
  const factsCount = factsRes.count ?? 0
  const batchCount = batchesRes.count ?? 0
  const costsCount = costsRes.count ?? 0
  const profitCount = profitRes.count ?? 0
  let attributionState: AttributionSurfaceState = factsCount > 0 ? 'partial' : 'no_data'
  let attributionDetail = factsCount > 0
    ? 'Partial: attribution probe has not run yet.'
    : 'No normalized facts available for attribution.'
  let attributionCoverage: number | null = factsCount === 0 ? 0 : null

  if (factsCount > 0) {
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
    const diagnostics = createAttributionDiagnostics({
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

    attributionDetail =
      attributionState === 'success'
        ? `Attribution loaded. ${diagnostics.queryPath} completed in ${diagnostics.durationMs} ms.`
        : attributionState === 'partial'
        ? `${buildAttributionLimitedMessage('Attribution', { probeOnly: true })} ${diagnostics.queryPath} completed in ${diagnostics.durationMs} ms.`
        : attributionState === 'no_data'
        ? 'No attribution rows found.'
        : `${attributionQuery.message ?? 'Attribution query failed.'} ${diagnostics.queryPath} completed in ${diagnostics.durationMs} ms.`

    attributionCoverage = attributionState === 'no_data' ? 0 : null
    logAttributionDiagnostics('data_health_attribution_probe', attributionState, diagnostics, attributionDetail)
  }

  // Compute coverage
  const uniqueProducts = new Set(factRows.map((r) => r.product_id).filter(Boolean)).size
  const uniqueShops = new Set(factRows.map((r) => r.shop_code).filter(Boolean)).size
  const uniqueContent = new Set(factRows.map((r) => r.content_id).filter(Boolean)).size

  // Coverage: assume 100% if data exists (since all come from same source)
  const productMapped = factsCount > 0 && uniqueProducts > 0 ? 100 : 0
  const shopMapped = factsCount > 0 && uniqueShops > 0 ? 100 : 0
  const contentLinked = factsCount > 0 ? Math.round((uniqueContent / factsCount) * 100) : 0

  const pipeline: PipelineStatusItem[] = [
    {
      label: 'Import',
      status: batchCount > 0 ? 'ok' : 'warning',
      detail: batchCount > 0 ? `${batchCount} batches imported` : 'No import batches found',
    },
    {
      label: 'Normalization',
      status: factsCount > 0 ? 'ok' : 'warning',
      detail: factsCount > 0 ? `${factsCount.toLocaleString()} facts normalized` : 'No normalized facts',
    },
    {
      label: 'Attribution',
      status:
        attributionState === 'success'
          ? 'ok'
          : attributionState === 'partial' || attributionState === 'no_data'
          ? 'warning'
          : 'error',
      detail: attributionDetail,
    },
    {
      label: 'Cost allocation',
      status: costsCount > 0 ? 'ok' : 'warning',
      detail: costsCount > 0 ? `${costsCount} cost rows entered` : 'No cost data — profit estimates only',
    },
    {
      label: 'Profit summary',
      status: profitCount > 0 ? 'ok' : (costsCount === 0 ? 'warning' : 'error'),
      detail: profitCount > 0 ? `${profitCount} summary rows computed` : 'Run profit refresh to generate',
    },
  ]

  const knownGaps: KnownGapItem[] = [
    {
      title: 'Showcase not connected',
      severity: 'medium',
      description: 'TikTok Showcase data is not linked — content performance cannot be correlated with shop showcase display.',
    },
    {
      title: 'Studio snapshot is file-based',
      severity: 'low',
      description: 'Studio data is imported manually via file snapshot, not a live sync. Data may be stale.',
    },
    {
      title: 'No cost data entered',
      severity: costsCount === 0 ? 'high' : 'low',
      description: costsCount === 0
        ? 'Cost data is required for profit calculation. Current profit = commission only.'
        : `${costsCount} cost rows entered. Verify allocations are complete.`,
    },
  ]

  const coverageMetrics: CoverageMetricItem[] = [
    { label: 'Products mapped', value: productMapped, suffix: '%' },
    { label: 'Shops mapped', value: shopMapped, suffix: '%' },
    { label: 'Content linked', value: contentLinked, suffix: '%' },
    {
      label: 'Attribution coverage',
      value: attributionCoverage,
      suffix: '%',
    },
  ]

  const nextActions: TechnicalNextAction[] = [
    ...(costsCount === 0 ? [{
      title: 'Enter cost data',
      description: 'Add ads, creator, and other costs to enable profit calculation.',
      priority: 'high' as const,
    }] : []),
    {
      title: 'Connect Showcase',
      description: 'Link TikTok Showcase to correlate content with shop display performance.',
      priority: 'medium',
    },
    {
      title: 'Set up live Studio sync',
      description: 'Replace file-based snapshot with live Studio data ingestion.',
      priority: 'low',
    },
    ...(profitCount === 0 && costsCount > 0 ? [{
      title: 'Run profit refresh',
      description: 'Cost data exists but profit summary is empty. Run refresh to generate.',
      priority: 'high' as const,
    }] : []),
  ]

  return {
    data: { pipeline, knownGaps, coverageMetrics, nextActions },
    error: null,
  }
}

// ─── Date utilities re-exported from ./date-utils ─────────────────────────────
// (getBangkokToday, offsetDate, buildDayArray, getDefaultDateRange are imported above)

// ─── Date-filtered overview ────────────────────────────────────────────────────

export interface OverviewDataFiltered {
  stats: OverviewStats
  statusBreakdown: StatusBucket[]
  topProducts: TopProductRow[]
  topShops: TopShopRow[]
}

export async function getOverviewDataFiltered(
  from: string,
  to: string
): Promise<{ data: OverviewDataFiltered | null; error: string | null }> {
  // Opt out of Next.js data cache unconditionally. force-dynamic on the page
  // disables the route cache, but not the per-fetch data cache. This ensures
  // fresh Supabase queries on every router.push() navigation.
  noStore()

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'Unauthenticated' }

  // Three parallel queries — all scoped to (created_by, from, to):
  //
  //   countRes  — exact total via SELECT COUNT(*) — not subject to max-rows
  //   dataRes   — 5 columns, ORDER BY order_date DESC, for status breakdown + top lists
  //               (most-recent 1000 rows; better sample than insertion-order oldest rows)
  //   kpiRes    — exact distinct counts via COUNT(DISTINCT col) global aggregates
  //
  // PostgREST grouped aggregates (non-aggregate col + aggregate cols → implicit GROUP BY)
  // fail silently on this Supabase instance — topProductsAggRes / topShopsAggRes returned
  // null data, causing empty top-list state even when KPI cards showed non-zero values.
  // Reverted to sample-based top lists. ORDER BY order_date DESC ensures the sample
  // reflects recent activity rather than oldest insertions.
  const [countRes, dataRes, kpiRes] = await Promise.all([
    supabase
      .from('content_order_facts')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', user.id)
      .gte('order_date', from)
      .lte('order_date', to),

    // 5-column fetch, most-recent rows first — status breakdown + top-list ranking.
    supabase
      .from('content_order_facts')
      .select('product_id,product_name,shop_code,shop_name,order_settlement_status')
      .eq('created_by', user.id)
      .gte('order_date', from)
      .lte('order_date', to)
      .order('order_date', { ascending: false }),

    supabase
      .from('content_order_facts')
      .select('unique_products:product_id.count(distinct=true), unique_shops:shop_code.count(distinct=true), unique_content_ids:content_id.count(distinct=true)')
      .eq('created_by', user.id)
      .gte('order_date', from)
      .lte('order_date', to),
  ])

  if (dataRes.error) return { data: null, error: dataRes.error.message }

  // Exact total from COUNT(*).
  const totalOrderItems = countRes.count ?? (dataRes.data?.length ?? 0)

  // Build status counts + top-list maps from the 1000-row sample (most-recent rows).
  // productIds / shopCodes Sets are used as fallback KPI counts if kpiRes fails.
  const rows = dataRes.data ?? []
  const productMap = new Map<string, { name: string | null; orderItems: number; shops: Set<string> }>()
  const shopMap = new Map<string, { name: string | null; orderItems: number; products: Set<string> }>()
  const productIds = new Set<string>()
  const shopCodes = new Set<string>()
  const statusCounts = new Map<string, number>()

  for (const r of rows) {
    if (r.product_id) {
      productIds.add(r.product_id)
      const ep = productMap.get(r.product_id)
      if (ep) {
        ep.orderItems++
        if (r.shop_code) ep.shops.add(r.shop_code)
      } else {
        const shops = new Set<string>()
        if (r.shop_code) shops.add(r.shop_code)
        productMap.set(r.product_id, { name: r.product_name ?? null, orderItems: 1, shops })
      }
    }
    if (r.shop_code) {
      shopCodes.add(r.shop_code)
      const es = shopMap.get(r.shop_code)
      if (es) {
        es.orderItems++
        if (r.product_id) es.products.add(r.product_id)
      } else {
        const products = new Set<string>()
        if (r.product_id) products.add(r.product_id)
        shopMap.set(r.shop_code, { name: r.shop_name ?? null, orderItems: 1, products })
      }
    }
    const bucket = mapStatusBucket(r.order_settlement_status ?? '')
    statusCounts.set(bucket, (statusCounts.get(bucket) ?? 0) + 1)
  }

  // Exact KPI distinct counts.
  type KpiAggRow = { unique_products: number; unique_shops: number; unique_content_ids: number }
  const kpiRow = (kpiRes.data as unknown as KpiAggRow[] | null)?.[0]
  const uniqueProducts = kpiRow?.unique_products ?? productIds.size
  const uniqueShops = kpiRow?.unique_shops ?? shopCodes.size
  const uniqueContentIds = kpiRow?.unique_content_ids ?? 0

  // Status breakdown — percentages within the 1000-row sample; sums to 100%.
  const sampleTotal = rows.length
  const statusBreakdown: StatusBucket[] = (['settled', 'pending', 'awaiting_payment', 'ineligible'] as const).map((key) => ({
    key,
    label: CONTENT_OPS_STATUS_LABELS[key],
    count: statusCounts.get(key) ?? 0,
    percent: sampleTotal > 0 ? Math.round(((statusCounts.get(key) ?? 0) / sampleTotal) * 1000) / 10 : 0,
  }))

  // Top products — from productMap (most-recent 1000-row sample), sorted by orderItems.
  // sharePercent is relative to totalOrderItems (exact COUNT(*)), not the sample size.
  const topProducts: TopProductRow[] = [...productMap.entries()]
    .sort((a, b) => b[1].orderItems - a[1].orderItems)
    .slice(0, 10)
    .map(([productId, d]) => ({
      productId,
      productName: d.name,
      orderItems: d.orderItems,
      shopCount: d.shops.size,
      sharePercent: totalOrderItems > 0 ? Math.round((d.orderItems / totalOrderItems) * 1000) / 10 : 0,
    }))

  // Top shops — same pattern.
  const topShops: TopShopRow[] = [...shopMap.entries()]
    .sort((a, b) => b[1].orderItems - a[1].orderItems)
    .slice(0, 10)
    .map(([shopCode, d]) => ({
      shopCode,
      shopName: d.name,
      orderItems: d.orderItems,
      productCount: d.products.size,
      sharePercent: totalOrderItems > 0 ? Math.round((d.orderItems / totalOrderItems) * 1000) / 10 : 0,
    }))

  return {
    data: {
      stats: {
        totalOrderItems,   // exact — COUNT(*)
        uniqueProducts,    // exact — COUNT(DISTINCT product_id)
        uniqueShops,       // exact — COUNT(DISTINCT shop_code)
        uniqueContentIds,  // exact — COUNT(DISTINCT content_id)
      },
      statusBreakdown,
      topProducts,   // sample-based — most-recent 1000 rows, sorted by orderItems
      topShops,      // sample-based — most-recent 1000 rows, sorted by orderItems
    },
    error: null,
  }
}

// ─── Content list ─────────────────────────────────────────────────────────────

export interface ContentSummaryRow {
  contentId: string
  totalOrders: number
  settledOrders: number
  productCount: number
  totalCommission: number | null  // sum of total_commission_amount from facts — always fresh
  firstOrderDate: string | null
  lastOrderDate: string | null
}

export async function getContentList(): Promise<{
  data: ContentSummaryRow[]
  total: number
  error: string | null
}> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: [], total: 0, error: 'Unauthenticated' }

  const { data, error } = await supabase
    .from('content_order_facts')
    .select('content_id,product_id,is_successful,total_commission_amount,order_date')
    .eq('created_by', user.id)
    .limit(200000)

  if (error) return { data: [], total: 0, error: error.message }

  const rows = data ?? []

  type ContentAgg = {
    totalOrders: number
    settledOrders: number
    products: Set<string>
    totalCommission: number
    hasCommission: boolean
    firstOrderDate: string | null
    lastOrderDate: string | null
  }

  const contentMap = new Map<string, ContentAgg>()

  for (const r of rows) {
    if (!r.content_id) continue
    const agg = contentMap.get(r.content_id) ?? {
      totalOrders: 0,
      settledOrders: 0,
      products: new Set<string>(),
      totalCommission: 0,
      hasCommission: false,
      firstOrderDate: null,
      lastOrderDate: null,
    }
    agg.totalOrders++
    if (r.is_successful) agg.settledOrders++
    if (r.product_id) agg.products.add(r.product_id)
    if (r.total_commission_amount !== null && r.total_commission_amount !== undefined) {
      agg.totalCommission += Number(r.total_commission_amount)
      agg.hasCommission = true
    }
    const d = r.order_date ? String(r.order_date).slice(0, 10) : null
    if (d) {
      if (!agg.firstOrderDate || d < agg.firstOrderDate) agg.firstOrderDate = d
      if (!agg.lastOrderDate || d > agg.lastOrderDate) agg.lastOrderDate = d
    }
    contentMap.set(r.content_id, agg)
  }

  const summary: ContentSummaryRow[] = [...contentMap.entries()]
    .map(([contentId, agg]) => ({
      contentId,
      totalOrders: agg.totalOrders,
      settledOrders: agg.settledOrders,
      productCount: agg.products.size,
      totalCommission: agg.hasCommission ? Math.round(agg.totalCommission * 100) / 100 : null,
      firstOrderDate: agg.firstOrderDate,
      lastOrderDate: agg.lastOrderDate,
    }))
    .sort((a, b) => b.totalOrders - a.totalOrders)

  return { data: summary, total: summary.length, error: null }
}

// ─── Content detail ────────────────────────────────────────────────────────────

export interface ContentDetailStats {
  contentId: string
  totalOrders: number
  settledOrders: number
  settledPercent: number
  productCount: number
  topProductName: string | null
}

export interface ContentProfitSummary {
  commissionRealized: number
  totalCost: number
  profit: number
  hasCostData: boolean
}

export interface ContentDetailProduct {
  productId: string
  productName: string | null
  orderCount: number
  href: string
}

export interface ContentDetail {
  stats: ContentDetailStats
  statusBreakdown: StatusBucket[]
  topProducts: ContentDetailProduct[]
  // null = profit refresh has not been run; rows present = at least one profit summary row exists
  profitSummary: ContentProfitSummary | null
  relatedOrders: RelatedOrderRow[]
}

export async function getContentDetail(
  contentId: string
): Promise<{ data: ContentDetail | null; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'Unauthenticated' }

  const [factsRes, profitRes] = await Promise.all([
    supabase
      .from('content_order_facts')
      .select('order_id,sku_id,product_id,product_name,shop_name,order_settlement_status,is_successful')
      .eq('created_by', user.id)
      .eq('content_id', contentId),
    supabase
      .from('content_profit_attribution_summary')
      .select('commission_realized,total_cost,profit')
      .eq('created_by', user.id)
      .eq('content_id', contentId),
  ])

  if (factsRes.error) return { data: null, error: factsRes.error.message }

  const rows = factsRes.data ?? []
  if (rows.length === 0) return { data: null, error: 'Content not found' }

  // Aggregate facts
  const productMap = new Map<string, { name: string | null; count: number }>()
  const statusCounts = new Map<string, number>()
  let settledOrders = 0

  for (const r of rows) {
    if (r.is_successful) settledOrders++
    const bucket = mapStatusBucket(r.order_settlement_status ?? '')
    statusCounts.set(bucket, (statusCounts.get(bucket) ?? 0) + 1)
    if (r.product_id) {
      const p = productMap.get(r.product_id) ?? { name: null, count: 0 }
      p.count++
      if (!p.name && r.product_name) p.name = r.product_name
      productMap.set(r.product_id, p)
    }
  }

  const total = rows.length
  const topProductEntry = [...productMap.entries()].sort((a, b) => b[1].count - a[1].count)[0]

  const stats: ContentDetailStats = {
    contentId,
    totalOrders: total,
    settledOrders,
    settledPercent: total > 0 ? Math.round((settledOrders / total) * 1000) / 10 : 0,
    productCount: productMap.size,
    topProductName: topProductEntry ? (topProductEntry[1].name ?? topProductEntry[0]) : null,
  }

  const statusBreakdown: StatusBucket[] = (['settled', 'pending', 'awaiting_payment', 'ineligible'] as const).map((key) => ({
    key,
    label: CONTENT_OPS_STATUS_LABELS[key],
    count: statusCounts.get(key) ?? 0,
    percent: total > 0 ? Math.round(((statusCounts.get(key) ?? 0) / total) * 1000) / 10 : 0,
  }))

  const topProducts: ContentDetailProduct[] = [...productMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([productId, v]) => ({
      productId,
      productName: v.name,
      orderCount: v.count,
      href: `/content-ops/products/${encodeURIComponent(productId)}`,
    }))

  // Aggregate profit summary across all (content_id, product_id) rows for this content
  const profitRows = profitRes.data ?? []
  let profitSummary: ContentProfitSummary | null = null
  if (profitRows.length > 0) {
    const commissionRealized = profitRows.reduce((s, r) => s + (Number(r.commission_realized) || 0), 0)
    const totalCost = profitRows.reduce((s, r) => s + (Number(r.total_cost) || 0), 0)
    const profit = profitRows.reduce((s, r) => s + (Number(r.profit) || 0), 0)
    profitSummary = {
      commissionRealized: Math.round(commissionRealized * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      hasCostData: totalCost > 0,
    }
  }

  const relatedOrders: RelatedOrderRow[] = rows.slice(0, 10).map((r) => ({
    orderId: r.order_id,
    skuId: r.sku_id ?? null,
    shopName: r.shop_name ?? null,
    status: r.order_settlement_status,
    contentId,
  }))

  return { data: { stats, statusBreakdown, topProducts, profitSummary, relatedOrders }, error: null }
}

// ─── Trend types ───────────────────────────────────────────────────────────────

export interface ProductTrendRow {
  productId: string
  productName: string | null
  orderItems: number       // current period
  prevOrderItems: number   // previous period
  changePercent: number | null  // null when prev = 0
  isNew: boolean           // true when prev = 0 and current > 0
  shopCount: number
  topShopName: string | null
  dailyCounts: number[]    // per-day counts, current period only, index 0 = oldest day
  imageUrl?: string | null
}

export interface ShopTrendRow {
  shopCode: string
  shopName: string | null
  orderItems: number
  prevOrderItems: number
  changePercent: number | null
  isNew: boolean
  productCount: number
  topProductName: string | null
  dailyCounts: number[]
}

// ─── Product trends (top 50 + full list) ──────────────────────────────────────

export interface ProductTableResult {
  productId: string
  productName: string | null
  shopCount: number
  orderItems: number
  topShopName: string | null
  imageUrl?: string | null
}

export interface ShopTableResult {
  shopCode: string
  shopName: string | null
  productCount: number
  orderItems: number
  topProductName: string | null
}

export async function getProductTrends(
  from: string,
  to: string,
  topN = 50
): Promise<{ top: ProductTrendRow[]; all: ProductTableResult[]; error: string | null }> {
  // Opt out of Next.js data cache — same reason as getOverviewDataFiltered.
  noStore()

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { top: [], all: [], error: 'Unauthenticated' }

  // Compute previous period (same duration, immediately before current)
  const currentDays = buildDayArray(from, to).length
  const prevTo = offsetDate(from, -1)
  const prevFrom = offsetDate(prevTo, -(currentDays - 1))

  // Fetch both periods in one query.
  // ORDER BY order_date DESC so the 1000-row PostgREST max-rows cap returns
  // the most-recent rows instead of oldest insertion-order rows.
  // (.limit(200000) was silently ignored — PostgREST hard cap = 1000 rows.)
  const { data, error: dbError } = await supabase
    .from('content_order_facts')
    .select('product_id,product_name,shop_code,shop_name,order_date')
    .eq('created_by', user.id)
    .gte('order_date', prevFrom)
    .lte('order_date', to)
    .order('order_date', { ascending: false })

  if (dbError) return { top: [], all: [], error: dbError.message }

  const rows = data ?? []
  const currentDaySet = new Set(buildDayArray(from, to))
  const currentDayArray = buildDayArray(from, to)

  type Agg = {
    name: string | null
    shops: Map<string, string | null>  // code → name
    products?: Map<string, string | null>
    currentItems: number
    prevItems: number
    dailyCounts: Map<string, number>
  }

  const productMap = new Map<string, Agg>()

  for (const r of rows) {
    if (!r.product_id) continue
    const day = (r.order_date ?? '').split('T')[0]
    const isCurrent = currentDaySet.has(day)

    const p = productMap.get(r.product_id) ?? {
      name: null,
      shops: new Map(),
      currentItems: 0,
      prevItems: 0,
      dailyCounts: new Map(),
    }

    if (!p.name && r.product_name) p.name = r.product_name
    if (r.shop_code) p.shops.set(r.shop_code, r.shop_name ?? null)

    if (isCurrent) {
      p.currentItems++
      p.dailyCounts.set(day, (p.dailyCounts.get(day) ?? 0) + 1)
    } else {
      p.prevItems++
    }
    productMap.set(r.product_id, p)
  }

  // Also need all-time items for the full list (pass current period)
  // (full list already filtered by date via the same query above — just use currentItems)

  function computeChange(cur: number, prev: number): { changePercent: number | null; isNew: boolean } {
    if (prev === 0 && cur > 0) return { changePercent: null, isNew: true }
    if (prev === 0) return { changePercent: null, isNew: false }
    return { changePercent: Math.round(((cur - prev) / prev) * 1000) / 10, isNew: false }
  }

  const allProducts: ProductTrendRow[] = [...productMap.entries()]
    .map(([productId, v]) => {
      const topShop = [...v.shops.entries()][0]
      const { changePercent, isNew } = computeChange(v.currentItems, v.prevItems)
      const dailyCounts = currentDayArray.map((d) => v.dailyCounts.get(d) ?? 0)
      return {
        productId,
        productName: v.name,
        orderItems: v.currentItems,
        prevOrderItems: v.prevItems,
        changePercent,
        isNew,
        shopCount: v.shops.size,
        topShopName: topShop ? (topShop[1] ?? topShop[0]) : null,
        dailyCounts,
      }
    })
    .sort((a, b) => b.orderItems - a.orderItems)

  const top = allProducts.slice(0, topN)

  // Enrich all products with product_image_url from tt_product_master
  if (allProducts.length > 0) {
    const { data: masterRows } = await supabase
      .from('tt_product_master')
      .select('product_id,product_image_url')
      .eq('created_by', user.id)
      .in('product_id', allProducts.map((p) => p.productId))
    const imageMap = new Map(
      (masterRows ?? []).map((r) => [r.product_id, r.product_image_url as string | null])
    )
    for (const p of allProducts) {
      p.imageUrl = imageMap.get(p.productId) ?? null
    }
  }

  // Full list for the client table
  const all: ProductTableResult[] = allProducts.map((p) => ({
    productId: p.productId,
    productName: p.productName,
    shopCount: p.shopCount,
    orderItems: p.orderItems,
    topShopName: p.topShopName,
    imageUrl: p.imageUrl,
  }))

  return { top, all, error: null }
}

// ─── Shop trends (top 50 + full list) ─────────────────────────────────────────

export async function getShopTrends(
  from: string,
  to: string,
  topN = 50
): Promise<{ top: ShopTrendRow[]; all: ShopTableResult[]; error: string | null }> {
  // Opt out of Next.js data cache — same reason as getOverviewDataFiltered.
  noStore()

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { top: [], all: [], error: 'Unauthenticated' }

  const currentDays = buildDayArray(from, to).length
  const prevTo = offsetDate(from, -1)
  const prevFrom = offsetDate(prevTo, -(currentDays - 1))

  // ORDER BY order_date DESC so the 1000-row PostgREST max-rows cap returns
  // the most-recent rows instead of oldest insertion-order rows.
  const { data, error: dbError } = await supabase
    .from('content_order_facts')
    .select('shop_code,shop_name,product_id,product_name,order_date')
    .eq('created_by', user.id)
    .gte('order_date', prevFrom)
    .lte('order_date', to)
    .order('order_date', { ascending: false })

  if (dbError) return { top: [], all: [], error: dbError.message }

  const rows = data ?? []
  const currentDaySet = new Set(buildDayArray(from, to))
  const currentDayArray = buildDayArray(from, to)

  type ShopAgg = {
    name: string | null
    products: Map<string, string | null>
    currentItems: number
    prevItems: number
    dailyCounts: Map<string, number>
  }

  const shopMap = new Map<string, ShopAgg>()

  for (const r of rows) {
    if (!r.shop_code) continue
    const day = (r.order_date ?? '').split('T')[0]
    const isCurrent = currentDaySet.has(day)

    const s = shopMap.get(r.shop_code) ?? {
      name: null,
      products: new Map(),
      currentItems: 0,
      prevItems: 0,
      dailyCounts: new Map(),
    }

    if (!s.name && r.shop_name) s.name = r.shop_name
    if (r.product_id) s.products.set(r.product_id, r.product_name ?? null)

    if (isCurrent) {
      s.currentItems++
      s.dailyCounts.set(day, (s.dailyCounts.get(day) ?? 0) + 1)
    } else {
      s.prevItems++
    }
    shopMap.set(r.shop_code, s)
  }

  function computeChange(cur: number, prev: number): { changePercent: number | null; isNew: boolean } {
    if (prev === 0 && cur > 0) return { changePercent: null, isNew: true }
    if (prev === 0) return { changePercent: null, isNew: false }
    return { changePercent: Math.round(((cur - prev) / prev) * 1000) / 10, isNew: false }
  }

  const allShops: ShopTrendRow[] = [...shopMap.entries()]
    .map(([shopCode, v]) => {
      const topProduct = [...v.products.entries()][0]
      const { changePercent, isNew } = computeChange(v.currentItems, v.prevItems)
      const dailyCounts = currentDayArray.map((d) => v.dailyCounts.get(d) ?? 0)
      return {
        shopCode,
        shopName: v.name,
        orderItems: v.currentItems,
        prevOrderItems: v.prevItems,
        changePercent,
        isNew,
        productCount: v.products.size,
        topProductName: topProduct ? (topProduct[1] ?? topProduct[0]) : null,
        dailyCounts,
      }
    })
    .sort((a, b) => b.orderItems - a.orderItems)

  const top = allShops.slice(0, topN)

  const all: ShopTableResult[] = allShops.map((s) => ({
    shopCode: s.shopCode,
    shopName: s.shopName,
    productCount: s.productCount,
    orderItems: s.orderItems,
    topProductName: s.topProductName,
  }))

  return { top, all, error: null }
}
