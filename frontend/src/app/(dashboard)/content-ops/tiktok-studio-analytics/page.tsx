import Link from 'next/link'
import { Upload, Eye, TrendingUp, Users, AlertCircle, Play } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getStudioAnalyticsSummary, getStudioAnalyticsVideos, getLatestBatchInfo } from './actions'

export const dynamic = 'force-dynamic'

type TrafficSource = { name: string; share: number }

function fmtViews(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return n.toLocaleString()
}

function fmtSec(n: number | null): string {
  if (n === null) return '—'
  if (n < 60) return `${n.toFixed(1)}s`
  return `${Math.floor(n / 60)}m ${Math.round(n % 60)}s`
}

function topSource(sources: TrafficSource[] | null): string {
  if (!sources || sources.length === 0) return '—'
  return [...sources].sort((a, b) => b.share - a.share)[0]?.name ?? '—'
}

export default async function StudioAnalyticsPage() {
  const [summaryRes, videosRes, batchRes] = await Promise.all([
    getStudioAnalyticsSummary(),
    getStudioAnalyticsVideos(1040, 0, 'views'),
    getLatestBatchInfo(),
  ])

  const summary = summaryRes.data
  const videos = videosRes.data ?? []
  const batch = batchRes.data
  const hasData = (summary?.totalVideos ?? 0) > 0

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">TikTok Studio Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Video performance stats scraped from TikTok Studio
            {batch?.lastImportAt && (
              <span className="ml-2 text-xs">
                · Last import: {new Date(batch.lastImportAt).toLocaleDateString('th-TH')}
              </span>
            )}
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/content-ops/tiktok-studio-analytics/upload">
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Import snapshot
          </Link>
        </Button>
      </div>

      {(summaryRes.error || videosRes.error) && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {summaryRes.error ?? videosRes.error}
        </div>
      )}

      {!hasData ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <Play className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">ยังไม่มีข้อมูล</p>
            <p className="text-xs text-muted-foreground">
              Import JSON snapshot จาก TikTok Studio analytics scraper
            </p>
            <Button asChild size="sm" className="mt-1">
              <Link href="/content-ops/tiktok-studio-analytics/upload">
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Import snapshot
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: 'VDO ทั้งหมด',
                value: summary!.totalVideos.toLocaleString(),
                icon: Play,
              },
              {
                label: 'Total Views',
                value: fmtViews(summary!.totalViews),
                icon: Eye,
              },
              {
                label: 'Avg Watch Rate',
                value: summary!.avgWatchRate !== null
                  ? `${(summary!.avgWatchRate * 100).toFixed(1)}%`
                  : '—',
                icon: TrendingUp,
              },
              {
                label: 'New Followers',
                value: summary!.totalNewFollowers.toLocaleString(),
                icon: Users,
              },
            ].map((kpi) => (
              <Card key={kpi.label}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <kpi.icon className="h-4 w-4 shrink-0" />
                    <span className="text-xs font-medium uppercase tracking-wide">{kpi.label}</span>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums">{kpi.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Video table */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
              รายการ VDO — เรียงตาม Views ({videos.length.toLocaleString()} รายการ)
            </p>
            <div className="rounded-lg border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-8">#</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground min-w-48">VDO</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Views</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Likes</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Comments</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Watch%</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Avg Watch</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Followers+</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Top Source</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">Posted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {videos.map((v, i) => (
                      <tr key={v.post_id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2 max-w-xs">
                          <a
                            href={v.post_url ?? `https://www.tiktok.com/video/${v.post_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium line-clamp-1 hover:underline"
                            title={v.video_title ?? v.post_id}
                          >
                            {v.video_title ?? v.post_id}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          {fmtViews(v.headline_video_views)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {fmtViews(v.headline_likes_total)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {v.headline_comments_total?.toLocaleString() ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {v.watched_full_video_rate !== null ? (
                            <span className={
                              v.watched_full_video_rate >= 0.2 ? 'text-emerald-600 font-medium' :
                              v.watched_full_video_rate >= 0.1 ? 'text-amber-600' : 'text-muted-foreground'
                            }>
                              {(v.watched_full_video_rate * 100).toFixed(1)}%
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {fmtSec(v.average_watch_time_seconds)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {v.new_followers !== null ? `+${v.new_followers.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {topSource(v.traffic_sources as TrafficSource[] | null)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {v.posted_at ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
