'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DateRangePicker, DateRangeResult } from '@/components/shared/DateRangePicker'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, Users, ShoppingCart, Coins, DollarSign } from 'lucide-react'
import { getAffiliateReportStructured, AffiliatePerformance, AffiliateReportData } from './actions'
import { formatBangkok, startOfDayBangkok, getBangkokNow } from '@/lib/bangkok-time'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

export default function AffiliateReportPage() {
  const [reportData, setReportData] = useState<AffiliateReportData>({
    internal_rows: [],
    external_aggregate: {
      total_count: 0,
      total_orders: 0,
      total_gmv: 0,
      commission_organic: 0,
      commission_shop_ad: 0,
      commission_total: 0
    },
    external_top10: []
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [dateRange, setDateRange] = useState<DateRangeResult>({
    startDate: startOfDayBangkok(),
    endDate: getBangkokNow()
  })

  useEffect(() => {
    fetchReport()
  }, [dateRange])

  const fetchReport = async () => {
    setLoading(true)
    setError(null)

    try {
      const filters = {
        startDate: formatBangkok(dateRange.startDate, 'yyyy-MM-dd'),
        endDate: formatBangkok(dateRange.endDate, 'yyyy-MM-dd')
      }

      const result = await getAffiliateReportStructured(filters)

      if (result.success && result.data) {
        setReportData(result.data)
      } else {
        setError(result.error || 'เกิดข้อผิดพลาด')
      }
    } catch (err) {
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }

  // Calculate summary totals
  const internal_total_commission = reportData.internal_rows.reduce((sum, r) => sum + r.commission_total, 0)
  const internal_total_organic = reportData.internal_rows.reduce((sum, r) => sum + r.commission_organic, 0)
  const internal_total_ads = reportData.internal_rows.reduce((sum, r) => sum + r.commission_shop_ad, 0)
  const internal_total_orders = reportData.internal_rows.reduce((sum, r) => sum + r.total_orders, 0)
  const internal_total_gmv = reportData.internal_rows.reduce((sum, r) => sum + r.total_gmv, 0)

  const external_total_commission = reportData.external_aggregate.commission_total
  const external_total_organic = reportData.external_aggregate.commission_organic
  const external_total_ads = reportData.external_aggregate.commission_shop_ad
  const external_total_orders = reportData.external_aggregate.total_orders
  const external_total_gmv = reportData.external_aggregate.total_gmv

  const total_affiliates = reportData.internal_rows.length + reportData.external_aggregate.total_count
  const total_orders = internal_total_orders + external_total_orders
  const total_gmv = internal_total_gmv + external_total_gmv
  const total_commission = internal_total_commission + external_total_commission
  const total_organic = internal_total_organic + external_total_organic
  const total_ads = internal_total_ads + external_total_ads

  // Donut chart data (Internal vs External)
  const donutData = [
    { name: 'Internal', value: internal_total_commission },
    { name: 'External', value: external_total_commission }
  ]
  const DONUT_COLORS = ['#3b82f6', '#10b981']

  // Horizontal stacked bar data (Internal affiliates)
  const barChartData = reportData.internal_rows.map(perf => ({
    name: perf.display_name || perf.channel_id,
    organic: perf.commission_organic,
    ads: perf.commission_shop_ad
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Affiliate Performance Report</h1>
          <p className="text-muted-foreground">รายงานยอดขายและ commission ของ affiliates</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <div className="flex-1 space-y-2">
              <Label>ช่วงวันที่</Label>
              <DateRangePicker
                value={dateRange}
                onChange={setDateRange}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Message */}
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Affiliates</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total_affiliates}</div>
            <p className="text-xs text-muted-foreground">
              {reportData.internal_rows.length} internal, {reportData.external_aggregate.total_count} external
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total_orders.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              ฿{formatCurrency(total_gmv)} GMV
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Commission Organic</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">฿{formatCurrency(total_organic)}</div>
            <p className="text-xs text-muted-foreground">
              Standard commission
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Commission Ads</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">฿{formatCurrency(total_ads)}</div>
            <p className="text-xs text-muted-foreground">
              Shop ads commission
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Chart #1: Donut Chart - Internal vs External */}
      {!loading && total_commission > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Commission Split: Internal vs External</CardTitle>
            <CardDescription>สัดส่วนค่า commission แยกตาม internal และ external affiliates</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={120}
                  fill="#8884d8"
                  dataKey="value"
                  label={(entry) => `${entry.name}: ฿${formatCurrency(entry.value)}`}
                  labelLine={true}
                >
                  {donutData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number | undefined) => value != null ? `฿${formatCurrency(value)}` : '฿0.00'} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Chart #2: Horizontal Stacked Bar - Internal Affiliates */}
      {!loading && reportData.internal_rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Internal Affiliates Commission Breakdown</CardTitle>
            <CardDescription>รายได้แยกตาม organic และ ads ของ internal affiliates แต่ละคน</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(400, reportData.internal_rows.length * 50)}>
              <BarChart data={barChartData} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={150} />
                <Tooltip formatter={(value: number | undefined) => value != null ? `฿${formatCurrency(value)}` : '฿0.00'} />
                <Legend />
                <Bar dataKey="organic" stackId="a" fill="#3b82f6" name="Organic" />
                <Bar dataKey="ads" stackId="a" fill="#10b981" name="Ads" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Table #1: Internal Affiliates */}
      <Card>
        <CardHeader>
          <CardTitle>Internal Affiliates Performance</CardTitle>
          <CardDescription>รายละเอียด internal affiliates ทั้งหมด</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel ID</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">GMV</TableHead>
                  <TableHead className="text-right">Avg Order</TableHead>
                  <TableHead className="text-right">Commission Organic</TableHead>
                  <TableHead className="text-right">Commission Ads</TableHead>
                  <TableHead className="text-right">Total Commission</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <TableRow key={index}>
                      {Array.from({ length: 8 }).map((_, colIndex) => (
                        <TableCell key={colIndex}>
                          <div className="h-4 w-20 animate-pulse rounded bg-gray-200" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : reportData.internal_rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground space-y-2">
                        <Users className="h-12 w-12" />
                        <p className="text-lg font-medium">ไม่พบข้อมูล Internal Affiliates</p>
                        <p className="text-sm">ยังไม่มียอดขาย internal affiliate ในช่วงเวลานี้</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  reportData.internal_rows.map((perf) => (
                    <TableRow key={perf.channel_id}>
                      <TableCell className="font-mono text-sm">{perf.channel_id}</TableCell>
                      <TableCell>{perf.display_name || '-'}</TableCell>
                      <TableCell className="text-right">{perf.total_orders.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">
                        ฿{formatCurrency(perf.total_gmv)}
                      </TableCell>
                      <TableCell className="text-right">
                        ฿{formatCurrency(perf.avg_order_value)}
                      </TableCell>
                      <TableCell className="text-right">
                        ฿{formatCurrency(perf.commission_organic)}
                      </TableCell>
                      <TableCell className="text-right">
                        ฿{formatCurrency(perf.commission_shop_ad)}
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        ฿{formatCurrency(perf.commission_total)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Table #2: External Affiliates (Top 10) */}
      <Card>
        <CardHeader>
          <CardTitle>External Affiliates - Top 10</CardTitle>
          <CardDescription>
            10 อันดับแรกของ external affiliates (รวม {reportData.external_aggregate.total_count} คน,
            commission รวม ฿{formatCurrency(external_total_commission)})
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel ID</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">GMV</TableHead>
                  <TableHead className="text-right">Avg Order</TableHead>
                  <TableHead className="text-right">Commission Organic</TableHead>
                  <TableHead className="text-right">Commission Ads</TableHead>
                  <TableHead className="text-right">Total Commission</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <TableRow key={index}>
                      {Array.from({ length: 7 }).map((_, colIndex) => (
                        <TableCell key={colIndex}>
                          <div className="h-4 w-20 animate-pulse rounded bg-gray-200" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : reportData.external_top10.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground space-y-2">
                        <Users className="h-12 w-12" />
                        <p className="text-lg font-medium">ไม่พบข้อมูล External Affiliates</p>
                        <p className="text-sm">ยังไม่มียอดขาย external affiliate ในช่วงเวลานี้</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  reportData.external_top10.map((perf, index) => (
                    <TableRow key={perf.channel_id}>
                      <TableCell className="font-mono text-sm">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">#{index + 1}</Badge>
                          {perf.channel_id}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{perf.total_orders.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">
                        ฿{formatCurrency(perf.total_gmv)}
                      </TableCell>
                      <TableCell className="text-right">
                        ฿{formatCurrency(perf.avg_order_value)}
                      </TableCell>
                      <TableCell className="text-right">
                        ฿{formatCurrency(perf.commission_organic)}
                      </TableCell>
                      <TableCell className="text-right">
                        ฿{formatCurrency(perf.commission_shop_ad)}
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        ฿{formatCurrency(perf.commission_total)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
