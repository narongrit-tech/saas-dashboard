import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DateRangeFilter } from '@/components/content-ops/date-range-filter'
import { EntityAvatar } from '@/components/content-ops/entity-avatar'
import { getOverviewDataFiltered } from './actions'
import { getDefaultDateRange } from './date-utils'

export const dynamic = 'force-dynamic'

// ─── Status colors ─────────────────────────────────────────────────────────────

const STATUS_BAR: Record<string, string> = {
  settled: 'bg-emerald-500',
  pending: 'bg-blue-400',
  awaiting_payment: 'bg-amber-400',
  ineligible: 'bg-red-400',
}
const STATUS_NUM: Record<string, string> = {
  settled: 'text-emerald-600',
  pending: 'text-blue-600',
  awaiting_payment: 'text-amber-600',
  ineligible: 'text-red-600',
}

// ─── Change badge ──────────────────────────────────────────────────────────────

export default async function ContentOpsOverviewPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string }
}) {
  const defaults = getDefaultDateRange()
  const from = searchParams.from ?? defaults.from
  const to = searchParams.to ?? defaults.to

  const { data, error } = await getOverviewDataFiltered(from, to)

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error ?? 'Failed to load overview'}
      </div>
    )
  }

  const { stats, statusBreakdown, topProducts, topShops } = data
  const total = stats.totalOrderItems

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header + date filter */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Content Ops</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Real affiliate data summary</p>
        </div>
      </div>

      {/* Sticky date filter */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-2 -mx-4 px-4 border-b">
        <DateRangeFilter from={from} to={to} />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Order Items', value: total.toLocaleString(), href: `/content-ops/analysis/orders?from=${from}&to=${to}` },
          { label: 'Products', value: stats.uniqueProducts.toLocaleString(), href: `/content-ops/products?from=${from}&to=${to}` },
          { label: 'Shops', value: stats.uniqueShops.toLocaleString(), href: `/content-ops/shops?from=${from}&to=${to}` },
          { label: 'Content IDs', value: stats.uniqueContentIds.toLocaleString(), href: `/content-ops/analysis/attribution?from=${from}&to=${to}` },
        ].map((kpi) => (
          <Link key={kpi.label} href={kpi.href}>
            <Card className="hover:border-foreground/30 transition-colors cursor-pointer">
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{kpi.label}</p>
                <p className="text-2xl font-semibold tabular-nums mt-1">{kpi.value}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Status breakdown */}
      {total > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Order Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
              {statusBreakdown.map((b) =>
                b.count > 0 ? (
                  <div
                    key={b.key}
                    className={STATUS_BAR[b.key]}
                    style={{ width: `${b.percent}%` }}
                    title={`${b.label}: ${b.count.toLocaleString()} (${b.percent}%)`}
                  />
                ) : null
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
              {statusBreakdown.map((b) => (
                <Link
                  key={b.key}
                  href={`/content-ops/analysis/orders?status=${encodeURIComponent(b.label)}&from=${from}&to=${to}`}
                  className="rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block w-2 h-2 rounded-sm ${STATUS_BAR[b.key]}`} />
                    <span className="text-xs text-muted-foreground">{b.label}</span>
                  </div>
                  <p className={`text-xl font-semibold tabular-nums leading-tight mt-0.5 ${STATUS_NUM[b.key]}`}>
                    {b.count.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">{b.percent}%</p>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Products + Top Shops */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top products */}
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Top Products</CardTitle>
              <Link
                href={`/content-ops/products?from=${from}&to=${to}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                View all →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0 mt-2">
            {topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 pb-4">
                No product data in this period
              </p>
            ) : (
              <div className="divide-y">
                {topProducts.map((p, i) => (
                  <Link
                    key={p.productId}
                    href={`/content-ops/products/${encodeURIComponent(p.productId)}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors group"
                  >
                    <span className="text-xs text-muted-foreground w-5 shrink-0 tabular-nums text-right">
                      {i + 1}
                    </span>
                    <EntityAvatar name={p.productName ?? p.productId} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate group-hover:underline">
                        {p.productName ?? p.productId}
                      </p>
                      <p className="text-xs text-muted-foreground">{p.shopCount} shops</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold tabular-nums">{p.orderItems.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">{p.sharePercent}%</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top shops */}
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Top Shops</CardTitle>
              <Link
                href={`/content-ops/shops?from=${from}&to=${to}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                View all →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0 mt-2">
            {topShops.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 pb-4">
                No shop data in this period
              </p>
            ) : (
              <div className="divide-y">
                {topShops.map((s, i) => (
                  <Link
                    key={s.shopCode}
                    href={`/content-ops/shops/${encodeURIComponent(s.shopCode)}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors group"
                  >
                    <span className="text-xs text-muted-foreground w-5 shrink-0 tabular-nums text-right">
                      {i + 1}
                    </span>
                    <EntityAvatar name={s.shopName ?? s.shopCode} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate group-hover:underline">
                        {s.shopName ?? s.shopCode}
                      </p>
                      <p className="text-xs text-muted-foreground">{s.productCount} products</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold tabular-nums">{s.orderItems.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">{s.sharePercent}%</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Empty state when no data in period */}
      {total === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <p className="text-sm font-medium">No order data in this period</p>
            <p className="text-xs text-muted-foreground">
              Try selecting a wider date range, or{' '}
              <Link href="/content-ops/tiktok-affiliate/upload" className="underline hover:no-underline">
                upload more data
              </Link>
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
