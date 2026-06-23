import path from 'node:path'
import crypto from 'node:crypto'
import { config } from 'dotenv'
import { fromZonedTime } from 'date-fns-tz'
import { createServiceClient } from '../src/lib/supabase/service.ts'

config({ path: path.resolve(__dirname, '../.env.local') })

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReceiptEntry {
  date: string       // YYYY-MM-DD, interpreted as Bangkok time
  productName: string
  qty: number
  unitCost: number
  poNumber: string
}

interface ReceiptResult {
  poNumber: string
  productName: string
  skuInternal: string
  date: string
  qty: number
  unitCost: number
  totalCost: number
  layerId: string
  status: 'inserted' | 'skipped_duplicate' | 'error'
  error?: string
}

interface ReturnRow {
  id: string
  sku: string
  qty: number
  return_type: string
  returned_at: string
}

interface ReturnResult {
  returnId: string
  sku: string
  qty: number
  adjustmentId?: string
  status: 'processed' | 'already_processed' | 'error'
  error?: string
}

interface Summary {
  receipts: {
    attempted: number
    inserted: number
    skipped: number
    errors: number
    totalQtyAdded: number
    totalCostAdded: number
    results: ReceiptResult[]
  }
  returns: {
    found: number
    processed: number
    alreadyProcessed: number
    errors: number
    results: ReturnResult[]
  }
  dryRun: boolean
  runAt: string
}

// ─── Receipt Data ─────────────────────────────────────────────────────────────

