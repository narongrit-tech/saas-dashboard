'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Loader2, AlertCircle, CheckCircle2, Calendar, ChevronDown } from 'lucide-react'
import { applyCOGSMTD } from '@/app/(dashboard)/inventory/actions'
import { getTodayBangkokString, getFirstDayOfMonthBangkokString } from '@/lib/bangkok-date-range'
import { useToast } from '@/hooks/use-toast'

interface ApplyCOGSMTDModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  onViewRunDetails?: (runId: string, summary: any) => void
}

export function ApplyCOGSMTDModal({
  open,
  onOpenChange,
  onSuccess,
  onViewRunDetails,
}: ApplyCOGSMTDModalProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  // Date range state
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Initialize date range when modal opens (SAFE: uses Bangkok timezone)
  useEffect(() => {
    if (open && !startDate && !endDate) {
      setStartDate(getFirstDayOfMonthBangkokString())
      setEndDate(getTodayBangkokString())
    }
  }, [open])

  function setThisMonth() {
    setStartDate(getFirstDayOfMonthBangkokString())
    setEndDate(getTodayBangkokString())
  }

  function setLastMonth() {
    // Calculate last month dates in Bangkok timezone
    const today = new Date()
    const year = today.getFullYear()
    const month = today.getMonth() // 0-indexed

    // First day of last month
    const firstDayLastMonth = new Date(year, month - 1, 1)
    const lastMonthYear = firstDayLastMonth.getFullYear()
    const lastMonthMonth = String(firstDayLastMonth.getMonth() + 1).padStart(2, '0')
    const startDateStr = `${lastMonthYear}-${lastMonthMonth}-01`

    // Last day of last month (day 0 of current month)
    const lastDayLastMonth = new Date(year, month, 0)
    const lastDayYear = lastDayLastMonth.getFullYear()
    const lastDayMonth = String(lastDayLastMonth.getMonth() + 1).padStart(2, '0')
    const lastDayDay = String(lastDayLastMonth.getDate()).padStart(2, '0')
    const endDateStr = `${lastDayYear}-${lastDayMonth}-${lastDayDay}`

    setStartDate(startDateStr)
    setEndDate(endDateStr)
  }

  async function handleApply() {
    // Validate dates
    if (!startDate || !endDate) {
      setError('กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด')
      return
    }

    if (startDate > endDate) {
      setError('วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    // Track whether modal is still open when action completes
    let modalWasClosedDuringProcessing = false

    try {
      const response = await applyCOGSMTD({
        method: 'FIFO',
        startDate,
        endDate,
      })

      // Check if modal was closed while processing
      modalWasClosedDuringProcessing = !open

      if (!response.success) {
        if (modalWasClosedDuringProcessing) {
          toast({
            variant: 'destructive',
            title: 'Apply COGS ล้มเหลว',
            description: response.error || 'เกิดข้อผิดพลาด',
          })
        } else {
          setError(response.error || 'เกิดข้อผิดพลาด')
        }
      } else {
        if (modalWasClosedDuringProcessing) {
          // Modal was closed — show toast notification instead
          const data = response.data
          toast({
            title: 'Apply COGS เสร็จสิ้น',
            description: `${data?.successful ?? 0} สำเร็จ, ${data?.skipped ?? 0} ข้าม, ${data?.failed ?? 0} ล้มเหลว — ดูรายละเอียดที่กระดิ่งมุมขวาบน`,
          })
        } else {
          setResult(response.data)
        }
        if (onSuccess) {
          onSuccess()
        }
      }
    } catch (err) {
      modalWasClosedDuringProcessing = !open
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด'
      if (modalWasClosedDuringProcessing) {
        toast({ variant: 'destructive', title: 'Apply COGS ล้มเหลว', description: msg })
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    // Always allow close — even while loading
    setResult(null)
    setError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Apply COGS (Date Range)</DialogTitle>
          <DialogDescription>
            ตัด COGS สำหรับ orders ที่ shipped ในช่วงวันที่ที่เลือก
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Date Range Selector */}
          {!result && (
            <div className="space-y-4 p-4 border rounded-md bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4" />
                <span className="text-sm font-semibold">เลือกช่วงวันที่</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startDate">วันที่เริ่มต้น</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate">วันที่สิ้นสุด</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={setThisMonth}
                  disabled={loading}
                >
                  เดือนนี้
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={setLastMonth}
                  disabled={loading}
                >
                  เดือนที่แล้ว
                </Button>
              </div>

              {startDate && endDate && (
                <p className="text-xs text-muted-foreground">
                  ช่วงวันที่: <strong>{startDate}</strong> ถึง <strong>{endDate}</strong>
                </p>
              )}
            </div>
          )}

          {/* Info */}
          {!result && !error && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>คำอธิบาย</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 space-y-1 text-sm">
                  <li>ระบบจะตัด COGS สำหรับ orders ที่ shipped ในช่วงวันที่ที่เลือก</li>
                  <li>Skip orders ที่ cancelled (ยกเลิกแล้ว)</li>
                  <li>Skip orders ที่ไม่มี seller_sku หรือ quantity ≤ 0</li>
                  <li>
                    Skip orders ที่มี COGS allocations อยู่แล้ว (ไม่สร้างซ้ำ)
                  </li>
                  <li>
                    <strong>ปลอดภัย:</strong> กดซ้ำได้ ไม่ duplicate allocations
                  </li>
                  <li>
                    <strong>รองรับ orders จำนวนมาก:</strong> ประมวลผลทีละ batch ไม่มีขีดจำกัด
                  </li>
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Error */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Result Summary */}
          {result && (
            <div className="space-y-4">
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle>เสร็จสิ้น</AlertTitle>
                <AlertDescription>
                  {result.message || 'ประมวลผลเสร็จสิ้น'}
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Total Orders</p>
                  <p className="text-2xl font-bold">{result.total}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Eligible</p>
                  <p className="text-2xl font-bold text-blue-600">{result.eligible}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Successful</p>
                  <p className="text-2xl font-bold text-green-600">
                    {result.successful}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Skipped</p>
                  <p className="text-xl font-semibold text-yellow-600">
                    {result.skipped}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Failed</p>
                  <p className="text-xl font-semibold text-red-600">{result.failed}</p>
                </div>
              </div>

              {/* Run ID and View Details Button */}
              {result.run_id && (
                <div className="border rounded-md p-4 bg-muted/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Run ID</p>
                      <p className="text-xs font-mono text-blue-600">{result.run_id}</p>
                    </div>
                    {onViewRunDetails && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onViewRunDetails(result.run_id, {
                          start_date: startDate,
                          end_date: endDate,
                          method: 'FIFO',
                          total: result.total,
                          successful: result.successful,
                          skipped: result.skipped,
                          failed: result.failed,
                        })}
                      >
                        View Run Details
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    บันทึกรายละเอียดของการรันนี้ไว้แล้ว สามารถดูรายละเอียด Order-level และ Export ได้
                  </p>
                </div>
              )}

              {/* Skip Reasons Breakdown */}
              {result.skip_reasons && result.skip_reasons.length > 0 && (
                <Collapsible className="space-y-2 border rounded-md p-4">
                  <CollapsibleTrigger className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      <ChevronDown className="h-4 w-4" />
                      <p className="text-sm font-semibold">
                        Skip Reasons Breakdown ({result.skip_reasons.length} categories)
                      </p>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 pt-3">
                    {result.skip_reasons.map((reason: any, idx: number) => (
                      <div
                        key={idx}
                        className="border-l-4 border-yellow-500 pl-3 py-2 bg-yellow-50/50"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-semibold text-sm">{reason.label}</p>
                          <Badge variant="secondary">{reason.count} orders</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">
                          Code: <span className="font-mono">{reason.code}</span>
                        </p>
                        {reason.samples && reason.samples.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium">
                              ตัวอย่าง (แสดง {reason.samples.length} รายการแรก):
                            </p>
                            {reason.samples.map((sample: any, sIdx: number) => (
                              <div
                                key={sIdx}
                                className="text-xs flex items-center gap-2 bg-white rounded px-2 py-1"
                              >
                                <span className="font-mono text-blue-600">
                                  {sample.order_id}
                                </span>
                                {sample.sku && (
                                  <span className="text-muted-foreground">
                                    SKU: {sample.sku}
                                  </span>
                                )}
                                {sample.detail && (
                                  <span className="text-orange-600">{sample.detail}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}

              {/* Legacy Error List (fallback if skip_reasons not available) */}
              {!result.skip_reasons && result.errors && result.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">
                    Errors/Skipped Details ({result.errors.length}):
                  </p>
                  <div className="max-h-[200px] overflow-y-auto border rounded-md p-2 space-y-1">
                    {result.errors.map((err: any, idx: number) => (
                      <div
                        key={idx}
                        className="text-xs flex items-center justify-between gap-2 py-1"
                      >
                        <span className="font-mono">{err.order_id}</span>
                        <Badge
                          variant={
                            err.reason === 'already_allocated' ? 'secondary' : 'outline'
                          }
                        >
                          {err.reason}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {!result && (
            <>
              <div className="flex-1 flex items-center">
                {loading && (
                  <p className="text-xs text-muted-foreground">
                    ปิดหน้าต่างได้ ระบบจะแจ้งเตือนที่กระดิ่งเมื่อเสร็จ
                  </p>
                )}
              </div>
              <Button variant="outline" onClick={handleClose}>
                ยกเลิก
              </Button>
              <Button onClick={handleApply} disabled={loading || !startDate || !endDate}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? 'กำลังประมวลผล...' : 'Apply COGS'}
              </Button>
            </>
          )}
          {result && (
            <Button onClick={handleClose} className="w-full">
              ปิด
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
