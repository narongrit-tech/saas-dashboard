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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CreateExpenseInput, ExpenseCategory } from '@/types/expenses'
import { Loader2 } from 'lucide-react'
import { createManualExpense } from '@/app/(dashboard)/expenses/actions'
import { getTodayBangkokString } from '@/lib/bangkok-date-range'

interface AddExpenseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const CATEGORIES: ExpenseCategory[] = ['Advertising', 'COGS', 'Operating']

function getTodayDate(): string {
  return getTodayBangkokString()
}

const EMPTY_FORM: CreateExpenseInput = {
  expense_date: '',
  category: 'Advertising',
  subcategory: '',
  amount: 0,
  note: '',
  planned_date: '',
  vendor: '',
}

export function AddExpenseDialog({ open, onOpenChange, onSuccess }: AddExpenseDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [formData, setFormData] = useState<CreateExpenseInput>({
    ...EMPTY_FORM,
    expense_date: getTodayDate(),
  })

  const handleChange = (field: keyof CreateExpenseInput, value: string | number | ExpenseCategory) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    setError(null)
  }

  const validateForm = (): string | null => {
    if (formData.amount <= 0) return 'จำนวนเงินต้องมากกว่า 0'
    if (!formData.expense_date) return 'กรุณาระบุวันที่'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)

    try {
      const result = await createManualExpense(formData)

      if (!result.success) {
        setError(result.error || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล')
        return
      }

      resetAndClose()
      onSuccess()
    } catch (err) {
      console.error('Error submitting expense:', err)
      setError('เกิดข้อผิดพลาดในการบันทึกข้อมูล')
    } finally {
      setLoading(false)
    }
  }

  const resetAndClose = () => {
    setFormData({ ...EMPTY_FORM, expense_date: getTodayDate() })
    setError(null)
    onOpenChange(false)
  }

  const getCategoryLabel = (category: ExpenseCategory): string => {
    const labels: Record<ExpenseCategory, string> = {
      Advertising: 'ค่าโฆษณา',
      COGS: 'ต้นทุนขาย (COGS)',
      Operating: 'ค่าใช้จ่ายดำเนินงาน',
    }
    return labels[category]
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>เพิ่มรายการค่าใช้จ่าย</DialogTitle>
            <DialogDescription>
              รายการใหม่จะบันทึกเป็น <strong>DRAFT</strong> — กด &ldquo;ยืนยันจ่าย&rdquo; ภายหลังเมื่อจ่ายจริง
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Planned date (= expense_date for planning) */}
            <div className="grid gap-2">
              <Label htmlFor="expense_date">
                วันที่วางแผนจ่าย <span className="text-red-500">*</span>
              </Label>
              <Input
                id="expense_date"
                type="date"
                value={formData.expense_date}
                onChange={(e) => handleChange('expense_date', e.target.value)}
                required
              />
            </div>

            {/* Category */}
            <div className="grid gap-2">
              <Label htmlFor="category">
                ประเภท <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formData.category}
                onValueChange={(value) => handleChange('category', value as ExpenseCategory)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {getCategoryLabel(category)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Subcategory */}
            <div className="grid gap-2">
              <Label htmlFor="subcategory">หมวดหมู่ย่อย (ถ้ามี)</Label>
              <Input
                id="subcategory"
                type="text"
                placeholder="เช่น Facebook Ads, Google Ads, Office Rent"
                value={formData.subcategory || ''}
                onChange={(e) => handleChange('subcategory', e.target.value)}
              />
            </div>

            {/* Vendor */}
            <div className="grid gap-2">
              <Label htmlFor="vendor">ผู้รับเงิน / ร้านค้า (ถ้ามี)</Label>
              <Input
                id="vendor"
                type="text"
                placeholder="เช่น Meta, Google, ร้านนาย ก"
                value={formData.vendor || ''}
                onChange={(e) => handleChange('vendor', e.target.value)}
              />
            </div>

            {/* Amount */}
            <div className="grid gap-2">
              <Label htmlFor="amount">
                จำนวนเงิน (บาท) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="amount"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={formData.amount || ''}
                onChange={(e) => handleChange('amount', parseFloat(e.target.value) || 0)}
                required
              />
            </div>

            {/* Note */}
            <div className="grid gap-2">
              <Label htmlFor="note">หมายเหตุ (ถ้ามี)</Label>
              <Textarea
                id="note"
                placeholder="ระบุรายละเอียดเพิ่มเติม..."
                value={formData.note || ''}
                onChange={(e) => handleChange('note', e.target.value)}
                rows={3}
              />
            </div>

            {/* Amount Preview */}
            <div className="rounded-md bg-slate-50 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">จำนวนเงินรวม:</span>
                <span className="text-lg font-bold text-red-600">
                  -฿{formData.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                * บันทึกเป็น DRAFT — ยังไม่นับใน P&L จนกว่าจะยืนยันจ่าย
              </p>
            </div>

            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetAndClose} disabled={loading}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  กำลังบันทึก...
                </>
              ) : (
                'บันทึก (DRAFT)'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
