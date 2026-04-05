import Link from 'next/link'
import { ArrowLeft, Database, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { getFacts } from '../actions'

export const dynamic = 'force-dynamic'

const STATUS_STYLE: Record<string, string> = {
  Completed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  Settled: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  Cancelled: 'text-red-700 bg-red-50 border-red-200',
  Pending: 'text-blue-700 bg-blue-50 border-blue-200',
}

function fmt(n: number | null, decimals = 2): string {
  if (n === null) return '—'
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export default async function FactsPage({
  searchParams,
}: {
  searchParams: { page?: string; content_id?: string; status?: string; batch_id?: string }
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  const { data: rows, total, error } = await getFacts(
    {
      contentId: searchParams.content_id,
      status: searchParams.status,
      batchId: searchParams.batch_id,
    },
    limit,
    offset
  )
  const totalPages = Math.ceil(total / limit)

  const statuses = ['Completed', 'Cancelled', 'Pending', 'Settled']

  function filterHref(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams()
    const merged = {
      content_id: searchParams.content_id,
      status: searchParams.status,
      batch_id: searchParams.batch_id,
      ...overrides,
    }
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v)
    }
    return `?${params.toString()}`
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/content-ops/tiktok-affiliate">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Overview
          </Link>
        </Button>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Normalized Facts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            content_order_facts — one row per order-line. {total.toLocaleString()} rows.
          </p>
        </div>

        {/* Active filters */}
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          {searchParams.content_id && (
            <span className="px-2 py-0.5 rounded border bg-muted font-mono">
              content: {searchParams.content_id}
              <Link href={filterHref({ content_id: undefined, page: '1' })} className="ml-1.5 text-muted-foreground hover:text-foreground">×</Link>
            </span>
          )}
          {searchParams.batch_id && (
            <span className="px-2 py-0.5 rounded border bg-muted font-mono">
              batch: {searchParams.batch_id.slice(0, 8)}…
              <Link href={filterHref({ batch_id: undefined, page: '1' })} className="ml-1.5 text-muted-foreground hover:text-foreground">×</Link>
            </span>
          )}
        </div>
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-muted-foreground">Status:</span>
        {(['', ...statuses] as const).map((s) => (
          <Button
            key={s || 'all'}
            asChild
            size="sm"
            variant={(!searchParams.status && !s) || searchParams.status === s ? 'default' : 'outline'}
          >
            <Link href={filterHref({ status: s || undefined, page: '1' })}>
              {s || 'All'}
            </Link>
          </Button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {rows.length === 0 && !error && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <Database className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No fact rows</p>
            <p className="text-xs text-muted-foreground">
              {searchParams.content_id || searchParams.status || searchParams.batch_id
                ? 'No rows match the current filters.'
                : 'Upload a TikTok affiliate file and normalize it to populate facts.'}
            </p>
            {!searchParams.content_id && !searchParams.status && !searchParams.batch_id && (
              <Button asChild size="sm" className="mt-2">
                <Link href="/content-ops/tiktok-affiliate/upload">Upload file</Link>
              </Button>
            )}
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
                    <TableHead>Content</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attribution</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">GMV</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead className="text-right">Earned</TableHead>
                    <TableHead>Order date</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link
                          href={filterHref({ content_id: row.content_id, page: '1' })}
                          className="text-sm font-mono hover:underline text-primary"
                        >
                          {row.content_id}
                        </Link>
                        {row.content_type && (
                          <p className="text-xs text-muted-foreground">{row.content_type}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-mono text-muted-foreground">{row.product_id}</p>
                        {row.product_name && (
                          <p className="text-xs text-muted-foreground truncate max-w-[160px]">{row.product_name}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{row.order_id}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${STATUS_STYLE[row.order_settlement_status] ?? 'text-muted-foreground bg-muted border-border'}`}>
                          {row.order_settlement_status}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.attribution_type}</TableCell>
                      <TableCell className="text-xs">{row.currency ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmt(row.gmv)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmt(row.total_commission_amount)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmt(row.total_earned_amount)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {row.order_date
                          ? new Date(row.order_date).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/content-ops/tiktok-affiliate/attribution?content_id=${row.content_id}`}
                          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline whitespace-nowrap"
                        >
                          attribution →
                        </Link>
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
