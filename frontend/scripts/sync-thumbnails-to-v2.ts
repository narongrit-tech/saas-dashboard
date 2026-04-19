/**
 * Sync V2 thumbnail registry → video_master_v2 + video_overview_cache_v2
 *
 * Reads latest-by-post.json from the V2 thumbnail scrape output.
 * Derives tiktok_video_id from post_url (robust, avoids post_id field).
 *
 * Pass 1: upsert thumbnail_url for V2 rows already in video_master_v2
 * Pass 2 (always on by default for V2): insert new video_master_v2 rows for
 *         registry entries not yet imported via analytics pipeline
 *
 * V1 tables are NEVER touched by this script.
 *
 * Usage (from frontend/):
 *   npx tsx --env-file .env.local scripts/sync-thumbnails-to-v2.ts \
 *     --registry "D:/AI_OS/projects/tiktok-content-registry/data/v2/studio-thumbnails/registry/latest-by-post.json" \
 *     --created-by "<uuid>" \
 *     [--dry-run] [--no-rebuild] [--skip-insert-missing]
 */

import fs from 'node:fs'
import path from 'node:path'
import { createServiceClient } from '../src/lib/supabase/service'
import { rebuildVideoOverviewCacheV2 } from '../src/lib/content-ops/video-master-v2-sync'

// ─── Types ─────────────────────────────────────────────────────────────────────

type ThumbnailEntry = {
  snapshot_id: string
  post_id: string
  post_url: string
  title?: string | null
  caption?: string | null
  thumbnail_url_raw?: string | null
  thumbnail_local_path?: string | null
  thumbnail_source?: string | null
  scraped_at: string
}

type EnrichedEntry = ThumbnailEntry & { derivedVideoId: string }

// ─── Helpers ───────────────────────────────────────────────────────────────────

function extractVideoId(postUrl: string): string | null {
  const m = postUrl?.match(/\/video\/(\d+)/)
  return m ? m[1] : null
}

// ─── Args ──────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const result: {
    registry?: string
    createdBy?: string
    dryRun: boolean
    skipInsertMissing: boolean
    noRebuild: boolean
    verify: boolean
    help: boolean
  } = { dryRun: false, skipInsertMissing: false, noRebuild: false, verify: false, help: false }

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help': case '-h':      result.help             = true; break
      case '--registry':             result.registry         = argv[++i]; break
      case '--created-by':           result.createdBy        = argv[++i]; break
      case '--dry-run':              result.dryRun           = true; break
      case '--skip-insert-missing':  result.skipInsertMissing = true; break
      case '--no-rebuild':           result.noRebuild        = true; break
      case '--verify':               result.verify           = true; break
    }
  }
  return result
}

