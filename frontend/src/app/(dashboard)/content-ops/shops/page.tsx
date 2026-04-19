import Link from 'next/link'
import { AlertCircle, Store } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { DateRangeFilter } from '@/components/content-ops/date-range-filter'
import { EntityAvatar } from '@/components/content-ops/entity-avatar'
import { Sparkline } from '@/components/content-ops/sparkline'
import { ShopFullTable } from '@/components/content-ops/full-table'
import { getShopTrends } from '../actions'
import { getDefaultDateRange } from '../date-utils'

export const dynamic = 'force-dynamic'

// ─── Change badge ──────────────────────────────────────────────────────────────

function ChangeBadge({
  changePercent,
  isNew,
}: {
  changePercent: number | null
  isNew: boolean
}) {
  if (isNew) return <span className="text-xs font-medium text-blue-600">new</span>
  if (changePercent === null || changePercent === 0) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  if (changePercent > 0) {
    return <span className="text-xs font-medium text-emerald-600">+{changePercent.toFixed(1)}%</span>
  }
  return <span className="text-xs font-medium text-red-500">{changePercent.toFixed(1)}%</span>
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function ShopsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string }
}) {
  const defaults = getDefaultDateRange()
  const from = searchParams.from ?? defaults.from
  const to = searchParams.to ?? defaults.to

  const { top, all, error } = await getShopTrends(from, to, 50)

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-7xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Shops</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Performance page — ranked by order volume
        </p>
      </div>

      {/* Sticky date filter */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-2 -mx-4 px-4 border-b">
        <DateRangeFilter from={from} to={to} />
      </div>

      {/* ─── TOP 50 BLOCK ─────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-base font-semibold">Top {Math.min(top.length, 50)} Shops</h2>
          <span className="text-xs text-muted-foreground">by order items · {from} → {to}</span>
        </div>

        {top.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <Store className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No shop data in this period</p>
              <p className="text-xs text-muted-foreground">Try a wider date range</p>
            </CardContent>
          </Card>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-[32px_36px_1fr_72px_80px_80px] items-center gap-2 px-4 py-2 bg-muted/30 border-b text-xs text-muted-foreground font-medium">
              <span>#</span>
              <span></span>
              <span>Shop</span>
              <span className="text-right">7d trend</span>
              <span className="text-right">Items</span>
              <span className="text-right">vs prev</span>
            </div>

            <div className="divide-y">
              {top.map((s, i) => (
                <Link
                  key={s.shopCode}
                  href={`/content-ops/shops/${encodeURIComponent(s.shopCode)}`}
                  className="grid grid-cols-[32px_36px_1fr_72px_80px_80px] items-center gap-2 px-4 py-2.5 hover:bg-muted/30 transition-colors group"
                >
                  {/* Rank */}
                  <span className="text-xs text-muted-foreground tabular-nums text-right font-mono">
                    {i + 1}
                  </span>

                  {/* Avatar */}
                  <EntityAvatar name={s.shopName ?? s.shopCode} size="sm" />

                  {/* Name + top product */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate group-hover:underline">
                      {s.shopName ?? s.shopCode}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {s.topProductName ?? `${s.productCount} products`}
                    </p>
                  </div>

                  {/* Sparkline */}
                  <div className="flex justify-end">
                    <Sparkline data={s.dailyCounts} width={64} height={22} />
                  </div>

                  {/* Order items */}
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      {s.orderItems.toLocaleString()}
                    </p>
                  </div>

                  {/* % change */}
                  <div className="text-right">
                    <ChangeBadge changePercent={s.changePercent} isNew={s.isNew} />
                  </div>
                </Link>
              ))}
            </div>

            <div className="border-t px-4 py-2 bg-muted/20 text-xs text-muted-foreground">
              {top.length} shops shown · sorted by order items (current period)
            </div>
          </div>
        )}
      </section>

      {/* ─── FULL TABLE ───────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-base font-semibold">All Shops</h2>
          <span className="text-xs text-muted-foreground">{all.length} total · instant search</span>
        </div>

        <ShopFullTable rows={all} />
      </section>
    </div>
  )
}
