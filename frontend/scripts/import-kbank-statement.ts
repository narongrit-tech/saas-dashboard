import path from 'node:path'
import fs from 'node:fs'
import { parseBankStatementExcel, calculateFileHash, computeTxnHash } from '../src/lib/importers/kbank-statement'
import { createServiceClient } from '../src/lib/supabase/service'

const BATCH_SIZE = 200

function printUsage(): void {
  console.log([
    'Usage:',
    '  npx tsx scripts/import-kbank-statement.ts --file "<path>" --created-by "<uuid>" --account-id "<bank_account_uuid>"',
    '',
    'Flags:',
    '  --file        Path to KBank statement Excel file (.xlsx)',
    '  --created-by  auth.users.id that owns this import',
    '  --account-id  bank_accounts.id UUID for this bank account',
  ].join('\n'))
}

function parseArgs(argv: string[]) {
  const result: { file?: string; createdBy?: string; accountId?: string; help: boolean } = { help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { result.help = true; continue }
    if (arg === '--file') { result.file = argv[++i]; continue }
    if (arg === '--created-by') { result.createdBy = argv[++i]; continue }
    if (arg === '--account-id') { result.accountId = argv[++i]; continue }
  }
  return result
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.file || !args.createdBy || !args.accountId) {
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

  // Skip if file already imported (use bank_statement_import_batches)
  const { data: existingBatch } = await supabase
    .from('bank_statement_import_batches')
    .select('id, status')
    .eq('file_hash', fileHash)
    .maybeSingle()

  if (existingBatch?.status === 'completed') {
    console.log(`Already imported (batch: ${existingBatch.id}, status: completed). Skipping.`)
    process.exit(0)
  }
  if (existingBatch?.status === 'failed') {
    // Delete the failed batch so we can retry
    await supabase.from('bank_statement_import_batches').delete().eq('id', existingBatch.id)
    console.log(`Retrying failed batch ${existingBatch.id}...`)
  }

  // Parse Excel
  const { rows, warnings } = parseBankStatementExcel(buffer)
  warnings.forEach(w => console.warn('[WARN]', w))

  if (rows.length === 0) {
    console.error('No rows parsed from file — check format and column names')
    process.exit(1)
  }

  // Determine date range for batch metadata
  const dates = rows.map(r => r.txn_date).sort((a, b) => a.getTime() - b.getTime())
  const periodStart = dates[0].toISOString().slice(0, 10)
  const periodEnd   = dates[dates.length - 1].toISOString().slice(0, 10)

  // Create bank_statement_import_batches record
  const { data: batch, error: batchErr } = await supabase
    .from('bank_statement_import_batches')
    .insert({
      bank_account_id: args.accountId,
      imported_by: args.createdBy,
      file_name: fileName,
      file_hash: fileHash,
      status: 'pending',
      import_mode: 'append',
      metadata: {
        total_rows: rows.length,
        date_range: { start: periodStart, end: periodEnd },
        format_type: 'kbank_excel',
      },
    })
    .select('id')
    .single()

  if (batchErr || !batch) {
    console.error('Failed to create import batch:', batchErr?.message)
    process.exit(1)
  }

  const batchId = batch.id
  console.log(`Batch created: ${batchId} (${rows.length} rows, ${periodStart} → ${periodEnd})`)

  // Compute txn_hash for each row and check duplicates
  const rowsWithHash = rows.map(row => ({
    ...row,
    txn_hash: computeTxnHash(
      args.accountId!,
      row.txn_date,
      row.withdrawal !== null ? Math.abs(row.withdrawal) : null,
      row.deposit !== null ? Math.abs(row.deposit) : null,
      row.description
    ),
  }))

  // Deduplicate within the file (same txn_hash = same transaction)
  const uniqueMap = new Map<string, typeof rowsWithHash[0]>()
  for (const row of rowsWithHash) uniqueMap.set(row.txn_hash, row)
  const uniqueRows = Array.from(uniqueMap.values())
  const skippedInFile = rows.length - uniqueRows.length

  let insertedCount = 0
  let skippedCount = skippedInFile
  let errorCount = 0

  // Batch upsert using unique index: (created_by, bank_account_id, txn_hash)
  for (let i = 0; i < uniqueRows.length; i += BATCH_SIZE) {
    const chunk = uniqueRows.slice(i, i + BATCH_SIZE)

    const toInsert = chunk.map(row => ({
      bank_account_id: args.accountId,
      import_batch_id: batchId,
      txn_date: row.txn_date.toISOString().slice(0, 10),
      description: row.description,
      channel: row.channel,
      reference_id: row.reference_id,
      withdrawal: row.withdrawal !== null ? Math.abs(row.withdrawal) : 0,
      deposit: row.deposit !== null ? Math.abs(row.deposit) : 0,
      balance: row.balance,
      txn_hash: row.txn_hash,
      created_by: args.createdBy,
      raw: {},
    }))

    const { data, error } = await supabase
      .from('bank_transactions')
      .upsert(toInsert, { onConflict: 'bank_account_id,txn_hash', ignoreDuplicates: true })
      .select('id')

    if (error) {
      errorCount += chunk.length
      console.error(`[ERR] Batch ${i}-${i + chunk.length}: ${error.message}`)
    } else {
      const actualInserted = data?.length ?? 0
      insertedCount += actualInserted
      skippedCount += chunk.length - actualInserted  // count ignored duplicates
    }

    process.stdout.write(`\r  Progress: ${Math.min(i + BATCH_SIZE, uniqueRows.length)}/${uniqueRows.length}`)
  }
  process.stdout.write('\n')

  // Update batch status
  const finalStatus = errorCount > 0 && insertedCount === 0 ? 'failed' : 'completed'
  await supabase.from('bank_statement_import_batches').update({
    status: finalStatus,
    metadata: {
      total_rows: rows.length,
      date_range: { start: periodStart, end: periodEnd },
      format_type: 'kbank_excel',
      inserted_count: insertedCount,
      skipped_count: skippedCount,
      error_count: errorCount,
    },
  }).eq('id', batchId)

  if (finalStatus === 'failed') {
    console.error('Import failed')
    process.exit(1)
  }

  console.log(JSON.stringify({
    success: true,
    batchId,
    rowCount: rows.length,
    insertedCount,
    skippedCount,
    errorCount,
    period: `${periodStart} → ${periodEnd}`,
  }, null, 2))
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
