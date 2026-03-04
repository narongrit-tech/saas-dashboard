'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { DollarSign, TrendingUp, TrendingDown, Loader2 } from 'lucide-react'
import { getOperatingOptions, getOperatingFiltered } from '@/app/(dashboard)/actions'
import type { OperatingOption } from '@/app/(dashboard)/actions'

interface Props {
  initialOperating: number
  initialNetProfit: number
  gmv: number
  adSpend: number
  cogs: number
  from: string
  to: string
  /** Non-null when URL contains ?opSubcats=... — pre-selects those subcategories in the modal */
  initialSelectedSubcats: string[] | null
}

function fmt(amount: number): string {
  return amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Renders the Operating card (clickable → filter modal) and Net Profit card
 * as a React Fragment so they slot naturally into the parent summary grid.
 *
 * State is managed locally; Apply also updates URL params (?opSubcats=...)
 * so server re-render keeps the P&L breakdown in sync.
 */
export function OperatingNetCards({
  initialOperating,
  initialNetProfit,
  gmv,
  adSpend,
  cogs,
  from,
  to,
  initialSelectedSubcats,
}: Props) {
  const router = useRouter()

  // ── Card display state ────────────────────────────────────────────────────
  const [currentOperating, setCurrentOperating] = useState(initialOperating)
  const [currentNetProfit, setCurrentNetProfit] = useState(initialNetProfit)

  // ── Modal state ───────────────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false)
  const [options, setOptions] = useState<OperatingOption[]>([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [optionsError, setOptionsError] = useState<string | null>(null)

  // null = all selected (no filter); Set = explicit selection
  const [selectedSubcats, setSelectedSubcats] = useState<Set<string> | null>(
    initialSelectedSubcats ? new Set(initialSelectedSubcats) : null
  )
  // Pending draft selection while modal is open (reverted on Cancel)
  const [draftSubcats, setDraftSubcats] = useState<Set<string> | null>(null)

  const [applying, setApplying] = useState(false)

  const isProfit = currentNetProfit >= 0
  const isFiltered = selectedSubcats !== null

  // ── Helpers ───────────────────────────────────────────────────────────────
  const isDraftChecked = (subcategory: string): boolean => {
    if (draftSubcats === null) return true
    return draftSubcats.has(subcategory)
  }

  const checkedCount = draftSubcats === null ? options.length : draftSubcats.size

  // ── Open modal + lazy-load options ────────────────────────────────────────
  const openModal = useCallback(async () => {
    // Init draft from current committed selection
    setDraftSubcats(selectedSubcats === null ? null : new Set(selectedSubcats))
    setModalOpen(true)

    if (options.length === 0) {
      setOptionsLoading(true)
      setOptionsError(null)
      const result = await getOperatingOptions(from, to)
      if (result.success && result.data) {
        setOptions(result.data)
      } else {
        setOptionsError(result.error ?? 'ไม่สามารถโหลดตัวเลือกได้')
      }
      setOptionsLoading(false)
    }
  }, [from, to, options.length, selectedSubcats])

  // ── Checkbox toggle ───────────────────────────────────────────────────────
  const handleToggle = (subcategory: string, checked: boolean) => {
    setDraftSubcats((prev) => {
      // If currently "all selected", expand to full explicit set first
      const base = prev === null ? new Set(options.map((o) => o.subcategory)) : new Set(prev)
      if (checked) {
        base.add(subcategory)
      } else {
        base.delete(subcategory)
      }
      return base
    })
  }

  const handleSelectAll = () => setDraftSubcats(null)
  const handleClearAll = () => setDraftSubcats(new Set())

  // ── Apply ─────────────────────────────────────────────────────────────────
  const handleApply = async () => {
    setApplying(true)
    // Determine subcategory list for the server action
    // null draft → empty array (server treats [] as "all")
    const subcats = draftSubcats === null ? [] : Array.from(draftSubcats)

    const result = await getOperatingFiltered(from, to, subcats)
    if (result.success && result.data) {
      const newOp = result.data.total
      const newNet = Math.round((gmv - adSpend - cogs - newOp) * 100) / 100
      setCurrentOperating(newOp)
      setCurrentNetProfit(newNet)

      // Commit draft to committed selection
      setSelectedSubcats(draftSubcats)

      // Sync URL params so server re-render keeps P&L breakdown consistent
      const params = new URLSearchParams(window.location.search)
      if (subcats.length === 0) {
        params.delete('opSubcats')
      } else {
        params.set('opSubcats', subcats.map(encodeURIComponent).join(','))
      }
      router.replace(`?${params.toString()}`, { scroll: false })
    }
    setApplying(false)
    setModalOpen(false)
  }

  // ── Cancel ────────────────────────────────────────────────────────────────
  const handleCancel = () => {
    setDraftSubcats(null)
    setModalOpen(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Operating Card — clickable */}
      <Card
        className="cursor-pointer hover:shadow-md transition-shadow select-none"
        onClick={openModal}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Operating (ช่วงที่เลือก){isFiltered ? ' ✎' : ''}
          </CardTitle>
          <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
            <DollarSign className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600">฿{fmt(currentOperating)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {isFiltered
              ? `กรองแล้ว · คลิกเพื่อแก้ไขตัวกรอง`
              : 'ค่าดำเนินงาน · คลิกเพื่อกรองหมวดย่อย'}
          </p>
        </CardContent>
      </Card>

      {/* Net Profit Card */}
      <Card className={isProfit ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Net Profit (ช่วงที่เลือก)</CardTitle>
          <div className={`rounded-lg p-2 ${isProfit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {isProfit ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          </div>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${isProfit ? 'text-green-700' : 'text-red-700'}`}>
            {isProfit ? '' : '-'}฿{fmt(Math.abs(currentNetProfit))}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {isProfit ? '✓ กำไร' : '✗ ขาดทุน'} · GMV - Ads - COGS - Operating
          </p>
        </CardContent>
      </Card>

      {/* Filter Modal */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) handleCancel() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Operating (เลือกค่าใช้จ่ายที่นับรวม)</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground -mt-2">
            เลือกเฉพาะรายการที่ต้องการนับรวมใน Operating ของช่วงวันที่นี้
          </p>

          {/* Loading */}
          {optionsLoading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Error */}
          {!optionsLoading && optionsError && (
            <p className="py-4 text-sm text-red-600 text-center">{optionsError}</p>
          )}

          {/* Empty state */}
          {!optionsLoading && !optionsError && options.length === 0 && (
            <p className="py-8 text-sm text-muted-foreground text-center">
              ไม่มีรายจ่าย Operating ในช่วงวันที่นี้
            </p>
          )}

          {/* Checkbox list */}
          {!optionsLoading && !optionsError && options.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleSelectAll}>
                    เลือกทั้งหมด
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleClearAll}>
                    ล้างทั้งหมด
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">
                  {checkedCount}/{options.length} รายการ
                </span>
              </div>

              <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {options.map((option) => (
                  <label
                    key={option.subcategory}
                    className="flex items-center gap-3 px-2 py-2 rounded hover:bg-muted cursor-pointer"
                  >
                    <Checkbox
                      checked={isDraftChecked(option.subcategory)}
                      onCheckedChange={(checked) =>
                        handleToggle(option.subcategory, checked === true)
                      }
                    />
                    <div className="flex flex-1 items-center justify-between min-w-0">
                      <span className="text-sm truncate">{option.label}</span>
                      <span className="text-sm text-muted-foreground font-mono ml-3 shrink-0">
                        ฿{fmt(option.amount)}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleCancel} disabled={applying}>
              ยกเลิก
            </Button>
            <Button
              onClick={handleApply}
              disabled={applying || optionsLoading || !!optionsError}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              นำไปใช้
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
