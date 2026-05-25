import path from 'node:path'
import fs from 'node:fs'
import { parseOnholdExcel, calculateFileHash } from '../src/lib/importers/tiktok-onhold'
import { createServiceClient } from '../src/lib/supabase/service'

function printUsage(): void {
  console.log([
    'Usage:',
    '  npx tsx scripts/import-tiktok-onhold.ts --file "<path>" --created-by "<uuid>"',
    '',
    'Flags:',
    '  --file        Path to TikTok on-hold/unsettled transactions Excel file (.xlsx)',
    '  --created-by  auth.users.id that owns this import',
  ].join('\n'))
}

function parseArgs(argv: string[]) {
  const result: { file?: string; createdBy?: string; help: boolean } = { help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { result.help = true; continue }
    if (arg === '--file') { result.file = argv[++i]; continue }
    if (arg === '--created-by') { result.createdBy = argv[++i]; continue }
  }
  return result
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.file || !args.createdBy) {
    printUsage()
    process.exit(args.help ? 0 : 1)
  }

  const filePath = path.resolve(process.cwd(), args.file)
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    process.exit(1)
  }

  const supabase = createServiceClient()
  const buffer = fs.readFileSync(filePath)
  const fileHash = calculateFileHash(buffer)
  const fileName = path.basename(filePath)

  // Skip if file already imported
  const { data: existing } = await supabase
    .from('import_batches')
    .select('id, status')
    .eq('file_hash', fileHash)
    .eq('created_by', args.createdBy)
    .maybeSingle()

  if (existing) {
    console.log(`Already imported (batch: ${existing.id}, status: ${existing.status}). Skipping.`)
    process.exit(0)
  }

  // Parse Excel
  const { rows, warnings } = parseOnholdExcel(buffer)
  warnings.forEach(w => console.warn('[WARN]', w))

  // Create import batch
  const { data: batch, error: batchErr } = await supabase
    .from('import_batches')
    .insert({
      created_by: args.createdBy,
      marketplace: 'tiktok',
      report_type: 'tiktok_onhold',
      file_name: fileName,
      file_hash: fileHash,
      row_count: rows.length,
      status: 'processing',
    })
    .select('id')
    .single()

  if (batchErr || !batch) {
    console.error('Failed to create import batch:', batchErr?.message)
    process.exit(1)
  }

  const batchId = batch.id
  console.log(`Batch created: ${batchId} (${rows.length} rows)`)

  // Deduplicate by txn_id
  const uniqueMap = new Map<string, typeof rows[0]>()
  for (const row of rows) uniqueMap.set(row.txn_id, row)
  const uniqueRows = Array.from(uniqueMap.values())
  const skippedCount = rows.length - uniqueRows.length

  // Check which txn_ids already exist (preserve settled status)
  const txnIds = uniqueRows.map(r => r.txn_id)
  const { data: existingTxns } = await supabase
    .from('unsettled_transactions')
    .select('txn_id, status')
    .eq('marketplace', 'tiktok')
    .in('txn_id', txnIds)
  const existingMap = new Map((existingTxns ?? []).map(r => [r.txn_id, r.status as string]))

  const now = new Date().toISOString()
  const toUpsert = uniqueRows.map(row => ({
    marketplace: 'tiktok',
    txn_id: row.txn_id,
    related_order_id: row.related_order_id,
    type: row.type,
    currency: row.currency,
    estimated_settle_time: row.estimated_settle_time.toISOString(),
    estimated_settlement_amount: row.estimated_settlement_amount,
    unsettled_reason: row.unsettled_reason,
    import_batch_id: batchId,
    last_seen_at: now,
    created_by: args.createdBy,
    // Don't revert already-settled rows back to unsettled
    status: existingMap.get(row.txn_id) === 'settled' ? 'settled' : 'unsettled',
  }))

  const { error: upsertErr } = await supabase
    .from('unsettled_transactions')
    .upsert(toUpsert, { onConflict: 'marketplace,txn_id' })

  const insertedCount = upsertErr ? 0 : uniqueRows.length - existingMap.size
  const updatedCount = upsertErr ? 0 : existingMap.size
  const errorCount = upsertErr ? uniqueRows.length : 0

  // Update batch status
  await supabase.from('import_batches').update({
    inserted_count: insertedCount,
    updated_count: updatedCount,
    skipped_count: skippedCount,
    error_count: errorCount,
    status: upsertErr ? 'failed' : 'success',
    notes: upsertErr ? upsertErr.message : null,
  }).eq('id', batchId)

  if (upsertErr) {
    console.error('Upsert failed:', upsertErr.message)
    process.exit(1)
  }

  console.log(JSON.stringify({ success: true, batchId, rowCount: rows.length, insertedCount, updatedCount, skippedCount }, null, 2))
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
