'use client'

/**
 * Ads Breakdown Section
 *
 * Self-contained client component. Receives date range (from/to) as props
 * and queries getAdsBreakdown server action independently for each tab.
 *
 * Tabs: All / Product GMV Max / Live GMV Max
 * - Switching tabs triggers a re-query with the same from/to date range
 * - Date range changes (from parent URL navigation) re-trigger query via useEffect dep
 */

import { useState, useEffect, useCallback } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Loader2, AlertCircle } from 'lucide-react'
import { getAdsBreakdown } from '@/app/(dashboard)/actions'
import type { AdsBreakdownType } from '@/app/(dashboard)/actions'

type AdsTab = 'all' | 'product' | 'live'

interface Props {
  from: string  // YYYY-MM-DD
  to: string    // YYYY-MM-DD
}

// ─── Number format helper ──────────────────────────────────────────────────────
function fmt(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ─── TypePanel ────────────────────────────────────────────────────────────────
function TypePanel({
  breakdown,
  loading,
  error,
}: {
  breakdown: AdsBreakdownType | null
  loading: boolean
  error: string | null
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">กำลังโหลด...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-6 text-red-600 text-sm">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    )
  }

  if (!breakdown || breakdown.totalSpend === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        ไม่มีข้อมูล Ads สำหรับช่วงวันที่นี้
      </p>
    )
  }

  const { totalSpend, totalGmv, roas, spendRange, roasRange, byDay, hasRevenue } = breakdown

  return (
    <div className="space-y-4">
      {/* No revenue info banner */}
      {!hasRevenue && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          ยังไม่มีข้อมูลรายได้จาก Ads — ต้อง import Performance Report ก่อน (GMV / ROAS ยังไม่พร้อม)
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-slate-50 p-3">
          <p className="text-xs text-muted-foreground">Total Spend</p>
          <p className="text-lg font-bold text-purple-600">฿{fmt(totalSpend)}</p>
          {spendRange.max > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Range: ฿{fmt(spendRange.min)} – ฿{fmt(spendRange.max)}/วัน
            </p>
          )}
        </div>

        <div className="rounded-lg border bg-slate-50 p-3">
          <p className="text-xs text-muted-foreground">Attributed GMV</p>
          {hasRevenue ? (
            <>
              <p className="text-lg font-bold text-green-600">฿{fmt(totalGmv)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">จาก ad_daily_performance.revenue</p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-muted-foreground">–</p>
              <p className="text-xs text-muted-foreground mt-0.5">ยังไม่มีข้อมูล</p>
            </>
          )}
        </div>

        <div className="rounded-lg border bg-slate-50 p-3">
          <p className="text-xs text-muted-foreground">ROAS</p>
          {hasRevenue ? (
            <>
              <p className={`text-lg font-bold ${roas >= 1 ? 'text-green-600' : roas > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                {roas > 0 ? `${roas.toFixed(2)}x` : '–'}
              </p>
              {roasRange.max > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Range: {roasRange.min.toFixed(2)}x – {roasRange.max.toFixed(2)}x
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-muted-foreground">–</p>
              <p className="text-xs text-muted-foreground mt-0.5">ต้องมี revenue ก่อน</p>
            </>
          )}
        </div>
      </div>

      {/* Per-day table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-4 font-medium text-muted-foreground">วันที่</th>
              <th className="text-right py-2 px-3 font-medium text-muted-foreground">Spend (฿)</th>
              {hasRevenue && (
                <>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">GMV (฿)</th>
                  <th className="text-right py-2 pl-3 font-medium text-muted-foreground">ROAS</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {byDay.filter((r) => r.spend > 0).map((row) => (
              <tr key={row.dateStr} className="border-b last:border-0 hover:bg-slate-50/50">
                <td className="py-2 pr-4 font-mono text-xs">{row.dayLabel}</td>
                <td className="text-right py-2 px-3 font-mono">
                  {row.spend > 0 ? fmt(row.spend) : <span className="text-muted-foreground">–</span>}
                </td>
                {hasRevenue && (
                  <>
                    <td className="text-right py-2 px-3 font-mono">
                      {row.gmv > 0 ? fmt(row.gmv) : <span className="text-muted-foreground">–</span>}
                    </td>
                    <td className={`text-right py-2 pl-3 font-mono ${row.roas > 0 ? (row.roas >= 1 ? 'text-green-600' : 'text-red-600') : ''}`}>
                      {row.roas > 0 ? `${row.roas.toFixed(2)}x` : <span className="text-muted-foreground">–</span>}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2">
              <td className="py-2 pr-4 font-semibold">รวม</td>
              <td className="text-right py-2 px-3 font-mono font-semibold text-purple-600">
                {fmt(totalSpend)}
              </td>
              {hasRevenue && (
                <>
                  <td className="text-right py-2 px-3 font-mono font-semibold text-green-600">
                    {fmt(totalGmv)}
                  </td>
                  <td className={`text-right py-2 pl-3 font-mono font-semibold ${roas >= 1 ? 'text-green-600' : roas > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                    {roas > 0 ? `${roas.toFixed(2)}x` : '–'}
                  </td>
                </>
              )}
            </tr>
          </tfoot>
        </table>
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

  // Re-query whenever from/to or activeTab changes
  useEffect(() => {
    fetchData(activeTab)
  }, [from, to, activeTab, fetchData])

  const handleTabChange = (value: string) => {
    setActiveTab(value as AdsTab)
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger value="all">All</TabsTrigger>
        <TabsTrigger value="product">Product GMV Max</TabsTrigger>
        <TabsTrigger value="live">Live GMV Max</TabsTrigger>
      </TabsList>

      {/* All three TabsContent render the same panel with current state;
          only the active tab is visible. We avoid remounting on tab switch
          by keeping a single panel and passing data/loading/error directly. */}
      <TabsContent value="all" className="pt-4">
        <TypePanel breakdown={data} loading={loading} error={error} />
      </TabsContent>
      <TabsContent value="product" className="pt-4">
        <TypePanel breakdown={data} loading={loading} error={error} />
      </TabsContent>
      <TabsContent value="live" className="pt-4">
        <TypePanel breakdown={data} loading={loading} error={error} />
      </TabsContent>
    </Tabs>
  )
}
