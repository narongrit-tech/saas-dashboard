'use client'

import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Loader2, AlertTriangle } from 'lucide-react'
import { RecentReturn, RETURN_TYPE_LABELS } from '@/types/returns'
import { undoReturn } from '@/app/(dashboard)/returns/actions'
import { useToast } from '@/hooks/use-toast'

interface UndoConfirmModalProps {
  open: boolean
  returnRecord: RecentReturn
  onConfirm: () => void
  onCancel: () => void
}

export function UndoConfirmModal({
  open,
  returnRecord,
  onConfirm,
  onCancel,
}: UndoConfirmModalProps) {
  const { toast } = useToast()
  const [processing, setProcessing] = useState(false)

  const handleConfirm = async () => {
    setProcessing(true)

    const { success, error } = await undoReturn({ return_id: returnRecord.id })

    setProcessing(false)

    if (!success) {
      toast({
        title: 'Error',
        description: error || 'ไม่สามารถ Undo ได้',
        variant: 'destructive',
      })
      return
    }

    toast({
      title: 'Success',
      description: 'Undo สำเร็จ',
    })

    onConfirm()
  }

  // Determine effects based on return_type
  const effects: string[] = []
  if (returnRecord.return_type === 'RETURN_RECEIVED') {
    effects.push('จะลบ stock ที่รับคืนออก (reverse stock movement)')
    effects.push('จะ reverse COGS allocation')
  } else if (returnRecord.return_type === 'REFUND_ONLY') {
    effects.push('จะบันทึก Undo record เท่านั้น (ไม่มีการเปลี่ยนแปลง stock)')
  } else if (returnRecord.return_type === 'CANCEL_BEFORE_SHIP') {
    effects.push('จะบันทึก Undo record เท่านั้น (ไม่มีการเปลี่ยนแปลง stock)')
  }

  return (
    <AlertDialog open={open} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            ยืนยัน Undo การรับคืน
          </AlertDialogTitle>
          <AlertDialogDescription>
            คุณแน่ใจหรือไม่ว่าต้องการ Undo การรับคืนนี้?
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Return Details */}
        <div className="space-y-3 py-4">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Order ID:</span>
              <span className="font-medium">
                {returnRecord.external_order_id || returnRecord.order_id}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">SKU:</span>
              <span className="font-mono font-medium">{returnRecord.sku}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Quantity:</span>
              <Badge>{returnRecord.qty}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Return Type:</span>
              <Badge variant="secondary">
                {RETURN_TYPE_LABELS[returnRecord.return_type]}
              </Badge>
            </div>
          </div>

          {/* Effects */}
          {effects.length > 0 && (
            <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg border border-yellow-200 dark:border-yellow-900">
              <div className="text-sm font-medium mb-2 text-yellow-900 dark:text-yellow-200">
                ผลกระทบจาก Undo:
              </div>
              <ul className="list-disc list-inside space-y-1 text-xs text-yellow-800 dark:text-yellow-300">
                {effects.map((effect, idx) => (
                  <li key={idx}>{effect}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Note */}
          {returnRecord.note && (
            <div className="mt-3 p-2 bg-muted rounded text-xs">
              <div className="font-medium mb-1">Note:</div>
              <div className="text-muted-foreground">{returnRecord.note}</div>
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={processing}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={processing}>
            {processing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                กำลัง Undo...
              </>
            ) : (
              'Confirm Undo'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
