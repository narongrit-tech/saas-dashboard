/**
 * shopee-settlement-parser.ts
 * Client-side parser for Shopee "Income / โอนเงินสำเร็จ" (order settlement) report
 *
 * Source file: "Income.โอนเงินสำเร็จ.th.YYYYMMDD_YYYYMMDD.xlsx - Income.csv"
 *
 * Format:
 * - Header row is at index ~5 (0-based); data starts after header
 * - ~44 columns; key financial columns mapped to shopee_order_settlements
 * - Dynamic header detection: scan for หมายเลขคำสั่งซื้อ + วันที่โอนชำระเงินสำเร็จ
 *
 * Supports: .csv (UTF-8/BOM) and .xlsx
 */

import * as XLSX from 'xlsx'
import { parseCSVWithDynamicHeader } from '@/lib/importers/csvHeaderScanner'
import { parse as parseDateFns, isValid } from 'date-fns'

// ============================================================
// Types
// ============================================================

export interface ShopeeSettlementRow {
  external_order_id: string             // หมายเลขคำสั่งซื้อ
  order_date: string | null             // YYYY-MM-DD
  paid_out_date: string | null          // YYYY-MM-DD
  net_payout: number                    // จำนวนเงินทั้งหมดที่โอนแล้ว (฿)
  commission: number                    // ค่าคอมมิชชั่น
  service_fee: number                   // ค่าบริการ
  payment_processing_fee: number        // ค่าธรรมเนียมการชำระเงิน
  platform_infra_fee: number            // ค่าโครงสร้างพื้นฐานแพลตฟอร์ม
  shipping_buyer_paid: number           // ค่าจัดส่งที่ผู้ซื้อชำระ
  refunds: number                       // เงินที่คืนให้ผู้ซื้อ
  raw: Record<string, string | number>  // full row for audit
  source_row_number: number
}

export interface ShopeeSettlementParseResult {
  success: boolean
  detectedHeaderRow: number
  totalRows: number
  rows: ShopeeSettlementRow[]
  sampleRows: ShopeeSettlementRow[]
  summary: {
    totalNetPayout: number
    totalCommission: number
    totalRefunds: number
    orderCount: number
  }
  errors: Array<{ row?: number; field?: string; message: string; severity: 'error' | 'warning' }>
  warnings: string[]
}

// ============================================================
// Column mapping — flexible, substring-aware matching
// ============================================================

const REQUIRED_HEADERS = ['หมายเลขคำสั่งซื้อ', 'วันที่โอนชำระเงินสำเร็จ']

const COL_CANDIDATES: Record<string, string[]> = {
  external_order_id:        ['หมายเลขคำสั่งซื้อ'],
  order_date:               ['วันที่ทำการสั่งซื้อ'],
  paid_out_date:            ['วันที่โอนชำระเงินสำเร็จ'],
  net_payout:               ['จำนวนเงินทั้งหมดที่โอนแล้ว'],  // may have " (฿)" suffix
  commission:               ['ค่าคอมมิชชั่น'],
  service_fee:              ['ค่าบริการ'],
  payment_processing_fee:   ['ค่าธรรมเนียมการชำระเงิน', 'ค่าธรรมเนียมการทำธุรกรรม', 'Transaction Fee'],
  platform_infra_fee:       ['ค่าโครงสร้างพื้นฐานแพลตฟอร์ม', 'ค่าโครงสร้างพื้นฐาน'],
  shipping_buyer_paid:      ['ค่าจัดส่งที่ผู้ซื้อชำระ', 'ค่าขนส่งที่ผู้ซื้อชำระ'],
  refunds:                  ['จำนวนเงินที่ทำการคืนให้ผู้ซื้อ', 'เงินที่คืนไปยังผู้ซื้อ', 'การคืนเงิน', 'Refund'],
}

// ============================================================
// Shared helpers (handle both string and number cell values)
// ============================================================

/**
 * Find column — exact match first, then substring (handles "(฿)" suffixes)
 */
function findCol(headers: string[], candidates: string[]): string | null {
  for (const c of candidates) {
    const norm = c.trim().toLowerCase()
    const exact = headers.find((h) => h.trim().toLowerCase() === norm)
    if (exact) return exact
    const sub = headers.find((h) => h.trim().toLowerCase().includes(norm))
    if (sub) return sub
  }
  return null
}

function buildColMap(headers: string[]) {
  const map: Record<string, string | null> = {}
  for (const [field, candidates] of Object.entries(COL_CANDIDATES)) {
    map[field] = findCol(headers, candidates)
  }
  return map
}

