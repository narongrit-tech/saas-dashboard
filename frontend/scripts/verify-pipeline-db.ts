/**
 * verify-pipeline-db.ts
 *
 * Verifies that daily VDO stat files were actually imported into the database.
 * Run from frontend/:
 *
 *   npx tsx --env-file=.env.local scripts/verify-pipeline-db.ts
 *   npx tsx --env-file=.env.local scripts/verify-pipeline-db.ts --days 7
 *   npx tsx --env-file=.env.local scripts/verify-pipeline-db.ts --date 2026-04-19
 */

import { createServiceClient } from '../src/lib/supabase/service'

function parseArgs(argv: string[]) {
  const r: { days: number; date?: string } = { days: 5 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days' && argv[i + 1]) r.days = parseInt(argv[++i], 10)
    if (argv[i] === '--date' && argv[i + 1]) r.date = argv[++i]
  }
  return r
}

async function main() {
  const args    = parseArgs(process.argv.slice(2))
  const supabase = createServiceClient()

  // ── 1. Recent perf stat batches ────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════')
  console.log('  tiktok_video_perf_import_batches (recent)')
  console.log('═══════════════════════════════════════════════════')

  const { data: batches, error: batchErr } = await supabase
    .from('tiktok_video_perf_import_batches')
    .select('id, source_file_name, status, staged_row_count, invalid_row_count, created_at')
    .like('source_file_name', 'video-analysis_%')
    .order('created_at', { ascending: false })
    .limit(args.days + 2)

  if (batchErr) {
    console.error('Query error:', batchErr.message)
    process.exit(1)
  }

  if (!batches || batches.length === 0) {
    console.log('  No batches found.')
  } else {
    for (const b of batches) {
      const bkk = new Date(b.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
      const status = b.status === 'staged' ? '✅ staged' : `⚠️  ${b.status}`
      console.log(
        `  ${status.padEnd(14)} ${b.source_file_name.padEnd(40)} rows=${String(b.staged_row_count ?? 0).padStart(4)}  imported: ${bkk}`
      )
    }
  }

  // ── 2. Per-batch actual row count vs reported ──────────────────────────────
  if (batches && batches.length > 0) {
    console.log('\n  Actual row count vs reported:')
    for (const b of batches) {
      const { count, error: cErr } = await supabase
        .from('tiktok_video_perf_stats')
        .select('*', { count: 'exact', head: true })
        .eq('import_batch_id', b.id)

      if (cErr) { console.log(`  ${b.source_file_name}  ERROR: ${cErr.message}`); continue }
      const actual   = count ?? 0
      const reported = b.staged_row_count ?? 0
      const match    = actual === reported ? '✅' : '⚠️ MISMATCH'
      console.log(`  ${match} ${b.source_file_name}  actual=${actual}  reported=${reported}`)
    }
  }

  // ── 3. Specific date check ─────────────────────────────────────────────────
  if (args.date) {
    console.log(`\n  Checking specific date: ${args.date}`)
    const fname = `video-analysis_${args.date}.xlsx`
    const { data: specific } = await supabase
      .from('tiktok_video_perf_import_batches')
      .select('id, status, staged_row_count, created_at')
      .eq('source_file_name', fname)
      .order('created_at', { ascending: false })
      .limit(3)

    if (!specific || specific.length === 0) {
      console.log(`  ❌ NOT FOUND in DB — file ${fname} was never successfully imported`)
    } else {
      for (const r of specific) {
        const bkk = new Date(r.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
        console.log(`  ✅ Found  status=${r.status}  rows=${r.staged_row_count}  at ${bkk}`)
      }
    }
  }

  // ── 4. Latest successful run per stage (studio analytics) ─────────────────
  console.log('\n═══════════════════════════════════════════════════')
  console.log('  tiktok_studio_analytics_batches (latest 5)')
  console.log('═══════════════════════════════════════════════════')

  const { data: studioBatches, error: studErr } = await supabase
    .from('tiktok_studio_analytics_batches')
    .select('source_file_name, status, staged_row_count, created_at')
    .order('created_at', { ascending: false })
    .limit(5)

  if (studErr) {
    console.log('  Query error:', studErr.message)
  } else if (!studioBatches || studioBatches.length === 0) {
    console.log('  No studio analytics batches found.')
  } else {
    for (const b of studioBatches) {
      const bkk    = new Date(b.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
      const status = b.status === 'staged' ? '✅ staged' : `⚠️  ${b.status}`
      console.log(`  ${status.padEnd(14)} ${(b.source_file_name ?? '?').padEnd(50)} rows=${String(b.staged_row_count ?? 0).padStart(5)}  at ${bkk}`)
    }
  }

  // ── 5. video_master_v2 count ───────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════')
  console.log('  video_master_v2 summary')
  console.log('═══════════════════════════════════════════════════')

  const { count: vmTotal }       = await supabase.from('video_master_v2').select('*', { count: 'exact', head: true })
  const { count: vmWithStudio }  = await supabase.from('video_master_v2').select('*', { count: 'exact', head: true }).eq('has_studio_data' as any, true).not('last_studio_scraped_at', 'is', null)
  const { count: vmExcluded }    = await supabase.from('video_master_v2').select('*', { count: 'exact', head: true }).eq('is_excluded', true)

  console.log(`  total videos   : ${vmTotal ?? '?'}`)
  console.log(`  has studio data: ${vmWithStudio ?? '?'}`)
  console.log(`  excluded       : ${vmExcluded ?? '?'}`)

  console.log('\n  Done.\n')
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
