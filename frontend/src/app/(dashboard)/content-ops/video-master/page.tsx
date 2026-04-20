import { Eye, TrendingUp, Users, AlertCircle, Play, BarChart2, ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getVideoOverviewV2Master } from './actions'
import type { VideoOverviewV2MasterFilters } from './actions'
import { FilterBarV2 } from './FilterBarV2'
import { VideoTableV2 } from './VideoTableV2'
import { RebuildCacheMasterButton } from './RebuildCacheMasterButton'

export const dynamic = 'force-dynamic'

function fmtViews(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return n.toLocaleString()
}

export default async function VideoMasterPage({
  searchParams,
}: {
  searchParams: {
    page?: string
    q?: string
    from?: string
    to?: string
    studioOnly?: string
    thumbOnly?: string
    showExcluded?: string
  }
}) {
  const page = Math.max(1, parseInt(searchParams?.page ?? '1', 10) || 1)
  const filters: VideoOverviewV2MasterFilters = {
    q: searchParams.q ?? '',
    from: searchParams.from ?? '',
    to: searchParams.to ?? '',
    studioOnly: searchParams.studioOnly === '1',
    thumbOnly: searchParams.thumbOnly === '1',
    showExcluded: searchParams.showExcluded === '1',
  }

  const { data: videos, coverage, total, pageSize, error } = await getVideoOverviewV2Master(filters, page)
  const totalPages = Math.ceil(total / pageSize)

  function pageUrl(p: number) {
    const params = new URLSearchParams()
    if (filters.q) params.set('q', filters.q)
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
    if (filters.studioOnly) params.set('studioOnly', '1')
    if (filters.thumbOnly) params.set('thumbOnly', '1')
    if (filters.showExcluded) params.set('showExcluded', '1')
    params.set('page', String(p))
    return `?${params.toString()}`
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Video Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Studio Analytics per-video — เรียงตาม Views
          </p>
        </div>
        <RebuildCacheMasterButton />
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
            { label: 'VDO ทั้งหมด', value: coverage.totalVideos.toLocaleString(), icon: Play, sub: null },
            { label: 'Total Views', value: fmtViews(coverage.totalViews), icon: Eye, sub: null },
            {
              label: 'Avg Watch%',
              value: coverage.avgWatchRate !== null ? `${(coverage.avgWatchRate * 100).toFixed(1)}%` : '—',
              icon: TrendingUp,
              sub: null,
            },
            { label: 'Studio Data', value: `${coverage.studioCount}`, icon: BarChart2, sub: `${coverage.studioPct}% coverage` },
            { label: 'หน้า', value: `${page} / ${totalPages || 1}`, icon: Users, sub: `${total.toLocaleString()} rows` },
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

      {/* Filter bar */}
      <FilterBarV2
        q={filters.q ?? ''}
        from={filters.from ?? ''}
        to={filters.to ?? ''}
        studioOnly={filters.studioOnly ?? false}
        thumbOnly={filters.thumbOnly ?? false}
        showExcluded={filters.showExcluded ?? false}
      />

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
      <VideoTableV2
        rows={videos ?? []}
        total={total}
        page={page}
        pageSize={pageSize}
        showExcluded={filters.showExcluded ?? false}
      />

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
