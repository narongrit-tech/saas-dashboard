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
}

export interface SalesOrderFilters {
  marketplace?: string
  startDate?: string
  endDate?: string
  search?: string
  page: number
  perPage: number
}

export interface CreateOrderInput {
  order_date: string
  marketplace: string
  product_name: string
  quantity: number
  unit_price: number
  status: SalesOrderStatus
}
