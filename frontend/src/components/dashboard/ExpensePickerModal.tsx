'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  getExpensePickerRows,
  getExpensePickerTotal,
  getExpensePickerSubcategories,
  getExpensePickerCategories,
} from '@/app/(dashboard)/actions'
import type { ExpensePickerRow } from '@/app/(dashboard)/actions'
import type { ExpensePickerState, PickerStatus, PickerPageSize } from '@/lib/expense-picker'
import { PICKER_PAGE_SIZES } from '@/lib/expense-picker'

interface Props {
  open: boolean
  title: string
  from: string
  to: string
  /** Server-parsed initial state from URL params (restores picker on reopen). */
  initialState: ExpensePickerState
  /** Server-computed total for initialState (used to avoid extra round-trip on Apply). */
  initialTotal: number
  /** Other picker's current total — for computing Net Profit preview in footer. */
  otherTotal: number
  gmv: number
  adSpend: number
  cogs: number
  /** Called with the final state + server-computed total when user clicks Apply. */
  onApplyState: (newState: ExpensePickerState, newTotal: number) => void
  onCancel: () => void
}

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

function StatusBadge({ status }: { status: 'DRAFT' | 'PAID' }) {
  return status === 'PAID' ? (
    <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-xs">จ่ายแล้ว</Badge>
  ) : (
    <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-xs">รอยืนยัน</Badge>
  )
}

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    Operating: 'bg-blue-50 text-blue-700',
    Tax: 'bg-rose-50 text-rose-700',
    Advertising: 'bg-purple-50 text-purple-700',
    COGS: 'bg-orange-50 text-orange-700',
  }
  const cls = colors[category] ?? 'bg-gray-100 text-gray-700'
  return <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{category}</span>
}

