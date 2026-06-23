'use client'

import { useState, useMemo } from 'react'
import { Plus, X } from 'lucide-react'
import type { FormulaStatus, ProdFormulaConfig } from '@/types/production-planning'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TubeRound { id: string; date: string; qty: string }

interface TubeRow {
  dayOffset: number
  date: Date
  type: 'tube_sent' | 'tube_new_order' | 'prod_consume'
  qty: number
  warehouseAfter: number
  factoryAfter: number
  shortfall?: number
}

// ── Shared from parent (must match page.tsx) ──────────────────────────────────

interface PlannerRound { id: string; date: string; qty: string; leadDays?: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId() { return Math.random().toString(36).slice(2, 9) }

function thaiDate(date: Date): string {
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + Math.round(days))
  return d
}

function parseDate(s: string): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function parseQty(s: string): number {
  const n = parseInt(s.replace(/,/g, ''), 10)
  return isNaN(n) ? 0 : n
}

// ── Timeline computation ──────────────────────────────────────────────────────

type EvType = 'tube_sent' | 'tube_new_order' | 'prod_consume'

function computeTubesTimeline(
  tubesWarehouse: number,
  tubesFactory: number,
  tubeSentRounds: TubeRound[],
  tubeNewRounds: TubeRound[],
  prodRounds: PlannerRound[],
  today: Date,
  defaultLeadDays: number,
): TubeRow[] {
  type RawEv = { date: Date; qty: number; type: EvType }

  const sentEvs: RawEv[] = tubeSentRounds
    .map(r => ({ date: parseDate(r.date), qty: parseQty(r.qty) }))
    .filter((r): r is { date: Date; qty: number } => r.date !== null && r.qty > 0)
    .map(r => ({ ...r, type: 'tube_sent' as const }))

  const newOrderEvs: RawEv[] = tubeNewRounds
    .map(r => ({ date: parseDate(r.date), qty: parseQty(r.qty) }))
    .filter((r): r is { date: Date; qty: number } => r.date !== null && r.qty > 0)
    .map(r => ({ ...r, type: 'tube_new_order' as const }))

  const prodEvs: RawEv[] = prodRounds
    .map(r => {
      const d = parseDate(r.date)
      const qty = parseQty(r.qty)
      const lead = Math.max(15, parseInt(r.leadDays ?? '') || defaultLeadDays)
      return d && qty > 0 ? { date: addDays(d, lead), qty, type: 'prod_consume' as const } : null
    })
    .filter((r): r is { date: Date; qty: number; type: 'prod_consume' } => r !== null)

  const allEvs = [...sentEvs, ...newOrderEvs, ...prodEvs]
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  if (allEvs.length === 0) return []

  let warehouse = tubesWarehouse
  let factory = tubesFactory
  const rows: TubeRow[] = []

  for (const ev of allEvs) {
    const dayOffset = Math.round((ev.date.getTime() - today.getTime()) / 86400000)

    if (ev.type === 'tube_sent') {
      const actual = Math.min(ev.qty, warehouse)
      warehouse -= actual
      factory += actual
      rows.push({ type: 'tube_sent', dayOffset, date: ev.date, qty: ev.qty, warehouseAfter: Math.round(warehouse), factoryAfter: Math.round(factory) })
    } else if (ev.type === 'tube_new_order') {
      factory += ev.qty
      rows.push({ type: 'tube_new_order', dayOffset, date: ev.date, qty: ev.qty, warehouseAfter: Math.round(warehouse), factoryAfter: Math.round(factory) })
    } else {
      const shortfall = factory < ev.qty ? ev.qty - factory : 0
      factory = Math.max(0, factory - ev.qty)
      rows.push({ type: 'prod_consume', dayOffset, date: ev.date, qty: ev.qty, warehouseAfter: Math.round(warehouse), factoryAfter: Math.round(factory), shortfall: shortfall > 0 ? shortfall : undefined })
    }
  }

  return rows
}

// ── TubesTimeline Table ───────────────────────────────────────────────────────

