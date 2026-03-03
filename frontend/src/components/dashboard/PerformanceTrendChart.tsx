'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { PerformanceTrendDay } from '@/app/(dashboard)/actions'

interface PerformanceTrendChartProps {
  data: PerformanceTrendDay[]
}

export function PerformanceTrendChart({ data }: PerformanceTrendChartProps) {
  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis tickFormatter={(v) => `฿${Number(v).toLocaleString()}`} width={80} />
          <Tooltip
            formatter={(value) => [
              `฿${Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
            ]}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="gmv"
            name="GMV"
            stroke="#22c55e"
            strokeWidth={2}
            dot={{ fill: '#22c55e' }}
          />
          <Line
            type="monotone"
            dataKey="adSpend"
            name="Ad Spend"
            stroke="#a855f7"
            strokeWidth={2}
            dot={{ fill: '#a855f7' }}
          />
          <Line
            type="monotone"
            dataKey="net"
            name="Net Profit"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ fill: '#3b82f6' }}
            strokeDasharray="4 2"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
