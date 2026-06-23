'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Plus, Settings2, X, Check } from 'lucide-react'
import Link from 'next/link'
import type { DashboardData, FormulaStatus, PlanningAlert, AlertLevel } from '@/types/production-planning'
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
