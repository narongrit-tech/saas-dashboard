'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { updateWalletLedgerEntry } from '@/app/(dashboard)/wallets/actions'
import { Wallet, WalletLedger, LedgerEntryType, LedgerDirection } from '@/types/wallets'
import { useToast } from '@/hooks/use-toast'

interface EditLedgerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  wallet: Wallet
  entry: WalletLedger
  onSuccess: () => void
}

export function EditLedgerDialog({
  open,
  onOpenChange,
  wallet,
  entry,
  onSuccess,
}: EditLedgerDialogProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    date: entry.date,
    entry_type: entry.entry_type,
    direction: entry.direction,
    amount: entry.amount.toString(),
    reference_id: entry.reference_id || '',
    note: entry.note || '',
  })

  // Update form data when entry changes
  useEffect(() => {
    setFormData({
      date: entry.date,
      entry_type: entry.entry_type,
      direction: entry.direction,
      amount: entry.amount.toString(),
      reference_id: entry.reference_id || '',
      note: entry.note || '',
    })
  }, [entry])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const result = await updateWalletLedgerEntry(entry.id, {
        date: formData.date,
        entry_type: formData.entry_type,
        direction: formData.direction,
        amount: parseFloat(formData.amount),
        reference_id: formData.reference_id || undefined,
        note: formData.note || undefined,
      })

      if (!result.success) {
        toast({
          title: 'เกิดข้อผิดพลาด',
          description: result.error,
          variant: 'destructive',
        })
        return
      }

      toast({
        title: 'สำเร็จ',
        description: 'แก้ไขรายการสำเร็จ',
      })

      onSuccess()
      onOpenChange(false)
    } catch {
      toast({
        title: 'เกิดข้อผิดพลาด',
        description: 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleEntryTypeChange = (value: LedgerEntryType) => {
    setFormData((prev) => {
      // Auto-set direction based on entry type
      let direction: LedgerDirection = prev.direction

      if (value === 'TOP_UP' || value === 'REFUND') {
        direction = 'IN'
      } else if (value === 'SPEND') {
        direction = 'OUT'
      }
      // ADJUSTMENT can be either IN or OUT, so keep current

      return {
        ...prev,
        entry_type: value,
        direction,
      }
    })
  }

  // Show warning for ADS wallet SPEND
  const showAdsSpendWarning = wallet.wallet_type === 'ADS' && formData.entry_type === 'SPEND'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Wallet Entry</DialogTitle>
          <DialogDescription>
            Edit transaction in {wallet.name}
          </DialogDescription>
        </DialogHeader>

        {entry.source === 'IMPORTED' ? (
          <div className="py-8 text-center">
            <div className="rounded-md bg-yellow-50 p-4 text-sm text-yellow-800">
              <p className="font-semibold">Cannot Edit Imported Entry</p>
              <p className="mt-2">
                This entry was imported from a report file and cannot be edited manually.
                To modify it, update the source file and re-import.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="date">วันที่</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="entry_type">Entry Type</Label>
              <Select
                value={formData.entry_type}
                onValueChange={(value) => handleEntryTypeChange(value as LedgerEntryType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TOP_UP">Top-up (เติมเงิน)</SelectItem>
                  <SelectItem value="SPEND">Spend (ใช้จ่าย)</SelectItem>
                  <SelectItem value="REFUND">Refund (เงินคืน)</SelectItem>
                  <SelectItem value="ADJUSTMENT">Adjustment (ปรับปรุง)</SelectItem>
                </SelectContent>
              </Select>

              {/* Warning for ADS wallet SPEND */}
              {showAdsSpendWarning && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
                  ⚠️ <strong>Warning:</strong> ADS Wallet SPEND entries must be imported from Ads Report only.
                  Manual SPEND creation will be blocked by the system.
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="direction">Direction</Label>
              <Select
                value={formData.direction}
                onValueChange={(value) =>
                  setFormData({ ...formData, direction: value as LedgerDirection })
                }
                disabled={formData.entry_type !== 'ADJUSTMENT'}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN">IN (เข้า)</SelectItem>
                  <SelectItem value="OUT">OUT (ออก)</SelectItem>
                </SelectContent>
              </Select>
              {formData.entry_type !== 'ADJUSTMENT' && (
                <p className="text-xs text-muted-foreground">
                  Direction is auto-set based on entry type
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">จำนวนเงิน (THB)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                placeholder="0.00"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reference_id">Reference ID (optional)</Label>
              <Input
                id="reference_id"
                type="text"
                value={formData.reference_id}
                onChange={(e) => setFormData({ ...formData, reference_id: e.target.value })}
                placeholder="e.g., Transaction ID, Invoice #"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">Note (optional)</Label>
              <Textarea
                id="note"
                value={formData.note}
                onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                placeholder="บันทึกเพิ่มเติม..."
                rows={3}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
