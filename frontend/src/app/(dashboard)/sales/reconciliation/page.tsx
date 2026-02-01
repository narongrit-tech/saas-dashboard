'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { SingleDateRangePicker, DateRangeResult } from '@/components/shared/SingleDateRangePicker'
import { formatBangkok, getBangkokNow, startOfDayBangkok } from '@/lib/bangkok-time'
import { ArrowLeft, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { getSalesReconciliation } from '@/app/(dashboard)/sales/actions'
import { parseBangkokDateStringToLocalDate } from '@/lib/bangkok-date-range'

export default function SalesReconciliationPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // State
  const [startDate, setStartDate] = useState<string>()
  const [endDate, setEndDate] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Reconciliation data
  const [sqlDerived, setSqlDerived] = useState<{
    total_lines: number
    distinct_orders: number
    orders_with_null_created_time: number
    orders_with_created_time: number
  } | null>(null)

  const [missingOrders, setMissingOrders] = useState<Array<{
    external_order_id: string
    order_date: string | null
    created_time: string | null
    reason: string
  }>>([])

  // Initialize date range from URL or default to today
  useEffect(() => {
    const hasDateParams = searchParams.get('startDate') || searchParams.get('endDate')
    const todayStart = hasDateParams ? undefined : formatBangkok(startOfDayBangkok(), 'yyyy-MM-dd')
    const todayEnd = hasDateParams ? undefined : formatBangkok(getBangkokNow(), 'yyyy-MM-dd')

    setStartDate(searchParams.get('startDate') || todayStart)
    setEndDate(searchParams.get('endDate') || todayEnd)
  }, [searchParams])

  // Fetch reconciliation data
  useEffect(() => {
    if (startDate && endDate) {
      fetchReconciliation()
    }
  }, [startDate, endDate])

  const fetchReconciliation = async () => {
    try {
      setLoading(true)
      setError(null)

      const result = await getSalesReconciliation({
        startDate: startDate!,
        endDate: endDate!,
      })

      if (!result.success) {
        setError(result.error || 'เกิดข้อผิดพลาดในการโหลดข้อมูล')
        return
      }

      setSqlDerived(result.sqlDerived!)
      setMissingOrders(result.missingOrders || [])
    } catch (err) {
      console.error('Error fetching reconciliation:', err)
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล')
    } finally {
      setLoading(false)
    }
  }

  const handleDateRangeChange = (range: DateRangeResult) => {
    setStartDate(formatBangkok(range.startDate, 'yyyy-MM-dd'))
    setEndDate(formatBangkok(range.endDate, 'yyyy-MM-dd'))
  }

  const formatNumber = (num: number | null | undefined) => {
    if (num === null || num === undefined || isNaN(num)) return '0'
    return num.toLocaleString('th-TH')
  }

  const mismatchDetected = sqlDerived && sqlDerived.orders_with_null_created_time > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/sales')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            กลับ
          </Button>
          <h1 className="text-3xl font-bold">Sales Reconciliation (TikTok Export vs UI)</h1>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">ช่วงวันที่</label>
            <SingleDateRangePicker
              defaultRange={
                startDate && endDate
                  ? {
                      startDate: parseBangkokDateStringToLocalDate(startDate),
                      endDate: parseBangkokDateStringToLocalDate(endDate)
                    }
                  : undefined
              }
              onChange={handleDateRangeChange}
            />
          </div>
        </div>

        {/* Info Box */}
        <div className="rounded-md border bg-blue-50 p-4 dark:bg-blue-950">
          <h3 className="font-medium text-blue-900 dark:text-blue-100">
            วัตถุประสงค์
          </h3>
          <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
            หน้านี้ช่วยตรวจสอบความต่างระหว่าง "จำนวนออเดอร์ที่แสดงใน UI" กับ "จำนวนออเดอร์จริงในฐานข้อมูล"
            โดยใช้ SQL โดยตรง (ไม่ผ่าน UI filters) เพื่อหาสาเหตุที่ทำให้ตัวเลขไม่ตรงกัน
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* SQL-Derived Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {mismatchDetected ? (
              <>
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                SQL-Derived Stats (Direct DB Query)
              </>
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                SQL-Derived Stats (Direct DB Query)
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
              <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
            </div>
          ) : sqlDerived ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Total Lines (SKU)</div>
                <div className="text-2xl font-bold">{formatNumber(sqlDerived.total_lines)}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Distinct Orders</div>
                <div className="text-2xl font-bold text-blue-600">{formatNumber(sqlDerived.distinct_orders)}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  (ต้อง match TikTok export)
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Orders with created_time</div>
                <div className="text-2xl font-bold text-green-600">{formatNumber(sqlDerived.orders_with_created_time)}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Orders NULL created_time</div>
                <div className={`text-2xl font-bold ${sqlDerived.orders_with_null_created_time > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                  {formatNumber(sqlDerived.orders_with_null_created_time)}
                </div>
                {sqlDerived.orders_with_null_created_time > 0 && (
                  <div className="text-xs text-orange-600 mt-1">
                    ⚠️ สาเหตุที่ UI น้อยกว่า DB
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">ไม่พบข้อมูล</p>
          )}
        </CardContent>
      </Card>

      {/* Root Cause Analysis */}
      {mismatchDetected && (
        <div className="rounded-md border border-orange-200 bg-orange-50 p-4 dark:bg-orange-950">
          <h3 className="font-medium text-orange-900 dark:text-orange-100 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Root Cause Detected
          </h3>
          <div className="mt-2 space-y-2 text-sm text-orange-700 dark:text-orange-300">
            <p>
              <strong>ปัญหา:</strong> มีออเดอร์ {formatNumber(sqlDerived!.orders_with_null_created_time)} orders ที่ <code>created_time IS NULL</code>
            </p>
            <p>
              <strong>สาเหตุ:</strong> UI กรอง <code>created_time &gt;= startDate</code> ที่ DB level → rows ที่ created_time=NULL ถูกกรองออกทันที
            </p>
            <p>
              <strong>การแก้ไข:</strong> ใช้ <code>COALESCE(created_time, order_date)</code> สำหรับ date filtering (แก้แล้วใน migration-030)
            </p>
            <p>
              <strong>หลัง migrate:</strong> UI จะแสดง {formatNumber(sqlDerived!.distinct_orders)} orders (ตรงกับ TikTok export)
            </p>
          </div>
        </div>
      )}

      {/* Missing Orders (Sample) */}
      <Card>
        <CardHeader>
          <CardTitle>Sample Orders with NULL created_time (First 50)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>order_date</TableHead>
                  <TableHead>created_time</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><div className="h-4 w-32 animate-pulse rounded bg-gray-200" /></TableCell>
                      <TableCell><div className="h-4 w-24 animate-pulse rounded bg-gray-200" /></TableCell>
                      <TableCell><div className="h-4 w-24 animate-pulse rounded bg-gray-200" /></TableCell>
                      <TableCell><div className="h-4 w-32 animate-pulse rounded bg-gray-200" /></TableCell>
                    </TableRow>
                  ))
                ) : missingOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground space-y-2">
                        <CheckCircle2 className="h-8 w-8 text-green-500" />
                        <p className="text-lg font-medium">✅ ไม่มี Missing Orders</p>
                        <p className="text-sm">ทุก orders มี created_time ครบถ้วน</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  missingOrders.map((order, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{order.external_order_id}</TableCell>
                      <TableCell>{order.order_date || '-'}</TableCell>
                      <TableCell>
                        {order.created_time ? (
                          order.created_time
                        ) : (
                          <Badge variant="destructive">NULL</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{order.reason}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {missingOrders.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              แสดง {missingOrders.length} orders แรก (จากทั้งหมด {formatNumber(sqlDerived?.orders_with_null_created_time)} orders)
            </div>
          )}
        </CardContent>
      </Card>

      {/* SQL Verification Snippet */}
      <Card>
        <CardHeader>
          <CardTitle>SQL Verification (Run in DB Console)</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="rounded-md bg-gray-100 p-4 text-xs overflow-x-auto dark:bg-gray-900">
{`-- Count orders using COALESCE(created_time, order_date)
SELECT
  COUNT(*) as total_lines,
  COUNT(DISTINCT external_order_id) as distinct_orders
FROM sales_orders
WHERE DATE(COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok') >= '${startDate}'
  AND DATE(COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok') <= '${endDate}'
  AND source_platform = 'tiktok_shop';

-- Expected: distinct_orders = ${sqlDerived?.distinct_orders || 'N/A'} (match TikTok export)`}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
