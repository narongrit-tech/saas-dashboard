'use client'

import { useState, useEffect } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, Download, ChevronLeft, ChevronRight, Package, FileText } from 'lucide-react'
import {
  getCogsAllocationBreakdown,
  getCogsExpensesBreakdown,
  getExpensePickerRows,
} from '@/app/(dashboard)/actions'
import type {
  CogsAllocationRow,
  CogsExpensesBreakdownRow,
  CogsBasis,
  ExpensePickerRow,
} from '@/app/(dashboard)/actions'

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
  onClose: () => void
}

const EXP_PAGE_SIZE = 25

// ─── Component ─────────────────────────────────────────────────────────────────

export function CogsDrilldownModal({ open, from, to, cogsBasis, onClose }: Props) {
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
  const [expRows, setExpRows]   = useState<ExpensePickerRow[]>([])
  const [expTotal, setExpTotal] = useState(0)
  const [expPage, setExpPage]   = useState(1)
  const [expLoading, setExpLoading] = useState(false)
  const [expError, setExpError]     = useState<string | null>(null)

  // ── Load all data when modal opens ────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    setAllocData(null)
    setAllocError(null)
    setExpBreakdown(null)
    setExpRows([])
    setExpTotal(0)
    setExpPage(1)
    setExpError(null)

    // Tab 1: allocation breakdown
    setAllocLoading(true)
    getCogsAllocationBreakdown({ from, to, basis: cogsBasis }).then((r) => {
      if (r.success && r.data) setAllocData(r.data)
      else setAllocError(r.error ?? 'โหลดข้อมูลไม่ได้')
      setAllocLoading(false)
    })

    // Tab 2: expense breakdown (summary) + first page
    getCogsExpensesBreakdown({ from, to }).then((r) => {
      if (r.success && r.data) setExpBreakdown(r.data)
    })
    loadExpPage(1)
  }, [open, from, to, cogsBasis]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadExpPage = async (page: number) => {
    setExpLoading(true)
    setExpError(null)
    const r = await getExpensePickerRows({
      from,
      to,
      category: 'COGS',
      page,
      pageSize: EXP_PAGE_SIZE,
    })
    if (r.success && r.data) {
      setExpRows(r.data.rows)
      setExpTotal(r.data.total)
      setExpPage(page)
    } else {
      setExpError(r.error ?? 'โหลดข้อมูลไม่ได้')
    }
    setExpLoading(false)
  }

  // ── CSV Exports ───────────────────────────────────────────────────────────

  const exportAllocCsv = () => {
    if (!allocData) return
    const basisLabel = cogsBasis === 'shipped' ? 'Shipped Date' : 'Order Date'
    const headers = ['SKU', 'จำนวนรวม', 'ต้นทุนเฉลี่ย/หน่วย (฿)', 'ต้นทุนรวม (฿)']
    const dataRows = allocData.rows.map((r) => [
      r.sku_internal,
      r.qty_total,
      r.avg_unit_cost,
      r.total_cost,
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
    // Fetch all COGS expense rows (up to 1000) for export
    const r = await getExpensePickerRows({
      from,
      to,
      category: 'COGS',
      page: 1,
      pageSize: 1000,
    })
    if (!r.success || !r.data) return
    const headers = ['วันที่', 'หมวดย่อย', 'รายการ', 'Vendor', 'สถานะ', 'จำนวน (฿)']
    const dataRows = r.data.rows.map((row) => [
      row.expense_date,
      row.subcategory ?? '',
      row.description ?? '',
      row.vendor ?? '',
      row.expense_status,
      row.amount,
    ])
    downloadCsv(
      [
        [`COGS Expenses (${from} – ${to})`],
        headers,
        ...dataRows,
      ],
      `cogs_expenses_${from}_${to}.csv`,
    )
  }

  const expTotalPages = Math.max(1, Math.ceil(expTotal / EXP_PAGE_SIZE))
  const basisLabel    = cogsBasis === 'shipped' ? 'Shipped Date' : 'Order Date (วิเคราะห์)'

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
              COGS Expenses (รายการต้นทุนอื่น)
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
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={exportAllocCsv}
                >
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
                        <TableCell className="text-sm font-mono font-medium">
                          {row.sku_internal}
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono">
                          {fmtQty(row.qty_total)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono">
                          {fmt(row.avg_unit_cost)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono font-semibold">
                          {fmt(row.total_cost)}
                        </TableCell>
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
                    <p className="text-xs text-muted-foreground mb-1.5">สรุปตามหมวดย่อย</p>
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
                    <p className="text-xs text-muted-foreground">รวม COGS Expenses</p>
                    <p className="text-lg font-bold font-mono text-slate-700">
                      ฿{fmt(expBreakdown.total)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Export + pagination bar */}
            {!expLoading && expTotal > 0 && (
              <div className="px-6 py-2 border-b shrink-0 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">
                  {expTotal} รายการ · หน้า {expPage}/{expTotalPages}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={exportExpCsv}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={expPage <= 1 || expLoading}
                    onClick={() => loadExpPage(expPage - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={expPage >= expTotalPages || expLoading}
                    onClick={() => loadExpPage(expPage + 1)}
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
                      <TableHead className="text-xs">วันที่</TableHead>
                      <TableHead className="text-xs">หมวดย่อย</TableHead>
                      <TableHead className="text-xs">รายการ</TableHead>
                      <TableHead className="text-xs">สถานะ</TableHead>
                      <TableHead className="text-right text-xs">จำนวน (฿)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expRows.map((row) => (
                      <TableRow key={row.id}>
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
                        <TableCell className="text-xs max-w-[220px]">
                          <div className="truncate">{row.description || '—'}</div>
                          {row.vendor && (
                            <div className="text-muted-foreground truncate text-xs">{row.vendor}</div>
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
        <div className="px-6 py-3 border-t shrink-0 flex justify-end">
          <Button variant="outline" onClick={onClose}>ปิด</Button>
        </div>

      </DialogContent>
    </Dialog>
  )
}
