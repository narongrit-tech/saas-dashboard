/**
 * Sales Import Types
 * Phase 6: CSV/Excel Import Infrastructure
 */

export type SalesImportType = 'tiktok_shop' | 'shopee' | 'generic'

export type SalesImportSource = 'manual' | 'imported'

/**
 * TikTok Shop OrderSKUList - Full field mapping
 * Based on confirmed format from TikTok Seller Center
 */
export interface TikTokOrderLine {
  // Identity / Keys
  external_order_id: string       // "Order ID"
  sku_id?: string                  // "SKU ID"
  seller_sku?: string              // "Seller SKU"

  // Lifecycle Timestamps (all optional, format: DD/MM/YYYY HH:MM:SS)
  created_time?: string            // "Created Time"
  paid_time?: string               // "Paid Time"
  rts_time?: string                // "RTS Time" (Ready to Ship)
  shipped_time?: string            // "Shipped Time"
  delivered_time?: string          // "Delivered Time"
  cancelled_time?: string          // "Cancelled Time"

  // Status
  order_status?: string            // "Order Status"
  order_substatus?: string         // "Order Substatus"
  cancel_return_type?: string      // "Cancelation/Return Type"
  cancel_by?: string               // "Cancel By"
  cancel_reason?: string           // "Cancel Reason"

  // Product Line
  product_name: string             // "Product Name"
  variation?: string               // "Variation"
  qty: number                      // "Quantity"
  qty_return?: number              // "Sku Quantity of return"
  product_category?: string        // "Product Category"

  // Line-level Money (use for revenue calculation)
  unit_original_price?: number     // "SKU Unit Original Price"
  subtotal_before_discount?: number // "SKU Subtotal Before Discount"
  platform_discount?: number       // "SKU Platform Discount"
  seller_discount?: number         // "SKU Seller Discount"
  subtotal_after_discount: number  // "SKU Subtotal After Discount" (LINE REVENUE)

  // Order-level amounts (store but DO NOT aggregate for line revenue)
  order_amount?: number            // "Order Amount"
  order_refund_amount?: number     // "Order Refund Amount"
  taxes?: number                   // "Taxes"
  small_order_fee?: number         // "Small Order Fee"
  shipping_fee_after_discount?: number     // "Shipping Fee After Discount"
  original_shipping_fee?: number           // "Original Shipping Fee"
  shipping_fee_seller_discount?: number    // "Shipping Fee Seller Discount"
  shipping_fee_platform_discount?: number  // "Shipping Fee Platform Discount"
  payment_platform_discount?: number       // "Payment platform discount"

  // Logistics / Payment (optional)
  fulfillment_type?: string        // "Fulfillment Type"
  warehouse_name?: string          // "Warehouse Name"
  tracking_id?: string             // "Tracking ID"
  delivery_option?: string         // "Delivery Option"
  shipping_provider_name?: string  // "Shipping Provider Name"
  payment_method?: string          // "Payment Method"
  package_id?: string              // "Package ID"
}

/**
 * TikTok Shop Preset Column Mapping
 * Maps Excel column names to system fields
 */
export const TIKTOK_SHOP_PRESET: Record<string, string> = {
  // Identity
  external_order_id: 'Order ID',
  sku_id: 'SKU ID',
  seller_sku: 'Seller SKU',

  // Timestamps
  created_time: 'Created Time',
  paid_time: 'Paid Time',
  rts_time: 'RTS Time',
  shipped_time: 'Shipped Time',
  delivered_time: 'Delivered Time',
  cancelled_time: 'Cancelled Time',

  // Status
  order_status: 'Order Status',
  order_substatus: 'Order Substatus',
  cancel_return_type: 'Cancelation/Return Type',
  cancel_by: 'Cancel By',
  cancel_reason: 'Cancel Reason',

  // Product
  product_name: 'Product Name',
  variation: 'Variation',
  qty: 'Quantity',
  qty_return: 'Sku Quantity of return',
  product_category: 'Product Category',

  // Line-level money
  unit_original_price: 'SKU Unit Original Price',
  subtotal_before_discount: 'SKU Subtotal Before Discount',
  platform_discount: 'SKU Platform Discount',
  seller_discount: 'SKU Seller Discount',
  subtotal_after_discount: 'SKU Subtotal After Discount',

  // Order-level money
  order_amount: 'Order Amount',
  order_refund_amount: 'Order Refund Amount',
  taxes: 'Taxes',
  small_order_fee: 'Small Order Fee',
  shipping_fee_after_discount: 'Shipping Fee After Discount',
  original_shipping_fee: 'Original Shipping Fee',
  shipping_fee_seller_discount: 'Shipping Fee Seller Discount',
  shipping_fee_platform_discount: 'Shipping Fee Platform Discount',
  payment_platform_discount: 'Payment platform discount',

  // Logistics
  fulfillment_type: 'Fulfillment Type',
  warehouse_name: 'Warehouse Name',
  tracking_id: 'Tracking ID',
  delivery_option: 'Delivery Option',
  shipping_provider_name: 'Shipping Provider Name',
  payment_method: 'Payment Method',
  package_id: 'Package ID',
}

