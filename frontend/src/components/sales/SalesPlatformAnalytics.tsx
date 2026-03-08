'use client'

/**
 * SalesPlatformAnalytics
 * Two sections:
 *   1. Platform Distribution — GMV share (donut) + Orders share (horizontal bars)
 *   2. Leakage by Platform   — leakage amount per platform (orange)
 *
 * Desktop: 2-column layout with Recharts PieChart
 * Mobile:  compact stacked cards with progress bars (no large charts)
 */

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { AlertTriangle, TrendingUp, ShoppingCart } from 'lucide-react'
import { PlatformBreakdownRow } from '@/app/(dashboard)/sales/actions'

interface Props {
  data: PlatformBreakdownRow[]
  loading: boolean
}

const PLATFORM_LABELS: Record<string, string> = {
  tiktok_shop: 'TikTok',
  shopee: 'Shopee',
  lazada: 'Lazada',
  line: 'Line',
  facebook: 'Facebook',
  other: 'Other',
}

const PLATFORM_COLORS: Record<string, string> = {
  tiktok_shop: '#000000',
  shopee: '#ee4d2d',
  lazada: '#0f146d',
  line: '#06c755',
  facebook: '#1877f2',
  other: '#9ca3af',
}

const DEFAULT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#6b7280']

function getPlatformLabel(platform: string) {
  return PLATFORM_LABELS[platform] ?? platform
}

function getPlatformColor(platform: string, index: number) {
  return PLATFORM_COLORS[platform] ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length]
}

