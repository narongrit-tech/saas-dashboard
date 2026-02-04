'use client'

/**
 * GMV Cards Component
 * 3-card dashboard: B (Created), C (Fulfilled), Leakage
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, Package, AlertTriangle } from 'lucide-react'
import { GMVSummary } from '@/app/(dashboard)/sales/actions'

interface GMVCardsProps {
  data: GMVSummary | null
  loading: boolean
  error: string | null
}

export function GMVCards({ data, loading, error }: GMVCardsProps) {
  // Format currency helper
  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  // Format percentage helper
  const formatPercent = (value: number) => {
    return value.toFixed(2)
  }

  // Loading state
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32 animate-pulse" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-24 animate-pulse mb-2" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16 animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
        เกิดข้อผิดพลาด: {error}
      </div>
    )
  }

  // No data
  if (!data) {
    return null
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Card B: GMV (Orders Created) */}
      <Card className="border-blue-200 dark:border-blue-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-300">
              GMV (Orders Created)
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </div>
          <CardDescription className="text-xs">
            ยอดรวมตาม Created Time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">
            ฿{formatCurrency(data.gmv_created)}
          </div>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
            {data.orders_created.toLocaleString()} orders
          </p>
        </CardContent>
      </Card>

      {/* Card C: GMV (Fulfilled) */}
      <Card className="border-green-200 dark:border-green-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-green-700 dark:text-green-300">
              Fulfilled GMV
            </CardTitle>
            <Package className="h-4 w-4 text-green-500" />
          </div>
          <CardDescription className="text-xs">
            ยอดรวมตาม Shipped Time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-900 dark:text-green-100">
            ฿{formatCurrency(data.gmv_fulfilled)}
          </div>
          <p className="text-xs text-green-600 dark:text-green-400 mt-1">
            {data.orders_fulfilled.toLocaleString()} orders
          </p>
        </CardContent>
      </Card>

      {/* Card Leakage: B - C */}
      <Card className="border-orange-200 dark:border-orange-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-orange-700 dark:text-orange-300">
              Cancel / Leakage
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </div>
          <CardDescription className="text-xs">
            ยกเลิก + ยังไม่จัดส่ง
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-900 dark:text-orange-100">
            ฿{formatCurrency(data.leakage_amount)}
          </div>
          <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
            {formatPercent(data.leakage_pct)}% of created GMV
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
