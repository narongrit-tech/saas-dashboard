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

const CANCELLED_STATUSES = ['cancelled', 'Cancelled', 'ยกเลิกคำสั่งซื้อ', 'ยกเลิกแล้ว']

// GET /api/production-planning/dashboard?as_of=YYYY-MM-DD
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    // as_of: default = now Bangkok; we treat it as end-of-day BKK
    const { searchParams } = new URL(request.url)
    const asOfParam = searchParams.get('as_of')
    const asOf = asOfParam
      ? new Date(`${asOfParam}T23:59:59+07:00`)
      : new Date()
    const asOfDateStr = asOf.toISOString().slice(0, 10)

    // ── 1. Formula configs ──────────────────────────────────────────────────
    const { data: configs, error: cfgErr } = await supabase
      .from('prod_formula_config')
      .select('*')
      .eq('active', true)
      .order('formula_name')
    if (cfgErr) throw cfgErr

    // ── 2. Ledger transactions (new) ────────────────────────────────────────
    const { data: txRows } = await supabase
      .from('prod_stock_transactions')
      .select('formula_id, stock_type, quantity_delta, transaction_date')
      .lte('transaction_date', asOfDateStr)

    // formula_id -> stock_type -> sum of deltas
    const txBalance = new Map<string, Map<ProdStockType, number>>()
    const formulasWithTx = new Set<string>()
    for (const tx of txRows ?? []) {
      formulasWithTx.add(tx.formula_id)
      if (!txBalance.has(tx.formula_id)) txBalance.set(tx.formula_id, new Map())
      const typeMap = txBalance.get(tx.formula_id)!
      const prev = typeMap.get(tx.stock_type as ProdStockType) ?? 0
      typeMap.set(tx.stock_type as ProdStockType, prev + Number(tx.quantity_delta))
    }

    // ── 3. Production orders received — auto credit to fg_factory ───────────
    const { data: receivedOrders } = await supabase
      .from('prod_production_orders')
      .select('formula_id, received_qty')
      .eq('status', 'received')
      .lte('received_at', asOf.toISOString())
      .not('received_qty', 'is', null)

    // formula_id -> total received (adds to fg_factory)
    const productionReceived = new Map<string, number>()
    for (const o of receivedOrders ?? []) {
      if (!o.received_qty) continue
      productionReceived.set(o.formula_id, (productionReceived.get(o.formula_id) ?? 0) + Number(o.received_qty))
    }

    // ── 4. SKU mappings + cumulative sales up to asOf (auto debit fg_warehouse) ─
    const { data: mappingRows } = await supabase
      .from('inventory_sku_mappings')
      .select('marketplace_sku, sku_internal')
    const skuMap: Record<string, string> = {}
    for (const m of mappingRows ?? []) {
      if (m.marketplace_sku && m.sku_internal) skuMap[m.marketplace_sku] = m.sku_internal
    }

    // internalSku -> total sold up to asOf
    const { data: allSalesUpToDate } = await supabase
      .from('sales_orders')
      .select('sku, quantity, status')
      .not('status', 'in', `(${CANCELLED_STATUSES.map(s => `"${s}"`).join(',')})`)
      .lte('order_date', asOf.toISOString())

    const totalSoldBySku: Record<string, number> = {}
    for (const row of allSalesUpToDate ?? []) {
      if (!row.sku) continue
      const internal = skuMap[row.sku] ?? row.sku
      totalSoldBySku[internal] = (totalSoldBySku[internal] ?? 0) + (row.quantity ?? 1)
    }

    // ── 5. Burn rate: sales in window ending at asOf ────────────────────────
    const maxWindow = Math.max(...(configs ?? []).map((c: ProdFormulaConfig) => c.burn_rate_window_days ?? 7), 7)
    const windowStart = new Date(asOf)
    windowStart.setDate(windowStart.getDate() - maxWindow)

    const { data: salesRows, error: salesErr } = await supabase
      .from('sales_orders')
      .select('sku, quantity, order_date, status')
      .not('status', 'in', `(${CANCELLED_STATUSES.map(s => `"${s}"`).join(',')})`)
      .gte('order_date', windowStart.toISOString())
      .lte('order_date', asOf.toISOString())
    if (salesErr) throw salesErr

    type DailyRow = { date: string; qty: number }
    const skuDailyRows: Record<string, DailyRow[]> = {}
    for (const row of salesRows ?? []) {
      if (!row.sku) continue
      const internalSku = skuMap[row.sku] ?? row.sku
      const date = row.order_date?.slice(0, 10) ?? ''
      if (!skuDailyRows[internalSku]) skuDailyRows[internalSku] = []
      skuDailyRows[internalSku].push({ date, qty: row.quantity ?? 1 })
    }

    // ── 6. Snapshot fallback (for formulas without transactions) ────────────
    const { data: stockRows, error: stockErr } = await supabase
      .from('prod_stock_ledger')
      .select('*')
      .lte('snapshot_date', asOfDateStr)
      .order('snapshot_date', { ascending: false })
      .order('recorded_at',   { ascending: false })
    if (stockErr) throw stockErr

    const latestSnapshot = new Map<string, Map<ProdStockType, StockLayer>>()
    for (const row of stockRows ?? []) {
      const fid = row.formula_id ?? '__oil__'
      if (!latestSnapshot.has(fid)) latestSnapshot.set(fid, new Map())
      const typeMap = latestSnapshot.get(fid)!
      if (!typeMap.has(row.stock_type)) {
        typeMap.set(row.stock_type, {
          stock_type: row.stock_type,
          quantity: Number(row.quantity),
          snapshot_date: row.snapshot_date,
          recorded_at: row.recorded_at,
        })
      }
    }

    // ── 7. Pending production orders ────────────────────────────────────────
    const { data: pendingOrders, error: ordErr } = await supabase
      .from('prod_production_orders')
      .select('*, prod_formula_config(formula_name)')
      .eq('status', 'pending')
      .order('ordered_at', { ascending: false })
    if (ordErr) throw ordErr

    // ── 8. Build FormulaStatus per formula ───────────────────────────────────
    const formulas: FormulaStatus[] = (configs ?? []).map((cfg: ProdFormulaConfig) => {
      const useLedger = formulasWithTx.has(cfg.id)

      let layers: Partial<Record<ProdStockType, StockLayer>>

      if (useLedger) {
        // Compute each type from ledger transactions
        const typeMap = txBalance.get(cfg.id) ?? new Map<ProdStockType, number>()

        const makeLayer = (type: ProdStockType, extra: number = 0): StockLayer | undefined => {
          const base = typeMap.get(type) ?? 0
          const qty  = base + extra
          // only return a layer if there's a transaction entry for this type (or extra > 0)
          if (!typeMap.has(type) && extra === 0) return undefined
          return { stock_type: type, quantity: qty, snapshot_date: asOfDateStr, recorded_at: asOf.toISOString() }
        }

        const prodReceived = productionReceived.get(cfg.id) ?? 0
        const totalSold    = totalSoldBySku[cfg.sku_internal] ?? 0

        layers = {
          fg_factory:      makeLayer('fg_factory',      prodReceived),
          fg_warehouse:    makeLayer('fg_warehouse',    -totalSold),
          tubes_factory:   makeLayer('tubes_factory'),
          tubes_warehouse: makeLayer('tubes_warehouse'),
          oil_kg:          cfg.uses_oil ? makeLayer('oil_kg') : undefined,
        }

        // Remove undefined keys
        for (const k of Object.keys(layers) as ProdStockType[]) {
          if (layers[k] === undefined) delete layers[k]
        }
      } else {
        // Fallback: latest snapshot
        const typeMap = latestSnapshot.get(cfg.id) ?? new Map<ProdStockType, StockLayer>()
        layers = {}
        for (const [k, v] of typeMap.entries()) layers[k] = v
        if (cfg.uses_oil) {
          const oilMap = latestSnapshot.get(cfg.id)
          if (oilMap?.has('oil_kg')) layers['oil_kg'] = oilMap.get('oil_kg')!
        }
      }

      // Burn rate
      let burnRatePerDay: number
      if (cfg.burn_rate_override !== null && cfg.burn_rate_override !== undefined) {
        burnRatePerDay = Number(cfg.burn_rate_override)
      } else {
        const windowDays = cfg.burn_rate_window_days ?? 7
        const cutoff = new Date(asOf)
        cutoff.setDate(cutoff.getDate() - windowDays)
        const cutoffStr = cutoff.toISOString().slice(0, 10)
        const totalQty = (skuDailyRows[cfg.sku_internal] ?? [])
          .filter(r => r.date >= cutoffStr)
          .reduce((sum, r) => sum + r.qty, 0)
        burnRatePerDay = totalQty / windowDays
      }

      const dos = {
        fg_warehouse:    calcDos(layers['fg_warehouse']?.quantity,    burnRatePerDay),
        fg_factory:      calcDos(layers['fg_factory']?.quantity,      burnRatePerDay),
        tubes_factory:   calcDos(layers['tubes_factory']?.quantity,   burnRatePerDay),
        tubes_warehouse: calcDos(layers['tubes_warehouse']?.quantity, burnRatePerDay),
        oil_kg: cfg.uses_oil
          ? calcOilDos(layers['oil_kg']?.quantity, burnRatePerDay, cfg.oil_per_1000_tubes_kg)
          : null,
      }

      const alerts = buildAlerts(cfg, dos, burnRatePerDay)
      return { formula: cfg, layers, burn_rate_per_day: burnRatePerDay, days_of_supply: dos, alerts, use_ledger: useLedger }
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

function calcOilDos(oilKg: number | undefined, burnRatePerDay: number, oilPer1000: number): number | null {
  if (oilKg === undefined || oilKg === null) return null
  if (burnRatePerDay <= 0) return null
  return Math.floor(oilKg / (burnRatePerDay * oilPer1000 / 1000))
}

function buildAlerts(cfg: ProdFormulaConfig, dos: FormulaStatus['days_of_supply'], burnRate: number): PlanningAlert[] {
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
    const kgNeeded = Math.max(cfg.min_oil_kg, Math.ceil(((burnRate * 90 * cfg.oil_per_1000_tubes_kg) / 1000) * 10) / 10)
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
