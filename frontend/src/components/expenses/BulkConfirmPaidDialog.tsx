'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, CheckCircle } from 'lucide-react'
import { bulkConfirmExpensesPaid } from '@/app/(dashboard)/expenses/actions'
import { getTodayBangkokString } from '@/lib/bangkok-date-range'

interface BulkConfirmPaidDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedIds: string[]
  onSuccess: () => void
}

export function BulkConfirmPaidDialog({
  open,
  onOpenChange,
  selectedIds,
  onSuccess,
}: BulkConfirmPaidDialogProps) {
  const [paidDate, setPaidDate] = useState(getTodayBangkokString())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ confirmedCount: number; skippedCount: number } | null>(null)

  const handleOpenChange = (open: boolean) => {
    if (!loading) {
      if (!open) {
        // Reset state on close
        setPaidDate(getTodayBangkokString())
        setError(null)
        setResult(null)
      }
      onOpenChange(open)
    }
  }

  const handleConfirm = async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await bulkConfirmExpensesPaid(selectedIds, paidDate)
      if (!res.success) {
        setError(res.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่')
        return
      }
      setResult({ confirmedCount: res.confirmedCount ?? 0, skippedCount: res.skippedCount ?? 0 })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            ยืนยันจ่ายแล้ว ({selectedIds.length} รายการ)
          </DialogTitle>
          <DialogDescription>
            รายการ DRAFT ที่เลือกจะถูกเปลี่ยนเป็น PAID — รายการที่ PAID แล้วจะถูกข้าม
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="py-4 space-y-3 text-center">
            <CheckCircle className="mx-auto h-10 w-10 text-green-500" />
            <p className="font-medium text-green-700">ดำเนินการสำเร็จ</p>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>ยืนยันแล้ว: <span className="font-semibold text-foreground">{result.confirmedCount} รายการ</span></p>
              {result.skippedCount > 0 && (
                <p>ข้าม (PAID แล้ว): <span className="font-semibold text-foreground">{result.skippedCount} รายการ</span></p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="bulk_paid_date">วันที่จ่ายเงิน</Label>
              <Input
                id="bulk_paid_date"
                type="date"
                value={paidDate}
                onChange={(e) => {
                  setPaidDate(e.target.value)
                  setError(null)
                }}
              />
            </div>

            {error && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => handleOpenChange(false)}>ปิด</Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={loading}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={loading}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    กำลังยืนยัน...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    ยืนยัน ({selectedIds.length} รายการ)
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
