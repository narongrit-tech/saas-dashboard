'use client'

import { useState, useEffect } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Loader2 } from 'lucide-react'
import { createCommissionReceipt } from '@/app/(dashboard)/ceo-commission/actions'
import { formatInTimeZone } from 'date-fns-tz'
import { useToast } from '@/hooks/use-toast'

const BANGKOK_TZ = 'Asia/Bangkok'

interface AddCommissionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function AddCommissionDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddCommissionDialogProps) {
  const { toast } = useToast()

  // Form state
  const [commissionDate, setCommissionDate] = useState('')
  const [platform, setPlatform] = useState('')
  const [grossAmount, setGrossAmount] = useState('')
  const [personalUsedAmount, setPersonalUsedAmount] = useState('')
  const [transferredAmount, setTransferredAmount] = useState('')
  const [note, setNote] = useState('')
  const [reference, setReference] = useState('')

  // UI state
  const [submitting, setSubmitting] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [autoCalculate, setAutoCalculate] = useState(true)

  // Initialize date to today (Bangkok timezone)
  useEffect(() => {
    if (open && !commissionDate) {
      const today = formatInTimeZone(new Date(), BANGKOK_TZ, 'yyyy-MM-dd')
      setCommissionDate(today)
    }
  }, [open])

  // Auto-calculate transferred amount when gross or personal changes
  useEffect(() => {
    if (autoCalculate) {
      const gross = parseFloat(grossAmount) || 0
      const personal = parseFloat(personalUsedAmount) || 0
      const transferred = Math.max(0, gross - personal)
      setTransferredAmount(transferred > 0 ? transferred.toFixed(2) : '')
    }
  }, [grossAmount, personalUsedAmount, autoCalculate])

  // Validate amounts in real-time
  useEffect(() => {
    const gross = parseFloat(grossAmount) || 0
    const personal = parseFloat(personalUsedAmount) || 0
    const transferred = parseFloat(transferredAmount) || 0

    if (gross > 0) {
      const sum = personal + transferred
      const diff = Math.abs(gross - sum)

      if (diff > 0.01) {
        setValidationError(
          `ยอดรวมไม่ตรง: ${gross.toFixed(2)} ≠ ${personal.toFixed(2)} + ${transferred.toFixed(2)}`
        )
      } else {
        setValidationError('')
      }
    } else {
      setValidationError('')
    }
  }, [grossAmount, personalUsedAmount, transferredAmount])

  // Reset form
  const resetForm = () => {
    const today = formatInTimeZone(new Date(), BANGKOK_TZ, 'yyyy-MM-dd')
    setCommissionDate(today)
    setPlatform('')
    setGrossAmount('')
    setPersonalUsedAmount('')
    setTransferredAmount('')
    setNote('')
    setReference('')
    setValidationError('')
    setAutoCalculate(true)
  }

  // Handle submit
  const handleSubmit = async () => {
    try {
      // Validate required fields
      if (!commissionDate) {
        toast({
          variant: 'destructive',
          title: 'ข้อมูลไม่ครบ',
          description: 'กรุณาระบุวันที่รับ Commission',
        })
        return
      }
      if (!platform.trim()) {
        toast({
          variant: 'destructive',
          title: 'ข้อมูลไม่ครบ',
          description: 'กรุณาระบุ Platform',
        })
        return
      }
      if (!grossAmount || parseFloat(grossAmount) <= 0) {
        toast({
          variant: 'destructive',
          title: 'ข้อมูลไม่ครบ',
          description: 'กรุณาระบุจำนวน Commission ที่รับ',
        })
        return
      }

      // Check validation error
      if (validationError) {
        toast({
          variant: 'destructive',
          title: 'ข้อมูลไม่ถูกต้อง',
          description: 'กรุณาแก้ไขข้อผิดพลาดก่อนบันทึก',
        })
        return
      }

      setSubmitting(true)

      const result = await createCommissionReceipt({
        commission_date: commissionDate,
        platform: platform.trim(),
        gross_amount: parseFloat(grossAmount),
        personal_used_amount: parseFloat(personalUsedAmount) || 0,
        transferred_to_company_amount: parseFloat(transferredAmount) || 0,
        note: note.trim() || undefined,
        reference: reference.trim() || undefined,
      })

      if (result.success) {
        if (result.warning) {
          toast({
            title: 'คำเตือน',
            description: result.warning,
          })
        }
        resetForm()
        onSuccess()
      } else {
        toast({
          variant: 'destructive',
          title: 'เกิดข้อผิดพลาด',
          description: result.error || 'บันทึกไม่สำเร็จ',
        })
      }
    } catch (error) {
      console.error('Submit error:', error)
      toast({
        variant: 'destructive',
        title: 'เกิดข้อผิดพลาด',
        description: 'เกิดข้อผิดพลาดในการบันทึก',
      })
    } finally {
      setSubmitting(false)
    }
  }

