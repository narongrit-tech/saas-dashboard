/**
 * shopee-orders-parser.ts
 * Parser for Shopee orders — รองรับทั้ง .csv และ .xlsx
 *
 * Source files:
 *   CSV  : "Order.all... - orders.csv"  (UTF-8 / UTF-8 BOM)
 *   XLSX : "Order.all... - orders.xlsx" (same Thai column names)
 *
 * Key rules:
 * - Multi-line order: same order_id appears multiple times (one per SKU)
 * - Use MAX(order_total_amount) per order for GMV — NOT sum of all lines
 * - line_net_amount = ราคาขายสุทธิ (revenue per SKU line)
 * - Dynamic header detection: scan up to 300 rows for required headers
 */

import * as XLSX from 'xlsx'
import { parseCSVWithDynamicHeader } from '@/lib/importers/csvHeaderScanner'
import { ParsedSalesRow, SalesImportPreview } from '@/types/sales-import'
import { parse as parseDate, isValid } from 'date-fns'

// ============================================================
// Column Mapping (Thai headers from Shopee Seller Center)
// ============================================================

const SHOPEE_ORDER_REQUIRED_HEADERS = [
  'หมายเลขคำสั่งซื้อ',
  'สถานะการสั่งซื้อ',
  'จำนวน',
]

const COL = {
  order_id: ['หมายเลขคำสั่งซื้อ'],
  status_raw: ['สถานะการสั่งซื้อ'],
  created_at: ['วันที่ทำการสั่งซื้อ'],
  paid_at: ['เวลาการชำระสินค้า'],
  shipped_at: ['เวลาส่งสินค้า'],
  completed_at: ['เวลาที่ทำการสั่งซื้อสำเร็จ'],
  tracking_no: ['*หมายเลขติดตามพัสดุ', 'หมายเลขติดตามพัสดุ'],
  sku: ['เลขอ้างอิง SKU (SKU Reference No.)', 'เลขอ้างอิง SKU', 'SKU Reference No.'],
  parent_sku: ['เลขอ้างอิง Parent SKU', 'Parent SKU'],
  product_name: ['ชื่อสินค้า', 'Product Name'],
  qty: ['จำนวน'],
  returned_qty: ['จำนวนที่ส่งคืน'],
  line_net_amount: ['ราคาขายสุทธิ'],
  order_total_amount: ['จำนวนเงินทั้งหมด'],
  commission: ['ค่าคอมมิชชั่น'],
  transaction_fee: ['Transaction Fee', 'ค่าธรรมเนียมการทำธุรกรรม'],
  service_fee: ['ค่าบริการ'],
}

// ============================================================
// Shared helpers
// ============================================================

type ParseResult = SalesImportPreview & {
  allRows: ParsedSalesRow[]
  detectedHeaderRow: number
  missingColumns: string[]
}

function makeEmpty(errors: Array<{ message: string; severity: 'error' | 'warning' }>): ParseResult {
  return {
    success: false,
    importType: 'shopee',
    totalRows: 0,
    sampleRows: [],
    allRows: [],
    detectedHeaderRow: -1,
    missingColumns: [],
    summary: { totalRevenue: 0, totalOrders: 0, uniqueOrderIds: 0, lineCount: 0 },
    errors,
    warnings: [],
  }
}

function findCol(headers: string[], candidates: string[]): string | null {
  for (const c of candidates) {
    const norm = c.trim().toLowerCase()
    const found = headers.find((h) => h.trim().toLowerCase() === norm)
    if (found) return found
  }
  return null
}

function buildColMap(headers: string[]) {
  const map: Record<string, string | null> = {}
  for (const [field, candidates] of Object.entries(COL)) {
    map[field] = findCol(headers, candidates)
  }
  return map
}

function getField(row: Record<string, string>, colMap: Record<string, string | null>, field: string): string {
  const col = colMap[field]
  return col ? (row[col] ?? '') : ''
}

/**
 * Parse Shopee date string → Bangkok-aware ISO string (+07:00)
 * Handles both string dates and Excel numeric serial dates (from XLSX)
 */
