'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { VideoOverviewV2MasterRow } from './actions'
import { bulkExcludeVideos, bulkUnexcludeVideos } from './actions'

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

interface VideoTableV2Props {
  rows: VideoOverviewV2MasterRow[]
  total: number
  page: number
  pageSize: number
  showExcluded: boolean
}

export function VideoTableV2({ rows, total: _total, page, pageSize, showExcluded }: VideoTableV2Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  function toggleSelect(canonicalId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(canonicalId)) next.delete(canonicalId)
      else next.add(canonicalId)
      return next
    })
  }

  function selectAll() { setSelected(new Set(rows.map(r => r.canonical_id))) }
  function clearSelection() { setSelected(new Set()) }

  async function handleExclude() {
    const ids = [...selected]
    setActionMsg(null)
    const res = await bulkExcludeVideos(ids)
    if (res.ok) {
      setActionMsg(`Excluded ${res.count} videos`)
      setSelected(new Set())
      startTransition(() => router.refresh())
    } else {
      setActionMsg(`Error: ${res.error}`)
    }
  }

  async function handleUnexclude() {
    const ids = [...selected]
    setActionMsg(null)
    const res = await bulkUnexcludeVideos(ids)
    if (res.ok) {
      setActionMsg(`Restored ${res.count} videos`)
      setSelected(new Set())
      startTransition(() => router.refresh())
    } else {
      setActionMsg(`Error: ${res.error}`)
    }
  }

  const hasSelection = selected.size > 0
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.canonical_id))

  return (
    <div className="space-y-2">
      {/* Bulk action bar */}
      {hasSelection && (
        <div className="flex items-center gap-3 px-3 py-2 bg-muted/60 rounded-lg border text-sm">
          <span className="font-medium">{selected.size} รายการที่เลือก</span>
          {actionMsg && <span className="text-xs text-muted-foreground">{actionMsg}</span>}
          <div className="flex items-center gap-2 ml-auto">
            <Button size="sm" variant="outline" className="h-7" onClick={clearSelection}>ยกเลิก</Button>
            {showExcluded && (
              <Button size="sm" variant="default" className="h-7" onClick={handleUnexclude} disabled={isPending}>
                Restore
              </Button>
            )}
            <Button size="sm" variant="destructive" className="h-7" onClick={handleExclude} disabled={isPending}>
              Exclude
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={allSelected}
                    onChange={e => e.target.checked ? selectAll() : clearSelection()}
                  />
                </th>
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
              {rows.map((v, i) => {
                const rowNum = (page - 1) * pageSize + i + 1
                const isSelected = selected.has(v.canonical_id)
                const sourceBadge = v.has_studio_data ? 'Studio' : 'Master'
                const badgeColor = v.has_studio_data
                  ? 'bg-violet-100 text-violet-700'
                  : 'bg-amber-100 text-amber-700'

                return (
                  <tr
                    key={v.tiktok_video_id}
                    className={cn(
                      'hover:bg-muted/30 transition-colors cursor-pointer',
                      isSelected && 'bg-primary/5',
                      v.is_excluded && 'opacity-50'
                    )}
                    onClick={() => router.push(`/content-ops/video-master/${v.tiktok_video_id}`)}
                  >
                    <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={isSelected}
                        onChange={() => toggleSelect(v.canonical_id)}
                      />
                    </td>
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
                              onClick={e => e.stopPropagation()}
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
                          <div className="flex items-start gap-1">
                            <span
                              className="text-sm font-medium line-clamp-2 leading-snug flex-1"
                              title={v.video_title ?? v.tiktok_video_id}
                            >
                              {v.video_title ?? v.tiktok_video_id}
                            </span>
                            {v.post_url && (
                              <a
                                href={v.post_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 mt-0.5 p-0.5 text-muted-foreground hover:text-foreground"
                                onClick={e => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
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
    </div>
  )
}
