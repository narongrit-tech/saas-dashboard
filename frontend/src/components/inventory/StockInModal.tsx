'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Package } from 'lucide-react'
import { createStockInForSku } from '@/app/(dashboard)/inventory/actions'
import { formatBangkok, getBangkokNow } from '@/lib/bangkok-time'

interface StockInModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sku_internal: string
  onSuccess?: () => void
}

export function StockInModal({
  open,
  onOpenChange,
  sku_internal,
  onSuccess,
}: StockInModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Form state
  const [receivedAt, setReceivedAt] = useState(
    formatBangkok(getBangkokNow(), 'yyyy-MM-dd')
  )
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [reference, setReference] = useState('')
  const [supplier, setSupplier] = useState('')
  const [note, setNote] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const qtyNum = parseFloat(qty)
      const unitCostNum = parseFloat(unitCost)

      // Validate
      if (isNaN(qtyNum) || qtyNum <= 0) {
        setError('Quantity ต้องเป็นตัวเลขมากกว่า 0')
        setLoading(false)
        return
      }

      if (isNaN(unitCostNum) || unitCostNum < 0) {
        setError('Unit Cost ต้องเป็นตัวเลขไม่ติดลบ')
        setLoading(false)
        return
      }

      if (!reference.trim()) {
        setError('Reference จำเป็นต้องระบุ')
        setLoading(false)
        return
      }

      // Call server action
      const response = await createStockInForSku({
        sku_internal,
        received_at: receivedAt,
        qty: qtyNum,
        unit_cost: unitCostNum,
        reference: reference.trim(),
        supplier: supplier.trim() || undefined,
        note: note.trim() || undefined,
      })

      if (!response.success) {
        setError(response.error || 'เกิดข้อผิดพลาด')
      } else {
        setSuccess(true)
        alert(`Stock In สำเร็จ!\nSKU: ${sku_internal}\nQty: ${qtyNum}\nDoc ID: ${response.data?.doc_id}`)
        if (onSuccess) {
          onSuccess()
        }
        // Close modal after short delay
        setTimeout(() => {
          handleClose()
        }, 500)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด')
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    if (!loading) {
      // Reset form
      setReceivedAt(formatBangkok(getBangkokNow(), 'yyyy-MM-dd'))
      setQty('')
      setUnitCost('')
      setReference('')
      setSupplier('')
      setNote('')
      setError(null)
      setSuccess(false)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Stock In
          </DialogTitle>
          <DialogDescription>
            รับสินค้าเข้าสำหรับ SKU: <span className="font-mono font-semibold">{sku_internal}</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Received At */}
          <div className="space-y-2">
            <Label htmlFor="receivedAt">
              Received At <span className="text-destructive">*</span>
            </Label>
            <Input
              id="receivedAt"
              type="date"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          {/* Quantity */}
          <div className="space-y-2">
            <Label htmlFor="qty">
              Quantity <span className="text-destructive">*</span>
            </Label>
            <Input
              id="qty"
              type="number"
              step="0.0001"
              min="0.0001"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="e.g., 100"
              disabled={loading}
              required
            />
          </div>

          {/* Unit Cost */}
          <div className="space-y-2">
            <Label htmlFor="unitCost">
              Unit Cost (THB) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="unitCost"
              type="number"
              step="0.01"
              min="0"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              placeholder="e.g., 50.00"
              disabled={loading}
              required
            />
          </div>

          {/* Reference */}
          <div className="space-y-2">
            <Label htmlFor="reference">
              Reference (PO/Invoice/Ref No.) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="reference"
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g., PO-2024-001"
              disabled={loading}
              required
            />
          </div>

          {/* Supplier */}
          <div className="space-y-2">
            <Label htmlFor="supplier">Supplier (Optional)</Label>
            <Input
              id="supplier"
              type="text"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="e.g., ABC Trading Co."
              disabled={loading}
            />
          </div>

          {/* Note */}
          <div className="space-y-2">
            <Label htmlFor="note">Note (Optional)</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Additional notes..."
              rows={3}
              disabled={loading}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-600">
              Stock In สำเร็จ!
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {loading ? 'กำลังบันทึก...' : 'บันทึก Stock In'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