function parseShopeeDate(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '' || raw === '-') return null

  // Excel numeric serial date (e.g. 45678.123)
  if (typeof raw === 'number') {
    // Excel epoch: 1899-12-30 UTC
    const ms = (raw - 25569) * 86400000
    const d = new Date(ms)
    if (!isValid(d)) return null
    // Format as Bangkok (+07:00) — Excel dates are in local time by convention
    const y = d.getUTCFullYear()
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    const h = String(d.getUTCHours()).padStart(2, '0')
    const mi = String(d.getUTCMinutes()).padStart(2, '0')
    const s = String(d.getUTCSeconds()).padStart(2, '0')
    return `${y}-${mo}-${day} ${h}:${mi}:${s}+07:00`
  }

  // String date
  const trimmed = String(raw).trim()
  const formats = [
    'dd/MM/yyyy HH:mm:ss',
    'dd/MM/yyyy HH:mm',
    'dd/MM/yyyy',
    'yyyy-MM-dd HH:mm:ss',
    'yyyy-MM-dd HH:mm',
    'yyyy-MM-dd',
    'M/d/yyyy', // Excel auto-format fallback
  ]
  for (const fmt of formats) {
    const parsed = parseDate(trimmed, fmt, new Date())
    if (isValid(parsed)) {
      const y = parsed.getFullYear()
      const mo = String(parsed.getMonth() + 1).padStart(2, '0')
      const d = String(parsed.getDate()).padStart(2, '0')
      const h = String(parsed.getHours()).padStart(2, '0')
      const mi = String(parsed.getMinutes()).padStart(2, '0')
      const sec = String(parsed.getSeconds()).padStart(2, '0')
      return `${y}-${mo}-${d} ${h}:${mi}:${sec}+07:00`
    }
  }
  return null
}