function formatCurrency(v: number) {
  if (v >= 1_000_000) return `฿${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `฿${(v / 1_000).toFixed(1)}K`
  return `฿${v.toLocaleString('th-TH', { minimumFractionDigits: 0 })}`
}

// ─── Loading skeleton ───────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-lg border p-4 space-y-3">
            <div className="h-4 w-36 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="space-y-2">
              {[0, 1, 2].map((j) => (
                <div key={j} className="h-3 animate-pulse rounded bg-gray-100 dark:bg-gray-800" style={{ width: `${70 - j * 15}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Desktop donut chart tooltip ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DonutTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const { name, value, payload: p } = payload[0]
  return (
    <div className="rounded-md border bg-white dark:bg-gray-900 px-3 py-2 text-xs shadow-md">
      <p className="font-semibold mb-1">{getPlatformLabel(name)}</p>
      <p>GMV: {formatCurrency(value)}</p>
      <p>Share: {p.gmv_pct}%</p>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export function SalesPlatformAnalytics({ data, loading }: Props) {
  if (loading) return <Skeleton />
  if (!data || data.length === 0) return null

  const donutData = data.map((row) => ({
    name: row.platform,
    value: row.gmv_created,
    gmv_pct: row.gmv_pct,
  }))

  return (
    <div className="space-y-4">
      {/* ── Section header ─────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Platform Distribution</span>
      </div>

      {/* ── Desktop: 2-col (donut + order bars) ────────────────── */}
      <div className="hidden md:grid md:grid-cols-2 gap-4">
        {/* Left: donut chart — GMV share */}
        <div className="rounded-lg border bg-white dark:bg-gray-900 p-4">
          <p className="text-xs font-medium text-muted-foreground mb-3">GMV Share by Platform</p>
          <div className="flex items-center gap-4">
            <div className="w-36 h-36 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={36}
                    outerRadius={60}
                    strokeWidth={1}
                  >
                    {donutData.map((entry, index) => (
                      <Cell key={entry.name} fill={getPlatformColor(entry.name, index)} />
                    ))}
                  </Pie>
                  <Tooltip content={<DonutTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="flex-1 space-y-2 min-w-0">
              {data.map((row, i) => (
                <div key={row.platform} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ background: getPlatformColor(row.platform, i) }}
                  />
                  <span className="font-medium truncate">{getPlatformLabel(row.platform)}</span>
                  <span className="ml-auto tabular-nums text-muted-foreground shrink-0">
                    {formatCurrency(row.gmv_created)}
                  </span>
                  <span className="tabular-nums font-semibold shrink-0 w-10 text-right">{row.gmv_pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: horizontal bars — Orders share */}
        <div className="rounded-lg border bg-white dark:bg-gray-900 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-medium text-muted-foreground">Orders Share by Platform</p>
          </div>
          <div className="space-y-3">
            {data.map((row, i) => (
              <div key={row.platform} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: getPlatformColor(row.platform, i) }}
                    />
                    <span className="font-medium">{getPlatformLabel(row.platform)}</span>
                  </div>
                  <div className="flex items-center gap-3 tabular-nums">
                    <span className="text-muted-foreground">{row.orders_created.toLocaleString()} orders</span>
                    <span className="font-semibold w-10 text-right">{row.orders_pct}%</span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${row.orders_pct}%`,
                      background: getPlatformColor(row.platform, i),
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Mobile: compact platform cards ─────────────────────── */}
      <div className="md:hidden space-y-2">
        {data.map((row, i) => (
          <div key={row.platform} className="rounded-lg border bg-white dark:bg-gray-900 px-3 py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: getPlatformColor(row.platform, i) }}
                />
                <span className="text-sm font-semibold">{getPlatformLabel(row.platform)}</span>
              </div>
              <span className="text-xs font-bold tabular-nums">{row.gmv_pct}%</span>
            </div>
            {/* progress bar */}
            <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 mb-2">
              <div
                className="h-1.5 rounded-full"
                style={{ width: `${row.gmv_pct}%`, background: getPlatformColor(row.platform, i) }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{row.orders_created.toLocaleString()} orders</span>
              <span className="tabular-nums font-medium text-foreground">{formatCurrency(row.gmv_created)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Leakage by Platform ─────────────────────────────────── */}
      <div className="flex items-center gap-2 pt-1">
        <AlertTriangle className="h-4 w-4 text-orange-500" />
        <span className="text-sm font-semibold">Leakage by Platform</span>
      </div>

      {/* Desktop leakage bars */}
      <div className="hidden md:block rounded-lg border bg-orange-50 dark:bg-orange-950/20 p-4">
        <div className="space-y-3">
          {data.map((row) => {
            const maxLeakage = Math.max(...data.map((r) => r.gmv_leakage), 1)
            const barPct = maxLeakage > 0 ? (row.gmv_leakage / maxLeakage) * 100 : 0
            return (
              <div key={row.platform} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{getPlatformLabel(row.platform)}</span>
                  <div className="flex items-center gap-4 tabular-nums">
                    <span className="text-orange-600 dark:text-orange-400 font-semibold">
                      {formatCurrency(row.gmv_leakage)}
                    </span>
                    <span className="text-muted-foreground w-28 text-right">
                      {row.orders_leakage} orders · {row.leakage_pct}% of GMV
                    </span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-orange-100 dark:bg-orange-900/40">
                  <div
                    className="h-2 rounded-full bg-orange-400 transition-all"
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Mobile leakage rows */}
      <div className="md:hidden space-y-2">
        {data.map((row) => {
          const maxLeakage = Math.max(...data.map((r) => r.gmv_leakage), 1)
          const barPct = maxLeakage > 0 ? (row.gmv_leakage / maxLeakage) * 100 : 0
          return (
            <div key={row.platform} className="rounded-lg border border-orange-200 dark:border-orange-900 bg-orange-50 dark:bg-orange-950/20 px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium">{getPlatformLabel(row.platform)}</span>
                <span className="text-sm font-bold tabular-nums text-orange-600 dark:text-orange-400">
                  {formatCurrency(row.gmv_leakage)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-orange-100 dark:bg-orange-900/40 mb-1.5">
                <div
                  className="h-1.5 rounded-full bg-orange-400"
                  style={{ width: `${barPct}%` }}
                />
              </div>
              <p className="text-xs text-orange-500 dark:text-orange-400">
                {row.orders_leakage} orders · {row.leakage_pct}% leakage rate
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
