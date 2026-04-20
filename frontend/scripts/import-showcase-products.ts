/**
 * import-showcase-products.ts
 *
 * Imports showcase product data from a JSON file into tt_product_master.
 *
 * Rules:
 *   product_image_url  — only fill if currently NULL (never overwrite)
 *   product_name       — only fill if currently NULL (affiliate name takes priority)
 *   current_price      — always update to latest showcase value
 *   stock_status       — always update to latest showcase value
 *   showcase_last_synced_at — always set to scraped_at from source
 *   shop_code, shop_name, aggregate stats — NEVER touched (owned by affiliate import)
 *
 * Shops: skipped — this source file has no shop_name / shop_id data.
 *         If future scrapes include shop fields, add a --shops flag here.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/import-showcase-products.ts \
 *     --file "D:/AI_OS/data/processed/tiktok-showcase-products/product-items.json" \
 *     --created-by "2c4e254d-c779-4f8a-af93-603dc26e6af0"
 *
 *   --dry-run   Parse + plan only — no DB writes
 */

import fs from 'node:fs'
import path from 'node:path'
import { createServiceClient } from '../src/lib/supabase/service'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SourceItem {
  product_id: string
  product_name: string | null
  product_image_url: string | null
  price: number | null
  price_currency: string | null
  stock_status: string | null
  product_status: string | null
  shop_name: string | null
  scraped_at: string | null
  [key: string]: unknown
}

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const r: { file?: string; createdBy?: string; dryRun: boolean; help: boolean } =
    { dryRun: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help': case '-h': r.help = true; break
      case '--file':       r.file      = argv[++i]; break
      case '--created-by': r.createdBy = argv[++i]; break
      case '--dry-run':    r.dryRun    = true; break
    }
  }
  return r
}

function usage() {
  console.log(`
Usage:
  npx tsx --env-file=.env.local scripts/import-showcase-products.ts \\
    --file <path-to-product-items.json> \\
    --created-by <auth-user-uuid> \\
    [--dry-run]
`)
}

// ─── Parse + validate source JSON ─────────────────────────────────────────────

