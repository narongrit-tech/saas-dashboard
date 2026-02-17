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
import { Loader2, AlertTriangle } from 'lucide-react'

interface BulkDeleteConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  loading: boolean
  count: number
  amount: number
  blockedCount?: number
  blockedReason?: string
}

export function BulkDeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
  count,
  amount,
  blockedCount = 0,
  blockedReason,
}: BulkDeleteConfirmDialogProps) {
  const [confirmText, setConfirmText] = useState('')
  const requiredText = `DELETE ${count}`
  const isConfirmValid = confirmText === requiredText

  const formatCurrency = (value: number) => {
    return value.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  const handleConfirm = () => {
    if (isConfirmValid) {
      onConfirm()
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setConfirmText('') // Reset on close
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <DialogTitle>ยืนยันการลบรายการค่าใช้จ่าย (Bulk)</DialogTitle>
          </div>
          <DialogDescription className="pt-2 space-y-2">
            <p>คุณกำลังจะลบ <strong className="text-foreground">{count} รายการ</strong></p>
            <p>
              มูลค่ารวม: <strong className="text-red-600">฿{formatCurrency(amount)}</strong>
            </p>

            {blockedCount > 0 && (
              <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-sm">
                <p className="font-medium text-yellow-800">
                  มี {blockedCount} รายการที่ไม่สามารถลบได้
                </p>
                {blockedReason && (
                  <p className="text-yellow-700 mt-1">{blockedReason}</p>
                )}
              </div>
            )}

            <p className="text-destructive font-medium mt-4">
              การดำเนินการนี้ไม่สามารถย้อนกลับได้!
            </p>

            <div className="mt-4 space-y-2">
              <p className="text-sm">
                กรุณาพิมพ์ <code className="bg-muted px-2 py-1 rounded text-foreground font-mono">{requiredText}</code> เพื่อยืนยัน:
              </p>
              <Input
                placeholder={requiredText}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                disabled={loading}
                className="font-mono"
              />
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading || !isConfirmValid}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                กำลังลบ...
              </>
            ) : (
              'ลบทั้งหมด'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
