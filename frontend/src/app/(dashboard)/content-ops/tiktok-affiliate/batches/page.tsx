import Link from 'next/link'
import { ArrowLeft, FileSpreadsheet, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { getBatches } from '../actions'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  normalized: { label: 'Normalized', variant: 'default' },
  staged: { label: 'Staged', variant: 'secondary' },
  processing: { label: 'Processing', variant: 'secondary' },
  failed: { label: 'Failed', variant: 'destructive' },
}

function qualityPct(staged: number, skipped: number): string {
  const total = staged + skipped
  if (total === 0) return '—'
  return `${Math.round((staged / total) * 100)}%`
}

export default async function BatchesPage({
  searchParams,
}: {
  searchParams: { page?: string }
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10))
  const limit = 25
  const offset = (page - 1) * limit

  const { data: batches, total, error } = await getBatches(limit, offset)
  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/content-ops/tiktok-affiliate">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Overview
          </Link>
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Import Batches</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {total.toLocaleString()} batch{total !== 1 ? 'es' : ''}
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/content-ops/tiktok-affiliate/upload">Upload new file</Link>
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {batches.length === 0 && !error && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No import batches yet</p>
            <p className="text-xs text-muted-foreground">Upload a TikTok affiliate Excel file to get started</p>
            <Button asChild size="sm" className="mt-2">
              <Link href="/content-ops/tiktok-affiliate/upload">Upload file</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {batches.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Staged</TableHead>
                    <TableHead className="text-right">Normalized</TableHead>
                    <TableHead className="text-right">Skipped</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead className="text-right">Quality</TableHead>
                    <TableHead>Imported</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((batch) => {
                    const statusDef = STATUS_BADGE[batch.status] ?? { label: batch.status, variant: 'outline' as const }
                    return (
                      <TableRow key={batch.id}>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium truncate max-w-[240px]">{batch.source_file_name}</p>
                            <p className="text-xs text-muted-foreground">{batch.source_sheet_name}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusDef.variant} className="text-xs">{statusDef.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{batch.staged_row_count.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{batch.normalized_row_count.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          <span className={batch.skipped_row_count > 0 ? 'text-amber-600' : ''}>
                            {batch.skipped_row_count.toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          <span className={batch.error_count > 0 ? 'text-destructive' : ''}>
                            {batch.error_count.toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {qualityPct(batch.normalized_row_count, batch.skipped_row_count)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(batch.created_at).toLocaleDateString('th-TH', {
                            year: 'numeric', month: 'short', day: 'numeric',
                          })}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={`?page=${page - 1}`}>Previous</Link>
              </Button>
            )}
            {page < totalPages && (
              <Button asChild variant="outline" size="sm">
                <Link href={`?page=${page + 1}`}>Next</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