function parseSourceFile(filePath: string): { items: SourceItem[]; invalidCount: number } {
  const raw = fs.readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('Source file must be a JSON array')

  const items: SourceItem[] = []
  let invalidCount = 0

  for (const row of parsed) {
    if (!row?.product_id || typeof row.product_id !== 'string') {
      invalidCount++
      continue
    }
    items.push({
      product_id: row.product_id,
      product_name: typeof row.product_name === 'string' ? row.product_name : null,
      product_image_url: typeof row.product_image_url === 'string' ? row.product_image_url : null,
      price: typeof row.price === 'number' ? row.price : null,
      price_currency: typeof row.price_currency === 'string' ? row.price_currency : null,
      stock_status: typeof row.stock_status === 'string' ? row.stock_status : null,
      product_status: typeof row.product_status === 'string' ? row.product_status : null,
      shop_name: typeof row.shop_name === 'string' ? row.shop_name : null,
      scraped_at: typeof row.scraped_at === 'string' ? row.scraped_at : null,
    })
  }

  // Deduplicate by product_id — keep last seen (latest row_index)
  const deduped = new Map<string, SourceItem>()
  for (const item of items) deduped.set(item.product_id, item)

  return { items: [...deduped.values()], invalidCount }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || !args.file || !args.createdBy) {
    usage()
    process.exit(args.help ? 0 : 1)
  }

  const filePath = path.resolve(args.file)
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    process.exit(1)
  }

  console.log(`\nShowcase Product Import`)
  console.log(`mode       : ${args.dryRun ? 'DRY RUN (no DB writes)' : 'LIVE'}`)
  console.log(`file       : ${filePath}`)
  console.log(`created_by : ${args.createdBy}`)

  // ── 1. Parse source ──────────────────────────────────────────────────────────
  const { items, invalidCount } = parseSourceFile(filePath)
  console.log(`\nsource     : ${items.length} valid products, ${invalidCount} invalid (missing product_id)`)

  // ── 2. Shop check ────────────────────────────────────────────────────────────
  const withShop = items.filter(i => i.shop_name !== null)
  if (withShop.length === 0) {
    console.log(`shops      : 0 items have shop_name — shop sync skipped`)
    console.log(`             (tt_shop_master untouched — no shop data in source)`)
  } else {
    console.log(`shops      : ${withShop.length} items have shop_name — but tt_shop_master has no image column yet`)
    console.log(`             shop names will NOT be imported in this version`)
  }

  if (items.length === 0) {
    console.log('\nNothing to import.')
    process.exit(0)
  }

  if (args.dryRun) {
    console.log('\n[DRY RUN] Planned operations:')
    for (const item of items) {
      const img = item.product_image_url ? `img=${item.product_image_url.slice(0, 60)}…` : 'img=null'
      console.log(`  ${item.product_id}  ${img}`)
    }
    console.log(`\n  ${items.length} products would be upserted into tt_product_master`)
    process.exit(0)
  }

  // ── 3. Fetch existing records ────────────────────────────────────────────────
  const supabase = createServiceClient()
  const productIds = items.map(i => i.product_id)

  const { data: existing, error: fetchErr } = await supabase
    .from('tt_product_master')
    .select('product_id, product_image_url, product_name')
    .eq('created_by', args.createdBy)
    .in('product_id', productIds)

  if (fetchErr) {
    console.error(`\nFetch error: ${fetchErr.message}`)
    process.exit(1)
  }

  type ExistingRow = { product_id: string; product_image_url: string | null; product_name: string | null }
  const existingMap = new Map<string, ExistingRow>(
    (existing ?? []).map(r => [r.product_id, r as ExistingRow])
  )

  // ── 4. Categorize ────────────────────────────────────────────────────────────
  const toInsert:           SourceItem[] = []
  const toUpdateWithImage:  SourceItem[] = []
  const toUpdatePriceOnly:  SourceItem[] = []

  for (const item of items) {
    const row = existingMap.get(item.product_id)
    if (!row) {
      toInsert.push(item)
    } else if (!row.product_image_url && item.product_image_url) {
      toUpdateWithImage.push(item)
    } else {
      toUpdatePriceOnly.push(item)
    }
  }

  console.log(`\n  to insert       : ${toInsert.length}  (new — not yet in tt_product_master)`)
  console.log(`  image to fill   : ${toUpdateWithImage.length}  (existing row, no image yet)`)
  console.log(`  price/stock upd : ${toUpdatePriceOnly.length}  (existing row, image already present)`)

  let inserted = 0, imageFilled = 0, priceUpdated = 0, failed = 0

  // ── 5. INSERT new products ───────────────────────────────────────────────────
  if (toInsert.length > 0) {
    const rows = toInsert.map(item => ({
      created_by:             args.createdBy!,
      product_id:             item.product_id,
      product_name:           item.product_name,
      product_image_url:      item.product_image_url,
      current_price:          item.price,
      stock_status:           item.stock_status,
      showcase_last_synced_at: item.scraped_at ?? new Date().toISOString(),
    }))

    const { error: insErr } = await supabase.from('tt_product_master').insert(rows)
    if (insErr) {
      console.error(`\n  INSERT error: ${insErr.message}`)
      failed += toInsert.length
    } else {
      inserted += toInsert.length
      for (const item of toInsert) {
        const img = item.product_image_url ? '✓ img' : '  img=null'
        console.log(`  [inserted] ${item.product_id}  ${img}  ${item.product_name?.slice(0, 50) ?? ''}`)
      }
    }
  }

  // ── 6. UPDATE: fill missing image ────────────────────────────────────────────
  for (const item of toUpdateWithImage) {
    const { error: updErr } = await supabase
      .from('tt_product_master')
      .update({
        product_image_url:       item.product_image_url,
        current_price:           item.price,
        stock_status:            item.stock_status,
        showcase_last_synced_at: item.scraped_at ?? new Date().toISOString(),
      })
      .eq('created_by', args.createdBy!)
      .eq('product_id', item.product_id)

    if (updErr) {
      console.error(`  [image_fill ERR] ${item.product_id}: ${updErr.message}`)
      failed++
    } else {
      imageFilled++
      console.log(`  [image_filled] ${item.product_id}  ${item.product_name?.slice(0, 50) ?? ''}`)
    }
  }

  // ── 7. UPDATE: price/stock only (image already set) ──────────────────────────
  if (toUpdatePriceOnly.length > 0) {
    // Batch: individual updates keyed by product_id
    for (const item of toUpdatePriceOnly) {
      const { error: updErr } = await supabase
        .from('tt_product_master')
        .update({
          current_price:           item.price,
          stock_status:            item.stock_status,
          showcase_last_synced_at: item.scraped_at ?? new Date().toISOString(),
        })
        .eq('created_by', args.createdBy!)
        .eq('product_id', item.product_id)

      if (updErr) {
        console.error(`  [price_upd ERR] ${item.product_id}: ${updErr.message}`)
        failed++
      } else {
        priceUpdated++
      }
    }
    if (failed === 0) {
      console.log(`  [price_updated] ${toUpdatePriceOnly.length} products (image preserved)`)
    }
  }

  // ── 8. Summary ───────────────────────────────────────────────────────────────
  console.log(`
─────────────────────────────────────
  source products    : ${items.length}
  invalid (skipped)  : ${invalidCount}
  inserted           : ${inserted}
  image filled       : ${imageFilled}
  price/stock updated: ${priceUpdated}
  failed             : ${failed}
─────────────────────────────────────
  target table       : tt_product_master
  image column       : product_image_url
  shops imported     : 0  (no shop data in source)
─────────────────────────────────────`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
