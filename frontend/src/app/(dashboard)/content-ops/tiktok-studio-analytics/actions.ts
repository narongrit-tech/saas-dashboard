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
