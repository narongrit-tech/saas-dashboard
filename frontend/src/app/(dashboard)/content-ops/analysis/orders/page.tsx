import Link from 'next/link'
import { AlertCircle, Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { DateRangeFilter } from '@/components/content-ops/date-range-filter'
import { getOrdersExplorer } from '../../actions'
import { getDefaultDateRange } from '../../date-utils'

export const dynamic = 'force-dynamic'

const STATUS_STYLE: Record<string, string> = {
  Settled: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  Completed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  Pending: 'text-blue-700 bg-blue-50 border-blue-200',
  'Awaiting Payment': 'text-amber-700 bg-amber-50 border-amber-200',
  Ineligible: 'text-red-700 bg-red-50 border-red-200',
  Cancelled: 'text-red-700 bg-red-50 border-red-200',
}

// Sub-navigation for analysis section
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

export default async function OrdersExplorerPage({
  searchParams,
}: {
  searchParams: {
    q?: string
    product_id?: string
    shop_code?: string
    status?: string
    content_id?: string
    page?: string
    from?: string
    to?: string
  }
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  const defaults = getDefaultDateRange()
  const from = searchParams.from ?? defaults.from
  const to = searchParams.to ?? defaults.to

  const { data: rows, total, error } = await getOrdersExplorer(
    {
      query: searchParams.q,
      productId: searchParams.product_id,
      shopCode: searchParams.shop_code,
      status: searchParams.status,
      contentId: searchParams.content_id,
      from,
      to,
    },
    limit,
    offset
  )

  const totalPages = Math.ceil(total / limit)

  const activeFilters = [
    searchParams.q,
    searchParams.product_id,
    searchParams.shop_code,
    searchParams.status,
    searchParams.content_id,
  ].filter(Boolean)

  function filterHref(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams()
    const merged: Record<string, string | undefined> = {
      q: searchParams.q,
      product_id: searchParams.product_id,
      shop_code: searchParams.shop_code,
      status: searchParams.status,
      content_id: searchParams.content_id,
      from,
      to,
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
      <AnalysisNav current="orders" />

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Orders Explorer</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Inspect and filter order-line facts — {total.toLocaleString()} rows
          {activeFilters.length > 0 && ` (${activeFilters.length} filter${activeFilters.length > 1 ? 's' : ''} active)`}
        </p>
      </div>

      {/* Date filter */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-2 -mx-4 px-4 border-b">
        <DateRangeFilter from={from} to={to} />
      </div>

      {/* Filter bar */}
      <form method="GET" className="flex flex-wrap gap-2 items-end">
        {/* Full-text search */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Search</label>
          <input
            name="q"
            defaultValue={searchParams.q ?? ''}
            placeholder="Order ID / product name / content ID"
            className="h-8 w-64 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <select
            name="status"
            defaultValue={searchParams.status ?? ''}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All statuses</option>
            <option>Settled</option>
            <option>Pending</option>
            <option>Awaiting Payment</option>
            <option>Ineligible</option>
          </select>
        </div>

        {/* Preserve other filters */}
        {searchParams.product_id && <input type="hidden" name="product_id" value={searchParams.product_id} />}
        {searchParams.shop_code && <input type="hidden" name="shop_code" value={searchParams.shop_code} />}
        {searchParams.content_id && <input type="hidden" name="content_id" value={searchParams.content_id} />}

        <Button type="submit" size="sm" variant="outline" className="h-8">
          <Search className="h-3.5 w-3.5 mr-1.5" />
          Filter
        </Button>

        {activeFilters.length > 0 && (
          <Button asChild size="sm" variant="ghost" className="h-8">
            <Link href="/content-ops/analysis/orders">Clear all</Link>
          </Button>
        )}
      </form>

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {searchParams.product_id && (
            <span className="px-2 py-0.5 rounded border bg-muted font-mono">
              product: {searchParams.product_id}
              <Link href={filterHref({ product_id: undefined, page: '1' })} className="ml-1.5 text-muted-foreground hover:text-foreground">×</Link>
            </span>
          )}
          {searchParams.shop_code && (
            <span className="px-2 py-0.5 rounded border bg-muted font-mono">
              shop: {searchParams.shop_code}
              <Link href={filterHref({ shop_code: undefined, page: '1' })} className="ml-1.5 text-muted-foreground hover:text-foreground">×</Link>
            </span>
          )}
          {searchParams.content_id && (
            <span className="px-2 py-0.5 rounded border bg-muted font-mono">
              content: {searchParams.content_id}
              <Link href={filterHref({ content_id: undefined, page: '1' })} className="ml-1.5 text-muted-foreground hover:text-foreground">×</Link>
            </span>
          )}
          {searchParams.status && (
            <span className="px-2 py-0.5 rounded border bg-muted">
              status: {searchParams.status}
              <Link href={filterHref({ status: undefined, page: '1' })} className="ml-1.5 text-muted-foreground hover:text-foreground">×</Link>
            </span>
          )}
          {searchParams.q && (
            <span className="px-2 py-0.5 rounded border bg-muted">
              search: &quot;{searchParams.q}&quot;
              <Link href={filterHref({ q: undefined, page: '1' })} className="ml-1.5 text-muted-foreground hover:text-foreground">×</Link>
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
            <Search className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No results</p>
            <p className="text-xs text-muted-foreground">
              {activeFilters.length > 0
                ? 'No rows match the current filters.'
                : 'No order data available.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Shop</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Content ID</TableHead>
                    <TableHead>Order date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs font-mono whitespace-nowrap">{row.orderId}</TableCell>
                      <TableCell>
                        <Link
                          href={`/content-ops/products/${encodeURIComponent(row.productId)}`}
                          className="text-sm hover:underline text-primary"
                        >
                          {row.productName ?? row.productId}
                        </Link>
                        {row.productName && (
                          <p className="text-xs font-mono text-muted-foreground">{row.productId}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.shopCode ? (
                          <Link
                            href={`/content-ops/shops/${encodeURIComponent(row.shopCode)}`}
                            className="text-sm hover:underline"
                          >
                            {row.shopName ?? row.shopCode}
                          </Link>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${STATUS_STYLE[row.status] ?? 'text-muted-foreground bg-muted border-border'}`}>
                          {row.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={filterHref({ content_id: row.contentId, page: '1' })}
                          className="text-xs font-mono hover:underline text-muted-foreground hover:text-foreground"
                        >
                          {row.contentId}
                        </Link>
                      </TableCell>
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
          <span className="text-muted-foreground">Page {page} of {totalPages} ({total.toLocaleString()} rows)</span>
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
