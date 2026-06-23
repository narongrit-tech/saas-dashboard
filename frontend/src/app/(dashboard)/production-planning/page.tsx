'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Package, Factory, Droplets, RefreshCw, Plus } from 'lucide-react'
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
          <p className="text-sm text-muted-foreground mt-1">
            วางแผนการผลิตและ stock ทุก layer
          </p>
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
          {/* Alert summary */}
          <AlertSummary formulas={data.formulas} />

          {/* Per-formula cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {data.formulas.map(fs => (
              <FormulaCard key={fs.formula.id} status={fs} />
            ))}
          </div>

          {/* Pending orders */}
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
        <Button size="sm" variant={isCritical ? 'destructive' : 'outline'} className="shrink-0">
          สั่ง
        </Button>
      </Link>
    </div>
  )
}

function FormulaCard({ status }: { status: FormulaStatus }) {
  const { formula, layers, burn_rate_per_day, days_of_supply: dos } = status

  const stockItems: Array<{ key: string; label: string; qty: number | undefined; unit: string; dos: number | null }> = [
    { key: 'fg_warehouse', label: 'FG คลังเรา', qty: layers['fg_warehouse']?.quantity, unit: 'หลอด', dos: dos.fg_warehouse },
    { key: 'fg_factory', label: 'FG คลังโรงงาน', qty: layers['fg_factory']?.quantity, unit: 'หลอด', dos: dos.fg_factory },
    { key: 'tubes_factory', label: 'หลอดเปล่า (โรงงาน)', qty: layers['tubes_factory']?.quantity, unit: 'หลอด', dos: dos.tubes_factory },
    { key: 'tubes_warehouse', label: 'หลอดเปล่า (คลังเรา)', qty: layers['tubes_warehouse']?.quantity, unit: 'หลอด', dos: dos.tubes_warehouse },
    ...(formula.uses_oil ? [{ key: 'oil_kg', label: 'Essential Oil', qty: layers['oil_kg']?.quantity, unit: 'kg', dos: dos.oil_kg }] : []),
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{formula.formula_name}</CardTitle>
          <div className="text-xs text-muted-foreground">
            Burn rate: <span className="font-mono font-medium">{burn_rate_per_day > 0 ? `${burn_rate_per_day.toFixed(1)} หลอด/วัน` : '—'}</span>
          </div>
        </div>
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
  if (level === 'warning') return <span className="h-2 w-2 rounded-full bg-yellow-500 shrink-0" />
  if (level === 'ok') return <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
  return <span className="h-2 w-2 rounded-full bg-gray-300 shrink-0" />
}

function getDosLevel(
  dos: number | null,
  label: string,
  formula: FormulaStatus['formula'],
): AlertLevel | 'none' {
  if (dos === null) return 'none'
  if (label.includes('FG คลังเรา')) {
    if (dos <= 3) return 'critical'
    if (dos <= formula.alert_fg_days) return 'warning'
    return 'ok'
  }
  if (label.includes('FG คลัง') || label.includes('FG')) {
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
  if (level === 'warning') return 'border-yellow-300 text-yellow-700 dark:text-yellow-400'
  if (level === 'ok') return 'border-green-300 text-green-700 dark:text-green-400'
  return ''
}
