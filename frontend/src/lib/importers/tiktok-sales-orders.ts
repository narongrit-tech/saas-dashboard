import * as XLSX from 'xlsx'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import crypto from 'crypto'

const BANGKOK_TZ = 'Asia/Bangkok'

// TikTok Seller Center "All Orders" export — Thai + English column variants
const COLUMN_MAPPINGS: Record<string, string[]> = {
  order_id: [
    'order id', 'order number', 'หมายเลขคำสั่งซื้อ', 'เลขคำสั่งซื้อ', 'id คำสั่งซื้อ',
  ],
  product_name: [
    'product name', 'ชื่อสินค้า', 'สินค้า', 'product',
  ],
  seller_sku: [
    'seller sku', 'sku ของผู้ขาย', 'seller sku id', 'sku',
  ],
  sku_id: [
    'sku id', 'product sku id', 'id sku',
  ],
  quantity: [
    'quantity', 'sku quantity', 'จำนวน', 'qty', 'จำนวนสินค้า',
  ],
  unit_price: [
    'selling price', 'unit price', 'original price', 'ราคาต่อชิ้น', 'ราคาต่อหน่วย',
    'buyer price per quantity', 'ราคาขาย', 'price',
  ],
  total_amount: [
    'sku subtotal after discount', 'subtotal after discount', 'net revenue',
    'sku subtotal price', 'total', 'ราคารวมหลังหักส่วนลด', 'ยอดรวมสุทธิ',
    'sku net revenue', 'net amount', 'amount',
  ],
  platform_status: [
    'order status', 'status', 'สถานะคำสั่งซื้อ', 'สถานะ',
  ],
  order_date: [
    'order created time', 'created time', 'create time', 'order date',
    'วันที่สร้างคำสั่งซื้อ', 'วันที่สั่งซื้อ', 'created at',
  ],
  paid_at: [
    'paid time', 'payment time', 'paid at', 'วันที่ชำระเงิน',
  ],
  shipped_at: [
    'shipped time', 'ship time', 'dispatched time', 'วันที่จัดส่ง',
  ],
}

export interface NormalizedSalesOrderRow {
  external_order_id: string
  product_name: string
  seller_sku: string | null
  sku_id: string | null
  quantity: number
  unit_price: number | null
  total_amount: number
  platform_status: string | null
  order_date: Date | null
  paid_at: Date | null
  shipped_at: Date | null
}

export function calculateFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function findColumn(headers: string[], variants: string[]): number {
  const normalized = headers.map(h => h.toLowerCase().trim())
  for (const v of variants) {
    const idx = normalized.indexOf(v.toLowerCase())
    if (idx !== -1) return idx
  }
  return -1
}

function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''))
  return isNaN(n) ? null : n
}

function parseDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null
    return fromZonedTime(toZonedTime(value, BANGKOK_TZ), BANGKOK_TZ)
  }
  if (typeof value === 'number') {
    const excelEpoch = new Date(1899, 11, 30)
    const date = new Date(excelEpoch.getTime() + value * 86400000)
    return fromZonedTime(toZonedTime(date, BANGKOK_TZ), BANGKOK_TZ)
  }
  if (typeof value === 'string') {
    let date = new Date(value)
    if (!isNaN(date.getTime())) return fromZonedTime(toZonedTime(date, BANGKOK_TZ), BANGKOK_TZ)

    // TikTok export uses DD/MM/YYYY HH:MM:SS — not parseable by new Date() directly
    const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?$/)
    if (m) {
      const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}${m[4] ? 'T' + m[4] : ''}`
      date = new Date(iso)
      if (!isNaN(date.getTime())) return fromZonedTime(toZonedTime(date, BANGKOK_TZ), BANGKOK_TZ)
    }
  }
  return null
}

function getCellValue(worksheet: XLSX.WorkSheet, row: number, col: number): string {
  const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })]
  if (!cell) return ''
  if (cell.w) return String(cell.w).trim()
  if (cell.v !== null && cell.v !== undefined) return String(cell.v).trim()
  return ''
}

export function parseSalesOrdersExcel(buffer: Buffer): {
  rows: NormalizedSalesOrderRow[]
  warnings: string[]
} {
  const warnings: string[] = []

  const bufferCopy = Buffer.alloc(buffer.length)
  buffer.copy(bufferCopy)

  const workbook = XLSX.read(bufferCopy, {
    type: 'buffer',
    cellDates: true,
    cellFormula: false,
    cellStyles: false,
    raw: false,
    dense: false,
  })

  if (!workbook.SheetNames.length) throw new Error('Excel file has no sheets')

  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]

  // Determine actual row/col range by scanning worksheet keys
  const sheetRef = worksheet['!ref']
  let endRow = 1
  let endCol = 60

  if (sheetRef) {
    const range = XLSX.utils.decode_range(sheetRef)
    endCol = range.e.c
  }

  const cellPat = /^([A-Z]+)(\d+)$/
  for (const key of Object.keys(worksheet)) {
    if (key.startsWith('!')) continue
    const m = key.match(cellPat)
    if (m) {
      const r = parseInt(m[2], 10) - 1
      if (r > endRow) endRow = r
    }
  }

  // Find header row (scan first 30 rows for order_id column)
  let headerRowIndex = -1
  for (let r = 0; r < Math.min(30, endRow + 1); r++) {
    const candidates: string[] = []
    for (let c = 0; c <= endCol; c++) candidates.push(getCellValue(worksheet, r, c))
    if (findColumn(candidates, COLUMN_MAPPINGS.order_id) !== -1) {
      headerRowIndex = r
      break
    }
  }

  if (headerRowIndex === -1) throw new Error('Could not find header row — "Order ID" column not found')

  // Build header array
  const headers: string[] = []
  for (let c = 0; c <= endCol; c++) headers.push(getCellValue(worksheet, headerRowIndex, c))

  const cols = {
    order_id: findColumn(headers, COLUMN_MAPPINGS.order_id),
    product_name: findColumn(headers, COLUMN_MAPPINGS.product_name),
    seller_sku: findColumn(headers, COLUMN_MAPPINGS.seller_sku),
    sku_id: findColumn(headers, COLUMN_MAPPINGS.sku_id),
    quantity: findColumn(headers, COLUMN_MAPPINGS.quantity),
    unit_price: findColumn(headers, COLUMN_MAPPINGS.unit_price),
    total_amount: findColumn(headers, COLUMN_MAPPINGS.total_amount),
    platform_status: findColumn(headers, COLUMN_MAPPINGS.platform_status),
    order_date: findColumn(headers, COLUMN_MAPPINGS.order_date),
    paid_at: findColumn(headers, COLUMN_MAPPINGS.paid_at),
    shipped_at: findColumn(headers, COLUMN_MAPPINGS.shipped_at),
  }

  if (cols.order_id === -1) throw new Error('Required column "Order ID" not found')
  if (cols.total_amount === -1) warnings.push('Column "total_amount" not found — total_amount will be set to 0')

  const rows: NormalizedSalesOrderRow[] = []

  for (let r = headerRowIndex + 1; r <= endRow; r++) {
    const orderId = getCellValue(worksheet, r, cols.order_id)
    if (!orderId) continue
    // Skip description/sub-header rows (order_id not a numeric TikTok order number)
    if (!/^\d/.test(orderId)) continue

    const totalAmount = cols.total_amount !== -1
      ? parseNumeric(getCellValue(worksheet, r, cols.total_amount)) ?? 0
      : 0

    const qty = cols.quantity !== -1
      ? parseNumeric(getCellValue(worksheet, r, cols.quantity)) ?? 1
      : 1

    let unitPrice: number | null = null
    if (cols.unit_price !== -1) {
      unitPrice = parseNumeric(getCellValue(worksheet, r, cols.unit_price))
    }
    // Fallback: compute from total / qty
    if (unitPrice === null && qty > 0) {
      unitPrice = totalAmount / qty
    }

    rows.push({
      external_order_id: orderId,
      product_name: cols.product_name !== -1 ? getCellValue(worksheet, r, cols.product_name) || '(unknown)' : '(unknown)',
      seller_sku: cols.seller_sku !== -1 ? getCellValue(worksheet, r, cols.seller_sku) || null : null,
      sku_id: cols.sku_id !== -1 ? getCellValue(worksheet, r, cols.sku_id) || null : null,
      quantity: Math.max(1, qty),
      unit_price: unitPrice,
      total_amount: totalAmount,
      platform_status: cols.platform_status !== -1 ? getCellValue(worksheet, r, cols.platform_status) || null : null,
      order_date: cols.order_date !== -1 ? parseDate(getCellValue(worksheet, r, cols.order_date)) : null,
      paid_at: cols.paid_at !== -1 ? parseDate(getCellValue(worksheet, r, cols.paid_at)) : null,
      shipped_at: cols.shipped_at !== -1 ? parseDate(getCellValue(worksheet, r, cols.shipped_at)) : null,
    })
  }

  return { rows, warnings }
}

/**
 * Compute SHA256 order_line_hash — must match generateOrderLineHash() in sales-import-actions.ts.
 * Hash: SHA256(source_platform|external_order_id|product_name|quantity|total_amount)
 * userId is intentionally excluded — same order imported by any workspace member must produce
 * the same hash (see migration-112 workspace_owner_map).
 */
export function computeOrderLineHash(
  _createdBy: string,
  externalOrderId: string,
  productName: string,
  quantity: number,
  totalAmount: number
): string {
  const payload = ['tiktok_shop', externalOrderId, productName, quantity.toString(), totalAmount.toString()].join('|')
  return crypto.createHash('sha256').update(payload).digest('hex')
}
