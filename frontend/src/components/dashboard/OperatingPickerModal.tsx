'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { getOperatingExpenseRows, getOperatingFiltered } from '@/app/(dashboard)/actions'
import type { OperatingExpenseRow } from '@/app/(dashboard)/actions'

interface Props {
  open: boolean
  from: string
  to: string
  initialOperating: number   // server-computed total (used when all rows selected)
  gmv: number
  adSpend: number
  cogs: number
  onApply: (newOperating: number, newNetProfit: number) => void
  onCancel: () => void
}

const PAGE_SIZE = 20

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

function StatusBadge({ status }: { status: 'DRAFT' | 'PAID' }) {
  return status === 'PAID'
    ? <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-xs">จ่ายแล้ว</Badge>
    : <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-xs">รอยืนยัน</Badge>
}

/**
 * OperatingPickerModal — expense-row level picker for the Operating filter.
 *
 * Loads all Operating rows for [from, to] (up to 200). Provides client-side
 * filtering by status, subcategory and search. Checkbox selection per row
 * with Select All Visible / Clear All helpers. Apply calls getOperatingFiltered
 * with the selected IDs; if all rows are selected it uses initialOperating directly.
 */
export function OperatingPickerModal({
  open,
  from,
  to,
  initialOperating,
  gmv,
  adSpend,
  cogs,
  onApply,
  onCancel,
}: Props) {
  // ── Raw data ──────────────────────────────────────────────────────────────
  const [allRows, setAllRows] = useState<OperatingExpenseRow[]>([])
  const [serverTotal, setServerTotal] = useState(0)   // DB total count (may exceed 200)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // ── Filters (applied client-side) ────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<'All' | 'DRAFT' | 'PAID'>('All')
  const [subcatFilter, setSubcatFilter] = useState('All')
  const [searchQ, setSearchQ] = useState('')
  const [page, setPage] = useState(1)

  // ── Selection ────────────────────────────────────────────────────────────
  // selectedIds tracks which expense IDs are currently checked.
  // On load, all IDs are added (default select all).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // ── Apply ─────────────────────────────────────────────────────────────────
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  // ── Load rows on open ────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    loadAllRows()
  }, [open, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadAllRows = async () => {
    setLoading(true)
    setLoadError(null)
    setStatusFilter('All')
    setSubcatFilter('All')
    setSearchQ('')
    setPage(1)
    setApplyError(null)

    const result = await getOperatingExpenseRows({ from, to, pageSize: 200 })
    if (result.success && result.data) {
      setAllRows(result.data.rows)
      setServerTotal(result.data.total)
      // Default: select all loaded rows
      setSelectedIds(new Set(result.data.rows.map((r) => r.id)))
    } else {
      setLoadError(result.error ?? 'ไม่สามารถโหลดข้อมูลได้')
    }
    setLoading(false)
  }

  // ── Client-side filter + pagination ──────────────────────────────────────
  const filteredRows = useMemo(() => {
    return allRows.filter((r) => {
      if (statusFilter !== 'All' && r.expense_status !== statusFilter) return false
      if (subcatFilter !== 'All') {
        const key = r.subcategory ?? ''
        if (key !== subcatFilter) return false
      }
      if (searchQ.trim()) {
        const q = searchQ.trim().toLowerCase()
        if (!(r.description ?? '').toLowerCase().includes(q) &&
            !(r.vendor ?? '').toLowerCase().includes(q) &&
            !(r.subcategory ?? '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [allRows, statusFilter, subcatFilter, searchQ])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Reset to page 1 when filter changes
  useEffect(() => { setPage(1) }, [statusFilter, subcatFilter, searchQ])

  // ── Available subcategories (from loaded rows) ────────────────────────────
  const subcategories = useMemo(() => {
    const s = Array.from(new Set(allRows.map((r) => r.subcategory ?? ''))).filter(Boolean)
    return s.sort()
  }, [allRows])

  // ── Selection helpers ─────────────────────────────────────────────────────
  const isSelected = (id: string) => selectedIds.has(id)

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      filteredRows.forEach((r) => next.add(r.id))
      return next
    })
  }

  const clearAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      filteredRows.forEach((r) => next.delete(r.id))
      return next
    })
  }

  const selectAll = () => setSelectedIds(new Set(allRows.map((r) => r.id)))
  const clearAll = () => setSelectedIds(new Set())

  // Are all *visible* (filtered) rows selected?
  const allVisibleSelected = filteredRows.length > 0 && filteredRows.every((r) => selectedIds.has(r.id))
  const someVisibleSelected = filteredRows.some((r) => selectedIds.has(r.id))

  // Footer display totals (client-side preview)
  const selectedAmount = allRows
    .filter((r) => selectedIds.has(r.id))
    .reduce((s, r) => s + r.amount, 0)

  // ── Apply ─────────────────────────────────────────────────────────────────
  const handleApply = async () => {
    setApplyError(null)
    setApplying(true)

    let newOperating: number

    if (selectedIds.size === 0) {
      // Nothing selected → Operating = 0
      newOperating = 0
    } else if (selectedIds.size === allRows.length && serverTotal <= allRows.length) {
      // All rows selected and we loaded everything → use server initial value (no extra call)
      newOperating = initialOperating
    } else {
      // Partial selection (or loaded rows < total) → ask server for filtered total
      const ids = Array.from(selectedIds)
      const result = await getOperatingFiltered(from, to, ids)
      if (!result.success || result.data === undefined) {
        setApplyError(result.error ?? 'เกิดข้อผิดพลาด')
        setApplying(false)
        return
      }
      newOperating = result.data.total
    }

    const newNetProfit = Math.round((gmv - adSpend - cogs - newOperating) * 100) / 100
    setApplying(false)
    onApply(newOperating, newNetProfit)
  }

  // ── Cancel ────────────────────────────────────────────────────────────────
  const handleCancel = () => {
    setApplyError(null)
    onCancel()
  }

  // ── Truncate long text ────────────────────────────────────────────────────
  const trunc = (s: string | null, n = 40) =>
    !s ? '—' : s.length > n ? s.slice(0, n) + '…' : s

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCancel() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle>Operating — เลือกรายจ่ายที่นับรวม</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            เลือกรายการที่ต้องการนับใน Operating ของช่วง {from} – {to}
          </p>
        </DialogHeader>

        {/* ── Filter bar ── */}
        <div className="px-6 pb-3 border-b shrink-0">
          <div className="flex flex-wrap gap-2 items-center">
            {/* Status */}
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as 'All' | 'DRAFT' | 'PAID')}
            >
              <SelectTrigger className="w-36 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">สถานะ: ทั้งหมด</SelectItem>
                <SelectItem value="DRAFT">รอยืนยัน</SelectItem>
                <SelectItem value="PAID">จ่ายแล้ว</SelectItem>
              </SelectContent>
            </Select>

            {/* Subcategory */}
            <Select value={subcatFilter} onValueChange={setSubcatFilter}>
              <SelectTrigger className="w-44 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">หมวดย่อย: ทั้งหมด</SelectItem>
                {subcategories.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Search */}
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="ค้นหารายการ..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                className="pl-7 h-8 text-sm"
              />
            </div>

            {/* Selection quick actions */}
            <div className="flex gap-1 ml-auto">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={selectAll}>
                เลือกทั้งหมด
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={clearAll}>
                ล้างทั้งหมด
              </Button>
            </div>
          </div>

          {/* Truncation warning */}
          {serverTotal > allRows.length && (
            <p className="text-xs text-amber-600 mt-2">
              ⚠ แสดง {allRows.length} จาก {serverTotal} รายการแรก · รายการที่เกินจะไม่ถูกนับในการเลือกทั้งหมด
            </p>
          )}
        </div>

        {/* ── Table ── */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : loadError ? (
            <p className="py-8 text-center text-sm text-red-600">{loadError}</p>
          ) : filteredRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {allRows.length === 0
                ? 'ไม่มีรายจ่าย Operating ในช่วงวันที่นี้'
                : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 px-2">
                    <Checkbox
                      checked={allVisibleSelected}
                      data-state={someVisibleSelected && !allVisibleSelected ? 'indeterminate' : undefined}
                      onCheckedChange={(c) => c ? selectAllVisible() : clearAllVisible()}
                    />
                  </TableHead>
                  <TableHead className="text-xs">วันที่</TableHead>
                  <TableHead className="text-xs">หมวดย่อย</TableHead>
                  <TableHead className="text-xs">รายการ</TableHead>
                  <TableHead className="text-xs">สถานะ</TableHead>
                  <TableHead className="text-right text-xs">จำนวน (฿)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={`cursor-pointer ${isSelected(row.id) ? '' : 'opacity-50'}`}
                    onClick={() => toggle(row.id)}
                  >
                    <TableCell className="px-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected(row.id)}
                        onCheckedChange={() => toggle(row.id)}
                      />
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDate(row.expense_date)}</TableCell>
                    <TableCell className="text-xs">
                      {row.subcategory
                        ? <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{row.subcategory}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px]">
                      <div className="truncate">{trunc(row.description)}</div>
                      {row.vendor && (
                        <div className="text-muted-foreground truncate">{trunc(row.vendor, 30)}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs"><StatusBadge status={row.expense_status} /></TableCell>
                    <TableCell className="text-right text-xs font-mono">{fmt(row.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* ── Pagination ── */}
        {!loading && !loadError && filteredRows.length > PAGE_SIZE && (
          <div className="px-6 py-2 border-t flex items-center justify-between shrink-0">
            <span className="text-xs text-muted-foreground">
              {filteredRows.length} รายการ · หน้า {safePage}/{totalPages}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline" size="sm" className="h-7 w-7 p-0"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline" size="sm" className="h-7 w-7 p-0"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            เลือก{' '}
            <span className="font-semibold text-foreground">{selectedIds.size}</span>
            {' '}/ {allRows.length} รายการ ·{' '}
            <span className="font-semibold text-blue-600">฿{fmt(selectedAmount)}</span>
            {applyError && (
              <span className="ml-2 text-red-600 text-xs">{applyError}</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCancel} disabled={applying}>
              ยกเลิก
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleApply}
              disabled={applying || loading}
            >
              {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              นำไปใช้
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
