'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SalesAggregates } from '@/types/sales'
import { TikTokStyleAggregates } from '@/app/(dashboard)/sales/actions'

interface SalesSummaryBarProps {
  aggregates: SalesAggregates | null
  loading: boolean
  error?: string | null
  tiktokAggregates?: TikTokStyleAggregates | null
  tiktokLoading?: boolean
  showOnlySecondaryRow?: boolean // If true, only show Units/AOV/Cancelled row
}

export function SalesSummaryBar({ aggregates, loading, error, tiktokAggregates, tiktokLoading, showOnlySecondaryRow }: SalesSummaryBarProps) {
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
      <div className="space-y-4 mb-6">
        {/* Primary Row - Skeleton (skip if showOnlySecondaryRow) */}
        {!showOnlySecondaryRow && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
              </CardHeader>
              <CardContent>
                <div className="h-10 w-40 animate-pulse rounded bg-gray-200" />
                <div className="h-3 w-28 mt-2 animate-pulse rounded bg-gray-200" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
              </CardHeader>
              <CardContent>
                <div className="h-10 w-32 animate-pulse rounded bg-gray-200" />
                <div className="h-3 w-28 mt-2 animate-pulse rounded bg-gray-200" />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Secondary Row - Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="h-3 w-20 animate-pulse rounded bg-gray-200" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-24 animate-pulse rounded bg-gray-200" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (!aggregates) {
    return null
  }

  return (
    <div className="space-y-4 mb-6">
      {/* Primary Row: Revenue & Orders (skip if showOnlySecondaryRow) */}
      {!showOnlySecondaryRow && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card 1: Revenue (Net) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Revenue (Net)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                ฿{formatCurrency(aggregates?.revenue_net)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Gross: ฿{formatCurrency(aggregates?.revenue_gross)}
              </p>
            </CardContent>
          </Card>

          {/* Card 2: Orders */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Orders
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {formatNumber(aggregates?.orders_net)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Cancelled: {formatNumber(aggregates?.cancelled_same_day_orders)} orders
              </p>

              {/* TikTok-style reference (created_at-based) */}
              {!tiktokLoading && tiktokAggregates && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <p className="text-xs text-purple-600 dark:text-purple-400 font-medium">
                    ยอดรวมแบบ TikTok (วันที่สั่ง): {formatNumber(tiktokAggregates?.total_created_orders)} ออเดอร์
                  </p>
                  {(tiktokAggregates?.total_created_orders ?? 0) > 0 ? (
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-1">
                      ยกเลิกภายในวันนั้น: {(tiktokAggregates?.cancel_rate ?? 0).toFixed(2)}%
                      ({formatNumber(tiktokAggregates?.cancelled_created_orders)}/{formatNumber(tiktokAggregates?.total_created_orders)})
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      ยกเลิกภายในวันนั้น: -
                    </p>
                  )}
                </div>
              )}
              {tiktokLoading && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <div className="h-3 w-32 animate-pulse rounded bg-gray-200" />
                  <div className="h-3 w-28 animate-pulse rounded bg-gray-200 mt-1" />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Secondary Row: Units, AOV, Cancelled Amount, Lines/Orders */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Card 3: Units (Qty) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Units (Qty)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatNumber(aggregates?.total_units)}
            </div>
          </CardContent>
        </Card>

        {/* Card 4: AOV */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              AOV
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              ฿{formatCurrency(aggregates?.aov_net)}
            </div>
          </CardContent>
        </Card>

        {/* Card 5: Cancelled Amount */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Cancelled Amount
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-red-600">
              ฿{formatCurrency(aggregates?.cancelled_same_day_amount)}
            </div>
          </CardContent>
        </Card>

        {/* Card 6: Lines / Orders */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground" title="TikTok OrderSKUList 1 SKU = 1 บรรทัด ดังนั้นจำนวนบรรทัดอาจมากกว่าออเดอร์">
              Lines / Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1">
              <div className="text-sm">
                <span className="text-muted-foreground">Lines:</span>{' '}
                <span className="font-semibold">{formatNumber(aggregates?.total_lines)}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Orders:</span>{' '}
                <span className="font-semibold">{formatNumber(aggregates?.total_orders)}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Ratio:</span>{' '}
                <span className="font-semibold text-purple-600">{aggregates?.lines_per_order?.toFixed(2) || '0.00'}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
