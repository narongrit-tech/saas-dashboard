'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
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
import {
  getOperatingExpenseRows,
  getOperatingFiltered,
  getOperatingSubcategories,
} from '@/app/(dashboard)/actions'
import type { OperatingExpenseRow, OperatingFilterPayload } from '@/app/(dashboard)/actions'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  from: string
  to: string
  initialOperating: number  // server total for the full range (shortcut for "select all, no filter")
  gmv: number
  adSpend: number
  cogs: number
  onApply: (newOperating: number, newNetProfit: number) => void
  onCancel: () => void
}

type StatusFilter = 'All' | 'DRAFT' | 'PAID'
type PageSize = 10 | 25 | 50 | 100
const PAGE_SIZES: PageSize[] = [10, 25, 50, 100]

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function StatusBadge({ status }: { status: 'DRAFT' | 'PAID' }) {
  return status === 'PAID' ? (
    <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-xs">
      จ่ายแล้ว
    </Badge>
  ) : (
    <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-xs">
      รอยืนยัน
    </Badge>
  )
}

// ─── Component ─────────────────────────────────────────────────────────────────

/**
 * OperatingPickerModal — row-level expense picker with server-side pagination.
 *
 * Pagination: page/pageSize sent to server; supports 10/25/50/100 rows/page.
 * Selection model: selectAll + excludedIds  OR  explicit selectedIds.
 *   - "เลือกทั้งหมด" → selectAll=true, excludedIds cleared (all rows across all pages)
 *   - "ล้างทั้งหมด"  → selectAll=false, selectedIds cleared
 *   - Row toggle    → if selectAll: add/remove from excludedIds
 *                     else: add/remove from selectedIds
 * Apply payload:
 *   - selectAll=true  → mode:'all', sends excludedIds + current filters to server
 *   - selectAll=false → mode:'ids', sends selectedIds to server
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
  // ── Server-fetched data ───────────────────────────────────────────────────
  const [rows, setRows] = useState<OperatingExpenseRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [subcategories, setSubcategories] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // ── Pagination ────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(25)

  // ── Filters ───────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')
  const [subcatFilter, setSubcatFilter] = useState('All')
  const [searchQ, setSearchQ] = useState('')

  // ── Selection: selectAll + excludedIds  OR  explicit selectedIds ──────────
  const [selectAll, setSelectAll] = useState(true)
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // ── Apply ─────────────────────────────────────────────────────────────────
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  // ── Debounce timer for search input ───────────────────────────────────────
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Core page fetcher (explicit params — no stale closure issues) ─────────
  const fetchPage = useCallback(
    async (opts: { p: number; ps: number; status: StatusFilter; subcat: string; q: string }) => {
      setLoading(true)
      setLoadError(null)
      const result = await getOperatingExpenseRows({
        from,
        to,
        status: opts.status !== 'All' ? opts.status : undefined,
        subcategory: opts.subcat !== 'All' ? opts.subcat : undefined,
        q: opts.q.trim() || undefined,
        page: opts.p,
        pageSize: opts.ps,
      })
      if (result.success && result.data) {
        setRows(result.data.rows)
        setTotalCount(result.data.total)
      } else {
        setLoadError(result.error ?? 'ไม่สามารถโหลดข้อมูลได้')
      }
      setLoading(false)
    },
    [from, to]
  )

  // ── Full reset + initial load when modal opens ────────────────────────────
  useEffect(() => {
    if (!open) return

    // Reset all state to defaults
    setPage(1)
    setPageSize(25)
    setStatusFilter('All')
    setSubcatFilter('All')
    setSearchQ('')
    setSelectAll(true)
    setExcludedIds(new Set())
    setSelectedIds(new Set())
    setRows([])
    setTotalCount(0)
    setLoadError(null)
    setApplyError(null)

    // Load subcategories (once per open)
    getOperatingSubcategories(from, to).then((r) => {
      if (r.success && r.data) setSubcategories(r.data)
    })

    // Load first page with default params
    fetchPage({ p: 1, ps: 25, status: 'All', subcat: 'All', q: '' })
  }, [open, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  // ── Filter change handlers (always reset to page 1) ───────────────────────

  const changeStatus = (v: StatusFilter) => {
    setStatusFilter(v)
    setPage(1)
    if (selectAll) setExcludedIds(new Set()) // filter change redefines "all"
    fetchPage({ p: 1, ps: pageSize, status: v, subcat: subcatFilter, q: searchQ })
  }

  const changeSubcat = (v: string) => {
    setSubcatFilter(v)
    setPage(1)
    if (selectAll) setExcludedIds(new Set())
    fetchPage({ p: 1, ps: pageSize, status: statusFilter, subcat: v, q: searchQ })
  }

  const changeSearch = (v: string) => {
    setSearchQ(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setPage(1)
      if (selectAll) setExcludedIds(new Set())
      fetchPage({ p: 1, ps: pageSize, status: statusFilter, subcat: subcatFilter, q: v })
    }, 400)
  }

  const goToPage = (n: number) => {
    setPage(n)
    fetchPage({ p: n, ps: pageSize, status: statusFilter, subcat: subcatFilter, q: searchQ })
  }

  const changePageSize = (ps: PageSize) => {
    setPageSize(ps)
    setPage(1)
    fetchPage({ p: 1, ps, status: statusFilter, subcat: subcatFilter, q: searchQ })
  }

  // ── Selection logic ───────────────────────────────────────────────────────

  /** Is a given row currently selected? */
  const isChecked = (id: string) =>
    selectAll ? !excludedIds.has(id) : selectedIds.has(id)

  /** Toggle a single row */
  const toggleRow = (id: string) => {
    if (selectAll) {
      setExcludedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }
  }

  /** "เลือกทั้งหมด" — all rows across ALL pages */
  const handleSelectAll = () => {
    setSelectAll(true)
    setExcludedIds(new Set())
    setSelectedIds(new Set())
  }

  /** "ล้างทั้งหมด" */
  const handleClearAll = () => {
    setSelectAll(false)
    setExcludedIds(new Set())
    setSelectedIds(new Set())
  }

  /** Header checkbox: selects / deselects the CURRENT PAGE only */
  const allPageSelected = rows.length > 0 && rows.every((r) => isChecked(r.id))
  const somePageSelected = rows.some((r) => isChecked(r.id))

  const togglePage = () => {
    if (allPageSelected) {
      // Deselect current page
      if (selectAll) {
        setExcludedIds((prev) => { const n = new Set(prev); rows.forEach((r) => n.add(r.id)); return n })
      } else {
        setSelectedIds((prev) => { const n = new Set(prev); rows.forEach((r) => n.delete(r.id)); return n })
      }
    } else {
      // Select current page
      if (selectAll) {
        setExcludedIds((prev) => { const n = new Set(prev); rows.forEach((r) => n.delete(r.id)); return n })
      } else {
        setSelectedIds((prev) => { const n = new Set(prev); rows.forEach((r) => n.add(r.id)); return n })
      }
    }
  }

  /** Display count shown in footer */
  const selectionCount = selectAll
    ? Math.max(0, totalCount - excludedIds.size)
    : selectedIds.size

  // ── Apply ─────────────────────────────────────────────────────────────────

  const handleApply = async () => {
    setApplying(true)
    setApplyError(null)

    // Short-circuit: selectAll with no filters and no exclusions → use initialOperating
    if (
      selectAll &&
      excludedIds.size === 0 &&
      statusFilter === 'All' &&
      subcatFilter === 'All' &&
      !searchQ.trim()
    ) {
      const newNet = Math.round((gmv - adSpend - cogs - initialOperating) * 100) / 100
      setApplying(false)
      onApply(initialOperating, newNet)
      return
    }

    // Short-circuit: nothing selected → 0
    if (!selectAll && selectedIds.size === 0) {
      const newNet = Math.round((gmv - adSpend - cogs) * 100) / 100
      setApplying(false)
      onApply(0, newNet)
      return
    }

    // Build payload
    const payload: OperatingFilterPayload = selectAll
      ? {
          mode: 'all',
          excludedIds: Array.from(excludedIds),
          status: statusFilter !== 'All' ? statusFilter : undefined,
          subcategory: subcatFilter !== 'All' ? subcatFilter : undefined,
          q: searchQ.trim() || undefined,
        }
      : {
          mode: 'ids',
          selectedIds: Array.from(selectedIds),
        }

    const result = await getOperatingFiltered(from, to, payload)
    if (!result.success || result.data === undefined) {
      setApplyError(result.error ?? 'เกิดข้อผิดพลาด')
      setApplying(false)
      return
    }

    const newOp = result.data.total
    const newNet = Math.round((gmv - adSpend - cogs - newOp) * 100) / 100
    setApplying(false)
    onApply(newOp, newNet)
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  const handleCancel = () => {
    setApplyError(null)
    onCancel()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const trunc = (s: string | null, n = 40) =>
    !s ? '—' : s.length > n ? s.slice(0, n) + '…' : s

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCancel() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">

        {/* ── Header ── */}
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle>Operating — เลือกรายจ่ายที่นับรวม</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            ช่วงวันที่ {from} – {to} · ทั้งหมด{' '}
            <span className="font-medium text-foreground">{totalCount}</span> รายการ
          </p>
        </DialogHeader>

        {/* ── Filter bar ── */}
        <div className="px-6 pb-3 border-b shrink-0">
          <div className="flex flex-wrap gap-2 items-center">

            {/* Status */}
            <Select value={statusFilter} onValueChange={(v) => changeStatus(v as StatusFilter)}>
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
            <Select value={subcatFilter} onValueChange={changeSubcat}>
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
                defaultValue={searchQ}
                onChange={(e) => changeSearch(e.target.value)}
                className="pl-7 h-8 text-sm"
              />
            </div>

            {/* Select all / Clear all — across ALL pages */}
            <div className="flex gap-1 ml-auto shrink-0">
              <Button
                variant={selectAll && excludedIds.size === 0 ? 'default' : 'outline'}
                size="sm"
                className="h-8 text-xs"
                onClick={handleSelectAll}
              >
                เลือกทั้งหมด
              </Button>
              <Button
                variant={!selectAll && selectedIds.size === 0 ? 'default' : 'outline'}
                size="sm"
                className="h-8 text-xs"
                onClick={handleClearAll}
              >
                ล้างทั้งหมด
              </Button>
            </div>
          </div>
        </div>

        {/* ── Table ── */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : loadError ? (
            <p className="py-8 text-center text-sm text-red-600">{loadError}</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {totalCount === 0
                ? 'ไม่มีรายจ่าย Operating ในช่วงวันที่นี้'
                : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 px-2">
                    <Checkbox
                      checked={allPageSelected}
                      data-state={
                        somePageSelected && !allPageSelected ? 'indeterminate' : undefined
                      }
                      onCheckedChange={togglePage}
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
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={`cursor-pointer ${isChecked(row.id) ? '' : 'opacity-50'}`}
                    onClick={() => toggleRow(row.id)}
                  >
                    <TableCell className="px-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isChecked(row.id)}
                        onCheckedChange={() => toggleRow(row.id)}
                      />
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {fmtDate(row.expense_date)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.subcategory ? (
                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                          {row.subcategory}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px]">
                      <div className="truncate">{trunc(row.description)}</div>
                      {row.vendor && (
                        <div className="text-muted-foreground truncate text-xs">
                          {trunc(row.vendor, 30)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <StatusBadge status={row.expense_status} />
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono">
                      {fmt(row.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* ── Pagination ── */}
        {!loading && !loadError && totalCount > 0 && (
          <div className="px-6 py-2 border-t flex items-center justify-between gap-2 shrink-0 flex-wrap">
            {/* Page size selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">แสดง</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => changePageSize(Number(v) as PageSize)}
              >
                <SelectTrigger className="w-20 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((ps) => (
                    <SelectItem key={ps} value={String(ps)}>{ps} รายการ</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                · หน้า {page}/{totalPages} ({totalCount} รายการ)
              </span>
            </div>

            {/* Prev / Next */}
            <div className="flex gap-1">
              <Button
                variant="outline" size="sm" className="h-7 w-7 p-0"
                disabled={page <= 1 || loading}
                onClick={() => goToPage(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline" size="sm" className="h-7 w-7 p-0"
                disabled={page >= totalPages || loading}
                onClick={() => goToPage(page + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-muted-foreground">
            {selectAll ? (
              <>
                เลือกทั้งหมด{' '}
                <span className="font-semibold text-foreground">{selectionCount}</span> รายการ
                {excludedIds.size > 0 && (
                  <span className="text-amber-600 ml-1">({excludedIds.size} ยกเว้น)</span>
                )}
              </>
            ) : (
              <>
                เลือก{' '}
                <span className="font-semibold text-foreground">{selectionCount}</span>
                {' '}/ {totalCount} รายการ
              </>
            )}
            {applyError && (
              <span className="ml-2 text-xs text-red-600">{applyError}</span>
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
