'use server'

import { createClient } from '@/lib/supabase/server'
import { getBangkokToday, offsetDate, buildDayArray } from './date-utils'

// ─── Status mapping ────────────────────────────────────────────────────────────

function mapStatusBucket(status: string): 'settled' | 'pending' | 'awaiting_payment' | 'ineligible' | 'other' {
  const s = (status ?? '').toLowerCase().replace(/\s+/g, '_')
  if (s === 'settled' || s === 'completed') return 'settled'
  if (s === 'pending') return 'pending'
  if (s === 'awaiting_payment' || s.includes('awaiting')) return 'awaiting_payment'
  if (s === 'ineligible' || s === 'cancelled') return 'ineligible'
  return 'other'
}

const STATUS_BUCKET_LABELS: Record<string, string> = {
  settled: 'Settled',
  pending: 'Pending',
  awaiting_payment: 'Awaiting Payment',
  ineligible: 'Ineligible',
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
      .eq('created_by', user.id),
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
    label: STATUS_BUCKET_LABELS[key],
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

// ─── Product list ──────────────────────────────────────────────────────────────

export interface ProductListRow {
  productId: string
  productName: string | null
  shopCount: number
  orderItems: number
  topShopName: string | null
  topContentId: string | null
}

export interface ProductListResult {
  rows: ProductListRow[]
  total: number
}

export async function getProductList(
  filters: { search?: string; shopCode?: string; sort?: string } = {},
  limit = 50,
  offset = 0
): Promise<{ data: ProductListResult | null; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'Unauthenticated' }

  const { data, error } = await supabase
    .from('content_order_facts')
    .select('product_id,product_name,shop_code,shop_name,content_id')
    .eq('created_by', user.id)

  if (error) return { data: null, error: error.message }

  const rows = data ?? []

  // Aggregate per product
  type ProductAgg = {
    productName: string | null
    shops: Map<string, { name: string | null; count: number }>
    contents: Map<string, number>
    orderItems: number
  }

  const productMap = new Map<string, ProductAgg>()

  for (const r of rows) {
    if (!r.product_id) continue
    const p = productMap.get(r.product_id) ?? {
      productName: null,
      shops: new Map(),
      contents: new Map(),
      orderItems: 0,
    }
    p.orderItems++
    if (!p.productName && r.product_name) p.productName = r.product_name
    if (r.shop_code) {
      const s = p.shops.get(r.shop_code) ?? { name: r.shop_name ?? null, count: 0 }
      s.count++
      if (!s.name && r.shop_name) s.name = r.shop_name
      p.shops.set(r.shop_code, s)
    }
    if (r.content_id) {
      p.contents.set(r.content_id, (p.contents.get(r.content_id) ?? 0) + 1)
    }
    productMap.set(r.product_id, p)
  }

  let products: ProductListRow[] = [...productMap.entries()].map(([productId, v]) => {
    const topShop = [...v.shops.entries()].sort((a, b) => b[1].count - a[1].count)[0]
    const topContent = [...v.contents.entries()].sort((a, b) => b[1] - a[1])[0]
    return {
      productId,
      productName: v.productName,
      shopCount: v.shops.size,
      orderItems: v.orderItems,
      topShopName: topShop ? (topShop[1].name ?? topShop[0]) : null,
      topContentId: topContent ? topContent[0] : null,
    }
  })

  // Apply filters
  if (filters.search) {
    const q = filters.search.toLowerCase()
    products = products.filter(
      (p) =>
        p.productId.toLowerCase().includes(q) ||
        (p.productName ?? '').toLowerCase().includes(q)
    )
  }
  if (filters.shopCode) {
    // Re-filter based on original rows
    const matchingProducts = new Set<string>()
    for (const r of rows) {
      if (r.shop_code === filters.shopCode && r.product_id) matchingProducts.add(r.product_id)
    }
    products = products.filter((p) => matchingProducts.has(p.productId))
  }

  // Sort
  if (filters.sort === 'name') {
    products.sort((a, b) => (a.productName ?? a.productId).localeCompare(b.productName ?? b.productId))
  } else if (filters.sort === 'shops') {
    products.sort((a, b) => b.shopCount - a.shopCount)
  } else {
    // Default: by order items desc
    products.sort((a, b) => b.orderItems - a.orderItems)
  }

  const total = products.length
  return { data: { rows: products.slice(offset, offset + limit), total }, error: null }
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

  const { data, error } = await supabase
    .from('content_order_facts')
    .select('order_id,sku_id,product_name,shop_code,shop_name,content_id,order_settlement_status,is_successful')
    .eq('created_by', user.id)
    .eq('product_id', productId)

  if (error) return { data: null, error: error.message }

  const rows = data ?? []
  if (rows.length === 0) return { data: null, error: 'Product not found' }

  const shopMap = new Map<string, { name: string | null; count: number }>()
  const contentMap = new Map<string, number>()
  const statusCounts = new Map<string, number>()
  let settledCount = 0
  let productName: string | null = null

  for (const r of rows) {
    if (!productName && r.product_name) productName = r.product_name
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
    label: STATUS_BUCKET_LABELS[key],
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

// ─── Shop list ─────────────────────────────────────────────────────────────────

export interface ShopListRow {
  shopCode: string
  shopName: string | null
  productCount: number
  orderItems: number
  topProductName: string | null
  topContentId: string | null
}

export interface ShopListResult {
  rows: ShopListRow[]
  total: number
}

export async function getShopList(
  filters: { search?: string; sort?: string } = {},
  limit = 50,
  offset = 0
): Promise<{ data: ShopListResult | null; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'Unauthenticated' }

  const { data, error } = await supabase
    .from('content_order_facts')
    .select('shop_code,shop_name,product_id,product_name,content_id')
    .eq('created_by', user.id)

  if (error) return { data: null, error: error.message }

  const rows = data ?? []

  type ShopAgg = {
    shopName: string | null
    products: Map<string, { name: string | null; count: number }>
    contents: Map<string, number>
    orderItems: number
  }

  const shopMap = new Map<string, ShopAgg>()

  for (const r of rows) {
    if (!r.shop_code) continue
    const s = shopMap.get(r.shop_code) ?? { shopName: null, products: new Map(), contents: new Map(), orderItems: 0 }
    s.orderItems++
    if (!s.shopName && r.shop_name) s.shopName = r.shop_name
    if (r.product_id) {
      const p = s.products.get(r.product_id) ?? { name: r.product_name ?? null, count: 0 }
      p.count++
      if (!p.name && r.product_name) p.name = r.product_name
      s.products.set(r.product_id, p)
    }
    if (r.content_id) {
      s.contents.set(r.content_id, (s.contents.get(r.content_id) ?? 0) + 1)
    }
    shopMap.set(r.shop_code, s)
  }

  let shops: ShopListRow[] = [...shopMap.entries()].map(([shopCode, v]) => {
    const topProduct = [...v.products.entries()].sort((a, b) => b[1].count - a[1].count)[0]
    const topContent = [...v.contents.entries()].sort((a, b) => b[1] - a[1])[0]
    return {
      shopCode,
      shopName: v.shopName,
      productCount: v.products.size,
      orderItems: v.orderItems,
      topProductName: topProduct ? (topProduct[1].name ?? topProduct[0]) : null,
      topContentId: topContent ? topContent[0] : null,
    }
  })

  if (filters.search) {
    const q = filters.search.toLowerCase()
    shops = shops.filter(
      (s) =>
        s.shopCode.toLowerCase().includes(q) ||
        (s.shopName ?? '').toLowerCase().includes(q)
    )
  }

  if (filters.sort === 'name') {
    shops.sort((a, b) => (a.shopName ?? a.shopCode).localeCompare(b.shopName ?? b.shopCode))
  } else if (filters.sort === 'products') {
    shops.sort((a, b) => b.productCount - a.productCount)
  } else {
    shops.sort((a, b) => b.orderItems - a.orderItems)
  }

  const total = shops.length
  return { data: { rows: shops.slice(offset, offset + limit), total }, error: null }
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

  const { data, error } = await supabase
    .from('content_order_facts')
    .select('order_id,sku_id,product_id,product_name,shop_name,content_id,order_settlement_status,is_successful')
    .eq('created_by', user.id)
    .eq('shop_code', shopCode)

  if (error) return { data: null, error: error.message }

  const rows = data ?? []
  if (rows.length === 0) return { data: null, error: 'Shop not found' }

  const productMap = new Map<string, { name: string | null; count: number }>()
  const contentMap = new Map<string, number>()
  const statusCounts = new Map<string, number>()
  let settledCount = 0
  let shopName: string | null = null

  for (const r of rows) {
    if (!shopName && r.shop_name) shopName = r.shop_name
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
    label: STATUS_BUCKET_LABELS[key],
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
    shopName: shopName,
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
  if (filters.status) q = q.eq('order_settlement_status', filters.status)
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
): Promise<{ data: AttributionFullRow[]; summary: AttributionSummary; total: number; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: [], summary: { mappedRows: 0, uniqueContentIds: 0, uniqueProducts: 0 }, total: 0, error: 'Unauthenticated' }

  let q = supabase
    .from('content_order_attribution')
    .select('order_id,product_id,product_name,content_id,currency,order_date,normalized_status,business_bucket,is_realized,source_fact_count', { count: 'exact' })
    .eq('created_by', user.id)

  if (filters.contentId) q = q.eq('content_id', filters.contentId)
  if (filters.bucket) q = q.eq('business_bucket', filters.bucket)

  const { data, count, error } = await q
    .order('order_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return { data: [], summary: { mappedRows: 0, uniqueContentIds: 0, uniqueProducts: 0 }, total: 0, error: error.message }

  // Compute summary from current page — for full summary, we'd need all rows
  // Use a separate count query for unique content IDs and products
  const [contentCountRes, productCountRes] = await Promise.all([
    supabase.from('content_order_attribution').select('content_id').eq('created_by', user.id),
    supabase.from('content_order_attribution').select('product_id').eq('created_by', user.id),
  ])

  const uniqueContentIds = new Set((contentCountRes.data ?? []).map((r) => r.content_id)).size
  const uniqueProducts = new Set((productCountRes.data ?? []).map((r) => r.product_id)).size

  const rows: AttributionFullRow[] = (data ?? []).map((r) => ({
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

  return {
    data: rows,
    summary: { mappedRows: count ?? 0, uniqueContentIds, uniqueProducts },
    total: count ?? 0,
    error: null,
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
  value: number
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

  const [factsRes, batchesRes, attributionRes, costsRes, profitRes] = await Promise.all([
    supabase.from('content_order_facts').select('id,product_id,shop_code,content_id', { count: 'exact' }).eq('created_by', user.id),
    supabase.from('tiktok_affiliate_import_batches').select('id', { count: 'exact', head: true }).eq('created_by', user.id),
    supabase.from('content_order_attribution').select('order_id', { count: 'exact', head: true }).eq('created_by', user.id),
    supabase.from('tt_content_costs').select('id', { count: 'exact', head: true }).eq('created_by', user.id),
    supabase.from('content_profit_attribution_summary').select('content_id', { count: 'exact', head: true }).eq('created_by', user.id),
  ])

  const factRows = factsRes.data ?? []
  const factsCount = factsRes.count ?? 0
  const batchCount = batchesRes.count ?? 0
  const attributionCount = attributionRes.count ?? 0
  const costsCount = costsRes.count ?? 0
  const profitCount = profitRes.count ?? 0

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
      status: attributionCount > 0 ? 'ok' : (factsCount > 0 ? 'warning' : 'error'),
      detail: attributionCount > 0 ? `${attributionCount.toLocaleString()} attribution rows` : 'Attribution not available',
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
    { label: 'Attribution coverage', value: factsCount > 0 ? Math.round((attributionCount / factsCount) * 100) : 0, suffix: '%' },
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
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'Unauthenticated' }

  const { data, error: dbError } = await supabase
    .from('content_order_facts')
    .select('product_id,product_name,shop_code,shop_name,content_id,order_settlement_status')
    .eq('created_by', user.id)
    .gte('order_date', from)
    .lte('order_date', to)

  if (dbError) return { data: null, error: dbError.message }

  const rows = data ?? []
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
    label: STATUS_BUCKET_LABELS[key],
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

  return {
    data: {
      stats: {
        totalOrderItems: total,
        uniqueProducts: productIds.size,
        uniqueShops: shopCodes.size,
        uniqueContentIds: contentIds.size,
      },
      statusBreakdown,
      topProducts,
      topShops,
    },
    error: null,
  }
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
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { top: [], all: [], error: 'Unauthenticated' }

  // Compute previous period (same duration, immediately before current)
  const currentDays = buildDayArray(from, to).length
  const prevTo = offsetDate(from, -1)
  const prevFrom = offsetDate(prevTo, -(currentDays - 1))

  // Fetch both periods in one query
  const { data, error: dbError } = await supabase
    .from('content_order_facts')
    .select('product_id,product_name,shop_code,shop_name,order_date')
    .eq('created_by', user.id)
    .gte('order_date', prevFrom)
    .lte('order_date', to)

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

  // Full list for the client table
  const all: ProductTableResult[] = allProducts.map((p) => ({
    productId: p.productId,
    productName: p.productName,
    shopCount: p.shopCount,
    orderItems: p.orderItems,
    topShopName: p.topShopName,
  }))

  return { top, all, error: null }
}

// ─── Shop trends (top 50 + full list) ─────────────────────────────────────────

export async function getShopTrends(
  from: string,
  to: string,
  topN = 50
): Promise<{ top: ShopTrendRow[]; all: ShopTableResult[]; error: string | null }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { top: [], all: [], error: 'Unauthenticated' }

  const currentDays = buildDayArray(from, to).length
  const prevTo = offsetDate(from, -1)
  const prevFrom = offsetDate(prevTo, -(currentDays - 1))

  const { data, error: dbError } = await supabase
    .from('content_order_facts')
    .select('shop_code,shop_name,product_id,product_name,order_date')
    .eq('created_by', user.id)
    .gte('order_date', prevFrom)
    .lte('order_date', to)

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
