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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react'
import {
  checkSkuRenameEligibility,
  renameInventorySku,
} from '@/app/(dashboard)/inventory/actions'

interface RenameSkuModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentSku: string
  skuType: 'product' | 'bundle'
  onSuccess: () => void
}

export function RenameSkuModal({
  open,
  onOpenChange,
  currentSku,
  skuType,
  onSuccess,
}: RenameSkuModalProps) {
  const [newSku, setNewSku] = useState('')
  const [checking, setChecking] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [eligibilityChecked, setEligibilityChecked] = useState(false)
  const [eligible, setEligible] = useState(false)
  const [reasons, setReasons] = useState<string[]>([])
  const [error, setError] = useState('')

  function handleClose() {
    setNewSku('')
    setEligibilityChecked(false)
    setEligible(false)
    setReasons([])
    setError('')
    onOpenChange(false)
  }

  async function handleCheckEligibility() {
    if (!newSku.trim()) {
      setError('กรุณากรอก SKU ใหม่')
      return
    }

    setChecking(true)
    setError('')

    const result = await checkSkuRenameEligibility(currentSku)

    if (!result.success) {
      setError(result.error || 'เกิดข้อผิดพลาด')
      setEligibilityChecked(false)
      setEligible(false)
    } else {
      setEligibilityChecked(true)
      setEligible(result.data.eligible)
      setReasons(result.data.reasons)
    }

    setChecking(false)
  }

  async function handleRename() {
    if (!eligible) {
      setError('SKU นี้ไม่สามารถ rename ได้')
      return
    }

    setRenaming(true)
    setError('')

    const result = await renameInventorySku(currentSku, newSku.trim())

    if (!result.success) {
      setError(result.error || 'เกิดข้อผิดพลาด')
      setRenaming(false)
    } else {
      alert(`✓ Rename สำเร็จ: ${currentSku} → ${newSku.trim().toUpperCase()}`)
      handleClose()
      onSuccess()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Rename {skuType === 'bundle' ? 'Bundle' : 'Product'} SKU
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current SKU */}
          <div>
            <Label>Current SKU</Label>
            <Input value={currentSku} disabled className="font-mono bg-muted" />
          </div>

          {/* New SKU */}
          <div>
            <Label htmlFor="new-sku">New SKU</Label>
            <Input
              id="new-sku"
              value={newSku}
              onChange={(e) => {
                setNewSku(e.target.value)
                setEligibilityChecked(false)
                setError('')
              }}
              placeholder="Enter new SKU"
              className="font-mono"
              disabled={renaming}
            />
          </div>

          {/* Error */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Eligibility Results */}
          {eligibilityChecked && (
            <Alert variant={eligible ? 'default' : 'destructive'}>
              {eligible ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <AlertDescription>
                <div className="space-y-1">
                  {reasons.map((reason, idx) => (
                    <div key={idx} className="text-sm">
                      {reason}
                    </div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Warning */}
          {!eligibilityChecked && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>คำเตือน:</strong> SKU สามารถ rename ได้เฉพาะเมื่อ
                <strong>ยังไม่เคยถูกใช้งาน</strong> เท่านั้น
                <br />
                (ไม่มี Stock In, ไม่มี COGS Allocations, ไม่มี Sales Orders)
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={checking || renaming}>
            ยกเลิก
          </Button>

          {!eligibilityChecked ? (
            <Button onClick={handleCheckEligibility} disabled={checking || !newSku.trim()}>
              {checking ? 'กำลังตรวจสอบ...' : 'ตรวจสอบความปลอดภัย'}
            </Button>
          ) : eligible ? (
            <Button onClick={handleRename} disabled={renaming}>
              {renaming ? 'กำลัง Rename...' : 'ยืนยัน Rename'}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setEligibilityChecked(false)}>
              ตรวจสอบใหม่
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
