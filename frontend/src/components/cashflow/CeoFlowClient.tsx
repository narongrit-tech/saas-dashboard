'use client'

import { useState, useEffect, useCallback } from 'react'
import { subDays } from 'date-fns'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DateRangePicker } from '@/components/shared/DateRangePicker'
import type { DateRangeResult } from '@/components/shared/DateRangePicker'
import { getBangkokNow, startOfDayBangkok, endOfDayBangkok } from '@/lib/bangkok-time'
import { toBangkokDateString } from '@/lib/bangkok-date-range'
import { Download, Info } from 'lucide-react'
import SankeyChart from '@/components/cashflow/SankeyChart'
import SankeySummaryCards from '@/components/cashflow/SankeySummaryCards'
import SankeyDrilldownDrawer from '@/components/cashflow/SankeyDrilldownDrawer'
import ClassifyTxnModal from '@/components/cashflow/ClassifyTxnModal'
import type { SankeyPayload, SankeyTxnRow } from '@/types/cashflow-sankey'
import type { BankAccount } from '@/types/bank'
import { getSankeyData, getSankeyDrilldown, exportSankeyCSV } from '@/app/(dashboard)/ceo-flow/actions'
import { getBankAccounts } from '@/app/(dashboard)/bank/actions'

// ── helpers ──────────────────────────────────────────────────────────────────

function getDefaultRange(): DateRangeResult {
  const now = getBangkokNow()
  return {
    startDate: startOfDayBangkok(subDays(now, 29)),
    endDate:   endOfDayBangkok(now),
    preset:    'last30days',
  }
}

// ── component ─────────────────────────────────────────────────────────────────

