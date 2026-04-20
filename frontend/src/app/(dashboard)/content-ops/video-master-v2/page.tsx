import Link from 'next/link'
import { Eye, TrendingUp, Users, AlertCircle, Play, BarChart2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getVideoOverviewV2 } from './actions'
import { RebuildCacheV2Button } from './RebuildCacheV2Button'

export const dynamic = 'force-dynamic'

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

export default async function VideoMasterV2Page({
  searchParams,
}: {
  searchParams: { page?: string }
}) {
  const page = Math.max(1, parseInt(searchParams?.page ?? '1', 10) || 1)
  const { data: videos, coverage, total, pageSize, error } = await getVideoOverviewV2(page)

  const totalPages = Math.ceil(total / pageSize)

  function pageUrl(p: number) {
    return `?page=${p}`
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Video Overview</h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
              V2 · Clean Rebuild
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            video_overview_cache_v2 — Studio Analytics scraped per-video, self-contained
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Button asChild size="sm" variant="outline">
            <Link href="/content-ops/video-master">V1 (original)</Link>
          </Button>
          <RebuildCacheV2Button />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* KPI cards */}
      {coverage && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            {
              label: 'VDO ทั้งหมด',
              value: coverage.totalVideos.toLocaleString(),
              icon: Play,
              sub: null,
            },
            {
              label: 'Total Views',
              value: fmtViews(coverage.totalViews),
              icon: Eye,
              sub: null,
            },
            {
              label: 'Avg Watch%',
              value: coverage.avgWatchRate !== null ? `${(coverage.avgWatchRate * 100).toFixed(1)}%` : '—',
              icon: TrendingUp,
              sub: null,
            },
            {
              label: 'Studio Data',
              value: `${coverage.studioCount}`,
              icon: BarChart2,
              sub: `${coverage.studioPct}% coverage`,
            },
            {
              label: 'หน้า',
              value: `${page} / ${totalPages || 1}`,
              icon: Users,
              sub: `${total.toLocaleString()} rows`,
            },
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
      )}

      {/* Row count + pagination header */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {total.toLocaleString()} VDO — เรียงตาม Views
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
                <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Views</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Likes</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Comments</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Watch%</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Avg Watch</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Followers+</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(videos ?? []).map((v, i) => {
                const rowNum = (page - 1) * pageSize + i + 1
                const sourceBadge = v.has_studio_data ? 'Studio' : 'Master'
                const badgeColor = v.has_studio_data
                  ? 'bg-violet-100 text-violet-700'
                  : 'bg-amber-100 text-amber-700'
                return (
                  <tr key={v.tiktok_video_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{rowNum}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-2.5">
                        {v.thumbnail_url ? (
                          v.post_url ? (
                            <a
                              href={v.post_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 block w-10 h-[54px] rounded overflow-hidden border border-muted bg-muted"
                              tabIndex={-1}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={v.thumbnail_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                            </a>
                          ) : (
                            <div className="shrink-0 block w-10 h-[54px] rounded overflow-hidden border border-muted bg-muted">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={v.thumbnail_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                            </div>
                          )
                        ) : (
                          <div className="shrink-0 flex items-center justify-center w-10 h-[54px] rounded border border-muted bg-muted/60">
                            <Play className="h-3 w-3 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1 py-0.5">
                          {v.post_url ? (
                            <a
                              href={v.post_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium line-clamp-2 hover:underline leading-snug"
                              title={v.video_title ?? v.tiktok_video_id}
                            >
                              {v.video_title ?? v.tiktok_video_id}
                            </a>
                          ) : (
                            <p className="text-sm font-medium line-clamp-2 leading-snug" title={v.video_title ?? v.tiktok_video_id}>
                              {v.video_title ?? v.tiktok_video_id}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">{v.posted_at ?? '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtViews(v.headline_video_views)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtViews(v.headline_likes_total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{v.headline_comments_total?.toLocaleString() ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {v.watched_full_video_rate !== null ? (
                        <span className={cn(
                          v.watched_full_video_rate >= 0.2 ? 'text-emerald-600 font-medium' :
                          v.watched_full_video_rate >= 0.1 ? 'text-amber-600' : 'text-muted-foreground'
                        )}>
                          {(v.watched_full_video_rate * 100).toFixed(1)}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtSec(v.average_watch_time_seconds)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {v.analytics_new_followers !== null ? `+${v.analytics_new_followers.toLocaleString()}` : '—'}
                    </td>
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
    </div>
  )
}
