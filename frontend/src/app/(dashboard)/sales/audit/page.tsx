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
import { DateRangePicker, DateRangeResult } from '@/components/shared/DateRangePicker'
import { formatBangkok, getBangkokNow, startOfDayBangkok } from '@/lib/bangkok-time'
import {
  getMultiSkuOrders,
  getDuplicateLines,
  getImportCoverage,
  MultiSkuOrder,
  DuplicateLine,
  ImportCoverage,
} from '@/app/(dashboard)/sales/actions'
import { parseBangkokDateStringToLocalDate } from '@/lib/bangkok-date-range'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft } from 'lucide-react'

const PLATFORMS = [
  { value: 'all', label: 'All Platforms' },
  { value: 'tiktok_shop', label: 'TikTok' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'lazada', label: 'Lazada' },
]

export default function SalesAuditPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // State
  const [sourcePlatform, setSourcePlatform] = useState('all')
  const [dateBasis, setDateBasis] = useState<'order' | 'paid'>('order')
  const [startDate, setStartDate] = useState<string>()
  const [endDate, setEndDate] = useState<string>()

  const [multiSkuOrders, setMultiSkuOrders] = useState<MultiSkuOrder[]>([])
  const [duplicateLines, setDuplicateLines] = useState<DuplicateLine[]>([])
  const [importCoverage, setImportCoverage] = useState<ImportCoverage | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Initialize date range from URL or default to today
  useEffect(() => {
    const hasDateParams = searchParams.get('startDate') || searchParams.get('endDate')
    const todayStart = hasDateParams ? undefined : formatBangkok(startOfDayBangkok(), 'yyyy-MM-dd')
    const todayEnd = hasDateParams ? undefined : formatBangkok(getBangkokNow(), 'yyyy-MM-dd')

    setStartDate(searchParams.get('startDate') || todayStart)
    setEndDate(searchParams.get('endDate') || todayEnd)
    setSourcePlatform(searchParams.get('platform') || 'all')
    setDateBasis((searchParams.get('basis') as 'order' | 'paid') || 'order')
  }, [searchParams])

  // Fetch audit data
  useEffect(() => {
    fetchAuditData()
  }, [sourcePlatform, dateBasis, startDate, endDate])

  const fetchAuditData = async () => {
    try {
      setLoading(true)
      setError(null)

      const filters = {
        sourcePlatform: sourcePlatform !== 'all' ? sourcePlatform : undefined,
        dateBasis,
        startDate,
        endDate,
      }

      // Fetch all 3 audit queries in parallel
      const [multiSkuResult, dupLinesResult, coverageResult] = await Promise.all([
        getMultiSkuOrders({ ...filters, limit: 50 }),
        getDuplicateLines({ ...filters, limit: 100 }),
        getImportCoverage(filters),
      ])

      if (!multiSkuResult.success || !dupLinesResult.success || !coverageResult.success) {
        setError('เกิดข้อผิดพลาดในการโหลดข้อมูล Audit')
        return
      }

      setMultiSkuOrders(multiSkuResult.data || [])
      setDuplicateLines(dupLinesResult.data || [])
      setImportCoverage(coverageResult.data || null)
    } catch (err) {
      console.error('Error fetching audit data:', err)
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล')
    } finally {
      setLoading(false)
    }
  }

  const handleDateRangeChange = (range: DateRangeResult) => {
    setStartDate(formatBangkok(range.startDate, 'yyyy-MM-dd'))
    setEndDate(formatBangkok(range.endDate, 'yyyy-MM-dd'))
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatNumber = (num: number | null | undefined) => {
    if (num === null || num === undefined || isNaN(num)) return '0'
    return num.toLocaleString('th-TH')
  }

  const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined || isNaN(amount)) return '0.00'
    return amount.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

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
          <h1 className="text-3xl font-bold">Sales Audit</h1>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-4">
        {/* Date Basis */}
        <div className="flex items-center gap-4 p-3 border rounded-lg bg-blue-50 dark:bg-blue-950">
          <label className="text-sm font-medium">กรองวันที่ตาม:</label>
          <div className="flex items-center gap-2">
            <Button
              variant={dateBasis === 'order' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDateBasis('order')}
            >
              วันสั่งซื้อ (Order Date)
            </Button>
            <Button
              variant={dateBasis === 'paid' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDateBasis('paid')}
            >
              วันชำระเงิน (Paid Date)
            </Button>
          </div>
        </div>

        {/* Platform & Date Range */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">Platform</label>
            <Select
              value={sourcePlatform}
              onValueChange={setSourcePlatform}
            >
              <SelectTrigger>
                <SelectValue placeholder="All Platforms" />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((platform) => (
                  <SelectItem key={platform.value} value={platform.value}>
                    {platform.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">ช่วงวันที่</label>
            <DateRangePicker
              value={
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
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Section C: Import Coverage */}
      <Card>
        <CardHeader>
          <CardTitle>Import Coverage (Timestamp Completeness)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
              <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
            </div>
          ) : importCoverage ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Total Rows (Lines)</div>
                <div className="text-2xl font-bold">{formatNumber(importCoverage.total_rows)}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Distinct Orders</div>
                <div className="text-2xl font-bold">{formatNumber(importCoverage.distinct_orders)}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">With Created Time</div>
                <div className="text-2xl font-bold text-green-600">
                  {formatNumber(importCoverage.rows_with_created_time)}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">With Paid Time</div>
                <div className="text-2xl font-bold text-blue-600">
                  {formatNumber(importCoverage.rows_with_paid_time)}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">With Cancelled Time</div>
                <div className="text-2xl font-bold text-red-600">
                  {formatNumber(importCoverage.rows_with_cancelled_time)}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">WITHOUT Created Time</div>
                <div className="text-2xl font-bold text-orange-600">
                  {formatNumber(importCoverage.rows_without_created_time)}
                  {importCoverage.rows_without_created_time > 0 && (
                    <span className="ml-2 text-sm">⚠️</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">ไม่พบข้อมูล</p>
          )}
        </CardContent>
      </Card>

      {/* Section A: Top Multi-SKU Orders */}
      <Card>
        <CardHeader>
          <CardTitle>Top Multi-SKU Orders (Top 50)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead className="text-right">SKU Lines</TableHead>
                  <TableHead className="text-right">Total Units</TableHead>
                  <TableHead className="text-right">Gross Amount</TableHead>
                  <TableHead>Created Time</TableHead>
                  <TableHead>Paid Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><div className="h-4 w-32 animate-pulse rounded bg-gray-200" /></TableCell>
                      <TableCell><div className="h-4 w-12 animate-pulse rounded bg-gray-200" /></TableCell>
                      <TableCell><div className="h-4 w-12 animate-pulse rounded bg-gray-200" /></TableCell>
                      <TableCell><div className="h-4 w-20 animate-pulse rounded bg-gray-200" /></TableCell>
                      <TableCell><div className="h-4 w-24 animate-pulse rounded bg-gray-200" /></TableCell>
                      <TableCell><div className="h-4 w-24 animate-pulse rounded bg-gray-200" /></TableCell>
                    </TableRow>
                  ))
                ) : multiSkuOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      ไม่พบออเดอร์ที่มีหลาย SKU
                    </TableCell>
                  </TableRow>
                ) : (
                  multiSkuOrders.map((order, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{order.external_order_id}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline">{order.sku_lines} SKUs</Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(order.total_units)}</TableCell>
                      <TableCell className="text-right font-medium">
                        ฿{formatCurrency(order.gross_amount)}
                      </TableCell>
                      <TableCell>{formatDate(order.created_time)}</TableCell>
                      <TableCell>{formatDate(order.paid_time)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Section B: Potential Duplicate Lines */}
      <Card>
        <CardHeader>
          <CardTitle>Potential Duplicate Lines (Top 100)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>SKU ID</TableHead>
                  <TableHead>Variation</TableHead>
                  <TableHead className="text-right">Duplicate Rows</TableHead>
                  <TableHead>Latest Created At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><div className="h-4 w-32 animate-pulse rounded bg-gray-200" /></TableCell>
                      <TableCell><div className="h-4 w-24 animate-pulse rounded bg-gray-200" /></TableCell>
                      <TableCell><div className="h-4 w-20 animate-pulse rounded bg-gray-200" /></TableCell>
                      <TableCell><div className="h-4 w-12 animate-pulse rounded bg-gray-200" /></TableCell>
                      <TableCell><div className="h-4 w-24 animate-pulse rounded bg-gray-200" /></TableCell>
                    </TableRow>
                  ))
                ) : duplicateLines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground space-y-2">
                        <p className="text-lg font-medium">✅ ไม่พบ Duplicate Lines</p>
                        <p className="text-sm">ข้อมูลถูกต้อง ไม่มี line ซ้ำซ้อน</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  duplicateLines.map((dup, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{dup.external_order_id}</TableCell>
                      <TableCell>{dup.sku_id || '-'}</TableCell>
                      <TableCell>{dup.variation || '-'}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="destructive">{dup.dup_rows} rows</Badge>
                      </TableCell>
                      <TableCell>{formatDate(dup.latest_created_at)}</TableCell>
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
