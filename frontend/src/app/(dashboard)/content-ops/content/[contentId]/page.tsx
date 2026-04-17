import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, AlertCircle, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { getContentDetail } from '../../actions'

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

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export default async function ContentDetailPage({
  params,
}: {
  params: { contentId: string }
}) {
  const contentId = decodeURIComponent(params.contentId)
  const { data, error } = await getContentDetail(contentId)

  if (error === 'Content not found') notFound()

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error ?? 'Failed to load content'}
      </div>
    )
  }

  const { stats, statusBreakdown, topProducts, profitSummary, relatedOrders } = data

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Back */}
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/content-ops/content">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Content
        </Link>
      </Button>

      {/* Entity header */}
      <div>
        <h1 className="text-xl font-semibold font-mono">{contentId}</h1>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span className="text-xs text-muted-foreground">{stats.productCount} product{stats.productCount !== 1 ? 's' : ''}</span>
          <span className="text-xs text-muted-foreground">{stats.totalOrders.toLocaleString()} orders</span>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Orders', value: stats.totalOrders.toLocaleString() },
          { label: 'Settled', value: `${stats.settledPercent}%` },
          { label: 'Products', value: stats.productCount.toLocaleString() },
          { label: 'Top Product', value: stats.topProductName ?? '—' },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{kpi.label}</p>
              <p className="text-xl font-semibold tabular-nums mt-1 truncate">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Profit section */}
      {profitSummary === null ? (
        <Card className="border-muted">
          <CardContent className="py-4 px-4">
            <div className="flex items-start gap-2 text-sm">
              <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-medium text-muted-foreground">Profit data not available</p>
                <p className="text-xs text-muted-foreground">
                  Run a profit refresh to compute commission and profit for this content.{' '}
                  <Link href="/content-ops/tiktok-affiliate/profit" className="underline hover:text-foreground">
                    Go to Profit →
                  </Link>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Commission realized</p>
                <p className="text-lg font-semibold tabular-nums mt-0.5">
                  {fmt(profitSummary.commissionRealized)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total cost</p>
                {profitSummary.hasCostData ? (
                  <p className="text-lg font-semibold tabular-nums mt-0.5">
                    {fmt(profitSummary.totalCost)}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-0.5 italic">no data</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Net profit</p>
                {profitSummary.hasCostData ? (
                  <p className={`text-lg font-semibold tabular-nums mt-0.5 ${profitSummary.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {fmt(profitSummary.profit)}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-0.5 italic">no data</p>
                )}
              </div>
            </div>
            {!profitSummary.hasCostData && (
              <div className="flex items-start gap-2 mt-3 text-xs border border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20 rounded px-2.5 py-2">
                <Info className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span className="text-amber-800 dark:text-amber-300">
                  No cost data for this content — profit equals commission only.{' '}
                  <Link href="/content-ops/tiktok-affiliate/costs" className="underline">
                    Add costs →
                  </Link>
                </span>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              Sourced from{' '}
              <Link href="/content-ops/tiktok-affiliate/profit" className="underline hover:text-foreground">
                content_profit_attribution_summary
              </Link>
              {' '}· aggregated across all products for this content
            </p>
          </CardContent>
        </Card>
      )}

      {/* Products used in this content */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Products ({topProducts.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {topProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 pb-3">No product data</p>
          ) : (
            <div className="divide-y">
              {topProducts.map((p, i) => (
                <Link
                  key={p.productId}
                  href={p.href}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors group"
                >
                  <span className="text-xs text-muted-foreground w-5 shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:underline">
                      {p.productName ?? p.productId}
                    </p>
                    <p className="text-xs font-mono text-muted-foreground truncate">{p.productId}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums shrink-0">
                    {p.orderCount.toLocaleString()} orders
                  </p>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
                  className={STATUS_BAR_COLORS[bucket.key]}
                  style={{ width: `${bucket.percent}%` }}
                />
              ) : null
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {statusBreakdown.map((bucket) => (
              <Link
                key={bucket.key}
                href={`/content-ops/analysis/orders?content_id=${encodeURIComponent(contentId)}&status=${encodeURIComponent(bucket.key)}`}
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
              href={`/content-ops/analysis/orders?content_id=${encodeURIComponent(contentId)}`}
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Attribution link */}
      <p className="text-xs text-muted-foreground">
        <Link
          href={`/content-ops/tiktok-affiliate/attribution?content_id=${encodeURIComponent(contentId)}`}
          className="underline hover:text-foreground"
        >
          View attribution winners for this content →
        </Link>
      </p>
    </div>
  )
}
