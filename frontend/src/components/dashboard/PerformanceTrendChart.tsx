'use client'

import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import type { LegendPayload } from 'recharts/types/component/DefaultLegendContent'
import type { PerformanceTrendDay } from '@/app/(dashboard)/actions'

interface Props {
  data: PerformanceTrendDay[]
}

type ChartMode = 'business' | 'marketing' | 'cost'

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'px-3 py-1 text-xs border-r last:border-r-0 transition-colors',
        active
          ? 'bg-primary text-primary-foreground font-medium'
          : 'bg-background text-muted-foreground hover:bg-muted',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

const thbFmt = (v: number) => `฿${Number(v).toLocaleString('th-TH', { minimumFractionDigits: 0 })}`

export function PerformanceTrendChart({ data }: Props) {
  const [mode, setMode]                 = useState<ChartMode>('business')
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())

  const handleLegendClick = (entry: LegendPayload) => {
    const key = typeof entry.dataKey === 'string' ? entry.dataKey : undefined
    if (!key) return
    setHiddenSeries(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Reset hidden series when mode changes so the new chart starts fully visible
  const handleModeChange = (nextMode: ChartMode) => {
    setMode(nextMode)
    setHiddenSeries(new Set())
  }

  const legendFormatter = (value: string, entry: LegendPayload) => {
    const key = typeof entry.dataKey === 'string' ? entry.dataKey : ''
    return <span style={{ opacity: hiddenSeries.has(key) ? 0.4 : 1 }}>{value}</span>
  }

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground font-medium">View:</span>
        <div className="inline-flex rounded border overflow-hidden">
          <ModeButton active={mode === 'business'}  onClick={() => handleModeChange('business')}>Business</ModeButton>
          <ModeButton active={mode === 'marketing'} onClick={() => handleModeChange('marketing')}>Marketing Spend</ModeButton>
          <ModeButton active={mode === 'cost'}      onClick={() => handleModeChange('cost')}>Cost Structure</ModeButton>
        </div>
      </div>

      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.3)" />
            <XAxis dataKey="date" />
            <YAxis tickFormatter={thbFmt} width={90} />
            <Tooltip formatter={(value) => [thbFmt(Number(value))]} />
            <Legend
              onClick={handleLegendClick}
              wrapperStyle={{ cursor: 'pointer' }}
              formatter={legendFormatter}
            />

            {mode === 'business' && (
              <>
                <Line type="monotone" dataKey="gmv"     name="Revenue"    stroke="#22c55e" strokeWidth={2.5} dot={{ r: 4, fill: '#22c55e', strokeWidth: 0 }} hide={hiddenSeries.has('gmv')} />
                <Line type="monotone" dataKey="adSpend" name="Ad Spend"   stroke="#a855f7" strokeWidth={2.5} dot={{ r: 4, fill: '#a855f7', strokeWidth: 0 }} hide={hiddenSeries.has('adSpend')} />
                <Line type="monotone" dataKey="net"     name="Net Profit" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }} strokeDasharray="4 2" hide={hiddenSeries.has('net')} />
              </>
            )}

            {mode === 'marketing' && (
              <>
                <Line type="monotone" dataKey="productSpend"   name="Product Ads" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 4, fill: '#8b5cf6', strokeWidth: 0 }} hide={hiddenSeries.has('productSpend')} />
                <Line type="monotone" dataKey="liveSpend"      name="Live Ads"    stroke="#ec4899" strokeWidth={2.5} dot={{ r: 4, fill: '#ec4899', strokeWidth: 0 }} hide={hiddenSeries.has('liveSpend')} />
                <Line type="monotone" dataKey="awarenessSpend" name="Awareness"   stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 4, fill: '#f59e0b', strokeWidth: 0 }} strokeDasharray="4 2" hide={hiddenSeries.has('awarenessSpend')} />
              </>
            )}

            {mode === 'cost' && (
              <>
                <Line type="monotone" dataKey="adSpend"   name="Ad Spend"  stroke="#a855f7" strokeWidth={2.5} dot={{ r: 4, fill: '#a855f7', strokeWidth: 0 }} hide={hiddenSeries.has('adSpend')} />
                <Line type="monotone" dataKey="cogs"      name="COGS"      stroke="#f97316" strokeWidth={2.5} dot={{ r: 4, fill: '#f97316', strokeWidth: 0 }} hide={hiddenSeries.has('cogs')} />
                <Line type="monotone" dataKey="operating" name="Operating" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }} hide={hiddenSeries.has('operating')} />
                <Line type="monotone" dataKey="tax"       name="Tax"       stroke="#ef4444" strokeWidth={2.5} dot={{ r: 4, fill: '#ef4444', strokeWidth: 0 }} strokeDasharray="4 2" hide={hiddenSeries.has('tax')} />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
