/**
 * V1 vs V2 Comparison Report
 *
 * Queries both canonical video layers (V1 and V2) and prints a side-by-side
 * coverage report. Use this to validate V2 before cutover.
 *
 * Usage (from frontend/):
 *   npx tsx --env-file .env.local scripts/compare-v1-v2.ts --created-by "<uuid>"
 *
 *   With sample rows for missing/mismatch inspection:
 *   npx tsx --env-file .env.local scripts/compare-v1-v2.ts --created-by "<uuid>" --samples
 */

import { createServiceClient } from '../src/lib/supabase/service'

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const result: { createdBy?: string; samples: boolean; help: boolean } = { samples: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help': case '-h': result.help = true; break
      case '--created-by':      result.createdBy = argv[++i]; break
      case '--samples':         result.samples = true; break
    }
  }
  return result
}

function usage() {
  console.log(`
V1 vs V2 Comparison Report

Usage:
  npx tsx --env-file .env.local scripts/compare-v1-v2.ts --created-by <uuid> [--samples]

Flags:
  --created-by  auth.users.id UUID
  --samples     Show sample unmatched/missing rows
`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function count(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  createdBy: string,
  filter?: { col: string; op: 'not_null' | 'true' }
): Promise<number> {
  let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('created_by', createdBy)
  if (filter?.op === 'not_null') q = q.not(filter.col, 'is', null)
  if (filter?.op === 'true')     q = q.eq(filter.col, true)
  const { count: n } = await q
  return n ?? 0
}

function pct(num: number, denom: number): string {
  if (denom === 0) return '—'
  return `${Math.round((num / denom) * 100)}%`
}

function bar(v1: number, v2: number): string {
  const w = 8
  const b1 = Math.round((v1 / Math.max(v1, v2, 1)) * w)
  const b2 = Math.round((v2 / Math.max(v1, v2, 1)) * w)
  return `[${'█'.repeat(b1)}${' '.repeat(w - b1)}] [${'█'.repeat(b2)}${' '.repeat(w - b2)}]`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.createdBy) { usage(); process.exit(args.help ? 0 : 1) }

  const supabase = createServiceClient()
  const uid = args.createdBy

  console.log(`\n━━ V1 vs V2 Comparison ━━`)
  console.log(`  created_by: ${uid}`)
  console.log('')

  // ─── Canonical counts ──────────────────────────────────────────────────────
  const [vm1Total, vm2Total] = await Promise.all([
    count(supabase, 'video_master',    uid),
    count(supabase, 'video_master_v2', uid),
  ])

  const [vm1Thumb, vm2Thumb] = await Promise.all([
    count(supabase, 'video_master',    uid, { col: 'thumbnail_url', op: 'not_null' }),
    count(supabase, 'video_master_v2', uid, { col: 'thumbnail_url', op: 'not_null' }),
  ])

  const [vm1PostUrl, vm2PostUrl] = await Promise.all([
    count(supabase, 'video_master',    uid, { col: 'post_url', op: 'not_null' }),
    count(supabase, 'video_master_v2', uid, { col: 'post_url', op: 'not_null' }),
  ])

  // ─── Cache counts ──────────────────────────────────────────────────────────
  const [voc1Total, voc2Total] = await Promise.all([
    count(supabase, 'video_overview_cache',    uid),
    count(supabase, 'video_overview_cache_v2', uid),
  ])

  const [voc1Thumb, voc2Thumb] = await Promise.all([
    count(supabase, 'video_overview_cache',    uid, { col: 'thumbnail_url', op: 'not_null' }),
    count(supabase, 'video_overview_cache_v2', uid, { col: 'thumbnail_url', op: 'not_null' }),
  ])

  const [voc1Studio, voc2Studio] = await Promise.all([
    count(supabase, 'video_overview_cache',    uid, { col: 'has_studio_data', op: 'true' }),
    count(supabase, 'video_overview_cache_v2', uid, { col: 'has_studio_data', op: 'true' }),
  ])

  const [voc1Perf, voc2Perf] = await Promise.all([
    count(supabase, 'video_overview_cache',    uid, { col: 'has_perf_data', op: 'true' }),
    count(supabase, 'video_overview_cache_v2', uid, { col: 'has_perf_data', op: 'true' }),
  ])

  const [voc1Sales, voc2Sales] = await Promise.all([
    count(supabase, 'video_overview_cache',    uid, { col: 'has_sales_data', op: 'true' }),
    count(supabase, 'video_overview_cache_v2', uid, { col: 'has_sales_data', op: 'true' }),
  ])

  // ─── Source mapping counts ─────────────────────────────────────────────────
  const [vsm1Total, vsm2Total] = await Promise.all([
    count(supabase, 'video_source_mapping',    uid),
    count(supabase, 'video_source_mapping_v2', uid),
  ])

  // ─── Print report ──────────────────────────────────────────────────────────
  const COL = 38
  const pad = (s: string) => s.padEnd(COL)

  console.log(`${'Metric'.padEnd(COL)} ${'V1'.padStart(8)} ${'V2'.padStart(8)}  ${'V1 bar         V2 bar'}`)
  console.log('─'.repeat(COL + 8 + 8 + 24))

  const row = (label: string, v1: number, v2: number, v1Total?: number, v2Total?: number) => {
    const v1s = v1Total ? `${v1} (${pct(v1, v1Total)})` : String(v1)
    const v2s = v2Total ? `${v2} (${pct(v2, v2Total)})` : String(v2)
    console.log(`${pad(label)} ${v1s.padStart(8)} ${v2s.padStart(8)}  ${bar(v1, v2)}`)
  }

  row('video_master — total',          vm1Total,  vm2Total)
  row('video_master — with thumbnail', vm1Thumb,  vm2Thumb,  vm1Total, vm2Total)
  row('video_master — with post_url',  vm1PostUrl, vm2PostUrl, vm1Total, vm2Total)
  console.log('')
  row('video_overview_cache — total',  voc1Total, voc2Total)
  row('cache — with thumbnail',        voc1Thumb, voc2Thumb, voc1Total, voc2Total)
  row('cache — has_studio_data',       voc1Studio, voc2Studio, voc1Total, voc2Total)
  row('cache — has_perf_data',         voc1Perf, voc2Perf, voc1Total, voc2Total)
  row('cache — has_sales_data',        voc1Sales, voc2Sales, voc1Total, voc2Total)
  console.log('')
  row('video_source_mapping — total',  vsm1Total, vsm2Total)
  console.log('─'.repeat(COL + 8 + 8 + 24))

  // ─── V1-only and V2-only video IDs ────────────────────────────────────────
  console.log('\n━━ Video ID Overlap ━━')
  const { data: vm1Ids } = await supabase
    .from('video_master')
    .select('tiktok_video_id')
    .eq('created_by', uid)
  const { data: vm2Ids } = await supabase
    .from('video_master_v2')
    .select('tiktok_video_id')
    .eq('created_by', uid)

  const v1Set = new Set((vm1Ids ?? []).map((r) => r.tiktok_video_id as string))
  const v2Set = new Set((vm2Ids ?? []).map((r) => r.tiktok_video_id as string))
  const inBoth = [...v1Set].filter((id) => v2Set.has(id)).length
  const v1Only = [...v1Set].filter((id) => !v2Set.has(id))
  const v2Only = [...v2Set].filter((id) => !v1Set.has(id))

  console.log(`  In both V1 and V2 : ${inBoth}`)
  console.log(`  V1-only (missing from V2): ${v1Only.length}`)
  console.log(`  V2-only (new in V2):       ${v2Only.length}`)

  if (args.samples) {
    if (v1Only.length > 0) {
      console.log(`\n  Sample V1-only IDs (first 10):`)
      for (const id of v1Only.slice(0, 10)) console.log(`    ${id}`)
    }
    if (v2Only.length > 0) {
      console.log(`\n  Sample V2-only IDs (first 10):`)
      for (const id of v2Only.slice(0, 10)) console.log(`    ${id}`)
    }
  }

  // ─── Assessment ────────────────────────────────────────────────────────────
  console.log('\n━━ Assessment ━━')
  const thumbGap = vm2Thumb - vm1Thumb
  const studioGap = voc2Studio - voc1Studio
  if (vm2Total >= vm1Total) {
    console.log(`  ✓ V2 has equal or more videos (${vm2Total} vs ${vm1Total})`)
  } else {
    console.log(`  ✗ V2 has FEWER videos (${vm2Total} vs ${vm1Total}) — scrape may be incomplete`)
  }
  if (thumbGap >= 0) {
    console.log(`  ✓ V2 thumbnail coverage equal or better (+${thumbGap} rows)`)
  } else {
    console.log(`  ! V2 thumbnail coverage lower (${thumbGap} rows) — sync thumbnails first`)
  }
  if (vm2Total > 0 && voc2Total === 0) {
    console.log(`  ! video_overview_cache_v2 is empty — run rebuild after import`)
  } else if (voc2Total > 0) {
    console.log(`  ✓ video_overview_cache_v2 has ${voc2Total} rows`)
  }
  if (studioGap < 0) {
    console.log(`  ! V2 has fewer studio data rows — V1 analytics import may not have run yet for V2`)
  }
  console.log('')
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e)
  process.exit(1)
})
