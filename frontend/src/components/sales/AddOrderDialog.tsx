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
import { createManualOrder } from '@/app/(dashboard)/sales/actions'
import { CreateOrderInput, SalesOrderStatus } from '@/types/sales'
import { Loader2 } from 'lucide-react'

interface AddOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const MARKETPLACES = ['TikTok', 'Shopee', 'Lazada', 'Line', 'Facebook']
const STATUSES: SalesOrderStatus[] = ['completed', 'pending', 'cancelled']

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]
}

export function AddOrderDialog({ open, onOpenChange, onSuccess }: AddOrderDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state with defaults
  const [formData, setFormData] = useState<CreateOrderInput>({
    order_date: getTodayDate(),
    marketplace: 'TikTok',
    product_name: '',
    quantity: 1,
    unit_price: 0,
    status: 'completed',
  })

  const handleChange = (field: keyof CreateOrderInput, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    setError(null) // Clear error when user makes changes
  }

  const validateForm = (): string | null => {
    if (!formData.product_name.trim()) {
      return 'กรุณากรอกชื่อสินค้า'
    }
    if (formData.quantity <= 0) {
      return 'จำนวนต้องมากกว่า 0'
    }
    if (formData.unit_price < 0) {
      return 'ราคาต่อหน่วยต้องไม่ติดลบ'
    }
    if (!formData.order_date) {
      return 'กรุณาระบุวันที่สั่งซื้อ'
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Client-side validation
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)

    try {
      const result = await createManualOrder(formData)

      if (!result.success) {
        setError(result.error || 'เกิดข้อผิดพลาด')
        return
      }

      // Success - reset form and close dialog
      setFormData({
        order_date: getTodayDate(),
        marketplace: 'TikTok',
        product_name: '',
        quantity: 1,
        unit_price: 0,
        status: 'completed',
      })
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      console.error('Error submitting order:', err)
      setError('เกิดข้อผิดพลาดในการบันทึกข้อมูล')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    // Reset form when closing
    setFormData({
      order_date: getTodayDate(),
      marketplace: 'TikTok',
      product_name: '',
      quantity: 1,
      unit_price: 0,
      status: 'completed',
    })
    setError(null)
    onOpenChange(false)
  }

  // Calculate total for display (client-side preview only)
  const totalPreview =
    formData.status.toLowerCase() === 'cancelled' ? 0 : formData.quantity * formData.unit_price

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Quick Add Order</DialogTitle>
            <DialogDescription>
              เพิ่มรายการสั่งซื้อแบบ manual เพื่อบันทึกยอดขายทันที
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Order Date */}
            <div className="grid gap-2">
              <Label htmlFor="order_date">
                วันที่สั่งซื้อ <span className="text-red-500">*</span>
              </Label>
              <Input
                id="order_date"
                type="date"
                value={formData.order_date}
                onChange={(e) => handleChange('order_date', e.target.value)}
                required
              />
            </div>

            {/* Marketplace */}
            <div className="grid gap-2">
              <Label htmlFor="marketplace">
                Marketplace <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formData.marketplace}
                onValueChange={(value) => handleChange('marketplace', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETPLACES.map((marketplace) => (
                    <SelectItem key={marketplace} value={marketplace}>
                      {marketplace}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Product Name */}
            <div className="grid gap-2">
              <Label htmlFor="product_name">
                ชื่อสินค้า <span className="text-red-500">*</span>
              </Label>
              <Input
                id="product_name"
                placeholder="ระบุชื่อสินค้า"
                value={formData.product_name}
                onChange={(e) => handleChange('product_name', e.target.value)}
                required
              />
            </div>

            {/* Quantity and Unit Price */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="quantity">
                  จำนวน <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  step="1"
                  value={formData.quantity}
                  onChange={(e) => handleChange('quantity', parseInt(e.target.value) || 0)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="unit_price">
                  ราคาต่อหน่วย <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="unit_price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.unit_price}
                  onChange={(e) => handleChange('unit_price', parseFloat(e.target.value) || 0)}
                  required
                />
              </div>
            </div>

            {/* Status */}
            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => handleChange('status', value as SalesOrderStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Total Preview */}
            <div className="rounded-md bg-slate-50 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Total Amount:</span>
                <span className="text-lg font-bold">
                  ฿{totalPreview.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>
              {formData.status.toLowerCase() === 'cancelled' && (
                <p className="mt-1 text-xs text-muted-foreground">
                  * Order ที่ cancelled จะมี total = 0
                </p>
              )}
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
