import Link from 'next/link'
import { AlertCircle, CheckCircle2, Clock, HelpCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getMappingReview, getMappingStatusCounts } from '../video-master/actions'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'unmatched', label: 'Unmatched' },
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'conflict', label: 'Conflict' },
] as const

type TabKey = (typeof TABS)[number]['key']

function StatusBadge({ status }: { status: string }) {
  if (status === 'matched') return (
    <span className="flex items-center gap-1 text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" />matched
    </span>
  )
  if (status === 'needs_review') return (
    <span className="flex items-center gap-1 text-amber-600">
      <Clock className="h-3.5 w-3.5" />needs_review
    </span>
  )
  if (status === 'conflict') return (
    <span className="flex items-center gap-1 text-destructive">
      <AlertCircle className="h-3.5 w-3.5" />conflict
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <HelpCircle className="h-3.5 w-3.5" />unmatched
    </span>
  )
}

export default async function VideoMappingReviewPage({
  searchParams,
}: {
  searchParams: { status?: string }
}) {
  const activeTab = (TABS.find(t => t.key === searchParams?.status)?.key ?? 'all') as TabKey

  const [countsRes, mappingsRes] = await Promise.all([
    getMappingStatusCounts(),
    getMappingReview(activeTab, 500, 0),
  ])

  const counts = countsRes
  const mappings = mappingsRes.data ?? []

  const tabCounts: Record<TabKey, number> = {
    all: counts.all,
    unmatched: counts.unmatched,
    needs_review: counts.needs_review,
    conflict: counts.conflict,
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Video Mapping Review</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            ตรวจสอบ content ID ที่แมพจาก Affiliate → video_master
          </p>
        </div>
        <Link
          href="/content-ops/video-master"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Video Overview
        </Link>
      </div>

      {(countsRes.error || mappingsRes.error) && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {countsRes.error ?? mappingsRes.error}
        </div>
      )}

      {/* Status summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { key: 'unmatched', label: 'Unmatched', color: 'text-muted-foreground', icon: HelpCircle },
          { key: 'needs_review', label: 'Needs Review', color: 'text-amber-600', icon: Clock },
          { key: 'conflict', label: 'Conflict', color: 'text-destructive', icon: AlertCircle },
          { key: 'all', label: 'Total', color: 'text-foreground', icon: CheckCircle2 },
        ].map((s) => (
          <Card key={s.key}>
            <CardContent className="pt-4 pb-3">
              <div className={cn('flex items-center gap-1.5 text-xs font-medium mb-1', s.color)}>
                <s.icon className="h-3.5 w-3.5" />
                {s.label}
              </div>
              <p className="text-2xl font-semibold tabular-nums">{tabCounts[s.key as TabKey]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`?status=${tab.key}`}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5',
              activeTab === tab.key
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full tabular-nums">
              {tabCounts[tab.key]}
            </span>
          </Link>
        ))}
      </div>

      {/* Table */}
      {mappings.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">ไม่มีรายการ</p>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Source</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">External ID</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground min-w-40">Video (matched)</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Stage</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Conf.</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Reason</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {mappings.map((m) => (
                  <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2">
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted">{m.source_type}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{m.external_id}</td>
                    <td className="px-3 py-2 text-xs">
                      <StatusBadge status={m.match_status} />
                    </td>
                    <td className="px-3 py-2 text-xs max-w-xs">
                      {m.canonical_id && m.tiktok_video_id ? (
                        <Link
                          href={`/content-ops/video-master/${m.tiktok_video_id}`}
                          className="hover:underline text-sky-600 line-clamp-1"
                        >
                          {m.video_title ?? m.tiktok_video_id}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                      {m.match_stage ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                      {m.confidence_score !== null ? `${(m.confidence_score * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-48 truncate" title={m.match_reason ?? ''}>
                      {m.match_reason ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {m.last_seen_at ? new Date(m.last_seen_at).toLocaleDateString('th-TH') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mappingsRes.total > 500 && (
            <div className="px-4 py-2 border-t text-xs text-muted-foreground">
              แสดง 500 รายการแรก จากทั้งหมด {mappingsRes.total.toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