/**
 * Shopee Field Definitions (via manual mapping)
 */
export const SHOPEE_FIELDS = {
  order_id: { label: 'Order ID', required: true },
  order_creation_date: { label: 'Order Creation Date', required: true },
  product_name: { label: 'Product Name', required: true },
  sku: { label: 'SKU / Model', required: false },
  quantity: { label: 'Quantity', required: true },
  unit_price: { label: 'Unit Price', required: true },
  total_amount: { label: 'Total Amount', required: true },
  order_status: { label: 'Order Status', required: false },
}

/**
 * Generic Sales Import Fields (minimal)
 */
export const GENERIC_SALES_FIELDS = {
  order_id: { label: 'Order ID', required: true },
  order_date: { label: 'Order Date', required: true },
  marketplace: { label: 'Marketplace', required: true },
  product_name: { label: 'Product Name', required: true },
  quantity: { label: 'Quantity', required: true },
  unit_price: { label: 'Unit Price', required: true },
  total_amount: { label: 'Total Amount', required: true },
  status: { label: 'Status', required: false },
}

/**
 * Parsed Sales Row (normalized for insert)
 */
export interface ParsedSalesRow {
  order_id: string
  marketplace: string
  channel?: string
  product_name: string
  sku?: string
  quantity: number
  unit_price: number
  total_amount: number
  cost_per_unit?: number
  order_date: string // YYYY-MM-DD HH:MM:SS (Bangkok)
  status: string // pending | completed | cancelled (internal status)
  customer_name?: string
  notes?: string
  metadata?: Record<string, string | number | null> // TikTok rich data
  rowNumber?: number // for error reporting

  // UX v2: Platform-specific fields
  source_platform?: string | null // tiktok_shop | shopee | lazada
  external_order_id?: string | null // Original platform order ID
  platform_status?: string | null // Order Substatus (รอจัดส่ง, อยู่ระหว่างงานขนส่ง) - MAIN UI STATUS
  status_group?: string | null // Order Status (ที่จัดส่ง, ชำระเงินแล้ว, ยกเลิกแล้ว) - Group filter
  platform_substatus?: string | null // Platform sub-status (deprecated/unused)
  payment_status?: string | null // paid | unpaid | partial | refunded
  paid_at?: string | null // YYYY-MM-DD HH:MM:SS (Bangkok)
  shipped_at?: string | null // YYYY-MM-DD HH:MM:SS (Bangkok)
  delivered_at?: string | null // YYYY-MM-DD HH:MM:SS (Bangkok)
  seller_sku?: string | null // Seller-defined SKU
  sku_id?: string | null // Platform SKU ID

  // TikTok Business Timestamps (from OrderSKUList export)
  created_time?: string | null // When customer placed order (Create Time)
  paid_time?: string | null // When payment confirmed (Paid Time)
  cancelled_time?: string | null // When order cancelled (Cancelled Time)
}

/**
 * Sales Import Preview Result
 */
export interface SalesImportPreview {
  success: boolean
  importType: SalesImportType
  dateRange?: {
    start: string
    end: string
  }
  totalRows: number
  sampleRows: ParsedSalesRow[] // First 5 rows for preview
  allRows?: ParsedSalesRow[] // All parsed rows for import
  summary: {
    totalRevenue: number
    totalOrders: number
    uniqueOrderIds: number
    lineCount: number
  }
  errors: Array<{
    row?: number
    field?: string
    message: string
    severity: 'error' | 'warning'
  }>
  warnings: string[]
}

/**
 * Sales Import Result
 */
export interface SalesImportResult {
  success: boolean
  batchId?: string
  inserted: number
  updated: number
  skipped: number
  errors: number
  error?: string
  dateBasisUsed?: 'order_date' | 'paid_at'
  dateRange?: {
    min: string // YYYY-MM-DD
    max: string // YYYY-MM-DD
  }
  summary?: {
    dateRange: string
    totalRevenue: number
    orderCount: number
  }
}
