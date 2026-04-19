'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { runFullVideoMasterSync, type SyncResult } from '@/lib/content-ops/video-master-sync'

// ─── Types ────────────────────────────────────────────────────────────────────

export type VideoOverviewRow = {
  id: string
  tiktok_video_id: string
  video_title: string | null
  posted_at: string | null
  duration_sec: number | null
  post_url: string | null
  thumbnail_url: string | null
  thumbnail_source: string | null
  content_type: string
  created_at: string
  // Studio engagement (latest snapshot)
  last_scraped_at: string | null
  headline_video_views: number | null
  headline_likes_total: number | null
  headline_comments_total: number | null
  watched_full_video_rate: number | null
  average_watch_time_seconds: number | null
  analytics_new_followers: number | null
  traffic_sources: Array<{ name: string; share: number }> | null
  // Perf stats (latest import)
  last_perf_imported_at: string | null
  perf_views: number | null
  gmv_total: number | null
  gmv_direct: number | null
  units_sold: number | null
  ctr: number | null
  perf_watch_full_rate: number | null
  // Sales aggregate
  total_realized_gmv: number | null
  total_commission: number | null
  settled_order_count: number | null
  total_order_count: number | null
  sales_product_count: number | null
  // Coverage
  has_studio_data: boolean
  has_perf_data: boolean
  has_sales_data: boolean
}

export type CoverageSummary = {
  totalVideos: number
  studioCount: number
  perfCount: number
  salesCount: number
  studioPct: number
  perfPct: number
  salesPct: number
  totalViews: number
  totalGmv: number
  avgWatchRate: number | null
}

export type VideoDetailRow = {
  id: string
  tiktok_video_id: string
  video_title: string | null
  posted_at: string | null
  duration_sec: number | null
  post_url: string | null
  content_type: string
}

export type EngagementRow = {
  snapshot_date: string
  scraped_at: string
  headline_video_views: number | null
  headline_likes_total: number | null
  headline_comments_total: number | null
  watched_full_video_rate: number | null
  average_watch_time_seconds: number | null
  analytics_new_followers: number | null
}

export type PerfRow = {
  import_date: string
  imported_at: string
  views: number | null
  gmv_total: number | null
  units_sold: number | null
  ctr: number | null
  watch_full_rate: number | null
}

export type TopProductRow = {
  product_id: string
  order_count: number
  total_gmv: number | null
  realized_gmv: number | null
  total_commission: number | null
  realized_commission: number | null
}

export type SourceMappingRow = {
  id: string
  source_type: string
  external_id: string
  match_status: string
  match_stage: number | null
  confidence_score: number | null
  match_reason: string | null
  last_seen_at: string
}

export type MappingReviewRow = {
  id: string
  source_type: string
  external_id: string
  match_status: string
  match_stage: number | null
  confidence_score: number | null
  match_reason: string | null
  last_seen_at: string
  canonical_id: string | null
  // Joined from video_master
  video_title: string | null
  tiktok_video_id: string | null
}

// ─── Main page ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

export async function getVideoOverview(
  sortBy: 'views' | 'gmv' | 'posted_at' = 'views',
  page = 1
): Promise<{
  data: VideoOverviewRow[] | null
  coverage: CoverageSummary | null
  total: number
  page: number
  pageSize: number
  error: string | null
}> {
  const empty = { data: null, coverage: null, total: 0, page, pageSize: PAGE_SIZE, error: null }
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ...empty, error: 'Unauthenticated' }

    const sortCol =
      sortBy === 'gmv' ? 'gmv_total' :
      sortBy === 'posted_at' ? 'posted_at' :
      'headline_video_views'

    const offset = (page - 1) * PAGE_SIZE

    // Paginated data + coverage stats in parallel
    const [dataRes, coverageRes] = await Promise.all([
      supabase
        .from('video_overview_cache')
        .select('*', { count: 'exact' })
        .eq('created_by', user.id)
        .order(sortCol, { ascending: false, nullsFirst: false })
        .range(offset, offset + PAGE_SIZE - 1),
      supabase
        .from('video_overview_cache')
        .select('has_studio_data, has_perf_data, has_sales_data, headline_video_views, watched_full_video_rate, gmv_total')
        .eq('created_by', user.id),
    ])

    if (dataRes.error) return { ...empty, error: dataRes.error.message }

    const total = dataRes.count ?? 0
    const rows = (dataRes.data ?? []) as VideoOverviewRow[]

    // Coverage computed from all rows (lightweight — 6 cols only)
    const allRows = (coverageRes.data ?? []) as Array<{
      has_studio_data: boolean; has_perf_data: boolean; has_sales_data: boolean
      headline_video_views: number | null; watched_full_video_rate: number | null; gmv_total: number | null
    }>
    const totalVideos = allRows.length
    const studioCount = allRows.filter(r => r.has_studio_data).length
    const perfCount = allRows.filter(r => r.has_perf_data).length
    const salesCount = allRows.filter(r => r.has_sales_data).length
    const totalViews = allRows.reduce((s, r) => s + (r.headline_video_views ?? 0), 0)
    const totalGmv = allRows.reduce((s, r) => s + (r.gmv_total ?? 0), 0)
    const watchRates = allRows.filter(r => r.watched_full_video_rate !== null).map(r => r.watched_full_video_rate as number)
    const avgWatchRate = watchRates.length > 0 ? watchRates.reduce((a, b) => a + b) / watchRates.length : null

    const coverage: CoverageSummary = {
      totalVideos,
      studioCount,
      perfCount,
      salesCount,
      studioPct: totalVideos > 0 ? Math.round((studioCount / totalVideos) * 100) : 0,
      perfPct: totalVideos > 0 ? Math.round((perfCount / totalVideos) * 100) : 0,
      salesPct: totalVideos > 0 ? Math.round((salesCount / totalVideos) * 100) : 0,
      totalViews,
      totalGmv,
      avgWatchRate,
    }

    return { data: rows, coverage, total, page, pageSize: PAGE_SIZE, error: null }
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── Detail page ──────────────────────────────────────────────────────────────