function TubesTimelineTable({ today, tubesWarehouse, tubesFactory, rows }: {
  today: Date
  tubesWarehouse: number
  tubesFactory: number
  rows: TubeRow[]
}) {
  const hasShortfall = rows.some(r => r.shortfall)

  return (
    <div className="rounded-lg border overflow-hidden text-xs">
      <div className="grid grid-cols-[140px_1fr_100px_100px] bg-muted/50 border-b">
        <div className="px-3 py-2 font-medium text-muted-foreground">วันที่</div>
        <div className="px-3 py-2 font-medium text-muted-foreground">เหตุการณ์</div>
        <div className="px-3 py-2 font-medium text-muted-foreground text-right">🏠 คลังเรา</div>
        <div className={`px-3 py-2 font-medium text-right ${hasShortfall ? 'text-red-500' : 'text-muted-foreground'}`}>
          🏭 โรงงาน{hasShortfall ? ' ⚠️' : ''}
        </div>
      </div>

      {/* Start row */}
      <div className="grid grid-cols-[140px_1fr_100px_100px] border-b bg-muted/20">
        <div className="px-3 py-2 text-muted-foreground">{thaiDate(today)}</div>
        <div className="px-3 py-2 text-muted-foreground">เริ่มต้น (หลอดปัจจุบัน)</div>
        <div className="px-3 py-2 text-right font-mono">{tubesWarehouse.toLocaleString()}</div>
        <div className="px-3 py-2 text-right font-mono">{tubesFactory.toLocaleString()}</div>
      </div>

      {rows.map((row, i) => {
        const isSent = row.type === 'tube_sent'
        const isNew = row.type === 'tube_new_order'
        const isProd = row.type === 'prod_consume'
        const hasErr = !!row.shortfall

        const bg = hasErr ? 'bg-red-50 dark:bg-red-950/30' : isNew ? 'bg-green-50 dark:bg-green-950/20' : isSent ? 'bg-blue-50 dark:bg-blue-950/20' : ''

        return (
          <div key={i} className={`border-b last:border-0 ${bg}`}>
            <div className="grid grid-cols-[140px_1fr_100px_100px]">
              <div className="px-3 py-2 text-muted-foreground">
                {thaiDate(row.date)}
                <span className="ml-1 opacity-60 text-[10px]">+{row.dayOffset}ว</span>
              </div>
              <div className="px-3 py-2">
                {isSent && <span className="text-blue-700 dark:text-blue-300">↕ ส่งหลอด {row.qty.toLocaleString()} → โรงงาน</span>}
                {isNew && <span className="text-green-700 dark:text-green-400">↑ รับหลอดใหม่ {row.qty.toLocaleString()}</span>}
                {isProd && (
                  <span className={hasErr ? 'text-red-600 dark:text-red-400 font-medium' : 'text-foreground'}>
                    ↓ ผลิต FG {row.qty.toLocaleString()} หลอด
                    {hasErr && <span className="ml-2 text-red-500">⚠️ ขาด {row.shortfall!.toLocaleString()}</span>}
                  </span>
                )}
              </div>
              <div className="px-3 py-2 text-right font-mono">{row.warehouseAfter.toLocaleString()}</div>
              <div className={`px-3 py-2 text-right font-mono ${hasErr ? 'text-red-600 dark:text-red-400 font-bold' : isNew ? 'text-green-700 dark:text-green-400' : ''}`}>
                {row.factoryAfter.toLocaleString()}
              </div>
            </div>
            {hasErr && (
              <div className="px-3 pb-2 text-red-500 text-[10px]">
                ⚠️ หลอดโรงงานไม่พอ ขาด {row.shortfall!.toLocaleString()} หลอด — ต้องส่งหลอดเพิ่มก่อนผลิต หรือลดจำนวนผลิต
              </div>
            )}
          </div>
        )
      })}

      {rows.length === 0 && (
        <div className="px-3 py-4 text-center text-muted-foreground">ใส่รอบส่งหลอด/สั่งผลิต FG เพื่อดูประมาณการ</div>
      )}
    </div>
  )
}

// ── TubesPlanner ──────────────────────────────────────────────────────────────

