'use client'

import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
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
  const [mode, setMode] = useState<ChartMode>('business')

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground font-medium">View:</span>
        <div className="inline-flex rounded border overflow-hidden">
          <ModeButton active={mode === 'business'} onClick={() => setMode('business')}>Business</ModeButton>
          <ModeButton active={mode === 'marketing'} onClick={() => setMode('marketing')}>Marketing Spend</ModeButton>
          <ModeButton active={mode === 'cost'} onClick={() => setMode('cost')}>Cost Structure</ModeButton>
        </div>
      </div>

      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis tickFormatter={thbFmt} width={90} />
            <Tooltip formatter={(value) => [thbFmt(Number(value))]} />
            <Legend />

            {mode === 'business' && (
              <>
                <Line type="monotone" dataKey="gmv"     name="Revenue"    stroke="#22c55e" strokeWidth={2} dot={{ fill: '#22c55e' }} />
                <Line type="monotone" dataKey="adSpend" name="Ad Spend"   stroke="#a855f7" strokeWidth={2} dot={{ fill: '#a855f7' }} />
                <Line type="monotone" dataKey="net"     name="Net Profit" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} strokeDasharray="4 2" />
              </>
            )}

            {mode === 'marketing' && (
              <>
                <Line type="monotone" dataKey="productSpend"   name="Product Ads"  stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6' }} />
                <Line type="monotone" dataKey="liveSpend"      name="Live Ads"     stroke="#ec4899" strokeWidth={2} dot={{ fill: '#ec4899' }} />
                <Line type="monotone" dataKey="awarenessSpend" name="Awareness"    stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b' }} strokeDasharray="4 2" />
              </>
            )}

            {mode === 'cost' && (
              <>
                <Line type="monotone" dataKey="adSpend"   name="Ad Spend"   stroke="#a855f7" strokeWidth={2} dot={{ fill: '#a855f7' }} />
                <Line type="monotone" dataKey="cogs"      name="COGS"       stroke="#f97316" strokeWidth={2} dot={{ fill: '#f97316' }} />
                <Line type="monotone" dataKey="operating" name="Operating"  stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} />
                <Line type="monotone" dataKey="tax"       name="Tax"        stroke="#ef4444" strokeWidth={2} dot={{ fill: '#ef4444' }} strokeDasharray="4 2" />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
