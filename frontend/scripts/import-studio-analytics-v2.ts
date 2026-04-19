/**
 * V2 Studio Analytics Importer
 *
 * Reads normalized analytics JSON files from the V2 scrape output and upserts
 * directly into video_master_v2 + video_source_mapping_v2 (bypasses V1 staging tables).
 *
 * After import, rebuilds video_overview_cache_v2 for all affected rows.
 *
 * V1 tables are NEVER touched by this script.
 *
 * Usage (from frontend/):
 *   npx tsx --env-file .env.local scripts/import-studio-analytics-v2.ts \
 *     --dir "D:/AI_OS/projects/tiktok-content-registry/data/v2/studio-analytics/normalized/snapshots" \
 *     --created-by "<uuid>" \
 *     [--dry-run] [--no-rebuild]
 *
 *   Single file:
 *   npx tsx --env-file .env.local scripts/import-studio-analytics-v2.ts \
 *     --file "D:/AI_OS/projects/tiktok-content-registry/data/v2/studio-analytics/normalized/snapshots/studio-analytics-XXXX.analytics-rows.json" \
 *     --created-by "<uuid>"
 */

import fs from 'node:fs'
import path from 'node:path'
import { createServiceClient } from '../src/lib/supabase/service'
import { parseStudioAnalyticsFile } from '../src/lib/content-ops/tiktok-studio-analytics-import'
import { upsertVideoMasterV2, upsertSourceMappingV2, rebuildVideoOverviewCacheV2 } from '../src/lib/content-ops/video-master-v2-sync'

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const result: {
    file?: string
    dir?: string
    createdBy?: string
    dryRun: boolean
    noRebuild: boolean
    help: boolean
  } = { dryRun: false, noRebuild: false, help: false }

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help': case '-h': result.help = true; break
      case '--file':       result.file      = argv[++i]; break
      case '--dir':        result.dir       = argv[++i]; break
      case '--created-by': result.createdBy = argv[++i]; break
      case '--dry-run':    result.dryRun    = true; break
      case '--no-rebuild': result.noRebuild = true; break
    }
  }
  return result
}

function usage() {
  console.log(`
V2 Studio Analytics Import — writes to video_master_v2 (V1 untouched)

Usage:
  npx tsx --env-file .env.local scripts/import-studio-analytics-v2.ts \\
    --dir  <path-to-v2-snapshots-dir> --created-by <uuid> [--dry-run]

  npx tsx --env-file .env.local scripts/import-studio-analytics-v2.ts \\
    --file <path-to-single-file.json> --created-by <uuid>

Flags:
  --dir         Path to V2 normalized snapshots dir (finds *.analytics-rows.json)
  --file        Path to single analytics-rows JSON file
  --created-by  auth.users.id UUID
  --dry-run     Parse and count only, no DB writes
  --no-rebuild  Skip video_overview_cache_v2 rebuild after import

Default V2 dir: D:/AI_OS/projects/tiktok-content-registry/data/v2/studio-analytics/normalized/snapshots
`)
}

// ─── File discovery ───────────────────────────────────────────────────────────

function findAnalyticsFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results.push(...findAnalyticsFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.analytics-rows.json')) results.push(full)
  }
  return results.sort()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || (!args.file && !args.dir) || !args.createdBy) {
    usage()
    process.exit(args.help ? 0 : 1)
  }

  const files: string[] = args.file
    ? [path.resolve(args.file)]
    : findAnalyticsFiles(path.resolve(args.dir!))

  if (files.length === 0) {
    console.error('No .analytics-rows.json files found.')
    process.exit(1)
  }

  console.log(`\n━━ V2 Studio Analytics Import ━━`)
  console.log(`  mode      : ${args.dryRun ? 'DRY RUN (no DB writes)' : 'LIVE → video_master_v2'}`)
  console.log(`  files     : ${files.length}`)
  console.log(`  created_by: ${args.createdBy}`)
  console.log(`  rebuild   : ${args.noRebuild ? 'skipped' : 'yes (video_overview_cache_v2)'}`)
  console.log('')

  if (args.dryRun) {
    let totalRows = 0
    let totalInvalid = 0
    for (const f of files) {
      const buf = fs.readFileSync(f)
      const parsed = parseStudioAnalyticsFile(buf)
      totalRows += parsed.rows.length
      totalInvalid += parsed.invalidRowCount
      console.log(`  ${path.basename(f)}: ${parsed.rows.length} rows, ${parsed.invalidRowCount} invalid`)
    }
    console.log(`\n  Total rows: ${totalRows}, invalid: ${totalInvalid}`)
    console.log(`  [dry-run] No DB writes.`)
    return
  }

  const supabase = createServiceClient()

  let totalUpserted = 0
  let totalSkipped = 0
  let totalErrors = 0
  const affectedCanonicalIds: string[] = []

  // ─── Per-file import ────────────────────────────────────────────────────────
  for (let fi = 0; fi < files.length; fi++) {
    const filePath = files[fi]
    const label = `[${fi + 1}/${files.length}] ${path.basename(filePath)}`
    const buf = fs.readFileSync(filePath)
    const parsed = parseStudioAnalyticsFile(buf)

    if (parsed.rows.length === 0) {
      console.log(`  ↷ skip (0 rows)  ${label}`)
      totalSkipped++
      continue
    }

    // Batch upsert to video_master_v2
    const BATCH = 100
    let fileUpserted = 0
    let fileErrors = 0

    for (let bi = 0; bi < parsed.rows.length; bi += BATCH) {
      const chunk = parsed.rows.slice(bi, bi + BATCH)

      for (const row of chunk) {
        if (!row.postId) { fileErrors++; continue }

        const canonId = await upsertVideoMasterV2(supabase, args.createdBy!, row.postId, {
          videoTitle: row.videoTitle,
          postedAt: row.postedAt,
          postUrl: row.postUrl,
          titleSource: 'studio_analytics',
          contentType: 'video',
        })

        if (!canonId) {
          fileErrors++
          continue
        }

        affectedCanonicalIds.push(canonId)
        fileUpserted++

        await upsertSourceMappingV2(
          supabase,
          args.createdBy!,
          'studio_analytics',
          row.postId,
          canonId,
          1,
          1.0,
          'matched',
          'v2:stage1:post_id=tiktok_video_id'
        )
      }
    }

    totalUpserted += fileUpserted
    totalErrors += fileErrors
    console.log(`  ✓ upserted=${fileUpserted} errors=${fileErrors} invalid=${parsed.invalidRowCount}  ${label}`)
  }

  // ─── Summary ────────────────────────────────────────────────────────────────
  console.log(`
━━ Import Summary ━━
  files processed : ${files.length}
  files skipped   : ${totalSkipped}
  rows upserted   : ${totalUpserted}
  rows errored    : ${totalErrors}
  affected IDs    : ${[...new Set(affectedCanonicalIds)].length} unique canonical IDs
`)

  // ─── Cache rebuild ───────────────────────────────────────────────────────────
  if (!args.noRebuild) {
    const deduped = [...new Set(affectedCanonicalIds)]
    if (deduped.length === 0) {
      console.log('No canonical IDs affected — cache not rebuilt.')
    } else {
      console.log(`Rebuilding video_overview_cache_v2 for ${deduped.length} rows...`)
      const REBUILD_CHUNK = 100
      let totalProcessed = 0
      let totalWithThumb = 0
      let totalWithStudio = 0
      const rebuildErrors: string[] = []

      for (let i = 0; i < deduped.length; i += REBUILD_CHUNK) {
        const chunk = deduped.slice(i, i + REBUILD_CHUNK)
        const s = await rebuildVideoOverviewCacheV2(supabase, args.createdBy!, chunk)
        totalProcessed += s.processed
        totalWithThumb += s.withThumbnail
        totalWithStudio += s.withStudioData
        rebuildErrors.push(...s.cacheErrors)
        process.stdout.write(`\r  rebuilt ${Math.min(i + REBUILD_CHUNK, deduped.length)} / ${deduped.length}`)
      }

      console.log(`\n\n━━ Cache Rebuild ━━`)
      console.log(`  rows written      : ${totalProcessed}`)
      console.log(`  with thumbnail    : ${totalWithThumb}`)
      console.log(`  with studio data  : ${totalWithStudio}`)
      console.log(`  rebuild errors    : ${rebuildErrors.length}`)
      if (rebuildErrors.length > 0) {
        for (const e of rebuildErrors.slice(0, 5)) console.log(`    ✗ ${e}`)
      }
    }
  }

  // ─── Final DB counts ─────────────────────────────────────────────────────────
  const { count: vm2Count } = await supabase
    .from('video_master_v2')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', args.createdBy!)

  const { count: voc2Count } = await supabase
    .from('video_overview_cache_v2')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', args.createdBy!)

  const { count: vm2WithThumb } = await supabase
    .from('video_master_v2')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', args.createdBy!)
    .not('thumbnail_url', 'is', null)

  console.log(`\n━━ V2 DB Counts ━━`)
  console.log(`  video_master_v2 total          : ${vm2Count ?? 0}`)
  console.log(`  video_master_v2 with thumbnail : ${vm2WithThumb ?? 0}`)
  console.log(`  video_overview_cache_v2 total  : ${voc2Count ?? 0}`)

  if (totalErrors > 0) process.exit(1)
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e)
  process.exit(1)
})
