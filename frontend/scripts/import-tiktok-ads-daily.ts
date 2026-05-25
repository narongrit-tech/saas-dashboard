import path from 'node:path'
import fs from 'node:fs'
import { formatInTimeZone } from 'date-fns-tz'
import { parseAdsExcel, calculateFileHash } from '../src/lib/importers/tiktok-ads-daily'
import { createServiceClient } from '../src/lib/supabase/service'

const BANGKOK_TZ = 'Asia/Bangkok'
const BATCH_SIZE = 200

function printUsage(): void {
  console.log([
    'Usage:',
    '  npx tsx scripts/import-tiktok-ads-daily.ts --file "<path>" --created-by "<uuid>" [--type product|live]',
    '',
    'Flags:',
    '  --file        Path to TikTok Ads GMV Excel file (.xlsx)',
    '  --created-by  auth.users.id that owns this import',
    '  --type        product (GMV Max) or live (Live GMV). Auto-detected if omitted.',
  ].join('\n'))
}

function parseArgs(argv: string[]) {
  const result: { file?: string; createdBy?: string; type?: 'product' | 'live'; help: boolean } = { help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { result.help = true; continue }
    if (arg === '--file') { result.file = argv[++i]; continue }
    if (arg === '--created-by') { result.createdBy = argv[++i]; continue }
    if (arg === '--type') {
      const t = argv[++i]
      if (t === 'product' || t === 'live') result.type = t
    }
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

  // Parse Excel — type is auto-detected from sheet/column names if not passed
  const { keptRows: rows, warnings, totals } = parseAdsExcel(buffer, undefined, args.type)
  warnings.forEach(w => console.warn('[WARN]', w))

  console.log(`Parsed ${rows.length} rows | spend: ${totals.spend} | revenue: ${totals.revenue} | orders: ${totals.orders}`)

  // Create import batch
  const { data: batch, error: batchErr } = await supabase
    .from('import_batches')
    .insert({
      created_by: args.createdBy,
      marketplace: 'tiktok',
      report_type: 'tiktok_ads_daily',
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

  // Prepare rows for upsert
  const toUpsert = rows.map(row => ({
    marketplace: 'tiktok',
    ad_date: formatInTimeZone(row.ad_date, BANGKOK_TZ, 'yyyy-MM-dd'),
    campaign_type: row.campaign_type ?? 'product',
    campaign_name: row.campaign_name ?? '',
    campaign_id: row.campaign_id || null,
    video_id: row.video_id || null,
    spend: row.spend,
    orders: row.orders,
    revenue: row.revenue,
    roi: row.roi,
    source_row_hash: row.source_row_hash,
    import_batch_id: batchId,
    source: 'imported',
    created_by: args.createdBy,
  }))

  let insertedCount = 0
  let errorCount = 0
  const errors: string[] = []

  // Batch upsert using unique index: (created_by, source_row_hash)
  for (let i = 0; i < toUpsert.length; i += BATCH_SIZE) {
    const chunk = toUpsert.slice(i, i + BATCH_SIZE)

    const { data, error } = await supabase
      .from('ad_daily_performance')
      .upsert(chunk, { onConflict: 'created_by,source_row_hash', ignoreDuplicates: false })
      .select('id')

    if (error) {
      errorCount += chunk.length
      errors.push(`Batch ${i}-${i + chunk.length}: ${error.message}`)
      console.error(`[ERR] Batch failed: ${error.message}`)
    } else {
      insertedCount += data?.length ?? chunk.length
    }

    process.stdout.write(`\r  Progress: ${Math.min(i + BATCH_SIZE, toUpsert.length)}/${toUpsert.length}`)
  }
  process.stdout.write('\n')

  // Update batch status
  await supabase.from('import_batches').update({
    inserted_count: insertedCount,
    updated_count: 0,
    skipped_count: 0,
    error_count: errorCount,
    status: errorCount > 0 && insertedCount === 0 ? 'failed' : 'success',
    notes: errors.length > 0 ? errors.slice(0, 3).join('; ') : null,
  }).eq('id', batchId)

  if (errorCount > 0 && insertedCount === 0) {
    console.error('All batches failed')
    process.exit(1)
  }

  console.log(JSON.stringify({ success: true, batchId, rowCount: rows.length, insertedCount, errorCount }, null, 2))
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
