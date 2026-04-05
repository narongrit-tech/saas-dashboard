import Link from 'next/link'
import { ArrowLeft, AlertCircle, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { getAttribution } from '../actions'

export const dynamic = 'force-dynamic'

const BUCKET_STYLE: Record<string, string> = {
  realized: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  open: 'text-blue-700 bg-blue-50 border-blue-200',
  lost: 'text-red-700 bg-red-50 border-red-200',
  unknown: 'text-muted-foreground bg-muted border-border',
}

function fmt(n: number | null, decimals = 2): string {
  if (n === null) return '—'
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export default async function AttributionPage({
  searchParams,
}: {
  searchParams: { page?: string; content_id?: string; bucket?: string }
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  const { data: rows, total, error } = await getAttribution(
    { contentId: searchParams.content_id, bucket: searchParams.bucket },
    limit,
    offset
  )
  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-5 max-w-6xl">
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
          <h1 className="text-xl font-semibold">Attribution Winners</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            One row per (order_id, product_id) — last-touch winner. {total.toLocaleString()} rows.
          </p>
        </div>
        {/* Bucket filter */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['', 'realized', 'open', 'lost', 'unknown'] as const).map((b) => (
            <Button
              key={b || 'all'}
              asChild
              size="sm"
              variant={(!searchParams.bucket && !b) || searchParams.bucket === b ? 'default' : 'outline'}
            >
              <Link href={`?${b ? `bucket=${b}` : ''}${searchParams.content_id ? `&content_id=${searchParams.content_id}` : ''}`}>
                {b || 'All'}
              </Link>
            </Button>
          ))}
        </div>
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
            <GitBranch className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No attribution rows</p>
            <p className="text-xs text-muted-foreground">Attribution is computed automatically from facts. Upload data first.</p>
            <Button asChild size="sm" className="mt-2">
              <Link href="/content-ops/tiktok-affiliate/upload">Upload file</Link>
            </Button>
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
                    <TableHead>Currency</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Bucket</TableHead>
                    <TableHead className="text-right">GMV</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead className="text-right">Facts</TableHead>
                    <TableHead>Order date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={`${row.order_id}-${row.product_id}-${i}`}>
                      <TableCell>
                        <Link
                          href={`/content-ops/tiktok-affiliate/facts?content_id=${row.content_id}`}
                          className="text-sm font-mono hover:underline text-primary"
                        >
                          {row.content_id}
                        </Link>
                        {row.content_type && (
                          <p className="text-xs text-muted-foreground">{row.content_type}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{row.product_id}</TableCell>
                      <TableCell className="text-xs font-mono">{row.order_id}</TableCell>
                      <TableCell className="text-xs">{row.currency ?? '—'}</TableCell>
                      <TableCell className="text-xs">{row.normalized_status}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${BUCKET_STYLE[row.business_bucket] ?? BUCKET_STYLE.unknown}`}>
                          {row.business_bucket}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmt(row.gmv)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmt(row.actual_commission_total)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {row.source_fact_count}
                        {row.content_candidate_count > 1 && (
                          <span className="ml-1 text-amber-600">({row.content_candidate_count} cands)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {row.order_date
                          ? new Date(row.order_date).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
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
                <Link href={`?page=${page - 1}${searchParams.bucket ? `&bucket=${searchParams.bucket}` : ''}`}>Previous</Link>
              </Button>
            )}
            {page < totalPages && (
              <Button asChild variant="outline" size="sm">
                <Link href={`?page=${page + 1}${searchParams.bucket ? `&bucket=${searchParams.bucket}` : ''}`}>Next</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
