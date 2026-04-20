'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { rebuildVideoOverviewCacheV2 } from '@/lib/content-ops/video-master-v2-sync'

export type VideoOverviewV2Row = {
  id: string
  canonical_id: string
  tiktok_video_id: string
  video_title: string | null
  posted_at: string | null
  duration_sec: number | null
  post_url: string | null
  thumbnail_url: string | null
  thumbnail_source: string | null
  content_type: string
  last_scraped_at: string | null
  headline_video_views: number | null
  headline_likes_total: number | null
  headline_comments_total: number | null
  headline_shares_total: number | null
  watched_full_video_rate: number | null
  average_watch_time_seconds: number | null
  analytics_new_followers: number | null
  has_studio_data: boolean
  has_perf_data: boolean
  has_sales_data: boolean
}

export type CoverageV2 = {
  totalVideos: number
  studioCount: number
  studioPct: number
  totalViews: number
  avgWatchRate: number | null
}

const PAGE_SIZE = 50

const SELECT_COLS = [
  'id', 'canonical_id', 'tiktok_video_id', 'video_title', 'posted_at', 'duration_sec',
  'post_url', 'thumbnail_url', 'thumbnail_source', 'content_type',
  'last_scraped_at', 'headline_video_views', 'headline_likes_total', 'headline_comments_total',
  'headline_shares_total', 'watched_full_video_rate', 'average_watch_time_seconds',
  'analytics_new_followers', 'has_studio_data', 'has_perf_data', 'has_sales_data',
].join(',')

export async function getVideoOverviewV2(page = 1): Promise<{
  data: VideoOverviewV2Row[] | null
  coverage: CoverageV2 | null
  total: number
  pageSize: number
  error: string | null
}> {
  const empty = { data: null, coverage: null, total: 0, pageSize: PAGE_SIZE, error: null }
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ...empty, error: 'Unauthenticated' }

    const offset = (page - 1) * PAGE_SIZE

    const [dataRes, coverageRes] = await Promise.all([
      supabase
        .from('video_overview_cache_v2')
        .select(SELECT_COLS, { count: 'exact' })
        .eq('created_by', user.id)
        .order('headline_video_views', { ascending: false, nullsFirst: false })
        .range(offset, offset + PAGE_SIZE - 1),
      supabase
        .from('video_overview_cache_v2')
        .select('has_studio_data, headline_video_views, watched_full_video_rate')
        .eq('created_by', user.id),
    ])

    if (dataRes.error) return { ...empty, error: dataRes.error.message }

    const allRows = (coverageRes.data ?? []) as Array<{
      has_studio_data: boolean
      headline_video_views: number | null
      watched_full_video_rate: number | null
    }>
    const totalVideos = allRows.length
    const studioCount = allRows.filter(r => r.has_studio_data).length
    const totalViews = allRows.reduce((s, r) => s + (r.headline_video_views ?? 0), 0)
    const watchRates = allRows.filter(r => r.watched_full_video_rate !== null).map(r => r.watched_full_video_rate as number)
    const avgWatchRate = watchRates.length > 0 ? watchRates.reduce((a, b) => a + b) / watchRates.length : null

    return {
      data: (dataRes.data ?? []) as unknown as VideoOverviewV2Row[],
      coverage: {
        totalVideos,
        studioCount,
        studioPct: totalVideos > 0 ? Math.round((studioCount / totalVideos) * 100) : 0,
        totalViews,
        avgWatchRate,
      },
      total: dataRes.count ?? 0,
      pageSize: PAGE_SIZE,
      error: null,
    }
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function rebuildCacheV2(): Promise<{
  ok: boolean
  processed: number
  withThumbnail: number
  withStudioData: number
  error: string | null
}> {
  const empty = { ok: false, processed: 0, withThumbnail: 0, withStudioData: 0, error: null }
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ...empty, error: 'Unauthenticated' }

    const serviceClient = createServiceClient()
    const stats = await rebuildVideoOverviewCacheV2(serviceClient, user.id)
    return {
      ok: stats.cacheErrors.length === 0,
      processed: stats.processed,
      withThumbnail: stats.withThumbnail,
      withStudioData: stats.withStudioData,
      error: stats.cacheErrors.length > 0 ? stats.cacheErrors[0] : null,
    }
  } catch (e) {
    return { ...empty, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
