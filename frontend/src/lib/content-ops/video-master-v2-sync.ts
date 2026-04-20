/**
 * Video Master V2 Sync — Isolated rebuild path alongside V1
 *
 * Targets V2 tables only: video_master_v2, video_source_mapping_v2, video_overview_cache_v2
 * V1 tables are NEVER read or written.
 *
 * Studio analytics metrics are stored directly in video_master_v2 (latest_views, etc.)
 * and read back during cache rebuild — no V1 staging table join needed.
 *
 * Usage:
 *   - import-studio-analytics-v2.ts → calls upsertVideoMasterV2 + upsertSourceMappingV2
 *   - sync-thumbnails-to-v2.ts      → calls upsertVideoMasterV2 + rebuildVideoOverviewCacheV2
 *   - compare-v1-v2.ts              → queries V2 tables for comparison
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type RebuildStatsV2 = {
  processed: number
  withThumbnail: number
  withStudioData: number
  cacheErrors: string[]
}

export type UpsertV2Meta = {
  videoTitle?: string | null
  postedAt?: string | null
  durationSec?: number | null
  postUrl?: string | null
  thumbnailUrl?: string | null
  thumbnailSource?: string | null
  titleSource: string
  contentType?: 'video' | 'live' | 'showcase' | 'unknown'
}

const CHUNK = 100

// ─── upsertVideoMasterV2 ──────────────────────────────────────────────────────

export async function upsertVideoMasterV2(
  supabase: SupabaseClient,
  createdBy: string,
  tiktokVideoId: string,
  meta: UpsertV2Meta
): Promise<string | null> {
  const { data, error } = await supabase
    .from('video_master_v2')
    .upsert(
      {
        created_by: createdBy,
        tiktok_video_id: tiktokVideoId,
        content_type: meta.contentType ?? 'video',
        video_title: meta.videoTitle ?? null,
        posted_at: meta.postedAt ?? null,
        duration_sec: meta.durationSec ?? null,
        post_url: meta.postUrl ?? null,
        thumbnail_url: meta.thumbnailUrl ?? null,
        thumbnail_source: meta.thumbnailSource ?? null,
        title_source: meta.titleSource,
      },
      { onConflict: 'created_by,tiktok_video_id', ignoreDuplicates: false }
    )
    .select('id')
    .single()

  if (error || !data) {
    console.error('[upsertVideoMasterV2] error:', error?.message, 'videoId:', tiktokVideoId)
    return null
  }
  return data.id as string
}

// ─── upsertSourceMappingV2 ────────────────────────────────────────────────────

export async function upsertSourceMappingV2(
  supabase: SupabaseClient,
  createdBy: string,
  sourceType: 'studio_analytics' | 'perf_stats' | 'affiliate',
  externalId: string,
  canonicalId: string | null,
  matchStage: number | null,
  confidenceScore: number | null,
  matchStatus: 'matched' | 'unmatched' | 'needs_review' | 'conflict',
  matchReason: string
): Promise<void> {
  const { error } = await supabase
    .from('video_source_mapping_v2')
    .upsert(
      {
        created_by: createdBy,
        source_type: sourceType,
        external_id: externalId,
        canonical_id: canonicalId,
        match_stage: matchStage,
        confidence_score: confidenceScore,
        match_status: matchStatus,
        match_reason: matchReason,
        latest_source_table: 'tiktok_studio_analytics_rows',
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'created_by,source_type,external_id', ignoreDuplicates: false }
    )

  if (error) {
    console.error('[upsertSourceMappingV2] error:', error.message, 'externalId:', externalId)
  }
}

// ─── rebuildVideoOverviewCacheV2 ──────────────────────────────────────────────

export async function rebuildVideoOverviewCacheV2(
  supabase: SupabaseClient,
  createdBy: string,
  canonicalIds?: string[]
): Promise<RebuildStatsV2> {
  const stats: RebuildStatsV2 = { processed: 0, withThumbnail: 0, withStudioData: 0, cacheErrors: [] }

  // 1. Fetch V2 canonical rows (with retry for large IN clauses)
  let vmQuery = supabase
    .from('video_master_v2')
    .select('id, tiktok_video_id, video_title, posted_at, duration_sec, post_url, content_type, thumbnail_url, thumbnail_source, latest_views, latest_likes, latest_comments, latest_shares, latest_watch_full_rate, latest_avg_watch_time_seconds, latest_new_followers, last_studio_scraped_at')
    .eq('created_by', createdBy)
  if (canonicalIds && canonicalIds.length > 0) {
    vmQuery = vmQuery.in('id', canonicalIds)
  }

  type VmRow = {
    id: string
    tiktok_video_id: string
    video_title: string | null
    posted_at: string | null
    duration_sec: number | null
    post_url: string | null
    content_type: string
    thumbnail_url?: string | null
    thumbnail_source?: string | null
    latest_views?: number | null
    latest_likes?: number | null
    latest_comments?: number | null
    latest_shares?: number | null
    latest_watch_full_rate?: number | null
    latest_avg_watch_time_seconds?: number | null
    latest_new_followers?: number | null
    last_studio_scraped_at?: string | null
  }

  let videos: VmRow[] | null = null
  let vmErrMsg: string | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await vmQuery as { data: VmRow[] | null; error: { message: string; code: string } | null }
    if (!res.error) { videos = res.data; break }
    vmErrMsg = `${res.error.message} (code: ${res.error.code})`
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 500))
  }
  if (vmErrMsg && !videos) {
    const msg = `video_master_v2 query failed after retries: ${vmErrMsg}`
    console.error('[rebuildVideoOverviewCacheV2]', msg)
    stats.cacheErrors.push(msg)
    return stats
  }
  if (!videos || videos.length === 0) return stats

  const withThumb = videos.filter((v) => (v as VmRow).thumbnail_url).length
  console.log(`[rebuildVideoOverviewCacheV2] video_master_v2: ${videos.length} rows, ${withThumb} with thumbnail_url`)

  const allCanonicalIds = videos.map((v) => v.id)
  const canonicalToMeta = new Map(videos.map((v) => [v.id, v]))

  // 2. Process in CHUNK-sized batches to avoid URL-limit errors
  for (let i = 0; i < allCanonicalIds.length; i += CHUNK) {
    const chunkCanonical = allCanonicalIds.slice(i, i + CHUNK)
    const chunkVideoIds = videos.slice(i, i + CHUNK).map((v) => v.tiktok_video_id)

    // Perf stats — reuse V1 staging table
    const { data: perfRows } = await supabase
      .from('tiktok_video_perf_stats')
      .select('video_id_raw, created_at, views, gmv_total, gmv_direct, units_sold, ctr, watch_full_rate')
      .eq('created_by', createdBy)
      .in('video_id_raw', chunkVideoIds)
      .order('created_at', { ascending: false })

    const latestPerf = new Map<string, typeof perfRows extends (infer T)[] | null ? T : never>()
    for (const r of perfRows ?? []) {
      if (!latestPerf.has(r.video_id_raw)) latestPerf.set(r.video_id_raw, r)
    }

    // Affiliate mappings — V2 mapping table
    const { data: mappings } = await supabase
      .from('video_source_mapping_v2')
      .select('canonical_id, external_id')
      .eq('created_by', createdBy)
      .eq('source_type', 'affiliate')
      .eq('match_status', 'matched')
      .in('canonical_id', chunkCanonical)

    const canonicalToContentIds = new Map<string, string[]>()
    for (const m of mappings ?? []) {
      const cid = m.canonical_id as string
      const arr = canonicalToContentIds.get(cid) ?? []
      arr.push(m.external_id as string)
      canonicalToContentIds.set(cid, arr)
    }

    // Sales aggregates — reuse V1 content_order_facts
    const allContentIds = [...new Set((mappings ?? []).map((m) => m.external_id as string))]
    const salesByCanonical = new Map<string, {
      gmv: number; commission: number; settledOrders: Set<string>; allOrders: Set<string>; products: Set<string>
    }>()

    if (allContentIds.length > 0) {
      const { data: orderRows } = await supabase
        .from('content_order_facts')
        .select('content_id, gmv, total_commission_amount, order_settlement_status, product_id, order_id')
        .eq('created_by', createdBy)
        .in('content_id', allContentIds)

      const contentToCanonical = new Map<string, string>()
      for (const [canonId, contentIds] of canonicalToContentIds.entries()) {
        for (const cid of contentIds) contentToCanonical.set(cid, canonId)
      }

      for (const row of orderRows ?? []) {
        const canonId = contentToCanonical.get(row.content_id as string)
        if (!canonId) continue
        const agg = salesByCanonical.get(canonId) ?? {
          gmv: 0, commission: 0,
          settledOrders: new Set<string>(), allOrders: new Set<string>(), products: new Set<string>()
        }
        const isSettled = row.order_settlement_status === 'settled'
        if (isSettled) {
          agg.gmv += Number(row.gmv ?? 0)
          agg.commission += Number(row.total_commission_amount ?? 0)
          if (row.order_id) agg.settledOrders.add(row.order_id as string)
        }
        if (row.order_id) agg.allOrders.add(row.order_id as string)
        if (row.product_id) agg.products.add(row.product_id as string)
        salesByCanonical.set(canonId, agg)
      }
    }

    // Build V2 cache rows
    const cacheRows = chunkCanonical.map((canonId) => {
      const vm = canonicalToMeta.get(canonId)!
      const videoId = vm.tiktok_video_id
      const hasStudio = vm.last_studio_scraped_at != null
      const perf = latestPerf.get(videoId) ?? null
      const sales = salesByCanonical.get(canonId) ?? null
      const thumbUrl = (vm as VmRow).thumbnail_url ?? null

      stats.processed++
      if (thumbUrl) stats.withThumbnail++
      if (hasStudio) stats.withStudioData++

      return {
        created_by: createdBy,
        canonical_id: canonId,
        tiktok_video_id: videoId,
        video_title: vm.video_title ?? null,
        posted_at: vm.posted_at ?? null,
        duration_sec: vm.duration_sec ?? null,
        post_url: vm.post_url ?? null,
        content_type: vm.content_type ?? 'video',
        thumbnail_url: thumbUrl,
        thumbnail_source: (vm as VmRow).thumbnail_source ?? null,
        // Studio (V2 — read directly from video_master_v2)
        last_scraped_at: vm.last_studio_scraped_at ?? null,
        headline_video_views: vm.latest_views ?? null,
        headline_likes_total: vm.latest_likes ?? null,
        headline_comments_total: vm.latest_comments ?? null,
        headline_shares_total: vm.latest_shares ?? null,
        watched_full_video_rate: vm.latest_watch_full_rate ?? null,
        average_watch_time_seconds: vm.latest_avg_watch_time_seconds ?? null,
        analytics_new_followers: vm.latest_new_followers ?? null,
        traffic_sources: null,
        // Perf (V1 staging)
        last_perf_imported_at: perf?.created_at ?? null,
        perf_views: perf?.views ?? null,
        gmv_total: perf?.gmv_total ?? null,
        gmv_direct: perf?.gmv_direct ?? null,
        units_sold: perf?.units_sold ?? null,
        ctr: perf?.ctr ?? null,
        perf_watch_full_rate: perf?.watch_full_rate ?? null,
        // Sales (V1 content_order_facts via V2 mapping)
        total_realized_gmv: sales ? sales.gmv : null,
        total_commission: sales ? sales.commission : null,
        settled_order_count: sales ? sales.settledOrders.size : null,
        total_order_count: sales ? sales.allOrders.size : null,
        sales_product_count: sales ? sales.products.size : null,
        // Coverage
        has_studio_data: hasStudio,
        has_perf_data: perf !== null,
        has_sales_data: sales !== null && (sales?.allOrders?.size ?? 0) > 0,
      }
    })

    const { error: cacheErr } = await supabase
      .from('video_overview_cache_v2')
      .upsert(cacheRows, { onConflict: 'created_by,canonical_id', ignoreDuplicates: false })
    if (cacheErr) {
      const msg = `video_overview_cache_v2 chunk ${Math.floor(i / CHUNK) + 1} failed: ${cacheErr.message} (code: ${cacheErr.code})`
      console.error('[rebuildVideoOverviewCacheV2]', msg)
      stats.cacheErrors.push(msg)
    }
  }

  console.log(
    `[rebuildVideoOverviewCacheV2] done: ${stats.processed} rows, ` +
    `${stats.withThumbnail} with thumbnail, ${stats.withStudioData} with studio data, ` +
    `${stats.cacheErrors.length} errors`
  )
  return stats
}
