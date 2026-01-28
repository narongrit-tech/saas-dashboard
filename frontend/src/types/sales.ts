export type SalesOrderStatus = 'completed' | 'pending' | 'cancelled'

export type Marketplace = 'TikTok' | 'Shopee' | 'Lazada' | 'Line' | 'Facebook'

export interface SalesOrder {
  id: string
  order_id: string
  marketplace: string
  channel?: string | null
  product_name: string
  sku?: string | null
  quantity: number
  unit_price: number
  total_amount: number
  cost_per_unit?: number | null
  order_date: string
  status: SalesOrderStatus
  customer_name?: string | null
  notes?: string | null
  source?: string | null
  created_at: string
  updated_at: string
  created_by?: string | null

  // UX v2: Platform-specific fields
  source_platform?: string | null // tiktok_shop | shopee | lazada
  external_order_id?: string | null // Original platform order ID
  platform_status?: string | null // Order Substatus (รอจัดส่ง, อยู่ระหว่างงานขนส่ง) - MAIN UI STATUS
  status_group?: string | null // Order Status (ที่จัดส่ง, ชำระเงินแล้ว, ยกเลิกแล้ว) - Group filter
  platform_substatus?: string | null // Platform sub-status (deprecated)
  payment_status?: string | null // paid | unpaid | partial | refunded
  paid_at?: string | null // YYYY-MM-DD HH:MM:SS
  shipped_at?: string | null // YYYY-MM-DD HH:MM:SS
  delivered_at?: string | null // YYYY-MM-DD HH:MM:SS
  seller_sku?: string | null // Seller-defined SKU
  sku_id?: string | null // Platform SKU ID

  // TikTok Business Timestamps (from metadata, now direct columns)
  created_time?: string | null // When customer placed order (TikTok Create Time)
  paid_time?: string | null // When payment was confirmed (TikTok Paid Time)
  cancelled_time?: string | null // When order was cancelled (TikTok Cancelled Time)
}

export interface SalesOrderFilters {
  marketplace?: string // Legacy filter (will use source_platform instead)
  sourcePlatform?: string // UX v2: tiktok_shop | shopee | All
  status?: string[] // UX v2: Multi-select internal status
  platformStatus?: string // UX v2: Platform-specific status filter
  paymentStatus?: string // UX v2: paid | unpaid | All
  startDate?: string
  endDate?: string
  search?: string
  page: number
  perPage: number // UX v2: User-selectable (20/50/100)
  view?: 'order' | 'line' // Order View / Line View toggle
}

// Grouped Order (1 row per order_id with aggregated fields)
export interface GroupedSalesOrder {
  order_id: string // Unique order identifier
  external_order_id?: string | null
  source_platform?: string | null
  marketplace?: string | null
  platform_status?: string | null // Main status (Order Substatus)
  status_group?: string | null // Broader group (Order Status)
  payment_status?: string | null

  // Aggregated fields
  total_units: number // SUM(quantity) across lines
  order_amount: number // Order-level amount (MAX, not SUM)
  sku_count: number // COUNT(*) lines

  // Dates (order-level, use MAX/FIRST from lines)
  order_date: string
  paid_at?: string | null
  shipped_at?: string | null
  delivered_at?: string | null

  // TikTok Business Timestamps
  created_time?: string | null
  paid_time?: string | null
  cancelled_time?: string | null

  // For actions
  created_by?: string | null

  // Line preview (optional, for quick display)
  product_names?: string // Comma-separated or first product
}

export interface CreateOrderInput {
  order_date: string
  marketplace: string
  product_name: string
  quantity: number
  unit_price: number
  status: SalesOrderStatus
}

export interface UpdateOrderInput {
  order_date: string
  marketplace: string
  product_name: string
  quantity: number
  unit_price: number
  status: SalesOrderStatus
}

// Sales Aggregates (TikTok Semantics with Order-Level Aggregation)
// Uses TikTok business timestamps (created_time, paid_time, cancelled_time)
// dateBasis: "order" filters by created_time, "paid" filters by paid_time
export interface SalesAggregates {
  // Money Metrics (Order-level aggregation: MAX(total_amount) per external_order_id)
  revenue_gross: number                  // Gross revenue (all orders in date range)
  revenue_net: number                    // Net revenue (gross - same_day_cancelled)
  cancelled_same_day_amount: number      // Revenue from orders cancelled same day as created
  cancel_rate_revenue_pct: number        // (cancelled_same_day_amount / revenue_gross) * 100

  // Order Metrics
  orders_gross: number                   // Total orders (COUNT DISTINCT external_order_id)
  orders_net: number                     // Net orders (gross - same_day_cancelled)
  cancelled_same_day_orders: number      // Orders cancelled on same day as created
  cancel_rate_orders_pct: number         // (cancelled_same_day_orders / orders_gross) * 100

  // Units & AOV
  total_units: number                    // SUM(quantity) across all lines (net orders only)
  aov_net: number                        // revenue_net / orders_net (guarded divide-by-zero)

  // Import Completeness Verification & Lines vs Orders Explainer
  orders_distinct: number                // COUNT(DISTINCT external_order_id) from order-level aggregation
  lines_total: number                    // COUNT(*) from raw sales_orders table (all SKU lines)
  total_lines: number                    // Alias for lines_total (for UI clarity)
  total_orders: number                   // Alias for orders_distinct (for UI clarity)
  lines_per_order: number                // lines_total / orders_distinct (ratio, 2 decimal places)
}

// DEPRECATED: Old Story Panel aggregates (kept for backward compatibility)
// TODO: Remove after migrating all usages to SalesAggregates
export interface SalesStoryAggregates {
  gross_revenue_created: number          // SUM(MAX(order_amount) per order_id) for created in range
  total_created_orders: number           // COUNT(DISTINCT order_id) created in range
  same_day_cancel_orders: number         // COUNT(DISTINCT order_id) cancelled same day as created
  same_day_cancel_revenue: number        // Revenue from same-day cancelled orders
  net_revenue_after_same_day_cancel: number  // gross - same_day_cancel
  net_orders_after_same_day_cancel: number   // total - same_day_cancel
  cancel_rate_same_day: number           // (same_day_cancel / total) * 100
  has_cancelled_at: boolean              // True if cancelled_at field exists and is used
}
