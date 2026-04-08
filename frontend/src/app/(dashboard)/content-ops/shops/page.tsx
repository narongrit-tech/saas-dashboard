import Link from 'next/link'
import { AlertCircle, Store, ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { getShopList } from '../actions'

export const dynamic = 'force-dynamic'

export default async function ShopsPage({
  searchParams,
}: {
  searchParams: { search?: string; sort?: string; page?: string }
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  const { data, error } = await getShopList(
    {
      search: searchParams.search,
      sort: searchParams.sort,
    },
    limit,
    offset
  )

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / limit)

  function filterHref(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams()
    const merged = {
      search: searchParams.search,
      sort: searchParams.sort,
      ...overrides,
    }
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v)
    }
    const str = params.toString()
    return str ? `?${str}` : '?'
  }

  const activeFilters = [searchParams.search, searchParams.sort].filter(Boolean).length

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Shops</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {total.toLocaleString()} shops with affiliate order data
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <form method="GET" className="flex items-center gap-2 flex-wrap">
          <input
            name="search"
            defaultValue={searchParams.search ?? ''}
            placeholder="Search shop name or code..."
            className="h-8 w-64 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" variant="outline">Search</Button>
          {activeFilters > 0 && (
            <Button asChild size="sm" variant="ghost">
              <Link href="/content-ops/shops">Clear</Link>
            </Button>
          )}
        </form>

        {/* Sort */}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-xs text-muted-foreground">Sort:</span>
          {[
            { label: 'Orders', value: '' },
            { label: 'Products', value: 'products' },
            { label: 'Name', value: 'name' },
          ].map((opt) => (
            <Button
              key={opt.value || 'default'}
              asChild
              size="sm"
              variant={(!searchParams.sort && !opt.value) || searchParams.sort === opt.value ? 'default' : 'outline'}
            >
              <Link href={filterHref({ sort: opt.value || undefined, page: '1' })}>
                {opt.label}
              </Link>
            </Button>
          ))}
        </div>
      </div>

      {activeFilters > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing {rows.length} of {total.toLocaleString()} shops
          {searchParams.search && ` matching "${searchParams.search}"`}
        </p>
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
            <Store className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No shops found</p>
            <p className="text-xs text-muted-foreground">
              {activeFilters > 0
                ? 'No shops match your filters.'
                : 'Upload order data to see shops.'}
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
                    <TableHead>Shop</TableHead>
                    <TableHead className="text-right">Products</TableHead>
                    <TableHead className="text-right">Order Items</TableHead>
                    <TableHead>Top Product</TableHead>
                    <TableHead>Top Content</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.shopCode} className="cursor-pointer hover:bg-muted/40">
                      <TableCell>
                        <Link href={`/content-ops/shops/${encodeURIComponent(row.shopCode)}`} className="block">
                          <p className="text-sm font-medium">{row.shopName ?? row.shopCode}</p>
                          {row.shopName && (
                            <p className="text-xs text-muted-foreground font-mono">{row.shopCode}</p>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{row.productCount}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">{row.orderItems.toLocaleString()}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.topProductName ? (
                          <span className="truncate max-w-[140px] block">{row.topProductName}</span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {row.topContentId ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/content-ops/shops/${encodeURIComponent(row.shopCode)}`}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ArrowRight className="h-4 w-4" />
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
