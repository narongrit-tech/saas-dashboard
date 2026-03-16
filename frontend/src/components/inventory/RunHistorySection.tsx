'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Loader2, Eye, RefreshCw, ExternalLink } from 'lucide-react'
import { getCogsApplyRuns } from '@/app/(dashboard)/inventory/actions'
import { getActiveCogsRun } from '@/app/(dashboard)/inventory/cogs-run-actions'
import type { CogsRun } from '@/app/(dashboard)/inventory/cogs-run-actions'
import { formatBangkok } from '@/lib/bangkok-time'
import { ActiveRunBanner } from '@/components/inventory/ActiveRunBanner'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface Run {
  id: string
  start_date: string
  end_date: string
  method: string
  total: number
  eligible: number
  successful: number
  skipped: number
  failed: number
  partial: number
  created_at: string
}

interface RunHistorySectionProps {
  onViewDetails: (runId: string, summary: any) => void
  refreshTrigger?: number
}

// ─────────────────────────────────────────────
// Status badge helper
// ─────────────────────────────────────────────

function RunStatusBadge({ run }: { run: Run }) {
  if (run.failed > 0 && run.successful === 0 && run.partial === 0) {
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200 dark:bg-red-950/30 dark:text-red-300 text-xs">
        Failed
      </Badge>
    )
  }
  if (run.failed > 0 || run.partial > 0) {
    return (
      <Badge className="bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 text-xs">
        Partial
      </Badge>
    )
  }
  if (run.successful === 0 && run.total > 0) {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-300 text-xs">
        Skipped
      </Badge>
    )
  }
  return (
    <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-950/30 dark:text-green-300 text-xs">
      Complete
    </Badge>
  )
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

const POLL_INTERVAL_MS = 12_000

export function RunHistorySection({ onViewDetails, refreshTrigger }: RunHistorySectionProps) {
  const [runs, setRuns] = useState<Run[]>([])
  const [activeRun, setActiveRun] = useState<CogsRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Data fetch ───────────────────────────────
  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    if (opts?.silent) {
      setIsRefreshing(true)
    } else {
      setLoading(true)
    }

    try {
      const [runsResult, activeRunResult] = await Promise.all([
        getCogsApplyRuns(20),
        getActiveCogsRun(),
      ])

      if (runsResult.success) {
        setRuns(runsResult.data)
      }
      setActiveRun(activeRunResult)
    } catch (err) {
      console.error('RunHistorySection: failed to load data', err)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  // ── Poll while a run is active ───────────────
  useEffect(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }

    if (activeRun) {
      pollTimerRef.current = setTimeout(() => {
        loadData({ silent: true })
      }, POLL_INTERVAL_MS)
    }

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [activeRun, loadData])

  // ── Initial load + refreshTrigger ───────────
  useEffect(() => {
    loadData()
  }, [refreshTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Manual refresh ───────────────────────────
  function handleManualRefresh() {
    loadData({ silent: true })
  }

  // ── Render ───────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Active run banner */}
      {activeRun && (
        <ActiveRunBanner
          run={activeRun}
          onRefresh={handleManualRefresh}
          isRefreshing={isRefreshing}
        />
      )}

      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {runs.length > 0 ? `แสดง ${runs.length} รายการล่าสุด` : 'ยังไม่มีประวัติการรัน Apply COGS'}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleManualRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-1.5" />
          )}
          Refresh
        </Button>
      </div>

      {/* Empty state */}
      {runs.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          ยังไม่มีประวัติการรัน Apply COGS
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run Date</TableHead>
                <TableHead>Date Range</TableHead>
                <TableHead className="text-center">Method</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">
                  <span className="text-green-700">OK</span>
                </TableHead>
                <TableHead className="text-right">
                  <span className="text-orange-500">Part</span>
                </TableHead>
                <TableHead className="text-right">
                  <span className="text-yellow-600">Skip</span>
                </TableHead>
                <TableHead className="text-right">
                  <span className="text-red-600">Fail</span>
                </TableHead>
                <TableHead className="text-center">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatBangkok(new Date(run.created_at), 'dd/MM/yyyy HH:mm')}
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {run.start_date && run.end_date
                      ? `${run.start_date} → ${run.end_date}`
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className="text-xs">{run.method}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <RunStatusBadge run={run} />
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {run.total}
                  </TableCell>
                  <TableCell className="text-right text-green-600">
                    {run.successful}
                  </TableCell>
                  <TableCell className="text-right">
                    {run.partial > 0
                      ? <span className="text-orange-500 font-medium">{run.partial}</span>
                      : <span className="text-muted-foreground">0</span>}
                  </TableCell>
                  <TableCell className="text-right text-yellow-600">
                    {run.skipped}
                  </TableCell>
                  <TableCell className="text-right">
                    {run.failed > 0
                      ? <span className="text-red-600 font-medium">{run.failed}</span>
                      : <span className="text-muted-foreground">0</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      {/* Modal details (existing) */}
                      <Button
                        variant="ghost"
                        size="sm"
                        title="ดูรายละเอียด (modal)"
                        onClick={() =>
                          onViewDetails(run.id, {
                            start_date: run.start_date,
                            end_date: run.end_date,
                            method: run.method,
                            total: run.total,
                            successful: run.successful,
                            partial: run.partial,
                            skipped: run.skipped,
                            failed: run.failed,
                          })
                        }
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
