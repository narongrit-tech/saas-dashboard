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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Loader2, Search, ChevronLeft, ChevronRight, Landmark } from 'lucide-react'
import {
  getBankInflowRows,
  getBankInflowRevenueTotal,
  upsertBankTxnClassification,
} from '@/app/(dashboard)/actions'
import type { BankInflowRow, BankInflowRevenueTotals, RevenueChannel } from '@/app/(dashboard)/actions'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

const CHANNEL_LABELS: Record<RevenueChannel, string> = {
  tiktok: 'TikTok',
  shopee: 'Shopee',
  other:  'Other',
}

function ChannelBadge({ channel }: { channel: RevenueChannel | null }) {
  if (!channel) return <span className="text-muted-foreground text-xs">—</span>
  const colors: Record<RevenueChannel, string> = {
    tiktok: 'bg-slate-100 text-slate-700 border-slate-200',
    shopee: 'bg-orange-100 text-orange-700 border-orange-200',
    other:  'bg-gray-100 text-gray-600 border-gray-200',
  }
  return (
    <Badge className={`${colors[channel]} hover:${colors[channel]} text-xs`}>
      {CHANNEL_LABELS[channel]}
    </Badge>
  )
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  from: string
  to: string
  onDone: (totals: BankInflowRevenueTotals) => void
  onCancel: () => void
}

type PageSize = 10 | 25 | 50
const PAGE_SIZES: PageSize[] = [10, 25, 50]

// ─── Component ─────────────────────────────────────────────────────────────────

