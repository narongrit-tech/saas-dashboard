'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  getSuggestedMatches,
  createManualMatch,
  SuggestedMatch,
} from '@/app/(dashboard)/reconciliation/bank-reconciliation-actions'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { Loader2 } from 'lucide-react'

interface ManualMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bankTransactionId: string
  bankTxnDescription: string
  bankTxnAmount: number
  bankTxnDate: string
  onSuccess?: () => void
}

export default function ManualMatchDialog({
  open,
  onOpenChange,
  bankTransactionId,
  bankTxnDescription,
  bankTxnAmount,
  bankTxnDate,
  onSuccess,
}: ManualMatchDialogProps) {
  const [loading, setLoading] = useState(false)
  const [matching, setMatching] = useState(false)
  const [suggestions, setSuggestions] = useState<SuggestedMatch[]>([])
  const [selectedSuggestion, setSelectedSuggestion] = useState<SuggestedMatch | null>(null)
  const [notes, setNotes] = useState('')
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    if (open) {
      loadSuggestions()
    } else {
      // Reset state when dialog closes
      setSuggestions([])
      setSelectedSuggestion(null)
      setNotes('')
    }
  }, [open, bankTransactionId])

  async function loadSuggestions() {
    setLoading(true)
    const result = await getSuggestedMatches(bankTransactionId)

    if (result.success && result.suggestions) {
      setSuggestions(result.suggestions)
      // Auto-select first suggestion if exact match (score = 100)
      if (result.suggestions.length > 0 && result.suggestions[0].match_score === 100) {
        setSelectedSuggestion(result.suggestions[0])
      }
    } else {
      toast({
        title: 'ข้อผิดพลาด',
        description: result.error || 'ไม่สามารถโหลดข้อมูลแนะนำได้',
        variant: 'destructive',
      })
    }
    setLoading(false)
  }

  async function handleConfirmMatch() {
    if (!selectedSuggestion) {
      toast({
        title: 'กรุณาเลือกรายการ',
        description: 'กรุณาเลือกรายการที่ต้องการจับคู่',
        variant: 'destructive',
      })
      return
    }

    setMatching(true)
    const result = await createManualMatch(
      bankTransactionId,
      selectedSuggestion.entity_type,
      selectedSuggestion.entity_id,
      selectedSuggestion.amount,
      notes || undefined
    )

    if (result.success) {
      toast({
        title: 'สำเร็จ',
        description: 'จับคู่รายการสำเร็จแล้ว',
      })
      router.refresh()
      onSuccess?.()
      onOpenChange(false)
    } else {
      toast({
        title: 'ข้อผิดพลาด',
        description: result.error || 'ไม่สามารถจับคู่ได้',
        variant: 'destructive',
      })
    }
    setMatching(false)
  }

  const entityTypeLabel = {
    settlement: 'Settlement (เงินเข้า)',
    expense: 'Expense (ค่าใช้จ่าย)',
    wallet_topup: 'Wallet Top-up (เติมกระเป๋า)',
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>จับคู่รายการ (Manual Match)</DialogTitle>
          <DialogDescription>
            เลือกรายการที่ต้องการจับคู่กับรายการธนาคารนี้
          </DialogDescription>
        </DialogHeader>

        {/* Bank Transaction Info */}
        <div className="border rounded-lg p-4 bg-muted/50">
          <div className="text-sm font-semibold mb-2">รายการธนาคาร:</div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">วันที่:</span> {bankTxnDate}
            </div>
            <div>
              <span className="text-muted-foreground">จำนวน:</span>{' '}
              <span
                className={`font-semibold ${
                  bankTxnAmount >= 0 ? 'text-green-600' : 'text-red-600'
                }`}
              >
                ฿{Math.abs(bankTxnAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">ประเภท:</span>{' '}
              {bankTxnAmount >= 0 ? 'เงินเข้า' : 'เงินออก'}
            </div>
          </div>
          <div className="text-sm mt-2">
            <span className="text-muted-foreground">รายละเอียด:</span> {bankTxnDescription}
          </div>
        </div>

        {/* Suggested Matches */}
        <div className="space-y-3">
          <div className="text-sm font-semibold">รายการแนะนำ:</div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : suggestions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              ไม่พบรายการที่แนะนำ (ไม่มี exact amount match)
            </div>
          ) : (
            <div className="space-y-2">
              {suggestions.map((suggestion) => (
                <div
                  key={`${suggestion.entity_type}-${suggestion.entity_id}`}
                  className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                    selectedSuggestion?.entity_id === suggestion.entity_id
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedSuggestion(suggestion)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline">{entityTypeLabel[suggestion.entity_type]}</Badge>
                        {suggestion.match_score === 100 && (
                          <Badge variant="default" className="bg-green-600">
                            Exact Match
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm font-medium">{suggestion.description}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {suggestion.date} • ฿
                        {suggestion.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {suggestion.match_reason}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-primary">
                        {suggestion.match_score}%
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <Label htmlFor="match-notes">หมายเหตุ (Optional)</Label>
          <Textarea
            id="match-notes"
            placeholder="เพิ่มหมายเหตุเกี่ยวกับการจับคู่นี้..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={matching}>
            ยกเลิก
          </Button>
          <Button
            onClick={handleConfirmMatch}
            disabled={!selectedSuggestion || matching}
          >
            {matching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                กำลังจับคู่...
              </>
            ) : (
              'ยืนยันการจับคู่'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
