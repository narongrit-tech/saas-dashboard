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
import { Lock, Loader2 } from 'lucide-react'
import { updateExpense } from '@/app/(dashboard)/expenses/actions'
import { AttachmentsSection } from './AttachmentsSection'

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

  const [formData, setFormData] = useState<UpdateExpenseInput>({
    expense_date: '',
    category: 'Advertising',
    subcategory: '',
    amount: 0,
    note: '',
    vendor: '',
  })

  useEffect(() => {
    if (expense) {
      setFormData({
        expense_date: expense.expense_date.split('T')[0],
        category: expense.category,
        subcategory: expense.subcategory || '',
        amount: expense.amount,
        note: expense.description || '',
        vendor: expense.vendor || '',
      })
      setError(null)
    }
  }, [expense])

  const isPaid = expense?.expense_status === 'PAID'

  const handleChange = (field: keyof UpdateExpenseInput, value: string | number | ExpenseCategory) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    setError(null)
  }

  const validateForm = (): string | null => {
    if (!isPaid && formData.amount <= 0) return 'จำนวนเงินต้องมากกว่า 0'
    if (!isPaid && !formData.expense_date) return 'กรุณาระบุวันที่'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!expense) {
      setError('ไม่พบข้อมูลรายจ่าย')
      return
    }

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
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>แก้ไขรายการค่าใช้จ่าย</DialogTitle>
            <DialogDescription>
              {isPaid
                ? 'รายการนี้ยืนยันจ่ายแล้ว — แก้ไขได้เฉพาะหมายเหตุ ผู้รับเงิน และไฟล์แนบ'
                : 'แก้ไขข้อมูลรายจ่ายที่เลือก'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* PAID lock banner */}
            {isPaid && (
              <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                <Lock className="h-4 w-4 shrink-0" />
                <span>จำนวนเงิน ประเภท และวันที่ถูกล็อกหลังจากยืนยันการจ่าย</span>
              </div>
            )}

            {/* Expense Date */}
            <div className="grid gap-2">
              <Label htmlFor="expense_date">
                วันที่ {!isPaid && <span className="text-red-500">*</span>}
              </Label>
              <Input
                id="expense_date"
                type="date"
                value={formData.expense_date}
                onChange={(e) => handleChange('expense_date', e.target.value)}
                disabled={isPaid}
                required={!isPaid}
              />
            </div>

            {/* Category */}
            <div className="grid gap-2">
              <Label htmlFor="category">
                ประเภท {!isPaid && <span className="text-red-500">*</span>}
              </Label>
              <Select
                value={formData.category}
                onValueChange={(value) => handleChange('category', value as ExpenseCategory)}
                disabled={isPaid}
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
                disabled={isPaid}
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
                จำนวนเงิน (บาท) {!isPaid && <span className="text-red-500">*</span>}
              </Label>
              <Input
                id="amount"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={formData.amount || ''}
                onChange={(e) => handleChange('amount', parseFloat(e.target.value) || 0)}
                disabled={isPaid}
                required={!isPaid}
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

            {/* Attachments (always visible) */}
            {expense && (
              <div className="rounded-md border p-3">
                <AttachmentsSection
                  expenseId={expense.id}
                  expenseStatus={expense.expense_status}
                />
              </div>
            )}

            {/* Amount summary (DRAFT only) */}
            {!isPaid && (
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
            )}

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
