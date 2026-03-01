'use client'

import { useEffect, useState } from 'react'
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
import { Expense } from '@/types/expenses'
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { confirmExpensePaid, getExpenseAttachments } from '@/app/(dashboard)/expenses/actions'
import { AttachmentsSection } from './AttachmentsSection'
import { getTodayBangkokString } from '@/lib/bangkok-date-range'

interface ConfirmPaidDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  expense: Expense | null
  onSuccess: () => void
}

export function ConfirmPaidDialog({
  open,
  onOpenChange,
  expense,
  onSuccess,
}: ConfirmPaidDialogProps) {
  const [paidDate, setPaidDate] = useState('')
  const [attachmentCount, setAttachmentCount] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Reset state whenever dialog opens with a new expense
  useEffect(() => {
    if (open && expense) {
      setPaidDate(getTodayBangkokString())
      setError(null)
      setDone(false)
      setConfirming(false)
      loadAttachmentCount()
    }
  }, [open, expense])

  const loadAttachmentCount = async () => {
    if (!expense) return
    const result = await getExpenseAttachments(expense.id)
    setAttachmentCount(result.data?.length ?? 0)
  }

  const handleAttachmentUpdate = () => {
    loadAttachmentCount()
  }

  const handleConfirm = async () => {
    if (!expense) return
    setError(null)

    if (!paidDate) {
      setError('กรุณาระบุวันที่จ่ายเงิน')
      return
    }

    if (attachmentCount === 0) {
      setError('กรุณาแนบสลิปการจ่ายเงินก่อนยืนยัน')
      return
    }

    setConfirming(true)

    const result = await confirmExpensePaid(expense.id, paidDate)

    if (!result.success) {
      setError(result.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่')
      setConfirming(false)
      return
    }

    setDone(true)
    setConfirming(false)
    onSuccess()
  }

  const handleClose = () => {
    if (!confirming) {
      onOpenChange(false)
    }
  }

  if (!expense) return null

  const formatCurrency = (amount: number) =>
    amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      Advertising: 'ค่าโฆษณา',
      COGS: 'ต้นทุนขาย',
      Operating: 'ค่าดำเนินงาน',
      Tax: 'ภาษี',
    }
    return labels[category] ?? category
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            ยืนยันการจ่ายเงิน
          </DialogTitle>
          <DialogDescription>
            แนบสลิปและระบุวันที่จ่ายจริง — หลังยืนยันแล้วจะล็อกจำนวนเงินและประเภท
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="py-6 text-center space-y-2">
            <CheckCircle className="mx-auto h-10 w-10 text-green-500" />
            <p className="font-medium text-green-700">ยืนยันการจ่ายเงินสำเร็จ</p>
            <p className="text-sm text-muted-foreground">
              รายการนี้ถูกตั้งเป็น PAID เรียบร้อยแล้ว
            </p>
          </div>
        ) : (
          <div className="space-y-5 py-2">
            {/* Expense summary */}
            <div className="rounded-md bg-slate-50 border px-4 py-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">ประเภท</span>
                <span className="font-medium">{getCategoryLabel(expense.category)}</span>
              </div>
              {expense.subcategory && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">หมวดย่อย</span>
                  <span>{expense.subcategory}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">จำนวนเงิน</span>
                <span className="font-bold text-red-600">฿{formatCurrency(expense.amount)}</span>
              </div>
              {expense.description && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">รายละเอียด</span>
                  <span className="text-right truncate">{expense.description}</span>
                </div>
              )}
              {expense.vendor && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ผู้รับเงิน</span>
                  <span>{expense.vendor}</span>
                </div>
              )}
            </div>

            {/* Paid date */}
            <div className="space-y-1.5">
              <Label htmlFor="paid_date">
                วันที่จ่ายเงินจริง <span className="text-red-500">*</span>
              </Label>
              <Input
                id="paid_date"
                type="date"
                value={paidDate}
                onChange={(e) => {
                  setPaidDate(e.target.value)
                  setError(null)
                }}
              />
            </div>

            {/* Attachments */}
            <div className="space-y-1.5">
              <AttachmentsSection
                expenseId={expense.id}
                expenseStatus={expense.expense_status}
                onUpdate={handleAttachmentUpdate}
              />
              {attachmentCount === 0 && (
                <div className="flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  ต้องแนบสลิปอย่างน้อย 1 ไฟล์ก่อนยืนยัน
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
            )}
          </div>
        )}

        <DialogFooter>
          {done ? (
            <Button onClick={handleClose}>ปิด</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={handleClose} disabled={confirming}>
                ยกเลิก
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={confirming || attachmentCount === 0}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {confirming ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    กำลังยืนยัน...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    ยืนยันจ่ายแล้ว
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
