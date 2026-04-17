import Link from 'next/link'
import { AlertCircle, GitBranch } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getAttributionFull } from '../../actions'
import { formatAttributionDiagnostics } from '../../attribution-query-utils'

export const dynamic = 'force-dynamic'

const BUCKET_STYLE: Record<string, string> = {
  realized: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  open: 'text-blue-700 bg-blue-50 border-blue-200',
  lost: 'text-red-700 bg-red-50 border-red-200',
  unknown: 'text-muted-foreground bg-muted border-border',
}

function AnalysisNav({ current }: { current: 'orders' | 'attribution' }) {
  return (
    <div className="flex items-center gap-1 border-b pb-3 mb-1">
      <Link
        href="/content-ops/analysis/orders"
        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          current === 'orders'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
      >
        Orders Explorer
      </Link>
      <Link
        href="/content-ops/analysis/attribution"
        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          current === 'attribution'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
      >
        Attribution
      </Link>
    </div>
  )
}

export default async function AttributionAnalysisPage({
  searchParams,
}: {
  searchParams: { content_id?: string; bucket?: string; page?: string }
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  const {
    data: rows,
    summary,
    total,
    totalKnown,
    hasMore,
    state,
    notice,
    error,
    diagnostics,
  } = await getAttributionFull(
    { contentId: searchParams.content_id, bucket: searchParams.bucket },
    limit,
    offset
  )

  function filterHref(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams()
    const merged: Record<string, string | undefined> = {
      content_id: searchParams.content_id,
      bucket: searchParams.bucket,
      ...overrides,
    }
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value)
    }
    const query = params.toString()
    return query ? `?${query}` : '?'
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <AnalysisNav current="attribution" />

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Attribution</h1>
            <Badge variant="outline" className="text-xs">
              {state === 'success'
                ? 'Success'
                : state === 'partial'
                ? 'Limited'
                : state === 'timed_out'
                ? 'Timed Out'
                : state === 'failed'
                ? 'Failed'
                : 'No Data'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {totalKnown && total !== null
              ? `${total.toLocaleString()} rows in scope`
              : rows.length > 0
              ? `${rows.length.toLocaleString()} rows loaded in stable mode`
              : 'No rows loaded yet'}
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            Content &#8594; product &#8594; order mapping &#8594; last-touch winners
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground">Bucket:</span>
          {(['', 'realized', 'open', 'lost'] as const).map((bucket) => (
            <Button
              key={bucket || 'all'}
              asChild
              size="sm"
              variant={(!searchParams.bucket && !bucket) || searchParams.bucket === bucket ? 'default' : 'outline'}
            >
              <Link href={filterHref({ bucket: bucket || undefined, page: '1' })}>
                {bucket || 'All'}
              </Link>
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: summary.mode === 'exact' ? 'Mapped rows' : 'Loaded rows',
            value: summary.mappedRows.toLocaleString(),
          },
          {
            label: summary.mode === 'exact' ? 'Unique content IDs' : 'Content IDs in slice',
            value: summary.uniqueContentIds.toLocaleString(),
          },
          {
            label: summary.mode === 'exact' ? 'Unique products' : 'Products in slice',
            value: summary.uniqueProducts.toLocaleString(),
          },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-xl font-semibold tabular-nums mt-0.5">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {searchParams.content_id && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="px-2 py-0.5 rounded border bg-muted font-mono">
            content: {searchParams.content_id}
            <Link href={filterHref({ content_id: undefined, page: '1' })} className="ml-1.5 text-muted-foreground hover:text-foreground">x</Link>
          </span>
        </div>
      )}

      {notice && (
        <div className="text-sm text-amber-700 border border-amber-300/60 bg-amber-50 rounded-md px-3 py-2">
          <p>{notice}</p>
          <p className="text-xs text-amber-700/80 mt-1">{formatAttributionDiagnostics(diagnostics)}</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <div>
            <p>{error}</p>
            <p className="text-xs text-destructive/80 mt-1">{formatAttributionDiagnostics(diagnostics)}</p>
          </div>
        </div>
      )}

      {rows.length === 0 && state === 'no_data' && !error && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <GitBranch className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No attribution rows</p>
            <p className="text-xs text-muted-foreground">Attribution is computed automatically from order facts.</p>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Content ID</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Bucket</TableHead>
                    <TableHead className="text-right">Order Items</TableHead>
                    <TableHead className="text-right">Settled</TableHead>
                    <TableHead>Order date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => (
                    <TableRow key={`${row.orderId}-${row.productId}-${index}`}>
                      <TableCell>
                        <Link
                          href={filterHref({ content_id: row.contentId, page: '1' })}
                          className="text-xs font-mono hover:underline text-primary"
                        >
                          {row.contentId}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/content-ops/products/${encodeURIComponent(row.productId)}`}
                          className="text-sm hover:underline"
                        >
                          {row.productName ?? row.productId}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs font-mono">{row.orderId}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.normalizedStatus}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${BUCKET_STYLE[row.businessBucket] ?? BUCKET_STYLE.unknown}`}>
                          {row.businessBucket}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{row.orderItems.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{row.settledItems.toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {row.orderDate
                          ? new Date(row.orderDate).toLocaleDateString('th-TH', {
                              year: 'numeric', month: 'short', day: 'numeric',
                            })
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {totalKnown && total !== null
              ? `Page ${page} · ${total.toLocaleString()} rows`
              : `Page ${page} · exact total unavailable in stable mode`}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={filterHref({ page: String(page - 1) })}>Previous</Link>
              </Button>
            )}
            {hasMore && (
              <Button asChild variant="outline" size="sm">
                <Link href={filterHref({ page: String(page + 1) })}>Next</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
