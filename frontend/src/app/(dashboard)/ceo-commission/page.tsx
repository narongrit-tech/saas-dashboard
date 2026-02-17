'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Download, Plus, TrendingUp, Wallet, UserCircle, Building2 } from 'lucide-react'
import { AddCommissionDialog } from '@/components/ceo-commission/AddCommissionDialog'
import {
  getCommissionReceipts,
  getCommissionPlatforms,
  getCommissionSummary,
  exportCommissionReceipts,
} from './actions'
import { CommissionReceipt, CommissionSummary } from '@/types/ceo-commission'
import { formatInTimeZone } from 'date-fns-tz'
import { useToast } from '@/hooks/use-toast'

const BANGKOK_TZ = 'Asia/Bangkok'

export default function CeoCommissionPage() {
  const { toast } = useToast()

  // State
  const [receipts, setReceipts] = useState<CommissionReceipt[]>([])
  const [summary, setSummary] = useState<CommissionSummary | null>(null)
  const [platforms, setPlatforms] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Filters
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState<string>('All')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const perPage = 20

  // Load data
  const loadData = async () => {
    try {
      setLoading(true)

      // Load receipts
      const receiptsResult = await getCommissionReceipts({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        platform: selectedPlatform !== 'All' ? selectedPlatform : undefined,
        page,
        perPage,
      })

      if (receiptsResult.success) {
        setReceipts(receiptsResult.data || [])
        setTotal(receiptsResult.total || 0)
      } else {
        toast({
          variant: 'destructive',
          title: 'เกิดข้อผิดพลาด',
          description: `โหลดข้อมูลไม่สำเร็จ: ${receiptsResult.error}`,
        })
      }

      // Load summary
      const summaryResult = await getCommissionSummary({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        platform: selectedPlatform !== 'All' ? selectedPlatform : undefined,
      })

      if (summaryResult.success) {
        setSummary(summaryResult.data || null)
      }
    } catch (error) {
      console.error('Load data error:', error)
      toast({
        variant: 'destructive',
        title: 'เกิดข้อผิดพลาด',
        description: 'เกิดข้อผิดพลาดในการโหลดข้อมูล',
      })
    } finally {
      setLoading(false)
    }
  }

  // Load platforms
  const loadPlatforms = async () => {
    const result = await getCommissionPlatforms()
    if (result.success) {
      setPlatforms(result.data || [])
    }
  }

  // Initial load
  useEffect(() => {
    loadData()
    loadPlatforms()
  }, [page, startDate, endDate, selectedPlatform])

  // Handle export
  const handleExport = async () => {
    try {
      setExporting(true)
      const result = await exportCommissionReceipts({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        platform: selectedPlatform !== 'All' ? selectedPlatform : undefined,
      })

      if (result.success && result.csv && result.filename) {
        // Create blob and download
        const blob = new Blob(['\ufeff' + result.csv], {
          type: 'text/csv;charset=utf-8;',
        })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = result.filename
        link.click()
        URL.revokeObjectURL(link.href)
        toast({
          title: 'สำเร็จ',
          description: 'ส่งออกข้อมูลสำเร็จ',
        })
      } else {
        toast({
          variant: 'destructive',
          title: 'เกิดข้อผิดพลาด',
          description: `ส่งออกไม่สำเร็จ: ${result.error}`,
        })
      }
    } catch (error) {
      console.error('Export error:', error)
      toast({
        variant: 'destructive',
        title: 'เกิดข้อผิดพลาด',
        description: 'เกิดข้อผิดพลาดในการส่งออกข้อมูล',
      })
    } finally {
      setExporting(false)
    }
  }

  // Handle dialog close
  const handleDialogSuccess = () => {
    setDialogOpen(false)
    loadData()
    toast({
      title: 'สำเร็จ',
      description: 'บันทึก Commission สำเร็จ',
    })
  }

  // Format number
  const formatNumber = (num: number) => {
    return num.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  // Format date
  const formatDate = (dateStr: string) => {
    try {
      return formatInTimeZone(new Date(dateStr), BANGKOK_TZ, 'dd/MM/yyyy')
    } catch {
      return dateStr
    }
  }

  // Calculate pagination
  const totalPages = Math.ceil(total / perPage)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">CEO Commission</h1>
          <p className="text-muted-foreground">
            บันทึกและติดตาม Commission ที่รับจาก Platform และยอดโอนให้บริษัท (Director Loan)
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleExport} disabled={exporting || receipts.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            {exporting ? 'กำลังส่งออก...' : 'ส่งออก CSV'}
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            เพิ่ม Commission
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Commission ทั้งหมด</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? '...' : `฿${formatNumber(summary?.total_commissions || 0)}`}
            </div>
            <p className="text-xs text-muted-foreground">ยอดรวมที่รับจาก Platform</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ใช้ส่วนตัว</CardTitle>
            <UserCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? '...' : `฿${formatNumber(summary?.total_personal_used || 0)}`}
            </div>
            <p className="text-xs text-muted-foreground">ยอดที่ใช้ส่วนตัว</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">โอนให้บริษัท</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? '...' : `฿${formatNumber(summary?.total_transferred || 0)}`}
            </div>
            <p className="text-xs text-muted-foreground">ยอดโอนให้บริษัท</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Director Loan Balance</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? '...' : `฿${formatNumber(summary?.director_loan_balance || 0)}`}
            </div>
            <p className="text-xs text-muted-foreground">ยอดคงเหลือในระบบ</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>กรองข้อมูล</CardTitle>
          <CardDescription>เลือกช่วงวันที่และ Platform เพื่อดูข้อมูล</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="startDate">วันที่เริ่มต้น</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">วันที่สิ้นสุด</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="platform">Platform</Label>
              <Select
                value={selectedPlatform}
                onValueChange={(value) => {
                  setSelectedPlatform(value)
                  setPage(1)
                }}
              >
                <SelectTrigger id="platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">ทั้งหมด</SelectItem>
                  {platforms.map((platform) => (
                    <SelectItem key={platform} value={platform}>
                      {platform}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>ประวัติ Commission</CardTitle>
          <CardDescription>
            แสดง {receipts.length} รายการจากทั้งหมด {total} รายการ
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">กำลังโหลด...</div>
          ) : receipts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">ไม่มีข้อมูล</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead className="text-right">Commission (Gross)</TableHead>
                    <TableHead className="text-right">ใช้ส่วนตัว</TableHead>
                    <TableHead className="text-right">โอนให้บริษัท</TableHead>
                    <TableHead>หมายเหตุ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell className="font-medium">
                        {formatDate(receipt.commission_date)}
                      </TableCell>
                      <TableCell>{receipt.platform}</TableCell>
                      <TableCell className="text-right">
                        ฿{formatNumber(receipt.gross_amount)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        ฿{formatNumber(receipt.personal_used_amount)}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-green-600">
                        ฿{formatNumber(receipt.transferred_to_company_amount)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {receipt.note || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    หน้า {page} จาก {totalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      ก่อนหน้า
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      ถัดไป
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Add Commission Dialog */}
      <AddCommissionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={handleDialogSuccess}
      />
    </div>
  )
}
