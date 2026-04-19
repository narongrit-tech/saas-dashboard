'use server'

import { createClient } from '@/lib/supabase/server'

export type StudioAnalyticsVideoRow = {
  post_id: string
  post_url: string | null
  video_title: string | null
  posted_at: string | null
  scraped_at: string
  headline_video_views: number | null
  headline_likes_total: number | null
  headline_comments_total: number | null
  headline_shares_total: number | null
  average_watch_time_seconds: number | null
  watched_full_video_rate: number | null
  new_followers: number | null
  traffic_sources: Array<{ name: string; share_raw: string; share: number }> | null
}

export type StudioAnalyticsSummary = {
  totalVideos: number
  totalViews: number
  avgWatchRate: number | null
  totalNewFollowers: number
  lastScrapedAt: string | null
}

export async function getStudioAnalyticsSummary(): Promise<{
  data: StudioAnalyticsSummary | null
  error: string | null
}> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { data: null, error: 'Unauthenticated' }

    const { data, error } = await supabase
      .from('tiktok_studio_analytics_rows')
      .select('headline_video_views, watched_full_video_rate, new_followers, scraped_at')
      .eq('created_by', user.id)
      .order('scraped_at', { ascending: false })

    if (error) return { data: null, error: error.message }

    const rows = data ?? []
    const totalVideos = rows.length
    const totalViews = rows.reduce((sum, r) => sum + (r.headline_video_views ?? 0), 0)
    const watchRates = rows
      .filter(r => r.watched_full_video_rate !== null)
      .map(r => r.watched_full_video_rate as number)
    const avgWatchRate = watchRates.length > 0
      ? watchRates.reduce((a, b) => a + b, 0) / watchRates.length
      : null
    const totalNewFollowers = rows.reduce((sum, r) => sum + (r.new_followers ?? 0), 0)
    const lastScrapedAt = rows[0]?.scraped_at ?? null

    return { data: { totalVideos, totalViews, avgWatchRate, totalNewFollowers, lastScrapedAt }, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function getStudioAnalyticsVideos(
  limit = 500,
  offset = 0,
  sortBy: 'views' | 'posted_at' | 'watch_rate' | 'new_followers' = 'views'
): Promise<{ data: StudioAnalyticsVideoRow[] | null; total: number; error: string | null }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { data: null, total: 0, error: 'Unauthenticated' }

    const sortColumn = {
      views: 'headline_video_views',
      posted_at: 'posted_at',
      watch_rate: 'watched_full_video_rate',
      new_followers: 'new_followers',
    }[sortBy]

    const { data, error, count } = await supabase
      .from('tiktok_studio_analytics_rows')
      .select(
        'post_id, post_url, video_title, posted_at, scraped_at, headline_video_views, headline_likes_total, headline_comments_total, headline_shares_total, average_watch_time_seconds, watched_full_video_rate, new_followers, traffic_sources',
        { count: 'exact' }
      )
      .eq('created_by', user.id)
      .order(sortColumn, { ascending: false, nullsFirst: false })
      .order('scraped_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) return { data: null, total: 0, error: error.message }

    return { data: (data ?? []) as StudioAnalyticsVideoRow[], total: count ?? 0, error: null }
  } catch (e) {
    return { data: null, total: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function getLatestBatchInfo(): Promise<{
  data: { batchCount: number; lastImportAt: string | null } | null
  error: string | null
}> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { data: null, error: 'Unauthenticated' }

    const { data, error, count } = await supabase
      .from('tiktok_studio_analytics_batches')
      .select('created_at', { count: 'exact' })
      .eq('created_by', user.id)
      .eq('status', 'staged')
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) return { data: null, error: error.message }

    return { data: { batchCount: count ?? 0, lastImportAt: data?.[0]?.created_at ?? null }, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── Combined view types ──────────────────────────────────────────────────────

export type CombinedVideoRow = {
  video_id: string
  video_title: string | null
  posted_at: string | null
  post_url: string | null
  // Analytics side
  scraped_at: string | null
  headline_video_views: number | null
  headline_likes_total: number | null
  headline_comments_total: number | null
  headline_shares_total: number | null
  average_watch_time_seconds: number | null
  watched_full_video_rate: number | null
  analytics_new_followers: number | null
  traffic_sources: Array<{ name: string; share: number }> | null
  // Perf side
  duration_sec: number | null
  gmv_total: number | null
  gmv_direct: number | null
  perf_views: number | null
  units_sold: number | null
  ctr: number | null
  perf_watch_full_rate: number | null
  perf_new_followers: number | null
}

export type CombinedSummary = {
  totalVideos: number
  studioVideoCount: number
  perfVideoCount: number
  totalViews: number
  avgWatchRate: number | null
  totalNewFollowers: number
  totalGmv: number
  totalUnitsSold: number
}

export async function getCombinedVideoStats(
  limit = 2000,
  offset = 0,
  sortBy: 'views' | 'gmv' | 'posted_at' = 'views'
): Promise<{ data: CombinedVideoRow[] | null; total: number; error: string | null }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { data: null, total: 0, error: 'Unauthenticated' }

    const sortColumn =
      sortBy === 'gmv' ? 'gmv_total' :
      sortBy === 'posted_at' ? 'posted_at' :
      'headline_video_views'

    const { data, error, count } = await supabase
      .from('tiktok_video_combined_stats' as never)
      .select('*', { count: 'exact' })
      .eq('created_by', user.id)
      .order(sortColumn, { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (error) return { data: null, total: 0, error: error.message }
    return { data: (data ?? []) as CombinedVideoRow[], total: count ?? 0, error: null }
  } catch (e) {
    return { data: null, total: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function getCombinedSummary(): Promise<{
  data: CombinedSummary | null
  error: string | null
}> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { data: null, error: 'Unauthenticated' }

    const { data, error } = await supabase
      .from('tiktok_video_combined_stats' as never)
      .select('headline_video_views, watched_full_video_rate, analytics_new_followers, gmv_total, units_sold')
      .eq('created_by', user.id)

    if (error) return { data: null, error: error.message }

    const rows = (data ?? []) as Array<{
      headline_video_views: number | null
      watched_full_video_rate: number | null
      analytics_new_followers: number | null
      gmv_total: number | null
      units_sold: number | null
    }>

    const totalVideos = rows.length
    const studioVideoCount = rows.filter(r => r.headline_video_views !== null).length
    const perfVideoCount = rows.filter(r => r.gmv_total !== null || r.units_sold !== null).length
    const totalViews = rows.reduce((s, r) => s + (r.headline_video_views ?? 0), 0)
    const watchRates = rows.filter(r => r.watched_full_video_rate !== null).map(r => r.watched_full_video_rate as number)
    const avgWatchRate = watchRates.length > 0 ? watchRates.reduce((a, b) => a + b) / watchRates.length : null
    const totalNewFollowers = rows.reduce((s, r) => s + (r.analytics_new_followers ?? 0), 0)
    const totalGmv = rows.reduce((s, r) => s + (r.gmv_total ?? 0), 0)
    const totalUnitsSold = rows.reduce((s, r) => s + (r.units_sold ?? 0), 0)

    return {
      data: { totalVideos, studioVideoCount, perfVideoCount, totalViews, avgWatchRate, totalNewFollowers, totalGmv, totalUnitsSold },
      error: null,
    }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function getPerfLatestBatchInfo(): Promise<{
  data: { batchCount: number; lastImportAt: string | null } | null
  error: string | null
}> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { data: null, error: 'Unauthenticated' }

    const { data, error, count } = await supabase
      .from('tiktok_video_perf_import_batches')
      .select('created_at', { count: 'exact' })
      .eq('created_by', user.id)
      .eq('status', 'staged')
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) return { data: null, error: error.message }
    return { data: { batchCount: count ?? 0, lastImportAt: data?.[0]?.created_at ?? null }, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}
