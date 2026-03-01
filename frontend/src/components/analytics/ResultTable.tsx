'use client'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getMetricLabel,
  getMetricSlot,
  getMetricFormat,
  getMetricRefKey,
  type MetricRef,
  type AnalyticsRow,
} from '@/types/analytics-builder'

interface ResultTableProps {
  rows: AnalyticsRow[]
  metrics: MetricRef[]
  computedLabel?: string
}

function formatCurrency(value: number): string {
  return value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatNumber(value: number): string {
  return value.toLocaleString('th-TH', { maximumFractionDigits: 0 })
}

function formatMetricValue(ref: MetricRef, value: number): string {
  return getMetricFormat(ref) === 'currency' ? formatCurrency(value) : formatNumber(value)
}

function formatComputed(value: number | null): string {
  if (value === null) return '÷0'
  return formatCurrency(value)
}

export function ResultTable({ rows, metrics, computedLabel }: ResultTableProps) {
  const showComputed = !!computedLabel

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
        ไม่พบข้อมูล
      </div>
    )
  }

  // Compute totals keyed by slot
  const totals: Record<string, number> = {}
  for (const ref of metrics) {
    const slot = getMetricSlot(ref)
    totals[slot] = rows.reduce((sum, row) => sum + (row.metrics[slot] ?? 0), 0)
  }
  const computedTotal = showComputed
    ? rows.reduce((sum, row) => (row.computed !== null ? sum + row.computed : sum), 0)
    : null

  return (
    <div className="rounded-lg border bg-white overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">Date</TableHead>
            {metrics.map((ref) => (
              <TableHead key={getMetricRefKey(ref)} className="whitespace-nowrap text-right">
                {getMetricLabel(ref)}
              </TableHead>
            ))}
            {showComputed && (
              <TableHead className="whitespace-nowrap text-right font-semibold">
                {computedLabel}
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.date}>
              <TableCell className="font-mono text-sm">{row.date}</TableCell>
              {metrics.map((ref) => {
                const slot = getMetricSlot(ref)
                return (
                  <TableCell key={getMetricRefKey(ref)} className="text-right text-sm tabular-nums">
                    {formatMetricValue(ref, row.metrics[slot] ?? 0)}
                  </TableCell>
                )
              })}
              {showComputed && (
                <TableCell className="text-right text-sm tabular-nums font-medium">
                  {row.computed === null ? (
                    <span className="text-muted-foreground">÷0</span>
                  ) : (
                    formatComputed(row.computed)
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}

          {/* Total row */}
          <TableRow className="border-t-2 bg-muted/30 font-semibold">
            <TableCell className="text-sm">Total</TableCell>
            {metrics.map((ref) => {
              const slot = getMetricSlot(ref)
              return (
                <TableCell key={getMetricRefKey(ref)} className="text-right text-sm tabular-nums">
                  {formatMetricValue(ref, totals[slot] ?? 0)}
                </TableCell>
              )
            })}
            {showComputed && (
              <TableCell className="text-right text-sm tabular-nums">
                {computedTotal !== null ? formatComputed(computedTotal) : '-'}
              </TableCell>
            )}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}
