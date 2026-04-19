/**
 * Sync studio thumbnail registry → video_master + video_overview_cache
 *
 * Derives tiktok_video_id from post_url (robust — avoids relying on post_id field),
 * upserts thumbnail_url into video_master, then rebuilds video_overview_cache.
 *
 * Pass 1 (always): update thumbnail_url for videos already in video_master
 * Pass 2 (--insert-missing): insert new video_master rows for registry entries
 *   that have no matching row yet — covers videos never imported via analytics pipeline
 *
 * Usage (from frontend/):
 *   npx tsx --env-file .env.local scripts/sync-thumbnails-from-registry.ts \
 *     --registry "D:/AI_OS/projects/tiktok-content-registry/data/studio-thumbnails/registry/latest-by-post.json" \
 *     --created-by "<uuid>" \
 *     [--insert-missing] [--dry-run]
 */

import fs from 'node:fs'
import path from 'node:path'
import { createServiceClient } from '../src/lib/supabase/service'
import { rebuildVideoOverviewCache } from '../src/lib/content-ops/video-master-sync'

// ─── Registry entry type ─────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract numeric TikTok video ID from any post URL format */
function extractVideoId(postUrl: string): string | null {
  const m = postUrl?.match(/\/video\/(\d+)/)
  return m ? m[1] : null
}

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const result: {
    registry?: string
    createdBy?: string
    dryRun: boolean
    insertMissing: boolean
    help: boolean
  } = { dryRun: false, insertMissing: false, help: false }

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help': case '-h': result.help = true; break
      case '--registry':       result.registry      = argv[++i]; break
      case '--created-by':     result.createdBy     = argv[++i]; break
      case '--dry-run':        result.dryRun        = true; break
      case '--insert-missing': result.insertMissing = true; break
    }
  }
  return result
}