function parseNumber(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === '' || raw === '-') return 0
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw
  const cleaned = String(raw).replace(/[^0-9.-]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

function normalizeShopeeStatus(raw: string): string {
  const s = raw.toLowerCase()
  if (s.includes('ยกเลิก') || s.includes('cancel')) return 'cancelled'
  if (s.includes('สำเร็จ') || s.includes('ส่งแล้ว') || s.includes('deliver') || s.includes('complete')) return 'completed'
  return 'pending'
}

// ============================================================
// Core row processor (shared between CSV and XLSX paths)
// ============================================================

/**
 * Process normalized rows (Record<string, string|number>) → ParseResult
 *
 * @param rows - Array of row objects keyed by header name
 * @param headers - Column headers detected
 * @param headerRowIndex - 0-based index of the header row in the source file
 */
function processShopeeOrderRows(
  rows: Record<string, string | number>[],
  headers: string[],
  headerRowIndex: number
): ParseResult {
  const colMap = buildColMap(headers)

  // Validate required columns
  const missingColumns: string[] = []
  const requiredFields = ['order_id', 'status_raw', 'qty', 'line_net_amount'] as const
  for (const field of requiredFields) {
    if (!colMap[field]) missingColumns.push(field)
  }

  if (missingColumns.length > 0) {
    return {
      ...makeEmpty([{ message: `ขาดคอลัมน์จำเป็น: ${missingColumns.join(', ')}`, severity: 'error' }]),
      detectedHeaderRow: headerRowIndex,
      missingColumns,
    }
  }

  const parsedRows: ParsedSalesRow[] = []
  const errors: ParseResult['errors'] = []
  const uniqueOrderIds = new Set<string>()
  const orderTotalMap = new Map<string, number>()

  let totalRevenue = 0
  let minDate: Date | null = null
  let maxDate: Date | null = null

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as Record<string, string | number>
    const rowNumber = headerRowIndex + 2 + i

    // Coerce each field to string for getField compatibility
    const strRow: Record<string, string> = {}
    for (const key of Object.keys(row)) {
      strRow[key] = row[key] === null || row[key] === undefined ? '' : String(row[key])
    }

    const orderIdRaw = colMap['order_id'] ? row[colMap['order_id']!] : ''
    const orderId = String(orderIdRaw ?? '').trim()
    if (!orderId || orderId === '-') continue
    if (orderId.includes('ยอดรวม') || orderId.includes('Total') || orderId.startsWith('#')) continue

    const statusRaw = getField(strRow, colMap, 'status_raw')
    const status = normalizeShopeeStatus(statusRaw)

    // Dates — accept raw value (number or string) from XLSX
    const createdAtRaw = colMap['created_at'] ? row[colMap['created_at']!] : ''
    const paidAtRaw = colMap['paid_at'] ? row[colMap['paid_at']!] : ''
    const shippedAtRaw = colMap['shipped_at'] ? row[colMap['shipped_at']!] : ''
    const completedAtRaw = colMap['completed_at'] ? row[colMap['completed_at']!] : ''

    const orderDateStr = parseShopeeDate(createdAtRaw as string | number)
    const paidAtStr = parseShopeeDate(paidAtRaw as string | number)
    const shippedAtStr = parseShopeeDate(shippedAtRaw as string | number)
    const completedAtStr = parseShopeeDate(completedAtRaw as string | number)

    if (!orderDateStr) {
      errors.push({ row: rowNumber, field: 'วันที่ทำการสั่งซื้อ', message: 'วันที่ไม่ถูกต้อง', severity: 'warning' })
    }

    if (orderDateStr) {
      const d = new Date(orderDateStr)
      if (isValid(d)) {
        if (!minDate || d < minDate) minDate = d
        if (!maxDate || d > maxDate) maxDate = d
      }
    }

    const sku = getField(strRow, colMap, 'sku')
    const parentSku = getField(strRow, colMap, 'parent_sku')
    const productName = getField(strRow, colMap, 'product_name') || sku || orderId

    const qtyRaw = colMap['qty'] ? row[colMap['qty']!] : 0
    const qty = parseNumber(qtyRaw as string | number)
    const returnedQtyRaw = colMap['returned_qty'] ? row[colMap['returned_qty']!] : 0
    const returnedQty = parseNumber(returnedQtyRaw as string | number)
    const lineNetAmountRaw = colMap['line_net_amount'] ? row[colMap['line_net_amount']!] : 0
    const lineNetAmount = parseNumber(lineNetAmountRaw as string | number)
    const orderTotalAmountRaw = colMap['order_total_amount'] ? row[colMap['order_total_amount']!] : 0
    const orderTotalAmount = parseNumber(orderTotalAmountRaw as string | number)
    const trackingNo = getField(strRow, colMap, 'tracking_no')

    const commissionRaw = colMap['commission'] ? row[colMap['commission']!] : 0
    const commission = parseNumber(commissionRaw as string | number)
    const transactionFeeRaw = colMap['transaction_fee'] ? row[colMap['transaction_fee']!] : 0
    const transactionFee = parseNumber(transactionFeeRaw as string | number)
    const serviceFeeRaw = colMap['service_fee'] ? row[colMap['service_fee']!] : 0
    const serviceFee = parseNumber(serviceFeeRaw as string | number)

    const existingTotal = orderTotalMap.get(orderId) ?? 0
    if (orderTotalAmount > existingTotal) orderTotalMap.set(orderId, orderTotalAmount)

    uniqueOrderIds.add(orderId)

    const unitPrice = qty > 0 ? lineNetAmount / qty : lineNetAmount
    if (status !== 'cancelled') totalRevenue += lineNetAmount

    parsedRows.push({
      order_id: orderId,
      marketplace: 'shopee',
      channel: 'Shopee',
      product_name: productName,
      sku: sku || undefined,
      quantity: qty,
      unit_price: unitPrice,
      total_amount: lineNetAmount,
      order_date: orderDateStr ?? new Date().toISOString(),
      status,
      tracking_number: trackingNo || undefined,
      metadata: {
        source_report: 'ShopeeOrders',
        parent_sku: parentSku || null,
        returned_qty: returnedQty || null,
        commission: commission || null,
        transaction_fee: transactionFee || null,
        service_fee: serviceFee || null,
        status_raw: statusRaw || null,
      },
      rowNumber,
      source_platform: 'shopee',
      external_order_id: orderId,
      platform_status: statusRaw || undefined,
      status_group: statusRaw || undefined,
      payment_status: paidAtStr ? 'paid' : 'unpaid',
      paid_at: paidAtStr || undefined,
      shipped_at: shippedAtStr || undefined,
      delivered_at: completedAtStr || undefined,
      seller_sku: sku || undefined,
      order_amount: orderTotalAmount || undefined,
    })
  }

  if (parsedRows.length === 0) {
    return {
      ...makeEmpty(errors.length > 0 ? errors : [{ message: 'ไม่มีแถวข้อมูลที่ valid', severity: 'error' }]),
      detectedHeaderRow: headerRowIndex,
      missingColumns,
    }
  }

  const fmt2 = (n: number) => String(n).padStart(2, '0')
  const toDateStr = (d: Date) =>
    `${d.getFullYear()}-${fmt2(d.getMonth() + 1)}-${fmt2(d.getDate())}`

  return {
    success: errors.filter((e) => e.severity === 'error').length === 0,
    importType: 'shopee',
    dateRange: minDate && maxDate ? { start: toDateStr(minDate), end: toDateStr(maxDate) } : undefined,
    totalRows: parsedRows.length,
    sampleRows: parsedRows.slice(0, 20),
    allRows: parsedRows,
    detectedHeaderRow: headerRowIndex,
    missingColumns,
    summary: {
      totalRevenue,
      totalOrders: uniqueOrderIds.size,
      uniqueOrderIds: uniqueOrderIds.size,
      lineCount: parsedRows.length,
    },
    errors,
    warnings: [
      `พบ ${parsedRows.length} line items จาก ${uniqueOrderIds.size} orders`,
      `Header row: บรรทัดที่ ${headerRowIndex + 1}`,
      'GMV ใช้ order_amount per order (ไม่ใช่ sum ทุก line)',
    ],
  }
}

