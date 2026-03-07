'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Loader2,
  Download,
  ChevronLeft,
  ChevronRight,
  Package,
  FileText,
  Search,
} from 'lucide-react'
import {
  getCogsAllocationBreakdown,
  getCogsExpensesBreakdown,
  getExpensePickerRows,
  getExpensePickerTotal,
  getExpensePickerSubcategories,
} from '@/app/(dashboard)/actions'
import type {
  CogsAllocationRow,
  CogsExpensesBreakdownRow,
  CogsBasis,
  ExpensePickerRow,
} from '@/app/(dashboard)/actions'
import type { ExpensePickerState, PickerStatus } from '@/lib/expense-picker'
import { defaultPickerState } from '@/lib/expense-picker'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtQty(n: number) {
  return n % 1 === 0 ? n.toLocaleString('th-TH') : n.toLocaleString('th-TH', { maximumFractionDigits: 4 })
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
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

/** Client-side CSV download with UTF-8 BOM (Excel-compatible). */
function downloadCsv(rows: (string | number)[][], filename: string) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  from: string
  to: string
  cogsBasis: CogsBasis
  initialCogsExpState?: ExpensePickerState
  onApply?: (newState: ExpensePickerState, newTotal: number) => void
  onClose: () => void
}

const EXP_PAGE_SIZE = 25

// ─── Component ─────────────────────────────────────────────────────────────────

