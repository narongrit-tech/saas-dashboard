import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink, AlertCircle, CheckCircle2, Clock, HelpCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getVideoDetail } from '../actions'

export const dynamic = 'force-dynamic'

function fmtViews(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return n.toLocaleString()
}

function fmtTHB(n: number | null): string {
  if (n === null) return '—'
  return `฿${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtSec(n: number | null): string {
  if (n === null) return '—'
  if (n < 60) return `${n.toFixed(0)}s`
  return `${Math.floor(n / 60)}m ${Math.round(n % 60)}s`
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'matched') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
  if (status === 'needs_review') return <Clock className="h-3.5 w-3.5 text-amber-500" />
  if (status === 'conflict') return <AlertCircle className="h-3.5 w-3.5 text-destructive" />
  return <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
}

export default async function VideoDetailPage({
  params,
}: {
  params: { videoId: string }
}) {
  const { video, recentEngagement, recentPerf, topProducts, sourceMappings, error } = await getVideoDetail(params.videoId)

  if (!video || error === 'Video not found') notFound()

  const tiktokUrl = video.post_url ?? `https://www.tiktok.com/video/${video.tiktok_video_id}`
  const latestEng = recentEngagement[0]
  const latestPerf = recentPerf[0]

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Back + header */}
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/content-ops/video-master">
            <ArrowLeft className="h-4 w-4 mr-1" />Video Overview
          </Link>
        </Button>
      </div>

      {error && error !== 'Video not found' && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      {/* Identity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            <a href={tiktokUrl} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1.5">
              {video.video_title ?? video.tiktok_video_id}
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Video ID</dt>
              <dd className="font-mono text-xs mt-0.5 truncate">{video.tiktok_video_id}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Posted</dt>
              <dd className="font-medium mt-0.5">{video.posted_at ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Duration</dt>
              <dd className="font-medium mt-0.5">{fmtSec(video.duration_sec)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Type</dt>
              <dd className="font-medium mt-0.5 capitalize">{video.content_type}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Studio Engagement */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Studio Analytics</CardTitle>
            {latestEng && (
              <p className="text-xs text-muted-foreground">Snapshot: {latestEng.snapshot_date}</p>
            )}
          </CardHeader>
          <CardContent>
            {!latestEng ? (
              <p className="text-sm text-muted-foreground">ไม่มีข้อมูล Studio</p>
            ) : (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Views</dt>
                  <dd className="font-semibold tabular-nums mt-0.5">{fmtViews(latestEng.headline_video_views)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Likes</dt>
                  <dd className="tabular-nums mt-0.5">{fmtViews(latestEng.headline_likes_total)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Watch%</dt>
                  <dd className={cn('font-medium tabular-nums mt-0.5',
                    latestEng.watched_full_video_rate !== null && latestEng.watched_full_video_rate >= 0.2
                      ? 'text-emerald-600' : '')}>
                    {latestEng.watched_full_video_rate !== null
                      ? `${(latestEng.watched_full_video_rate * 100).toFixed(1)}%`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Avg Watch</dt>
                  <dd className="tabular-nums mt-0.5">{fmtSec(latestEng.average_watch_time_seconds)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Followers+</dt>
                  <dd className="tabular-nums mt-0.5">
                    {latestEng.analytics_new_followers !== null ? `+${latestEng.analytics_new_followers.toLocaleString()}` : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Comments</dt>
                  <dd className="tabular-nums mt-0.5">{latestEng.headline_comments_total?.toLocaleString() ?? '—'}</dd>
                </div>
              </dl>
            )}
            {recentEngagement.length > 1 && (
              <p className="text-xs text-muted-foreground mt-3">{recentEngagement.length} snapshots total</p>
            )}
          </CardContent>
        </Card>

        {/* Perf Stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Perf Stats</CardTitle>
            {latestPerf && (
              <p className="text-xs text-muted-foreground">Import: {latestPerf.import_date}</p>
            )}
          </CardHeader>
          <CardContent>
            {!latestPerf ? (
              <p className="text-sm text-muted-foreground">ไม่มีข้อมูล Perf Stats</p>
            ) : (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">GMV</dt>
                  <dd className="font-semibold tabular-nums mt-0.5">{fmtTHB(latestPerf.gmv_total)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Units Sold</dt>
                  <dd className="tabular-nums mt-0.5">{latestPerf.units_sold?.toLocaleString() ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">CTR</dt>
                  <dd className="tabular-nums mt-0.5">{latestPerf.ctr !== null ? `${(latestPerf.ctr * 100).toFixed(2)}%` : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Watch%</dt>
                  <dd className={cn('font-medium tabular-nums mt-0.5',
                    latestPerf.watch_full_rate !== null && latestPerf.watch_full_rate >= 0.2 ? 'text-emerald-600' : '')}>
                    {latestPerf.watch_full_rate !== null
                      ? `${(latestPerf.watch_full_rate * 100).toFixed(1)}%`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Views</dt>
                  <dd className="tabular-nums mt-0.5">{fmtViews(latestPerf.views)}</dd>
                </div>
              </dl>
            )}
            {recentPerf.length > 1 && (
              <p className="text-xs text-muted-foreground mt-3">{recentPerf.length} imports total</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Products */}
      {topProducts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Sales by Product</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Product ID</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Orders</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">GMV</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {topProducts.map((p) => (
                  <tr key={p.product_id} className="hover:bg-muted/20">
                    <td className="px-4 py-2 font-mono text-xs">{p.product_id}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{p.order_count}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{fmtTHB(p.realized_gmv)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{fmtTHB(p.realized_commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Source Mappings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Source Mappings</CardTitle>
          <p className="text-xs text-muted-foreground">แสดง ID ที่แมพมาจากแต่ละแหล่งข้อมูล</p>
        </CardHeader>
        <CardContent className="p-0">
          {sourceMappings.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">ไม่มีข้อมูล mapping</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Source</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">External ID</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Stage</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Conf.</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sourceMappings.map((m) => (
                  <tr key={m.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2">
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted">{m.source_type}</span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{m.external_id}</td>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-1.5 text-xs">
                        <StatusIcon status={m.match_status} />
                        {m.match_status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums text-muted-foreground">
                      {m.match_stage ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums text-muted-foreground">
                      {m.confidence_score !== null ? `${(m.confidence_score * 100).toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