function usage() {
  console.log(`
V2 Thumbnail Sync — writes to video_master_v2 (V1 untouched)

Usage:
  npx tsx --env-file .env.local scripts/sync-thumbnails-to-v2.ts \\
    --registry <path-to-latest-by-post.json> \\
    --created-by <uuid> \\
    [--dry-run] [--no-rebuild] [--skip-insert-missing] [--verify]

Flags:
  --registry             Path to V2 latest-by-post.json
  --created-by           auth.users.id UUID
  --dry-run              Preview counts, no DB writes
  --skip-insert-missing  Do NOT insert new rows for thumbnails not yet in video_master_v2
  --no-rebuild           Skip cache rebuild after sync
  --verify               Show top 5 rows by views after rebuild

Default V2 registry:
  D:/AI_OS/projects/tiktok-content-registry/data/v2/studio-thumbnails/registry/latest-by-post.json
`)
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || !args.registry || !args.createdBy) {
    usage()
    process.exit(args.help ? 0 : 1)
  }

  const registryPath = path.resolve(args.registry)
  if (!fs.existsSync(registryPath)) {
    console.error(`Registry file not found: ${registryPath}`)
    process.exit(1)
  }

  const raw = fs.readFileSync(registryPath, 'utf-8')
  const entries: ThumbnailEntry[] = JSON.parse(raw)
  console.log(`\nLoaded ${entries.length} entries from V2 thumbnail registry`)

  // Derive video ID from post_url
  const enriched: EnrichedEntry[] = []
  let noId = 0
  let noThumb = 0
  for (const e of entries) {
    if (!e.thumbnail_url_raw) { noThumb++; continue }
    const id = extractVideoId(e.post_url) ?? (e.post_id?.match(/^\d+$/) ? e.post_id : null)
    if (!id) { noId++; continue }
    enriched.push({ ...e, derivedVideoId: id })
  }
  console.log(`  → ${enriched.length} with valid video ID + thumbnail`)
  if (noThumb > 0) console.log(`  ! ${noThumb} entries skipped (no thumbnail_url_raw)`)
  if (noId > 0)   console.log(`  ! ${noId} entries skipped (no parseable video ID)`)

  if (args.dryRun) {
    console.log('\n[dry-run] No DB writes.')
    console.log(`Would process ${enriched.length} entries`)
    return
  }

  const supabase = createServiceClient()
  const BATCH = 200
  let updatedCount = 0
  let insertedCount = 0
  let errorCount = 0
  const affectedCanonicalIds: string[] = []
  const unmatchedEntries: EnrichedEntry[] = []

  // ─── Before counts ──────────────────────────────────────────────────────────
  const { count: vm2Before } = await supabase
    .from('video_master_v2')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', args.createdBy)
    .not('thumbnail_url', 'is', null)

  const { count: voc2Before } = await supabase
    .from('video_overview_cache_v2')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', args.createdBy)
    .not('thumbnail_url', 'is', null)

  // ─── Pass 1: update existing V2 rows ────────────────────────────────────────
  console.log(`\nPass 1: updating existing video_master_v2 rows (${enriched.length} entries)...`)

  for (let i = 0; i < enriched.length; i += BATCH) {
    const chunk = enriched.slice(i, i + BATCH)
    const videoIds = chunk.map((e) => e.derivedVideoId)

    const { data: vmRows, error: lookupErr } = await supabase
      .from('video_master_v2')
      .select('id, tiktok_video_id')
      .eq('created_by', args.createdBy)
      .in('tiktok_video_id', videoIds)

    if (lookupErr) {
      console.error(`  Batch ${Math.floor(i / BATCH) + 1} lookup error: ${lookupErr.message}`)
      errorCount += chunk.length
      continue
    }

    const idMap = new Map((vmRows ?? []).map((r) => [r.tiktok_video_id as string, r.id as string]))

    for (const e of chunk) {
      if (!idMap.has(e.derivedVideoId)) unmatchedEntries.push(e)
    }

    const updates = chunk
      .filter((e) => idMap.has(e.derivedVideoId))
      .map((e) => ({
        created_by: args.createdBy!,
        tiktok_video_id: e.derivedVideoId,
        thumbnail_url: e.thumbnail_url_raw!,
        thumbnail_source: e.thumbnail_source ?? 'dom_url',
        post_url: e.post_url ?? null,
      }))

    if (updates.length === 0) continue

    const { error: upsertErr } = await supabase
      .from('video_master_v2')
      .upsert(updates, { onConflict: 'created_by,tiktok_video_id', ignoreDuplicates: false })

    if (upsertErr) {
      console.error(`  Batch ${Math.floor(i / BATCH) + 1} upsert error: ${upsertErr.message}`)
      errorCount += updates.length
      continue
    }

    for (const e of updates) {
      const canonId = idMap.get(e.tiktok_video_id)
      if (canonId) affectedCanonicalIds.push(canonId)
    }
    updatedCount += updates.length
    process.stdout.write(`\r  updated ${updatedCount} (${Math.round(((i + chunk.length) / enriched.length) * 100)}%)`)
  }

  console.log(`\n  ✓ Pass 1: ${updatedCount} updated, ${unmatchedEntries.length} unmatched`)

  // ─── Pass 2: insert missing (default ON for V2) ──────────────────────────────
  if (!args.skipInsertMissing && unmatchedEntries.length > 0) {
    console.log(`\nPass 2: inserting ${unmatchedEntries.length} missing rows into video_master_v2...`)

    for (let i = 0; i < unmatchedEntries.length; i += BATCH) {
      const chunk = unmatchedEntries.slice(i, i + BATCH)

      const inserts = chunk.map((e) => ({
        created_by: args.createdBy!,
        tiktok_video_id: e.derivedVideoId,
        thumbnail_url: e.thumbnail_url_raw!,
        thumbnail_source: e.thumbnail_source ?? 'dom_url',
        post_url: e.post_url ?? null,
        video_title: e.title ?? null,
        content_type: 'video' as const,
        title_source: 'studio_thumbnails',
      }))

      const { data: inserted, error: insertErr } = await supabase
        .from('video_master_v2')
        .upsert(inserts, { onConflict: 'created_by,tiktok_video_id', ignoreDuplicates: false })
        .select('id')

      if (insertErr) {
        console.error(`  Insert batch error: ${insertErr.message}`)
        errorCount += chunk.length
        continue
      }

      const newIds = (inserted ?? []).map((r) => r.id as string)
      affectedCanonicalIds.push(...newIds)
      insertedCount += newIds.length
      process.stdout.write(`\r  inserted ${insertedCount} (${Math.round(((i + chunk.length) / unmatchedEntries.length) * 100)}%)`)
    }
    console.log(`\n  ✓ Pass 2: ${insertedCount} inserted`)
  } else if (args.skipInsertMissing && unmatchedEntries.length > 0) {
    console.log(`  ℹ ${unmatchedEntries.length} unmatched — skipped (--skip-insert-missing)`)
  }

  // ─── Summary ────────────────────────────────────────────────────────────────
  const totalAffected = updatedCount + insertedCount
  console.log(`\n━━ Write Results ━━`)
  console.log(`  Updated (existing rows):  ${updatedCount}`)
  console.log(`  Inserted (new rows):      ${insertedCount}`)
  console.log(`  Unmatched (not handled):  ${unmatchedEntries.length - insertedCount}`)
  console.log(`  Errors:                   ${errorCount}`)
  console.log(`  Coverage: ${totalAffected}/${enriched.length} registry entries in video_master_v2`)

  // ─── Cache rebuild ───────────────────────────────────────────────────────────
  if (!args.noRebuild && affectedCanonicalIds.length > 0) {
    const deduped = [...new Set(affectedCanonicalIds)]
    console.log(`\nRebuilding video_overview_cache_v2 for ${deduped.length} rows...`)
    const REBUILD_CHUNK = 100
    let rebuildProcessed = 0
    let rebuildWithThumb = 0
    let rebuildWithStudio = 0
    const rebuildErrors: string[] = []

    for (let i = 0; i < deduped.length; i += REBUILD_CHUNK) {
      const chunk = deduped.slice(i, i + REBUILD_CHUNK)
      const s = await rebuildVideoOverviewCacheV2(supabase, args.createdBy!, chunk)
      rebuildProcessed += s.processed
      rebuildWithThumb += s.withThumbnail
      rebuildWithStudio += s.withStudioData
      rebuildErrors.push(...s.cacheErrors)
      process.stdout.write(`\r  rebuilt ${Math.min(i + REBUILD_CHUNK, deduped.length)} / ${deduped.length}`)
    }

    console.log(`\n  ✓ Cache rebuild: ${rebuildProcessed} rows, ${rebuildWithThumb} with thumbnail, ${rebuildWithStudio} with studio data`)
    if (rebuildErrors.length > 0) {
      console.log(`  ✗ Errors (${rebuildErrors.length}):`)
      for (const e of rebuildErrors.slice(0, 5)) console.log(`    ${e}`)
    }
  }

  // ─── After counts ────────────────────────────────────────────────────────────
  const { count: vm2After } = await supabase
    .from('video_master_v2')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', args.createdBy)
    .not('thumbnail_url', 'is', null)

  const { count: voc2After } = await supabase
    .from('video_overview_cache_v2')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', args.createdBy)
    .not('thumbnail_url', 'is', null)

  console.log(`\n━━ Before → After Counts ━━`)
  console.log(`  video_master_v2 WITH thumbnail_url:         ${vm2Before ?? 0} → ${vm2After ?? 0}`)
  console.log(`  video_overview_cache_v2 WITH thumbnail_url: ${voc2Before ?? 0} → ${voc2After ?? 0}`)

  // ─── Verify ──────────────────────────────────────────────────────────────────
  if (args.verify) {
    console.log(`\n━━ Top 5 rows by views (video_overview_cache_v2) ━━`)
    const { data: topRows, error: topErr } = await supabase
      .from('video_overview_cache_v2')
      .select('tiktok_video_id, video_title, thumbnail_url, post_url, headline_video_views')
      .eq('created_by', args.createdBy)
      .order('headline_video_views', { ascending: false, nullsFirst: false })
      .limit(5)
    if (topErr) {
      console.log(`  Error: ${topErr.message}`)
    } else {
      for (const r of topRows ?? []) {
        const thumb = (r as { thumbnail_url?: string | null }).thumbnail_url
        const views = (r as { headline_video_views?: number | null }).headline_video_views
        const title = ((r as { video_title?: string | null }).video_title ?? '').slice(0, 40)
        const id = (r as { tiktok_video_id: string }).tiktok_video_id
        console.log(`  ${id} | views: ${views ?? '—'} | thumb: ${thumb ? '✓' : 'NULL'} | ${title}`)
      }
    }
  }
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e)
  process.exit(1)
})
