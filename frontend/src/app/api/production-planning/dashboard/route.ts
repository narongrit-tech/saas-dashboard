import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type {
  DashboardData,
  FormulaStatus,
  PlanningAlert,
  ProdFormulaConfig,
  ProdStockType,
  StockLayer,
} from '@/types/production-planning'

// GET /api/production-planning/dashboard?as_of=YYYY-MM-DD
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    // as_of defaults to today Bangkok
    const { searchParams } = new URL(request.url)
    const asOfParam = searchParams.get('as_of')
    const asOf = asOfParam
      ? new Date(`${asOfParam}T23:59:59+07:00`)   // end of selected day BKK
      : new Date()
    const asOfDateStr = asOf.toISOString().slice(0, 10)   // YYYY-MM-DD for stock filter

    // 1. Load formula configs
    const { data: configs, error: cfgErr } = await supabase
      .from('prod_formula_config')
      .select('*')
      .eq('active', true)
      .order('formula_name')
    if (cfgErr) throw cfgErr

    // 2. Stock as-of: all rows with snapshot_date <= asOf, then take latest per formula+type
    const { data: stockRows, error: stockErr } = await supabase
      .from('prod_stock_ledger')
      .select('*')
      .lte('snapshot_date', asOfDateStr)
      .order('snapshot_date', { ascending: false })
      .order('recorded_at',   { ascending: false })
    if (stockErr) throw stockErr

    // Build map: formula_id -> stock_type -> latest row on or before asOf
    const latestStock = new Map<string, Map<ProdStockType, StockLayer>>()
    for (const row of stockRows ?? []) {
      const fid = row.formula_id ?? '__oil__'
      if (!latestStock.has(fid)) latestStock.set(fid, new Map())
      const typeMap = latestStock.get(fid)!
      if (!typeMap.has(row.stock_type)) {
        typeMap.set(row.stock_type, {
          stock_type: row.stock_type,
          quantity: Number(row.quantity),
          snapshot_date: row.snapshot_date,
          recorded_at: row.recorded_at,
        })
      }
    }

    // 3. Burn rate: sales in window ending at asOf
    const { data: mappingRows } = await supabase
      .from('inventory_sku_mappings')
      .select('marketplace_sku, sku_internal')
    const skuMap: Record<string, string> = {}
    for (const m of mappingRows ?? []) {
      if (m.marketplace_sku && m.sku_internal) skuMap[m.marketplace_sku] = m.sku_internal
    }

    const maxWindow = Math.max(...(configs ?? []).map((c: ProdFormulaConfig) => c.burn_rate_window_days ?? 7), 7)
    const windowStart = new Date(asOf)
    windowStart.setDate(windowStart.getDate() - maxWindow)

    const CANCELLED_STATUSES = ['cancelled', 'Cancelled', 'ยกเลิกคำสั่งซื้อ', 'ยกเลิกแล้ว']
    const { data: salesRows, error: salesErr } = await supabase
      .from('sales_orders')
      .select('sku, quantity, order_date, status')
      .not('status', 'in', `(${CANCELLED_STATUSES.map(s => `"${s}"`).join(',')})`)
      .gte('order_date', windowStart.toISOString())
      .lte('order_date', asOf.toISOString())
    if (salesErr) throw salesErr

    // Build per-sku daily rows: { internalSku -> [{ date, qty }] }
    type DailyRow = { date: string; qty: number }
    const skuDailyRows: Record<string, DailyRow[]> = {}
    for (const row of salesRows ?? []) {
      if (!row.sku) continue
      const internalSku = skuMap[row.sku] ?? row.sku
      const date = row.order_date?.slice(0, 10) ?? ''
      if (!skuDailyRows[internalSku]) skuDailyRows[internalSku] = []
      skuDailyRows[internalSku].push({ date, qty: row.quantity ?? 1 })
    }

    // 4. Pending orders
    const { data: pendingOrders, error: ordErr } = await supabase
      .from('prod_production_orders')
      .select('*, prod_formula_config(formula_name)')
      .eq('status', 'pending')
      .order('ordered_at', { ascending: false })
    if (ordErr) throw ordErr

    // 5. Build FormulaStatus per formula
    const formulas: FormulaStatus[] = (configs ?? []).map((cfg: ProdFormulaConfig) => {
      const typeMap = latestStock.get(cfg.id) ?? new Map<ProdStockType, StockLayer>()

      const layers: Partial<Record<ProdStockType, StockLayer>> = {}
      for (const [k, v] of typeMap.entries()) layers[k] = v

      if (cfg.uses_oil) {
        const oilMap = latestStock.get(cfg.id)
        if (oilMap?.has('oil_kg')) layers['oil_kg'] = oilMap.get('oil_kg')!
      }

      // Burn rate: override wins; otherwise avg over this formula's window
      let burnRatePerDay: number
      if (cfg.burn_rate_override !== null && cfg.burn_rate_override !== undefined) {
        burnRatePerDay = Number(cfg.burn_rate_override)
      } else {
        const windowDays = cfg.burn_rate_window_days ?? 7
        const cutoff = new Date(now)
        cutoff.setDate(cutoff.getDate() - windowDays)
        const cutoffStr = cutoff.toISOString().slice(0, 10)
        const totalQty = (skuDailyRows[cfg.sku_internal] ?? [])
          .filter(r => r.date >= cutoffStr)
          .reduce((sum, r) => sum + r.qty, 0)
        burnRatePerDay = totalQty / windowDays
      }

      const dos = {
        fg_warehouse: calcDos(layers['fg_warehouse']?.quantity, burnRatePerDay),
        fg_factory: calcDos(layers['fg_factory']?.quantity, burnRatePerDay),
        tubes_factory: calcDos(layers['tubes_factory']?.quantity, burnRatePerDay),
        tubes_warehouse: calcDos(layers['tubes_warehouse']?.quantity, burnRatePerDay),
        oil_kg: cfg.uses_oil
          ? calcOilDos(layers['oil_kg']?.quantity, burnRatePerDay, cfg.oil_per_1000_tubes_kg)
          : null,
      }

      const alerts = buildAlerts(cfg, dos, burnRatePerDay)

      return { formula: cfg, layers, burn_rate_per_day: burnRatePerDay, days_of_supply: dos, alerts }
    })

    const data: DashboardData = {
      formulas,
      pending_orders: (pendingOrders ?? []).map((o: any) => ({
        ...o,
        formula_name: o.prod_formula_config?.formula_name ?? null,
        prod_formula_config: undefined,
      })),
      last_updated: new Date().toISOString(),
    }

    return NextResponse.json({ success: true, data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

function calcDos(qty: number | undefined, burnRate: number): number | null {
  if (qty === undefined || qty === null) return null
  if (burnRate <= 0) return null
  return Math.floor(qty / burnRate)
}

function calcOilDos(
  oilKg: number | undefined,
  burnRatePerDay: number,
  oilPer1000: number,
): number | null {
  if (oilKg === undefined || oilKg === null) return null
  if (burnRatePerDay <= 0) return null
  const oilPerTube = oilPer1000 / 1000
  const oilBurnPerDay = burnRatePerDay * oilPerTube
  return Math.floor(oilKg / oilBurnPerDay)
}

function buildAlerts(
  cfg: ProdFormulaConfig,
  dos: FormulaStatus['days_of_supply'],
  burnRate: number,
): PlanningAlert[] {
  const alerts: PlanningAlert[] = []

  if (dos.fg_warehouse !== null && dos.fg_warehouse <= cfg.alert_fg_days) {
    alerts.push({
      level: dos.fg_warehouse <= 3 ? 'critical' : 'warning',
      action: 'call_fg',
      message: `FG คลังเรา ${dos.fg_warehouse} วัน — เรียก FG จากโรงงาน`,
      days_remaining: dos.fg_warehouse,
      suggested_qty: Math.max(cfg.min_production_qty, Math.ceil(burnRate * 30)),
    })
  }

  const fgTotal = (dos.fg_warehouse ?? 0) + (dos.fg_factory ?? 0)
  if (dos.fg_warehouse !== null && fgTotal <= cfg.alert_production_days) {
    alerts.push({
      level: fgTotal <= 20 ? 'critical' : 'warning',
      action: 'production',
      message: `FG รวม ${fgTotal} วัน — ควรสั่งผลิต (lead time ${cfg.lead_time_production_max_days} วัน)`,
      days_remaining: fgTotal,
      suggested_qty: Math.max(cfg.min_production_qty, Math.ceil(burnRate * 60)),
    })
  }

  const tubesTotal = (dos.tubes_factory ?? 0) + (dos.tubes_warehouse ?? 0)
  if (dos.tubes_factory !== null && tubesTotal <= cfg.alert_tubes_days) {
    alerts.push({
      level: tubesTotal <= 45 ? 'critical' : 'warning',
      action: 'tubes',
      message: `หลอดเปล่ารวม ${tubesTotal} วัน — ควรสั่ง (lead time ${cfg.lead_time_tubes_days} วัน)`,
      days_remaining: tubesTotal,
      suggested_qty: Math.max(cfg.min_tubes_qty, Math.ceil(burnRate * 90)),
    })
  }

  if (cfg.uses_oil && dos.oil_kg !== null && dos.oil_kg <= cfg.alert_oil_days) {
    const kgNeeded = Math.max(
      cfg.min_oil_kg,
      Math.ceil(((burnRate * 90 * cfg.oil_per_1000_tubes_kg) / 1000) * 10) / 10,
    )
    alerts.push({
      level: dos.oil_kg <= 45 ? 'critical' : 'warning',
      action: 'oil',
      message: `Essential Oil ${dos.oil_kg} วัน — ควรสั่ง (lead time ${cfg.lead_time_oil_days} วัน)`,
      days_remaining: dos.oil_kg,
      suggested_qty: kgNeeded,
    })
  }

  return alerts
}
