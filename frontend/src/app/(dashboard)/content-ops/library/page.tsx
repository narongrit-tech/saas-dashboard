import {
  AlertCircle,
  ClipboardList,
  Clock3,
  Database,
  ExternalLink,
  Film,
  Link2,
  Pin,
  Rows3,
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
  getTikTokStudioLatestImport,
  type TikTokStudioImportedContentRecord,
  type TikTokStudioLatestImport,
  type TikTokStudioSnapshotManifestEntry,
} from '@/lib/content-ops/tiktok-studio-import'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

function getSummaryStats(importResult: TikTokStudioLatestImport) {
  const items = importResult.items
  const latestSnapshot = importResult.latestSnapshot

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
      value: items.filter((item) => item.latest_metrics?.is_pinned).length,
      icon: Pin,
      iconClassName: 'text-amber-600',
      panelClassName: 'bg-amber-50',
    },
    {
      label: 'Snapshot Updated',
      value: latestSnapshot ? formatShortDateTime(latestSnapshot.scraped_at) : 'Missing',
      icon: Clock3,
      iconClassName: 'text-emerald-600',
      panelClassName: 'bg-emerald-50',
    },
    {
      label: 'Snapshot Runs',
      value: importResult.snapshotHistory.length,
      icon: Rows3,
      iconClassName: 'text-sky-600',
      panelClassName: 'bg-sky-50',
    },
  ]
}

function ContentLibraryTableRow({ item }: { item: TikTokStudioImportedContentRecord }) {
  const metrics = item.latest_metrics
  const sourceId = item.post_id ?? item.post_url.split('/').filter(Boolean).at(-1) ?? '-'

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
            {metrics?.duration ?? '--'} - Source ID: {sourceId}
          </div>
        </div>
      </TableCell>
      <TableCell>{metrics?.privacy ?? '-'}</TableCell>
      <TableCell>{formatMetric(metrics?.views_total ?? null)}</TableCell>
      <TableCell>{formatMetric(metrics?.likes_total ?? null)}</TableCell>
      <TableCell>{formatMetric(metrics?.comments_total ?? null)}</TableCell>
      <TableCell className="text-muted-foreground">{formatShortDateTime(item.created_at)}</TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={cn(
            'font-medium',
            metrics?.is_pinned
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-border/70 bg-background text-muted-foreground'
          )}
        >
          {metrics?.is_pinned ? 'Pinned' : 'No'}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">Unassigned</TableCell>
      <TableCell className="text-muted-foreground">
        {formatShortDateTime(metrics?.scraped_at ?? item.last_seen_at)}
      </TableCell>
    </TableRow>
  )
}

