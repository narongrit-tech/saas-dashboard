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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertTriangle, Loader2 } from 'lucide-react'
import {
  previewResetTikTokOrderSkuList,
  resetTikTokOrderSkuList,
  ResetTikTokResult,
} from '@/app/(dashboard)/sales/actions'
import { useToast } from '@/hooks/use-toast'

interface ResetTikTokDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

const CONFIRMATION_PHRASE = 'RESET TIKTOK'

export function ResetTikTokDialog({ open, onOpenChange, onSuccess }: ResetTikTokDialogProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [preview, setPreview] = useState<ResetTikTokResult | null>(null)
  const [understood, setUnderstood] = useState(false)
  const [confirmationText, setConfirmationText] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Load preview when dialog opens
  useEffect(() => {
    if (open) {
      loadPreview()
      // Reset state
      setUnderstood(false)
      setConfirmationText('')
      setError(null)
    }
  }, [open])

  const loadPreview = async () => {
    try {
      setPreviewLoading(true)
      setError(null)
      const result = await previewResetTikTokOrderSkuList()

      if (!result.success) {
        setError(result.error || 'ไม่สามารถโหลด preview ได้')
        toast({
          variant: 'destructive',
          title: 'เกิดข้อผิดพลาด',
          description: result.error || 'ไม่สามารถโหลด preview ได้',
        })
        return
      }

      setPreview(result.data || null)
    } catch (err) {
      console.error('Error loading preview:', err)
      setError('เกิดข้อผิดพลาดในการโหลด preview')
      toast({
        variant: 'destructive',
        title: 'เกิดข้อผิดพลาด',
        description: 'ไม่สามารถโหลด preview ได้',
      })
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleReset = async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await resetTikTokOrderSkuList()

      if (!result.success) {
        setError(result.error || 'ไม่สามารถรีเซ็ตข้อมูลได้')
        toast({
          variant: 'destructive',
          title: 'เกิดข้อผิดพลาด',
          description: result.error || 'ไม่สามารถรีเซ็ตข้อมูลได้',
        })
        return
      }

      // Success
      const data = result.data!
      toast({
        title: 'รีเซ็ตข้อมูลสำเร็จ',
        description: `ลบ ${data.sales_orders_deleted.toLocaleString()} sales orders และ ${data.import_batches_deleted.toLocaleString()} import batches`,
      })

      // Close dialog and trigger refresh
      onOpenChange(false)
      if (onSuccess) {
        onSuccess()
      }
    } catch (err) {
      console.error('Error resetting data:', err)
      setError('เกิดข้อผิดพลาดในการรีเซ็ตข้อมูล')
      toast({
        variant: 'destructive',
        title: 'เกิดข้อผิดพลาด',
        description: 'ไม่สามารถรีเซ็ตข้อมูลได้',
      })
    } finally {
      setLoading(false)
    }
  }

  const isConfirmationValid = understood && confirmationText === CONFIRMATION_PHRASE

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Reset TikTok OrderSKUList Data
          </DialogTitle>
          <DialogDescription>
            การดำเนินการนี้จะลบข้อมูล TikTok OrderSKUList ทั้งหมดออกจากระบบ และไม่สามารถย้อนกลับได้
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Preview Counts */}
          <div className="rounded-md border bg-muted/50 p-4 space-y-2">
            <h4 className="font-medium text-sm">Preview: ข้อมูลที่จะถูกลบ</h4>
            {previewLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                กำลังโหลด...
              </div>
            ) : preview ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-muted-foreground">Sales Orders (Lines):</div>
                  <div className="font-bold text-lg">{preview.sales_orders_before.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Import Batches:</div>
                  <div className="font-bold text-lg">{preview.import_batches_before.toLocaleString()}</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-red-500">ไม่สามารถโหลด preview ได้</div>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950">
              {error}
            </div>
          )}

          {/* Confirmation Checkbox */}
          <div className="flex items-start space-x-2">
            <Checkbox
              id="understand"
              checked={understood}
              onCheckedChange={(checked) => setUnderstood(checked === true)}
              disabled={loading}
            />
            <Label htmlFor="understand" className="text-sm font-normal leading-tight cursor-pointer">
              ฉันเข้าใจว่าการดำเนินการนี้จะลบข้อมูล TikTok OrderSKUList ทั้งหมด และไม่สามารถย้อนกลับได้
            </Label>
          </div>

          {/* Typed Confirmation */}
          <div className="space-y-2">
            <Label htmlFor="confirmation" className="text-sm">
              พิมพ์ <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">{CONFIRMATION_PHRASE}</code> เพื่อยืนยัน
            </Label>
            <Input
              id="confirmation"
              type="text"
              placeholder={CONFIRMATION_PHRASE}
              value={confirmationText}
              onChange={(e) => setConfirmationText(e.target.value)}
              disabled={loading || !understood}
              className="font-mono"
            />
          </div>

          {/* Warning Note */}
          <div className="rounded-md bg-yellow-50 p-3 text-xs text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
            <strong>หมายเหตุ:</strong> หลังจากรีเซ็ตแล้ว คุณสามารถนำเข้าข้อมูล TikTok OrderSKUList ใหม่ได้ทันที
            ระบบจะตรวจสอบ deduplication ตามปกติ
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            ยกเลิก
          </Button>
          <Button
            variant="destructive"
            onClick={handleReset}
            disabled={loading || !isConfirmationValid || !preview}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                กำลังรีเซ็ต...
              </>
            ) : (
              'รีเซ็ตข้อมูล'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