const RECEIPTS: ReceiptEntry[] = [
  { date: '2026-05-18', productName: 'Fresh Up',  qty: 938,  unitCost: 48, poNumber: 'PO001/2026' },
  { date: '2026-05-18', productName: 'Wind Down', qty: 500,  unitCost: 70, poNumber: 'PO029'      },
  { date: '2026-05-29', productName: 'Fresh Up',  qty: 1000, unitCost: 48, poNumber: 'PO002/2026' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deterministic UUID from a string seed (PO + SKU).
 * Same inputs always produce the same UUID — safe to re-run without duplicates.
 */
function deterministicUuid(seed: string): string {
  const h = crypto.createHash('sha256').update(seed).digest('hex')
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`
}

/** Bangkok 09:00 → UTC ISO string for use as received_at */
function bangkokMorningUtc(dateStr: string): string {
  return fromZonedTime(`${dateStr}T09:00:00`, 'Asia/Bangkok').toISOString()
}

// ─── SKU lookup cache ─────────────────────────────────────────────────────────

const skuCache = new Map<string, string | null>()

async function resolveSkuInternal(
  supabase: ReturnType<typeof createServiceClient>,
  productName: string
): Promise<string | null> {
  if (skuCache.has(productName)) return skuCache.get(productName) ?? null

  const { data, error } = await supabase
    .from('inventory_items')
    .select('sku_internal')
    .ilike('product_name', `%${productName}%`)
    .limit(1)
    .maybeSingle()

  const sku = error || !data ? null : (data.sku_internal as string)
  skuCache.set(productName, sku)
  return sku
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const result: { createdBy: string | null; dryRun: boolean; help: boolean } = {
    createdBy: null,
    dryRun: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { result.help = true; continue }
    if (arg === '--dry-run') { result.dryRun = true; continue }
    if (arg === '--created-by') { result.createdBy = argv[++i] ?? null; continue }
  }
  return result
}

function printUsage(): void {
  console.log([
    'Usage:',
    '  npx tsx scripts/import-inventory-receipts.ts [options]',
    '',
    'Options:',
    '  --dry-run           Preview without writing to the database',
    '  --created-by <uuid> auth.users.id used for created_by on adjustments',
    '                      (required when RETURN_RECEIVED records exist)',
    '  --help              Show this message',
    '',
    'Examples:',
    '  npx tsx scripts/import-inventory-receipts.ts --dry-run',
    '  npx tsx scripts/import-inventory-receipts.ts --created-by xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  ].join('\n'))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { printUsage(); process.exit(0) }

  if (args.dryRun) console.log('\n[DRY RUN — no data will be written]\n')

  const supabase = createServiceClient()

  const summary: Summary = {
    receipts: {
      attempted: RECEIPTS.length,
      inserted: 0,
      skipped: 0,
      errors: 0,
      totalQtyAdded: 0,
      totalCostAdded: 0,
      results: [],
    },
    returns: {
      found: 0,
      processed: 0,
      alreadyProcessed: 0,
      errors: 0,
      results: [],
    },
    dryRun: args.dryRun,
    runAt: new Date().toISOString(),
  }

  // ── Step 1: inventory_receipt_layers ──────────────────────────────────────

  console.log('[1/3] Processing receipt layers...')

  for (const receipt of RECEIPTS) {
    const skuInternal = await resolveSkuInternal(supabase, receipt.productName)

    if (!skuInternal) {
      console.error(`  ❌ SKU not found for "${receipt.productName}" — skipping`)
      summary.receipts.errors++
      summary.receipts.results.push({
        poNumber:   receipt.poNumber,
        productName: receipt.productName,
        skuInternal: 'NOT_FOUND',
        date:        receipt.date,
        qty:         receipt.qty,
        unitCost:    receipt.unitCost,
        totalCost:   receipt.qty * receipt.unitCost,
        layerId:     '',
        status:      'error',
        error:       'sku_internal not found in inventory_items',
      })
      continue
    }

    // Deterministic ref_id from PO + SKU — same run never creates a duplicate
    const refId = deterministicUuid(`PURCHASE:${receipt.poNumber}:${skuInternal}`)

    const { data: existing, error: checkErr } = await supabase
      .from('inventory_receipt_layers')
      .select('id')
      .eq('ref_type', 'PURCHASE')
      .eq('ref_id', refId)
      .maybeSingle()

    if (checkErr) {
      console.error(`  ❌ Duplicate check failed for ${receipt.poNumber}: ${checkErr.message}`)
      summary.receipts.errors++
      continue
    }

    if (existing) {
      console.log(`  ⟳ Skipped (exists): ${receipt.productName} ${receipt.date} [${receipt.poNumber}]`)
      summary.receipts.skipped++
      summary.receipts.results.push({
        poNumber:    receipt.poNumber,
        productName: receipt.productName,
        skuInternal,
        date:        receipt.date,
        qty:         receipt.qty,
        unitCost:    receipt.unitCost,
        totalCost:   receipt.qty * receipt.unitCost,
        layerId:     existing.id as string,
        status:      'skipped_duplicate',
      })
      continue
    }

    if (args.dryRun) {
      console.log(
        `  [DRY] Would insert: ${receipt.productName} (${skuInternal}) ${receipt.date}` +
        ` — ${receipt.qty} × ฿${receipt.unitCost} = ฿${receipt.qty * receipt.unitCost} [${receipt.poNumber}]`
      )
      summary.receipts.inserted++
      summary.receipts.totalQtyAdded += receipt.qty
      summary.receipts.totalCostAdded += receipt.qty * receipt.unitCost
      summary.receipts.results.push({
        poNumber:    receipt.poNumber,
        productName: receipt.productName,
        skuInternal,
        date:        receipt.date,
        qty:         receipt.qty,
        unitCost:    receipt.unitCost,
        totalCost:   receipt.qty * receipt.unitCost,
        layerId:     refId,
        status:      'inserted',
      })
      continue
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('inventory_receipt_layers')
      .insert({
        sku_internal:  skuInternal,
        received_at:   bangkokMorningUtc(receipt.date),
        qty_received:  receipt.qty,
        qty_remaining: receipt.qty,
        unit_cost:     receipt.unitCost,
        ref_type:      'PURCHASE',
        ref_id:        refId,
      })
      .select('id')
      .single()

    if (insertErr || !inserted) {
      console.error(`  ❌ Insert failed: ${receipt.productName} ${receipt.date} — ${insertErr?.message}`)
      summary.receipts.errors++
      summary.receipts.results.push({
        poNumber:    receipt.poNumber,
        productName: receipt.productName,
        skuInternal,
        date:        receipt.date,
        qty:         receipt.qty,
        unitCost:    receipt.unitCost,
        totalCost:   receipt.qty * receipt.unitCost,
        layerId:     '',
        status:      'error',
        error:       insertErr?.message,
      })
    } else {
      console.log(
        `  ✓ Inserted: ${receipt.productName} (${skuInternal}) ${receipt.date}` +
        ` — ${receipt.qty} × ฿${receipt.unitCost} [${receipt.poNumber}]`
      )
      summary.receipts.inserted++
      summary.receipts.totalQtyAdded += receipt.qty
      summary.receipts.totalCostAdded += receipt.qty * receipt.unitCost
      summary.receipts.results.push({
        poNumber:    receipt.poNumber,
        productName: receipt.productName,
        skuInternal,
        date:        receipt.date,
        qty:         receipt.qty,
        unitCost:    receipt.unitCost,
        totalCost:   receipt.qty * receipt.unitCost,
        layerId:     inserted.id as string,
        status:      'inserted',
      })
    }
  }

  // ── Step 2: inventory_returns — find resellable items ─────────────────────

  console.log('\n[2/3] Fetching RETURN_RECEIVED items from inventory_returns...')

  const { data: returns, error: returnsErr } = await supabase
    .from('inventory_returns')
    .select('id, sku, qty, return_type, returned_at')
    .eq('return_type', 'RETURN_RECEIVED')

  if (returnsErr) {
    console.error(`  ❌ Failed to fetch returns: ${returnsErr.message}`)
    summary.returns.errors++
  } else {
    summary.returns.found = returns?.length ?? 0
    console.log(`  ℹ ${summary.returns.found} RETURN_RECEIVED record(s) found`)
  }

  // ── Step 3: ADJUST_IN for each unprocessed return ─────────────────────────

  console.log('\n[3/3] Creating ADJUST_IN adjustments for new returns...')

  if ((returns?.length ?? 0) === 0) {
    console.log('  ℹ No returnable items — nothing to process')
  } else if (!args.createdBy) {
    console.warn(
      `  ⚠ ${returns!.length} return(s) found but --created-by not provided.` +
      ' Pass --created-by <auth.users.id> to process them.'
    )
  } else {
    for (const ret of returns as ReturnRow[]) {
      // Idempotency: reason field encodes the source return id
      const { data: existingAdj, error: adjCheckErr } = await supabase
        .from('inventory_adjustments')
        .select('id')
        .like('reason', `%return_id:${ret.id}%`)
        .maybeSingle()

      if (adjCheckErr) {
        console.error(`  ❌ Idempotency check failed for return ${ret.id}: ${adjCheckErr.message}`)
        summary.returns.errors++
        continue
      }

      if (existingAdj) {
        console.log(`  ⟳ Skipped (exists): return ${ret.id} (${ret.sku})`)
        summary.returns.alreadyProcessed++
        summary.returns.results.push({
          returnId:     ret.id,
          sku:          ret.sku,
          qty:          ret.qty,
          adjustmentId: existingAdj.id as string,
          status:       'already_processed',
        })
        continue
      }

      if (args.dryRun) {
        console.log(`  [DRY] Would create ADJUST_IN: ${ret.sku} qty=${ret.qty} (return ${ret.id})`)
        summary.returns.processed++
        summary.returns.results.push({ returnId: ret.id, sku: ret.sku, qty: ret.qty, status: 'processed' })
        continue
      }

      const { data: adjData, error: adjErr } = await supabase
        .from('inventory_adjustments')
        .insert({
          sku_internal:    ret.sku,   // assumes sku == sku_internal; FK will reject if not
          adjustment_type: 'ADJUST_IN',
          quantity:        ret.qty,
          reason:          `resellable_return — return_id:${ret.id}`,
          adjusted_at:     ret.returned_at,
          created_by:      args.createdBy,
        })
        .select('id')
        .single()

      if (adjErr || !adjData) {
        console.error(`  ❌ Failed: return ${ret.id} (${ret.sku}) — ${adjErr?.message}`)
        summary.returns.errors++
        summary.returns.results.push({
          returnId: ret.id,
          sku:      ret.sku,
          qty:      ret.qty,
          status:   'error',
          error:    adjErr?.message,
        })
      } else {
        console.log(`  ✓ ADJUST_IN: ${ret.sku} qty=${ret.qty} → adj ${adjData.id}`)
        summary.returns.processed++
        summary.returns.results.push({
          returnId:     ret.id,
          sku:          ret.sku,
          qty:          ret.qty,
          adjustmentId: adjData.id as string,
          status:       'processed',
        })
      }
    }
  }

  // ── JSON summary output ───────────────────────────────────────────────────

  console.log('\n' + '='.repeat(50))
  console.log('SUMMARY')
  console.log('='.repeat(50))
  console.log(JSON.stringify(summary, null, 2))

  const hasErrors = summary.receipts.errors > 0 || summary.returns.errors > 0
  if (hasErrors) {
    console.error('\n⚠ Completed with errors — review output above')
    process.exit(1)
  }

  console.log(`\n✓ Receipts: ${summary.receipts.inserted} inserted, ${summary.receipts.skipped} skipped`)
  console.log(`✓ Returns:  ${summary.returns.processed} processed, ${summary.returns.alreadyProcessed} already done`)
  console.log(`✓ Stock added: ${summary.receipts.totalQtyAdded} units / ฿${summary.receipts.totalCostAdded.toLocaleString()}`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
