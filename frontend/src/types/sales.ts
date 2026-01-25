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