function getField(row: Record<string, string | number>, colMap: Record<string, string | null>, field: string): string {
  const col = colMap[field]
  if (!col) return ''
  const v = row[col]
  if (v === null || v === undefined) return ''
  return String(v)
}

function getRawValue(row: Record<string, string | number>, colMap: Record<string, string | null>, field: string): string | number {
  const col = colMap[field]
  if (!col) return ''
  return row[col] ?? ''
}

/**
 * Parse date to YYYY-MM-DD — handles:
 *  - Thai/ISO string formats
 *  - Excel serial date numbers
 */
function parseDateOnly(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '' || raw === '-') return null

  // Excel numeric serial date
  if (typeof raw === 'number') {
    const ms = (raw - 25569) * 86400000
    const d = new Date(ms)
    if (!isValid(d)) return null
    const y = d.getUTCFullYear()
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${mo}-${day}`
  }

  const trimmed = String(raw).trim()
  if (!trimmed || trimmed === '-') return null

  const formats = [
    'dd/MM/yyyy HH:mm:ss',
    'dd/MM/yyyy HH:mm',
    'dd/MM/yyyy',
    'yyyy-MM-dd HH:mm:ss',
    'yyyy-MM-dd HH:mm',
    'yyyy-MM-dd',
    'MM/dd/yyyy',
  ]
  for (const fmt of formats) {
    const parsed = parseDateFns(trimmed, fmt, new Date())
    if (isValid(parsed)) {
      const y = parsed.getFullYear()
      const mo = String(parsed.getMonth() + 1).padStart(2, '0')
      const d = String(parsed.getDate()).padStart(2, '0')
      return `${y}-${mo}-${d}`
    }
  }
  return null
}

/**
 * Parse amount — handles string (with ฿, commas) or native number from XLSX
 */
function parseAmount(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === '' || raw === '-') return 0
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw
  const cleaned = String(raw).replace(/[^0-9.\-]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

// ============================================================
// Core processing (shared between CSV and XLSX paths)
// ============================================================

function processSettlementRows(
  rows: Record<string, string | number>[],
  headers: string[],
  headerRowIndex: number
): ShopeeSettlementParseResult {
  const makeEmpty = (errors: ShopeeSettlementParseResult['errors']): ShopeeSettlementParseResult => ({
    success: false,
    detectedHeaderRow: headerRowIndex,
    totalRows: 0,
    rows: [],
    sampleRows: [],
    summary: { totalNetPayout: 0, totalCommission: 0, totalRefunds: 0, orderCount: 0 },
    errors,
    warnings: [],
  })

  const colMap = buildColMap(headers)

  const missingFeeWarnings: string[] = []
  for (const field of ['commission', 'service_fee', 'payment_processing_fee', 'platform_infra_fee']) {
    if (!colMap[field]) missingFeeWarnings.push(`ไม่พบคอลัมน์ "${field}" — จะใช้ค่า 0`)
  }

  const settlementRows: ShopeeSettlementRow[] = []
  const errors: ShopeeSettlementParseResult['errors'] = []
  let totalNetPayout = 0
  let totalCommission = 0
  let totalRefunds = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = headerRowIndex + 2 + i

    const orderId = getField(row, colMap, 'external_order_id').trim()
    if (!orderId || orderId === '-' || orderId.toLowerCase().includes('total') || orderId.toLowerCase().includes('รวม')) continue

    const paidOutDate = parseDateOnly(getRawValue(row, colMap, 'paid_out_date'))
    const orderDate   = parseDateOnly(getRawValue(row, colMap, 'order_date'))
    const netPayout   = parseAmount(getRawValue(row, colMap, 'net_payout'))

    const commission          = parseAmount(getRawValue(row, colMap, 'commission'))
    const serviceFee          = parseAmount(getRawValue(row, colMap, 'service_fee'))
    const paymentProcessingFee= parseAmount(getRawValue(row, colMap, 'payment_processing_fee'))
    const platformInfraFee    = parseAmount(getRawValue(row, colMap, 'platform_infra_fee'))
    const shippingBuyerPaid   = parseAmount(getRawValue(row, colMap, 'shipping_buyer_paid'))
    const refunds             = parseAmount(getRawValue(row, colMap, 'refunds'))

    totalNetPayout  += netPayout
    totalCommission += commission
    totalRefunds    += refunds

    settlementRows.push({
      external_order_id: orderId,
      order_date: orderDate,
      paid_out_date: paidOutDate,
      net_payout: netPayout,
      commission,
      service_fee: serviceFee,
      payment_processing_fee: paymentProcessingFee,
      platform_infra_fee: platformInfraFee,
      shipping_buyer_paid: shippingBuyerPaid,
      refunds,
      raw: { ...row },
      source_row_number: rowNumber,
    })
  }

  if (settlementRows.length === 0) {
    return makeEmpty(errors.length > 0 ? errors : [{ message: 'ไม่มีแถวข้อมูลที่ valid', severity: 'error' }])
  }

  return {
    success: errors.filter((e) => e.severity === 'error').length === 0,
    detectedHeaderRow: headerRowIndex,
    totalRows: settlementRows.length,
    rows: settlementRows,
    sampleRows: settlementRows.slice(0, 20),
    summary: { totalNetPayout, totalCommission, totalRefunds, orderCount: settlementRows.length },
    errors,
    warnings: [
      `พบ ${settlementRows.length} รายการ (Header row: บรรทัดที่ ${headerRowIndex + 1})`,
      `Net Payout รวม: ฿${totalNetPayout.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
      ...missingFeeWarnings,
    ],
  }
}

