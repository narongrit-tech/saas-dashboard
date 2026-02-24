/**
 * Returns v1: Types for returns system with barcode search
 */

export type ReturnType = 'RETURN_RECEIVED' | 'REFUND_ONLY' | 'CANCEL_BEFORE_SHIP'

/**
 * Return type labels in Thai
 */
export const RETURN_TYPE_LABELS: Record<ReturnType, string> = {
  RETURN_RECEIVED: 'รับของคืนจริง (คืน stock + COGS)',
  REFUND_ONLY: 'คืนเงินอย่างเดียว (ไม่มีสินค้าคืน)',
  CANCEL_BEFORE_SHIP: 'ยกเลิกก่อนส่ง',
}

/**
 * Order line item in search results
 */
export interface OrderLineItem {
  id: string // sales_orders.id (for reference)
  sku: string // sales_orders.sku
  seller_sku?: string | null // sales_orders.seller_sku
  sku_internal?: string | null // resolved canonical SKU from inventory_sku_mappings
  marketplace_sku?: string | null // raw marketplace variant ID
  product_name: string
  quantity: number // quantity sold
  qty_returned: number // quantity already returned
  unit_price: number
  total_amount: number
}

/**
 * Order search result
 */
export interface OrderSearchResult {
  id: string // sales_orders.id (first line item id, or representative)
  order_id: string // internal order_id
  external_order_id: string | null
  tracking_number: string | null
  source_platform: string | null
  marketplace: string | null
  status_group: string | null
  platform_status: string | null
  shipped_at: string | null
  delivered_at: string | null
  order_date: string
  line_items: OrderLineItem[]
  created_by: string
}

/**
 * Return submission payload
 */
export interface ReturnSubmitPayload {
  order_id: string // sales_orders.id (UUID)
  items: ReturnSubmitItem[]
  note?: string
}

export interface ReturnSubmitItem {
  line_item_id: string // sales_orders.id for this specific line
  sku: string
  qty: number
  return_type: ReturnType
}

/**
 * Return record (from inventory_returns table)
 */
export interface InventoryReturn {
  id: string
  order_id: string
  sku: string
  qty: number
  return_type: ReturnType
  note: string | null
  returned_at: string
  created_at: string
  created_by: string
  action_type?: 'RETURN' | 'UNDO'
  reversed_return_id?: string | null
}

/**
 * Queue item (order that may need returns processing)
 */
export interface QueueItem {
  id: string // sales_orders.id (representative line item)
  order_id: string // internal order_id
  external_order_id: string | null
  tracking_number: string | null
  source_platform: string | null
  marketplace: string | null
  status_group: string | null
  platform_status: string | null
  payment_status: string | null
  shipped_at: string | null
  delivered_at: string | null
  order_date: string
  sold_qty: number // total quantity sold
  returned_qty: number // total quantity already returned
  remaining_qty: number // sold_qty - returned_qty
  created_by: string
}

/**
 * Recent return record with additional display info
 */
export interface RecentReturn {
  id: string
  order_id: string
  sku: string
  qty: number
  return_type: ReturnType
  note: string | null
  returned_at: string
  action_type: 'RETURN' | 'UNDO'
  reversed_return_id: string | null
  created_by: string
  // Additional fields for display
  external_order_id?: string | null
  tracking_number?: string | null
}

/**
 * Undo action payload
 */
export interface UndoReturnPayload {
  return_id: string
}

/**
 * SKU mapping: marketplace_sku → sku_internal
 */
export interface SkuMappingRow {
  id: string
  channel: string
  marketplace_sku: string
  sku_internal: string
  created_at: string
  updated_at: string
}