// ============================================================
// CSV parser
// ============================================================

/**
 * Parse Shopee orders.csv (UTF-8 or UTF-8 BOM text)
 */
export function parseShopeeOrdersCSV(text: string): ParseResult {
  const parsed = parseCSVWithDynamicHeader(text, SHOPEE_ORDER_REQUIRED_HEADERS)
  if (!parsed) {
    return makeEmpty([{
      message: `ไม่พบ header row ที่มีคอลัมน์: ${SHOPEE_ORDER_REQUIRED_HEADERS.join(', ')}`,
      severity: 'error',
    }])
  }
  // CSV rows are all strings — pass through directly
  return processShopeeOrderRows(
    parsed.rows as Record<string, string | number>[],
    parsed.headers,
    parsed.headerRowIndex
  )
}

// ============================================================
// XLSX parser
// ============================================================

/**
 * Parse Shopee orders.xlsx (ArrayBuffer)
 * Scans all sheets for required headers; handles preamble rows.
 */
export function parseShopeeOrdersXLSX(buffer: ArrayBuffer): ParseResult {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  } catch {
    return makeEmpty([{ message: 'ไม่สามารถอ่านไฟล์ .xlsx ได้ (อาจเสียหาย)', severity: 'error' }])
  }

  if (!workbook.SheetNames.length) {
    return makeEmpty([{ message: 'ไฟล์ Excel ไม่มี sheet', severity: 'error' }])
  }

  // Scan each sheet for required headers
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName]
    // Get raw rows as arrays (header:1 → rows[0] is first row)
    const rawRows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      raw: true, // Keep numeric values as numbers
    }) as (string | number)[][]

    // Scan for header row
    let headerRowIndex = -1
    let headerRow: (string | number)[] = []
    for (let r = 0; r < Math.min(rawRows.length, 300); r++) {
      const row = rawRows[r]
      const rowStr = row.map((c) => String(c ?? '')).join(',')
      if (SHOPEE_ORDER_REQUIRED_HEADERS.every((h) => rowStr.includes(h))) {
        headerRowIndex = r
        headerRow = row
        break
      }
    }

    if (headerRowIndex === -1) continue // Try next sheet

    // Build headers list (normalize)
    const headers = headerRow.map((c) => String(c ?? '').trim())

    // Build data rows as Record<header, value>
    const dataRows: Record<string, string | number>[] = []
    for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
      const rawRow = rawRows[r]
      // Skip completely empty rows
      if (rawRow.every((c) => c === '' || c === null || c === undefined)) continue
      const obj: Record<string, string | number> = {}
      headers.forEach((h, idx) => {
        const val = rawRow[idx]
        obj[h] = val === null || val === undefined ? '' : val
      })
      dataRows.push(obj)
    }

    if (dataRows.length === 0) continue

    return processShopeeOrderRows(dataRows, headers, headerRowIndex)
  }

  return makeEmpty([{
    message: `ไม่พบ header row ที่มีคอลัมน์: ${SHOPEE_ORDER_REQUIRED_HEADERS.join(', ')} ในทุก sheet`,
    severity: 'error',
  }])
}

// ============================================================
// Unified entry point (auto-detect format)
// ============================================================

/**
 * Parse Shopee orders file — auto-detects CSV vs XLSX from fileName
 *
 * @param buffer - ArrayBuffer of the file (used for XLSX; also read as text for CSV)
 * @param fileName - Original file name (used to detect format)
 */
export async function parseShopeeOrdersFile(buffer: ArrayBuffer, fileName: string): Promise<ParseResult> {
  const lower = fileName.toLowerCase()

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return parseShopeeOrdersXLSX(buffer)
  }

  // CSV: decode buffer as UTF-8
  const text = new TextDecoder('utf-8').decode(buffer)
  return parseShopeeOrdersCSV(text)
}
