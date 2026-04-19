'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Loader2, AlertCircle, CheckCircle2, TrendingUp, TrendingDown } from 'lucide-react'
import { createAdjustIn, createAdjustOut } from '@/app/(dashboard)/inventory/actions'
import { getTodayBangkokString } from '@/lib/bangkok-date-range'

interface InventoryItemOption {
  sku_internal: string
  product_name: string
  is_bundle: boolean
}

interface AdjustStockDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  inventoryItems: InventoryItemOption[]
}

type DialogStep = 'form' | 'submitting' | 'success'

export function AdjustStockDialog({
  open,
  onOpenChange,
  onSuccess,
  inventoryItems,
}: AdjustStockDialogProps) {
  const [step, setStep] = useState<DialogStep>('form')
  const [adjustmentType, setAdjustmentType] = useState<'ADJUST_IN' | 'ADJUST_OUT'>('ADJUST_IN')
  const [sku, setSku] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [adjustedAt, setAdjustedAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState<string>('')

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setStep('form')
      setAdjustmentType('ADJUST_IN')
      setSku('')
      setQuantity('')
      setReason('')
      setAdjustedAt(getTodayBangkokString())
      setError(null)
      setResultMessage('')
    }
  }, [open])

  const selectedItem = inventoryItems.find((i) => i.sku_internal === sku)
  const isBundle = selectedItem?.is_bundle ?? false

  async function handleSubmit() {
    setError(null)

    // Client-side validation
    if (!sku) { setError('กรุณาเลือก SKU'); return }
    if (isBundle) { setError('ไม่สามารถปรับ Bundle SKU ได้โดยตรง — ปรับ component SKUs แทน'); return }
    const qty = parseFloat(quantity)
    if (!Number.isFinite(qty) || qty <= 0) { setError('ปริมาณต้องมากกว่า 0'); return }
    if (!reason.trim()) { setError('กรุณาระบุเหตุผล'); return }
    if (!adjustedAt) { setError('กรุณาระบุวันที่'); return }

    // Convert date to Bangkok ISO timestamp
    const adjustedAtISO = `${adjustedAt}T00:00:00+07:00`

    setStep('submitting')

    try {
      let result: { success: boolean; error?: string }

      if (adjustmentType === 'ADJUST_IN') {
        result = await createAdjustIn({
          sku_internal: sku,
          quantity: qty,
          reason: reason.trim(),
          adjusted_at: adjustedAtISO,
        })
      } else {
        result = await createAdjustOut({
          sku_internal: sku,
          quantity: qty,
          reason: reason.trim(),
          adjusted_at: adjustedAt ? `${adjustedAt}T00:00:00+07:00` : new Date().toISOString(),
        })
      }

      if (!result.success) {
        setError(result.error ?? 'เกิดข้อผิดพลาด')
        setStep('form')
        return
      }

      const label = adjustmentType === 'ADJUST_IN' ? 'เพิ่ม' : 'ลด'
      setResultMessage(
        `${label}สต็อก ${sku} จำนวน ${qty} หน่วยเรียบร้อยแล้ว`
      )
      setStep('success')
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด')
      setStep('form')
    }
  }

  function handleClose() {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adjust Stock</DialogTitle>
          <DialogDescription>
            ปรับสต็อกด้วยตนเองเพื่อแก้ไขความคลาดเคลื่อนระหว่างระบบและของจริง
          </DialogDescription>
        </DialogHeader>

        {step === 'success' ? (
          <div className="space-y-4">
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle>สำเร็จ</AlertTitle>
              <AlertDescription>{resultMessage}</AlertDescription>
            </Alert>
            <div className="text-sm text-muted-foreground space-y-1 p-3 bg-muted/30 rounded-md">
              <p><span className="font-medium">SKU:</span> {sku}</p>
              <p><span className="font-medium">ประเภท:</span>{' '}
                {adjustmentType === 'ADJUST_IN' ? (
                  <Badge className="bg-green-100 text-green-800 text-xs ml-1">ADJUST_IN</Badge>
                ) : (
                  <Badge className="bg-red-100 text-red-800 text-xs ml-1">ADJUST_OUT</Badge>
                )}
              </p>
              <p><span className="font-medium">ปริมาณ:</span> {quantity}</p>
              <p><span className="font-medium">เหตุผล:</span> {reason}</p>
              <p><span className="font-medium">วันที่:</span> {adjustedAt}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Adjustment Type */}
            <div className="space-y-2">
              <Label>ประเภทการปรับ</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustmentType('ADJUST_IN')}
                  disabled={step === 'submitting'}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm font-medium transition-colors
                    ${adjustmentType === 'ADJUST_IN'
                      ? 'border-green-500 bg-green-50 text-green-800 dark:border-green-600 dark:bg-green-950/30 dark:text-green-200'
                      : 'border-border hover:bg-muted/50'
                    }`}
                >
                  <TrendingUp className="h-4 w-4" />
                  ADJUST_IN (เพิ่ม)
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustmentType('ADJUST_OUT')}
                  disabled={step === 'submitting'}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm font-medium transition-colors
                    ${adjustmentType === 'ADJUST_OUT'
                      ? 'border-red-500 bg-red-50 text-red-800 dark:border-red-600 dark:bg-red-950/30 dark:text-red-200'
                      : 'border-border hover:bg-muted/50'
                    }`}
                >
                  <TrendingDown className="h-4 w-4" />
                  ADJUST_OUT (ลด)
                </button>
              </div>
            </div>

            {/* SKU Select */}
            <div className="space-y-2">
              <Label htmlFor="adj-sku">SKU</Label>
              <Select
                value={sku}
                onValueChange={setSku}
                disabled={step === 'submitting'}
              >
                <SelectTrigger id="adj-sku">
                  <SelectValue placeholder="เลือก SKU..." />
                </SelectTrigger>
                <SelectContent>
                  {inventoryItems.map((item) => (
                    <SelectItem
                      key={item.sku_internal}
                      value={item.sku_internal}
                    >
                      <span className="font-mono text-xs">{item.sku_internal}</span>
                      <span className="ml-2 text-muted-foreground">{item.product_name}</span>
                      {item.is_bundle && (
                        <Badge variant="secondary" className="ml-2 text-xs">Bundle</Badge>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isBundle && (
                <p className="text-xs text-amber-600">
                  Bundle SKU — ปรับผ่าน component SKUs แทน
                </p>
              )}
            </div>

            {/* Quantity */}
            <div className="space-y-2">
              <Label htmlFor="adj-qty">ปริมาณ</Label>
              <Input
                id="adj-qty"
                type="number"
                min="0.0001"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={step === 'submitting'}
                placeholder="0"
              />
            </div>

            {/* Date */}
            <div className="space-y-2">
              <Label htmlFor="adj-date">วันที่ปรับ</Label>
              <Input
                id="adj-date"
                type="date"
                value={adjustedAt}
                onChange={(e) => setAdjustedAt(e.target.value)}
                disabled={step === 'submitting'}
              />
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label htmlFor="adj-reason">เหตุผล (จำเป็น)</Label>
              <Textarea
                id="adj-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={step === 'submitting'}
                placeholder="เช่น: นับสต็อกจริงพบสินค้าเกิน / สินค้าเสียหาย ทำลายทิ้ง..."
                rows={3}
              />
            </div>

            {/* Error */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>ข้อผิดพลาด</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'success' ? (
            <Button onClick={handleClose} className="w-full">ปิด</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={step === 'submitting'}>
                ยกเลิก
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={step === 'submitting' || !sku || !quantity || !reason.trim() || isBundle}
                className={adjustmentType === 'ADJUST_OUT' ? 'bg-red-600 hover:bg-red-700' : ''}
              >
                {step === 'submitting' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {step === 'submitting'
                  ? 'กำลังบันทึก...'
                  : adjustmentType === 'ADJUST_IN'
                  ? 'Adjust In (เพิ่ม)'
                  : 'Adjust Out (ลด)'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
