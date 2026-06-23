'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Plus, Settings2, X, Check, TrendingDown, BookmarkCheck, ChevronDown } from 'lucide-react'
import Link from 'next/link'
import type { DashboardData, FormulaStatus, PlanningAlert, AlertLevel, ProdProductionOrder } from '@/types/production-planning'
import { ORDER_TYPE_LABELS, STOCK_TYPE_LABELS } from '@/types/production-planning'
import { SaveForecastBar, SavedForecastsList, useSavedForecasts } from './_components/forecast-snapshot'
import { TubesPlanner, makeEmptyRound } from './_components/tubes-planner'
import { OilPlanner } from './_components/oil-planner'
import { PendingOrdersWidget } from './_components/pending-orders-widget'

export default function ProductionPlanningPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/production-planning/dashboard')
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setData(json.data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่ได้')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Production Planning</h1>
          <p className="text-sm text-muted-foreground mt-1">วางแผนการผลิตและ stock ทุก layer</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            รีเฟรช
          </Button>
          <Link href="/production-planning/stock">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              อัพเดต Stock
            </Button>
          </Link>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>กำลังโหลด...</span>
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-4">
            <p className="text-destructive text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <AlertSummary formulas={data.formulas} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {data.formulas.map(fs => (
              <FormulaCard key={fs.formula.id} status={fs} onUpdate={load} />
            ))}
          </div>

          <StockProjectionSection formulas={data.formulas} pendingOrders={data.pending_orders} />

          {data.pending_orders.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">คำสั่งซื้อที่รอรับของ ({data.pending_orders.length})</CardTitle>
                  <Link href="/production-planning/orders">
                    <Button variant="ghost" size="sm">จัดการทั้งหมด →</Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <PendingOrdersWidget initialOrders={data.pending_orders} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function AlertSummary({ formulas }: { formulas: FormulaStatus[] }) {
  const allAlerts = formulas.flatMap(f => f.alerts)
  const critical = allAlerts.filter(a => a.level === 'critical')
  const warnings = allAlerts.filter(a => a.level === 'warning')

  if (allAlerts.length === 0) {
    return (
      <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">ทุก layer ปกติ — ไม่มี action ที่ต้องดำเนินการ</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {critical.map((alert, i) => <AlertBadge key={i} alert={alert} />)}
      {warnings.map((alert, i) => <AlertBadge key={i} alert={alert} />)}
    </div>
  )
}

function AlertBadge({ alert }: { alert: PlanningAlert }) {
  const isCritical = alert.level === 'critical'
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
      isCritical
        ? 'border-red-300 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300'
        : 'border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-800 dark:text-yellow-300'
    }`}>
      {isCritical
        ? <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
        : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      }
      <div className="flex-1">
        <span>{alert.message}</span>
        <span className="ml-2 text-xs opacity-70">
          (แนะนำสั่ง {alert.action === 'oil'
            ? `${alert.suggested_qty} kg`
            : alert.suggested_qty.toLocaleString()} {ORDER_TYPE_LABELS[alert.action]})
        </span>
      </div>
      <Link href="/production-planning/orders">
        <Button size="sm" variant={isCritical ? 'destructive' : 'outline'} className="shrink-0">สั่ง</Button>
      </Link>
    </div>
  )
}

// ── Formula Card with inline settings ────────────────────────────────────────

function FormulaCard({ status, onUpdate }: { status: FormulaStatus; onUpdate: () => void }) {
  const { formula, layers, burn_rate_per_day, days_of_supply: dos } = status
  const [showSettings, setShowSettings] = useState(false)
  const [saving, setSaving] = useState(false)

  // Local editable state mirrors formula config
  const [window, setWindow] = useState(String(formula.burn_rate_window_days ?? 7))
  const [overrideEnabled, setOverrideEnabled] = useState(formula.burn_rate_override !== null)
  const [overrideVal, setOverrideVal] = useState(
    formula.burn_rate_override !== null ? String(formula.burn_rate_override) : ''
  )

  const isOverride = formula.burn_rate_override !== null

  async function saveSettings() {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        burn_rate_window_days: Number(window),
        burn_rate_override: overrideEnabled && overrideVal !== '' ? Number(overrideVal) : null,
      }
      const res = await fetch(`/api/production-planning/config/${formula.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setShowSettings(false)
      onUpdate()
    } catch {
      // keep panel open on error
    } finally {
      setSaving(false)
    }
  }

  const stockItems = [
    { key: 'fg_warehouse',    label: 'FG คลังเรา',          qty: layers['fg_warehouse']?.quantity,    unit: 'หลอด', dos: dos.fg_warehouse },
    { key: 'fg_factory',      label: 'FG คลังโรงงาน',       qty: layers['fg_factory']?.quantity,      unit: 'หลอด', dos: dos.fg_factory },
    { key: 'tubes_factory',   label: 'หลอดเปล่า (โรงงาน)',  qty: layers['tubes_factory']?.quantity,   unit: 'หลอด', dos: dos.tubes_factory },
    { key: 'tubes_warehouse', label: 'หลอดเปล่า (คลังเรา)', qty: layers['tubes_warehouse']?.quantity, unit: 'หลอด', dos: dos.tubes_warehouse },
    ...(formula.uses_oil
      ? [{ key: 'oil_kg', label: 'Essential Oil', qty: layers['oil_kg']?.quantity, unit: 'kg', dos: dos.oil_kg }]
      : []),
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{formula.formula_name}</CardTitle>
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground">
              Burn rate:{' '}
              <span className={`font-mono font-medium ${isOverride ? 'text-orange-600 dark:text-orange-400' : ''}`}>
                {burn_rate_per_day > 0 ? `${burn_rate_per_day.toFixed(1)} หลอด/วัน` : '—'}
              </span>
              {isOverride && <span className="ml-1 text-orange-500">(manual)</span>}
              {!isOverride && (
                <span className="ml-1 opacity-60">({formula.burn_rate_window_days ?? 7}d avg)</span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setShowSettings(v => !v)}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Inline settings panel */}
        {showSettings && (
          <div className="mt-3 p-3 rounded-lg bg-muted/50 border space-y-3 text-sm">
            {/* Window selector */}
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground w-28 shrink-0">คำนวณจาก</span>
              <Select value={window} onValueChange={setWindow} disabled={overrideEnabled}>
                <SelectTrigger className="h-7 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 วันล่าสุด</SelectItem>
                  <SelectItem value="7">7 วันล่าสุด</SelectItem>
                  <SelectItem value="14">14 วันล่าสุด</SelectItem>
                  <SelectItem value="30">30 วันล่าสุด</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Manual override toggle + input */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none text-muted-foreground w-28 shrink-0">
                <input
                  type="checkbox"
                  checked={overrideEnabled}
                  onChange={e => {
                    setOverrideEnabled(e.target.checked)
                    if (!e.target.checked) setOverrideVal('')
                  }}
                  className="rounded"
                />
                Manual rate
              </label>
              {overrideEnabled && (
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={overrideVal}
                    onChange={e => setOverrideVal(e.target.value)}
                    placeholder="หลอด/วัน"
                    className="h-7 w-24 text-xs font-mono"
                  />
                  <span className="text-xs text-muted-foreground">หลอด/วัน</span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowSettings(false)}>
                <X className="h-3 w-3 mr-1" />ยกเลิก
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={saveSettings} disabled={saving}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                บันทึก
              </Button>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-2">
        {stockItems.map(({ key, ...item }) => (
          <StockRow key={key} {...item} formula={formula} />
        ))}
      </CardContent>
    </Card>
  )
}

function StockRow({
  label,
  qty,
  unit,
  dos,
  formula,
}: {
  label: string
  qty: number | undefined
  unit: string
  dos: number | null
  formula: FormulaStatus['formula']
}) {
  const level = getDosLevel(dos, label, formula)

  return (
    <div className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
      <div className="flex items-center gap-2">
        <DosIndicator level={level} />
        <span className="text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono">
          {qty !== undefined
            ? unit === 'kg' ? `${Number(qty).toFixed(1)} kg` : Number(qty).toLocaleString()
            : <span className="text-muted-foreground text-xs">ยังไม่มีข้อมูล</span>
          }
        </span>
        {dos !== null && (
          <Badge variant="outline" className={`text-xs font-mono ${levelClass(level)}`}>
            {dos} วัน
          </Badge>
        )}
      </div>
    </div>
  )
}

function DosIndicator({ level }: { level: AlertLevel | 'none' }) {
  if (level === 'critical') return <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
  if (level === 'warning')  return <span className="h-2 w-2 rounded-full bg-yellow-500 shrink-0" />
  if (level === 'ok')       return <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
  return <span className="h-2 w-2 rounded-full bg-gray-300 shrink-0" />
}

function getDosLevel(dos: number | null, label: string, formula: FormulaStatus['formula']): AlertLevel | 'none' {
  if (dos === null) return 'none'
  if (label.includes('FG คลังเรา')) {
    if (dos <= 3) return 'critical'
    if (dos <= formula.alert_fg_days) return 'warning'
    return 'ok'
  }
  if (label.includes('FG')) {
    if (dos <= 20) return 'critical'
    if (dos <= formula.alert_production_days) return 'warning'
    return 'ok'
  }
  if (label.includes('หลอด')) {
    if (dos <= 45) return 'critical'
    if (dos <= formula.alert_tubes_days) return 'warning'
    return 'ok'
  }
  if (label.includes('Oil')) {
    if (dos <= 45) return 'critical'
    if (dos <= formula.alert_oil_days) return 'warning'
    return 'ok'
  }
  return 'ok'
}

function levelClass(level: AlertLevel | 'none') {
  if (level === 'critical') return 'border-red-300 text-red-700 dark:text-red-400'
  if (level === 'warning')  return 'border-yellow-300 text-yellow-700 dark:text-yellow-400'
  if (level === 'ok')       return 'border-green-300 text-green-700 dark:text-green-400'
  return ''
}

// ── FG Runway Planner (2-layer interactive) ──────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + Math.round(days))
  return d
}

function thaiDate(date: Date): string {
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

function genId(): string {
  return Math.random().toString(36).slice(2, 9)
}

function parseRoundQty(s: string): number {
  const n = parseInt(s.replace(/,/g, ''), 10)
  return isNaN(n) || n < 0 ? 0 : n
}

function parseRoundDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

interface PlannerRound { id: string; date: string; qty: string; leadDays?: string }

// Warehouse milestone: alternating runout → call_in events
interface WMilestone {
  type: 'call_in' | 'runout'
  dayOffset: number
  date: Date
  qty?: number
  stockBefore?: number  // for call_in: stock remaining when delivery arrives
  stockAfter: number
}

// Factory event: call_out (sent to warehouse) or prod_in (new production received)
interface FEvent {
  type: 'call_out' | 'prod_in'
  dayOffset: number
  date: Date
  qty: number
  stockBefore: number
  stockAfter: number
  isDeficit: boolean
}

// Unified timeline event — one table covers both warehouse and factory
interface UnifiedRow {
  dayOffset: number
  date: Date
  type: 'start' | 'transfer' | 'warehouse_empty' | 'prod_receive'
  qty?: number
  warehouseBeforeCall?: number  // stock in warehouse right before transfer arrives
  warehouseAfter: number
  factoryAfter: number
  factoryDeficit?: boolean
}

function computeUnifiedTimeline(
  fgWarehouse: number,
  fgFactory: number,
  burnPerDay: number,
  callRounds: PlannerRound[],
  prodRounds: PlannerRound[],
  today: Date,
  defaultLeadDays: number,
): UnifiedRow[] {
  if (burnPerDay <= 0) return []

  // Parse and sort call rounds (warehouse ← factory transfers)
  const calls = callRounds
    .map(r => ({ date: parseRoundDate(r.date), qty: parseRoundQty(r.qty) }))
    .filter((r): r is { date: Date; qty: number } => r.date !== null && r.qty > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  // Parse and sort production receives — use per-round leadDays override if set
  const prods = prodRounds
    .map(r => {
      const date = parseRoundDate(r.date)
      const qty = parseRoundQty(r.qty)
      const lead = Math.max(15, parseInt(r.leadDays ?? '') || defaultLeadDays)
      return date && qty > 0 ? { date: addDays(date, lead), qty } : null
    })
    .filter((r): r is { date: Date; qty: number } => r !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  // All discrete events sorted by date
  type DiscreteEvent =
    | { kind: 'transfer'; date: Date; qty: number }
    | { kind: 'prod_receive'; date: Date; qty: number }

  const discrete: DiscreteEvent[] = [
    ...calls.map(c => ({ kind: 'transfer' as const, date: c.date, qty: c.qty })),
    ...prods.map(p => ({ kind: 'prod_receive' as const, date: p.date, qty: p.qty })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime())

  const rows: UnifiedRow[] = []
  let warehouse = fgWarehouse
  let factory = fgFactory
  let currentOffset = 0

  const daysToEmpty = (stock: number) => stock > 0 ? stock / burnPerDay : 0

  for (const ev of discrete) {
    const evOffset = Math.round((ev.date.getTime() - today.getTime()) / 86400000)
    const daysUntilEvent = evOffset - currentOffset

    if (ev.kind === 'transfer') {
      // Check if warehouse empties before this transfer arrives
      const depletionDays = daysToEmpty(warehouse)
      if (depletionDays < daysUntilEvent) {
        const emptyOffset = currentOffset + Math.ceil(depletionDays)
        warehouse = 0
        rows.push({
          type: 'warehouse_empty',
          dayOffset: emptyOffset,
          date: addDays(today, emptyOffset),
          warehouseAfter: 0,
          factoryAfter: factory,
        })
        currentOffset = emptyOffset
      }
      // Advance warehouse (burn) to event date
      warehouse = Math.max(0, warehouse - burnPerDay * (evOffset - currentOffset))
      currentOffset = evOffset

      const warehouseBefore = warehouse
      warehouse += ev.qty
      factory = Math.max(factory - ev.qty, factory - ev.qty) // can go negative (deficit)
      const deficit = factory < 0
      factory = factory  // keep negative for display

      rows.push({
        type: 'transfer',
        dayOffset: evOffset,
        date: ev.date,
        qty: ev.qty,
        warehouseBeforeCall: Math.round(warehouseBefore),
        warehouseAfter: Math.round(warehouse),
        factoryAfter: Math.round(factory),
        factoryDeficit: deficit,
      })
    } else {
      // prod_receive: only affects factory
      // Advance warehouse burn to event date
      const depletionDays = daysToEmpty(warehouse)
      if (depletionDays < daysUntilEvent && warehouse > 0) {
        const emptyOffset = currentOffset + Math.ceil(depletionDays)
        if (emptyOffset < evOffset) {
          warehouse = 0
          rows.push({
            type: 'warehouse_empty',
            dayOffset: emptyOffset,
            date: addDays(today, emptyOffset),
            warehouseAfter: 0,
            factoryAfter: factory,
          })
        }
      }
      warehouse = Math.max(0, warehouse - burnPerDay * daysUntilEvent)
      currentOffset = evOffset
      factory += ev.qty

      rows.push({
        type: 'prod_receive',
        dayOffset: evOffset,
        date: ev.date,
        qty: ev.qty,
        warehouseAfter: Math.round(warehouse),
        factoryAfter: Math.round(factory),
      })
    }
  }

  // After all events: find final warehouse runout (if any stock left)
  const finalDepletion = daysToEmpty(warehouse)
  if (warehouse > 0 && finalDepletion < 730) {
    const emptyOffset = currentOffset + Math.ceil(finalDepletion)
    rows.push({
      type: 'warehouse_empty',
      dayOffset: emptyOffset,
      date: addDays(today, emptyOffset),
      warehouseAfter: 0,
      factoryAfter: factory,
    })
  }

  return rows
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function StockProjectionSection({
  formulas,
  pendingOrders,
}: {
  formulas: FormulaStatus[]
  pendingOrders: (ProdProductionOrder & { formula_name: string | null })[]
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const activeFormulas = formulas.filter(fs => fs.burn_rate_per_day > 0)
  if (activeFormulas.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-muted-foreground" />
          ประมาณการ FG Runway
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        {activeFormulas.map(fs => (
          <FormulaPlanner key={fs.formula.id} fs={fs} pendingOrders={pendingOrders} today={today} />
        ))}
      </CardContent>
    </Card>
  )
}

// ── Stock summary grid ────────────────────────────────────────────────────────

function StockSummaryGrid({ fs, burn }: { fs: FormulaStatus; burn: number }) {
  const formula = fs.formula
  const fgW  = fs.layers['fg_warehouse']?.quantity   ?? 0
  const fgF  = fs.layers['fg_factory']?.quantity     ?? 0
  const tbW  = fs.layers['tubes_warehouse']?.quantity ?? 0
  const tbF  = fs.layers['tubes_factory']?.quantity   ?? 0
  const oil  = formula.uses_oil ? (fs.layers['oil_kg']?.quantity ?? null) : null

  function dosTag(qty: number, b: number) {
    if (b <= 0 || qty <= 0) return null
    const d = Math.floor(qty / b)
    if (d >= 999) return null
    return <span className="text-[10px] text-muted-foreground block">{d} วัน</span>
  }

  return (
    <div className="rounded-lg bg-muted/20 border p-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className="font-semibold">{formula.formula_name}</span>
        <span className="text-xs text-muted-foreground">Burn <span className="font-mono font-medium">{burn.toFixed(1)}</span> หลอด/วัน</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className={`rounded p-2 bg-background border ${fgW > 0 && fgW < burn * 7 ? 'border-orange-300' : ''}`}>
          <div className="text-muted-foreground">FG คลังเรา</div>
          <div className={`font-mono font-semibold ${fgW > 0 && fgW < burn * 7 ? 'text-orange-600 dark:text-orange-400' : ''}`}>{fgW.toLocaleString()}</div>
          {dosTag(fgW, burn)}
        </div>
        <div className="rounded p-2 bg-background border">
          <div className="text-muted-foreground">FG โรงงาน</div>
          <div className="font-mono font-semibold">{fgF.toLocaleString()}</div>
          {dosTag(fgF, burn)}
        </div>
        <div className="rounded p-2 bg-background border">
          <div className="text-muted-foreground">หลอด คลังเรา</div>
          <div className="font-mono font-semibold">{tbW.toLocaleString()}</div>
        </div>
        <div className="rounded p-2 bg-background border">
          <div className="text-muted-foreground">หลอด โรงงาน</div>
          <div className="font-mono font-semibold">{tbF.toLocaleString()}</div>
        </div>
        {oil !== null && (
          <div className={`rounded p-2 bg-background border ${oil < 5 ? 'border-orange-300' : ''}`}>
            <div className="text-muted-foreground">Essential Oil</div>
            <div className={`font-mono font-semibold ${oil < 5 ? 'text-orange-600 dark:text-orange-400' : ''}`}>{oil.toFixed(2)} kg</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Per-formula planner ───────────────────────────────────────────────────────

function FormulaPlanner({
  fs, pendingOrders, today,
}: {
  fs: FormulaStatus
  pendingOrders: (ProdProductionOrder & { formula_name: string | null })[]
  today: Date
}) {
  const formula = fs.formula
  const fgWarehouse = fs.layers['fg_warehouse']?.quantity ?? 0
  const fgFactory   = fs.layers['fg_factory']?.quantity   ?? 0
  const burn        = fs.burn_rate_per_day

  const [callRounds, setCallRounds] = useState<PlannerRound[]>(() => {
    const rows = pendingOrders
      .filter(o => o.formula_id === formula.id && o.expected_at && o.order_type === 'call_fg')
      .map(o => ({ id: o.id, date: o.expected_at!.slice(0, 10), qty: String(o.ordered_qty) }))
    while (rows.length < 3) rows.push({ id: genId(), date: '', qty: '' })
    return rows.slice(0, 10)
  })

  const [prodRounds, setProdRounds] = useState<PlannerRound[]>(() => {
    const rows = pendingOrders
      .filter(o => o.formula_id === formula.id && o.order_type === 'production')
      .map(o => ({ id: o.id, date: o.ordered_at.slice(0, 10), qty: String(o.ordered_qty) }))
    while (rows.length < 2) rows.push({ id: genId(), date: '', qty: '' })
    return rows.slice(0, 5)
  })

  // ── Tube & Oil state lifted here for save ──────────────────────────────────
  const [tubeSentRounds, setTubeSentRounds] = useState<PlannerRound[]>([makeEmptyRound(), makeEmptyRound()])
  const [tubeNewRounds, setTubeNewRounds]   = useState<PlannerRound[]>([makeEmptyRound()])
  const [oilRounds, setOilRounds]           = useState<PlannerRound[]>([makeEmptyRound()])

  const timeline = useMemo(
    () => computeUnifiedTimeline(fgWarehouse, fgFactory, burn, callRounds, prodRounds, today, formula.lead_time_production_min_days),
    [fgWarehouse, fgFactory, burn, callRounds, prodRounds, today, formula.lead_time_production_min_days],
  )

  // ── Forecast save ──────────────────────────────────────────────────────────
  const { snapshots, loaded, load: loadSnapshots, addSnapshot, removeSnapshot } = useSavedForecasts(formula.id)
  const [showHistory, setShowHistory] = useState(false)

  function toggleHistory() {
    if (!loaded) loadSnapshots()
    setShowHistory(p => !p)
  }

  function updateRound(setter: React.Dispatch<React.SetStateAction<PlannerRound[]>>, id: string, field: 'date' | 'qty' | 'leadDays', val: string) {
    setter(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r))
  }
  function removeRound(setter: React.Dispatch<React.SetStateAction<PlannerRound[]>>, id: string) {
    setter(prev => prev.filter(r => r.id !== id))
  }
  function addRound(setter: React.Dispatch<React.SetStateAction<PlannerRound[]>>) {
    setter(prev => [...prev, { id: genId(), date: '', qty: '' }])
  }

  return (
    <div className="space-y-4">
      {/* ── Stock summary grid ──────────────────────────────────────────────── */}
      <StockSummaryGrid fs={fs} burn={burn} />

      {/* Input grid: call rounds (left) | production rounds (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Call rounds */}
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            🏠→🏭 เรียก FG จากโรงงาน (วันที่รับ · จำนวน)
          </p>
          {callRounds.map((r, idx) => (
            <div key={r.id} className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground w-4 text-right shrink-0">{idx + 1}.</span>
              <input type="date" value={r.date}
                onChange={e => updateRound(setCallRounds, r.id, 'date', e.target.value)}
                className="h-7 text-xs border rounded px-2 flex-1 min-w-0 bg-background" />
              <input type="text" inputMode="numeric" value={r.qty} placeholder="จำนวน"
                onChange={e => updateRound(setCallRounds, r.id, 'qty', e.target.value)}
                className="h-7 text-xs border rounded px-2 w-20 font-mono bg-background" />
              <button onClick={() => removeRound(setCallRounds, r.id)} className="text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {callRounds.length < 10 && (
            <button onClick={() => addRound(setCallRounds)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Plus className="h-3 w-3" /> เพิ่มรอบ
            </button>
          )}
        </div>

        {/* Production rounds */}
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            🏭 สั่งผลิต (วันสั่ง · จำนวน · Lead days)
          </p>
          {prodRounds.map((r, idx) => {
            const d = parseRoundDate(r.date)
            const effectiveLead = Math.max(15, parseInt(r.leadDays ?? '') || formula.lead_time_production_min_days)
            const recvDate = d ? thaiDate(addDays(d, effectiveLead)) : null
            const isCustomLead = r.leadDays && parseInt(r.leadDays) !== formula.lead_time_production_min_days
            return (
              <div key={r.id} className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground w-4 text-right shrink-0">{idx + 1}.</span>
                  <input type="date" value={r.date}
                    onChange={e => updateRound(setProdRounds, r.id, 'date', e.target.value)}
                    className="h-7 text-xs border rounded px-2 flex-1 min-w-0 bg-background" />
                  <input type="text" inputMode="numeric" value={r.qty} placeholder="จำนวน"
                    onChange={e => updateRound(setProdRounds, r.id, 'qty', e.target.value)}
                    className="h-7 text-xs border rounded px-2 w-20 font-mono bg-background" />
                  <div className="flex items-center gap-0.5 shrink-0">
                    <input
                      type="number" min="15" max="90"
                      value={r.leadDays ?? String(formula.lead_time_production_min_days)}
                      onChange={e => updateRound(setProdRounds, r.id, 'leadDays', e.target.value)}
                      className={`h-7 text-xs border rounded px-1.5 w-12 text-center font-mono bg-background ${isCustomLead ? 'border-blue-400 text-blue-700 dark:text-blue-300' : ''}`}
                      title="Lead time (วัน) — min 15"
                    />
                    <span className="text-xs text-muted-foreground">ว</span>
                  </div>
                  <button onClick={() => removeRound(setProdRounds, r.id)} className="text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </div>
                {recvDate && (
                  <p className="text-xs text-green-600 dark:text-green-400 pl-5">
                    ↳ รับที่โรงงาน {recvDate}
                    {isCustomLead && <span className="ml-1 text-blue-500">(เร่ง {effectiveLead} วัน)</span>}
                  </p>
                )}
              </div>
            )
          })}
          {prodRounds.length < 5 && (
            <button onClick={() => addRound(setProdRounds)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Plus className="h-3 w-3" /> เพิ่มรอบ
            </button>
          )}
        </div>
      </div>

      {/* Unified timeline table */}
      <UnifiedTimelineTable
        today={today}
        fgWarehouse={fgWarehouse}
        fgFactory={fgFactory}
        burn={burn}
        rows={timeline}
      />

      {/* ── Save forecast ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <BookmarkCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <SaveForecastBar
          payload={{
            formula_id: formula.id,
            fg_warehouse_qty: fgWarehouse,
            fg_factory_qty: fgFactory,
            burn_rate: burn,
            call_rounds: callRounds.filter(r => r.date && r.qty),
            prod_rounds: prodRounds.filter(r => r.date && r.qty),
            tubes_warehouse_qty: fs.layers['tubes_warehouse']?.quantity ?? null,
            tubes_factory_qty:   fs.layers['tubes_factory']?.quantity   ?? null,
            tube_sent_rounds:    tubeSentRounds.filter(r => r.date && r.qty),
            tube_new_rounds:     tubeNewRounds.filter(r => r.date && r.qty),
            oil_qty_kg:          fs.layers['oil_kg']?.quantity ?? null,
            oil_rounds:          oilRounds.filter(r => r.date && r.qty),
          }}
          onSaved={snap => { addSnapshot(snap); setShowHistory(true) }}
        />
        <button
          onClick={toggleHistory}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          ประวัติแผน {snapshots.length > 0 && `(${snapshots.length})`}
          <ChevronDown className={`h-3 w-3 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {showHistory && (
        <SavedForecastsList snapshots={snapshots} formula={formula} onDelete={removeSnapshot} />
      )}

      {/* ── Tube runway ─────────────────────────────────────────────────────── */}
      <TubesPlanner
        fs={fs} prodRounds={prodRounds} today={today}
        tubeSentRounds={tubeSentRounds} setTubeSentRounds={setTubeSentRounds}
        tubeNewRounds={tubeNewRounds} setTubeNewRounds={setTubeNewRounds}
      />

      {/* ── Oil runway ──────────────────────────────────────────────────────── */}
      <OilPlanner
        fs={fs} prodRounds={prodRounds} today={today}
        oilRounds={oilRounds} setOilRounds={setOilRounds}
      />
    </div>
  )
}

// ── Unified timeline table ────────────────────────────────────────────────────

function UnifiedTimelineTable({ today, fgWarehouse, fgFactory, burn, rows }: {
  today: Date
  fgWarehouse: number
  fgFactory: number
  burn: number
  rows: UnifiedRow[]
}) {
  const hasDeficit = rows.some(r => r.factoryDeficit)

  return (
    <div className="rounded-lg border overflow-hidden text-xs">
      {/* Table header */}
      <div className="grid grid-cols-[140px_1fr_100px_100px] bg-muted/50 border-b">
        <div className="px-3 py-2 font-medium text-muted-foreground">วันที่</div>
        <div className="px-3 py-2 font-medium text-muted-foreground">เหตุการณ์</div>
        <div className="px-3 py-2 font-medium text-muted-foreground text-right">🏠 คลังเรา</div>
        <div className={`px-3 py-2 font-medium text-right ${hasDeficit ? 'text-red-500' : 'text-muted-foreground'}`}>
          🏭 โรงงาน{hasDeficit ? ' ⚠️' : ''}
        </div>
      </div>

      {/* Start row */}
      <div className="grid grid-cols-[140px_1fr_100px_100px] border-b bg-muted/20">
        <div className="px-3 py-2 text-muted-foreground">{thaiDate(today)}</div>
        <div className="px-3 py-2 text-muted-foreground">เริ่มต้น</div>
        <div className="px-3 py-2 text-right font-mono">{fgWarehouse.toLocaleString()}</div>
        <div className="px-3 py-2 text-right font-mono">{fgFactory.toLocaleString()}</div>
      </div>

      {/* Event rows */}
      {rows.map((row, i) => {
        const isRunout   = row.type === 'warehouse_empty'
        const isTransfer = row.type === 'transfer'
        const isProd     = row.type === 'prod_receive'

        const rowBg = isRunout
          ? 'bg-red-50 dark:bg-red-950/30'
          : isProd
            ? 'bg-green-50 dark:bg-green-950/20'
            : isTransfer
              ? 'bg-blue-50 dark:bg-blue-950/20'
              : ''

        return (
          <div key={i} className={`border-b last:border-0 ${rowBg}`}>
            <div className="grid grid-cols-[140px_1fr_100px_100px]">
              {/* Date */}
              <div className={`px-3 py-2 ${isRunout ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground'}`}>
                {thaiDate(row.date)}
                <span className="ml-1 opacity-60 text-[10px]">+{row.dayOffset}ว</span>
              </div>

              {/* Event description */}
              <div className="px-3 py-2">
                {isRunout && (
                  <span className="text-red-600 dark:text-red-400 font-medium">⛔ FG คลังเราหมด</span>
                )}
                {isTransfer && (
                  <span className="text-blue-700 dark:text-blue-300">
                    ↕ รับ {row.qty!.toLocaleString()} หลอด (เรียกจากโรงงาน)
                    {row.warehouseBeforeCall !== undefined && row.warehouseBeforeCall < burn * 2 && (
                      <span className="ml-2 text-orange-500 text-[10px]">
                        ⚠️ คลังเหลือ {row.warehouseBeforeCall.toLocaleString()} ก่อนรับ
                      </span>
                    )}
                  </span>
                )}
                {isProd && (
                  <span className="text-green-700 dark:text-green-400">
                    ↑ รับผลิต {row.qty!.toLocaleString()} หลอด
                  </span>
                )}
              </div>

              {/* FG คลังเรา after */}
              <div className={`px-3 py-2 text-right font-mono ${isRunout ? 'text-red-600 dark:text-red-400 font-bold' : ''}`}>
                {isRunout ? '0' : isProd ? <span className="text-muted-foreground">—</span> : row.warehouseAfter.toLocaleString()}
              </div>

              {/* FG โรงงาน after */}
              <div className={`px-3 py-2 text-right font-mono ${row.factoryDeficit ? 'text-red-600 dark:text-red-400 font-bold' : isProd ? 'text-green-700 dark:text-green-400' : ''}`}>
                {row.factoryAfter.toLocaleString()}
                {row.factoryDeficit && ' ⚠️'}
              </div>
            </div>

            {/* Factory deficit warning row */}
            {row.factoryDeficit && (
              <div className="px-3 pb-2 text-red-500 text-[10px] col-span-4">
                ⚠️ โรงงานของไม่พอ — ต้องสั่งผลิตเพิ่ม หรือลดจำนวนเรียก
              </div>
            )}
          </div>
        )
      })}

      {rows.length === 0 && (
        <div className="px-3 py-4 text-center text-muted-foreground">
          ใส่รอบเรียกของเพื่อดูประมาณการ
        </div>
      )}
    </div>
  )
}
