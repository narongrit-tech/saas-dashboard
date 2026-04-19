import Link from 'next/link'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { getProductDetail } from '../../actions'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

const STATUS_STYLE: Record<string, string> = {
  settled: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  pending: 'text-blue-700 bg-blue-50 border-blue-200',
  awaiting_payment: 'text-amber-700 bg-amber-50 border-amber-200',
  ineligible: 'text-red-700 bg-red-50 border-red-200',
}

const STATUS_BAR_COLORS: Record<string, string> = {
  settled: 'bg-emerald-500',
  pending: 'bg-blue-400',
  awaiting_payment: 'bg-amber-400',
  ineligible: 'bg-red-400',
}

export default async function ProductDetailPage({
  params,
}: {
  params: { productId: string }
}) {
  const productId = decodeURIComponent(params.productId)
  const { data, error } = await getProductDetail(productId)

  if (error === 'Product not found') notFound()

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error ?? 'Failed to load product'}
      </div>
    )
  }

  const { stats, statusBreakdown, topShops, topContentIds, relatedOrders } = data
  const total = stats.totalOrderItems

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Back */}
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/content-ops/products">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Products
        </Link>
      </Button>

      {/* Entity header */}
      <div>
        <h1 className="text-xl font-semibold">{stats.productName ?? stats.productId}</h1>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span className="text-xs font-mono text-muted-foreground">{stats.productId}</span>
          <span className="text-xs text-muted-foreground">{stats.shopCount} shops</span>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Order Items', value: total.toLocaleString() },
          { label: 'Shops', value: stats.shopCount.toLocaleString() },
          { label: 'Settled', value: `${stats.settledPercent}%` },
          { label: 'Top Shop', value: stats.topShopName ?? '—' },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{kpi.label}</p>
              <p className="text-xl font-semibold tabular-nums mt-1 truncate">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Top shops + top content IDs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Top Shops</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {topShops.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 pb-3">No shop data</p>
            ) : (
              <div className="divide-y">
                {topShops.map((s, i) => (
                  <Link
                    key={i}
                    href={s.href ?? '#'}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors"
                  >
                    <span className="text-xs text-muted-foreground w-4 shrink-0">{i + 1}</span>
                    <p className="flex-1 text-sm truncate">{s.label}</p>
                    <p className="text-sm font-semibold tabular-nums shrink-0">{s.value.toLocaleString()}</p>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Top Content IDs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {topContentIds.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 pb-3">No content data</p>
            ) : (
              <div className="divide-y">
                {topContentIds.map((c, i) => (
                  <Link
                    key={i}
                    href={`/content-ops/content/${encodeURIComponent(c.label)}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors"
                  >
                    <span className="text-xs text-muted-foreground w-4 shrink-0">{i + 1}</span>
                    <p className="flex-1 text-xs font-mono text-primary hover:underline truncate">{c.label}</p>
                    <p className="text-sm font-semibold tabular-nums shrink-0">{c.value.toLocaleString()}</p>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Status breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Status Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex h-2.5 rounded-full overflow-hidden gap-0.5">
            {statusBreakdown.map((bucket) =>
              bucket.count > 0 ? (
                <div
                  key={bucket.key}
                  className={`${STATUS_BAR_COLORS[bucket.key]}`}
                  style={{ width: `${bucket.percent}%` }}
                />
              ) : null
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {statusBreakdown.map((bucket) => (
              <Link
                key={bucket.key}
                href={`/content-ops/analysis/orders?product_id=${encodeURIComponent(productId)}&status=${encodeURIComponent(bucket.key)}`}
                className="rounded-md p-2 hover:bg-muted/50 transition-colors"
              >
                <span className={`text-xs px-2 py-0.5 rounded border font-medium inline-block ${STATUS_STYLE[bucket.key] ?? ''}`}>
                  {bucket.label}
                </span>
                <p className="text-lg font-semibold tabular-nums mt-1">{bucket.count.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{bucket.percent}%</p>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Related orders preview */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium">Related Orders (preview)</CardTitle>
            <Link
              href={`/content-ops/analysis/orders?product_id=${encodeURIComponent(productId)}`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              View all →
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Shop</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Content ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {relatedOrders.map((r) => (
                  <TableRow key={r.orderId}>
                    <TableCell className="text-xs font-mono">{r.orderId}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.shopName ?? '—'}</TableCell>
                    <TableCell>
                      <span className="text-xs px-2 py-0.5 rounded border font-medium bg-muted border-border">
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{r.contentId}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
