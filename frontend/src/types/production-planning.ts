export type ProdStockType =
  | 'fg_warehouse'
  | 'fg_factory'
  | 'tubes_factory'
  | 'tubes_warehouse'
  | 'oil_kg'

export type ProdOrderType = 'call_fg' | 'production' | 'tubes' | 'oil'
export type ProdOrderStatus = 'pending' | 'received' | 'cancelled'

export interface ProdFormulaConfig {
  id: string
  sku_internal: string
  formula_name: string
  uses_oil: boolean
  oil_per_1000_tubes_kg: number
  lead_time_fg_days: number
  lead_time_production_min_days: number
  lead_time_production_max_days: number
  lead_time_tubes_days: number
  lead_time_oil_days: number
  min_production_qty: number
  min_tubes_qty: number
  min_oil_kg: number
  alert_fg_days: number
  alert_production_days: number
  alert_tubes_days: number
  alert_oil_days: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface ProdStockLedger {
  id: string
  formula_id: string | null
  stock_type: ProdStockType
  quantity: number
  snapshot_date: string
  notes: string | null
  recorded_by: string | null
  recorded_at: string
}

export interface ProdProductionOrder {
  id: string
  order_type: ProdOrderType
  formula_id: string | null
  ordered_qty: number
  ordered_at: string
  expected_at: string | null
  received_qty: number | null
  received_at: string | null
  status: ProdOrderStatus
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// ── Dashboard view types ──────────────────────────────────────────────────────

export type AlertLevel = 'ok' | 'warning' | 'critical'

export interface StockLayer {
  stock_type: ProdStockType
  quantity: number
  snapshot_date: string
  recorded_at: string
}

export interface FormulaStatus {
  formula: ProdFormulaConfig
  layers: Partial<Record<ProdStockType, StockLayer>>
  burn_rate_per_day: number       // avg daily realistic sales last 7 days
  days_of_supply: {
    fg_warehouse: number | null
    fg_factory: number | null
    tubes_factory: number | null
    tubes_warehouse: number | null
    oil_kg: number | null
  }
  alerts: PlanningAlert[]
}

export interface PlanningAlert {
  level: AlertLevel
  action: ProdOrderType
  message: string
  days_remaining: number | null
  suggested_qty: number
}

export interface DashboardData {
  formulas: FormulaStatus[]
  pending_orders: (ProdProductionOrder & { formula_name: string | null })[]
  last_updated: string
}

// ── Form input types ──────────────────────────────────────────────────────────

export interface StockEntryInput {
  formula_id: string
  stock_type: ProdStockType
  quantity: number
  snapshot_date: string
  notes?: string
}

export interface CreateOrderInput {
  order_type: ProdOrderType
  formula_id: string
  ordered_qty: number
  ordered_at: string
  notes?: string
}

export interface ReceiveOrderInput {
  received_qty: number
  received_at: string
  notes?: string
}

export const STOCK_TYPE_LABELS: Record<ProdStockType, string> = {
  fg_warehouse: 'FG คลังเรา',
  fg_factory: 'FG คลังโรงงาน',
  tubes_factory: 'หลอดเปล่า (โรงงาน)',
  tubes_warehouse: 'หลอดเปล่า (คลังเรา)',
  oil_kg: 'Essential Oil (kg)',
}

export const ORDER_TYPE_LABELS: Record<ProdOrderType, string> = {
  call_fg: 'เรียก FG จากโรงงาน',
  production: 'สั่งผลิต',
  tubes: 'สั่งหลอดเปล่า',
  oil: 'สั่ง Essential Oil',
}

export const ORDER_STATUS_LABELS: Record<ProdOrderStatus, string> = {
  pending: 'รอรับของ',
  received: 'รับแล้ว',
  cancelled: 'ยกเลิก',
}