export function ExpensePickerModal({
  open, title, from, to,
  initialState, initialTotal,
  otherTotal, gmv, adSpend, cogs,
  onApplyState, onCancel,
}: Props) {
  // ── Server-fetched data ───────────────────────────────────────────────────
  const [rows, setRows] = useState<ExpensePickerRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [subcategories, setSubcategories] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // ── Pagination ────────────────────────────────────────────────────────────
  const [page, setPage] = useState(initialState.page)
  const [pageSize, setPageSize] = useState<PickerPageSize>(initialState.pageSize)

  // ── Filters ───────────────────────────────────────────────────────────────
  const [categoryFilter, setCategoryFilter] = useState(initialState.category)
  const [statusFilter, setStatusFilter] = useState<PickerStatus>(initialState.status)
  const [subcatFilter, setSubcatFilter] = useState(initialState.subcategory)
  const [searchQ, setSearchQ] = useState(initialState.q)

  // ── Selection: selectAll + excludedIds  OR  explicit selectedIds ──────────
  const [selectAll, setSelectAll] = useState(initialState.mode === 'all')
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set(initialState.excludedIds))
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialState.selectedIds))

  // ── Apply state ───────────────────────────────────────────────────────────
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Core fetcher (explicit params — no stale closures) ────────────────────
  const fetchPage = useCallback(
    async (opts: { p: number; ps: number; cat: string; status: PickerStatus; subcat: string; q: string }) => {
      setLoading(true)
      setLoadError(null)
      const result = await getExpensePickerRows({
        from, to,
        category: opts.cat !== 'ALL' ? opts.cat : undefined,
        status: opts.status !== 'All' ? opts.status : undefined,
        subcategory: opts.subcat !== 'ALL' ? opts.subcat : undefined,
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
    [from, to],
  )

  // ── Initialize + load when modal opens ───────────────────────────────────
  // Restore from initialState (URL-persisted).
  useEffect(() => {
    if (!open) return

    const s = initialState
    setPage(s.page)
    setPageSize(s.pageSize)
    setCategoryFilter(s.category)
    setStatusFilter(s.status)
    setSubcatFilter(s.subcategory)
    setSearchQ(s.q)
    setSelectAll(s.mode === 'all')
    setExcludedIds(new Set(s.excludedIds))
    setSelectedIds(new Set(s.selectedIds))
    setRows([])
    setTotalCount(0)
    setLoadError(null)
    setApplyError(null)

    // Load categories + subcategories (once per open)
    getExpensePickerCategories(from, to).then((r) => {
      if (r.success && r.data) setCategories(r.data)
    })
    getExpensePickerSubcategories(from, to, s.category !== 'ALL' ? s.category : undefined).then((r) => {
      if (r.success && r.data) setSubcategories(r.data)
    })

    // Load initial page
    fetchPage({ p: s.page, ps: s.pageSize, cat: s.category, status: s.status, subcat: s.subcategory, q: s.q })
  }, [open, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  // ── Filter change helpers ─────────────────────────────────────────────────
  const changeCategory = (v: string) => {
    setCategoryFilter(v)
    setSubcatFilter('ALL')
    setPage(1)
    if (selectAll) setExcludedIds(new Set())
    // Reload subcategories for new category
    getExpensePickerSubcategories(from, to, v !== 'ALL' ? v : undefined).then((r) => {
      if (r.success && r.data) setSubcategories(r.data)
    })
    fetchPage({ p: 1, ps: pageSize, cat: v, status: statusFilter, subcat: 'ALL', q: searchQ })
  }

  const changeStatus = (v: PickerStatus) => {
    setStatusFilter(v)
    setPage(1)
    if (selectAll) setExcludedIds(new Set())
    fetchPage({ p: 1, ps: pageSize, cat: categoryFilter, status: v, subcat: subcatFilter, q: searchQ })
  }

  const changeSubcat = (v: string) => {
    setSubcatFilter(v)
    setPage(1)
    if (selectAll) setExcludedIds(new Set())
    fetchPage({ p: 1, ps: pageSize, cat: categoryFilter, status: statusFilter, subcat: v, q: searchQ })
  }

  const changeSearch = (v: string) => {
    setSearchQ(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setPage(1)
      if (selectAll) setExcludedIds(new Set())
      fetchPage({ p: 1, ps: pageSize, cat: categoryFilter, status: statusFilter, subcat: subcatFilter, q: v })
    }, 400)
  }

  const goToPage = (n: number) => {
    setPage(n)
    fetchPage({ p: n, ps: pageSize, cat: categoryFilter, status: statusFilter, subcat: subcatFilter, q: searchQ })
  }

  const changePageSize = (ps: PickerPageSize) => {
    setPageSize(ps)
    setPage(1)
    fetchPage({ p: 1, ps, cat: categoryFilter, status: statusFilter, subcat: subcatFilter, q: searchQ })
  }

  // ── Selection logic ───────────────────────────────────────────────────────
  const isChecked = (id: string) => selectAll ? !excludedIds.has(id) : selectedIds.has(id)

  const toggleRow = (id: string) => {
    if (selectAll) {
      setExcludedIds((prev) => {
        const n = new Set(prev)
        if (n.has(id)) n.delete(id); else n.add(id)
        return n
      })
    } else {
      setSelectedIds((prev) => {
        const n = new Set(prev)
        if (n.has(id)) n.delete(id); else n.add(id)
        return n
      })
    }
  }

  const handleSelectAll = () => { setSelectAll(true); setExcludedIds(new Set()); setSelectedIds(new Set()) }
  const handleClearAll  = () => { setSelectAll(false); setExcludedIds(new Set()); setSelectedIds(new Set()) }

  const allPageSelected  = rows.length > 0 && rows.every((r) => isChecked(r.id))
  const somePageSelected = rows.some((r) => isChecked(r.id))

  const togglePage = () => {
    if (allPageSelected) {
      if (selectAll) setExcludedIds((prev) => { const n = new Set(prev); rows.forEach((r) => n.add(r.id)); return n })
      else           setSelectedIds((prev) => { const n = new Set(prev); rows.forEach((r) => n.delete(r.id)); return n })
    } else {
      if (selectAll) setExcludedIds((prev) => { const n = new Set(prev); rows.forEach((r) => n.delete(r.id)); return n })
      else           setSelectedIds((prev) => { const n = new Set(prev); rows.forEach((r) => n.add(r.id)); return n })
    }
  }

  const selectionCount = selectAll ? Math.max(0, totalCount - excludedIds.size) : selectedIds.size

  // ── Apply ─────────────────────────────────────────────────────────────────
  const handleApply = async () => {
    setApplying(true)
    setApplyError(null)

    const newState: ExpensePickerState = {
      mode: selectAll ? 'all' : 'some',
      excludedIds: Array.from(excludedIds),
      selectedIds: Array.from(selectedIds),
      category: categoryFilter,
      status: statusFilter,
      subcategory: subcatFilter,
      q: searchQ.trim(),
      page,
      pageSize,
    }

    // Short-circuit: nothing selected -> 0
    if (!selectAll && selectedIds.size === 0) {
      setApplying(false)
      onApplyState(newState, 0)
      return
    }

    const result = await getExpensePickerTotal(from, to, newState)
    if (!result.success || result.data === undefined) {
      setApplyError(result.error ?? 'เกิดข้อผิดพลาด')
      setApplying(false)
      return
    }

    setApplying(false)
    onApplyState(newState, result.data.total)
  }

  const handleCancel = () => { setApplyError(null); onCancel() }

  const trunc = (s: string | null, n = 36) => !s ? '—' : s.length > n ? s.slice(0, n) + '…' : s

  // suppress unused warning — otherTotal, gmv, adSpend, cogs available for future footer preview
  void otherTotal; void gmv; void adSpend; void cogs; void initialTotal; void fmt

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCancel() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">

        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle>{title}</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            ช่วงวันที่ {from} – {to} · ทั้งหมด{' '}
            <span className="font-medium text-foreground">{totalCount}</span> รายการ
          </p>
        </DialogHeader>

        {/* Filter bar */}
        <div className="px-6 pb-3 border-b shrink-0">
          <div className="flex flex-wrap gap-2 items-center">

            {/* Category */}
            <Select value={categoryFilter} onValueChange={changeCategory}>
              <SelectTrigger className="w-36 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">หมวด: ทั้งหมด</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Status */}
            <Select value={statusFilter} onValueChange={(v) => changeStatus(v as PickerStatus)}>
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
                <SelectItem value="ALL">หมวดย่อย: ทั้งหมด</SelectItem>
                {subcategories.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Search */}
            <div className="relative flex-1 min-w-[140px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="ค้นหารายการ..."
                defaultValue={searchQ}
                onChange={(e) => changeSearch(e.target.value)}
                className="pl-7 h-8 text-sm"
              />
            </div>

            {/* Select all / Clear all */}
            <div className="flex gap-1 ml-auto shrink-0">
              <Button
                variant={selectAll && excludedIds.size === 0 ? 'default' : 'outline'}
                size="sm" className="h-8 text-xs"
                onClick={handleSelectAll}
              >เลือกทั้งหมด</Button>
              <Button
                variant={!selectAll && selectedIds.size === 0 ? 'default' : 'outline'}
                size="sm" className="h-8 text-xs"
                onClick={handleClearAll}
              >ล้างทั้งหมด</Button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : loadError ? (
            <p className="py-8 text-center text-sm text-red-600">{loadError}</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {totalCount === 0 ? 'ไม่มีรายจ่ายในช่วงวันที่นี้' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 px-2">
                    <Checkbox
                      checked={allPageSelected}
                      data-state={somePageSelected && !allPageSelected ? 'indeterminate' : undefined}
                      onCheckedChange={togglePage}
                    />
                  </TableHead>
                  <TableHead className="text-xs">วันที่</TableHead>
                  <TableHead className="text-xs">หมวด</TableHead>
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
                      <Checkbox checked={isChecked(row.id)} onCheckedChange={() => toggleRow(row.id)} />
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDate(row.expense_date)}</TableCell>
                    <TableCell className="text-xs"><CategoryBadge category={row.category} /></TableCell>
                    <TableCell className="text-xs">
                      {row.subcategory ? (
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-xs">{row.subcategory}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs max-w-[160px]">
                      <div className="truncate">{trunc(row.description)}</div>
                      {row.vendor && <div className="text-muted-foreground truncate text-xs">{trunc(row.vendor, 26)}</div>}
                    </TableCell>
                    <TableCell className="text-xs"><StatusBadge status={row.expense_status} /></TableCell>
                    <TableCell className="text-right text-xs font-mono">{row.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination */}
        {!loading && !loadError && totalCount > 0 && (
          <div className="px-6 py-2 border-t flex items-center justify-between gap-2 shrink-0 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">แสดง</span>
              <Select value={String(pageSize)} onValueChange={(v) => changePageSize(Number(v) as PickerPageSize)}>
                <SelectTrigger className="w-20 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PICKER_PAGE_SIZES.map((ps) => (
                    <SelectItem key={ps} value={String(ps)}>{ps} รายการ</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">· หน้า {page}/{totalPages} ({totalCount} รายการ)</span>
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages || loading} onClick={() => goToPage(page + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-muted-foreground">
            {selectAll ? (
              <>เลือกทั้งหมด{' '}
                <span className="font-semibold text-foreground">{selectionCount}</span> รายการ
                {excludedIds.size > 0 && <span className="text-amber-600 ml-1">({excludedIds.size} ยกเว้น)</span>}
              </>
            ) : (
              <>เลือก <span className="font-semibold text-foreground">{selectionCount}</span> / {totalCount} รายการ</>
            )}
            {applyError && <span className="ml-2 text-xs text-red-600">{applyError}</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCancel} disabled={applying}>ยกเลิก</Button>
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
