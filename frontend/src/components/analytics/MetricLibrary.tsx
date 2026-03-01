'use client'

import { useState, useEffect } from 'react'
import {
  ALL_METRIC_KEYS,
  getMetricRefKey,
  getMetricLabel,
  getMetricFormat,
  getUnavailableReason,
  type MetricRef,
} from '@/types/analytics-builder'
import { getExpenseSubcategories } from '@/app/(dashboard)/analytics/builder/actions'

// ─── Static lists ──────────────────────────────────────────────────────────────

const BASICS_REFS: MetricRef[] = ALL_METRIC_KEYS.map((key) => ({ kind: 'metric' as const, key }))

const ADS_REFS: MetricRef[] = [
  { kind: 'ads_spend' as const, campaignType: 'all' as const },
  { kind: 'ads_spend' as const, campaignType: 'product' as const },
  { kind: 'ads_spend' as const, campaignType: 'live' as const },
  { kind: 'ads_spend' as const, campaignType: 'aware' as const },
]

const FUNNEL_REFS: MetricRef[] = [
  { kind: 'funnel' as const, metric: 'orders' as const, status: 'all' as const },
  { kind: 'funnel' as const, metric: 'orders' as const, status: 'cancel' as const },
  { kind: 'funnel' as const, metric: 'orders' as const, status: 'refund' as const },
  { kind: 'funnel' as const, metric: 'revenue' as const, status: 'all' as const },
  { kind: 'funnel' as const, metric: 'revenue' as const, status: 'cancel' as const },
  { kind: 'funnel' as const, metric: 'revenue' as const, status: 'refund' as const },
]

const EXPENSE_CATEGORIES = ['Operating', 'COGS', 'Advertising', 'Tax'] as const
type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

// ─── Props ────────────────────────────────────────────────────────────────────

interface MetricLibraryProps {
  addedMetrics: MetricRef[]
  onAddMetric: (ref: MetricRef) => void
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-3">
      {title}
    </p>
  )
}

// ─── MetricLibrary ────────────────────────────────────────────────────────────

export function MetricLibrary({ addedMetrics, onAddMetric }: MetricLibraryProps) {
  const addedKeys = new Set(addedMetrics.map(getMetricRefKey))

  const [expCategory, setExpCategory] = useState<ExpenseCategory>('Operating')
  const [subcategories, setSubcategories] = useState<string[]>([])
  const [loadingSubs, setLoadingSubs] = useState(false)
  const [selectedSub, setSelectedSub] = useState('')

  useEffect(() => {
    setSelectedSub('')
    setLoadingSubs(true)
    getExpenseSubcategories(expCategory).then((result) => {
      setSubcategories(result.data ?? [])
      setLoadingSubs(false)
    })
  }, [expCategory])

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, ref: MetricRef) {
    e.dataTransfer.setData('text/plain', JSON.stringify(ref))
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleAddExpense() {
    if (!selectedSub) return
    const ref: MetricRef = {
      kind: 'expense_subcategory',
      category: expCategory,
      subcategory: selectedSub,
    }
    if (!addedKeys.has(getMetricRefKey(ref))) {
      onAddMetric(ref)
    }
  }

  return (
    <div className="space-y-1">
      {/* ── Basics ─────────────────────────────────── */}
      <SectionHeader title="Basics" />
      <div className="space-y-1">
        {BASICS_REFS.map((ref) => {
          const key = getMetricRefKey(ref)
          const isAdded = addedKeys.has(key)
          const isCurrency = getMetricFormat(ref) === 'currency'
          return (
            <div
              key={key}
              draggable
              onDragStart={(e) => handleDragStart(e, ref)}
              className={[
                'flex cursor-grab items-center justify-between rounded-md border px-3 py-2 text-sm select-none',
                'transition-colors active:cursor-grabbing',
                isAdded
                  ? 'border-primary/30 bg-primary/5 text-primary/60'
                  : 'border-border bg-white hover:bg-accent hover:text-accent-foreground',
              ].join(' ')}
            >
              <span className="font-medium">{getMetricLabel(ref)}</span>
              <span className="text-xs text-muted-foreground">{isCurrency ? '฿' : '#'}</span>
            </div>
          )
        })}
      </div>

      {/* ── Ads by Campaign ──────────────────────── */}
      <SectionHeader title="Ads by Campaign" />
      <div className="space-y-1">
        {ADS_REFS.map((ref) => {
          const key = getMetricRefKey(ref)
          const isAdded = addedKeys.has(key)
          return (
            <div
              key={key}
              draggable
              onDragStart={(e) => handleDragStart(e, ref)}
              className={[
                'flex cursor-grab items-center justify-between rounded-md border px-3 py-2 text-sm select-none',
                'transition-colors active:cursor-grabbing',
                isAdded
                  ? 'border-primary/30 bg-primary/5 text-primary/60'
                  : 'border-border bg-white hover:bg-accent hover:text-accent-foreground',
              ].join(' ')}
            >
              <span className="font-medium">{getMetricLabel(ref)}</span>
              <span className="text-xs text-muted-foreground">฿</span>
            </div>
          )
        })}
      </div>

      {/* ── Sales Funnel (N/A) ────────────────────── */}
      <SectionHeader title="Sales Funnel" />
      <div className="space-y-1">
        {FUNNEL_REFS.map((ref) => {
          const key = getMetricRefKey(ref)
          const reason = getUnavailableReason(ref) ?? 'Unavailable'
          return (
            <div
              key={key}
              title={reason}
              className="flex cursor-not-allowed items-center justify-between rounded-md border border-dashed border-muted-foreground/30 px-3 py-2 text-sm select-none opacity-40"
            >
              <span className="font-medium">{getMetricLabel(ref)}</span>
              <span className="text-xs font-semibold text-muted-foreground">N/A</span>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">Funnel metrics not yet available</p>

      {/* ── Expense Subcategory ───────────────────── */}
      <SectionHeader title="Expense Subcategory" />
      <div className="space-y-2 pt-1">
        <select
          value={expCategory}
          onChange={(e) => setExpCategory(e.target.value as ExpenseCategory)}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={selectedSub}
          onChange={(e) => setSelectedSub(e.target.value)}
          disabled={loadingSubs || subcategories.length === 0}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
        >
          <option value="">
            {loadingSubs
              ? 'Loading...'
              : subcategories.length === 0
              ? '(no subcategories)'
              : 'Select subcategory…'}
          </option>
          {subcategories.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          onClick={handleAddExpense}
          disabled={!selectedSub}
          className="w-full rounded-md border border-primary/50 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          + Add to Canvas
        </button>
      </div>

      <p className="text-xs text-muted-foreground pt-2">Drag metrics to the canvas</p>
    </div>
  )
}
