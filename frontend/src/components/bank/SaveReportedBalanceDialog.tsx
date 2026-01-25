'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { saveReportedBalance } from '@/app/(dashboard)/bank/actions'
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
import { useToast } from '@/hooks/use-toast'
import { format } from 'date-fns'
import { formatBangkok } from '@/lib/bangkok-time'

interface SaveReportedBalanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bankAccountId: string
  defaultDate: Date
  onSuccess?: () => void
}

export default function SaveReportedBalanceDialog({
  open,
  onOpenChange,
  bankAccountId,
  defaultDate,
  onSuccess,
}: SaveReportedBalanceDialogProps) {
  const [reportedBalance, setReportedBalance] = useState('')
  const [reportedDate, setReportedDate] = useState('')
  const [saving, setSaving] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    if (open) {
      // Reset form with default date
      setReportedDate(format(defaultDate, 'yyyy-MM-dd'))
      setReportedBalance('')
    }
  }, [open, defaultDate])

  async function handleSave() {
    if (!reportedBalance || !reportedDate) {
      toast({
        title: 'ข้อมูลไม่ครบ',
        description: 'กรุณากรอกยอดเงินและวันที่',
        variant: 'destructive',
      })
      return
    }

    const balance = parseFloat(reportedBalance)
    if (isNaN(balance)) {
      toast({
        title: 'ข้อมูลไม่ถูกต้อง',
        description: 'กรุณากรอกยอดเงินเป็นตัวเลข',
        variant: 'destructive',
      })
      return
    }

    setSaving(true)
    const response = await saveReportedBalance(bankAccountId, reportedDate, balance)

    if (response.success) {
      toast({
        title: 'สำเร็จ',
        description: 'บันทึกยอดจากธนาคารเรียบร้อยแล้ว',
      })
      router.refresh()
      onSuccess?.()
      onOpenChange(false)
    } else {
      toast({
        title: 'ข้อผิดพลาด',
        description: response.error || 'ไม่สามารถบันทึกได้',
        variant: 'destructive',
      })
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>บันทึกยอดเงินจากธนาคาร (Reported Balance)</DialogTitle>
          <DialogDescription>
            กรอกยอดเงินที่แสดงบนสมุดบัญชีธนาคารหรือแอปฯ ธนาคาร เพื่อเปรียบเทียบกับยอดที่คำนวณได้
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="reported-date">วันที่ (Date)</Label>
            <Input
              id="reported-date"
              type="date"
              value={reportedDate}
              onChange={(e) => setReportedDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              วันที่ของยอดเงินจากธนาคาร (โดยปกติใช้วันสุดท้ายของช่วงที่เลือก)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reported-balance">ยอดเงิน (Balance)</Label>
            <Input
              id="reported-balance"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={reportedBalance}
              onChange={(e) => setReportedBalance(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              ยอดเงินที่แสดงบนสมุดบัญชีหรือแอปธนาคาร (ไม่รวมหน่วยเงิน เช่น 50000.00)
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            ยกเลิก
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
