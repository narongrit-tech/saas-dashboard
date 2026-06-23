'use client'

import { useMemo } from 'react'
import { Plus, X } from 'lucide-react'
import type { FormulaStatus, ProdFormulaConfig } from '@/types/production-planning'
import type { PlannerRound } from './tubes-planner'

export { makeEmptyRound } from './tubes-planner'

// ── Timeline types ────────────────────────────────────────────────────────────

interface OilRow {
  dayOffset: number
  date: Date
  type: 'new_order' | 'prod_consume'
  qty: number          // liters/kg added or consumed
  oilAfter: number
  shortfall?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const n = parseFloat(s.replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}

// ── Timeline computation ──────────────────────────────────────────────────────

function computeOilTimeline(
  oilKg: number,
  oilNewRounds: PlannerRound[],
  prodRounds: PlannerRound[],
  oilPer1000: number,
  today: Date,
  defaultLeadDays: number,
): OilRow[] {
  const oilPerUnit = oilPer1000 / 1000

  type RawEv = { date: Date; qty: number; type: 'new_order' | 'prod_consume' }

  const newOrderEvs: RawEv[] = oilNewRounds
    .map(r => ({ date: parseDate(r.date), qty: parseQty(r.qty) }))
    .filter((r): r is { date: Date; qty: number } => r.date !== null && r.qty > 0)
    .map(r => ({ ...r, type: 'new_order' as const }))

  const prodEvs: Array<{ date: Date; qty: number; type: 'prod_consume' }> = prodRounds
    .map(r => {
      const d = parseDate(r.date)
      const fgQty = parseQty(r.qty)
      const lead = Math.max(15, parseInt(r.leadDays ?? '') || defaultLeadDays)
      if (!d || fgQty <= 0) return null
      return { date: addDays(d, lead), qty: fgQty * oilPerUnit, type: 'prod_consume' as const }
    })
    .filter((r): r is { date: Date; qty: number; type: 'prod_consume' } => r !== null)

  const allEvs: RawEv[] = [...newOrderEvs, ...prodEvs]
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  if (allEvs.length === 0) return []

  let oil = oilKg
  const rows: OilRow[] = []

  for (const ev of allEvs) {
    const dayOffset = Math.round((ev.date.getTime() - today.getTime()) / 86400000)

    if (ev.type === 'new_order') {
      oil += ev.qty
      rows.push({ type: 'new_order', dayOffset, date: ev.date, qty: ev.qty, oilAfter: Math.round(oil * 100) / 100 })
    } else {
      const shortfall = oil < ev.qty ? ev.qty - oil : 0
      oil = Math.max(0, oil - ev.qty)
      rows.push({ type: 'prod_consume', dayOffset, date: ev.date, qty: ev.qty, oilAfter: Math.round(oil * 100) / 100, shortfall: shortfall > 0 ? shortfall : undefined })
    }
  }

  return rows
}

// ── OilTimelineTable ──────────────────────────────────────────────────────────

function OilTimelineTable({ today, oilKg, rows, oilPer1000 }: {
  today: Date; oilKg: number; rows: OilRow[]; oilPer1000: number
}) {
  const hasShortfall = rows.some(r => r.shortfall)

  return (
    <div className="rounded-lg border overflow-hidden text-xs">
      <div className="grid grid-cols-[140px_1fr_100px] bg-muted/50 border-b">
        <div className="px-3 py-2 font-medium text-muted-foreground">วันที่</div>
        <div className="px-3 py-2 font-medium text-muted-foreground">เหตุการณ์</div>
        <div className={`px-3 py-2 font-medium text-right ${hasShortfall ? 'text-red-500' : 'text-muted-foreground'}`}>
          🫙 น้ำมัน (kg){hasShortfall ? ' ⚠️' : ''}
        </div>
      </div>
      <div className="grid grid-cols-[140px_1fr_100px] border-b bg-muted/20">
        <div className="px-3 py-2 text-muted-foreground">{thaiDate(today)}</div>
        <div className="px-3 py-2 text-muted-foreground">เริ่มต้น ({oilPer1000} kg / 1,000 หลอด)</div>
        <div className="px-3 py-2 text-right font-mono">{oilKg.toFixed(2)}</div>
      </div>
      {rows.map((row, i) => {
        const isNew = row.type === 'new_order'
        const hasErr = !!row.shortfall
        const bg = hasErr ? 'bg-red-50 dark:bg-red-950/30' : isNew ? 'bg-green-50 dark:bg-green-950/20' : ''
        return (
          <div key={i} className={`border-b last:border-0 ${bg}`}>
            <div className="grid grid-cols-[140px_1fr_100px]">
              <div className="px-3 py-2 text-muted-foreground">
                {thaiDate(row.date)}<span className="ml-1 opacity-60 text-[10px]">+{row.dayOffset}ว</span>
              </div>
              <div className="px-3 py-2">
                {isNew && <span className="text-green-700 dark:text-green-400">↑ รับน้ำมัน {row.qty.toFixed(2)} kg</span>}
                {!isNew && (
                  <span className={hasErr ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                    ↓ ผลิต FG ใช้ {row.qty.toFixed(2)} kg
                    {hasErr && <span className="ml-2 text-red-500">⚠️ ขาด {row.shortfall!.toFixed(2)} kg</span>}
                  </span>
                )}
              </div>
              <div className={`px-3 py-2 text-right font-mono ${hasErr ? 'text-red-600 dark:text-red-400 font-bold' : isNew ? 'text-green-700 dark:text-green-400' : ''}`}>
                {row.oilAfter.toFixed(2)}
              </div>
            </div>
            {hasErr && <div className="px-3 pb-2 text-red-500 text-[10px]">⚠️ น้ำมันไม่พอ ขาด {row.shortfall!.toFixed(2)} kg — ต้องสั่งน้ำมันเพิ่มก่อนผลิต</div>}
          </div>
        )
      })}
      {rows.length === 0 && <div className="px-3 py-4 text-center text-muted-foreground">ใส่รอบสั่งผลิต FG เพื่อดูประมาณการการใช้น้ำมัน</div>}
    </div>
  )
}

// ── OilPlanner ────────────────────────────────────────────────────────────────

export function OilPlanner({
  fs, prodRounds, today,
  oilRounds, setOilRounds,
}: {
  fs: FormulaStatus
  prodRounds: PlannerRound[]
  today: Date
  oilRounds: PlannerRound[]
  setOilRounds: React.Dispatch<React.SetStateAction<PlannerRound[]>>
}) {
  const formula: ProdFormulaConfig = fs.formula
  if (!formula.uses_oil) return null

  const oilKg = fs.layers['oil_kg']?.quantity ?? 0
  const oilPer1000 = formula.oil_per_1000_tubes_kg

  const timeline = useMemo(() => computeOilTimeline(
    oilKg, oilRounds, prodRounds, oilPer1000, today, formula.lead_time_production_min_days,
  ), [oilKg, oilRounds, prodRounds, oilPer1000, today, formula.lead_time_production_min_days])

  function update(id: string, field: 'date' | 'qty', val: string) {
    setOilRounds(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r))
  }
  function remove(id: string) {
    setOilRounds(prev => prev.filter(r => r.id !== id))
  }
  function add() {
    setOilRounds(prev => [...prev, { id: Math.random().toString(36).slice(2, 9), date: '', qty: '' }])
  }

  const activeProdBatches = prodRounds.filter(r => r.date && parseQty(r.qty) > 0)
  const totalOilNeeded = activeProdBatches.reduce((sum, r) => {
    const lead = Math.max(15, parseInt(r.leadDays ?? '') || formula.lead_time_production_min_days)
    const d = parseDate(r.date)
    if (!d) return sum
    return sum + parseQty(r.qty) * (oilPer1000 / 1000)
  }, 0)

  return (
    <div className="space-y-4 border-t pt-4 mt-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium text-sm">🫙 Essential Oil</span>
        <span className="text-xs text-muted-foreground">
          คงเหลือ <span className="font-mono font-medium">{oilKg.toFixed(2)} kg</span>
          {' · '}
          ใช้ <span className="font-mono">{oilPer1000} kg</span> / 1,000 หลอด
        </span>
        {totalOilNeeded > 0 && (
          <span className={`text-xs ${totalOilNeeded > oilKg ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
            แผนผลิตต้องการ <span className="font-mono">{totalOilNeeded.toFixed(2)} kg</span>
            {totalOilNeeded > oilKg && ` (ขาด ${(totalOilNeeded - oilKg).toFixed(2)} kg)`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">🫙 สั่งน้ำมันใหม่ (วันรับ · จำนวน kg)</p>
          {oilRounds.map((r, idx) => (
            <div key={r.id} className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground w-4 text-right shrink-0">{idx + 1}.</span>
              <input type="date" value={r.date} onChange={e => update(r.id, 'date', e.target.value)} className="h-7 text-xs border rounded px-2 flex-1 min-w-0 bg-background" />
              <input type="text" inputMode="decimal" value={r.qty} placeholder="kg" onChange={e => update(r.id, 'qty', e.target.value)} className="h-7 text-xs border rounded px-2 w-20 font-mono bg-background" />
              <button onClick={() => remove(r.id)} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
            </div>
          ))}
          {oilRounds.length < 5 && <button onClick={add} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Plus className="h-3 w-3" /> เพิ่มรอบ</button>}
        </div>

        <div className="rounded-lg border p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium">การใช้น้ำมันตามแผนผลิต FG:</p>
          {activeProdBatches.length === 0 && <p className="opacity-60">ยังไม่มีรอบผลิต</p>}
          {activeProdBatches.map((r, i) => {
            const lead = Math.max(15, parseInt(r.leadDays ?? '') || formula.lead_time_production_min_days)
            const d = parseDate(r.date)
            const recvDate = d ? addDays(d, lead) : null
            const oilUsed = parseQty(r.qty) * (oilPer1000 / 1000)
            return (
              <div key={i} className="flex gap-3">
                <span>{i + 1}.</span>
                <span>{recvDate ? recvDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : r.date}</span>
                <span className="font-mono">{parseQty(r.qty).toLocaleString()} หลอด</span>
                <span className="text-orange-500">→ ใช้ {oilUsed.toFixed(2)} kg</span>
              </div>
            )
          })}
          {activeProdBatches.length > 0 && (
            <div className="pt-1 border-t font-medium">
              รวม <span className="font-mono text-foreground">{totalOilNeeded.toFixed(2)} kg</span>
              {' vs '}
              มี <span className={`font-mono ${totalOilNeeded > oilKg ? 'text-red-500' : 'text-green-600'}`}>{oilKg.toFixed(2)} kg</span>
            </div>
          )}
        </div>
      </div>

      <OilTimelineTable today={today} oilKg={oilKg} rows={timeline} oilPer1000={oilPer1000} />
    </div>
  )
}
