'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import {
  getMetricRefKey,
  getMetricLabel,
  getMetricSlot,
  isMetricAvailable,
  type MetricRef,
} from '@/types/analytics-builder'
import { validateExpression } from '@/lib/analytics-expression'

interface BuilderCanvasProps {
  metrics: MetricRef[]
  expression: string
  expressionLabel: string
  onMetricsChange: (metrics: MetricRef[]) => void
  onExpressionChange: (expression: string) => void
  onExpressionLabelChange: (label: string) => void
}

export function BuilderCanvas({
  metrics,
  expression,
  expressionLabel,
  onMetricsChange,
  onExpressionChange,
  onExpressionLabelChange,
}: BuilderCanvasProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  // Validate expression only against available metric slots
  const availableSlots = metrics.filter(isMetricAvailable).map(getMetricSlot)
  const expressionError = expression.trim()
    ? validateExpression(expression, availableSlots)
    : null

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(false)
    if (draggedIndex !== null) {
      // Canvas chip reorder — handled by handleChipDrop
      setDraggedIndex(null)
      return
    }
    try {
      const ref = JSON.parse(e.dataTransfer.getData('text/plain')) as MetricRef
      const key = getMetricRefKey(ref)
      if (!metrics.some((m) => getMetricRefKey(m) === key)) {
        onMetricsChange([...metrics, ref])
      }
    } catch {
      // Invalid drag data — ignore
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }

  function handleDragLeave() {
    setIsDragOver(false)
  }

  function removeMetric(key: string) {
    onMetricsChange(metrics.filter((m) => getMetricRefKey(m) !== key))
  }

  function handleChipDragStart(e: React.DragEvent<HTMLDivElement>, index: number) {
    setDraggedIndex(index)
    e.dataTransfer.setData('text/plain', JSON.stringify(metrics[index]))
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleChipDrop(e: React.DragEvent<HTMLDivElement>, targetIndex: number) {
    e.preventDefault()
    e.stopPropagation()
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null)
      return
    }
    const reordered = [...metrics]
    const [moved] = reordered.splice(draggedIndex, 1)
    reordered.splice(targetIndex, 0, moved)
    onMetricsChange(reordered)
    setDraggedIndex(null)
  }

  function handleChipDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  function clearAll() {
    onMetricsChange([])
    onExpressionChange('')
    onExpressionLabelChange('')
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-foreground">Canvas</p>
          {metrics.length > 0 && (
            <button
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={[
            'min-h-[72px] rounded-lg border-2 border-dashed p-3 transition-colors',
            isDragOver
              ? 'border-primary bg-primary/5'
              : 'border-border bg-muted/30',
          ].join(' ')}
        >
          {metrics.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-3">
              Drop metrics here
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {metrics.map((ref, index) => {
                const key = getMetricRefKey(ref)
                const available = isMetricAvailable(ref)
                const isExpenseSub = ref.kind === 'expense_subcategory'
                return (
                  <div
                    key={key}
                    draggable={available}
                    onDragStart={(e) => available ? handleChipDragStart(e, index) : undefined}
                    onDrop={(e) => handleChipDrop(e, index)}
                    onDragOver={handleChipDragOver}
                    className={[
                      'flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium select-none',
                      available && isExpenseSub
                        ? 'cursor-grab active:cursor-grabbing bg-amber-50 border-amber-300 text-amber-800'
                        : available
                        ? 'cursor-grab active:cursor-grabbing bg-primary/10 border-primary/20 text-primary'
                        : 'cursor-default bg-red-50 border-red-200 text-red-700',
                    ].join(' ')}
                  >
                    <span>{getMetricLabel(ref)}</span>
                    {!available && (
                      <span className="ml-1 text-xs font-bold bg-red-100 rounded px-1">N/A</span>
                    )}
                    {available && isExpenseSub && (
                      <span
                        className="ml-1 text-xs text-amber-500"
                        title="Verify subcategory name matches your data"
                      >
                        ⚠
                      </span>
                    )}
                    <button
                      onClick={() => removeMetric(key)}
                      className="ml-0.5 rounded-full hover:bg-black/10 p-0.5 transition-colors"
                      title={`Remove ${getMetricLabel(ref)}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Expression */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">
          Expression
          <span className="ml-1 text-xs text-muted-foreground font-normal">
            (optional — e.g. revenue - cogs - ads_product)
          </span>
        </label>
        <textarea
          value={expression}
          onChange={(e) => onExpressionChange(e.target.value)}
          placeholder="revenue - cogs - ads_product - ads_live"
          rows={2}
          className={[
            'w-full rounded-md border bg-background px-3 py-2 text-sm font-mono',
            'resize-none focus:outline-none focus:ring-2 focus:ring-primary',
            expressionError
              ? 'border-destructive focus:ring-destructive'
              : 'border-input',
          ].join(' ')}
        />
        {expressionError && (
          <p className="text-xs text-destructive">{expressionError}</p>
        )}
        {!expressionError && expression.trim() && (
          <p className="text-xs text-green-600">Expression is valid</p>
        )}
      </div>

      {/* Expression label */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">
          Computed Column Label
          <span className="ml-1 text-xs text-muted-foreground font-normal">
            (header for the computed column)
          </span>
        </label>
        <input
          type="text"
          value={expressionLabel}
          onChange={(e) => onExpressionLabelChange(e.target.value)}
          placeholder="Gross Profit"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
    </div>
  )
}
