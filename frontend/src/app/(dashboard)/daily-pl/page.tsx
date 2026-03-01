'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { TrendingUp, DollarSign, AlertCircle } from 'lucide-react'
import { getDailyPLForDate } from './actions'
import { DailyPLData } from '@/lib/daily-pl'
import { getBangkokNow, formatBangkok, toBangkokTime } from '@/lib/bangkok-time'
import { SingleDatePicker } from '@/components/shared/SingleDatePicker'

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDateThai(dateStr: string): string {
  // Use Bangkok timezone for date formatting
  const bangkokDate = toBangkokTime(new Date(dateStr))
  return bangkokDate.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function DailyPLPage() {
  const [selectedDate, setSelectedDate] = useState<Date>(getBangkokNow())
  const [plData, setPLData] = useState<DailyPLData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchPLData()
  }, [selectedDate])

  const fetchPLData = async () => {
    try {
      setLoading(true)
      setError(null)

      const dateStr = formatBangkok(selectedDate, 'yyyy-MM-dd')
      const result = await getDailyPLForDate(dateStr)

      if (!result.success || !result.data) {
        setError(result.error || 'ไม่สามารถโหลดข้อมูลได้')
        setPLData(null)
        return
      }

      setPLData(result.data)
    } catch (err) {
      console.error('Error fetching P&L:', err)
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล')
      setPLData(null)
    } finally {
      setLoading(false)
    }
  }

  const isProfit = plData ? plData.net_profit >= 0 : false

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Daily P&L</h1>
        <p className="text-muted-foreground">กำไร/ขาดทุนรายวัน - ข้อมูลจริงจากระบบ</p>
      </div>

      {/* Date Selector */}
      <div className="max-w-md">
        <Label>เลือกวันที่</Label>
        <div className="mt-2">
          <SingleDatePicker
            value={selectedDate}
            onChange={setSelectedDate}
            className="min-w-[240px]"
          />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatDateThai(formatBangkok(selectedDate, 'yyyy-MM-dd'))}
        </p>
      </div>

      {/* Error State */}
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 p-4 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-40 animate-pulse rounded bg-gray-200" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* P&L Data */}
      {!loading && plData && (
        <>
          {/* Revenue & Expenses */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {/* Revenue */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Revenue</CardTitle>
                <div className="rounded-lg bg-green-50 p-2 text-green-600">
                  <TrendingUp className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  ฿{formatCurrency(plData.revenue)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">ยอดขาย (ไม่รวมยกเลิก)</p>
              </CardContent>
            </Card>

            {/* Advertising Cost */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Advertising</CardTitle>
                <div className="rounded-lg bg-purple-50 p-2 text-purple-600">
                  <DollarSign className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-purple-600">
                  -฿{formatCurrency(plData.advertising_cost)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">ค่าโฆษณา</p>
              </CardContent>
            </Card>

            {/* COGS */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">COGS</CardTitle>
                <div className="rounded-lg bg-orange-50 p-2 text-orange-600">
                  <DollarSign className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">
                  -฿{formatCurrency(plData.cogs)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">ต้นทุนขาย</p>
              </CardContent>
            </Card>

            {/* Operating Expenses */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Operating</CardTitle>
                <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                  <DollarSign className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">
                  -฿{formatCurrency(plData.operating_expenses)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">ค่าดำเนินงาน</p>
              </CardContent>
            </Card>

            {/* Tax Expenses */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Tax</CardTitle>
                <div className="rounded-lg bg-rose-50 p-2 text-rose-600">
                  <DollarSign className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-rose-600">
                  -฿{formatCurrency(plData.tax_expenses)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">ค่าใช้จ่ายภาษี</p>
              </CardContent>
            </Card>
          </div>

          {/* Net Profit (Highlighted) */}
          <Card
            className={
              isProfit
                ? 'border-green-200 bg-green-50'
                : 'border-red-200 bg-red-50'
            }
          >
            <CardHeader>
              <CardTitle className="text-lg">Net Profit / Loss</CardTitle>
              <p className="text-sm text-muted-foreground">
                กำไรสุทธิ = Revenue - Advertising - COGS - Operating - Tax
              </p>
            </CardHeader>
            <CardContent>
              <div
                className={`text-4xl font-bold ${
                  isProfit ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {isProfit ? '฿' : '-฿'}
                {formatCurrency(Math.abs(plData.net_profit))}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {isProfit ? '✓ กำไร' : '✗ ขาดทุน'} วันที่ {formatDateThai(formatBangkok(selectedDate, 'yyyy-MM-dd'))}
              </p>
            </CardContent>
          </Card>

          {/* Breakdown Table */}
          <Card>
            <CardHeader>
              <CardTitle>P&L Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between border-b pb-2">
                  <span className="font-medium">Revenue</span>
                  <span className="font-mono text-green-600">
                    ฿{formatCurrency(plData.revenue)}
                  </span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="font-medium">Less: Advertising Cost</span>
                  <span className="font-mono text-red-600">
                    (฿{formatCurrency(plData.advertising_cost)})
                  </span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="font-medium">Less: COGS</span>
                  <span className="font-mono text-red-600">
                    (฿{formatCurrency(plData.cogs)})
                  </span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="font-medium">Less: Operating Expenses</span>
                  <span className="font-mono text-red-600">
                    (฿{formatCurrency(plData.operating_expenses)})
                  </span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="font-medium">Less: Tax Expenses</span>
                  <span className="font-mono text-red-600">
                    (฿{formatCurrency(plData.tax_expenses)})
                  </span>
                </div>
                <div className="flex justify-between border-t-2 pt-3">
                  <span className="text-lg font-bold">Net Profit / Loss</span>
                  <span
                    className={`text-lg font-bold font-mono ${
                      isProfit ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {isProfit ? '' : '-'}฿{formatCurrency(Math.abs(plData.net_profit))}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
