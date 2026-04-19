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
import { Loader2, Eye, RefreshCw, PlayCircle } from 'lucide-react'
import { getRecentCogsRunsFromRunsTable, getActiveCogsRun } from '@/app/(dashboard)/inventory/cogs-run-actions'
import type { CogsRun, CogsSummaryJson } from '@/app/(dashboard)/inventory/cogs-run-actions'
import { formatBangkok } from '@/lib/bangkok-time'
import { ActiveRunBanner } from '@/components/inventory/ActiveRunBanner'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface RunHistorySectionProps {
  onViewDetails: (runId: string, summary: any) => void
  onContinueRun?: (dateFrom: string, dateTo: string) => void
  refreshTrigger?: number
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function extractStats(run: CogsRun) {
  const s = run.summary_json as CogsSummaryJson | null
  const isRunning = run.status === 'running'
  return {
    total:      isRunning ? (s?.total_so_far      ?? 0) : (s?.total      ?? 0),
    successful: isRunning ? (s?.successful_so_far ?? 0) : (s?.successful ?? 0),
    skipped:    isRunning ? (s?.skipped_so_far    ?? 0) : (s?.skipped    ?? 0),
    failed:     isRunning ? (s?.failed_so_far     ?? 0) : (s?.failed     ?? 0),
    partial:    s?.partial ?? 0,
    method:     s?.method  ?? 'FIFO',
    offsetCompleted: s?.offset_completed ?? 0,
  }
}

// ─────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────

function RunStatusBadge({ run }: { run: CogsRun }) {
  if (run.status === 'running') {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 text-xs">
        Running
      </Badge>
    )
  }
  if (run.status === 'failed') {
    const s = run.summary_json as CogsSummaryJson | null
    const offset = s?.offset_completed ?? 0
    if (offset > 0) {
      return (
        <Badge className="bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 text-xs">
          Timeout (resumable)
        </Badge>
      )
    }
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200 dark:bg-red-950/30 dark:text-red-300 text-xs">
        Failed
      </Badge>
    )
  }
  // success — derive from counts
  const { failed, partial, successful, total } = extractStats(run)
  if (failed > 0 && successful === 0 && partial === 0) {
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200 dark:bg-red-950/30 dark:text-red-300 text-xs">
        Failed
      </Badge>
    )
  }
  if (failed > 0 || partial > 0) {
    return (
      <Badge className="bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 text-xs">
        Partial
      </Badge>
    )
  }
  if (successful === 0 && total > 0) {
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

export function RunHistorySection({ onViewDetails, onContinueRun, refreshTrigger }: RunHistorySectionProps) {
  const [runs, setRuns] = useState<CogsRun[]>([])
  const [activeRun, setActiveRun] = useState<CogsRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    if (opts?.silent) {
      setIsRefreshing(true)
    } else {
      setLoading(true)
    }
    try {
      const [runsResult, activeRunResult] = await Promise.all([
        getRecentCogsRunsFromRunsTable(20),
        getActiveCogsRun(),
      ])
      setRuns(runsResult)
      setActiveRun(activeRunResult)
    } catch (err) {
      console.error('RunHistorySection: failed to load data', err)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [])

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

  useEffect(() => {
    loadData()
  }, [refreshTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {activeRun && (
        <ActiveRunBanner
          run={activeRun}
          onRefresh={() => loadData({ silent: true })}
          isRefreshing={isRefreshing}
        />
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {runs.length > 0 ? `แสดง ${runs.length} รายการล่าสุด` : 'ยังไม่มีประวัติการรัน Apply COGS'}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadData({ silent: true })}
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
                <TableHead className="text-right text-muted-foreground text-xs">Offset</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const stats = extractStats(run)
                const summary = run.summary_json as CogsSummaryJson | null
                const isResumable =
                  run.status === 'failed' &&
                  (summary?.offset_completed ?? 0) > 0 &&
                  run.date_from &&
                  run.date_to
                return (
                  <TableRow key={run.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatBangkok(new Date(run.created_at), 'dd/MM/yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {run.date_from && run.date_to
                        ? `${run.date_from} → ${run.date_to}`
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="text-xs">{stats.method}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <RunStatusBadge run={run} />
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {stats.total}
                    </TableCell>
                    <TableCell className="text-right text-green-600">
                      {stats.successful}
                    </TableCell>
                    <TableCell className="text-right">
                      {stats.partial > 0
                        ? <span className="text-orange-500 font-medium">{stats.partial}</span>
                        : <span className="text-muted-foreground">0</span>}
                    </TableCell>
                    <TableCell className="text-right text-yellow-600">
                      {stats.skipped}
                    </TableCell>
                    <TableCell className="text-right">
                      {stats.failed > 0
                        ? <span className="text-red-600 font-medium">{stats.failed}</span>
                        : <span className="text-muted-foreground">0</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {stats.offsetCompleted > 0
                        ? stats.offsetCompleted
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="ดูรายละเอียด"
                          onClick={() =>
                            onViewDetails(run.id, {
                              start_date: run.date_from,
                              end_date: run.date_to,
                              method: stats.method,
                              total: stats.total,
                              successful: stats.successful,
                              partial: stats.partial,
                              skipped: stats.skipped,
                              failed: stats.failed,
                            })
                          }
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {isResumable && onContinueRun && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title={`ต่อจากที่ค้าง (offset ${stats.offsetCompleted})`}
                            className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                            onClick={() => onContinueRun(run.date_from!, run.date_to!)}
                          >
                            <PlayCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