export async function getVideoDetail(tiktokVideoId: string): Promise<{
  video: VideoDetailRow | null
  recentEngagement: EngagementRow[]
  recentPerf: PerfRow[]
  topProducts: TopProductRow[]
  sourceMappings: SourceMappingRow[]
  error: string | null
}> {
  const empty = { video: null, recentEngagement: [], recentPerf: [], topProducts: [], sourceMappings: [], error: null }
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ...empty, error: 'Unauthenticated' }

    const { data: videoRow, error: vmErr } = await supabase
      .from('video_master')
      .select('id, tiktok_video_id, video_title, posted_at, duration_sec, post_url, content_type')
      .eq('created_by', user.id)
      .eq('tiktok_video_id', tiktokVideoId)
      .maybeSingle()

    if (vmErr) return { ...empty, error: vmErr.message }
    if (!videoRow) return { ...empty, error: 'Video not found' }

    const canonicalId = videoRow.id

    const [engRes, perfRes, prodRes, mapRes] = await Promise.all([
      supabase
        .from('video_engagement_daily' as never)
        .select('snapshot_date, scraped_at, headline_video_views, headline_likes_total, headline_comments_total, watched_full_video_rate, average_watch_time_seconds, analytics_new_followers')
        .eq('created_by', user.id)
        .eq('canonical_id', canonicalId)
        .order('scraped_at', { ascending: false })
        .limit(10),
      supabase
        .from('video_performance_daily' as never)
        .select('import_date, imported_at, views, gmv_total, units_sold, ctr, watch_full_rate')
        .eq('created_by', user.id)
        .eq('canonical_id', canonicalId)
        .order('imported_at', { ascending: false })
        .limit(10),
      supabase
        .from('video_perf_products' as never)
        .select('product_id, order_count, total_gmv, realized_gmv, total_commission, realized_commission')
        .eq('created_by', user.id)
        .eq('canonical_id', canonicalId)
        .order('total_gmv', { ascending: false, nullsFirst: false })
        .limit(20),
      supabase
        .from('video_source_mapping')
        .select('id, source_type, external_id, match_status, match_stage, confidence_score, match_reason, last_seen_at')
        .eq('created_by', user.id)
        .eq('canonical_id', canonicalId),
    ])

    return {
      video: videoRow as VideoDetailRow,
      recentEngagement: (engRes.data ?? []) as EngagementRow[],
      recentPerf: (perfRes.data ?? []) as PerfRow[],
      topProducts: (prodRes.data ?? []) as TopProductRow[],
      sourceMappings: (mapRes.data ?? []) as SourceMappingRow[],
      error: engRes.error?.message ?? perfRes.error?.message ?? null,
    }
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── Mapping review ───────────────────────────────────────────────────────────

