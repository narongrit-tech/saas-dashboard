'use client'

import { useState, useCallback } from 'react'
import { Loader2, ChevronDown, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ProdForecastSnapshot, ProdFormulaConfig } from '@/types/production-planning'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SavePayload {
  formula_id: string
  label: string | null
  fg_warehouse_qty: number
  fg_factory_qty: number
  burn_rate: number
  call_rounds: Array<{ date: string; qty: string }>
  prod_rounds: Array<{ date: string; qty: string; leadDays?: string }>
  tubes_warehouse_qty: number | null
  tubes_factory_qty: number | null
  tube_sent_rounds: Array<{ date: string; qty: string }>
  tube_new_rounds: Array<{ date: string; qty: string }>
  oil_qty_kg: number | null
  oil_rounds: Array<{ date: string; qty: string }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function thaiDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function thaiDateShort(d: Date): string {
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function parseRoundDate(s: string): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function parseRoundQty(s: string): number {
  const n = parseInt(s.replace(/,/g, ''), 10)
  return isNaN(n) ? 0 : n
}

// Simplified: find first warehouse runout from call_rounds + prod_rounds
function estimateRunout(snap: ProdForecastSnapshot, formula: ProdFormulaConfig): string | null {
  const burn = snap.burn_rate
  if (burn <= 0) return null

  const today = new Date(snap.created_at)
  today.setHours(0, 0, 0, 0)

  let warehouse = snap.fg_warehouse_qty

  const calls = snap.call_rounds
    .map(r => ({ date: parseRoundDate(r.date), qty: parseRoundQty(r.qty) }))
    .filter((r): r is { date: Date; qty: number } => r.date !== null && r.qty > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  if (calls.length === 0) {
    const daysLeft = Math.ceil(warehouse / burn)
    return thaiDateShort(addDays(today, daysLeft))
  }

  let current = today
  for (const c of calls) {
    const daysToCall = Math.round((c.date.getTime() - current.getTime()) / 86400000)
    const burned = burn * daysToCall
    if (warehouse - burned <= 0) {
      const daysToDepleted = Math.ceil(warehouse / burn)
      return thaiDateShort(addDays(current, daysToDepleted))
    }
    warehouse -= burned
    warehouse += c.qty
    current = c.date
  }

  const daysLeft = Math.ceil(warehouse / burn)
  return thaiDateShort(addDays(current, daysLeft))
}

// ── SaveForecastBar ───────────────────────────────────────────────────────────

export function SaveForecastBar({
  payload,
  onSaved,
}: {
  payload: Omit<SavePayload, 'label'>
  onSaved: (snap: ProdForecastSnapshot) => void
}) {
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/production-planning/forecasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, label: label.trim() || null }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      onSaved(data.data as ProdForecastSnapshot)
      setLabel('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="text"
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="ชื่อแผน (ไม่บังคับ)"
        className="h-7 text-xs border rounded px-2 w-40 bg-background"
      />
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleSave} disabled={saving}>
        {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
        บันทึกแผน
      </Button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}

// ── SavedForecastsList ────────────────────────────────────────────────────────

export function SavedForecastsList({
  snapshots,
  formula,
  onDelete,
}: {
  snapshots: ProdForecastSnapshot[]
  formula: ProdFormulaConfig
  onDelete: (id: string) => void
}) {
  if (snapshots.length === 0) return null

  return (
    <div className="rounded-lg border bg-muted/10 p-3 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        ประวัติแผน ({snapshots.length})
      </p>
      {snapshots.map(snap => (
        <SnapshotRow key={snap.id} snap={snap} formula={formula} onDelete={onDelete} />
      ))}
    </div>
  )
}

function SnapshotRow({
  snap, formula, onDelete,
}: {
  snap: ProdForecastSnapshot
  formula: ProdFormulaConfig
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const runout = estimateRunout(snap, formula)

  const activeCallRounds = snap.call_rounds.filter(r => r.date && parseInt(r.qty) > 0)
  const activeProdRounds = snap.prod_rounds.filter(r => r.date && parseInt(r.qty) > 0)

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('ลบแผนนี้?')) return
    setDeleting(true)
    try {
      await fetch(`/api/production-planning/forecasts?id=${snap.id}`, { method: 'DELETE' })
      onDelete(snap.id)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="border rounded bg-background text-xs">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/20"
        onClick={() => setExpanded(p => !p)}
      >
        <span className="text-muted-foreground shrink-0">{thaiDate(snap.created_at)}</span>
        {snap.label && <span className="font-medium truncate max-w-32">{snap.label}</span>}
        <span className="text-muted-foreground">Burn {Number(snap.burn_rate).toFixed(1)}/วัน</span>
        <span className="text-muted-foreground">
          เรียก {activeCallRounds.length} รอบ · ผลิต {activeProdRounds.length} รอบ
        </span>
        {runout && <span className="text-red-500 ml-auto shrink-0">หมด {runout}</span>}
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-muted-foreground hover:text-red-500 shrink-0 ml-1"
        >
          {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </button>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t">
          {/* Stock at save time */}
          <div className="pt-2 flex gap-4 text-muted-foreground">
            <span>🏠 คลังเรา <span className="font-mono text-foreground">{Number(snap.fg_warehouse_qty).toLocaleString()}</span></span>
            <span>🏭 โรงงาน <span className="font-mono text-foreground">{Number(snap.fg_factory_qty).toLocaleString()}</span></span>
          </div>

          {/* Call rounds */}
          {activeCallRounds.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-1">เรียก FG จากโรงงาน:</p>
              <div className="space-y-0.5">
                {activeCallRounds.map((r, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="text-muted-foreground">{i + 1}.</span>
                    <span>{r.date}</span>
                    <span className="font-mono">{parseInt(r.qty).toLocaleString()} หลอด</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prod rounds */}
          {activeProdRounds.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-1">สั่งผลิต:</p>
              <div className="space-y-0.5">
                {activeProdRounds.map((r, i) => {
                  const lead = Math.max(15, parseInt(r.leadDays ?? '') || formula.lead_time_production_min_days)
                  const d = parseRoundDate(r.date)
                  const recvDate = d ? thaiDateShort(addDays(d, lead)) : null
                  return (
                    <div key={i} className="flex gap-3">
                      <span className="text-muted-foreground">{i + 1}.</span>
                      <span>{r.date}</span>
                      <span className="font-mono">{parseInt(r.qty).toLocaleString()} หลอด</span>
                      {recvDate && <span className="text-green-600 dark:text-green-400">→ รับ {recvDate}</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── useSavedForecasts hook ────────────────────────────────────────────────────

export function useSavedForecasts(formulaId: string) {
  const [snapshots, setSnapshots] = useState<ProdForecastSnapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/production-planning/forecasts?formulaId=${formulaId}`)
      const data = await res.json()
      if (data.success) setSnapshots(data.data)
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [formulaId, loading])

  const addSnapshot = useCallback((snap: ProdForecastSnapshot) => {
    setSnapshots(prev => [snap, ...prev])
  }, [])

  const removeSnapshot = useCallback((id: string) => {
    setSnapshots(prev => prev.filter(s => s.id !== id))
  }, [])

  return { snapshots, loading, loaded, load, addSnapshot, removeSnapshot }
}
