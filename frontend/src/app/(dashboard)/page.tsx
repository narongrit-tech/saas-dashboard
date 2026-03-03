import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, TrendingDown, DollarSign, Megaphone, Package, AlertCircle } from 'lucide-react'
import { getPerformanceDashboard } from './actions'
import { PerformanceTrendChart } from '@/components/dashboard/PerformanceTrendChart'

export const dynamic = 'force-dynamic'

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDateRange(startDate: string, endDate: string): string {
  const fmt = (d: string) => {
    const [, m, day] = d.split('-')
    return `${parseInt(day)}/${parseInt(m)}`
  }
  return `${fmt(startDate)} – ${fmt(endDate)}`
}

export default async function PerformanceDashboardPage() {
  const result = await getPerformanceDashboard()

  if (!result.success || !result.data) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-red-600">
            <AlertCircle className="h-5 w-5" />
            <p className="text-lg font-semibold">เกิดข้อผิดพลาด</p>
          </div>
          <p className="text-sm text-muted-foreground">{result.error || 'ไม่สามารถโหลดข้อมูลได้'}</p>
        </div>
      </div>
    )
  }

  const { summary, trend } = result.data
  const isProfit = summary.netProfit >= 0

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold">Performance Dashboard</h1>
        <p className="text-muted-foreground">
          7 วันที่ผ่านมา ({formatDateRange(summary.startDate, summary.endDate)}) · Asia/Bangkok
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* GMV */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">GMV (7 วัน)</CardTitle>
            <div className="rounded-lg bg-green-50 p-2 text-green-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ฿{formatCurrency(summary.gmv)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">ยอดขายรวม (ไม่รวมยกเลิก)</p>
          </CardContent>
        </Card>

        {/* Ad Spend */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ad Spend (7 วัน)</CardTitle>
            <div className="rounded-lg bg-purple-50 p-2 text-purple-600">
              <Megaphone className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              ฿{formatCurrency(summary.adSpend)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">ค่าโฆษณา (Performance)</p>
          </CardContent>
        </Card>

        {/* COGS */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">COGS (7 วัน)</CardTitle>
            <div className="rounded-lg bg-orange-50 p-2 text-orange-600">
              <Package className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              ฿{formatCurrency(summary.cogs)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">ต้นทุนขาย (FIFO/AVG)</p>
          </CardContent>
        </Card>

        {/* Operating */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Operating (7 วัน)</CardTitle>
            <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
              <DollarSign className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              ฿{formatCurrency(summary.operating)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">ค่าดำเนินงาน</p>
          </CardContent>
        </Card>

        {/* Net Profit */}
        <Card className={isProfit ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Profit (7 วัน)</CardTitle>
            <div className={`rounded-lg p-2 ${isProfit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {isProfit ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${isProfit ? 'text-green-700' : 'text-red-700'}`}>
              {isProfit ? '' : '-'}฿{formatCurrency(Math.abs(summary.netProfit))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {isProfit ? '✓ กำไร' : '✗ ขาดทุน'} · GMV - Ads - COGS - Operating
            </p>
          </CardContent>
        </Card>

        {/* ROAS */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ROAS (7 วัน)</CardTitle>
            <div className="rounded-lg bg-yellow-50 p-2 text-yellow-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {summary.roas.toFixed(2)}x
            </div>
            <p className="text-xs text-muted-foreground mt-1">GMV / Ad Spend</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Trend: GMV vs Ad Spend vs Net Profit (7 วัน)</CardTitle>
        </CardHeader>
        <CardContent>
          <PerformanceTrendChart data={trend} />
        </CardContent>
      </Card>

      {/* P&L Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>P&L Breakdown (7 วัน)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">GMV (Revenue)</span>
              <span className="font-mono text-green-600">
                ฿{formatCurrency(summary.gmv)}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Less: Ad Spend</span>
              <span className="font-mono text-red-600">
                (฿{formatCurrency(summary.adSpend)})
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Less: COGS</span>
              <span className="font-mono text-red-600">
                (฿{formatCurrency(summary.cogs)})
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Less: Operating Expenses</span>
              <span className="font-mono text-red-600">
                (฿{formatCurrency(summary.operating)})
              </span>
            </div>
            <div className="flex justify-between border-t-2 pt-3">
              <span className="text-lg font-bold">Net Profit</span>
              <span className={`text-lg font-bold font-mono ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                {isProfit ? '' : '-'}฿{formatCurrency(Math.abs(summary.netProfit))}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
