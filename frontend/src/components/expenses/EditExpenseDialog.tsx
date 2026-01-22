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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Expense, UpdateExpenseInput, ExpenseCategory } from '@/types/expenses'
import { Loader2 } from 'lucide-react'
import { updateExpense } from '@/app/(dashboard)/expenses/actions'

interface EditExpenseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  expense: Expense | null
}

const CATEGORIES: ExpenseCategory[] = ['Advertising', 'COGS', 'Operating']

export function EditExpenseDialog({
  open,
  onOpenChange,
  onSuccess,
  expense,
}: EditExpenseDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [formData, setFormData] = useState<UpdateExpenseInput>({
    expense_date: '',
    category: 'Advertising',
    amount: 0,
    note: '',
  })

  // Populate form when expense changes
  useEffect(() => {
    if (expense) {
      setFormData({
        expense_date: expense.expense_date.split('T')[0], // Extract YYYY-MM-DD
        category: expense.category,
        amount: expense.amount,
        note: expense.description || '',
      })
      setError(null)
    }
  }, [expense])

  const handleChange = (field: keyof UpdateExpenseInput, value: string | number | ExpenseCategory) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    setError(null)
  }

  const validateForm = (): string | null => {
    if (formData.amount <= 0) {
      return 'จำนวนเงินต้องมากกว่า 0'
    }
    if (!formData.expense_date) {
      return 'กรุณาระบุวันที่'
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!expense) {
      setError('ไม่พบข้อมูลรายจ่าย')
      return
    }

    // Client-side validation
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)

    try {
      const result = await updateExpense(expense.id, formData)

      if (!result.success) {
        setError(result.error || 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล')
        return
      }

      // Success - close dialog and refresh
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      console.error('Error updating expense:', err)
      setError('เกิดข้อผิดพลาดในการอัปเดตข้อมูล')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
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
            <DialogTitle>แก้ไขรายการค่าใช้จ่าย</DialogTitle>
            <DialogDescription>
              แก้ไขข้อมูลรายจ่ายที่เลือก
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Expense Date */}
            <div className="grid gap-2">
              <Label htmlFor="expense_date">
                วันที่ <span className="text-red-500">*</span>
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

            {/* Note (Optional) */}
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
                * ค่าใช้จ่ายจะถูกหักออกจากกำไร
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel} disabled={loading}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  กำลังบันทึก...
                </>
              ) : (
                'บันทึก'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