  // Handle dialog close
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && !submitting) {
      resetForm()
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>เพิ่ม Commission Record</DialogTitle>
          <DialogDescription>
            บันทึก Commission ที่รับจาก Platform และจำนวนที่โอนให้บริษัท
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="commission_date">
              วันที่รับ Commission <span className="text-red-500">*</span>
            </Label>
            <Input
              id="commission_date"
              type="date"
              value={commissionDate}
              onChange={(e) => setCommissionDate(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Platform */}
          <div className="space-y-2">
            <Label htmlFor="platform">
              Platform <span className="text-red-500">*</span>
            </Label>
            <Input
              id="platform"
              type="text"
              placeholder="เช่น TikTok, Shopee, Lazada"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Gross Amount */}
          <div className="space-y-2">
            <Label htmlFor="gross_amount">
              Commission ที่รับ (Gross) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="gross_amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={grossAmount}
              onChange={(e) => setGrossAmount(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Personal Used Amount */}
          <div className="space-y-2">
            <Label htmlFor="personal_used">จำนวนที่ใช้ส่วนตัว</Label>
            <Input
              id="personal_used"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={personalUsedAmount}
              onChange={(e) => setPersonalUsedAmount(e.target.value)}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              จำนวนที่ใช้ส่วนตัว (ไม่โอนให้บริษัท)
            </p>
          </div>

          {/* Transferred Amount */}
          <div className="space-y-2">
            <Label htmlFor="transferred">
              จำนวนที่โอนให้บริษัท
              <span className="ml-2 text-xs text-muted-foreground">
                {autoCalculate && '(คำนวณอัตโนมัติ)'}
              </span>
            </Label>
            <Input
              id="transferred"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={transferredAmount}
              onChange={(e) => {
                setTransferredAmount(e.target.value)
                setAutoCalculate(false)
              }}
              onFocus={() => setAutoCalculate(false)}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              จำนวนที่โอนให้บริษัท (จะถูกบันทึกเป็น Director Loan)
            </p>
          </div>

          {/* Validation Error */}
          {validationError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}

          {/* Auto-calculate hint */}
          {autoCalculate && grossAmount && personalUsedAmount && (
            <Alert>
              <AlertDescription className="text-sm">
                คำนวณอัตโนมัติ: {grossAmount} - {personalUsedAmount} = {transferredAmount}
              </AlertDescription>
            </Alert>
          )}

          {/* Note */}
          <div className="space-y-2">
            <Label htmlFor="note">หมายเหตุ</Label>
            <Textarea
              id="note"
              placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
              rows={3}
            />
          </div>

          {/* Reference */}
          <div className="space-y-2">
            <Label htmlFor="reference">Reference</Label>
            <Input
              id="reference"
              type="text"
              placeholder="เลขที่อ้างอิง เช่น Transaction ID (ถ้ามี)"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !!validationError || !grossAmount || !platform}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                กำลังบันทึก...
              </>
            ) : (
              'บันทึก'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