function SnapshotHistoryRow({
  snapshot,
  isLatest,
}: {
  snapshot: TikTokStudioSnapshotManifestEntry
  isLatest: boolean
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        <div className="space-y-1">
          <div>{snapshot.snapshot_id}</div>
          <div className="text-xs text-muted-foreground">
            Batches: {snapshot.harvested_batch_count ?? 1}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatShortDateTime(snapshot.scraped_at)}
      </TableCell>
      <TableCell>{snapshot.row_count}</TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={cn('font-medium', getSnapshotStatusBadgeClassName(snapshot))}
        >
          {formatSnapshotStatus(snapshot)}
        </Badge>
      </TableCell>
      <TableCell>
        {isLatest ? (
          <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
            Latest
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
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

function formatImportStatusLabel(status: TikTokStudioLatestImport['status']) {
  if (status === 'ready') return 'Ready'
  if (status === 'error') return 'Error'
  return 'Empty'
}

function formatImportSource(source: TikTokStudioLatestImport['source']) {
  if (source === 'local_registry') return 'Local registry'
  if (source === 'sample_fallback') return 'Checked-in sample fallback'
  return 'No source'
}

function formatSnapshotStatus(snapshot: TikTokStudioSnapshotManifestEntry) {
  if (snapshot.import_status === 'error') return 'Error'
  if (snapshot.completion_status === 'completed') return 'Completed'
  if (snapshot.completion_status === 'stopped') return 'Stopped'
  if (snapshot.import_status === 'empty') return 'Empty'
  return 'Ready'
}

function formatStopReason(stopReason: TikTokStudioSnapshotManifestEntry['stop_reason']) {
  if (stopReason === 'max_rows_reached') return 'Max rows reached'
  if (stopReason === 'max_scroll_rounds_reached') return 'Max scroll rounds reached'
  if (stopReason === 'no_new_rows_limit_reached') return 'No new rows limit reached'
  return '-'
}

function getImportStatusBadgeClassName(status: TikTokStudioLatestImport['status']) {
  if (status === 'ready') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  if (status === 'error') {
    return 'border-rose-200 bg-rose-50 text-rose-700'
  }

  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function getSnapshotStatusBadgeClassName(snapshot: TikTokStudioSnapshotManifestEntry) {
  if (snapshot.import_status === 'error') {
    return 'border-rose-200 bg-rose-50 text-rose-700'
  }

  if (snapshot.completion_status === 'completed') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  if (snapshot.completion_status === 'stopped') {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }

  if (snapshot.import_status === 'empty') {
    return 'border-slate-200 bg-slate-50 text-slate-700'
  }

  return 'border-primary/20 bg-primary/5 text-primary'
}

function renderTableState(importResult: TikTokStudioLatestImport) {
  if (importResult.status === 'error') {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-10 text-center text-sm text-rose-700">
        The latest TikTok Studio snapshot could not be loaded.
        <div className="mt-2 text-rose-600">{importResult.errorMessage ?? 'Unknown registry error.'}</div>
      </div>
    )
  }

  if (importResult.items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        No TikTok Studio snapshot registry entry has been imported yet. Run the Studio ingester to
        create a harvested snapshot and latest import files.
      </div>
    )
  }

  return (
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
        {importResult.items.map((item) => (
          <ContentLibraryTableRow key={item.post_url} item={item} />
        ))}
      </TableBody>
    </Table>
  )
}

function renderHistoryState(importResult: TikTokStudioLatestImport) {
  if (importResult.snapshotHistory.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        Snapshot history will appear here after the first registry-backed harvest completes.
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Snapshot</TableHead>
          <TableHead className="w-36">Scraped</TableHead>
          <TableHead className="w-24">Rows</TableHead>
          <TableHead className="w-28">Status</TableHead>
          <TableHead className="w-24">Latest</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {importResult.snapshotHistory.map((snapshot) => (
          <SnapshotHistoryRow
            key={snapshot.snapshot_id}
            snapshot={snapshot}
            isLatest={snapshot.snapshot_id === importResult.manifest?.latest_snapshot_id}
          />
        ))}
      </TableBody>
    </Table>
  )
}

export default async function ContentLibraryPage() {
  const importResult = await getTikTokStudioLatestImport()
  const summaryStats = getSummaryStats(importResult)

  return (
    <div className="space-y-6 pb-8">
      <Card className="overflow-hidden border-border/70">
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr),420px] lg:items-start">
          <div className="space-y-4">
            <Badge variant="outline" className="w-fit border-primary/20 bg-primary/5 text-primary">
              Content Ops - TikTok Studio Phase 2
            </Badge>
            <div className="space-y-2">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Content Ops
              </p>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Content Ops / Content Library
              </h1>
              <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
                Phase 2 extends TikTok Studio ingestion from visible rows to controlled multi-batch
                harvesting while preserving the snapshot registry, normalized content items, and
                per-snapshot metric history.
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
              The dashboard imports the latest harvested snapshot from the local registry.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div>
                <div className="font-medium text-foreground">Import Status</div>
                <div className="mt-1 text-muted-foreground">
                  {importResult.latestSnapshot
                    ? `Snapshot ${importResult.latestSnapshot.snapshot_id}`
                    : 'No snapshot selected yet.'}
                </div>
              </div>
              <Badge
                variant="outline"
                className={cn('font-medium', getImportStatusBadgeClassName(importResult.status))}
              >
                {formatImportStatusLabel(importResult.status)}
              </Badge>
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">Latest Harvest Summary</div>
              <div className="mt-1 text-muted-foreground">
                Rows: {importResult.latestSnapshot?.row_count ?? 0} | Batches:{' '}
                {importResult.latestSnapshot?.harvested_batch_count ?? 0}
              </div>
              <div className="mt-1 text-muted-foreground">
                Completion: {formatSnapshotStatus(importResult.latestSnapshot ?? fallbackSnapshot())}
              </div>
              <div className="mt-1 text-muted-foreground">
                Stop reason: {formatStopReason(importResult.latestSnapshot?.stop_reason)}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">Latest Scraped At</div>
              <div className="mt-1 text-muted-foreground">
                {formatShortDateTime(importResult.latestSnapshot?.scraped_at ?? null)}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">Source</div>
              <div className="mt-1 text-muted-foreground">
                {importResult.latestSnapshot?.page_url ?? 'TikTok Studio snapshot not found yet.'}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">Data Source</div>
              <div className="mt-1 text-muted-foreground">
                {formatImportSource(importResult.source)}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">Manifest File</div>
              <div className="mt-1 break-all text-muted-foreground">
                {importResult.manifestPath ?? 'Missing'}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">Latest Raw Snapshot</div>
              <div className="mt-1 break-all text-muted-foreground">
                {importResult.rawSnapshotPath ?? 'Missing'}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">Normalized Files</div>
              <div className="mt-1 break-all text-muted-foreground">
                Content items: {importResult.snapshotContentItemsPath ?? 'Missing'}
              </div>
              <div className="mt-1 break-all text-muted-foreground">
                Metric snapshots: {importResult.snapshotMetricSnapshotsPath ?? 'Missing'}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">Assignee</div>
              <div className="mt-1 text-muted-foreground">
                Imported rows remain unassigned in Phase 2 so assignee mapping can be added later
                without changing the harvesting flow.
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
                  Latest TikTok Studio import joined from normalized content items and metric
                  snapshots.
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent>{renderTableState(importResult)}</CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                Snapshot History
              </CardTitle>
              <CardDescription>
                Registry-backed harvest history for TikTok Studio snapshot runs.
              </CardDescription>
            </CardHeader>
            <CardContent>{renderHistoryState(importResult)}</CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Phase Scope</CardTitle>
                <CardDescription>What Phase 2 adds on top of the registry flow.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  Harvest multiple visible batches within one snapshot run using controlled scrolling
                  and in-run dedupe by post URL.
                </div>
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  Record harvest metadata including batch count, completion status, and stop reason
                  in raw snapshots and the manifest.
                </div>
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  Surface registry history in the dashboard so the latest snapshot is no longer the
                  only visible run.
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Remaining Gaps</CardTitle>
                <CardDescription>Still deferred beyond Phase 2.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  No analytics rollups, date filters, or historical trend reporting yet.
                </div>
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  No assignee-to-user mapping or editable ownership workflow yet.
                </div>
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  Harvesting still depends on TikTok Studio DOM stability and the currently
                  authenticated browser session.
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

function fallbackSnapshot(): TikTokStudioSnapshotManifestEntry {
  return {
    snapshot_id: '',
    source: 'tiktok_studio_visible_rows',
    snapshot_version: 0,
    page_url: '',
    scraped_at: '',
    row_count: 0,
    content_item_count: 0,
    metric_snapshot_count: 0,
    dedupe_key: 'post_url',
    import_status: 'empty',
    raw_snapshot_path: '',
    normalized_content_items_path: '',
    normalized_metric_snapshots_path: '',
  }
}
