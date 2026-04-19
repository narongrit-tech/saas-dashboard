import Link from 'next/link'
import { Upload, Eye, TrendingUp, Users, AlertCircle, Play, ShoppingBag, BarChart2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  getCombinedSummary,
  getCombinedVideoStats,
  getLatestBatchInfo,
  getPerfLatestBatchInfo,
} from './actions'

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
  if (n < 60) return `${n.toFixed(0)}s`
  return `${Math.floor(n / 60)}m ${Math.round(n % 60)}s`
}

function fmtTHB(n: number | null): string {
  if (n === null) return '—'
  return `฿${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function topSource(sources: TrafficSource[] | null): string {
  if (!sources || sources.length === 0) return '—'
  return [...sources].sort((a, b) => b.share - a.share)[0]?.name ?? '—'
}

export default async function StudioAnalyticsPage({
  searchParams,
}: {
  searchParams: { view?: string }
}) {
  const activeView = searchParams?.view === 'perf' ? 'perf' : 'studio'

  const [summaryRes, videosRes, studioBatchRes, perfBatchRes] = await Promise.all([
    getCombinedSummary(),
    getCombinedVideoStats(2000, 0, activeView === 'perf' ? 'gmv' : 'views'),
    getLatestBatchInfo(),
    getPerfLatestBatchInfo(),
  ])

  const summary = summaryRes.data
  const videos = videosRes.data ?? []
  const studioBatch = studioBatchRes.data
  const perfBatch = perfBatchRes.data
  const hasAnyData = (summary?.totalVideos ?? 0) > 0

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">TikTok Video Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5 space-x-2">
            <span>ข้อมูล VDO แบบรวม — Studio + Perf Stats</span>
            {studioBatch?.lastImportAt && (
              <span className="text-xs">
                · Studio: {new Date(studioBatch.lastImportAt).toLocaleDateString('th-TH')}
              </span>
            )}
            {perfBatch?.lastImportAt && (
              <span className="text-xs">
                · Perf: {new Date(perfBatch.lastImportAt).toLocaleDateString('th-TH')}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button asChild size="sm" variant="outline">
            <Link href="/content-ops/tiktok-studio-analytics/upload">
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Studio Snapshot
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/content-ops/tiktok-studio-analytics/upload-perf">
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Perf Stats (.xlsx)
            </Link>
          </Button>
        </div>
      </div>

      {(summaryRes.error || videosRes.error) && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {summaryRes.error ?? videosRes.error}
        </div>
      )}

      {!hasAnyData ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <Play className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">ยังไม่มีข้อมูล</p>
            <p className="text-xs text-muted-foreground">
              Import Studio Snapshot (JSON) หรือ Perf Stats (.xlsx) เพื่อเริ่มต้น
            </p>
            <div className="flex gap-2 mt-1">
              <Button asChild size="sm" variant="outline">
                <Link href="/content-ops/tiktok-studio-analytics/upload">
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Studio Snapshot
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/content-ops/tiktok-studio-analytics/upload-perf">
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Perf Stats
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'VDO ทั้งหมด', value: summary!.totalVideos.toLocaleString(), icon: Play, sub: `Studio ${summary!.studioVideoCount} · Perf ${summary!.perfVideoCount}` },
              { label: 'Total Views', value: fmtViews(summary!.totalViews), icon: Eye, sub: null },
              { label: 'Avg Watch%', value: summary!.avgWatchRate !== null ? `${(summary!.avgWatchRate * 100).toFixed(1)}%` : '—', icon: TrendingUp, sub: null },
              { label: 'New Followers', value: summary!.totalNewFollowers.toLocaleString(), icon: Users, sub: null },
              { label: 'GMV รวม', value: fmtTHB(summary!.totalGmv), icon: ShoppingBag, sub: null },
              { label: 'Units Sold', value: summary!.totalUnitsSold.toLocaleString(), icon: BarChart2, sub: null },
            ].map((kpi) => (
              <Card key={kpi.label}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <kpi.icon className="h-4 w-4 shrink-0" />
                    <span className="text-xs font-medium uppercase tracking-wide truncate">{kpi.label}</span>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums">{kpi.value}</p>
                  {kpi.sub && <p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* View tabs */}
          <div className="flex gap-1 border-b">
            <Link
              href="?view=studio"
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeView === 'studio'
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              Studio Analytics
            </Link>
            <Link
              href="?view=perf"
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeView === 'perf'
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              Perf Stats
            </Link>
          </div>

          {/* Video table */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
              {videos.length.toLocaleString()} VDO
              {activeView === 'studio' ? ' — เรียงตาม Views' : ' — เรียงตาม GMV'}
            </p>
            <div className="rounded-lg border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-8">#</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground min-w-48">VDO</th>
                      {activeView === 'studio' ? (
                        <>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Views</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Likes</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Comments</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Watch%</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Avg Watch</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Followers+</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Top Source</th>
                        </>
                      ) : (
                        <>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">GMV</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Units</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">CTR</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Watch%</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Views</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Duration</th>
                        </>
                      )}
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">Posted</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {videos.map((v, i) => {
                      const hasStudio = v.scraped_at !== null
                      const hasPerf = v.gmv_total !== null || v.perf_views !== null
                      return (
                        <tr key={v.video_id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                          <td className="px-3 py-2 max-w-xs">
                            <a
                              href={v.post_url ?? `https://www.tiktok.com/video/${v.video_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium line-clamp-1 hover:underline"
                              title={v.video_title ?? v.video_id}
                            >
                              {v.video_title ?? v.video_id}
                            </a>
                          </td>
                          {activeView === 'studio' ? (
                            <>
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
                                {v.analytics_new_followers !== null ? `+${v.analytics_new_followers.toLocaleString()}` : '—'}
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {topSource(v.traffic_sources as TrafficSource[] | null)}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold">
                                {fmtTHB(v.gmv_total)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                {v.units_sold?.toLocaleString() ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                {v.ctr !== null ? `${(v.ctr * 100).toFixed(2)}%` : '—'}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {v.perf_watch_full_rate !== null ? (
                                  <span className={
                                    v.perf_watch_full_rate >= 0.2 ? 'text-emerald-600 font-medium' :
                                    v.perf_watch_full_rate >= 0.1 ? 'text-amber-600' : 'text-muted-foreground'
                                  }>
                                    {(v.perf_watch_full_rate * 100).toFixed(1)}%
                                  </span>
                                ) : '—'}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                {fmtViews(v.perf_views)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                {fmtSec(v.duration_sec)}
                              </td>
                            </>
                          )}
                          <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                            {v.posted_at ?? '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className={cn(
                              'text-xs px-1.5 py-0.5 rounded-full',
                              hasStudio && hasPerf
                                ? 'bg-emerald-100 text-emerald-700'
                                : hasStudio
                                ? 'bg-sky-100 text-sky-700'
                                : 'bg-amber-100 text-amber-700'
                            )}>
                              {hasStudio && hasPerf ? 'Both' : hasStudio ? 'Studio' : 'Perf'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
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