export function CogsDrilldownModal({
  open,
  from,
  to,
  cogsBasis,
  initialCogsExpState,
  onApply,
  onClose,
}: Props) {
  // ── Tab 1: Allocation data ────────────────────────────────────────────────
  const [allocLoading, setAllocLoading] = useState(false)
  const [allocError, setAllocError]     = useState<string | null>(null)
  const [allocData, setAllocData]       = useState<{
    rows: CogsAllocationRow[]
    totalCost: number
    totalQty: number
  } | null>(null)

  // ── Tab 2: Expenses data ──────────────────────────────────────────────────
  const [expBreakdown, setExpBreakdown] = useState<{
    rows: CogsExpensesBreakdownRow[]
    total: number
  } | null>(null)
  const [expRows, setExpRows]     = useState<ExpensePickerRow[]>([])
  const [expTotal, setExpTotal]   = useState(0)
  const [expPage, setExpPage]     = useState(1)
  const [expLoading, setExpLoading] = useState(false)
  const [expError, setExpError]     = useState<string | null>(null)

  // ── Subcategory list ──────────────────────────────────────────────────────
  const [subcategories, setSubcategories] = useState<string[]>([])

  // ── Filters (expenses tab) ────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<PickerStatus>('All')
  const [subcatFilter, setSubcatFilter] = useState('ALL')
  const [searchQ, setSearchQ]           = useState('')

  // ── Selection: selectAll + excludedIds  OR  explicit selectedIds ──────────
  const [selectAll, setSelectAll]     = useState(true)
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // ── Selected total (server-computed, debounced) ───────────────────────────
  const [selectedTotal, setSelectedTotal] = useState<number | null>(null)
  const [totalLoading, setTotalLoading]   = useState(false)

  // ── Apply state ───────────────────────────────────────────────────────────
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  // ── Timers ────────────────────────────────────────────────────────────────
  const totalTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Debounced server-side total recompute ─────────────────────────────────
  const recomputeTotal = useCallback(
    (
      selAll: boolean,
      excl: Set<string>,
      sel: Set<string>,
      status: PickerStatus,
      subcat: string,
      q: string,
    ) => {
      if (totalTimer.current) clearTimeout(totalTimer.current)
      totalTimer.current = setTimeout(async () => {
        setTotalLoading(true)
        const stateArg = selAll
          ? {
              mode: 'all' as const,
              category: 'COGS',
              status: status !== 'All' ? status : undefined,
              subcategory: subcat !== 'ALL' ? subcat : undefined,
              q: q.trim() || undefined,
              excludedIds: Array.from(excl),
            }
          : {
              mode: 'some' as const,
              category: 'COGS',
              selectedIds: Array.from(sel),
            }
        const r = await getExpensePickerTotal(from, to, stateArg)
        if (r.success && r.data !== undefined) setSelectedTotal(r.data.total)
        setTotalLoading(false)
      }, 200)
    },
    [from, to],
  )

  // ── Core page fetcher ─────────────────────────────────────────────────────
  const loadExpPage = async (opts: { p: number; status: PickerStatus; subcat: string; q: string }) => {
    setExpLoading(true)
    setExpError(null)
    const r = await getExpensePickerRows({
      from,
      to,
      category: 'COGS',
      status: opts.status !== 'All' ? opts.status : undefined,
      subcategory: opts.subcat !== 'ALL' ? opts.subcat : undefined,
      q: opts.q.trim() || undefined,
      page: opts.p,
      pageSize: EXP_PAGE_SIZE,
    })
    if (r.success && r.data) {
      setExpRows(r.data.rows)
      setExpTotal(r.data.total)
      setExpPage(opts.p)
    } else {
      setExpError(r.error ?? 'โหลดข้อมูลไม่ได้')
    }
    setExpLoading(false)
  }

  // ── Load all data when modal opens ────────────────────────────────────────
  useEffect(() => {
    if (!open) return

    const initState = initialCogsExpState ?? defaultPickerState('COGS')
    const initSelectAll = initState.mode !== 'some'
    const initExcluded  = new Set(initState.excludedIds)
    const initSelected  = new Set(initState.selectedIds)
    const initStatus    = initState.status
    const initSubcat    = initState.subcategory
    const initQ         = initState.q

    // Reset state
    setAllocData(null)
    setAllocError(null)
    setExpBreakdown(null)
    setExpRows([])
    setExpTotal(0)
    setExpPage(1)
    setExpError(null)
    setSelectedTotal(null)
    setApplyError(null)

    // Restore selection + filter from initial state
    setSelectAll(initSelectAll)
    setExcludedIds(initExcluded)
    setSelectedIds(initSelected)
    setStatusFilter(initStatus)
    setSubcatFilter(initSubcat)
    setSearchQ(initQ)

    // Tab 1: allocation breakdown
    setAllocLoading(true)
    getCogsAllocationBreakdown({ from, to, basis: cogsBasis }).then((r) => {
      if (r.success && r.data) setAllocData(r.data)
      else setAllocError(r.error ?? 'โหลดข้อมูลไม่ได้')
      setAllocLoading(false)
    })

    // Tab 2: subcategory mini-summary (always full, unaffected by selection)
    getCogsExpensesBreakdown({ from, to }).then((r) => {
      if (r.success && r.data) setExpBreakdown(r.data)
    })

    // Subcategory list for dropdown
    getExpensePickerSubcategories(from, to, 'COGS').then((r) => {
      if (r.success && r.data) setSubcategories(r.data)
    })

    // Load expenses first page with initial filters
    loadExpPage({ p: 1, status: initStatus, subcat: initSubcat, q: initQ })

    // Compute initial selected total
    recomputeTotal(initSelectAll, initExcluded, initSelected, initStatus, initSubcat, initQ)
  }, [open, from, to, cogsBasis]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filter change handlers ────────────────────────────────────────────────

  const changeStatus = (v: PickerStatus) => {
    setStatusFilter(v)
    const newExcl = selectAll ? new Set<string>() : excludedIds
    if (selectAll) setExcludedIds(newExcl)
    loadExpPage({ p: 1, status: v, subcat: subcatFilter, q: searchQ })
    recomputeTotal(selectAll, newExcl, selectedIds, v, subcatFilter, searchQ)
  }

  const changeSubcat = (v: string) => {
    setSubcatFilter(v)
    const newExcl = selectAll ? new Set<string>() : excludedIds
    if (selectAll) setExcludedIds(newExcl)
    loadExpPage({ p: 1, status: statusFilter, subcat: v, q: searchQ })
    recomputeTotal(selectAll, newExcl, selectedIds, statusFilter, v, searchQ)
  }

  const changeSearch = (v: string) => {
    setSearchQ(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      const newExcl = selectAll ? new Set<string>() : excludedIds
      if (selectAll) setExcludedIds(newExcl)
      loadExpPage({ p: 1, status: statusFilter, subcat: subcatFilter, q: v })
      recomputeTotal(selectAll, newExcl, selectedIds, statusFilter, subcatFilter, v)
    }, 400)
  }

  // ── Selection logic ───────────────────────────────────────────────────────

  const isChecked = (id: string) => selectAll ? !excludedIds.has(id) : selectedIds.has(id)

  const toggleRow = (id: string) => {
    if (selectAll) {
      const next = new Set(excludedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setExcludedIds(next)
      recomputeTotal(true, next, selectedIds, statusFilter, subcatFilter, searchQ)
    } else {
      const next = new Set(selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelectedIds(next)
      recomputeTotal(false, excludedIds, next, statusFilter, subcatFilter, searchQ)
    }
  }

  const handleSelectAll = () => {
    setSelectAll(true)
    setExcludedIds(new Set())
    setSelectedIds(new Set())
    recomputeTotal(true, new Set(), new Set(), statusFilter, subcatFilter, searchQ)
  }

  const handleClearAll = () => {
    setSelectAll(false)
    setExcludedIds(new Set())
    setSelectedIds(new Set())
    setSelectedTotal(0)
  }

  /** Header checkbox: current page only */
  const allPageSelected  = expRows.length > 0 && expRows.every((r) => isChecked(r.id))
  const somePageSelected = expRows.some((r) => isChecked(r.id))

  const togglePage = () => {
    if (allPageSelected) {
      if (selectAll) {
        const next = new Set(excludedIds); expRows.forEach((r) => next.add(r.id)); setExcludedIds(next)
        recomputeTotal(true, next, selectedIds, statusFilter, subcatFilter, searchQ)
      } else {
        const next = new Set(selectedIds); expRows.forEach((r) => next.delete(r.id)); setSelectedIds(next)
        recomputeTotal(false, excludedIds, next, statusFilter, subcatFilter, searchQ)
      }
    } else {
      if (selectAll) {
        const next = new Set(excludedIds); expRows.forEach((r) => next.delete(r.id)); setExcludedIds(next)
        recomputeTotal(true, next, selectedIds, statusFilter, subcatFilter, searchQ)
      } else {
        const next = new Set(selectedIds); expRows.forEach((r) => next.add(r.id)); setSelectedIds(next)
        recomputeTotal(false, excludedIds, next, statusFilter, subcatFilter, searchQ)
      }
    }
  }

  const selectionCount = selectAll
    ? Math.max(0, expTotal - excludedIds.size)
    : selectedIds.size

  // ── Apply ─────────────────────────────────────────────────────────────────

  const handleApply = async () => {
    if (!onApply) { onClose(); return }

    setApplying(true)
    setApplyError(null)

    // Short-circuit: default state (all selected, no filters)
    if (selectAll && excludedIds.size === 0 && statusFilter === 'All' && subcatFilter === 'ALL' && !searchQ.trim()) {
      const total = selectedTotal ?? expBreakdown?.total ?? 0
      setApplying(false)
      onApply(defaultPickerState('COGS'), total)
      return
    }

    // Short-circuit: nothing selected
    if (!selectAll && selectedIds.size === 0) {
      setApplying(false)
      const emptyState: ExpensePickerState = {
        mode: 'some', excludedIds: [], selectedIds: [], category: 'COGS',
        status: 'All', subcategory: 'ALL', q: '', page: 1, pageSize: 25,
      }
      onApply(emptyState, 0)
      return
    }

    // Build new state
    const newState: ExpensePickerState = selectAll
      ? {
          mode: 'all',
          excludedIds: Array.from(excludedIds),
          selectedIds: [],
          category: 'COGS',
          status: statusFilter,
          subcategory: subcatFilter,
          q: searchQ,
          page: 1,
          pageSize: 25,
        }
      : {
          mode: 'some',
          excludedIds: [],
          selectedIds: Array.from(selectedIds),
          category: 'COGS',
          status: 'All',
          subcategory: 'ALL',
          q: '',
          page: 1,
          pageSize: 25,
        }

    // Use already-computed selectedTotal if available
    if (selectedTotal !== null) {
      setApplying(false)
      onApply(newState, selectedTotal)
      return
    }

    // Fallback: compute now
    const stateArg = selectAll
      ? {
          mode: 'all' as const,
          category: 'COGS',
          status: statusFilter !== 'All' ? statusFilter : undefined,
          subcategory: subcatFilter !== 'ALL' ? subcatFilter : undefined,
          q: searchQ.trim() || undefined,
          excludedIds: Array.from(excludedIds),
        }
      : { mode: 'some' as const, category: 'COGS', selectedIds: Array.from(selectedIds) }

    const r = await getExpensePickerTotal(from, to, stateArg)
    if (!r.success || r.data === undefined) {
      setApplyError(r.error ?? 'เกิดข้อผิดพลาด')
      setApplying(false)
      return
    }

    setApplying(false)
    onApply(newState, r.data.total)
  }

  // ── CSV Exports ───────────────────────────────────────────────────────────

  const exportAllocCsv = () => {
    if (!allocData) return
    const basisLabel = cogsBasis === 'shipped' ? 'Shipped Date' : 'Order Date'
    const headers = ['SKU', 'จำนวนรวม', 'ต้นทุนเฉลี่ย/หน่วย (฿)', 'ต้นทุนรวม (฿)']
    const dataRows = allocData.rows.map((r) => [
      r.sku_internal, r.qty_total, r.avg_unit_cost, r.total_cost,
    ])
    downloadCsv(
      [
        [`COGS Allocation Breakdown (${basisLabel})`, `${from} – ${to}`],
        headers,
        ...dataRows,
        [],
        ['รวม', allocData.totalQty, '', allocData.totalCost],
      ],
      `cogs_allocation_${from}_${to}.csv`,
    )
  }

  const exportExpCsv = async () => {
    const r = await getExpensePickerRows({
      from, to, category: 'COGS',
      status: statusFilter !== 'All' ? statusFilter : undefined,
      subcategory: subcatFilter !== 'ALL' ? subcatFilter : undefined,
      q: searchQ.trim() || undefined,
      page: 1, pageSize: 1000,
    })
    if (!r.success || !r.data) return
    const headers = ['วันที่', 'หมวดย่อย', 'รายการ', 'Vendor', 'สถานะ', 'จำนวน (฿)']
    const dataRows = r.data.rows.map((row) => [
      row.expense_date, row.subcategory ?? '', row.description ?? '',
      row.vendor ?? '', row.expense_status, row.amount,
    ])
    downloadCsv(
      [[`COGS Expenses (${from} – ${to})`], headers, ...dataRows],
      `cogs_expenses_${from}_${to}.csv`,
    )
  }

  const expTotalPages = Math.max(1, Math.ceil(expTotal / EXP_PAGE_SIZE))
  const basisLabel    = cogsBasis === 'shipped' ? 'Shipped Date' : 'Order Date (วิเคราะห์)'

  const trunc = (s: string | null, n = 40) =>
    !s ? '—' : s.length > n ? s.slice(0, n) + '…' : s

  // ── Derived: shown total in summary bar ──────────────────────────────────
  const displayTotal = selectedTotal !== null
    ? selectedTotal
    : expBreakdown?.total ?? null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col gap-0 p-0">

        {/* ── Header ── */}
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-orange-500" />
            COGS Breakdown
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {from} – {to} · basis: <span className="font-medium text-foreground">{basisLabel}</span>
          </p>
        </DialogHeader>

        {/* ── Tabs ── */}
        <Tabs defaultValue="alloc" className="flex flex-col flex-1 min-h-0">
          <TabsList className="mx-6 mb-0 shrink-0 w-fit">
            <TabsTrigger value="alloc">Allocated COGS (SKU)</TabsTrigger>
            <TabsTrigger value="expenses">
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              COGS Expenses
              {displayTotal !== null && (
                <span className="ml-1.5 font-mono text-xs">
                  {totalLoading ? '…' : `฿${fmt(displayTotal)}`}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ════ TAB 1: Allocated COGS ════ */}
          <TabsContent value="alloc" className="flex flex-col flex-1 min-h-0 mt-0 border-t">

            {/* Summary bar */}
            {allocData && !allocLoading && (
              <div className="px-6 py-3 bg-orange-50/60 border-b shrink-0 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex gap-6 text-sm">
                  <span className="text-muted-foreground">
                    SKUs:{' '}
                    <span className="font-semibold text-foreground">{allocData.rows.length}</span>
                  </span>
                  <span className="text-muted-foreground">
                    จำนวนรวม:{' '}
                    <span className="font-semibold text-foreground">{fmtQty(allocData.totalQty)}</span>
                    {' '}ชิ้น
                  </span>
                  <span className="text-muted-foreground">
                    ต้นทุนรวม:{' '}
                    <span className="font-semibold text-orange-600">฿{fmt(allocData.totalCost)}</span>
                  </span>
                </div>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={exportAllocCsv}>
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </Button>
              </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-y-auto min-h-0 px-6">
              {allocLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : allocError ? (
                <p className="py-10 text-center text-sm text-red-600">{allocError}</p>
              ) : !allocData || allocData.rows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  ไม่มีข้อมูล COGS allocation ในช่วงวันที่นี้
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">SKU (Internal)</TableHead>
                      <TableHead className="text-right text-xs">จำนวนรวม</TableHead>
                      <TableHead className="text-right text-xs">ต้นทุนเฉลี่ย/หน่วย (฿)</TableHead>
                      <TableHead className="text-right text-xs">ต้นทุนรวม (฿)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocData.rows.map((row) => (
                      <TableRow key={row.sku_internal}>
                        <TableCell className="text-sm font-mono font-medium">{row.sku_internal}</TableCell>
                        <TableCell className="text-right text-sm font-mono">{fmtQty(row.qty_total)}</TableCell>
                        <TableCell className="text-right text-sm font-mono">{fmt(row.avg_unit_cost)}</TableCell>
                        <TableCell className="text-right text-sm font-mono font-semibold">{fmt(row.total_cost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          {/* ════ TAB 2: COGS Expenses ════ */}
          <TabsContent value="expenses" className="flex flex-col flex-1 min-h-0 mt-0 border-t">

            {/* Subcategory breakdown mini-header */}
            {expBreakdown && expBreakdown.rows.length > 0 && (
              <div className="px-6 py-3 bg-slate-50 border-b shrink-0">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">สรุปตามหมวดย่อย (ทั้งหมด)</p>
                    <div className="flex flex-wrap gap-2">
                      {expBreakdown.rows.map((r) => (
                        <span
                          key={r.subcategory}
                          className="inline-flex items-center gap-1.5 text-xs bg-white border rounded-md px-2 py-1"
                        >
                          <span className="text-muted-foreground">{r.subcategory}:</span>
                          <span className="font-semibold font-mono">฿{fmt(r.total)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">รวม COGS Expenses (เลือกแล้ว)</p>
                    <p className="text-lg font-bold font-mono text-slate-700">
                      {totalLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin inline" />
                      ) : displayTotal !== null ? (
                        `฿${fmt(displayTotal)}`
                      ) : (
                        '—'
                      )}
                    </p>
                    {selectAll && excludedIds.size > 0 && (
                      <p className="text-xs text-amber-600">{excludedIds.size} รายการยกเว้น</p>
                    )}
                    {!selectAll && (
                      <p className="text-xs text-blue-600">เลือก {selectedIds.size} รายการ</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Filter bar */}
            <div className="px-6 py-2 border-b shrink-0">
              <div className="flex flex-wrap gap-2 items-center">

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

                {/* Select all / Clear all */}
                <div className="flex gap-1 ml-auto shrink-0">
                  <Button
                    variant={selectAll && excludedIds.size === 0 ? 'default' : 'outline'}
                    size="sm" className="h-8 text-xs"
                    onClick={handleSelectAll}
                  >
                    เลือกทั้งหมด
                  </Button>
                  <Button
                    variant={!selectAll && selectedIds.size === 0 ? 'default' : 'outline'}
                    size="sm" className="h-8 text-xs"
                    onClick={handleClearAll}
                  >
                    ล้างทั้งหมด
                  </Button>
                </div>
              </div>
            </div>

            {/* Pagination + Export bar */}
            {!expLoading && expTotal > 0 && (
              <div className="px-6 py-2 border-b shrink-0 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">
                  {expTotal} รายการ · หน้า {expPage}/{expTotalPages}
                  {' · '}
                  {selectAll
                    ? `เลือก ${selectionCount} รายการ${excludedIds.size > 0 ? ` (ยกเว้น ${excludedIds.size})` : ''}`
                    : `เลือก ${selectionCount} รายการ`}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={exportExpCsv}>
                    <Download className="h-3.5 w-3.5" />
                    Export CSV
                  </Button>
                  <Button
                    variant="outline" size="sm" className="h-7 w-7 p-0"
                    disabled={expPage <= 1 || expLoading}
                    onClick={() => {
                      const p = expPage - 1
                      loadExpPage({ p, status: statusFilter, subcat: subcatFilter, q: searchQ })
                    }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline" size="sm" className="h-7 w-7 p-0"
                    disabled={expPage >= expTotalPages || expLoading}
                    onClick={() => {
                      const p = expPage + 1
                      loadExpPage({ p, status: statusFilter, subcat: subcatFilter, q: searchQ })
                    }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Expense rows table */}
            <div className="flex-1 overflow-y-auto min-h-0 px-6">
              {expLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : expError ? (
                <p className="py-10 text-center text-sm text-red-600">{expError}</p>
              ) : expRows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  ไม่มีรายจ่าย COGS ในช่วงวันที่นี้
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
                      <TableHead className="text-xs">หมวดย่อย</TableHead>
                      <TableHead className="text-xs">รายการ</TableHead>
                      <TableHead className="text-xs">สถานะ</TableHead>
                      <TableHead className="text-right text-xs">จำนวน (฿)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expRows.map((row) => (
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
                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-xs">
                              {row.subcategory}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs max-w-[200px]">
                          <div className="truncate">{trunc(row.description)}</div>
                          {row.vendor && (
                            <div className="text-muted-foreground truncate text-xs">{trunc(row.vendor, 30)}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <StatusBadge status={row.expense_status} />
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono font-semibold">
                          {fmt(row.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* ── Footer ── */}
        <div className="px-6 py-3 border-t shrink-0 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-muted-foreground">
            {applyError && (
              <span className="text-xs text-red-600">{applyError}</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={applying}>
              {onApply ? 'ยกเลิก' : 'ปิด'}
            </Button>
            {onApply && (
              <Button
                className="bg-orange-600 hover:bg-orange-700 text-white"
                onClick={handleApply}
                disabled={applying || expLoading}
              >
                {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                นำไปใช้
              </Button>
            )}
          </div>
        </div>

      </DialogContent>
    </Dialog>
  )
}
