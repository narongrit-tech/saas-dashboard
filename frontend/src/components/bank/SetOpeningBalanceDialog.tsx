'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { BankOpeningBalance } from '@/types/bank'
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
import { useToast } from '@/hooks/use-toast'
import { Calendar } from 'lucide-react'
import { format, startOfYear } from 'date-fns'
import { getOpeningBalance, upsertOpeningBalance } from '@/app/(dashboard)/bank/actions'

interface SetOpeningBalanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bankAccountId: string
  defaultDate?: Date // Date range start or current date
  onSuccess: () => void
}

export default function SetOpeningBalanceDialog({
  open,
  onOpenChange,
  bankAccountId,
  defaultDate,
  onSuccess,
}: SetOpeningBalanceDialogProps) {
  const router = useRouter()
  const [effectiveDate, setEffectiveDate] = useState<string>('')
  const [openingBalance, setOpeningBalance] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [loadingExisting, setLoadingExisting] = useState(false)
  const { toast } = useToast()

  // Initialize effective date (default to Jan 1 of current year or provided date)
  useEffect(() => {
    if (open && !effectiveDate) {
      const initialDate = defaultDate || new Date()
      const yearStart = startOfYear(initialDate)
      setEffectiveDate(format(yearStart, 'yyyy-MM-dd'))
    }
  }, [open, defaultDate, effectiveDate])

  // Load existing opening balance when dialog opens
  useEffect(() => {
    if (open && bankAccountId) {
      loadExistingOpeningBalance()
    }
  }, [open, bankAccountId])

  async function loadExistingOpeningBalance() {
    setLoadingExisting(true)
    try {
      const response = await getOpeningBalance(bankAccountId)
      if (response.success && response.data) {
        // Found existing opening balance
        setEffectiveDate(response.data.as_of_date)
        setOpeningBalance(String(response.data.opening_balance))
        setNote('') // Note field not in BankOpeningBalance type
      }
    } catch (error) {
      console.error('Load existing opening balance error:', error)
    }
    setLoadingExisting(false)
  }

  function handleReset() {
    setEffectiveDate(format(startOfYear(defaultDate || new Date()), 'yyyy-MM-dd'))
    setOpeningBalance('')
    setNote('')
  }

  async function handleSave() {
    // Validation
    if (!effectiveDate) {
      toast({
        title: 'ข้อผิดพลาด',
        description: 'กรุณาระบุวันที่มีผล',
        variant: 'destructive',
      })
      return
    }

    const balance = parseFloat(openingBalance)
    if (isNaN(balance)) {
      toast({
        title: 'ข้อผิดพลาด',
        description: 'กรุณาระบุยอดยกมาเป็นตัวเลข',
        variant: 'destructive',
      })
      return
    }

    setLoading(true)

    try {
      const response = await upsertOpeningBalance(
        bankAccountId,
        effectiveDate,
        balance
      )

      if (response.success) {
        toast({
          title: 'สำเร็จ',
          description: 'บันทึกยอดยกมาเรียบร้อยแล้ว',
        })
        handleReset()
        onOpenChange(false)
        onSuccess()
        // Refresh all pages to show updated balances
        router.refresh()
      } else {
        toast({
          title: 'ข้อผิดพลาด',
          description: response.error || 'Failed to save opening balance',
          variant: 'destructive',
        })
      }
    } catch (error) {
      console.error('Save opening balance error:', error)
      toast({
        title: 'ข้อผิดพลาด',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    }

    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>ตั้งค่ายอดยกมา (Opening Balance)</DialogTitle>
          <DialogDescription>
            ระบุยอดเงินคงเหลือในบัญชีธนาคาร ณ วันที่เริ่มต้น (เช่น 1 มกราคม หรือวันที่เริ่ม import)
          </DialogDescription>
        </DialogHeader>

        {loadingExisting ? (
          <div className="py-8 text-center text-sm text-muted-foreground">กำลังโหลด...</div>
        ) : (
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="effective_date">
                วันที่มีผล <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="effective_date"
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  className="pr-10"
                />
                <Calendar className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
              <p className="text-xs text-muted-foreground">
                เช่น 2026-01-01 (วันแรกของปี) หรือวันที่เริ่ม import ข้อมูล
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="opening_balance">
                ยอดยกมา (THB) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="opening_balance"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                ยอดเงินคงเหลือในบัญชี ณ วันที่มีผล (สามารถเป็นบวก ลบ หรือ 0 ได้)
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="note">หมายเหตุ (ถ้ามี)</Label>
              <Textarea
                id="note"
                placeholder="เช่น ยอดยกมาต้นปี 2026, ยอดหลังปรับปรุงบัญชี"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              handleReset()
              onOpenChange(false)
            }}
            disabled={loading || loadingExisting}
          >
            ยกเลิก
          </Button>
          <Button onClick={handleSave} disabled={loading || loadingExisting}>
            {loading ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
