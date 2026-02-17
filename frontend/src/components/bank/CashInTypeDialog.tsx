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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import { CASH_IN_TYPES, CASH_IN_TYPE_LABELS, CashInType } from '@/types/bank'

interface CashInTypeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedCount: number
  selectedAmount: number
  onConfirm: (cashInType: CashInType, refType?: string, refId?: string, note?: string) => void
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function CashInTypeDialog({
  open,
  onOpenChange,
  selectedCount,
  selectedAmount,
  onConfirm,
}: CashInTypeDialogProps) {
  const [cashInType, setCashInType] = useState<CashInType | ''>('')
  const [refType, setRefType] = useState('')
  const [refId, setRefId] = useState('')
  const [note, setNote] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [loading, setLoading] = useState(false)

  const requiresNote = cashInType === 'OTHER' || cashInType === 'OTHER_INCOME'
  const confirmationRequired = `APPLY ${selectedCount}`
  const canSubmit =
    cashInType &&
    confirmText === confirmationRequired &&
    (!requiresNote || (requiresNote && note.trim().length > 0))

  function handleClose() {
    // Reset form
    setCashInType('')
    setRefType('')
    setRefId('')
    setNote('')
    setConfirmText('')
    setLoading(false)
    onOpenChange(false)
  }

  async function handleSubmit() {
    if (!canSubmit || !cashInType) return

    try {
      setLoading(true)
      await onConfirm(cashInType, refType || undefined, refId || undefined, note || undefined)
      handleClose()
    } catch (error) {
      console.error('Error in dialog submit:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>กำหนดประเภทเงินเข้า</DialogTitle>
          <DialogDescription>
            คุณกำลังจะจัดประเภทสำหรับ <strong>{selectedCount}</strong> รายการ (รวม ฿
            {formatCurrency(selectedAmount)})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Cash In Type Selection */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              ประเภทเงินเข้า <span className="text-destructive">*</span>
            </label>
            <Select value={cashInType} onValueChange={(val) => setCashInType(val as CashInType)}>
              <SelectTrigger>
                <SelectValue placeholder="เลือกประเภท" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CASH_IN_TYPE_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Optional Reference Type */}
          <div>
            <label className="text-sm font-medium mb-2 block">Ref Type (ถ้ามี)</label>
            <Input
              placeholder="เช่น settlement, expense, invoice"
              value={refType}
              onChange={(e) => setRefType(e.target.value)}
            />
          </div>

          {/* Optional Reference ID */}
          <div>
            <label className="text-sm font-medium mb-2 block">Ref ID (ถ้ามี)</label>
            <Input
              placeholder="เช่น UUID หรือรหัสอ้างอิง"
              value={refId}
              onChange={(e) => setRefId(e.target.value)}
            />
          </div>

          {/* Note (required for OTHER and OTHER_INCOME) */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              หมายเหตุ {requiresNote && <span className="text-destructive">*</span>}
            </label>
            <Textarea
              placeholder={
                requiresNote
                  ? 'กรุณาระบุรายละเอียดเพิ่มเติม (บังคับสำหรับประเภท "อื่นๆ")'
                  : 'หมายเหตุเพิ่มเติม (ไม่บังคับ)'
              }
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </div>

          {/* Confirmation Alert */}
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>คำเตือน:</strong> การจัดประเภทจะมีผลต่อ {selectedCount} รายการทันที
              <br />
              พิมพ์ <code className="font-mono bg-destructive/20 px-1 rounded">
                {confirmationRequired}
              </code>{' '}
              เพื่อยืนยัน
            </AlertDescription>
          </Alert>

          {/* Confirmation Input */}
          <div>
            <Input
              placeholder={`พิมพ์ "${confirmationRequired}" เพื่อยืนยัน`}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            ยกเลิก
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || loading}>
            {loading ? 'กำลังบันทึก...' : 'ยืนยัน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
