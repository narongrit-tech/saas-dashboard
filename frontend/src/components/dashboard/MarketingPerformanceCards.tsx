'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Target, Eye, BarChart2 } from 'lucide-react'

interface Props {
  blendedRoas: number
  attributedRoas: number
  awarenessSpend: number
  productSpend: number
  liveSpend: number
  totalAdSpend: number
}

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function BarSegment({ pct, color, label }: { pct: number; color: string; label: string }) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setWidth(pct))
    return () => cancelAnimationFrame(raf)
  }, [pct])
  if (pct <= 0) return null
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${color} transition-all duration-300 ease-out`} style={{ width: `${Math.min(100, width)}%` }} />
      </div>
      <span className="w-12 text-right font-mono text-muted-foreground">{pct.toFixed(1)}%</span>
      <span className="w-20 text-muted-foreground">{label}</span>
    </div>
  )
}

export function MarketingPerformanceCards({
  blendedRoas,
  attributedRoas,
  awarenessSpend,
  productSpend,
  liveSpend,
  totalAdSpend,
}: Props) {
  const attributedSpend = productSpend + liveSpend
  const productPct   = totalAdSpend > 0 ? (productSpend / totalAdSpend) * 100 : 0
  const livePct      = totalAdSpend > 0 ? (liveSpend / totalAdSpend) * 100 : 0
  const awarenessPct = totalAdSpend > 0 ? (awarenessSpend / totalAdSpend) * 100 : 0

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

      {/* Blended ROAS */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Blended ROAS</CardTitle>
          <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 p-2 text-yellow-600 dark:text-yellow-400">
            <Target className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold tracking-tight ${blendedRoas >= 1 ? 'text-yellow-600 dark:text-yellow-400' : blendedRoas > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
            {blendedRoas > 0 ? `${blendedRoas.toFixed(2)}x` : '–'}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Revenue / Total Ads (incl. awareness)</p>
        </CardContent>
      </Card>

      {/* Attributed ROAS */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Attributed ROAS</CardTitle>
          <div className="rounded-lg bg-violet-50 dark:bg-violet-900/20 p-2 text-violet-600 dark:text-violet-400">
            <Target className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold tracking-tight ${attributedRoas >= 1 ? 'text-violet-600 dark:text-violet-400' : attributedRoas > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
            {attributedRoas > 0 ? `${attributedRoas.toFixed(2)}x` : '–'}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            AdPerf Revenue / Attributed Spend
            {attributedSpend > 0 && <span className="block">{`(฿${fmt(attributedSpend)})`}</span>}
          </p>
        </CardContent>
      </Card>

      {/* Awareness Spend */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Awareness Spend</CardTitle>
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-2 text-amber-600 dark:text-amber-400">
            <Eye className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 tracking-tight">
            {awarenessSpend > 0 ? `฿${fmt(awarenessSpend)}` : '–'}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Tiger brand awareness (no GMV attribution)</p>
        </CardContent>
      </Card>

      {/* Ads Mix */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Ads Mix</CardTitle>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/20 p-2 text-slate-600 dark:text-slate-400">
            <BarChart2 className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          {totalAdSpend > 0 ? (
            <div className="space-y-2 pt-1">
              <BarSegment pct={productPct}   color="bg-violet-500"  label="Product" />
              <BarSegment pct={livePct}      color="bg-pink-500"    label="Live" />
              <BarSegment pct={awarenessPct} color="bg-amber-400"   label="Awareness" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground pt-1">ไม่มีข้อมูล</p>
          )}
          <p className="text-xs text-muted-foreground mt-2">สัดส่วนค่าโฆษณาตามประเภท</p>
        </CardContent>
      </Card>

    </div>
  )
}
