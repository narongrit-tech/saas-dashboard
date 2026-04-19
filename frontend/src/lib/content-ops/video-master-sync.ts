/**
 * Video Master Sync — 3-Stage Matching Engine
 *
 * Syncs new import data into the canonical video_master + video_source_mapping tables.
 * Called at end of each import pipeline (studio analytics, perf stats, affiliate orders).
 *
 * Matching stages:
 *   Stage 1 — Deterministic: external_id matches tiktok_video_id directly (confidence 1.0)
 *   Stage 2 — Bridge: unmatched affiliate content_id found via product+existing mapping lookup (confidence 0.95)
 *   Stage 3a — ID normalization: strip/pad numeric IDs, retry stage 1 (confidence 0.90)
 *   Stage 3b — Heuristic: product+date overlap with already-matched videos (confidence 0.75 / 0.50)
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
  postedAt?: string | null  // ISO date or DATE string
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
      {
        onConflict: 'created_by,tiktok_video_id',
        ignoreDuplicates: false,
      }
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

  // Get product_ids + earliest order_date for this content_id
  const { data: orderRows } = await supabase
    .from('content_order_facts')
    .select('product_id, order_date')
    .eq('created_by', createdBy)
    .eq('content_id', contentId)
    .not('product_id', 'is', null)

  if (!orderRows || orderRows.length === 0) return empty

  const productIds = [...new Set(orderRows.map((r) => r.product_id as string))]
  const dates = orderRows
    .map((r) => r.order_date as string)
    .filter(Boolean)
    .sort()
  const earliestDate = dates[0]
  if (!earliestDate || productIds.length === 0) return empty

  // Find video_master entries already matched via affiliate that sold same products, within 30 days
  const windowStart = new Date(earliestDate)
  windowStart.setDate(windowStart.getDate() - 30)
  const windowEnd = new Date(earliestDate)
  windowEnd.setDate(windowEnd.getDate() + 30)

  const { data: candidateRows } = await supabase
    .from('content_order_facts')
    .select('content_id')
    .eq('created_by', createdBy)
    .in('product_id', productIds)
    .neq('content_id', contentId)
    .gte('order_date', windowStart.toISOString().split('T')[0])
    .lte('order_date', windowEnd.toISOString().split('T')[0])

  if (!candidateRows || candidateRows.length === 0) return empty

  const candidateContentIds = [...new Set(candidateRows.map((r) => r.content_id as string))]

  // Look up which candidates are already matched in video_source_mapping
  const { data: mappings } = await supabase
    .from('video_source_mapping')
    .select('external_id, canonical_id')
    .eq('created_by', createdBy)
    .eq('source_type', 'affiliate')
    .eq('match_status', 'matched')
    .in('external_id', candidateContentIds)
    .not('canonical_id', 'is', null)

  if (!mappings || mappings.length === 0) return empty

  const canonicalIds = [...new Set(mappings.map((m) => m.canonical_id as string))]

  // Verify posted_at is within window for candidate videos
  const { data: videoRows } = await supabase
    .from('video_master')
    .select('id, posted_at')
    .eq('created_by', createdBy)
    .in('id', canonicalIds)
    .gte('posted_at', windowStart.toISOString().split('T')[0])
    .lte('posted_at', windowEnd.toISOString().split('T')[0])

  const matchingIds = (videoRows ?? []).map((v) => v.id as string)
  const uniqueMatches = [...new Set(matchingIds)]

  if (uniqueMatches.length === 0) return empty
  if (uniqueMatches.length === 1) {
    return { canonicalId: uniqueMatches[0], status: 'needs_review', confidence: 0.75, candidateCount: 1 }
  }
  return { canonicalId: null, status: 'conflict', confidence: 0.5, candidateCount: uniqueMatches.length }
}

// ─── Per-source sync functions ────────────────────────────────────────────────

export async function syncStudioAnalyticsBatch(
  supabase: SupabaseClient,
  createdBy: string,
  batchId: string
): Promise<SyncResult> {
  const result = emptyResult()

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
      result.matched++
    } catch (e) {
      result.errors.push(`row ${row.post_id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}

export async function syncPerfStatsBatch(
  supabase: SupabaseClient,
  createdBy: string,
  batchId: string
): Promise<SyncResult> {
  const result = emptyResult()

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
      result.matched++
    } catch (e) {
      result.errors.push(`row ${row.video_id_raw}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}

export async function syncAffiliateBatch(
  supabase: SupabaseClient,
  createdBy: string,
  batchId: string
): Promise<SyncResult> {
  const result = emptyResult()

  // Get distinct content_ids in this batch with their latest order_date
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

  // Deduplicate — we only need one entry per content_id
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
    } catch (e) {
      result.errors.push(`content_id ${contentId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}

// Internal: runs stages 1 → 3a → 3b → unmatched for a single affiliate content_id
async function runAffiliateMatchStages(
  supabase: SupabaseClient,
  createdBy: string,
  contentId: string,
  createdAt: string
): Promise<{ status: 'matched' | 'unmatched' | 'needs_review' | 'conflict' }> {
  // Stage 1 — direct ID match
  const s1 = await stage1Match(supabase, createdBy, contentId)
  if (s1) {
    await upsertSourceMapping(
      supabase, createdBy, 'affiliate', contentId, s1, 1, 1.0, 'matched',
      'import:stage1:content_id=tiktok_video_id', 'content_order_facts', createdAt
    )
    return { status: 'matched' }
  }

  // Stage 3a — ID normalization
  const s3a = await stage3aMatch(supabase, createdBy, contentId)
  if (s3a) {
    await upsertSourceMapping(
      supabase, createdBy, 'affiliate', contentId, s3a, 3, 0.9, 'matched',
      'import:stage3a:normalized_id_match', 'content_order_facts', createdAt
    )
    return { status: 'matched' }
  }

  // Stage 3b — product+date heuristic
  const s3b = await stage3bMatch(supabase, createdBy, contentId)
  if (s3b.status !== 'unmatched') {
    await upsertSourceMapping(
      supabase, createdBy, 'affiliate', contentId,
      s3b.canonicalId,
      3, s3b.confidence, s3b.status,
      `import:stage3b:product_date_overlap(candidates=${s3b.candidateCount})`,
      'content_order_facts', createdAt
    )
    return { status: s3b.status }
  }

  // Unmatched
  await upsertSourceMapping(
    supabase, createdBy, 'affiliate', contentId, null, null, null, 'unmatched',
    'import:no_match', 'content_order_facts', createdAt
  )
  return { status: 'unmatched' }
}

// ─── Full sync (all sources, per user) ───────────────────────────────────────

export async function runFullVideoMasterSync(
  supabase: SupabaseClient,
  createdBy: string
): Promise<SyncResult> {
  let result = emptyResult()

  // Sync all studio analytics rows
  try {
    const { data: studioBatches } = await supabase
      .from('tiktok_studio_analytics_batches')
      .select('id')
      .eq('created_by', createdBy)
      .eq('status', 'staged')
    for (const b of studioBatches ?? []) {
      const r = await syncStudioAnalyticsBatch(supabase, createdBy, b.id)
      result = mergeResults(result, r)
    }
  } catch (e) {
    result.errors.push(`studio full sync: ${e instanceof Error ? e.message : String(e)}`)
  }

  // Sync all perf stats rows
  try {
    const { data: perfBatches } = await supabase
      .from('tiktok_video_perf_import_batches')
      .select('id')
      .eq('created_by', createdBy)
      .eq('status', 'staged')
    for (const b of perfBatches ?? []) {
      const r = await syncPerfStatsBatch(supabase, createdBy, b.id)
      result = mergeResults(result, r)
    }
  } catch (e) {
    result.errors.push(`perf full sync: ${e instanceof Error ? e.message : String(e)}`)
  }

  // Sync all affiliate content_ids
  try {
    const { data: affiliateBatches } = await supabase
      .from('tiktok_affiliate_import_batches')
      .select('id')
      .eq('created_by', createdBy)
      .eq('status', 'staged')
    for (const b of affiliateBatches ?? []) {
      const r = await syncAffiliateBatch(supabase, createdBy, b.id)
      result = mergeResults(result, r)
    }
  } catch (e) {
    result.errors.push(`affiliate full sync: ${e instanceof Error ? e.message : String(e)}`)
  }

  return result
}
