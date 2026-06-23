import path from 'node:path'
import crypto from 'node:crypto'
import { config } from 'dotenv'
import { fromZonedTime } from 'date-fns-tz'
import { createServiceClient } from '../src/lib/supabase/service.ts'

config({ path: path.resolve(__dirname, '../.env.local') })

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReturnRecord {
  id: string
  sku: string
  qty: number
  return_type: string
  order_id: string | null
  returned_at: string | null
}

interface ProductInfo {
  id: string
  product_name: string
}

interface ReturnProcessResult {
  return_id: string
  product_id: string
  marketplace_sku: string
  mapped_sku: string
  qty_returned: number
  adjustmentId?: string
  status: 'processed' | 'skipped' | 'error'
  error?: string
}

interface Summary {
  queried: number
  eligible: number
  processed: number
  skipped: number
  errors: number
  totalQtyProcessed: number
  results: ReturnProcessResult[]
  dryRun: boolean
  runAt: string
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** TikTok product IDs that came from Fresh Up stock → map to NEWONN001 */
const FRESH_UP_PRODUCT_IDS = new Set<string>([
  // Add Fresh Up product IDs here
  // These are the product_id values that originated from Fresh Up stock
])

/** TikTok product IDs that came from Wind Down stock → map to NEWONN002 */
const WIND_DOWN_PRODUCT_IDS = new Set<string>([
  // Add Wind Down product IDs here
  // These are the product_id values that originated from Wind Down stock
])

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map a SKU from inventory_returns to a main SKU based on pattern.
 * - If SKU starts with "FRESH_UP*" → NEWONN001
 * - If SKU starts with "WIND_DOWN*" → NEWONN002
 * - Otherwise → NEWONN001 (default)
 */
function mapSkuToResaleSku(originalSku: string): string {
  if (originalSku.startsWith('FRESH_UP')) return 'NEWONN001'
  if (originalSku.startsWith('WIND_DOWN')) return 'NEWONN002'
  return 'NEWONN001' // default fallback
}

/**
 * Bangkok 09:00 → UTC ISO string for use as adjusted_at
 */
function bangkokMorningUtc(dateStr: string): string {
  return fromZonedTime(`${dateStr}T09:00:00`, 'Asia/Bangkok').toISOString()
}

/**
 * Format timestamp for display
 */
function formatTimestamp(ts: string | Date): string {
  const date = typeof ts === 'string' ? new Date(ts) : ts
  return date.toISOString().split('T')[0]
}

// ─── SKU validation cache ─────────────────────────────────────────────────────

const skuCache = new Map<string, boolean>()

async function validateSkuExists(
  supabase: ReturnType<typeof createServiceClient>,
  sku: string
): Promise<boolean> {
  if (skuCache.has(sku)) return skuCache.get(sku) ?? false

  const { data, error } = await supabase
    .from('inventory_items')
    .select('sku_internal')
    .eq('sku_internal', sku)
    .maybeSingle()

  const exists = !error && !!data
  skuCache.set(sku, exists)
  return exists
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const result: { createdBy: string | null; dryRun: boolean; help: boolean } = {
    createdBy: '2c4e254d-c779-4f8a-af93-603dc26e6af0', // default system user UUID
    dryRun: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { result.help = true; continue }
    if (arg === '--dry-run') { result.dryRun = true; continue }
    if (arg === '--created-by') { result.createdBy = argv[++i] ?? result.createdBy; continue }
  }
  return result
}

function printUsage(): void {
  console.log([
    'Usage:',
    '  npx tsx scripts/process-returns-resale.ts [options]',
    '',
    'Options:',
    '  --dry-run           Preview without writing to the database',
    '  --created-by <uuid> auth.users.id for created_by on adjustments',
    '                      (default: 2c4e254d-c779-4f8a-af93-603dc26e6af0)',
    '  --help              Show this message',
    '',
    'Examples:',
    '  npx tsx scripts/process-returns-resale.ts --dry-run',
    '  npx tsx scripts/process-returns-resale.ts --created-by xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  ].join('\n'))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { printUsage(); process.exit(0) }

  if (args.dryRun) console.log('\n[DRY RUN — no data will be written]\n')

  const supabase = createServiceClient()

  const summary: Summary = {
    queried: 0,
    eligible: 0,
    processed: 0,
    skipped: 0,
    errors: 0,
    totalQtyProcessed: 0,
    results: [],
    dryRun: args.dryRun,
    runAt: new Date().toISOString(),
  }

  // ── Step 1: Query inventory_returns ────────────────────────────────────────

  console.log('[1/2] Querying inventory_returns (qty > 0 AND return_type = \'RETURN_RECEIVED\')...')

  const { data: returns, error: returnsErr } = await supabase
    .from('inventory_returns')
    .select(
      `
      id,
      sku,
      qty,
      return_type,
      order_id,
      returned_at
      `
    )
    .gt('qty', 0)
    .eq('return_type', 'RETURN_RECEIVED')

  if (returnsErr) {
    console.error(`  ❌ Failed to fetch returns: ${returnsErr.message}`)
    console.log(JSON.stringify(summary, null, 2))
    process.exit(1)
  }

  const returnRecords = (returns ?? []) as ReturnRecord[]
  summary.queried = returnRecords.length
  console.log(`  ℹ ${summary.queried} return(s) with qty > 0 AND return_type = 'RETURN_RECEIVED'`)

  if (returnRecords.length === 0) {
    console.log('  ℹ No returns to process')
    console.log('\n' + '='.repeat(50))
    console.log('SUMMARY')
    console.log('='.repeat(50))
    console.log(JSON.stringify(summary, null, 2))
    process.exit(0)
  }

  // ── Step 2: Process each return ────────────────────────────────────────────

  console.log('\n[2/2] Creating ADJUST_IN adjustments for resale mapping...')

  for (const ret of returnRecords) {
    const mappedSku = mapSkuToResaleSku(ret.sku)

    // Validate that the target SKU exists
    const skuExists = await validateSkuExists(supabase, mappedSku)
    if (!skuExists) {
      console.error(`  ❌ Target SKU not found: ${mappedSku} (return ${ret.id})`)
      summary.errors++
      summary.results.push({
        return_id: ret.id,
        product_id: ret.sku,
        marketplace_sku: ret.sku,
        mapped_sku: mappedSku,
        qty_returned: ret.qty,
        status: 'error',
        error: `Target SKU ${mappedSku} not found in inventory_items`,
      })
      continue
    }

    // Idempotency: check if this return has already been processed
    const { data: existingAdj, error: adjCheckErr } = await supabase
      .from('inventory_adjustments')
      .select('id')
      .like('reason', `%return_id:${ret.id}%`)
      .maybeSingle()

    if (adjCheckErr) {
      console.error(
        `  ❌ Idempotency check failed for return ${ret.id}: ${adjCheckErr.message}`
      )
      summary.errors++
      continue
    }

    if (existingAdj) {
      console.log(
        `  ⟳ Skipped (already processed): return ${ret.id} (${ret.sku} → ${mappedSku} qty=${ret.qty})`
      )
      summary.skipped++
      summary.results.push({
        return_id: ret.id,
        product_id: ret.sku,
        marketplace_sku: ret.sku,
        mapped_sku: mappedSku,
        qty_returned: ret.qty,
        adjustmentId: existingAdj.id as string,
        status: 'skipped',
      })
      continue
    }

    // Prepare adjustment data
    const adjustedAt = ret.returned_at ? new Date(ret.returned_at).toISOString() : bangkokMorningUtc(formatTimestamp(new Date()))
    const reason = `Resale from return — return_id:${ret.id}`

    if (args.dryRun) {
      console.log(
        `  [DRY] Would create ADJUST_IN: ${mappedSku} qty=${ret.qty}` +
        ` (return ${ret.id})`
      )
      summary.processed++
      summary.totalQtyProcessed += ret.qty
      summary.results.push({
        return_id: ret.id,
        product_id: ret.sku,
        marketplace_sku: ret.sku,
        mapped_sku: mappedSku,
        qty_returned: ret.qty,
        status: 'processed',
      })
      continue
    }

    // Create the adjustment (this triggers auto-creation of inventory_receipt_layers)
    const { data: adjData, error: adjErr } = await supabase
      .from('inventory_adjustments')
      .insert({
        sku_internal: mappedSku,
        adjustment_type: 'ADJUST_IN',
        quantity: ret.qty,
        reason,
        adjusted_at: adjustedAt,
        created_by: args.createdBy,
      })
      .select('id')
      .single()

    if (adjErr || !adjData) {
      console.error(
        `  ❌ Failed to create adjustment: return ${ret.id} (${ret.sku} → ${mappedSku})` +
        ` — ${adjErr?.message}`
      )
      summary.errors++
      summary.results.push({
        return_id: ret.id,
        product_id: ret.sku,
        marketplace_sku: ret.sku,
        mapped_sku: mappedSku,
        qty_returned: ret.qty,
        status: 'error',
        error: adjErr?.message,
      })
    } else {
      console.log(
        `  ✓ ADJUST_IN created: return ${ret.id} (${ret.sku} → ${mappedSku} qty=${ret.qty})` +
        ` → adj ${adjData.id}`
      )
      summary.processed++
      summary.totalQtyProcessed += ret.qty
      summary.results.push({
        return_id: ret.id,
        product_id: ret.sku,
        marketplace_sku: ret.sku,
        mapped_sku: mappedSku,
        qty_returned: ret.qty,
        adjustmentId: adjData.id as string,
        status: 'processed',
      })
    }
  }

  // ── JSON summary output ────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(50))
  console.log('SUMMARY')
  console.log('='.repeat(50))
  console.log(JSON.stringify(summary, null, 2))

  const hasErrors = summary.errors > 0
  if (hasErrors) {
    console.error('\n⚠ Completed with errors — review output above')
    process.exit(1)
  }

  console.log(
    `\n✓ Returns processed: ${summary.processed} processed, ${summary.skipped} skipped (${summary.queried} total)`
  )
  console.log(`✓ Stock added: ${summary.totalQtyProcessed} units`)
  if (!args.dryRun) {
    console.log(`✓ All adjustments auto-created inventory_receipt_layers via trigger`)
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
