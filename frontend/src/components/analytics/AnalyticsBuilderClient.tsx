'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { getBangkokNow, formatBangkok } from '@/lib/bangkok-time'
import {
  type AnalyticsRow,
  type AnalyticsPreset,
  type AnalyticsDefinition,
  type MetricRef,
  isMetricAvailable,
  getMetricRefKey,
  getMetricSlot,
  migrateDefinition,
} from '@/types/analytics-builder'
import { VIEW_TEMPLATES } from '@/lib/analytics-templates'
import { validateExpression } from '@/lib/analytics-expression'
import {
  runAnalyticsBuilder,
  exportAnalyticsBuilderCSV,
  listAnalyticsPresets,
} from '@/app/(dashboard)/analytics/builder/actions'
import { MetricLibrary } from './MetricLibrary'
import { BuilderCanvas } from './BuilderCanvas'
import { ResultTable } from './ResultTable'
import { PresetManager } from './PresetManager'

// Compute Bangkok-local defaults
function getDefaultDates(): { start: string; end: string } {
  const now = getBangkokNow()
  const end = formatBangkok(now, 'yyyy-MM-dd')
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const start = formatBangkok(firstOfMonth, 'yyyy-MM-dd')
  return { start, end }
}

interface Props {
  initialPresets: AnalyticsPreset[]
}

