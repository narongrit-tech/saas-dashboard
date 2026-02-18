'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { upsertInventoryItem } from '@/app/(dashboard)/inventory/actions'

interface CreateBundleModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function CreateBundleModal({
  open,
  onOpenChange,
  onSuccess,
}: CreateBundleModalProps) {
  const [sku, setSku] = useState('')
  const [bundleName, setBundleName] = useState('')
  const [cost, setCost] = useState('')
  const [saving, setSaving] = useState(false)

  function handleClose() {
    setSku('')
    setBundleName('')
    setCost('')
    onOpenChange(false)
  }

  async function handleSave() {
    if (!sku || !bundleName || !cost) {
      alert('กรุณากรอกข้อมูลให้ครบถ้วน')
      return
    }

    setSaving(true)
    const result = await upsertInventoryItem({
      sku_internal: sku,
      product_name: bundleName,
      base_cost_per_unit: parseFloat(cost),
      is_bundle: true, // This is a bundle
    })

    if (result.success) {
      alert('✓ สร้าง Bundle สำเร็จ! ตอนนี้สามารถเพิ่ม components ได้แล้ว')
      handleClose()
      onSuccess()
    } else {
      alert('เกิดข้อผิดพลาด: ' + result.error)
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>สร้าง Bundle SKU ใหม่</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="bundle-sku">Bundle SKU</Label>
            <Input
              id="bundle-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="เช่น BUNDLE001"
              className="font-mono"
            />
          </div>

          <div>
            <Label htmlFor="bundle-name">Bundle Name</Label>
            <Input
              id="bundle-name"
              value={bundleName}
              onChange={(e) => setBundleName(e.target.value)}
              placeholder="เช่น ชุดแก้ว + ฝา"
            />
          </div>

          <div>
            <Label htmlFor="bundle-cost">Base Cost Per Unit</Label>
            <Input
              id="bundle-cost"
              type="number"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="0.00"
            />
            <p className="text-xs text-muted-foreground mt-1">
              (Optional: ใส่ต้นทุนรวมของ bundle หรือ 0 ถ้าใช้ต้นทุนจาก components)
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            ยกเลิก
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'กำลังสร้าง...' : 'สร้าง Bundle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
