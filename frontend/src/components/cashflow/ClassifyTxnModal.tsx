'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Loader2 } from 'lucide-react'
import { upsertNodeClassification } from '@/app/(dashboard)/cashflow/source-flow/actions'
import { useToast } from '@/hooks/use-toast'
import type { SankeyTxnRow, InflowSource, OutflowCategory } from '@/types/cashflow-sankey'
import { INFLOW_SOURCE_LABELS, OUTFLOW_CATEGORY_LABELS } from '@/types/cashflow-sankey'

type Direction = 'inflow' | 'outflow' | 'clear'

interface Props {
  txn: SankeyTxnRow | null
  /** Controlled open state. When omitted, modal derives open from txn !== null. */
  open?: boolean
  /** Called with { success } after a successful save via onSave alias. */
  onSave?: (result: { success: boolean }) => void
  /** Alias used by CeoFlowClient — called after a successful save (no args). */
  onSaved?: () => void
  onClose: () => void
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function ClassifyTxnModal({ txn, open, onSave, onSaved, onClose }: Props) {
  const { toast } = useToast()

  const getInitialDirection = (): Direction => {
    if (!txn) return 'inflow'
    if (txn.inflow_source) return 'inflow'
    if (txn.outflow_category) return 'outflow'
    if (txn.deposit > 0) return 'inflow'
    return 'outflow'
  }

  const [direction, setDirection] = useState<Direction>(getInitialDirection)
  const [inflowSource, setInflowSource] = useState<InflowSource | ''>(
    txn?.inflow_source ?? '',
  )
  const [outflowCategory, setOutflowCategory] = useState<OutflowCategory | ''>(
    txn?.outflow_category ?? '',
  )
  const [outflowSub, setOutflowSub] = useState<string>(txn?.outflow_sub ?? '')
  const [note, setNote] = useState<string>(txn?.note ?? '')
  const [saving, setSaving] = useState(false)

  const isOpen = open !== undefined ? open : !!txn

  if (!txn) return null

  const handleDirectionChange = (val: string) => {
    setDirection(val as Direction)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      let params: Parameters<typeof upsertNodeClassification>[0] = {
        bank_transaction_id: txn.id,
        inflow_source: null,
        outflow_category: null,
        outflow_sub: null,
        note: note || null,
      }

      if (direction === 'inflow' && inflowSource) {
        params = { ...params, inflow_source: inflowSource }
      } else if (direction === 'outflow' && outflowCategory) {
        params = {
          ...params,
          outflow_category: outflowCategory,
          outflow_sub: outflowSub || null,
        }
      } else if (direction === 'clear') {
        params = {
          ...params,
          inflow_source: null,
          outflow_category: null,
          outflow_sub: null,
          note: null,
        }
      }

      const result = await upsertNodeClassification(params)
      if (result.success) {
        toast({ title: 'บันทึกสำเร็จ', description: 'จัดประเภทธุรกรรมเรียบร้อยแล้ว' })
        onSave?.({ success: true })
        onSaved?.()
      } else {
        toast({
          variant: 'destructive',
          title: 'เกิดข้อผิดพลาด',
          description: result.error ?? 'ไม่สามารถบันทึกได้',
        })
        onSave?.({ success: false })
      }
    } catch {
      toast({ variant: 'destructive', title: 'เกิดข้อผิดพลาดที่ไม่คาดคิด' })
      onSave?.({ success: false })
    } finally {
      setSaving(false)
    }
  }

  const canSave =
    direction === 'clear' ||
    (direction === 'inflow' && inflowSource !== '') ||
    (direction === 'outflow' && outflowCategory !== '')

  return (
    <Dialog open={isOpen} onOpenChange={(isDialogOpen) => { if (!isDialogOpen) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>จัดประเภทธุรกรรม</DialogTitle>
        </DialogHeader>

        {/* Transaction summary */}
        <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
          <p className="font-medium truncate">{txn.description || '(ไม่มีรายละเอียด)'}</p>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>{txn.txn_date}</span>
            <span>{txn.bank_name}</span>
          </div>
          <div className="flex items-center gap-2">
            {txn.deposit > 0 && (
              <span className="font-mono text-green-600">
                +฿{formatCurrency(txn.deposit)}
              </span>
            )}
            {txn.withdrawal > 0 && (
              <span className="font-mono text-red-600">
                -฿{formatCurrency(txn.withdrawal)}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {/* Direction */}
          <div className="space-y-2">
            <Label>ทิศทาง</Label>
            <RadioGroup value={direction} onValueChange={handleDirectionChange}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="inflow" id="dir-inflow" />
                <Label htmlFor="dir-inflow" className="cursor-pointer">Inflow (เงินเข้า)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="outflow" id="dir-outflow" />
                <Label htmlFor="dir-outflow" className="cursor-pointer">Outflow (เงินออก)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="clear" id="dir-clear" />
                <Label htmlFor="dir-clear" className="cursor-pointer">Clear classification</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Inflow source */}
          {direction === 'inflow' && (
            <div className="space-y-2">
              <Label>แหล่งเงินเข้า</Label>
              <Select
                value={inflowSource}
                onValueChange={(val) => setInflowSource(val as InflowSource)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="เลือกแหล่งเงินเข้า" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(INFLOW_SOURCE_LABELS) as [InflowSource, string][]).map(
                    ([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Outflow category */}
          {direction === 'outflow' && (
            <>
              <div className="space-y-2">
                <Label>หมวดหมู่เงินออก</Label>
                <Select
                  value={outflowCategory}
                  onValueChange={(val) => setOutflowCategory(val as OutflowCategory)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกหมวดหมู่" />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.entries(OUTFLOW_CATEGORY_LABELS) as [OutflowCategory, string][]
                    ).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sub label (ไม่บังคับ)</Label>
                <input
                  type="text"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="เช่น ค่าจ้างพนักงาน, ค่าน้ำมัน"
                  value={outflowSub}
                  onChange={(e) => setOutflowSub(e.target.value)}
                />
              </div>
            </>
          )}

          {/* Note */}
          {direction !== 'clear' && (
            <div className="space-y-2">
              <Label>หมายเหตุ (ไม่บังคับ)</Label>
              <Textarea
                placeholder="หมายเหตุเพิ่มเติม"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            ยกเลิก
          </Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            บันทึก
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
