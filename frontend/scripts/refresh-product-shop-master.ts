/**
 * refresh-product-shop-master.ts
 *
 * JS replacement for refresh_tt_product_shop_master() RPC.
 * The PL/pgSQL version times out due to correlated subqueries (281 products × 3 subqueries each).
 * This script reads all facts in pages, aggregates in-memory, then upserts in batches.
 *
 * Usage:
 *   cd frontend
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/refresh-product-shop-master.ts [--dry-run]
 */

const CREATED_BY = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
const PAGE_SIZE = 1000
const UPSERT_CHUNK = 50

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const isDryRun = process.argv.includes('--dry-run')

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
}

async function get(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers })
  const j = await r.json()
  if (!Array.isArray(j)) throw new Error(`GET ${path} → ${JSON.stringify(j)}`)
  return j as Record<string, unknown>[]
}

async function upsert(table: string, rows: object[], onConflict: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    headers: { ...headers, Prefer: `resolution=merge-duplicates,return=minimal` },
    body: JSON.stringify(rows),
  })
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`UPSERT ${table} → ${r.status} ${body}`)
  }
}

interface ProductRow {
  product_id: string
  product_name: string | null
  shop_code: string | null
  shop_name: string | null
  total_order_items: number
  settled_order_items: number
  total_gmv: number
  total_commission: number
  currency: string | null
  first_seen_at: string | null
  last_seen_at: string | null
  // track latest order_date for name resolution
  _latest_order_date: string | null
}

interface ShopRow {
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

async function main() {
  console.log(`[refresh-product-shop-master] Starting${isDryRun ? ' (DRY RUN)' : ''} …`)

  const productMap = new Map<string, ProductRow>()
  const shopMap = new Map<string, ShopRow>()

  let cursor = ''   // keyset cursor — last seen id
  let totalRows = 0

  // ── READ ALL FACTS ────────────────────────────────────────────────────────

  while (true) {
    const cursorFilter = cursor ? `&id=gt.${cursor}` : ''
    const rows = await get(
      `content_order_facts` +
        `?select=id,product_id,product_name,shop_code,shop_name,order_date,` +
        `is_successful,gmv,total_earned_amount,currency` +
        `&created_by=eq.${CREATED_BY}` +
        `&product_id=not.eq.PROD-001` +
        `&shop_code=not.eq.SHOP-001` +
        `&order=id.asc` +
        `&limit=${PAGE_SIZE}` +
        cursorFilter
    )

    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id as string
    totalRows += rows.length
    process.stdout.write(`\r  Reading facts: ${totalRows} rows …`)

    for (const r of rows) {
      const pid = r.product_id as string
      const sc = r.shop_code as string | null
      const od = r.order_date as string | null
      const gmv = Number(r.gmv) || 0
      const earned = Number(r.total_earned_amount) || 0
      const settled = r.is_successful === true

      // ── PRODUCT MAP ──
      if (pid) {
        const existing = productMap.get(pid)
        if (!existing) {
          productMap.set(pid, {
            product_id: pid,
            product_name: r.product_name as string | null,
            shop_code: sc,
            shop_name: r.shop_name as string | null,
            total_order_items: 1,
            settled_order_items: settled ? 1 : 0,
            total_gmv: gmv,
            total_commission: earned,
            currency: r.currency as string | null,
            first_seen_at: od,
            last_seen_at: od,
            _latest_order_date: od,
          })
        } else {
          existing.total_order_items += 1
          if (settled) existing.settled_order_items += 1
          existing.total_gmv += gmv
          existing.total_commission += earned
          if (od) {
            if (!existing.first_seen_at || od < existing.first_seen_at) existing.first_seen_at = od
            if (!existing.last_seen_at || od > existing.last_seen_at) existing.last_seen_at = od
            // Use most recent row to resolve product_name / shop_code / shop_name
            if (!existing._latest_order_date || od > existing._latest_order_date) {
              existing._latest_order_date = od
              if (r.product_name) existing.product_name = r.product_name as string
              if (r.shop_code) existing.shop_code = r.shop_code as string
              if (r.shop_name) existing.shop_name = r.shop_name as string
            }
          }
          if (!existing.product_name && r.product_name) existing.product_name = r.product_name as string
          if (!existing.shop_code && r.shop_code) existing.shop_code = r.shop_code as string
          if (!existing.shop_name && r.shop_name) existing.shop_name = r.shop_name as string
          if (!existing.currency && r.currency) existing.currency = r.currency as string
        }
      }

      // ── SHOP MAP ──
      if (sc) {
        const existing = shopMap.get(sc)
        if (!existing) {
          shopMap.set(sc, {
            shop_code: sc,
            shop_name: r.shop_name as string | null,
            products: new Set(pid ? [pid] : []),
            total_order_items: 1,
            settled_order_items: settled ? 1 : 0,
            total_gmv: gmv,
            total_commission: earned,
            currency: r.currency as string | null,
            first_seen_at: od,
            last_seen_at: od,
            _latest_order_date: od,
          })
        } else {
          if (pid) existing.products.add(pid)
          existing.total_order_items += 1
          if (settled) existing.settled_order_items += 1
          existing.total_gmv += gmv
          existing.total_commission += earned
          if (od) {
            if (!existing.first_seen_at || od < existing.first_seen_at) existing.first_seen_at = od
            if (!existing.last_seen_at || od > existing.last_seen_at) existing.last_seen_at = od
            if (!existing._latest_order_date || od > existing._latest_order_date) {
              existing._latest_order_date = od
              if (r.shop_name) existing.shop_name = r.shop_name as string
            }
          }
          if (!existing.shop_name && r.shop_name) existing.shop_name = r.shop_name as string
          if (!existing.currency && r.currency) existing.currency = r.currency as string
        }
      }
    }

    if (rows.length < PAGE_SIZE) break
  }

  console.log(`\n  Total rows read: ${totalRows}`)
  console.log(`  Unique products: ${productMap.size}`)
  console.log(`  Unique shops:    ${shopMap.size}`)

  if (isDryRun) {
    console.log('[DRY RUN] Skipping upserts.')
    return
  }

  // ── UPSERT PRODUCT MASTER ─────────────────────────────────────────────────

  const products = [...productMap.values()].map(p => ({
    created_by: CREATED_BY,
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

  console.log(`  Upserting ${products.length} products …`)
  let productsDone = 0
  for (let i = 0; i < products.length; i += UPSERT_CHUNK) {
    const chunk = products.slice(i, i + UPSERT_CHUNK)
    await upsert('tt_product_master', chunk, 'created_by,product_id')
    productsDone += chunk.length
    process.stdout.write(`\r  Products upserted: ${productsDone}/${products.length}`)
  }
  console.log()

  // ── UPSERT SHOP MASTER ────────────────────────────────────────────────────

  const shops = [...shopMap.values()].map(s => ({
    created_by: CREATED_BY,
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

  console.log(`  Upserting ${shops.length} shops …`)
  let shopsDone = 0
  for (let i = 0; i < shops.length; i += UPSERT_CHUNK) {
    const chunk = shops.slice(i, i + UPSERT_CHUNK)
    await upsert('tt_shop_master', chunk, 'created_by,shop_code')
    shopsDone += chunk.length
    process.stdout.write(`\r  Shops upserted: ${shopsDone}/${shops.length}`)
  }
  console.log()

  console.log(`\n✅ Done: ${productsDone} products, ${shopsDone} shops upserted.`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
