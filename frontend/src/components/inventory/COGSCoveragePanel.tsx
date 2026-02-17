'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AlertCircle, CheckCircle, Download } from 'lucide-react'
import { formatBangkok } from '@/lib/bangkok-time'
import {
  getCOGSCoverageStats,
  getMissingAllocations,
  exportMissingAllocationsCSV,
  type COGSCoverageStats,
  type MissingAllocation,
} from '@/app/(dashboard)/inventory/actions'

interface COGSCoveragePanelProps {
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
}

export function COGSCoveragePanel({ startDate, endDate }: COGSCoveragePanelProps) {
  const [stats, setStats] = useState<COGSCoverageStats | null>(null)
  const [missingAllocations, setMissingAllocations] = useState<MissingAllocation[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate])

  async function loadData() {
    setLoading(true)

    const [statsResult, missingResult] = await Promise.all([
      getCOGSCoverageStats(startDate, endDate),
      getMissingAllocations(startDate, endDate),
    ])

    if (statsResult.success && statsResult.data) {
      setStats(statsResult.data)
    }

    if (missingResult.success) {
      setMissingAllocations(missingResult.data)
    }

    setLoading(false)
  }

  async function handleExport() {
    setExporting(true)

    try {
      const result = await exportMissingAllocationsCSV(startDate, endDate)

      if (result.success && result.csv && result.filename) {
        // Create download link
        const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = result.filename
        link.click()
        URL.revokeObjectURL(url)
      } else {
        alert(`Export failed: ${result.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Export error:', error)
      alert('เกิดข้อผิดพลาดในการ export')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>COGS Coverage Check</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center py-4 text-muted-foreground">กำลังโหลด...</p>
        </CardContent>
      </Card>
    )
  }

  if (!stats) {
    return null
  }

  // Determine coverage status
  let coverageColor = 'text-green-600'
  let coverageIcon = <CheckCircle className="h-5 w-5 text-green-600" />
  let coverageMessage = 'ทุก order ถูก allocate แล้ว'

  if (stats.coverage_percent < 90) {
    coverageColor = 'text-red-600'
    coverageIcon = <AlertCircle className="h-5 w-5 text-red-600" />
    coverageMessage = 'Coverage ต่ำ - มี orders ที่ยังไม่ได้ allocate จำนวนมาก'
  } else if (stats.coverage_percent < 100) {
    coverageColor = 'text-yellow-600'
    coverageIcon = <AlertCircle className="h-5 w-5 text-yellow-600" />
    coverageMessage = 'Coverage ใกล้สมบูรณ์แล้ว - มี orders บางรายการที่ยังไม่ได้ allocate'
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            COGS Coverage Check
            <span className="text-sm font-normal text-muted-foreground">
              ({startDate} ถึง {endDate})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
            {/* Expected Lines */}
            <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Expected Lines</p>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                  {stats.expected_lines.toLocaleString()}
                </p>
              </CardContent>
            </Card>

            {/* Allocated Lines */}
            <Card className="border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Allocated Lines</p>
                <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                  {stats.allocated_lines.toLocaleString()}
                </p>
              </CardContent>
            </Card>

            {/* Missing Lines */}
            <Card className="border-orange-200 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/20">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Missing Lines</p>
                <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">
                  {stats.missing_lines.toLocaleString()}
                </p>
              </CardContent>
            </Card>

            {/* Coverage % */}
            <Card
              className={`${
                stats.coverage_percent === 100
                  ? 'border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20'
                  : stats.coverage_percent >= 90
                  ? 'border-yellow-200 bg-yellow-50/50 dark:border-yellow-900 dark:bg-yellow-950/20'
                  : 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20'
              }`}
            >
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Coverage %</p>
                <div className="flex items-center gap-2">
                  {coverageIcon}
                  <p className={`text-2xl font-bold ${coverageColor}`}>
                    {stats.coverage_percent.toFixed(1)}%
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Expected Qty */}
            <Card className="border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/20">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Expected Qty</p>
                <p className="text-2xl font-bold">{stats.expected_qty.toLocaleString()}</p>
              </CardContent>
            </Card>

            {/* Allocated Qty */}
            <Card className="border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/20">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Allocated Qty</p>
                <p className="text-2xl font-bold">{stats.allocated_qty.toLocaleString()}</p>
              </CardContent>
            </Card>

            {/* Duplicates */}
            <Card
              className={`${
                stats.duplicate_count > 0
                  ? 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20'
                  : 'border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/20'
              }`}
            >
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Duplicates</p>
                <p
                  className={`text-2xl font-bold ${
                    stats.duplicate_count > 0 ? 'text-red-600' : ''
                  }`}
                >
                  {stats.duplicate_count.toLocaleString()}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Status Message */}
          <div
            className={`p-4 rounded-md ${
              stats.coverage_percent === 100
                ? 'bg-green-50 border border-green-200 dark:bg-green-950/20 dark:border-green-900'
                : stats.coverage_percent >= 90
                ? 'bg-yellow-50 border border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-900'
                : 'bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-900'
            }`}
          >
            <div className="flex items-start gap-3">
              {coverageIcon}
              <div>
                <p className={`font-semibold ${coverageColor}`}>{coverageMessage}</p>
                {stats.duplicate_count > 0 && (
                  <p className="text-sm text-red-600 mt-1">
                    ตรวจพบ {stats.duplicate_count} รายการที่มี allocations ซ้ำซ้อน - แนะนำให้ review
                  </p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Missing Allocations Table */}
      {missingAllocations.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                Missing Allocations ({missingAllocations.length} รายการ)
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exporting}
              >
                <Download className="mr-2 h-4 w-4" />
                {exporting ? 'กำลัง Export...' : 'Export CSV'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Shipped At</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {missingAllocations.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-sm">{row.order_id}</TableCell>
                      <TableCell className="font-mono text-sm">{row.seller_sku}</TableCell>
                      <TableCell className="text-right">{row.quantity}</TableCell>
                      <TableCell>
                        {formatBangkok(new Date(row.shipped_at), 'dd/MM/yyyy HH:mm')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.status_group || 'N/A'}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
