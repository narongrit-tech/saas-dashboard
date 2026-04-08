import Link from 'next/link'
import { AlertCircle, GitBranch } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { getAttributionFull } from '../../actions'

export const dynamic = 'force-dynamic'

const BUCKET_STYLE: Record<string, string> = {
  realized: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  open: 'text-blue-700 bg-blue-50 border-blue-200',
  lost: 'text-red-700 bg-red-50 border-red-200',
  unknown: 'text-muted-foreground bg-muted border-border',
}

// Sub-navigation shared with orders explorer
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

  const { data: rows, summary, total, error } = await getAttributionFull(
    { contentId: searchParams.content_id, bucket: searchParams.bucket },
    limit,
    offset
  )

  const totalPages = Math.ceil(total / limit)

  function filterHref(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams()
    const merged: Record<string, string | undefined> = {
      content_id: searchParams.content_id,
      bucket: searchParams.bucket,
      ...overrides,
    }
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v)
    }
    const str = params.toString()
    return str ? `?${str}` : '?'
  }

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Analysis sub-nav */}
      <AnalysisNav current="attribution" />

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Attribution</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Content → product → order mapping — last-touch winners
          </p>
        </div>
        {/* Bucket filter */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground">Bucket:</span>
          {(['', 'realized', 'open', 'lost'] as const).map((b) => (
            <Button
              key={b || 'all'}
              asChild
              size="sm"
              variant={(!searchParams.bucket && !b) || searchParams.bucket === b ? 'default' : 'outline'}
            >
              <Link href={filterHref({ bucket: b || undefined, page: '1' })}>
                {b || 'All'}
              </Link>
            </Button>
          ))}
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Mapped rows', value: summary.mappedRows.toLocaleString() },
          { label: 'Unique content IDs', value: summary.uniqueContentIds.toLocaleString() },
          { label: 'Unique products', value: summary.uniqueProducts.toLocaleString() },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-semibold tabular-nums mt-0.5">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Active filters */}
      {(searchParams.content_id) && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {searchParams.content_id && (
            <span className="px-2 py-0.5 rounded border bg-muted font-mono">
              content: {searchParams.content_id}
              <Link href={filterHref({ content_id: undefined, page: '1' })} className="ml-1.5 text-muted-foreground hover:text-foreground">×</Link>
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {rows.length === 0 && !error ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <GitBranch className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No attribution rows</p>
            <p className="text-xs text-muted-foreground">Attribution is computed automatically from order facts.</p>
          </CardContent>
        </Card>
      ) : (
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
                  {rows.map((row, i) => (
                    <TableRow key={`${row.orderId}-${row.productId}-${i}`}>
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
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={filterHref({ page: String(page - 1) })}>Previous</Link>
              </Button>
            )}
            {page < totalPages && (
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
