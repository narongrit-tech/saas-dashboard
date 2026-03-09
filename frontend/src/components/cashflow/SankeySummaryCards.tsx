'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react'

interface SummaryData {
  totalIn: number
  totalOut: number
  net: number
}

interface Props {
  summary: SummaryData | null
  loading: boolean
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function SankeySummaryCards({ summary, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
            </CardHeader>
            <CardContent>
              <div className="h-7 w-32 animate-pulse rounded bg-gray-200" />
              <div className="mt-1 h-3 w-20 animate-pulse rounded bg-gray-100" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (!summary) return null

  const isNetPositive = summary.net >= 0

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {/* Total Inflow */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Inflow</CardTitle>
          <div className="rounded-lg bg-green-50 p-2 text-green-600">
            <TrendingUp className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">
            ฿{formatCurrency(summary.totalIn)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">เงินเข้าทั้งหมด</p>
        </CardContent>
      </Card>

      {/* Total Outflow */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Outflow</CardTitle>
          <div className="rounded-lg bg-red-50 p-2 text-red-600">
            <TrendingDown className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">
            ฿{formatCurrency(summary.totalOut)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">เงินออกทั้งหมด</p>
        </CardContent>
      </Card>

      {/* Net */}
      <Card
        className={
          isNetPositive ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
        }
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Net</CardTitle>
          <div
            className={`rounded-lg p-2 ${
              isNetPositive
                ? 'bg-green-100 text-green-600'
                : 'bg-red-100 text-red-600'
            }`}
          >
            <DollarSign className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${
              isNetPositive ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {isNetPositive ? '' : '-'}฿{formatCurrency(Math.abs(summary.net))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Inflow - Outflow</p>
        </CardContent>
      </Card>
    </div>
  )
}