export function AnalyticsBuilderClient({ initialPresets }: Props) {
  const defaults = getDefaultDates()

  const [metrics, setMetrics] = useState<MetricRef[]>([])
  const [dimension, setDimension] = useState<'date' | 'product'>('date')
  const [templateId, setTemplateId] = useState('')
  const [expression, setExpression] = useState('')
  const [expressionLabel, setExpressionLabel] = useState('')
  const [dateRange, setDateRange] = useState(defaults)
  const [rows, setRows] = useState<AnalyticsRow[]>([])
  const [running, setRunning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [presets, setPresets] = useState<AnalyticsPreset[]>(initialPresets)
  const [error, setError] = useState<string | null>(null)
  const [hasRun, setHasRun] = useState(false)

  function buildDefinition(): AnalyticsDefinition {
    return {
      metrics,
      expression,
      expressionLabel: expressionLabel || undefined,
      dateRange,
      dimension,
    }
  }

  function canRun(): boolean {
    if (metrics.length === 0) return false
    if (!dateRange.start || !dateRange.end) return false
    if (dateRange.start > dateRange.end) return false
    if (dimension === 'product') return false
    if (metrics.some((ref) => !isMetricAvailable(ref))) return false
    if (expression.trim()) {
      const slots = metrics.filter(isMetricAvailable).map(getMetricSlot)
      const err = validateExpression(expression, slots)
      if (err !== null) return false
    }
    return true
  }

  function handleAddMetric(ref: MetricRef) {
    const key = getMetricRefKey(ref)
    if (!metrics.some((m) => getMetricRefKey(m) === key)) {
      setMetrics((prev) => [...prev, ref])
    }
  }

  function applyTemplate(id: string) {
    const template = VIEW_TEMPLATES.find((t) => t.id === id)
    if (!template) return
    setMetrics(template.definition.metrics)
    setExpression(template.definition.expression)
    setExpressionLabel(template.definition.expressionLabel ?? '')
    setDimension(template.definition.dimension)
    setTemplateId(id)
    setRows([])
    setHasRun(false)
    setError(null)
  }

  async function handleRun() {
    setError(null)
    setRunning(true)
    const result = await runAnalyticsBuilder(buildDefinition())
    setRunning(false)
    if (!result.success) {
      setError(result.error ?? 'เกิดข้อผิดพลาด')
      return
    }
    setRows(result.rows ?? [])
    setHasRun(true)
  }

  async function handleExport() {
    setError(null)
    setExporting(true)
    const result = await exportAnalyticsBuilderCSV(buildDefinition())
    setExporting(false)
    if (!result.success || !result.csv || !result.filename) {
      setError(result.error ?? 'Export ล้มเหลว')
      return
    }
    const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handlePresetsReload() {
    const result = await listAnalyticsPresets()
    if (result.success && Array.isArray(result.data)) {
      setPresets(result.data)
    }
  }

  function handlePresetLoad(definition: AnalyticsDefinition) {
    const migrated = migrateDefinition(definition)
    setMetrics(migrated.metrics)
    setExpression(migrated.expression)
    setExpressionLabel(migrated.expressionLabel ?? '')
    setDateRange(migrated.dateRange)
    setDimension(migrated.dimension)
    setTemplateId('')
    setRows([])
    setHasRun(false)
    setError(null)
  }

  const computedLabel = expressionLabel.trim() || (expression.trim() ? 'Computed' : '')

  const unavailableCount = metrics.filter((ref) => !isMetricAvailable(ref)).length

  return (
    <div className="flex flex-col gap-4 p-6 min-h-screen">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Analytics Builder</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          สร้างรายงานแบบ custom โดยเลือก metrics และ expression
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Main 3-panel layout */}
      <div className="flex gap-4 items-start">
        {/* LEFT PANEL */}
        <div className="w-56 shrink-0 space-y-6 rounded-lg border bg-white p-4">
          <MetricLibrary addedMetrics={metrics} onAddMetric={handleAddMetric} />
          <div className="border-t pt-4">
            <PresetManager
              presets={presets}
              currentDefinition={buildDefinition()}
              onPresetLoad={handlePresetLoad}
              onPresetsReload={handlePresetsReload}
            />
          </div>
        </div>

        {/* CENTER PANEL */}
        <div className="flex-1 space-y-4">
          {/* Template selector */}
          <div className="rounded-lg border bg-white p-4">
            <p className="text-sm font-medium mb-2">View Template</p>
            <select
              value={templateId}
              onChange={(e) => {
                if (e.target.value) {
                  applyTemplate(e.target.value)
                } else {
                  setTemplateId('')
                }
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select a template…</option>
              {VIEW_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            {templateId && (
              <p className="text-xs text-muted-foreground mt-1">
                {VIEW_TEMPLATES.find((t) => t.id === templateId)?.description}
              </p>
            )}
          </div>

          {/* Warning: product dimension not supported */}
          {dimension === 'product' && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-amber-800 text-sm">
              <strong>Product dimension</strong> is not yet supported. Run is disabled.
              Use the Basics section to build a date-based report instead.
            </div>
          )}

          {/* Warning: unavailable metrics in canvas */}
          {unavailableCount > 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-amber-800 text-sm">
              {unavailableCount} unavailable metric{unavailableCount > 1 ? 's' : ''} in canvas
              (shown in red). Remove them to enable Run.
            </div>
          )}

          {/* Date range */}
          <div className="rounded-lg border bg-white p-4">
            <p className="text-sm font-medium mb-3">Date Range (Bangkok)</p>
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Start Date</label>
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <span className="text-muted-foreground mt-4">—</span>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">End Date</label>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              {dateRange.start > dateRange.end && (
                <p className="text-xs text-destructive mt-4">
                  Start must be before end
                </p>
              )}
            </div>
          </div>

          {/* Builder canvas */}
          <div className="rounded-lg border bg-white p-4">
            <BuilderCanvas
              metrics={metrics}
              expression={expression}
              expressionLabel={expressionLabel}
              onMetricsChange={setMetrics}
              onExpressionChange={setExpression}
              onExpressionLabelChange={setExpressionLabel}
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              onClick={handleRun}
              disabled={running || !canRun()}
              className="min-w-[100px]"
            >
              {running ? 'Running...' : 'Run'}
            </Button>
            {hasRun && rows.length > 0 && (
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={exporting || !canRun()}
              >
                {exporting ? 'Exporting...' : 'Export CSV'}
              </Button>
            )}
            {metrics.length === 0 && (
              <span className="text-xs text-muted-foreground">
                Add at least one metric to run
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Result table */}
      {hasRun && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              Results
              <span className="ml-2 text-xs text-muted-foreground font-normal">
                {rows.length} rows
              </span>
            </p>
          </div>
          <ResultTable
            rows={rows}
            metrics={metrics}
            computedLabel={computedLabel || undefined}
          />
        </div>
      )}
    </div>
  )
}
