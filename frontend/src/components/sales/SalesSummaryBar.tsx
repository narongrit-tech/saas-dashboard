'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SalesAggregates } from '@/app/(dashboard)/sales/actions'

interface SalesSummaryBarProps {
  aggregates: SalesAggregates | null
  loading: boolean
  error?: string | null
}

export function SalesSummaryBar({ aggregates, loading, error }: SalesSummaryBarProps) {
  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  const formatNumber = (num: number) => {
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
        {/* Primary Row - Skeleton */}
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
      {/* Primary Row: Revenue & Orders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Revenue (Paid) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Revenue (Paid)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              ฿{formatCurrency(aggregates.revenue_paid_excl_cancel)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Net after cancel: ฿{formatCurrency(aggregates.net_after_cancel)}
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
              {formatNumber(aggregates.orders_excl_cancel)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Cancelled: {formatNumber(aggregates.cancelled_orders)} orders
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Secondary Row: Units, AOV, Cancelled Amount */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 3: Units (Qty) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Units (Qty)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatNumber(aggregates.units_excl_cancel)}
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
              ฿{formatCurrency(aggregates.aov_net)}
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
              ฿{formatCurrency(aggregates.cancelled_amount)}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
