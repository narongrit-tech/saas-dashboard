import {
  CheckCircle2,
  ClipboardList,
  Clock3,
  ExternalLink,
  Film,
  Link2,
  Pin,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getTikTokStudioImportSnapshot,
  type TikTokStudioImportRow,
} from '@/lib/content-ops/tiktok-studio-import'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

function getSummaryStats(items: TikTokStudioImportRow[], generatedAt: string | null) {
  return [
    {
      label: 'Imported Rows',
      value: items.length,
      icon: Link2,
      iconClassName: 'text-primary',
      panelClassName: 'bg-primary/5',
    },
    {
      label: 'Pinned Rows',
      value: items.filter((item) => item.is_pinned).length,
      icon: Pin,
      iconClassName: 'text-amber-600',
      panelClassName: 'bg-amber-50',
    },
    {
      label: 'Everyone',
      value: items.filter((item) => item.privacy === 'Everyone').length,
      icon: CheckCircle2,
      iconClassName: 'text-sky-600',
      panelClassName: 'bg-sky-50',
    },
    {
      label: 'Snapshot Updated',
      value: generatedAt ? formatShortDateTime(generatedAt) : 'Missing',
      icon: Clock3,
      iconClassName: 'text-emerald-600',
      panelClassName: 'bg-emerald-50',
    },
  ]
}

function ContentLibraryTableRow({ item }: { item: TikTokStudioImportRow }) {
  const videoId = item.post_url.split('/').filter(Boolean).pop() ?? '-'

  return (
    <TableRow>
      <TableCell className="min-w-[380px]">
        <div className="space-y-1">
          <div className="flex items-start gap-2">
            <a
              href={item.post_url}
              target="_blank"
              rel="noreferrer"
              className="line-clamp-2 font-medium text-foreground transition hover:text-primary"
            >
              {item.caption}
            </a>
            <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
          <div className="text-xs text-muted-foreground">
            {item.duration ?? '--'} • Source ID: {videoId}
          </div>
        </div>
      </TableCell>
      <TableCell>{item.privacy ?? '-'}</TableCell>
      <TableCell>{formatMetric(item.views_total)}</TableCell>
      <TableCell>{formatMetric(item.likes_total)}</TableCell>
      <TableCell>{formatMetric(item.comments_total)}</TableCell>
      <TableCell className="text-muted-foreground">{formatShortDateTime(item.created_at)}</TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={cn(
            'font-medium',
            item.is_pinned
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-border/70 bg-background text-muted-foreground'
          )}
        >
          {item.is_pinned ? 'Pinned' : 'No'}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">Unassigned</TableCell>
      <TableCell className="text-muted-foreground">{formatShortDateTime(item.scraped_at)}</TableCell>
    </TableRow>
  )
}

function formatMetric(value: number | null) {
  if (value === null) return '-'

  return new Intl.NumberFormat('en-US').format(value)
}

function formatShortDateTime(value: string | null) {
  if (!value) return '-'

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

export default async function ContentLibraryPage() {
  const { snapshot, snapshotPath } = await getTikTokStudioImportSnapshot()
  const importedItems = snapshot?.rows ?? []
  const summaryStats = getSummaryStats(importedItems, snapshot?.generated_at ?? null)

  return (
    <div className="space-y-6 pb-8">
      <Card className="overflow-hidden border-border/70">
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr),420px] lg:items-start">
          <div className="space-y-4">
            <Badge variant="outline" className="w-fit border-primary/20 bg-primary/5 text-primary">
              Content Ops - TikTok Studio Phase 1
            </Badge>
            <div className="space-y-2">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Content Ops
              </p>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Content Ops / Content Library
              </h1>
              <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
                Phase 1 now reads the currently visible TikTok Studio content rows from a local
                JSON snapshot and renders them directly in the dashboard without pagination,
                user-mapping, or analytics overlays yet.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {summaryStats.map((stat) => {
              const Icon = stat.icon

              return (
                <div
                  key={stat.label}
                  className="rounded-xl border border-border/70 bg-background px-4 py-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {stat.label}
                    </div>
                    <div
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-lg',
                        stat.panelClassName
                      )}
                    >
                      <Icon className={cn('h-4 w-4', stat.iconClassName)} />
                    </div>
                  </div>
                  <div className="mt-3 text-3xl font-semibold">{stat.value}</div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[360px,minmax(0,1fr)]">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Film className="h-5 w-5 text-primary" />
              TikTok Studio Import
            </CardTitle>
            <CardDescription>
              The dashboard reads the latest local snapshot generated by the TikTok Studio visible
              row ingester.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">Source</div>
              <div className="mt-1 text-muted-foreground">
                {snapshot?.page_url ?? 'TikTok Studio snapshot not found yet.'}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">Snapshot File</div>
              <div className="mt-1 break-all text-muted-foreground">{snapshotPath ?? 'Missing'}</div>
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">Extraction Scope</div>
              <div className="mt-1 text-muted-foreground">
                Visible rows only. No pagination, no date-range metrics, and no assignee mapping
                yet.
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">Assignee</div>
              <div className="mt-1 text-muted-foreground">
                Imported rows stay unassigned in Phase 1 so the field can be wired to editable user
                mapping later.
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border/70">
            <CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1.5">
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-primary" />
                  Content Library Queue
                </CardTitle>
                <CardDescription>
                  Imported TikTok Studio items from the latest local snapshot.
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent>
              {importedItems.length === 0 ? (
                <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                  No TikTok Studio snapshot has been imported yet. Run the Phase 1 ingester to
                  populate visible rows.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Post</TableHead>
                      <TableHead className="w-28">Privacy</TableHead>
                      <TableHead className="w-24">Views</TableHead>
                      <TableHead className="w-24">Likes</TableHead>
                      <TableHead className="w-24">Comments</TableHead>
                      <TableHead className="w-36">Created</TableHead>
                      <TableHead className="w-24">Pinned</TableHead>
                      <TableHead className="w-28">Assignee</TableHead>
                      <TableHead className="w-36">Imported</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importedItems.map((item) => (
                      <ContentLibraryTableRow key={item.post_url} item={item} />
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Phase Scope</CardTitle>
                <CardDescription>What this first Content Ops release covers.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  Read currently visible TikTok Studio content rows into a local JSON snapshot.
                </div>
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  Normalize caption, post URL, created time, privacy, and core engagement fields.
                </div>
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  Render imported TikTok items inside Content Ops / Content Library.
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Known Gaps</CardTitle>
                <CardDescription>Deliberately deferred beyond Phase 1.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  No pagination or infinite-scroll harvesting beyond the currently visible Studio
                  rows.
                </div>
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  No assignee-to-user mapping or inline editing yet.
                </div>
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  No analytics rollups, date filters, or historical metrics yet.
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
