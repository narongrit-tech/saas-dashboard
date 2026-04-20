/**
 * master-refresh.ts
 *
 * Rebuilds tt_product_master, tt_shop_master, and product_overview_cache
 * by scanning all content_order_facts for a given user.
 *
 * Uses supabase-js (service role) + keyset cursor pagination to avoid
 * PostgREST 1000-row default cap.
 *
 * Called by: /api/content-ops/refresh-master (POST)
 */

import { createServiceClient } from '@/lib/supabase/service'

const PAGE_SIZE = 1000
const UPSERT_CHUNK = 50
const LOCK_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

export interface MasterRefreshResult {
  skipped: boolean
  factsRead: number
  productsUpserted: number
  shopsUpserted: number
  cacheUpdated: number
  error?: string
}

// ─── Internal accumulators ─────────────────────────────────────────────────────

interface ProductAcc {
  product_id: string
  product_name: string | null
  shop_code: string | null
  shop_name: string | null
  total_order_items: number
  settled_order_items: number
  cancel_count: number
  total_gmv: number
  total_commission: number
  currency: string | null
  first_seen_at: string | null
  last_seen_at: string | null
  _latest_order_date: string | null
  // per-product aggregates for cache
  contentMap: Map<string, { orders: number; gmv: number }>
  shopMap: Map<string, { shopName: string | null; orders: number; gmv: number }>
}