export function BankInflowPickerModal({ open, from, to, onDone, onCancel }: Props) {
  // ── Table rows ────────────────────────────────────────────────────────────
  const [rows, setRows]           = useState<BankInflowRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading]     = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // ── Pagination + search ───────────────────────────────────────────────────
  const [page, setPage]         = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(25)
  const [searchQ, setSearchQ]   = useState('')

  // ── Per-row save state ────────────────────────────────────────────────────
  const [savingIds, setSavingIds]   = useState<Set<string>>(new Set())
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map())

  // ── Revenue summary (refreshed after each save) ───────────────────────────
  const [summary, setSummary]         = useState<BankInflowRevenueTotals | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const summaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Core fetcher ──────────────────────────────────────────────────────────
  const fetchPage = useCallback(
    async (opts: { p: number; ps: number; q: string }) => {
      setLoading(true)
      setLoadError(null)
      const r = await getBankInflowRows({
        from, to,
        q: opts.q.trim() || undefined,
        page: opts.p,
        pageSize: opts.ps,
      })
      if (r.success && r.data) {
        setRows(r.data.rows)
        setTotalCount(r.data.total)
      } else {
        setLoadError(r.error ?? 'ไม่สามารถโหลดข้อมูลได้')
      }
      setLoading(false)
    },
    [from, to],
  )

  // ── Debounced summary refresh ─────────────────────────────────────────────
  const refreshSummary = useCallback(() => {
    if (summaryTimer.current) clearTimeout(summaryTimer.current)
    summaryTimer.current = setTimeout(async () => {
      setSummaryLoading(true)
      const r = await getBankInflowRevenueTotal(from, to)
      if (r.success && r.data) setSummary(r.data)
      setSummaryLoading(false)
    }, 300)
  }, [from, to])

  // ── Open / reset ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    setRows([])
    setTotalCount(0)
    setPage(1)
    setPageSize(25)
    setSearchQ('')
    setSavingIds(new Set())
    setSaveErrors(new Map())
    setSummary(null)
    setLoadError(null)
    fetchPage({ p: 1, ps: 25, q: '' })
    refreshSummary()
  }, [open, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const goToPage = (p: number) => {
    setPage(p)
    fetchPage({ p, ps: pageSize, q: searchQ })
  }

  const changePageSize = (ps: PageSize) => {
    setPageSize(ps)
    setPage(1)
    fetchPage({ p: 1, ps, q: searchQ })
  }

  const changeSearch = (v: string) => {
    setSearchQ(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setPage(1)
      fetchPage({ p: 1, ps: pageSize, q: v })
    }, 400)
  }

  // ── Per-row save helpers ──────────────────────────────────────────────────

  const markSaving = (id: string) =>
    setSavingIds((prev) => { const n = new Set(prev); n.add(id); return n })

  const unmarkSaving = (id: string) =>
    setSavingIds((prev) => { const n = new Set(prev); n.delete(id); return n })

  const setRowError = (id: string, msg: string) =>
    setSaveErrors((prev) => { const n = new Map(prev); n.set(id, msg); return n })

  const clearRowError = (id: string) =>
    setSaveErrors((prev) => { const n = new Map(prev); n.delete(id); return n })

  /** Optimistically update a row in local state */
  const patchRow = (id: string, patch: Partial<BankInflowRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  // ── Include toggle ────────────────────────────────────────────────────────
  const handleIncludeToggle = async (row: BankInflowRow) => {
    const newInclude = !row.include_as_revenue
    patchRow(row.id, { include_as_revenue: newInclude })
    markSaving(row.id)
    clearRowError(row.id)

    const res = await upsertBankTxnClassification({
      bank_transaction_id: row.id,
      include_as_revenue:  newInclude,
      revenue_channel:     newInclude ? (row.revenue_channel ?? null) : null,
      revenue_type:        row.revenue_type ?? null,
      note:                row.note ?? null,
    })

    unmarkSaving(row.id)
    if (!res.success) {
      patchRow(row.id, { include_as_revenue: row.include_as_revenue }) // revert
      setRowError(row.id, res.error ?? 'บันทึกไม่สำเร็จ')
    } else {
      refreshSummary()
    }
  }

  // ── Channel dropdown ──────────────────────────────────────────────────────
  const handleChannelChange = async (row: BankInflowRow, channel: RevenueChannel | null) => {
    patchRow(row.id, { revenue_channel: channel })
    markSaving(row.id)
    clearRowError(row.id)

    const res = await upsertBankTxnClassification({
      bank_transaction_id: row.id,
      include_as_revenue:  row.include_as_revenue,
      revenue_channel:     channel,
      revenue_type:        row.revenue_type ?? null,
      note:                row.note ?? null,
    })

    unmarkSaving(row.id)
    if (!res.success) {
      patchRow(row.id, { revenue_channel: row.revenue_channel }) // revert
      setRowError(row.id, res.error ?? 'บันทึกไม่สำเร็จ')
    } else {
      refreshSummary()
    }
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  const handleDone = async () => {
    // Ensure latest summary
    setSummaryLoading(true)
    const r = await getBankInflowRevenueTotal(from, to)
    setSummaryLoading(false)
    const totals = r.success && r.data
      ? r.data
      : (summary ?? { total: 0, tiktok: 0, shopee: 0, other: 0 })
    onDone(totals)
  }

  const includedCount = rows.filter((r) => r.include_as_revenue).length

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">

        {/* ── Header ── */}
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5 text-emerald-600" />
            Bank Inflows — เลือกรายการที่นับเป็นรายได้ขาย
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {from} – {to} · เงินเข้าจากธนาคาร (รายการที่มี deposit &gt; 0)
          </p>
        </DialogHeader>

        {/* ── Summary bar ── */}
        <div className="px-6 py-3 bg-emerald-50 border-b shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-muted-foreground">
                รวม Revenue:{' '}
                {summaryLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin inline" />
                ) : (
                  <span className="font-bold font-mono text-emerald-700">
                    ฿{fmt(summary?.total ?? 0)}
                  </span>
                )}
              </span>
              {summary && (
                <>
                  {summary.tiktok > 0 && (
                    <span className="text-xs text-muted-foreground">
                      TikTok: <span className="font-mono font-semibold">฿{fmt(summary.tiktok)}</span>
                    </span>
                  )}
                  {summary.shopee > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Shopee: <span className="font-mono font-semibold">฿{fmt(summary.shopee)}</span>
                    </span>
                  )}
                  {summary.other > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Other: <span className="font-mono font-semibold">฿{fmt(summary.other)}</span>
                    </span>
                  )}
                </>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              รายการในหน้านี้ที่เลือก: {includedCount} / {rows.length}
            </span>
          </div>
        </div>

        {/* ── Filter bar ── */}
        <div className="px-6 py-2 border-b shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="ค้นหาคำอธิบายรายการ..."
                defaultValue={searchQ}
                onChange={(e) => changeSearch(e.target.value)}
                className="pl-7 h-8 text-sm"
              />
            </div>
            <Select value={String(pageSize)} onValueChange={(v) => changePageSize(Number(v) as PageSize)}>
              <SelectTrigger className="w-28 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((ps) => (
                  <SelectItem key={ps} value={String(ps)}>{ps} รายการ</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Pagination info ── */}
        {!loading && totalCount > 0 && (
          <div className="px-6 py-1.5 border-b shrink-0 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              ทั้งหมด {totalCount} รายการ · หน้า {page}/{totalPages}
            </span>
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
                ? 'ไม่มีรายการเงินเข้าจากธนาคารในช่วงวันที่นี้'
                : 'ไม่พบรายการที่ตรงกับการค้นหา'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 px-2 text-xs">นับรายได้</TableHead>
                  <TableHead className="text-xs whitespace-nowrap">วันที่</TableHead>
                  <TableHead className="text-xs">คำอธิบาย</TableHead>
                  <TableHead className="text-xs">Channel</TableHead>
                  <TableHead className="text-right text-xs">ยอดเข้า (฿)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const isSaving = savingIds.has(row.id)
                  const errMsg   = saveErrors.get(row.id)
                  return (
                    <TableRow
                      key={row.id}
                      className={row.include_as_revenue ? '' : 'opacity-50'}
                    >
                      {/* Include checkbox */}
                      <TableCell className="px-2">
                        {isSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                          <Checkbox
                            checked={row.include_as_revenue}
                            onCheckedChange={() => handleIncludeToggle(row)}
                          />
                        )}
                        {errMsg && (
                          <span className="block text-xs text-red-600 mt-0.5">{errMsg}</span>
                        )}
                      </TableCell>

                      {/* Date */}
                      <TableCell className="text-xs whitespace-nowrap">
                        {fmtDate(row.txn_date)}
                      </TableCell>

                      {/* Description */}
                      <TableCell className="text-xs max-w-[220px]">
                        <div className="truncate">{row.description || '—'}</div>
                        {row.bank_channel && (
                          <div className="text-muted-foreground text-xs">{row.bank_channel}</div>
                        )}
                      </TableCell>

                      {/* Revenue channel dropdown */}
                      <TableCell className="text-xs">
                        {row.include_as_revenue ? (
                          <Select
                            value={row.revenue_channel ?? 'none'}
                            onValueChange={(v) =>
                              handleChannelChange(row, v === 'none' ? null : (v as RevenueChannel))
                            }
                            disabled={isSaving}
                          >
                            <SelectTrigger className="h-7 w-28 text-xs">
                              <SelectValue placeholder="เลือก..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— ไม่ระบุ</SelectItem>
                              <SelectItem value="tiktok">TikTok</SelectItem>
                              <SelectItem value="shopee">Shopee</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <ChannelBadge channel={row.revenue_channel} />
                        )}
                      </TableCell>

                      {/* Amount */}
                      <TableCell className="text-right text-xs font-mono font-semibold">
                        {fmt(row.deposit)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground">
            การเลือกถูกบันทึกอัตโนมัติ · ข้ามหน้าได้โดยไม่เสียข้อมูล
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              ยกเลิก
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleDone}
              disabled={summaryLoading}
            >
              {summaryLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              เสร็จสิ้น
            </Button>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  )
}