export function TubesPlanner({
  fs,
  prodRounds,
  today,
}: {
  fs: FormulaStatus
  prodRounds: PlannerRound[]
  today: Date
}) {
  const formula: ProdFormulaConfig = fs.formula
  const tubesWarehouse = fs.layers['tubes_warehouse']?.quantity ?? 0
  const tubesFactory   = fs.layers['tubes_factory']?.quantity   ?? 0

  const [tubeSentRounds, setTubeSentRounds] = useState<TubeRound[]>([
    { id: genId(), date: '', qty: '' },
    { id: genId(), date: '', qty: '' },
  ])
  const [tubeNewRounds, setTubeNewRounds] = useState<TubeRound[]>([
    { id: genId(), date: '', qty: '' },
  ])

  const timeline = useMemo(() => computeTubesTimeline(
    tubesWarehouse, tubesFactory, tubeSentRounds, tubeNewRounds, prodRounds, today, formula.lead_time_production_min_days,
  ), [tubesWarehouse, tubesFactory, tubeSentRounds, tubeNewRounds, prodRounds, today, formula.lead_time_production_min_days])

  function updateRound(setter: React.Dispatch<React.SetStateAction<TubeRound[]>>, id: string, field: 'date' | 'qty', val: string) {
    setter(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r))
  }
  function removeRound(setter: React.Dispatch<React.SetStateAction<TubeRound[]>>, id: string) {
    setter(prev => prev.filter(r => r.id !== id))
  }
  function addRound(setter: React.Dispatch<React.SetStateAction<TubeRound[]>>) {
    setter(prev => [...prev, { id: genId(), date: '', qty: '' }])
  }

  // Display production batches pulled from FG planner (read-only)
  const activeProdBatches = prodRounds.filter(r => r.date && parseQty(r.qty) > 0)

  return (
    <div className="space-y-4 border-t pt-4 mt-2">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium text-sm">🧪 หลอดเปล่า พร้อมฝา</span>
        <span className="text-xs text-muted-foreground">
          คลังเรา <span className="font-mono font-medium">{tubesWarehouse.toLocaleString()}</span>
          {' · '}
          โรงงาน <span className="font-mono font-medium">{tubesFactory.toLocaleString()}</span>
        </span>
      </div>

      {/* Input grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Send tubes to factory */}
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            🏠→🏭 ส่งหลอดไปโรงงาน (วันส่ง · จำนวน)
          </p>
          <p className="text-[10px] text-muted-foreground">
            ± 5% จากจำนวนผลิต หรือตามจำนวนเต็มกล่องบรรจุ
          </p>
          {tubeSentRounds.map((r, idx) => (
            <div key={r.id} className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground w-4 text-right shrink-0">{idx + 1}.</span>
              <input type="date" value={r.date}
                onChange={e => updateRound(setTubeSentRounds, r.id, 'date', e.target.value)}
                className="h-7 text-xs border rounded px-2 flex-1 min-w-0 bg-background" />
              <input type="text" inputMode="numeric" value={r.qty} placeholder="จำนวน"
                onChange={e => updateRound(setTubeSentRounds, r.id, 'qty', e.target.value)}
                className="h-7 text-xs border rounded px-2 w-20 font-mono bg-background" />
              <button onClick={() => removeRound(setTubeSentRounds, r.id)} className="text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {tubeSentRounds.length < 5 && (
            <button onClick={() => addRound(setTubeSentRounds)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Plus className="h-3 w-3" /> เพิ่มรอบ
            </button>
          )}
        </div>

        {/* New tube orders → factory */}
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            🏭 สั่งหลอดใหม่เข้าโรงงาน (วันรับ · จำนวน)
          </p>
          <p className="text-[10px] text-muted-foreground">หลอดสั่งใหม่ที่ส่งตรงไปโรงงาน</p>
          {tubeNewRounds.map((r, idx) => (
            <div key={r.id} className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground w-4 text-right shrink-0">{idx + 1}.</span>
              <input type="date" value={r.date}
                onChange={e => updateRound(setTubeNewRounds, r.id, 'date', e.target.value)}
                className="h-7 text-xs border rounded px-2 flex-1 min-w-0 bg-background" />
              <input type="text" inputMode="numeric" value={r.qty} placeholder="จำนวน"
                onChange={e => updateRound(setTubeNewRounds, r.id, 'qty', e.target.value)}
                className="h-7 text-xs border rounded px-2 w-20 font-mono bg-background" />
              <button onClick={() => removeRound(setTubeNewRounds, r.id)} className="text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {tubeNewRounds.length < 5 && (
            <button onClick={() => addRound(setTubeNewRounds)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Plus className="h-3 w-3" /> เพิ่มรอบ
            </button>
          )}
        </div>
      </div>

      {/* FG production batches from FG planner */}
      {activeProdBatches.length > 0 && (
        <div className="text-[10px] text-muted-foreground px-1">
          <span className="font-medium">แผนผลิต FG (จาก FG Runway ด้านบน):</span>
          {' '}
          {activeProdBatches.map((r, i) => {
            const lead = Math.max(15, parseInt(r.leadDays ?? '') || formula.lead_time_production_min_days)
            const d = r.date ? new Date(r.date) : null
            const recvDate = d ? addDays(d, lead) : null
            return (
              <span key={i} className="mr-3">
                {i + 1}. {recvDate ? recvDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : r.date}{' '}
                <span className="font-mono">{parseQty(r.qty).toLocaleString()} หลอด</span>
              </span>
            )
          })}
        </div>
      )}

      {/* Timeline */}
      <TubesTimelineTable
        today={today}
        tubesWarehouse={tubesWarehouse}
        tubesFactory={tubesFactory}
        rows={timeline}
      />
    </div>
  )
}
