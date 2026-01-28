'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SalesAggregates } from '@/types/sales'

interface SalesStoryPanelProps {
  aggregates: SalesAggregates | null
  loading: boolean
  error?: string | null
}

export function SalesStoryPanel({ aggregates, loading, error }: SalesStoryPanelProps) {
  // Safe formatter for currency - handles null/undefined
  const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined || isNaN(amount)) {
      return '0.00'
    }
    return amount.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  // Safe formatter for numbers - handles null/undefined
  const formatNumber = (num: number | null | undefined) => {
    if (num === null || num === undefined || isNaN(num)) {
      return '0'
    }
    return num.toLocaleString('th-TH')
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-600 mb-6">
        {error}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        {/* Left 60% (3 cols) - Money Story */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <div className="h-4 w-48 animate-pulse rounded bg-gray-200" />
          </CardHeader>
          <CardContent>
            <div className="h-12 w-64 animate-pulse rounded bg-gray-200 mb-2" />
            <div className="h-3 w-40 animate-pulse rounded bg-gray-200 mb-4" />
            <div className="border-t border-dashed border-red-300 my-4" />
            <div className="flex justify-between">
              <div className="h-3 w-32 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-48 animate-pulse rounded bg-gray-200" />
            </div>
          </CardContent>
        </Card>

        {/* Right 40% (2 cols) - Orders Story */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="h-4 w-48 animate-pulse rounded bg-gray-200" />
          </CardHeader>
          <CardContent>
            <div className="h-12 w-32 animate-pulse rounded bg-gray-200 mb-2" />
            <div className="h-3 w-28 animate-pulse rounded bg-gray-200 mb-4" />
            <div className="border-t border-dashed border-red-300 my-4" />
            <div className="flex justify-between">
              <div className="h-3 w-24 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-40 animate-pulse rounded bg-gray-200" />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!aggregates) {
    return null
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
      {/* Left 60% (3 cols) - Money Story Card */}
      <Card className="lg:col-span-3">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            ยอดขาย (ตามวันที่สั่ง)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Big Number: Net Revenue */}
          <div>
            <div className="text-4xl font-bold text-green-600">
              ฿{formatCurrency(aggregates?.revenue_net)}
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              Revenue (Net) - ตัดยกเลิกในวันเดียวกัน
            </p>
            <p className="text-xs text-purple-600 dark:text-purple-400 mt-2">
              Gross วันนี้: ฿{formatCurrency(aggregates?.revenue_gross)}
            </p>
          </div>

          {/* Divider */}
          <div className="border-t border-dashed border-red-300 my-4" />

          {/* Bottom Row */}
          <div className="flex justify-between items-start text-xs">
            {/* Bottom-left: Gross Revenue */}
            <div className="text-muted-foreground">
              <span className="font-medium">Revenue (Gross):</span>
              <br />
              ฿{formatCurrency(aggregates?.revenue_gross)}
            </div>

            {/* Bottom-right: Cancel Rate (Red) */}
            <div className="text-right">
              <p className="text-red-600 dark:text-red-400 font-medium">
                ยกเลิกในวันเดียวกัน: {(aggregates?.cancel_rate_revenue_pct ?? 0).toFixed(2)}%
              </p>
              <p className="text-red-600 dark:text-red-400">
                (฿{formatCurrency(aggregates?.cancelled_same_day_amount)})
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Right 40% (2 cols) - Orders Story Card */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            จำนวนออเดอร์ (ตามวันที่สั่ง)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Big Number: Net Orders */}
          <div>
            <div className="text-4xl font-bold text-blue-600">
              {formatNumber(aggregates?.orders_net)}
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              Orders (Net) - ตัดยกเลิกในวันเดียวกัน
            </p>
            <p className="text-xs text-purple-600 dark:text-purple-400 mt-2">
              Gross วันนี้: {formatNumber(aggregates?.orders_gross)} ออเดอร์
            </p>
          </div>

          {/* Divider */}
          <div className="border-t border-dashed border-red-300 my-4" />

          {/* Bottom Row */}
          <div className="flex justify-between items-start text-xs">
            {/* Bottom-left: Gross Orders */}
            <div className="text-muted-foreground">
              <span className="font-medium">Orders (Gross):</span>
              <br />
              {formatNumber(aggregates?.orders_gross)}
            </div>

            {/* Bottom-right: Cancel Rate (Red) - Same as left card */}
            <div className="text-right">
              <p className="text-red-600 dark:text-red-400 font-medium">
                ยกเลิกในวันเดียวกัน: {(aggregates?.cancel_rate_orders_pct ?? 0).toFixed(2)}%
              </p>
              <p className="text-red-600 dark:text-red-400">
                ({formatNumber(aggregates?.cancelled_same_day_orders)}/{formatNumber(aggregates?.orders_gross)})
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
