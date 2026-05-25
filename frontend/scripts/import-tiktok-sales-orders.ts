import path from 'node:path'
import fs from 'node:fs'
import { parseSalesOrdersExcel, calculateFileHash, computeOrderLineHash } from '../src/lib/importers/tiktok-sales-orders'
import { createServiceClient } from '../src/lib/supabase/service'

const BATCH_SIZE = 200

function printUsage(): void {
  console.log([
    'Usage:',
    '  npx tsx scripts/import-tiktok-sales-orders.ts --file "<path>" --created-by "<uuid>"',
    '',
    'Flags:',
    '  --file        Path to TikTok Sales Orders Excel file (.xlsx)',
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
  const { data: existingBatch } = await supabase
    .from('import_batches')
    .select('id, status')
    .eq('file_hash', fileHash)
    .eq('created_by', args.createdBy)
    .maybeSingle()

  if (existingBatch) {
    console.log(`Already imported (batch: ${existingBatch.id}, status: ${existingBatch.status}). Skipping.`)
    process.exit(0)
  }

  // Parse Excel
  const { rows, warnings } = parseSalesOrdersExcel(buffer)
  warnings.forEach(w => console.warn('[WARN]', w))

  // Create import batch
  const { data: batch, error: batchErr } = await supabase
    .from('import_batches')
    .insert({
      created_by: args.createdBy,
      marketplace: 'tiktok',
      report_type: 'tiktok_sales_orders',
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

  // Compute hashes and prepare upsert rows
  const toUpsert = rows.map(row => {
    const hash = computeOrderLineHash(
      args.createdBy!,
      row.external_order_id,
      row.product_name,
      row.quantity,
      row.total_amount
    )
    return {
      order_id: row.external_order_id,
      marketplace: 'tiktok',
      channel: 'TikTok Shop',
      source_platform: 'tiktok_shop',
      external_order_id: row.external_order_id,
      product_name: row.product_name,
      sku: row.seller_sku ?? row.sku_id ?? null,
      seller_sku: row.seller_sku,
      sku_id: row.sku_id,
      quantity: row.quantity,
      unit_price: row.unit_price,
      total_amount: row.total_amount,
      platform_status: row.platform_status,
      order_date: row.order_date?.toISOString() ?? null,
      paid_at: row.paid_at?.toISOString() ?? null,
      shipped_at: row.shipped_at?.toISOString() ?? null,
      order_line_hash: hash,
      source: 'imported',
      import_batch_id: batchId,
      created_by: args.createdBy,
      metadata: {},
    }
  })

  let insertedCount = 0
  let updatedCount = 0
  let skippedCount = 0
  let errorCount = 0

  // Upsert in batches using order_line_hash for dedup (UNIQUE constraint: created_by, order_line_hash)
  for (let i = 0; i < toUpsert.length; i += BATCH_SIZE) {
    const chunk = toUpsert.slice(i, i + BATCH_SIZE)

    const { data, error } = await supabase
      .from('sales_orders')
      .upsert(chunk, { onConflict: 'order_line_hash', ignoreDuplicates: false })
      .select('id')

    if (error) {
      errorCount += chunk.length
      console.error(`[ERR] Batch ${i}-${i + chunk.length}: ${error.message}`)
    } else {
      insertedCount += data?.length ?? chunk.length
    }

    process.stdout.write(`\r  Progress: ${Math.min(i + BATCH_SIZE, toUpsert.length)}/${toUpsert.length}`)
  }
  process.stdout.write('\n')

  // Update batch status
  await supabase.from('import_batches').update({
    inserted_count: insertedCount,
    updated_count: updatedCount,
    skipped_count: skippedCount,
    error_count: errorCount,
    status: errorCount > 0 && insertedCount === 0 ? 'failed' : 'success',
    notes: errorCount > 0 ? `${errorCount} rows failed to import` : null,
  }).eq('id', batchId)

  if (errorCount > 0 && insertedCount === 0) {
    console.error('All rows failed to import')
    process.exit(1)
  }

  console.log(JSON.stringify({ success: true, batchId, rowCount: rows.length, insertedCount, updatedCount, skippedCount, errorCount }, null, 2))
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
