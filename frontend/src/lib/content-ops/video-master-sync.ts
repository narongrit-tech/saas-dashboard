/**
 * Video Master Sync — 3-Stage Matching Engine + Overview Cache Rebuild
 *
 * Syncs new import data into video_master + video_source_mapping, then
 * rebuilds affected rows in video_overview_cache (pre-aggregated cache table).
 *
 * Cache rebuild replaces the nested-CTE video_overview_view to eliminate
 * statement timeouts on large datasets.
 *
 * Matching stages:
 *   Stage 1  — Deterministic: external_id = tiktok_video_id (confidence 1.0)
 *   Stage 3a — ID normalization: strip leading zeros, retry stage 1 (confidence 0.90)
 *   Stage 3b — Product+date heuristic: overlap via content_order_facts (confidence 0.75/0.50)
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncResult = {
  created: number
  updated: number
  matched: number
  unmatched: number
  needsReview: number
  conflict: number
  errors: string[]
}

type SourceType = 'studio_analytics' | 'perf_stats' | 'affiliate'

type VideoMeta = {
  videoTitle?: string | null
  postedAt?: string | null
  durationSec?: number | null
  postUrl?: string | null
  titleSource: 'studio_analytics' | 'perf_stats' | 'manual'
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

async function upsertVideoMaster(
  supabase: SupabaseClient,
  createdBy: string,
  tiktokVideoId: string,
  meta: VideoMeta
): Promise<string | null> {
  const { data, error } = await supabase
    .from('video_master')
    .upsert(
      {
        created_by: createdBy,
        tiktok_video_id: tiktokVideoId,
        video_title: meta.videoTitle ?? null,
        posted_at: meta.postedAt ?? null,
        duration_sec: meta.durationSec ?? null,
        post_url: meta.postUrl ?? null,
        title_source: meta.titleSource,
        content_type: 'video',
      },
      { onConflict: 'created_by,tiktok_video_id', ignoreDuplicates: false }
    )
    .select('id')
    .single()

  if (error || !data) return null
  return data.id as string
}

async function upsertSourceMapping(
  supabase: SupabaseClient,
  createdBy: string,
  sourceType: SourceType,
  externalId: string,
  canonicalId: string | null,
  matchStage: number | null,
  confidenceScore: number | null,
  matchStatus: 'matched' | 'unmatched' | 'needs_review' | 'conflict',
  matchReason: string,
  sourceTable: string,
  lastSeenAt?: string
): Promise<void> {
  await supabase
    .from('video_source_mapping')
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
        latest_source_table: sourceTable,
        last_seen_at: lastSeenAt ?? new Date().toISOString(),
      },
      { onConflict: 'created_by,source_type,external_id', ignoreDuplicates: false }
    )
}

function emptyResult(): SyncResult {
  return { created: 0, updated: 0, matched: 0, unmatched: 0, needsReview: 0, conflict: 0, errors: [] }
}

function mergeResults(a: SyncResult, b: SyncResult): SyncResult {
  return {
    created: a.created + b.created,
    updated: a.updated + b.updated,
    matched: a.matched + b.matched,
    unmatched: a.unmatched + b.unmatched,
    needsReview: a.needsReview + b.needsReview,
    conflict: a.conflict + b.conflict,
    errors: [...a.errors, ...b.errors],
  }
}

// ─── Stage 1: Direct ID match ─────────────────────────────────────────────────

async function stage1Match(
  supabase: SupabaseClient,
  createdBy: string,
  contentId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('video_master')
    .select('id')
    .eq('created_by', createdBy)
    .eq('tiktok_video_id', contentId)
    .maybeSingle()
  return data?.id ?? null
}

// ─── Stage 3a: ID normalization ───────────────────────────────────────────────

function normalizeId(id: string): string {
  return id.trim().replace(/^0+/, '').toLowerCase()
}

async function stage3aMatch(
  supabase: SupabaseClient,
  createdBy: string,
  contentId: string
): Promise<string | null> {
  const normalized = normalizeId(contentId)
  if (!normalized || normalized === contentId) return null
  const { data } = await supabase
    .from('video_master')
    .select('id')
    .eq('created_by', createdBy)
    .eq('tiktok_video_id', normalized)
    .maybeSingle()
  return data?.id ?? null
}

// ─── Stage 3b: Product+date heuristic ────────────────────────────────────────

type Stage3bResult = {
  canonicalId: string | null
  status: 'matched' | 'needs_review' | 'conflict' | 'unmatched'
  confidence: number
  candidateCount: number
}

async function stage3bMatch(
  supabase: SupabaseClient,
  createdBy: string,
  contentId: string
): Promise<Stage3bResult> {
  const empty: Stage3bResult = { canonicalId: null, status: 'unmatched', confidence: 0, candidateCount: 0 }

  const { data: orderRows } = await supabase
    .from('content_order_facts')
    .select('product_id, order_date')
    .eq('created_by', createdBy)
    .eq('content_id', contentId)
    .not('product_id', 'is', null)

  if (!orderRows || orderRows.length === 0) return empty

  const productIds = [...new Set(orderRows.map((r) => r.product_id as string))]
  const dates = orderRows.map((r) => r.order_date as string).filter(Boolean).sort()
  const earliestDate = dates[0]
  if (!earliestDate || productIds.length === 0) return empty

  const windowStart = new Date(earliestDate)
  windowStart.setDate(windowStart.getDate() - 30)
  const windowEnd = new Date(earliestDate)
  windowEnd.setDate(windowEnd.getDate() + 30)
  const wStart = windowStart.toISOString().split('T')[0]
  const wEnd = windowEnd.toISOString().split('T')[0]

  const { data: candidateRows } = await supabase
    .from('content_order_facts')
    .select('content_id')
    .eq('created_by', createdBy)
    .in('product_id', productIds)
    .neq('content_id', contentId)
    .gte('order_date', wStart)
    .lte('order_date', wEnd)

  if (!candidateRows || candidateRows.length === 0) return empty

  const candidateContentIds = [...new Set(candidateRows.map((r) => r.content_id as string))]

  const { data: mappings } = await supabase
    .from('video_source_mapping')
    .select('canonical_id')
    .eq('created_by', createdBy)
    .eq('source_type', 'affiliate')
    .eq('match_status', 'matched')
    .in('external_id', candidateContentIds)
    .not('canonical_id', 'is', null)

  if (!mappings || mappings.length === 0) return empty

  const canonicalIds = [...new Set(mappings.map((m) => m.canonical_id as string))]

  const { data: videoRows } = await supabase
    .from('video_master')
    .select('id')
    .eq('created_by', createdBy)
    .in('id', canonicalIds)
    .gte('posted_at', wStart)
    .lte('posted_at', wEnd)

  const uniqueMatches = [...new Set((videoRows ?? []).map((v) => v.id as string))]

  if (uniqueMatches.length === 0) return empty
  if (uniqueMatches.length === 1) {
    return { canonicalId: uniqueMatches[0], status: 'needs_review', confidence: 0.75, candidateCount: 1 }
  }
  return { canonicalId: null, status: 'conflict', confidence: 0.5, candidateCount: uniqueMatches.length }
}

// ─── Overview cache rebuild ───────────────────────────────────────────────────

const CHUNK = 200

export async function rebuildVideoOverviewCache(
  supabase: SupabaseClient,
  createdBy: string,
  canonicalIds?: string[]
): Promise<void> {
  // 1. Fetch affected video_master rows
  let vmQuery = supabase
    .from('video_master')
    .select('id, tiktok_video_id, video_title, posted_at, duration_sec, post_url, content_type, thumbnail_url, thumbnail_source')
    .eq('created_by', createdBy)
  if (canonicalIds && canonicalIds.length > 0) {
    vmQuery = vmQuery.in('id', canonicalIds)
  }
  const { data: videos } = await vmQuery
  if (!videos || videos.length === 0) return

  const allCanonicalIds = videos.map((v) => v.id as string)
  const videoIdToCanonical = new Map(videos.map((v) => [v.tiktok_video_id as string, v.id as string]))
  const canonicalToMeta = new Map(videos.map((v) => [v.id as string, v]))

  // Process in chunks to avoid giant IN clauses
  for (let i = 0; i < allCanonicalIds.length; i += CHUNK) {
    const chunkCanonical = allCanonicalIds.slice(i, i + CHUNK)
    const chunkVideoIds = videos.slice(i, i + CHUNK).map((v) => v.tiktok_video_id as string)

    // 2. Latest studio analytics per video_id (sorted desc, dedup in-memory)
    const { data: studioRows } = await supabase
      .from('tiktok_studio_analytics_rows')
      .select('post_id, scraped_at, headline_video_views, headline_likes_total, headline_comments_total, headline_shares_total, watched_full_video_rate, average_watch_time_seconds, analytics_new_followers, traffic_sources')
      .eq('created_by', createdBy)
      .in('post_id', chunkVideoIds)
      .order('scraped_at', { ascending: false })

    const latestStudio = new Map<string, typeof studioRows extends (infer T)[] | null ? T : never>()
    for (const r of studioRows ?? []) {
      if (!latestStudio.has(r.post_id)) latestStudio.set(r.post_id, r)
    }

    // 3. Latest perf stats per video_id (sorted desc, dedup in-memory)
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

    // 4. Affiliate source mappings: canonical_id → content_ids
    const { data: mappings } = await supabase
      .from('video_source_mapping')
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

    // 5. Aggregate sales from content_order_facts
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

      // Build content_id → canonical_id reverse map
      const contentToCanonical = new Map<string, string>()
      for (const [canonId, contentIds] of canonicalToContentIds.entries()) {
        for (const cid of contentIds) contentToCanonical.set(cid, canonId)
      }

      for (const row of orderRows ?? []) {
        const canonId = contentToCanonical.get(row.content_id as string)
        if (!canonId) continue
        const agg = salesByCanonical.get(canonId) ?? { gmv: 0, commission: 0, settledOrders: new Set(), allOrders: new Set(), products: new Set() }
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

    // 6. Build and upsert cache rows
    const cacheRows = chunkCanonical.map((canonId) => {
      const vm = canonicalToMeta.get(canonId)!
      const videoId = vm.tiktok_video_id as string
      const eng = latestStudio.get(videoId) ?? null
      const perf = latestPerf.get(videoId) ?? null
      const sales = salesByCanonical.get(canonId) ?? null

      return {
        created_by: createdBy,
        canonical_id: canonId,
        tiktok_video_id: videoId,
        video_title: vm.video_title ?? null,
        posted_at: vm.posted_at ?? null,
        duration_sec: vm.duration_sec ?? null,
        post_url: vm.post_url ?? null,
        content_type: vm.content_type ?? 'video',
        thumbnail_url: (vm as { thumbnail_url?: string | null }).thumbnail_url ?? null,
        thumbnail_source: (vm as { thumbnail_source?: string | null }).thumbnail_source ?? null,
        // Studio
        last_scraped_at: eng?.scraped_at ?? null,
        headline_video_views: eng?.headline_video_views ?? null,
        headline_likes_total: eng?.headline_likes_total ?? null,
        headline_comments_total: eng?.headline_comments_total ?? null,
        headline_shares_total: eng?.headline_shares_total ?? null,
        watched_full_video_rate: eng?.watched_full_video_rate ?? null,
        average_watch_time_seconds: eng?.average_watch_time_seconds ?? null,
        analytics_new_followers: (eng as { analytics_new_followers?: number } | null)?.analytics_new_followers ?? null,
        traffic_sources: eng?.traffic_sources ?? null,
        // Perf
        last_perf_imported_at: perf?.created_at ?? null,
        perf_views: perf?.views ?? null,
        gmv_total: perf?.gmv_total ?? null,
        gmv_direct: perf?.gmv_direct ?? null,
        units_sold: perf?.units_sold ?? null,
        ctr: perf?.ctr ?? null,
        perf_watch_full_rate: perf?.watch_full_rate ?? null,
        // Sales
        total_realized_gmv: sales ? sales.gmv : null,
        total_commission: sales ? sales.commission : null,
        settled_order_count: sales ? sales.settledOrders.size : null,
        total_order_count: sales ? sales.allOrders.size : null,
        sales_product_count: sales ? sales.products.size : null,
        // Coverage
        has_studio_data: eng !== null,
        has_perf_data: perf !== null,
        has_sales_data: sales !== null && sales.allOrders.size > 0,
      }
    })

    await supabase
      .from('video_overview_cache')
      .upsert(cacheRows, { onConflict: 'created_by,canonical_id', ignoreDuplicates: false })
  }
}

// ─── Per-source sync functions ────────────────────────────────────────────────

export async function syncStudioAnalyticsBatch(
  supabase: SupabaseClient,
  createdBy: string,
  batchId: string
): Promise<SyncResult> {
  const result = emptyResult()
  const affectedCanonicalIds: string[] = []

  const { data: rows, error } = await supabase
    .from('tiktok_studio_analytics_rows')
    .select('id, post_id, video_title, posted_at, post_url, scraped_at')
    .eq('created_by', createdBy)
    .eq('import_batch_id', batchId)
    .not('post_id', 'is', null)

  if (error) {
    result.errors.push(`fetch studio rows: ${error.message}`)
    return result
  }

  for (const row of rows ?? []) {
    if (!row.post_id) continue
    try {
      const canonicalId = await upsertVideoMaster(supabase, createdBy, row.post_id, {
        videoTitle: row.video_title,
        postedAt: row.posted_at,
        titleSource: 'studio_analytics',
        postUrl: row.post_url,
      })
      if (!canonicalId) { result.errors.push(`upsert video_master failed: ${row.post_id}`); continue }
      await upsertSourceMapping(
        supabase, createdBy, 'studio_analytics', row.post_id,
        canonicalId, 1, 1.0, 'matched', 'import:stage1:post_id=tiktok_video_id',
        'tiktok_studio_analytics_rows', row.scraped_at
      )
      affectedCanonicalIds.push(canonicalId)
      result.matched++
    } catch (e) {
      result.errors.push(`row ${row.post_id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (affectedCanonicalIds.length > 0) {
    await rebuildVideoOverviewCache(supabase, createdBy, [...new Set(affectedCanonicalIds)]).catch(() => {})
  }

  return result
}

export async function syncPerfStatsBatch(
  supabase: SupabaseClient,
  createdBy: string,
  batchId: string
): Promise<SyncResult> {
  const result = emptyResult()
  const affectedCanonicalIds: string[] = []

  const { data: rows, error } = await supabase
    .from('tiktok_video_perf_stats')
    .select('id, video_id_raw, video_title, posted_at, duration_sec, created_at')
    .eq('created_by', createdBy)
    .eq('import_batch_id', batchId)
    .not('video_id_raw', 'is', null)

  if (error) {
    result.errors.push(`fetch perf rows: ${error.message}`)
    return result
  }

  for (const row of rows ?? []) {
    if (!row.video_id_raw) continue
    try {
      const canonicalId = await upsertVideoMaster(supabase, createdBy, row.video_id_raw, {
        videoTitle: row.video_title,
        postedAt: row.posted_at,
        durationSec: row.duration_sec,
        titleSource: 'perf_stats',
      })
      if (!canonicalId) { result.errors.push(`upsert video_master failed: ${row.video_id_raw}`); continue }
      await upsertSourceMapping(
        supabase, createdBy, 'perf_stats', row.video_id_raw,
        canonicalId, 1, 1.0, 'matched', 'import:stage1:video_id_raw=tiktok_video_id',
        'tiktok_video_perf_stats', row.created_at
      )
      affectedCanonicalIds.push(canonicalId)
      result.matched++
    } catch (e) {
      result.errors.push(`row ${row.video_id_raw}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (affectedCanonicalIds.length > 0) {
    await rebuildVideoOverviewCache(supabase, createdBy, [...new Set(affectedCanonicalIds)]).catch(() => {})
  }

  return result
}

export async function syncAffiliateBatch(
  supabase: SupabaseClient,
  createdBy: string,
  batchId: string
): Promise<SyncResult> {
  const result = emptyResult()
  const affectedCanonicalIds: string[] = []

  const { data: rows, error } = await supabase
    .from('content_order_facts')
    .select('content_id, order_date, created_at')
    .eq('created_by', createdBy)
    .eq('import_batch_id', batchId)
    .not('content_id', 'is', null)
    .neq('content_id', '')

  if (error) {
    result.errors.push(`fetch affiliate rows: ${error.message}`)
    return result
  }

  const seen = new Map<string, { orderDate: string; createdAt: string }>()
  for (const row of rows ?? []) {
    const cid = row.content_id as string
    if (!seen.has(cid)) seen.set(cid, { orderDate: row.order_date ?? '', createdAt: row.created_at })
  }

  for (const [contentId, meta] of seen.entries()) {
    try {
      const stageResult = await runAffiliateMatchStages(supabase, createdBy, contentId, meta.createdAt)
      switch (stageResult.status) {
        case 'matched': result.matched++; break
        case 'needs_review': result.needsReview++; break
        case 'conflict': result.conflict++; break
        default: result.unmatched++
      }
      if (stageResult.canonicalId) affectedCanonicalIds.push(stageResult.canonicalId)
    } catch (e) {
      result.errors.push(`content_id ${contentId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (affectedCanonicalIds.length > 0) {
    await rebuildVideoOverviewCache(supabase, createdBy, [...new Set(affectedCanonicalIds)]).catch(() => {})
  }

  return result
}

async function runAffiliateMatchStages(
  supabase: SupabaseClient,
  createdBy: string,
  contentId: string,
  createdAt: string
): Promise<{ status: 'matched' | 'unmatched' | 'needs_review' | 'conflict'; canonicalId: string | null }> {
  const s1 = await stage1Match(supabase, createdBy, contentId)
  if (s1) {
    await upsertSourceMapping(
      supabase, createdBy, 'affiliate', contentId, s1, 1, 1.0, 'matched',
      'import:stage1:content_id=tiktok_video_id', 'content_order_facts', createdAt
    )
    return { status: 'matched', canonicalId: s1 }
  }

  const s3a = await stage3aMatch(supabase, createdBy, contentId)
  if (s3a) {
    await upsertSourceMapping(
      supabase, createdBy, 'affiliate', contentId, s3a, 3, 0.9, 'matched',
      'import:stage3a:normalized_id_match', 'content_order_facts', createdAt
    )
    return { status: 'matched', canonicalId: s3a }
  }

  const s3b = await stage3bMatch(supabase, createdBy, contentId)
  if (s3b.status !== 'unmatched') {
    await upsertSourceMapping(
      supabase, createdBy, 'affiliate', contentId,
      s3b.canonicalId, 3, s3b.confidence, s3b.status,
      `import:stage3b:product_date_overlap(candidates=${s3b.candidateCount})`,
      'content_order_facts', createdAt
    )
    return { status: s3b.status, canonicalId: s3b.canonicalId }
  }

  await upsertSourceMapping(
    supabase, createdBy, 'affiliate', contentId, null, null, null, 'unmatched',
    'import:no_match', 'content_order_facts', createdAt
  )
  return { status: 'unmatched', canonicalId: null }
}

// ─── Full sync ────────────────────────────────────────────────────────────────

export async function runFullVideoMasterSync(
  supabase: SupabaseClient,
  createdBy: string
): Promise<SyncResult> {
  let result = emptyResult()

  try {
    const { data: studioBatches } = await supabase
      .from('tiktok_studio_analytics_batches')
      .select('id')
      .eq('created_by', createdBy)
      .eq('status', 'staged')
    for (const b of studioBatches ?? []) {
      result = mergeResults(result, await syncStudioAnalyticsBatch(supabase, createdBy, b.id))
    }
  } catch (e) {
    result.errors.push(`studio full sync: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    const { data: perfBatches } = await supabase
      .from('tiktok_video_perf_import_batches')
      .select('id')
      .eq('created_by', createdBy)
      .eq('status', 'staged')
    for (const b of perfBatches ?? []) {
      result = mergeResults(result, await syncPerfStatsBatch(supabase, createdBy, b.id))
    }
  } catch (e) {
    result.errors.push(`perf full sync: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    const { data: affiliateBatches } = await supabase
      .from('tiktok_affiliate_import_batches')
      .select('id')
      .eq('created_by', createdBy)
      .eq('status', 'staged')
    for (const b of affiliateBatches ?? []) {
      result = mergeResults(result, await syncAffiliateBatch(supabase, createdBy, b.id))
    }
  } catch (e) {
    result.errors.push(`affiliate full sync: ${e instanceof Error ? e.message : String(e)}`)
  }

  // Final full cache rebuild to catch any gaps
  await rebuildVideoOverviewCache(supabase, createdBy).catch((e) => {
    result.errors.push(`cache rebuild: ${e instanceof Error ? e.message : String(e)}`)
  })

  return result
}
