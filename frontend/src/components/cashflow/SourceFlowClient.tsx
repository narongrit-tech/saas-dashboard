'use client'

import { useState, useEffect, useCallback } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertCircle, Download, Info, Loader2 } from 'lucide-react'
import { DateRangePicker, DateRangeResult } from '@/components/shared/DateRangePicker'
import { getBangkokNow, formatBangkok, startOfDayBangkok } from '@/lib/bangkok-time'
import {
  getSankeyData,
  getSankeyDrilldown,
  exportSankeyCSV,
} from '@/app/(dashboard)/cashflow/source-flow/actions'
import type { SankeyPayload, SankeyTxnRow } from '@/types/cashflow-sankey'
import SankeySummaryCards from './SankeySummaryCards'
import SankeyChart from './SankeyChart'
import SankeyDrilldownDrawer from './SankeyDrilldownDrawer'
import ClassifyTxnModal from './ClassifyTxnModal'

const MAX_DRILLDOWN_ROWS = 200

export default function SourceFlowClient() {
  const [dateRange, setDateRange] = useState<DateRangeResult>(() => {
    const now = getBangkokNow()
    const start = new Date(now)
    start.setDate(start.getDate() - 29)
    return { startDate: startOfDayBangkok(start), endDate: getBangkokNow() }
  })
  const [payload, setPayload] = useState<SankeyPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportLoading, setExportLoading] = useState(false)

  // Drilldown state
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [activeNodeLabel, setActiveNodeLabel] = useState('')
  const [drilldownRows, setDrilldownRows] = useState<SankeyTxnRow[]>([])
  const [drilldownLoading, setDrilldownLoading] = useState(false)
  const [drilldownError, setDrilldownError] = useState<string | null>(null)

  // Classify modal
  const [classifyTxn, setClassifyTxn] = useState<SankeyTxnRow | null>(null)

  const from = formatBangkok(dateRange.startDate, 'yyyy-MM-dd')
  const to = formatBangkok(dateRange.endDate, 'yyyy-MM-dd')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getSankeyData({ from, to })
      if (!result.success || !result.data) {
        setError(result.error ?? 'ไม่สามารถโหลดข้อมูลได้')
        setPayload(null)
      } else {
        setPayload(result.data)
      }
    } catch {
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล')
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleExport = async () => {
    setExportLoading(true)
    setError(null)
    try {
      const result = await exportSankeyCSV({ from, to })
      if (!result.success || !result.csv || !result.filename) {
        setError(result.error ?? 'เกิดข้อผิดพลาดในการ export')
        return
      }
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = result.filename
      link.click()
      URL.revokeObjectURL(link.href)
    } catch {
      setError('เกิดข้อผิดพลาดในการ export')
    } finally {
      setExportLoading(false)
    }
  }

  const handleNodeClick = useCallback(
    async (nodeId: string, label: string) => {
      if (!payload) return
      const txnIds = payload.drilldown[nodeId] ?? []
      if (txnIds.length === 0) return

      setActiveNodeId(nodeId)
      setActiveNodeLabel(label)
      setDrilldownRows([])
      setDrilldownError(null)
      setDrilldownLoading(true)

      const result = await getSankeyDrilldown({
        txnIds: txnIds.slice(0, MAX_DRILLDOWN_ROWS),
      })

      if (!result.success || !result.data) {
        setDrilldownError(result.error ?? 'ไม่สามารถโหลดรายการได้')
      } else {
        setDrilldownRows(result.data)
      }
      setDrilldownLoading(false)
    },
    [payload],
  )

  const handleCloseDrawer = useCallback(() => {
    setActiveNodeId(null)
    setActiveNodeLabel('')
    setDrilldownRows([])
    setDrilldownError(null)
  }, [])

  const handleClassifySaved = useCallback(() => {
    setClassifyTxn(null)
    handleCloseDrawer()
    fetchData()
  }, [fetchData, handleCloseDrawer])

  const isEmpty = !loading && payload !== null && payload.nodes.length === 0

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
        <Button
          variant="outline"
          onClick={fetchData}
          disabled={loading}
          size="icon"
          title="รีเฟรชข้อมูล"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          )}
        </Button>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={exportLoading || !payload}
        >
          <Download className="mr-2 h-4 w-4" />
          {exportLoading ? 'กำลัง export...' : 'Export CSV'}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error}{' '}
            <button
              className="underline ml-1"
              onClick={() => { setError(null); fetchData() }}
            >
              ลองใหม่
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* Summary cards */}
      <SankeySummaryCards summary={payload?.summary ?? null} loading={loading} />

      {/* Empty state */}
      {isEmpty && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            ไม่พบธุรกรรมในช่วงวันที่ที่เลือก กรุณานำเข้า Bank Statement ก่อน
          </AlertDescription>
        </Alert>
      )}

      {/* Sankey chart */}
      {!loading && payload && payload.nodes.length > 0 && (
        <div className="rounded-lg border bg-white p-4 overflow-x-auto">
          <p className="mb-3 text-xs text-muted-foreground">
            คลิกที่ node เพื่อดูรายการธุรกรรม
          </p>
          <SankeyChart payload={payload} onNodeClick={handleNodeClick} />
        </div>
      )}

      {/* Drilldown drawer */}
      <SankeyDrilldownDrawer
        open={!!activeNodeId}
        nodeLabel={activeNodeLabel}
        rows={drilldownRows}
        loading={drilldownLoading}
        error={drilldownError}
        onClose={handleCloseDrawer}
        onClassify={(txn) => setClassifyTxn(txn)}
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