export default function CeoFlowClient() {
  const [dateRange,        setDateRange]        = useState<DateRangeResult>(getDefaultRange())
  const [accounts,         setAccounts]         = useState<BankAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [payload,          setPayload]          = useState<SankeyPayload | null>(null)
  const [loading,          setLoading]          = useState(false)
  const [error,            setError]            = useState<string | null>(null)
  const [exportLoading,    setExportLoading]    = useState(false)

  // Drilldown drawer
  const [activeNodeId,    setActiveNodeId]    = useState<string | null>(null)
  const [activeNodeLabel, setActiveNodeLabel] = useState('')
  const [drilldownRows,   setDrilldownRows]   = useState<SankeyTxnRow[]>([])
  const [drilldownLoading, setDrilldownLoading] = useState(false)
  const [drilldownError,  setDrilldownError]  = useState<string | null>(null)

  // Classify modal
  const [classifyTxn, setClassifyTxn] = useState<SankeyTxnRow | null>(null)

  // ── load bank accounts on mount ──────────────────────────────────────────

  useEffect(() => {
    async function loadAccounts() {
      const result = await getBankAccounts()
      if (!result.success || !result.data) return
      setAccounts(result.data)
      if (result.data.length > 0) {
        setSelectedAccountId(result.data[0].id)
      }
    }
    loadAccounts()
  }, [])

  // ── load sankey data when account or date range changes ──────────────────

  const loadSankeyData = useCallback(async (
    accountId: string,
    range: DateRangeResult,
  ) => {
    setLoading(true)
    setError(null)
    setPayload(null)

    const from = toBangkokDateString(range.startDate)
    const to   = toBangkokDateString(range.endDate)

    const result = await getSankeyData({ from, to, bankAccountId: accountId })
    if (!result.success || !result.data) {
      setError(result.error ?? 'โหลดข้อมูลไม่สำเร็จ')
    } else {
      setPayload(result.data)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    if (!selectedAccountId) return
    loadSankeyData(selectedAccountId, dateRange)
  }, [selectedAccountId, dateRange, loadSankeyData])

  // ── drilldown ─────────────────────────────────────────────────────────────

  const handleNodeClick = useCallback(async (nodeId: string, label: string) => {
    if (!payload) return
    const txnIds = payload.drilldown[nodeId] ?? []
    if (txnIds.length === 0) return

    setActiveNodeId(nodeId)
    setActiveNodeLabel(label)
    setDrilldownRows([])
    setDrilldownError(null)
    setDrilldownLoading(true)

    const result = await getSankeyDrilldown({
      txnIds,
      bankAccountId: selectedAccountId ?? undefined,
    })

    if (!result.success || !result.data) {
      setDrilldownError(result.error ?? 'โหลด drilldown ไม่สำเร็จ')
    } else {
      setDrilldownRows(result.data)
    }

    setDrilldownLoading(false)
  }, [payload, selectedAccountId])

  const handleCloseDrawer = useCallback(() => {
    setActiveNodeId(null)
    setActiveNodeLabel('')
    setDrilldownRows([])
    setDrilldownError(null)
  }, [])

  // After classify save: reload sankey + close modal + close drawer
  const handleClassifySaved = useCallback(() => {
    setClassifyTxn(null)
    handleCloseDrawer()
    if (selectedAccountId) {
      loadSankeyData(selectedAccountId, dateRange)
    }
  }, [selectedAccountId, dateRange, loadSankeyData, handleCloseDrawer])

  // ── export ────────────────────────────────────────────────────────────────

  const handleExport = async () => {
    if (!selectedAccountId) return
    setExportLoading(true)

    const from = toBangkokDateString(dateRange.startDate)
    const to   = toBangkokDateString(dateRange.endDate)

    const result = await exportSankeyCSV({ from, to, bankAccountId: selectedAccountId })

    if (result.success && result.csv && result.filename) {
      const blob = new Blob(['\ufeff' + result.csv], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = result.filename
      link.click()
      URL.revokeObjectURL(link.href)
    } else {
      setError(result.error ?? 'ส่งออกข้อมูลไม่สำเร็จ')
    }

    setExportLoading(false)
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 w-full min-w-0">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        {/* Bank account selector */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs text-muted-foreground font-medium">บัญชีธนาคาร CEO</span>
          <Select
            value={selectedAccountId ?? ''}
            onValueChange={(val) => setSelectedAccountId(val || null)}
          >
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="เลือกบัญชีธนาคาร" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((acct) => (
                <SelectItem key={acct.id} value={acct.id}>
                  {acct.bank_name} — {acct.account_number}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Date range picker */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs text-muted-foreground font-medium">ช่วงวันที่</span>
          <DateRangePicker
            value={dateRange}
            onChange={(range) => {
              setDateRange(range)
            }}
          />
        </div>

        {/* Export button */}
        <Button
          variant="outline"
          size="sm"
          disabled={!selectedAccountId || !payload || exportLoading}
          onClick={handleExport}
          className="self-end"
        >
          <Download className="mr-1.5 h-4 w-4" />
          {exportLoading ? 'กำลังส่งออก...' : 'ส่งออก CSV'}
        </Button>
      </div>

      {/* No account selected */}
      {!selectedAccountId && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>เลือกบัญชีธนาคารส่วนตัวของ CEO เพื่อดูกระแสเงินสด</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="flex h-48 items-center justify-center text-muted-foreground text-sm">
          กำลังโหลดข้อมูล...
        </div>
      )}

      {/* Summary cards */}
      {!loading && payload && (
        <SankeySummaryCards
          summary={payload.summary}
          loading={false}
        />
      )}

      {/* Sankey chart */}
      {!loading && payload && (
        <SankeyChart
          payload={payload}
          onNodeClick={handleNodeClick}
        />
      )}

      {/* Drilldown drawer */}
      <SankeyDrilldownDrawer
        open={!!activeNodeId}
        nodeLabel={activeNodeLabel}
        rows={drilldownRows}
        loading={drilldownLoading}
        error={drilldownError}
        onClose={handleCloseDrawer}
        onClassify={(txn: SankeyTxnRow) => setClassifyTxn(txn)}
      />

      {/* Classify modal */}
      {classifyTxn && (
        <ClassifyTxnModal
          txn={classifyTxn}
          open={!!classifyTxn}
          onClose={() => setClassifyTxn(null)}
          onSaved={handleClassifySaved}
        />
      )}
    </div>
  )
}
