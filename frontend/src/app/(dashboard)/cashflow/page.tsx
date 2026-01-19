'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { TrendingUp, TrendingDown, DollarSign, AlertCircle } from 'lucide-react'
import { getDailyCashflowForDate, getCashflowRange } from './actions'
import { DailyCashflowData } from '@/lib/cashflow'

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]
}

function getSevenDaysAgo(): string {
  const date = new Date()
  date.setDate(date.getDate() - 6)
  return date.toISOString().split('T')[0]
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDateThai(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function CashflowPage() {
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDate())
  const [startDate, setStartDate] = useState<string>(getSevenDaysAgo())
  const [endDate, setEndDate] = useState<string>(getTodayDate())
  const [cashflowData, setCashflowData] = useState<DailyCashflowData | null>(null)
  const [rangeData, setRangeData] = useState<(DailyCashflowData & { running_balance: number })[]>(
    []
  )
  const [loading, setLoading] = useState(true)
  const [rangeLoading, setRangeLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rangeError, setRangeError] = useState<string | null>(null)

  useEffect(() => {
    fetchCashflowData()
  }, [selectedDate])

  const fetchCashflowData = async () => {
    try {
      setLoading(true)
      setError(null)

      const result = await getDailyCashflowForDate(selectedDate)

      if (!result.success || !result.data) {
        setError(result.error || 'ไม่สามารถโหลดข้อมูลได้')
        setCashflowData(null)
        return
      }

      setCashflowData(result.data)
    } catch (err) {
      console.error('Error fetching cashflow:', err)
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล')
      setCashflowData(null)
    } finally {
      setLoading(false)
    }
  }

  const fetchRangeData = async () => {
    try {
      setRangeLoading(true)
      setRangeError(null)

      const result = await getCashflowRange(startDate, endDate)

      if (!result.success || !result.data) {
        setRangeError(result.error || 'ไม่สามารถโหลดข้อมูลได้')
        setRangeData([])
        return
      }

      setRangeData(result.data)
    } catch (err) {
      console.error('Error fetching range:', err)
      setRangeError('เกิดข้อผิดพลาดในการโหลดข้อมูล')
      setRangeData([])
    } finally {
      setRangeLoading(false)
    }
  }

  const isPositive = cashflowData ? cashflowData.net_change >= 0 : false

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Cashflow</h1>
        <p className="text-muted-foreground">
          กระแสเงินสดรายวัน - เงินเข้า/ออกจริง (ไม่ใช่กำไรทางบัญชี)
        </p>
      </div>

      {/* Single Day View */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Daily Cashflow</h2>

        {/* Date Selector */}
        <div className="max-w-xs mb-4">
          <Label htmlFor="date">เลือกวันที่</Label>
          <Input
            id="date"
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="mt-2"
          />
          <p className="mt-1 text-sm text-muted-foreground">{formatDateThai(selectedDate)}</p>
        </div>

        {/* Error State */}
        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 p-4 text-sm text-red-600 mb-4">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
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

        {/* Cashflow Data */}
        {!loading && cashflowData && (
          <div className="grid gap-4 md:grid-cols-3">
            {/* Cash In */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cash In</CardTitle>
                <div className="rounded-lg bg-green-50 p-2 text-green-600">
                  <TrendingUp className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  ฿{formatCurrency(cashflowData.cash_in)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  ยอดขายที่รับเงินแล้ว (Completed)
                </p>
              </CardContent>
            </Card>

            {/* Cash Out */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cash Out</CardTitle>
                <div className="rounded-lg bg-red-50 p-2 text-red-600">
                  <TrendingDown className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  -฿{formatCurrency(cashflowData.cash_out)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">ค่าใช้จ่ายทั้งหมด</p>
              </CardContent>
            </Card>

            {/* Net Change */}
            <Card
              className={isPositive ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Net Cash Change</CardTitle>
                <div
                  className={`rounded-lg p-2 ${
                    isPositive ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                  }`}
                >
                  <DollarSign className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}
                >
                  {isPositive ? '' : '-'}฿{formatCurrency(Math.abs(cashflowData.net_change))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {isPositive ? '✓ เงินเข้ามากกว่าออก' : '✗ เงินออกมากกว่าเข้า'}
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Date Range View */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Cashflow Trend</h2>

        {/* Date Range Selector */}
        <div className="flex gap-4 mb-4 items-end">
          <div className="flex-1 max-w-xs">
            <Label htmlFor="start-date">วันที่เริ่มต้น</Label>
            <Input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-2"
            />
          </div>
          <div className="flex-1 max-w-xs">
            <Label htmlFor="end-date">วันที่สิ้นสุด</Label>
            <Input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-2"
            />
          </div>
          <Button onClick={fetchRangeData} disabled={rangeLoading}>
            {rangeLoading ? 'กำลังโหลด...' : 'แสดงข้อมูล'}
          </Button>
        </div>

        {/* Range Error */}
        {rangeError && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 p-4 text-sm text-red-600 mb-4">
            <AlertCircle className="h-4 w-4" />
            <span>{rangeError}</span>
          </div>
        )}

        {/* Range Data Table */}
        {rangeData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Cashflow with Running Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left">
                      <th className="py-3 px-2 font-medium">วันที่</th>
                      <th className="py-3 px-2 font-medium text-right">Cash In</th>
                      <th className="py-3 px-2 font-medium text-right">Cash Out</th>
                      <th className="py-3 px-2 font-medium text-right">Net Change</th>
                      <th className="py-3 px-2 font-medium text-right">Running Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rangeData.map((row) => (
                      <tr key={row.date} className="border-b">
                        <td className="py-3 px-2">{formatDateThai(row.date)}</td>
                        <td className="py-3 px-2 text-right font-mono text-green-600">
                          ฿{formatCurrency(row.cash_in)}
                        </td>
                        <td className="py-3 px-2 text-right font-mono text-red-600">
                          -฿{formatCurrency(row.cash_out)}
                        </td>
                        <td
                          className={`py-3 px-2 text-right font-mono ${
                            row.net_change >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {row.net_change >= 0 ? '' : '-'}฿
                          {formatCurrency(Math.abs(row.net_change))}
                        </td>
                        <td
                          className={`py-3 px-2 text-right font-mono font-semibold ${
                            row.running_balance >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {row.running_balance >= 0 ? '' : '-'}฿
                          {formatCurrency(Math.abs(row.running_balance))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
