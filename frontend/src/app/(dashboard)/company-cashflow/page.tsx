'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Download,
  AlertCircle,
  Info,
} from 'lucide-react'
import { SingleDateRangePicker, DateRangeResult } from '@/components/shared/SingleDateRangePicker'
import { getBangkokNow, formatBangkok, startOfDayBangkok } from '@/lib/bangkok-time'
import { getCompanyCashflow, exportCompanyCashflow, CompanyCashflowSummary } from './actions'

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function CompanyCashflowPage() {
  // Default: Last 7 days
  const getDefaultRange = (): DateRangeResult => {
    const now = getBangkokNow()
    const start = new Date(now)
    start.setDate(start.getDate() - 6)
    return {
      startDate: startOfDayBangkok(start),
      endDate: getBangkokNow(),
    }
  }

  const [dateRange, setDateRange] = useState<DateRangeResult>(getDefaultRange())
  const [source, setSource] = useState<'bank' | 'marketplace'>('marketplace')
  const [data, setData] = useState<CompanyCashflowSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exportLoading, setExportLoading] = useState(false)

  useEffect(() => {
    fetchData()
  }, [dateRange, source])

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)

      const result = await getCompanyCashflow(dateRange.startDate, dateRange.endDate, source)

      if (!result.success || !result.data) {
        setError(result.error || 'ไม่สามารถโหลดข้อมูลได้')
        setData(null)
        return
      }

      setData(result.data)
    } catch (err) {
      console.error('Error fetching company cashflow:', err)
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    try {
      setExportLoading(true)
      setError(null)

      const result = await exportCompanyCashflow(dateRange.startDate, dateRange.endDate, source)

      if (!result.success || !result.csv || !result.filename) {
        setError(result.error || 'เกิดข้อผิดพลาดในการ export')
        return
      }

      // Download CSV
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = result.filename
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (err) {
      console.error('Error exporting:', err)
      setError('เกิดข้อผิดพลาดในการ export')
    } finally {
      setExportLoading(false)
    }
  }

  const isPositive = data ? data.net_cashflow >= 0 : false

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Company Cashflow</h1>
        <p className="text-muted-foreground">
          เงินสดคงเหลือระดับบริษัท - แสดงเงินเข้า/ออกจริง (Actual Cash Movements)
        </p>
      </div>

      {/* Source Toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={source === 'bank' ? 'default' : 'outline'}
          onClick={() => setSource('bank')}
        >
          Bank View
        </Button>
        <Button
          variant={source === 'marketplace' ? 'default' : 'outline'}
          onClick={() => setSource('marketplace')}
        >
          Marketplace View
        </Button>
      </div>

      {/* Info Alert */}
      {source === 'bank' ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>Bank View:</strong> แสดง cashflow จริงจากบัญชีธนาคาร (source of truth)
            <br />
            <strong>Cash In:</strong> Deposits จากบัญชีธนาคาร
            <br />
            <strong>Cash Out:</strong> Withdrawals จากบัญชีธนาคาร
            <br />
            <strong>หมายเหตุ:</strong> ต้องนำเข้า Bank Statement ก่อนจึงจะมีข้อมูล
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>Marketplace View:</strong> คำนวณ cashflow จาก internal records (supporting)
            <br />
            <strong>Cash In:</strong> เงินจริงที่เข้าบริษัทจาก marketplace settlements (ไม่รวม forecast)
            <br />
            <strong>Cash Out:</strong> ค่าใช้จ่าย (Expenses) + เงินโอนเข้า Wallet (Top-up)
            <br />
            <strong>หมายเหตุ:</strong> Opening Balance = 0 (ยังไม่มีข้อมูลบัญชีธนาคาร)
          </AlertDescription>
        </Alert>
      )}

      {/* Date Range Filter */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <SingleDateRangePicker
            defaultRange={dateRange}
            onChange={setDateRange}
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            fetchData()
            setError(null)
          }}
          title="Refresh data"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
        </Button>
        <Button
          onClick={handleExport}
          variant="outline"
          disabled={exportLoading || !data}
        >
          <Download className="mr-2 h-4 w-4" />
          {exportLoading ? 'กำลัง export...' : 'Export CSV'}
        </Button>
      </div>

      {/* Error State */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
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

      {/* Summary Cards */}
      {!loading && data && (
        <>
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
                  ฿{formatCurrency(data.total_cash_in)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  เงินเข้าจริงจาก marketplace
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
                  ฿{formatCurrency(data.total_cash_out)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Expenses + Wallet top-ups
                </p>
              </CardContent>
            </Card>

            {/* Net Cashflow */}
            <Card
              className={
                isPositive
                  ? 'border-green-200 bg-green-50'
                  : 'border-red-200 bg-red-50'
              }
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Net Cashflow</CardTitle>
                <div
                  className={`rounded-lg p-2 ${
                    isPositive
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
                    isPositive ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {isPositive ? '' : '-'}฿{formatCurrency(Math.abs(data.net_cashflow))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Cash In - Cash Out
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Daily Table */}
          <Card>
            <CardHeader>
              <CardTitle>Daily Cashflow Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Cash In</TableHead>
                      <TableHead className="text-right">Cash Out</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Running Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.daily_data.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          ไม่มีข้อมูลในช่วงวันที่ที่เลือก
                        </TableCell>
                      </TableRow>
                    )}
                    {data.daily_data.map((row) => (
                      <TableRow key={row.date}>
                        <TableCell className="font-medium">
                          {formatDate(row.date)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-green-600">
                          ฿{formatCurrency(row.cash_in)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-red-600">
                          ฿{formatCurrency(row.cash_out)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono ${
                            row.net >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {row.net >= 0 ? '' : '-'}฿{formatCurrency(Math.abs(row.net))}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono font-bold ${
                            row.running_balance >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {row.running_balance >= 0 ? '' : '-'}฿{formatCurrency(Math.abs(row.running_balance))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
