/**
 * Sync studio thumbnail registry → video_master + video_overview_cache
 *
 * Reads latest-by-post.json from the tiktok-content-registry output,
 * upserts thumbnail_url + thumbnail_source + post_url into video_master
 * for each post_id that exists in the canonical registry, then triggers
 * a selective rebuild of video_overview_cache for affected rows.
 *
 * Usage (from frontend/):
 *   npx tsx --env-file .env.local scripts/sync-thumbnails-from-registry.ts \
 *     --registry "D:/AI_OS/projects/tiktok-content-registry/data/studio-thumbnails/registry/latest-by-post.json" \
 *     --created-by "<auth_user_uuid>"
 *
 *   --dry-run   Preview counts without writing to DB
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

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const result: { registry?: string; createdBy?: string; dryRun: boolean; help: boolean } = {
    dryRun: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help': case '-h': result.help = true; break
      case '--registry':   result.registry  = argv[++i]; break
      case '--created-by': result.createdBy = argv[++i]; break
      case '--dry-run':    result.dryRun    = true; break
    }
  }
  return result
}

function usage() {
  console.log(`
Usage:
  npx tsx --env-file .env.local scripts/sync-thumbnails-from-registry.ts \\
    --registry <path-to-latest-by-post.json> \\
    --created-by <uuid>

Flags:
  --registry    Absolute path to latest-by-post.json from tiktok-content-registry
  --created-by  auth.users.id that owns the video records
  --dry-run     Preview counts without DB writes
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

  // Filter to entries with a usable thumbnail URL
  const withThumb = entries.filter((e) => e.thumbnail_url_raw && e.post_id)
  const withoutThumb = entries.length - withThumb.length
  console.log(`  → ${withThumb.length} with thumbnail_url_raw, ${withoutThumb} without`)

  if (args.dryRun) {
    console.log('\n[dry-run] No DB writes.')
    console.log(`Would upsert thumbnail_url for up to ${withThumb.length} post_ids`)
    return
  }

  const supabase = createServiceClient()
  let matched = 0
  let skipped = 0
  const affectedCanonicalIds: string[] = []

  // Process in batches of 200 to avoid large IN clauses
  const BATCH = 200
  for (let i = 0; i < withThumb.length; i += BATCH) {
    const chunk = withThumb.slice(i, i + BATCH)
    const postIds = chunk.map((e) => e.post_id)

    // Look up canonical IDs for this batch
    const { data: vmRows, error } = await supabase
      .from('video_master')
      .select('id, tiktok_video_id')
      .eq('created_by', args.createdBy)
      .in('tiktok_video_id', postIds)

    if (error) {
      console.error(`Batch ${i / BATCH + 1} lookup error: ${error.message}`)
      continue
    }

    const idMap = new Map((vmRows ?? []).map((r) => [r.tiktok_video_id as string, r.id as string]))
    skipped += postIds.length - idMap.size

    // Build upsert rows
    const updates = chunk
      .filter((e) => idMap.has(e.post_id))
      .map((e) => ({
        created_by: args.createdBy!,
        tiktok_video_id: e.post_id,
        thumbnail_url: e.thumbnail_url_raw ?? null,
        thumbnail_source: e.thumbnail_source ?? 'dom_url',
        // Also refresh post_url if available
        post_url: e.post_url ?? null,
      }))

    if (updates.length === 0) continue

    const { error: upsertError } = await supabase
      .from('video_master')
      .upsert(updates, { onConflict: 'created_by,tiktok_video_id', ignoreDuplicates: false })

    if (upsertError) {
      console.error(`Batch ${i / BATCH + 1} upsert error: ${upsertError.message}`)
      continue
    }

    for (const e of updates) {
      const canonId = idMap.get(e.tiktok_video_id)
      if (canonId) affectedCanonicalIds.push(canonId)
    }
    matched += updates.length

    const pct = Math.round(((i + chunk.length) / withThumb.length) * 100)
    process.stdout.write(`\r  upserted ${matched} / ${withThumb.length} (${pct}%)`)
  }

  console.log(`\n\nResults:`)
  console.log(`  ✓ Upserted thumbnail_url for ${matched} videos`)
  console.log(`  ↷ Skipped (not in video_master): ${skipped}`)

  if (affectedCanonicalIds.length > 0) {
    console.log(`\nRebuilding video_overview_cache for ${affectedCanonicalIds.length} affected rows...`)
    const deduped = [...new Set(affectedCanonicalIds)]
    // Rebuild in chunks of 500 to match the cache rebuild chunk size
    const REBUILD_CHUNK = 500
    for (let i = 0; i < deduped.length; i += REBUILD_CHUNK) {
      const chunk = deduped.slice(i, i + REBUILD_CHUNK)
      await rebuildVideoOverviewCache(supabase, args.createdBy!, chunk)
      process.stdout.write(`\r  rebuilt ${Math.min(i + REBUILD_CHUNK, deduped.length)} / ${deduped.length}`)
    }
    console.log('\n  ✓ Cache rebuild complete')
  }
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
