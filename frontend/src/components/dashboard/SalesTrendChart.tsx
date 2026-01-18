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

interface TrendData {
  date: string
  sales: number
  expenses: number
}

interface SalesTrendChartProps {
  data: TrendData[]
}

export function SalesTrendChart({ data }: SalesTrendChartProps) {
  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip
            formatter={(value) => `฿${Number(value).toLocaleString()}`}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="sales"
            stroke="#22c55e"
            strokeWidth={2}
            dot={{ fill: '#22c55e' }}
          />
          <Line
            type="monotone"
            dataKey="expenses"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ fill: '#ef4444' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