function usage() {
  console.log(`
Usage:
  npx tsx --env-file .env.local scripts/sync-thumbnails-from-registry.ts \\
    --registry <path-to-latest-by-post.json> \\
    --created-by <uuid> \\
    [--insert-missing] [--dry-run]

Flags:
  --registry        Path to latest-by-post.json from tiktok-content-registry
  --created-by      auth.users.id that owns the video records
  --insert-missing  INSERT new video_master rows for registry entries not yet in DB
  --dry-run         Preview counts without DB writes
`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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
  console.log(`Loaded ${entries.length} entries from registry`)

  // Derive video ID from post_url (primary) with post_id as fallback
  const enriched: EnrichedEntry[] = []
  let noId = 0
  for (const e of entries) {
    if (!e.thumbnail_url_raw) continue
    const id = extractVideoId(e.post_url) ?? (e.post_id?.match(/^\d+$/) ? e.post_id : null)
    if (!id) { noId++; continue }
    enriched.push({ ...e, derivedVideoId: id })
  }
  console.log(`  → ${enriched.length} with valid video ID + thumbnail`)
  if (noId > 0) console.log(`  ! ${noId} entries skipped (no parseable video ID)`)

  // Check for ID discrepancy between post_id and URL-derived
  const idMismatch = enriched.filter(e => e.post_id && e.derivedVideoId !== e.post_id)
  if (idMismatch.length > 0) {
    console.log(`\n  ⚠ ${idMismatch.length} entries where post_id ≠ URL-derived ID:`)
    for (const e of idMismatch.slice(0, 5)) {
      console.log(`    post_id=${e.post_id}  url-id=${e.derivedVideoId}  url=${e.post_url}`)
    }
  } else {
    console.log(`  ✓ All post_id values match URL-derived IDs`)
  }

  if (args.dryRun) {
    console.log('\n[dry-run] No DB writes.')
    console.log(`Would process ${enriched.length} entries`)
    return
  }

  const supabase = createServiceClient()
  const affectedCanonicalIds: string[] = []
  let updatedCount = 0
  let insertedCount = 0
  let errorCount = 0
  const unmatchedEntries: EnrichedEntry[] = []

  // ─── Pass 1: update existing video_master rows ────────────────────────────

  const BATCH = 200
  console.log(`\nPass 1: updating existing video_master rows (${enriched.length} entries)...`)

  for (let i = 0; i < enriched.length; i += BATCH) {
    const chunk = enriched.slice(i, i + BATCH)
    const videoIds = chunk.map((e) => e.derivedVideoId)

    const { data: vmRows, error: lookupErr } = await supabase
      .from('video_master')
      .select('id, tiktok_video_id')
      .eq('created_by', args.createdBy)
      .in('tiktok_video_id', videoIds)

    if (lookupErr) {
      console.error(`  Batch ${Math.floor(i / BATCH) + 1} lookup error: ${lookupErr.message}`)
      errorCount += chunk.length
      continue
    }

    const idMap = new Map((vmRows ?? []).map((r) => [r.tiktok_video_id as string, r.id as string]))

    // Collect unmatched for pass 2
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
      .from('video_master')
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

    const pct = Math.round(((i + chunk.length) / enriched.length) * 100)
    process.stdout.write(`\r  updated ${updatedCount} (${pct}%)`)
  }

  console.log(`\n  ✓ Pass 1 done: ${updatedCount} updated, ${unmatchedEntries.length} unmatched`)

  // ─── Log unmatched ────────────────────────────────────────────────────────

  console.log(`\nUnmatched registry entries (not in video_master): ${unmatchedEntries.length}`)
  if (unmatchedEntries.length > 0) {
    console.log('  Sample unmatched video IDs (first 10):')
    for (const e of unmatchedEntries.slice(0, 10)) {
      console.log(`    ${e.derivedVideoId}  ${e.post_url}`)
    }
  }

  // ─── Pass 2: insert missing ───────────────────────────────────────────────

  if (args.insertMissing && unmatchedEntries.length > 0) {
    console.log(`\nPass 2: inserting ${unmatchedEntries.length} missing rows into video_master...`)

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
        title_source: 'studio_thumbnails' as const,
      }))

      const { data: inserted, error: insertErr } = await supabase
        .from('video_master')
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

      const pct = Math.round(((i + chunk.length) / unmatchedEntries.length) * 100)
      process.stdout.write(`\r  inserted ${insertedCount} (${pct}%)`)
    }

    console.log(`\n  ✓ Pass 2 done: ${insertedCount} inserted`)
  } else if (!args.insertMissing && unmatchedEntries.length > 0) {
    console.log(`  ℹ Re-run with --insert-missing to add these to video_master`)
  }

  // ─── Summary ─────────────────────────────────────────────────────────────

  const totalAffected = updatedCount + insertedCount
  console.log(`\n━━ Results ━━`)
  console.log(`  Updated (existing rows):  ${updatedCount}`)
  console.log(`  Inserted (new rows):      ${insertedCount}`)
  console.log(`  Unmatched (not handled):  ${unmatchedEntries.length - insertedCount}`)
  console.log(`  Errors:                   ${errorCount}`)
  console.log(`  Coverage: ${totalAffected}/${enriched.length} registry entries now have thumbnails in video_master`)

  // ─── Cache rebuild ────────────────────────────────────────────────────────

  if (affectedCanonicalIds.length > 0) {
    console.log(`\nRebuilding video_overview_cache for ${affectedCanonicalIds.length} affected rows...`)
    const deduped = [...new Set(affectedCanonicalIds)]
    const REBUILD_CHUNK = 500
    for (let i = 0; i < deduped.length; i += REBUILD_CHUNK) {
      const chunk = deduped.slice(i, i + REBUILD_CHUNK)
      await rebuildVideoOverviewCache(supabase, args.createdBy!, chunk)
      process.stdout.write(`\r  rebuilt ${Math.min(i + REBUILD_CHUNK, deduped.length)} / ${deduped.length}`)
    }
    console.log('\n  ✓ Cache rebuild complete')
  } else {
    console.log('\n  ! No rows affected — cache not rebuilt')
  }
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
