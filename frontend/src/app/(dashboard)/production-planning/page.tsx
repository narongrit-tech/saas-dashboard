'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Plus, Settings2, X, Check, TrendingDown } from 'lucide-react'
import Link from 'next/link'
import type { DashboardData, FormulaStatus, PlanningAlert, AlertLevel, ProdProductionOrder } from '@/types/production-planning'
import { ORDER_TYPE_LABELS, STOCK_TYPE_LABELS } from '@/types/production-planning'

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
                  <CardTitle className="text-base">คำสั่งซื้อที่รอรับของ</CardTitle>
                  <Link href="/production-planning/orders">
                    <Button variant="ghost" size="sm">ดูทั้งหมด →</Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.pending_orders.slice(0, 5).map(order => (
                    <div key={order.id} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{ORDER_TYPE_LABELS[order.order_type]}</Badge>
                        <span className="text-muted-foreground">{order.formula_name ?? '—'}</span>
                      </div>
                      <div className="flex items-center gap-3 text-right">
                        <span className="font-mono font-medium">
                          {order.order_type === 'oil'
                            ? `${Number(order.ordered_qty).toFixed(1)} kg`
                            : Number(order.ordered_qty).toLocaleString()
                          }
                        </span>
                        {order.expected_at && (
                          <span className="text-muted-foreground text-xs">
                            คาดรับ {new Date(order.expected_at).toLocaleDateString('th-TH')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
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

interface PlannerRound { id: string; date: string; qty: string }

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

function computeWarehouseTimeline(
  startStock: number,
  burnPerDay: number,
  callRounds: PlannerRound[],
  today: Date,
): WMilestone[] {
  if (burnPerDay <= 0) return []

  const validCalls = callRounds
    .map(r => ({ date: parseRoundDate(r.date), qty: parseRoundQty(r.qty) }))
    .filter((r): r is { date: Date; qty: number } => r.date !== null && r.qty > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  const milestones: WMilestone[] = []
  let stock = startStock
  let currentDayOffset = 0

  for (let ci = 0; ci <= validCalls.length; ci++) {
    const nextCall = validCalls[ci] ?? null
    const daysUntilNextCall = nextCall
      ? Math.max(0, (nextCall.date.getTime() - addDays(today, currentDayOffset).getTime()) / 86400000)
      : Infinity
    const daysUntilEmpty = stock > 0 ? stock / burnPerDay : 0

    if (daysUntilEmpty <= daysUntilNextCall) {
      // Runs out before (or on same day as) next call
      const runoutOffset = currentDayOffset + Math.ceil(daysUntilEmpty)
      milestones.push({ type: 'runout', dayOffset: runoutOffset, date: addDays(today, runoutOffset), stockAfter: 0 })
      stock = 0
      if (nextCall) {
        const callOffset = currentDayOffset + Math.round(daysUntilNextCall)
        milestones.push({
          type: 'call_in', dayOffset: callOffset, date: addDays(today, callOffset),
          qty: nextCall.qty, stockBefore: 0, stockAfter: nextCall.qty,
        })
        stock = nextCall.qty
        currentDayOffset = callOffset
      } else {
        break
      }
    } else if (nextCall) {
      // Stock lasts until next call — call arrives with some stock remaining
      const callOffset = currentDayOffset + Math.round(daysUntilNextCall)
      const remaining = Math.max(0, stock - burnPerDay * daysUntilNextCall)
      milestones.push({
        type: 'call_in', dayOffset: callOffset, date: addDays(today, callOffset),
        qty: nextCall.qty, stockBefore: remaining, stockAfter: remaining + nextCall.qty,
      })
      stock = remaining + nextCall.qty
      currentDayOffset = callOffset
    } else {
      // No more calls — just log final runout
      const runoutOffset = currentDayOffset + Math.ceil(stock / burnPerDay)
      milestones.push({ type: 'runout', dayOffset: runoutOffset, date: addDays(today, runoutOffset), stockAfter: 0 })
      break
    }
  }

  return milestones
}

function computeFactoryTimeline(
  startStock: number,
  callRounds: PlannerRound[],
  prodRounds: PlannerRound[],
  today: Date,
  minLeadDays: number,
): FEvent[] {
  type Inp = { date: Date; type: 'call_out' | 'prod_in'; qty: number }

  const callInputs: Inp[] = callRounds
    .map(r => ({ date: parseRoundDate(r.date), qty: parseRoundQty(r.qty) }))
    .filter((r): r is { date: Date; qty: number } => r.date !== null && r.qty > 0)
    .map(r => ({ date: r.date, qty: r.qty, type: 'call_out' as const }))

  const prodInputs: Inp[] = prodRounds
    .map(r => ({ date: parseRoundDate(r.date), qty: parseRoundQty(r.qty) }))
    .filter((r): r is { date: Date; qty: number } => r.date !== null && r.qty > 0)
    .map(r => ({ date: addDays(r.date, minLeadDays), qty: r.qty, type: 'prod_in' as const }))

  const inputs: Inp[] = [...callInputs, ...prodInputs]
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  let stock = startStock
  return inputs.map(inp => {
    const dayOffset = Math.round((inp.date.getTime() - today.getTime()) / 86400000)
    const before = stock
    stock = inp.type === 'call_out' ? stock - inp.qty : stock + inp.qty
    return { type: inp.type, dayOffset, date: inp.date, qty: inp.qty, stockBefore: before, stockAfter: stock, isDeficit: stock < 0 }
  })
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

// ── Per-formula 2-layer planner ───────────────────────────────────────────────

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

  // Pre-populate from pending call_fg orders
  const [callRounds, setCallRounds] = useState<PlannerRound[]>(() => {
    const fromPending = pendingOrders
      .filter(o => o.formula_id === formula.id && o.expected_at && o.order_type === 'call_fg')
      .map(o => ({ id: o.id, date: o.expected_at!.slice(0, 10), qty: String(o.ordered_qty) }))
    while (fromPending.length < 3) fromPending.push({ id: genId(), date: '', qty: '' })
    return fromPending.slice(0, 5)
  })

  // Pre-populate from pending production orders (use ordered_at as the "order date")
  const [prodRounds, setProdRounds] = useState<PlannerRound[]>(() => {
    const fromPending = pendingOrders
      .filter(o => o.formula_id === formula.id && o.order_type === 'production')
      .map(o => ({ id: o.id, date: o.ordered_at.slice(0, 10), qty: String(o.ordered_qty) }))
    while (fromPending.length < 2) fromPending.push({ id: genId(), date: '', qty: '' })
    return fromPending.slice(0, 5)
  })

  const warehoneTimeline = useMemo(
    () => computeWarehouseTimeline(fgWarehouse, burn, callRounds, today),
    [fgWarehouse, burn, callRounds, today],
  )

  const factoryTimeline = useMemo(
    () => computeFactoryTimeline(fgFactory, callRounds, prodRounds, today, formula.lead_time_production_min_days),
    [fgFactory, callRounds, prodRounds, today, formula.lead_time_production_min_days],
  )

  function updateRound(
    setter: React.Dispatch<React.SetStateAction<PlannerRound[]>>,
    id: string, field: 'date' | 'qty', value: string,
  ) {
    setter(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }
  function removeRound(setter: React.Dispatch<React.SetStateAction<PlannerRound[]>>, id: string) {
    setter(prev => prev.filter(r => r.id !== id))
  }
  function addRound(setter: React.Dispatch<React.SetStateAction<PlannerRound[]>>) {
    setter(prev => [...prev, { id: genId(), date: '', qty: '' }])
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-sm">{formula.formula_name}</span>
        <span className="text-xs text-muted-foreground">Burn {burn.toFixed(1)} หลอด/วัน</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Layer 1: FG คลังเรา ── */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">🏠 FG คลังเรา</span>
            <Badge variant="outline" className="font-mono text-xs">{fgWarehouse.toLocaleString()} หลอด</Badge>
          </div>

          {/* Round inputs */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">รอบเรียกจากโรงงาน → คลังเรา</p>
            {callRounds.map((r, idx) => (
              <div key={r.id} className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground w-4 text-right">{idx + 1}.</span>
                <input
                  type="date"
                  value={r.date}
                  onChange={e => updateRound(setCallRounds, r.id, 'date', e.target.value)}
                  className="h-7 text-xs border rounded px-2 flex-1 min-w-0 bg-background"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={r.qty}
                  onChange={e => updateRound(setCallRounds, r.id, 'qty', e.target.value)}
                  placeholder="จำนวน"
                  className="h-7 text-xs border rounded px-2 w-20 font-mono bg-background"
                />
                <button
                  onClick={() => removeRound(setCallRounds, r.id)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {callRounds.length < 5 && (
              <button
                onClick={() => addRound(setCallRounds)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" /> เพิ่มรอบ
              </button>
            )}
          </div>

          {/* Warehouse timeline */}
          <WarehouseTimelineView today={today} startStock={fgWarehouse} burn={burn} milestones={warehoneTimeline} />
        </div>

        {/* ── Layer 2: FG คลังโรงงาน ── */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">🏭 FG คลังโรงงาน</span>
            <Badge variant="outline" className="font-mono text-xs">{fgFactory.toLocaleString()} หลอด</Badge>
          </div>

          {/* Production round inputs */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">
              รอบสั่งผลิต (รับหลัง {formula.lead_time_production_min_days}–{formula.lead_time_production_max_days} วัน)
            </p>
            {prodRounds.map((r, idx) => {
              const ordDate = parseRoundDate(r.date)
              const recvMin = ordDate ? thaiDate(addDays(ordDate, formula.lead_time_production_min_days)) : null
              const recvMax = ordDate ? thaiDate(addDays(ordDate, formula.lead_time_production_max_days)) : null
              return (
                <div key={r.id} className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground w-4 text-right">{idx + 1}.</span>
                    <input
                      type="date"
                      value={r.date}
                      onChange={e => updateRound(setProdRounds, r.id, 'date', e.target.value)}
                      className="h-7 text-xs border rounded px-2 flex-1 min-w-0 bg-background"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={r.qty}
                      onChange={e => updateRound(setProdRounds, r.id, 'qty', e.target.value)}
                      placeholder="จำนวน"
                      className="h-7 text-xs border rounded px-2 w-20 font-mono bg-background"
                    />
                    <button
                      onClick={() => removeRound(setProdRounds, r.id)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  {recvMin && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 pl-5">
                      ↳ รับได้ {recvMin}{recvMax && recvMax !== recvMin ? `–${recvMax}` : ''}
                    </p>
                  )}
                </div>
              )
            })}
            {prodRounds.length < 5 && (
              <button
                onClick={() => addRound(setProdRounds)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" /> เพิ่มรอบ
              </button>
            )}
          </div>

          {/* Factory timeline */}
          <FactoryTimelineView today={today} startStock={fgFactory} events={factoryTimeline} />
        </div>
      </div>
    </div>
  )
}

// ── Warehouse timeline display ────────────────────────────────────────────────

function WarehouseTimelineView({ today, startStock, burn, milestones }: {
  today: Date; startStock: number; burn: number; milestones: WMilestone[]
}) {
  const naturalDays = burn > 0 ? Math.ceil(startStock / burn) : 9999

  return (
    <div className="border-t pt-3 space-y-1.5">
      <p className="text-xs text-muted-foreground font-medium mb-2">ประมาณการ</p>
      {/* Start */}
      <TLRow dot="gray" label={`วันนี้ (${thaiDate(today)})`} value={`${Math.round(startStock).toLocaleString()} หลอด`} />

      {milestones.length === 0 ? (
        /* No calls — just natural runout */
        <TLRow
          dot="red"
          label={`หมด ${thaiDate(addDays(today, naturalDays))} (+${naturalDays} วัน)`}
          value="0 หลอด"
          danger
        />
      ) : (
        milestones.map((m, i) => (
          m.type === 'runout' ? (
            <TLRow
              key={i}
              dot="red"
              label={`หมด ${thaiDate(m.date)} (+${m.dayOffset} วัน)`}
              value="0 หลอด"
              danger
            />
          ) : (
            <TLRow
              key={i}
              dot="blue"
              label={`${thaiDate(m.date)} (+${m.dayOffset} วัน) รับ ${m.qty!.toLocaleString()}`}
              value={`→ ${Math.round(m.stockAfter).toLocaleString()} หลอด`}
              sub={m.stockBefore !== undefined && m.stockBefore < burn * 3
                ? `⚠️ คลังเหลือ ${Math.round(m.stockBefore).toLocaleString()} ก่อนรับ`
                : undefined}
            />
          )
        ))
      )}
    </div>
  )
}

// ── Factory timeline display ──────────────────────────────────────────────────

function FactoryTimelineView({ today, startStock, events }: {
  today: Date; startStock: number; events: FEvent[]
}) {
  const hasDeficit = events.some(e => e.isDeficit)

  return (
    <div className="border-t pt-3 space-y-1.5">
      <p className="text-xs text-muted-foreground font-medium mb-2">
        ประมาณการโรงงาน{hasDeficit && <span className="text-red-500 ml-2">⚠️ Stock ติดลบ</span>}
      </p>
      <TLRow dot="gray" label={`วันนี้ (${thaiDate(today)})`} value={`${Math.round(startStock).toLocaleString()} หลอด`} />
      {events.length === 0 && (
        <p className="text-xs text-muted-foreground">ยังไม่มีรอบ</p>
      )}
      {events.map((ev, i) => (
        <TLRow
          key={i}
          dot={ev.type === 'prod_in' ? 'green' : ev.isDeficit ? 'red' : 'orange'}
          label={`${thaiDate(ev.date)} (+${ev.dayOffset} วัน) ${ev.type === 'prod_in' ? `รับผลิต ${ev.qty.toLocaleString()}` : `เรียกไป ${ev.qty.toLocaleString()}`}`}
          value={`→ ${Math.round(ev.stockAfter).toLocaleString()} หลอด`}
          danger={ev.isDeficit}
          sub={ev.isDeficit ? '⚠️ ของไม่พอ ต้องสั่งผลิตเพิ่ม' : undefined}
        />
      ))}
    </div>
  )
}

// ── Shared timeline row ───────────────────────────────────────────────────────

function TLRow({ dot, label, value, danger, sub }: {
  dot: 'gray' | 'blue' | 'red' | 'green' | 'orange'
  label: string; value: string; danger?: boolean; sub?: string
}) {
  const dotClass = {
    gray:   'bg-gray-400',
    blue:   'bg-blue-500',
    red:    'bg-red-500',
    green:  'bg-green-500',
    orange: 'bg-orange-400',
  }[dot]

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2 text-xs">
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClass}`} />
        <span className={danger ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground'}>
          {label}
        </span>
        <span className={`ml-auto font-mono shrink-0 ${danger ? 'text-red-600 dark:text-red-400' : ''}`}>
          {value}
        </span>
      </div>
      {sub && <p className="text-xs text-orange-500 pl-3.5">{sub}</p>}
    </div>
  )
}
