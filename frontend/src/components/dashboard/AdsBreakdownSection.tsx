'use client'

/**
 * Ads Breakdown Section — charts-first redesign
 *
 * Layout per tab:
 *  1. 3 metric mini-cards  (Total Spend | Attributed GMV | ROAS)
 *  2. Spend + GMV line chart (primary visual)
 *  3. ROAS trend chart       (when hasRevenue)
 *  4. Collapsible raw table  (hidden by default)
 */

import { useState, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import {
  ComposedChart, LineChart,
  Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { getAdsBreakdown } from '@/app/(dashboard)/actions'
import type { AdsBreakdownType } from '@/app/(dashboard)/actions'

type AdsTab = 'all' | 'product' | 'live' | 'awareness'

interface Props {
  from: string
  to: string
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmt(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtShort(n: number): string {
  if (n >= 1_000_000) return `฿${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `฿${(n / 1_000).toFixed(0)}K`
  return `฿${n.toFixed(0)}`
}

// ─── Tab button ───────────────────────────────────────────────────────────────
function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'px-3 py-1.5 text-xs font-medium border-r last:border-r-0 transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ─── Metric mini-card ─────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, color = 'default' }: {
  label: string
  value: string
  sub?: string
  color?: 'purple' | 'green' | 'yellow' | 'muted' | 'default'
}) {
  const valueColor = {
    purple:  'text-purple-600 dark:text-purple-400',
    green:   'text-green-600 dark:text-green-400',
    yellow:  'text-yellow-600 dark:text-yellow-400',
    muted:   'text-muted-foreground',
    default: 'text-foreground',
  }[color]

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-xl font-bold tracking-tight ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Panel content ────────────────────────────────────────────────────────────
function AdsPanel({
  breakdown,
  loading,
  error,
  isAwareness,
}: {
  breakdown: AdsBreakdownType | null
  loading: boolean
  error: string | null
  isAwareness?: boolean
}) {
  const [tableOpen, setTableOpen] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">กำลังโหลด...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-8 text-red-600 text-sm">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    )
  }

  if (!breakdown || breakdown.totalSpend === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        ไม่มีข้อมูล Ads สำหรับช่วงวันที่นี้
      </p>
    )
  }

  const { totalSpend, totalGmv, roas, spendRange, roasRange, byDay, hasRevenue, awarenessSpend } = breakdown
  const chartData = byDay.filter((r) => r.spend > 0 || r.gmv > 0)

  // ── Metric cards ─────────────────────────────────────────────────────────────
  const spendSub = spendRange.max > 0
    ? `Range: ${fmtShort(spendRange.min)} – ${fmtShort(spendRange.max)}/วัน`
    : undefined

  const roasSub = roasRange.max > 0
    ? `Range: ${roasRange.min.toFixed(2)}x – ${roasRange.max.toFixed(2)}x`
    : undefined

  return (
    <div className="space-y-5">

      {/* ── Info banners ──────────────────────────────────────────────────── */}
      {!hasRevenue && !isAwareness && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800/40 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          ยังไม่มีข้อมูลรายได้จาก Ads — ต้อง import Performance Report ก่อน (GMV / ROAS ยังไม่พร้อม)
        </div>
      )}
      {isAwareness && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/10 dark:border-blue-800/40 px-3 py-2 text-sm text-blue-700 dark:text-blue-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Awareness campaigns ไม่มี attributed GMV — แสดงเฉพาะยอดค่าใช้จ่าย (Brand Awareness / Reach / VDO View)
        </div>
      )}

      {/* ── 3 Metric cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard
          label="Total Spend"
          value={`฿${fmt(totalSpend)}`}
          sub={spendSub}
          color="purple"
        />
        <MetricCard
          label={isAwareness ? 'Attributed GMV' : hasRevenue ? 'Attributed GMV' : 'Attributed GMV'}
          value={hasRevenue && !isAwareness ? `฿${fmt(totalGmv)}` : 'N/A'}
          sub={hasRevenue && !isAwareness ? 'จาก ad_daily_performance' : isAwareness ? 'ไม่มีสำหรับ awareness' : 'ต้อง import ก่อน'}
          color={hasRevenue && !isAwareness ? 'green' : 'muted'}
        />
        <MetricCard
          label="ROAS"
          value={hasRevenue && !isAwareness && roas > 0 ? `${roas.toFixed(2)}x` : 'N/A'}
          sub={hasRevenue && !isAwareness ? roasSub : undefined}
          color={hasRevenue && !isAwareness ? (roas >= 1 ? 'yellow' : 'muted') : 'muted'}
        />
      </div>

      {/* ── Spend vs GMV chart ────────────────────────────────────────────── */}
      {chartData.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            {hasRevenue && !isAwareness ? 'Spend vs Attributed GMV' : 'Spend per Day'}
          </p>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="dayLabel" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={fmtShort} width={72} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value, name) => [
                    `฿${Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
                    name,
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="spend" name="Spend" fill="#a855f7" fillOpacity={0.85} radius={[2, 2, 0, 0]} />
                {hasRevenue && !isAwareness && (
                  <Line
                    type="monotone"
                    dataKey="gmv"
                    name="Attributed GMV"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={{ fill: '#22c55e', r: 3 }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── ROAS trend chart (only when hasRevenue and not awareness) ─────── */}
      {hasRevenue && !isAwareness && chartData.some((r) => r.roas > 0) && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            ROAS Trend
          </p>
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="dayLabel" tick={{ fontSize: 11 }} />
                <YAxis
                  tickFormatter={(v) => `${Number(v).toFixed(1)}x`}
                  width={52}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(value) => [`${Number(value).toFixed(2)}x`, 'ROAS']}
                />
                <Line
                  type="monotone"
                  dataKey="roas"
                  name="ROAS"
                  stroke="#eab308"
                  strokeWidth={2}
                  dot={{ fill: '#eab308', r: 3 }}
                  connectNulls={false}
                />
                {/* Reference line at 1x would need ReferenceLine import — skip for simplicity */}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Collapsible raw table ─────────────────────────────────────────── */}
      <div>
        <button
          type="button"
          onClick={() => setTableOpen((p) => !p)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          {tableOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {tableOpen ? 'ซ่อนข้อมูลรายวัน' : 'แสดงข้อมูลรายวัน (Raw)'}
        </button>

        {tableOpen && (
          <div className="mt-2 overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">วันที่</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs">Spend (฿)</th>
                  {hasRevenue && !isAwareness && (
                    <>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs">GMV (฿)</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs">ROAS</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {byDay.filter((r) => r.spend > 0).map((row) => (
                  <tr key={row.dateStr} className="hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2 font-mono text-xs">{row.dayLabel}</td>
                    <td className="text-right px-3 py-2 font-mono text-xs text-purple-600">{fmt(row.spend)}</td>
                    {hasRevenue && !isAwareness && (
                      <>
                        <td className="text-right px-3 py-2 font-mono text-xs text-green-600">
                          {row.gmv > 0 ? fmt(row.gmv) : <span className="text-muted-foreground">–</span>}
                        </td>
                        <td className={`text-right px-3 py-2 font-mono text-xs ${row.roas > 0 ? (row.roas >= 1 ? 'text-yellow-600' : 'text-red-500') : 'text-muted-foreground'}`}>
                          {row.roas > 0 ? `${row.roas.toFixed(2)}x` : '–'}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/30 border-t-2">
                <tr>
                  <td className="px-3 py-2 font-semibold text-xs">รวม</td>
                  <td className="text-right px-3 py-2 font-mono text-xs font-semibold text-purple-600">{fmt(totalSpend)}</td>
                  {hasRevenue && !isAwareness && (
                    <>
                      <td className="text-right px-3 py-2 font-mono text-xs font-semibold text-green-600">{fmt(totalGmv)}</td>
                      <td className={`text-right px-3 py-2 font-mono text-xs font-semibold ${roas >= 1 ? 'text-yellow-600' : roas > 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                        {roas > 0 ? `${roas.toFixed(2)}x` : '–'}
                      </td>
                    </>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── AdsBreakdownSection ──────────────────────────────────────────────────────
export function AdsBreakdownSection({ from, to }: Props) {
  const [activeTab, setActiveTab] = useState<AdsTab>('all')
  const [data, setData]           = useState<AdsBreakdownType | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  const fetchData = useCallback(
    async (tab: AdsTab) => {
      setLoading(true)
      setError(null)
      const result = await getAdsBreakdown(from, to, tab)
      if (result.success && result.data) {
        setData(result.data)
      } else {
        setError(result.error ?? 'ไม่สามารถโหลดข้อมูลได้')
        setData(null)
      }
      setLoading(false)
    },
    [from, to]
  )

  useEffect(() => {
    fetchData(activeTab)
  }, [from, to, activeTab, fetchData])

  return (
    <div className="space-y-4">
      {/* Tab selector */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground font-medium shrink-0">Ads Type:</span>
        <div className="inline-flex rounded border overflow-hidden">
          <TabBtn active={activeTab === 'all'}       onClick={() => setActiveTab('all')}>All</TabBtn>
          <TabBtn active={activeTab === 'product'}   onClick={() => setActiveTab('product')}>Product GMV Max</TabBtn>
          <TabBtn active={activeTab === 'live'}      onClick={() => setActiveTab('live')}>Live GMV Max</TabBtn>
          <TabBtn active={activeTab === 'awareness'} onClick={() => setActiveTab('awareness')}>Awareness</TabBtn>
        </div>
      </div>

      {/* Panel */}
      <AdsPanel
        breakdown={data}
        loading={loading}
        error={error}
        isAwareness={activeTab === 'awareness'}
      />
    </div>
  )
}
