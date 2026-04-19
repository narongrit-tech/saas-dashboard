import Link from 'next/link'
import { Upload, Eye, TrendingUp, Users, AlertCircle, Play, ShoppingBag, BarChart2, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getVideoOverview } from './actions'

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

export default async function VideoMasterPage({
  searchParams,
}: {
  searchParams: { view?: string; page?: string }
}) {
  const activeView = searchParams?.view === 'perf' ? 'perf' : searchParams?.view === 'sales' ? 'sales' : 'studio'
  const sortBy = activeView === 'perf' || activeView === 'sales' ? 'gmv' : 'views'
  const page = Math.max(1, parseInt(searchParams?.page ?? '1', 10) || 1)

  const { data: videos, coverage, total, pageSize, error } = await getVideoOverview(sortBy, page)

  const hasAnyData = (coverage?.totalVideos ?? 0) > 0
  const totalPages = Math.ceil(total / pageSize)

  function pageUrl(p: number) {
    return `?view=${activeView}&page=${p}`
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Video Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            ข้อมูลครบทุก VDO — Studio Analytics + Perf Stats + Sales
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button asChild size="sm" variant="outline">
            <Link href="/content-ops/tiktok-studio-analytics/upload">
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Studio Snapshot
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/content-ops/tiktok-studio-analytics/upload-perf">
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Perf Stats (.xlsx)
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/content-ops/video-mapping-review">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Mapping Review
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!hasAnyData ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <Play className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">ยังไม่มีข้อมูล VDO</p>
            <p className="text-xs text-muted-foreground">
              Import Studio Snapshot หรือ Perf Stats เพื่อเริ่มต้น
            </p>
            <div className="flex gap-2 mt-1">
              <Button asChild size="sm" variant="outline">
                <Link href="/content-ops/tiktok-studio-analytics/upload">
                  <Upload className="h-3.5 w-3.5 mr-1.5" />Studio Snapshot
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/content-ops/tiktok-studio-analytics/upload-perf">
                  <Upload className="h-3.5 w-3.5 mr-1.5" />Perf Stats
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
              {
                label: 'VDO ทั้งหมด',
                value: coverage!.totalVideos.toLocaleString(),
                icon: Play,
                sub: `Studio ${coverage!.studioPct}% · Perf ${coverage!.perfPct}% · Sales ${coverage!.salesPct}%`,
              },
              { label: 'Total Views', value: fmtViews(coverage!.totalViews), icon: Eye, sub: null },
              {
                label: 'Avg Watch%',
                value: coverage!.avgWatchRate !== null ? `${(coverage!.avgWatchRate * 100).toFixed(1)}%` : '—',
                icon: TrendingUp,
                sub: null,
              },
              { label: 'Studio Data', value: `${coverage!.studioCount}`, icon: BarChart2, sub: `${coverage!.studioPct}% ครอบคลุม` },
              { label: 'GMV รวม', value: fmtTHB(coverage!.totalGmv), icon: ShoppingBag, sub: null },
              { label: 'Sales Data', value: `${coverage!.salesCount}`, icon: Users, sub: `${coverage!.salesPct}% ครอบคลุม` },
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
            {(['studio', 'perf', 'sales'] as const).map((v) => (
              <Link
                key={v}
                href={`?view=${v}&page=1`}
                className={cn(
                  'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  activeView === v
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {v === 'studio' ? 'Studio Analytics' : v === 'perf' ? 'Perf Stats' : 'Sales'}
              </Link>
            ))}
          </div>

          {/* Row count + pagination header */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {total.toLocaleString()} VDO
              {activeView === 'studio' ? ' — เรียงตาม Views' : activeView === 'perf' ? ' — เรียงตาม GMV' : ' — เรียงตาม GMV Sales'}
              {totalPages > 1 && ` · หน้า ${page} / ${totalPages}`}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button asChild size="sm" variant="outline" disabled={page <= 1} className="h-7 w-7 p-0">
                  <Link href={page > 1 ? pageUrl(page - 1) : '#'}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                <span className="text-xs tabular-nums px-2">{page}/{totalPages}</span>
                <Button asChild size="sm" variant="outline" disabled={page >= totalPages} className="h-7 w-7 p-0">
                  <Link href={page < totalPages ? pageUrl(page + 1) : '#'}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            )}
          </div>

          {/* Video table */}
          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-8">#</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground min-w-72">VDO</th>
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
                    ) : activeView === 'perf' ? (
                      <>
                        <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">GMV</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Units</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">CTR</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Watch%</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Views</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Duration</th>
                      </>
                    ) : (
                      <>
                        <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">GMV (Sales)</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Commission</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Orders</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Products</th>
                      </>
                    )}
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(videos ?? []).map((v, i) => {
                    const rowNum = (page - 1) * pageSize + i + 1
                    const sourceBadge =
                      v.has_studio_data && v.has_perf_data && v.has_sales_data ? 'All'
                        : v.has_studio_data && v.has_perf_data ? 'Studio+Perf'
                        : v.has_studio_data && v.has_sales_data ? 'Studio+Sales'
                        : v.has_perf_data && v.has_sales_data ? 'Perf+Sales'
                        : v.has_studio_data ? 'Studio'
                        : v.has_perf_data ? 'Perf'
                        : v.has_sales_data ? 'Sales'
                        : 'Master'
                    const badgeColor =
                      v.has_studio_data && v.has_perf_data ? 'bg-emerald-100 text-emerald-700'
                        : v.has_studio_data || v.has_perf_data ? 'bg-sky-100 text-sky-700'
                        : 'bg-amber-100 text-amber-700'
                    return (
                      <tr key={v.tiktok_video_id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{rowNum}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-start gap-2.5">
                            {/* Thumbnail — links to original TikTok post */}
                            {v.thumbnail_url && v.post_url ? (
                              <a
                                href={v.post_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 block w-10 h-[54px] rounded overflow-hidden border border-muted bg-muted"
                                tabIndex={-1}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={v.thumbnail_url}
                                  alt=""
                                  loading="lazy"
                                  className="w-full h-full object-cover"
                                />
                              </a>
                            ) : (
                              <div className="shrink-0 flex items-center justify-center w-10 h-[54px] rounded border border-muted bg-muted/60">
                                <Play className="h-3 w-3 text-muted-foreground" />
                              </div>
                            )}
                            {/* Title → detail page, date below */}
                            <div className="min-w-0 flex-1 py-0.5">
                              <Link
                                href={`/content-ops/video-master/${v.tiktok_video_id}`}
                                className="text-sm font-medium line-clamp-2 hover:underline leading-snug"
                                title={v.video_title ?? v.tiktok_video_id}
                              >
                                {v.video_title ?? v.tiktok_video_id}
                              </Link>
                              <p className="text-xs text-muted-foreground mt-0.5">{v.posted_at ?? '—'}</p>
                            </div>
                          </div>
                        </td>
                        {activeView === 'studio' ? (
                          <>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtViews(v.headline_video_views)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtViews(v.headline_likes_total)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{v.headline_comments_total?.toLocaleString() ?? '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {v.watched_full_video_rate !== null ? (
                                <span className={v.watched_full_video_rate >= 0.2 ? 'text-emerald-600 font-medium' : v.watched_full_video_rate >= 0.1 ? 'text-amber-600' : 'text-muted-foreground'}>
                                  {(v.watched_full_video_rate * 100).toFixed(1)}%
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtSec(v.average_watch_time_seconds)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {v.analytics_new_followers !== null ? `+${v.analytics_new_followers.toLocaleString()}` : '—'}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{topSource(v.traffic_sources as TrafficSource[] | null)}</td>
                          </>
                        ) : activeView === 'perf' ? (
                          <>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtTHB(v.gmv_total)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{v.units_sold?.toLocaleString() ?? '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{v.ctr !== null ? `${(v.ctr * 100).toFixed(2)}%` : '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {v.perf_watch_full_rate !== null ? (
                                <span className={v.perf_watch_full_rate >= 0.2 ? 'text-emerald-600 font-medium' : v.perf_watch_full_rate >= 0.1 ? 'text-amber-600' : 'text-muted-foreground'}>
                                  {(v.perf_watch_full_rate * 100).toFixed(1)}%
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtViews(v.perf_views)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtSec(v.duration_sec)}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtTHB(v.total_realized_gmv)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtTHB(v.total_commission)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{v.settled_order_count?.toLocaleString() ?? '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{v.sales_product_count?.toLocaleString() ?? '—'}</td>
                          </>
                        )}
                        <td className="px-3 py-2">
                          <span className={cn('text-xs px-1.5 py-0.5 rounded-full', badgeColor)}>{sourceBadge}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button asChild size="sm" variant="outline" disabled={page <= 1}>
                <Link href={page > 1 ? pageUrl(page - 1) : '#'}>
                  <ChevronLeft className="h-3.5 w-3.5 mr-1" />ก่อนหน้า
                </Link>
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">หน้า {page} / {totalPages}</span>
              <Button asChild size="sm" variant="outline" disabled={page >= totalPages}>
                <Link href={page < totalPages ? pageUrl(page + 1) : '#'}>
                  ถัดไป<ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Link>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
