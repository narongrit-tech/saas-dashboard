import Link from 'next/link'
import {
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Info,
  ArrowRight,
  Upload,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getOverviewData } from './actions'

export const dynamic = 'force-dynamic'

// ─── Status breakdown bar ──────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  settled: 'bg-emerald-500',
  pending: 'bg-blue-400',
  awaiting_payment: 'bg-amber-400',
  ineligible: 'bg-red-400',
  other: 'bg-muted',
}

const STATUS_TEXT: Record<string, string> = {
  settled: 'text-emerald-700',
  pending: 'text-blue-700',
  awaiting_payment: 'text-amber-700',
  ineligible: 'text-red-700',
  other: 'text-muted-foreground',
}

// ─── Health icon ───────────────────────────────────────────────────────────────

function HealthIcon({ status }: { status: 'ok' | 'warning' | 'error' | 'info' }) {
  if (status === 'ok') return <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
  if (status === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
  if (status === 'error') return <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
  return <Info className="h-4 w-4 text-muted-foreground shrink-0" />
}

// ─── Priority badge ────────────────────────────────────────────────────────────

const PRIORITY_STYLE: Record<string, string> = {
  high: 'border-red-300 text-red-700',
  medium: 'border-amber-300 text-amber-700',
  low: 'border-muted-foreground/30 text-muted-foreground',
}

export default async function ContentOpsOverviewPage() {
  const { data, error } = await getOverviewData()

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error ?? 'Failed to load overview data'}
      </div>
    )
  }

  const { stats, statusBreakdown, topProducts, topShops, healthSnapshot } = data
  const totalItems = stats.totalOrderItems

  const nextActions = [
    ...(healthSnapshot.find((h) => h.label === 'Cost data' && h.status === 'warning')
      ? [{ title: 'Enter cost data', description: 'Required for profit calculation', href: '/content-ops/tiktok-affiliate/costs', priority: 'high' as const }]
      : []),
    { title: 'Explore products', description: `${stats.uniqueProducts} products in system`, href: '/content-ops/products', priority: 'medium' as const },
    { title: 'Explore shops', description: `${stats.uniqueShops} shops in system`, href: '/content-ops/shops', priority: 'medium' as const },
    { title: 'Connect showcase', description: 'Showcase data not linked', href: '/content-ops/data-health', priority: 'medium' as const },
    { title: 'Upload new data', description: 'Add more TikTok order files', href: '/content-ops/tiktok-affiliate/upload', priority: 'low' as const },
  ].slice(0, 5)

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Content Ops</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real affiliate data summary and system state
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/content-ops/tiktok-affiliate/upload">
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Upload data
          </Link>
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Order Items', value: totalItems.toLocaleString(), href: '/content-ops/analysis/orders' },
          { label: 'Products', value: stats.uniqueProducts.toLocaleString(), href: '/content-ops/products' },
          { label: 'Shops', value: stats.uniqueShops.toLocaleString(), href: '/content-ops/shops' },
          { label: 'Content IDs', value: stats.uniqueContentIds.toLocaleString(), href: '/content-ops/analysis/attribution' },
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
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Order Status Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Stacked bar */}
          <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
            {statusBreakdown.map((bucket) =>
              bucket.count > 0 ? (
                <div
                  key={bucket.key}
                  className={`${STATUS_COLORS[bucket.key]} transition-all`}
                  style={{ width: `${bucket.percent}%` }}
                  title={`${bucket.label}: ${bucket.count.toLocaleString()} (${bucket.percent}%)`}
                />
              ) : null
            )}
          </div>
          {/* Legend */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {statusBreakdown.map((bucket) => (
              <Link
                key={bucket.key}
                href={`/content-ops/analysis/orders?status=${encodeURIComponent(bucket.label)}`}
                className="flex flex-col gap-0.5 rounded-md p-2 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block w-2.5 h-2.5 rounded-sm ${STATUS_COLORS[bucket.key]}`} />
                  <span className="text-xs text-muted-foreground">{bucket.label}</span>
                </div>
                <p className={`text-lg font-semibold tabular-nums leading-none ${STATUS_TEXT[bucket.key]}`}>
                  {bucket.count.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">{bucket.percent}%</p>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Top products + top shops */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top products */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Top Products</CardTitle>
              <Link href="/content-ops/products" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 pb-4">No product data</p>
            ) : (
              <div className="divide-y">
                {topProducts.map((p, i) => (
                  <Link
                    key={p.productId}
                    href={`/content-ops/products/${encodeURIComponent(p.productId)}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors group"
                  >
                    <span className="text-xs text-muted-foreground w-4 shrink-0 tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
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
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Top Shops</CardTitle>
              <Link href="/content-ops/shops" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {topShops.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 pb-4">No shop data</p>
            ) : (
              <div className="divide-y">
                {topShops.map((s, i) => (
                  <Link
                    key={s.shopCode}
                    href={`/content-ops/shops/${encodeURIComponent(s.shopCode)}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors group"
                  >
                    <span className="text-xs text-muted-foreground w-4 shrink-0 tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
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

      {/* Data health snapshot + next actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Data health snapshot */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Data Health</CardTitle>
              <Link href="/content-ops/data-health" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                Details <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {healthSnapshot.map((item) => (
              <div key={item.label} className="flex items-start gap-2.5">
                <HealthIcon status={item.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                {item.href && (
                  <Link href={item.href} className="text-xs text-muted-foreground hover:text-foreground shrink-0">
                    →
                  </Link>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Next actions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Next Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {nextActions.map((action) => (
              <Link
                key={action.title}
                href={action.href}
                className="flex items-center gap-3 rounded-md border px-3 py-2.5 hover:border-foreground/30 hover:bg-muted/30 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{action.title}</p>
                  {action.description && (
                    <p className="text-xs text-muted-foreground">{action.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={`text-xs ${PRIORITY_STYLE[action.priority]}`}>
                    {action.priority}
                  </Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