interface ShopAcc {
  shop_code: string
  shop_name: string | null
  products: Set<string>
  total_order_items: number
  settled_order_items: number
  total_gmv: number
  total_commission: number
  currency: string | null
  first_seen_at: string | null
  last_seen_at: string | null
  _latest_order_date: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function updateDate(existing: string | null, candidate: string | null, mode: 'min' | 'max'): string | null {
  if (!candidate) return existing
  if (!existing) return candidate
  return mode === 'min' ? (candidate < existing ? candidate : existing) : (candidate > existing ? candidate : existing)
}

async function upsertChunked<T extends object>(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  rows: T[],
  onConflict: string
): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK)
    const { error } = await supabase
      .from(table)
      .upsert(chunk, { onConflict })
    if (error) throw new Error(`upsert ${table}: ${error.message}`)
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function masterRefresh(createdBy: string): Promise<MasterRefreshResult> {
  const supabase = createServiceClient()
  let logId: string | null = null

  // ── Concurrency lock ────────────────────────────────────────────────────────
  // Gracefully skip if tt_master_refresh_log doesn't exist yet (migration not run)
  try {
    const cutoff = new Date(Date.now() - LOCK_WINDOW_MS).toISOString()
    const { data: running } = await supabase
      .from('tt_master_refresh_log')
      .select('id,started_at')
      .eq('created_by', createdBy)
      .eq('status', 'running')
      .gte('started_at', cutoff)
      .limit(1)
      .maybeSingle()

    if (running) {
      return { skipped: true, factsRead: 0, productsUpserted: 0, shopsUpserted: 0, cacheUpdated: 0 }
    }

    // Insert running log entry
    const { data: log, error: logErr } = await supabase
      .from('tt_master_refresh_log')
      .insert({ created_by: createdBy, status: 'running' })
      .select('id')
      .single()

    if (!logErr && log) logId = log.id as string
  } catch {
    // Log table missing — proceed without lock
  }

  // ── Read all facts (keyset cursor) ──────────────────────────────────────────
  const productMap = new Map<string, ProductAcc>()
  const shopMap = new Map<string, ShopAcc>()
  let cursor: string | null = null
  let totalRows = 0

  try {
    while (true) {
      let query = supabase
        .from('content_order_facts')
        .select('id,product_id,product_name,shop_code,shop_name,content_id,order_date,is_successful,is_cancelled,gmv,total_earned_amount,currency')
        .eq('created_by', createdBy)
        .neq('product_id', 'PROD-001')
        .neq('shop_code', 'SHOP-001')
        .order('id', { ascending: true })
        .limit(PAGE_SIZE)

      if (cursor) query = query.gt('id', cursor)

      const { data: rows, error } = await query
      if (error) throw new Error(`facts query: ${error.message}`)
      if (!rows || rows.length === 0) break

      cursor = rows[rows.length - 1].id as string
      totalRows += rows.length

      for (const r of rows) {
        const pid = r.product_id as string | null
        const sc = r.shop_code as string | null
        const cid = r.content_id as string | null
        const od = r.order_date as string | null
        const gmv = Number(r.gmv) || 0
        const earned = Number(r.total_earned_amount) || 0
        const settled = r.is_successful === true
        const cancelled = r.is_cancelled === true

        // ── Product accumulator ──
        if (pid) {
          let p = productMap.get(pid)
          if (!p) {
            p = {
              product_id: pid,
              product_name: r.product_name as string | null,
              shop_code: sc,
              shop_name: r.shop_name as string | null,
              total_order_items: 0,
              settled_order_items: 0,
              cancel_count: 0,
              total_gmv: 0,
              total_commission: 0,
              currency: r.currency as string | null,
              first_seen_at: od,
              last_seen_at: od,
              _latest_order_date: od,
              contentMap: new Map(),
              shopMap: new Map(),
            }
            productMap.set(pid, p)
          }
          p.total_order_items += 1
          if (settled) p.settled_order_items += 1
          if (cancelled) p.cancel_count += 1
          p.total_gmv += gmv
          p.total_commission += earned
          p.first_seen_at = updateDate(p.first_seen_at, od, 'min')
          p.last_seen_at = updateDate(p.last_seen_at, od, 'max')
          if (!p.currency && r.currency) p.currency = r.currency as string
          if (od && (!p._latest_order_date || od > p._latest_order_date)) {
            p._latest_order_date = od
            if (r.product_name) p.product_name = r.product_name as string
            if (r.shop_code) p.shop_code = r.shop_code as string
            if (r.shop_name) p.shop_name = r.shop_name as string
          } else {
            if (!p.product_name && r.product_name) p.product_name = r.product_name as string
            if (!p.shop_code && r.shop_code) p.shop_code = r.shop_code as string
            if (!p.shop_name && r.shop_name) p.shop_name = r.shop_name as string
          }

          // per-product content + shop maps (for cache)
          if (cid) {
            const cv = p.contentMap.get(cid) ?? { orders: 0, gmv: 0 }
            cv.orders += 1
            cv.gmv += gmv
            p.contentMap.set(cid, cv)
          }
          if (sc) {
            const sv = p.shopMap.get(sc) ?? { shopName: r.shop_name as string | null, orders: 0, gmv: 0 }
            sv.orders += 1
            sv.gmv += gmv
            if (!sv.shopName && r.shop_name) sv.shopName = r.shop_name as string
            p.shopMap.set(sc, sv)
          }
        }

        // ── Shop accumulator ──
        if (sc) {
          let s = shopMap.get(sc)
          if (!s) {
            s = {
              shop_code: sc,
              shop_name: r.shop_name as string | null,
              products: new Set(),
              total_order_items: 0,
              settled_order_items: 0,
              total_gmv: 0,
              total_commission: 0,
              currency: r.currency as string | null,
              first_seen_at: od,
              last_seen_at: od,
              _latest_order_date: od,
            }
            shopMap.set(sc, s)
          }
          if (pid) s.products.add(pid)
          s.total_order_items += 1
          if (settled) s.settled_order_items += 1
          s.total_gmv += gmv
          s.total_commission += earned
          s.first_seen_at = updateDate(s.first_seen_at, od, 'min')
          s.last_seen_at = updateDate(s.last_seen_at, od, 'max')
          if (!s.currency && r.currency) s.currency = r.currency as string
          if (od && (!s._latest_order_date || od > s._latest_order_date)) {
            s._latest_order_date = od
            if (r.shop_name) s.shop_name = r.shop_name as string
          } else {
            if (!s.shop_name && r.shop_name) s.shop_name = r.shop_name as string
          }
        }
      }

      if (rows.length < PAGE_SIZE) break
    }

    // ── Upsert product master ───────────────────────────────────────────────
    const products = [...productMap.values()].map((p) => ({
      created_by: createdBy,
      product_id: p.product_id,
      product_name: p.product_name,
      shop_code: p.shop_code,
      shop_name: p.shop_name,
      first_seen_at: p.first_seen_at,
      last_seen_at: p.last_seen_at,
      total_order_items: p.total_order_items,
      settled_order_items: p.settled_order_items,
      total_gmv: parseFloat(p.total_gmv.toFixed(2)),
      total_commission: parseFloat(p.total_commission.toFixed(2)),
      currency: p.currency,
    }))

    await upsertChunked(supabase, 'tt_product_master', products, 'created_by,product_id')

    // ── Upsert shop master ──────────────────────────────────────────────────
    const shops = [...shopMap.values()].map((s) => ({
      created_by: createdBy,
      shop_code: s.shop_code,
      shop_name: s.shop_name,
      first_seen_at: s.first_seen_at,
      last_seen_at: s.last_seen_at,
      total_products: s.products.size,
      total_order_items: s.total_order_items,
      settled_order_items: s.settled_order_items,
      total_gmv: parseFloat(s.total_gmv.toFixed(2)),
      total_commission: parseFloat(s.total_commission.toFixed(2)),
      currency: s.currency,
    }))

    await upsertChunked(supabase, 'tt_shop_master', shops, 'created_by,shop_code')

    // ── Build product_overview_cache ────────────────────────────────────────
    let cacheUpdated = 0
    try {
      const cacheRows = [...productMap.values()].map((p) => {
        const total = p.total_order_items
        const topContent = [...p.contentMap.entries()]
          .sort((a, b) => b[1].orders - a[1].orders)
          .slice(0, 20)
          .map(([contentId, v]) => ({ contentId, orders: v.orders, gmv: parseFloat(v.gmv.toFixed(2)) }))
        const topShops = [...p.shopMap.entries()]
          .sort((a, b) => b[1].orders - a[1].orders)
          .slice(0, 10)
          .map(([shopCode, v]) => ({ shopCode, shopName: v.shopName, orders: v.orders, gmv: parseFloat(v.gmv.toFixed(2)) }))
        const cancelRate = total > 0 ? parseFloat(((p.cancel_count / total) * 100).toFixed(2)) : 0
        const settledPercent = total > 0 ? parseFloat(((p.settled_order_items / total) * 100).toFixed(2)) : 0
        return {
          created_by: createdBy,
          product_id: p.product_id,
          total_order_items: total,
          total_gmv: parseFloat(p.total_gmv.toFixed(2)),
          total_commission: parseFloat(p.total_commission.toFixed(2)),
          cancel_count: p.cancel_count,
          cancel_rate: cancelRate,
          settled_count: p.settled_order_items,
          settled_percent: settledPercent,
          top_content_json: topContent,
          top_shops_json: topShops,
          updated_at: new Date().toISOString(),
        }
      })

      await upsertChunked(supabase, 'product_overview_cache', cacheRows, 'created_by,product_id')
      cacheUpdated = cacheRows.length
    } catch {
      // product_overview_cache table may not exist yet — non-fatal
    }

    // ── Update log ──────────────────────────────────────────────────────────
    if (logId) {
      await supabase
        .from('tt_master_refresh_log')
        .update({
          status: 'done',
          finished_at: new Date().toISOString(),
          facts_read: totalRows,
          products_upserted: products.length,
          shops_upserted: shops.length,
          cache_updated: cacheUpdated,
        })
        .eq('id', logId)
    }

    return {
      skipped: false,
      factsRead: totalRows,
      productsUpserted: products.length,
      shopsUpserted: shops.length,
      cacheUpdated,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    if (logId) {
      await supabase
        .from('tt_master_refresh_log')
        .update({
          status: 'error',
          finished_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq('id', logId)
    }

    return {
      skipped: false,
      factsRead: totalRows,
      productsUpserted: 0,
      shopsUpserted: 0,
      cacheUpdated: 0,
      error: errorMessage,
    }
  }
}
