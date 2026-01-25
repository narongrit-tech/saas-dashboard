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
  Download,
  AlertCircle,
  Info,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { SingleDateRangePicker, DateRangeResult } from '@/components/shared/SingleDateRangePicker'
import { getBangkokNow, startOfDayBangkok } from '@/lib/bangkok-time'
import { getReconciliationReport, exportReconciliationReport, ReconciliationReport } from './actions'

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function ReconciliationPage() {
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
  const [data, setData] = useState<ReconciliationReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exportLoading, setExportLoading] = useState(false)

  useEffect(() => {
    fetchData()
  }, [dateRange])

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)

      const result = await getReconciliationReport(dateRange.startDate, dateRange.endDate)

      if (!result.success || !result.data) {
        setError(result.error || 'ไม่สามารถโหลดข้อมูลได้')
        setData(null)
        return
      }

      setData(result.data)
    } catch (err) {
      console.error('Error fetching reconciliation:', err)
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

      const result = await exportReconciliationReport(dateRange.startDate, dateRange.endDate)

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

  const verificationOK = data ? Math.abs(data.verification_error) < 0.01 : false

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">P&L vs Cashflow Reconciliation</h1>
        <p className="text-muted-foreground">
          เทียบความแตกต่างระหว่าง Accrual P&L (กำไรตามหลักบัญชี) กับ Company Cashflow (เงินสดจริง)
        </p>
      </div>

      {/* Info Alert */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>Accrual P&L:</strong> กำไร/ขาดทุนตามหลักบัญชี (Revenue - Expenses) ไม่คำนึงถึงเวลาเงินเข้า/ออก
          <br />
          <strong>Company Cashflow:</strong> เงินสดเข้า/ออกจริง (ตามเวลาที่เงินเข้า/ออกบัญชี)
          <br />
          <strong>Bridge Items:</strong> รายการที่ทำให้ทั้ง 2 แตกต่างกัน
        </AlertDescription>
      </Alert>

      {/* Date Range Filter */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <SingleDateRangePicker
            defaultRange={dateRange}
            onChange={setDateRange}
          />
        </div>
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
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
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

      {/* Reconciliation Report */}
      {!loading && data && (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Accrual P&L */}
            <Card>
              <CardHeader>
                <CardTitle>Accrual P&L (Performance)</CardTitle>
                <p className="text-sm text-muted-foreground">
                  กำไร/ขาดทุนตามหลักบัญชี
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Revenue</span>
                    <span className="font-mono text-green-600">
                      ฿{formatCurrency(data.accrual_revenue)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Ad Spend</span>
                    <span className="font-mono text-red-600">
                      -฿{formatCurrency(data.accrual_ad_spend)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>COGS</span>
                    <span className="font-mono text-red-600">
                      -฿{formatCurrency(data.accrual_cogs)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Operating</span>
                    <span className="font-mono text-red-600">
                      -฿{formatCurrency(data.accrual_operating)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-2 font-bold">
                    <span>Net Profit/Loss</span>
                    <span
                      className={`font-mono ${
                        data.accrual_net >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {data.accrual_net >= 0 ? '' : '-'}฿
                      {formatCurrency(Math.abs(data.accrual_net))}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Company Cashflow */}
            <Card>
              <CardHeader>
                <CardTitle>Company Cashflow (Liquidity)</CardTitle>
                <p className="text-sm text-muted-foreground">
                  เงินสดเข้า/ออกจริง
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Cash In</span>
                    <span className="font-mono text-green-600">
                      ฿{formatCurrency(data.cashflow_in)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Cash Out</span>
                    <span className="font-mono text-red-600">
                      -฿{formatCurrency(data.cashflow_out)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-2 font-bold">
                    <span>Net Cashflow</span>
                    <span
                      className={`font-mono ${
                        data.cashflow_net >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {data.cashflow_net >= 0 ? '' : '-'}฿
                      {formatCurrency(Math.abs(data.cashflow_net))}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bridge Items Table */}
          <Card>
            <CardHeader>
              <CardTitle>Bridge Items (สาเหตุความแตกต่าง)</CardTitle>
              <p className="text-sm text-muted-foreground">
                รายการที่ทำให้ P&L และ Cashflow แตกต่างกัน
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Explanation</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-center">Data Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.bridge_items.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{item.label}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.explanation}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${
                          item.amount >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {item.amount >= 0 ? '' : '-'}฿
                        {formatCurrency(Math.abs(item.amount))}
                      </TableCell>
                      <TableCell className="text-center">
                        {item.dataAvailable ? (
                          <CheckCircle2 className="inline h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="inline h-4 w-4 text-gray-400" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-bold">
                    <TableCell colSpan={2}>Total Bridge</TableCell>
                    <TableCell
                      className={`text-right font-mono ${
                        data.total_bridge >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {data.total_bridge >= 0 ? '' : '-'}฿
                      {formatCurrency(Math.abs(data.total_bridge))}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>

              {/* Verification */}
              <div className="mt-4 rounded-md border p-4">
                <h4 className="text-sm font-medium mb-2">Verification</h4>
                <p className="text-sm text-muted-foreground mb-2">
                  สูตร: Accrual Net + Total Bridge = Cashflow Net
                </p>
                <div className="flex items-center gap-2">
                  {verificationOK ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="text-sm text-green-600">
                        ตัวเลขสอดคล้องกัน (Error: ฿{formatCurrency(Math.abs(data.verification_error))})
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-yellow-600" />
                      <span className="text-sm text-yellow-600">
                        มีความแตกต่าง ฿{formatCurrency(Math.abs(data.verification_error))} -
                        อาจมี bridge items อื่นที่ยังไม่ระบุ
                      </span>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Explanation Card */}
          <Card className="bg-blue-50 border-blue-200">
            <CardHeader>
              <CardTitle className="text-base">ทำไมถึงต่างกัน?</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div>
                  <strong className="text-blue-700">Accrual P&L (กำไรตามบัญชี):</strong>
                  <p className="text-muted-foreground">
                    บันทึกรายได้ตอนที่ "ขาย" และบันทึกค่าใช้จ่ายตอนที่ "เกิด"
                    ไม่คำนึงว่าเงินจะเข้า/ออกจริงเมื่อไหร่
                  </p>
                </div>
                <div>
                  <strong className="text-blue-700">Company Cashflow (เงินสดจริง):</strong>
                  <p className="text-muted-foreground">
                    บันทึกตอนที่ "เงินเข้า/ออกจริง" เท่านั้น -
                    ถ้ายังไม่ได้รับเงินก็ไม่นับ (แม้ว่าจะขายแล้วก็ตาม)
                  </p>
                </div>
                <div>
                  <strong className="text-blue-700">ตัวอย่าง Bridge Item:</strong>
                  <p className="text-muted-foreground">
                    ขาย 10,000 บาท วันที่ 1 แต่ marketplace จ่ายเงินวันที่ 8 →
                    P&L นับ revenue วันที่ 1 แต่ Cashflow นับ cash in วันที่ 8
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