export async function getMappingReview(
  status: 'all' | 'unmatched' | 'needs_review' | 'conflict' = 'all',
  limit = 200,
  offset = 0
): Promise<{ data: MappingReviewRow[] | null; total: number; error: string | null }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { data: null, total: 0, error: 'Unauthenticated' }

    let q = supabase
      .from('video_source_mapping')
      .select('id, source_type, external_id, match_status, match_stage, confidence_score, match_reason, last_seen_at, canonical_id', { count: 'exact' })
      .eq('created_by', user.id)

    if (status !== 'all') q = q.eq('match_status', status)

    const { data, error, count } = await q
      .order('last_seen_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) return { data: null, total: 0, error: error.message }

    const mappings = data ?? []
    const canonicalIds = [...new Set(mappings.map(m => m.canonical_id).filter(Boolean))] as string[]

    // Fetch video titles for matched rows
    const titleMap = new Map<string, { video_title: string | null; tiktok_video_id: string }>()
    if (canonicalIds.length > 0) {
      const { data: vmRows } = await supabase
        .from('video_master')
        .select('id, video_title, tiktok_video_id')
        .eq('created_by', user.id)
        .in('id', canonicalIds)
      for (const v of vmRows ?? []) titleMap.set(v.id, { video_title: v.video_title, tiktok_video_id: v.tiktok_video_id })
    }

    const rows: MappingReviewRow[] = mappings.map(m => ({
      ...m,
      video_title: m.canonical_id ? (titleMap.get(m.canonical_id)?.video_title ?? null) : null,
      tiktok_video_id: m.canonical_id ? (titleMap.get(m.canonical_id)?.tiktok_video_id ?? null) : null,
    }))

    return { data: rows, total: count ?? 0, error: null }
  } catch (e) {
    return { data: null, total: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function getMappingStatusCounts(): Promise<{
  all: number; unmatched: number; needs_review: number; conflict: number; error: string | null
}> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { all: 0, unmatched: 0, needs_review: 0, conflict: 0, error: 'Unauthenticated' }

    const { data, error } = await supabase
      .from('video_source_mapping')
      .select('match_status')
      .eq('created_by', user.id)

    if (error) return { all: 0, unmatched: 0, needs_review: 0, conflict: 0, error: error.message }

    const rows = data ?? []
    return {
      all: rows.length,
      unmatched: rows.filter(r => r.match_status === 'unmatched').length,
      needs_review: rows.filter(r => r.match_status === 'needs_review').length,
      conflict: rows.filter(r => r.match_status === 'conflict').length,
      error: null,
    }
  } catch (e) {
    return { all: 0, unmatched: 0, needs_review: 0, conflict: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function confirmMapping(
  mappingId: string,
  canonicalId: string
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Unauthenticated' }

    const { error } = await supabase
      .from('video_source_mapping')
      .update({
        match_status: 'matched',
        canonical_id: canonicalId,
        match_stage: 3,
        confidence_score: 1.0,
        match_reason: 'manual:confirmed',
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      })
      .eq('id', mappingId)
      .eq('created_by', user.id)

    return { ok: !error, error: error?.message ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function rejectMapping(
  mappingId: string
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Unauthenticated' }

    const { error } = await supabase
      .from('video_source_mapping')
      .update({
        match_status: 'unmatched',
        canonical_id: null,
        match_stage: null,
        confidence_score: null,
        match_reason: 'manual:rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      })
      .eq('id', mappingId)
      .eq('created_by', user.id)

    return { ok: !error, error: error?.message ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── Data health ──────────────────────────────────────────────────────────────

export async function getVideoMasterHealth(): Promise<{
  totalVideos: number
  studioCount: number
  perfCount: number
  salesCount: number
  unmatchedCount: number
  needsReviewCount: number
  conflictCount: number
  error: string | null
}> {
  const empty = { totalVideos: 0, studioCount: 0, perfCount: 0, salesCount: 0, unmatchedCount: 0, needsReviewCount: 0, conflictCount: 0, error: null }
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ...empty, error: 'Unauthenticated' }

    const [vmRes, mapRes] = await Promise.all([
      supabase
        .from('video_overview_cache')
        .select('has_studio_data, has_perf_data, has_sales_data')
        .eq('created_by', user.id),
      supabase
        .from('video_source_mapping')
        .select('match_status')
        .eq('created_by', user.id),
    ])

    if (vmRes.error) return { ...empty, error: vmRes.error.message }

    const videos = (vmRes.data ?? []) as Array<{ has_studio_data: boolean; has_perf_data: boolean; has_sales_data: boolean }>
    const mappings = mapRes.data ?? []

    return {
      totalVideos: videos.length,
      studioCount: videos.filter(v => v.has_studio_data).length,
      perfCount: videos.filter(v => v.has_perf_data).length,
      salesCount: videos.filter(v => v.has_sales_data).length,
      unmatchedCount: mappings.filter(m => m.match_status === 'unmatched').length,
      needsReviewCount: mappings.filter(m => m.match_status === 'needs_review').length,
      conflictCount: mappings.filter(m => m.match_status === 'conflict').length,
      error: null,
    }
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── On-demand full sync (admin action) ──────────────────────────────────────

export async function triggerFullSync(): Promise<{ result: SyncResult | null; error: string | null }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { result: null, error: 'Unauthenticated' }

    const serviceClient = createServiceClient()
    const result = await runFullVideoMasterSync(serviceClient, user.id)
    return { result, error: null }
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : String(e) }
  }
}