// ============================================================
// CSV path
// ============================================================

export function parseShopeeSettlementCSV(text: string): ShopeeSettlementParseResult {
  const parsed = parseCSVWithDynamicHeader(text, REQUIRED_HEADERS)
  if (!parsed) {
    return {
      success: false,
      detectedHeaderRow: -1,
      totalRows: 0,
      rows: [],
      sampleRows: [],
      summary: { totalNetPayout: 0, totalCommission: 0, totalRefunds: 0, orderCount: 0 },
      errors: [{ message: `ไม่พบ header row ที่มีคอลัมน์: ${REQUIRED_HEADERS.join(', ')}`, severity: 'error' }],
      warnings: [],
    }
  }
  return processSettlementRows(parsed.rows as Record<string, string | number>[], parsed.headers, parsed.headerRowIndex)
}

// ============================================================
// XLSX path
// ============================================================

export function parseShopeeSettlementXLSX(buffer: ArrayBuffer): ShopeeSettlementParseResult {
  const failResult = (message: string): ShopeeSettlementParseResult => ({
    success: false,
    detectedHeaderRow: -1,
    totalRows: 0,
    rows: [],
    sampleRows: [],
    summary: { totalNetPayout: 0, totalCommission: 0, totalRefunds: 0, orderCount: 0 },
    errors: [{ message, severity: 'error' }],
    warnings: [],
  })

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  } catch {
    return failResult('ไม่สามารถอ่านไฟล์ .xlsx ได้ (อาจเสียหาย)')
  }

  if (!workbook.SheetNames.length) return failResult('ไฟล์ Excel ไม่มี sheet')

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName]
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as (string | number)[][]

    let headerRowIndex = -1
    let headerRow: (string | number)[] = []
    for (let r = 0; r < Math.min(rawRows.length, 300); r++) {
      const rowStr = rawRows[r].map((c) => String(c ?? '')).join(',')
      if (REQUIRED_HEADERS.every((h) => rowStr.includes(h))) {
        headerRowIndex = r
        headerRow = rawRows[r]
        break
      }
    }
    if (headerRowIndex === -1) continue

    const headers = headerRow.map((c) => String(c ?? '').trim())

    const dataRows: Record<string, string | number>[] = []
    for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
      const rawRow = rawRows[r]
      if (rawRow.every((c) => c === '' || c === null || c === undefined)) continue
      const obj: Record<string, string | number> = {}
      headers.forEach((h, idx) => {
        const v = rawRow[idx]
        obj[h] = v === null || v === undefined ? '' : v
      })
      dataRows.push(obj)
    }

    if (dataRows.length === 0) continue
    return processSettlementRows(dataRows, headers, headerRowIndex)
  }

  return failResult(`ไม่พบ header row ที่มีคอลัมน์: ${REQUIRED_HEADERS.join(', ')} ในทุก sheet`)
}

// ============================================================
// Unified entry point (auto-detect format from fileName)
// ============================================================

/**
 * Parse Shopee Income / Settlement report — auto-detects CSV vs XLSX
 * @param buffer  ArrayBuffer of the file
 * @param fileName  Original file name (used to pick parser)
 */
export async function parseShopeeSettlementFile(buffer: ArrayBuffer, fileName: string): Promise<ShopeeSettlementParseResult> {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return parseShopeeSettlementXLSX(buffer)
  }
  const text = new TextDecoder('utf-8').decode(buffer)
  return parseShopeeSettlementCSV(text)
}
