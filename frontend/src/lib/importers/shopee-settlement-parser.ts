/**
 * shopee-settlement-parser.ts
 * Client-side parser for Shopee "Income / โอนเงินสำเร็จ" (order settlement) report
 *
 * Source file: "Income.โอนเงินสำเร็จ.th.YYYYMMDD_YYYYMMDD.xlsx - Income.csv"
 *
 * Format:
 * - Header row is at index 5 (0-based); data starts at index 6
 * - ~44 columns; key financial columns mapped to shopee_order_settlements
 * - Dynamic header detection: scan for หมายเลขคำสั่งซื้อ + วันที่โอนชำระเงินสำเร็จ
 *
 * Supports: CSV (primary format exported from XLSX)
 */

import { parseCSVWithDynamicHeader } from '@/lib/importers/csvHeaderScanner'
import { parse as parseDate, isValid } from 'date-fns'

// ============================================================
// Types
// ============================================================

export interface ShopeeSettlementRow {
  external_order_id: string       // หมายเลขคำสั่งซื้อ
  order_date: string | null       // YYYY-MM-DD
  paid_out_date: string | null    // YYYY-MM-DD
  net_payout: number              // จำนวนเงินทั้งหมดที่โอนแล้ว (฿)
  commission: number              // ค่าคอมมิชชั่น
  service_fee: number             // ค่าบริการ
  payment_processing_fee: number  // ค่าธรรมเนียมการชำระเงิน
  platform_infra_fee: number      // ค่าโครงสร้างพื้นฐานแพลตฟอร์ม
  shipping_buyer_paid: number     // ค่าจัดส่งที่ผู้ซื้อชำระ
  refunds: number                 // เงินที่คืนให้ผู้ซื้อ
  raw: Record<string, string>
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

// Required: just need to find these 2 to locate header row
const REQUIRED_HEADERS = ['หมายเลขคำสั่งซื้อ', 'วันที่โอนชำระเงินสำเร็จ']

// COL candidates: try exact match first, then substring match for columns with "(฿)" suffix etc.
const COL_CANDIDATES: Record<string, string[]> = {
  external_order_id:        ['หมายเลขคำสั่งซื้อ'],
  order_date:               ['วันที่ทำการสั่งซื้อ'],
  paid_out_date:            ['วันที่โอนชำระเงินสำเร็จ'],
  net_payout:               ['จำนวนเงินทั้งหมดที่โอนแล้ว'],   // may have " (฿)" suffix
  commission:               ['ค่าคอมมิชชั่น'],
  service_fee:              ['ค่าบริการ'],
  payment_processing_fee:   ['ค่าธรรมเนียมการชำระเงิน', 'ค่าธรรมเนียมการทำธุรกรรม', 'Transaction Fee'],
  platform_infra_fee:       ['ค่าโครงสร้างพื้นฐานแพลตฟอร์ม', 'ค่าโครงสร้างพื้นฐาน'],
  shipping_buyer_paid:      ['ค่าจัดส่งที่ผู้ซื้อชำระ', 'ค่าขนส่งที่ผู้ซื้อชำระ'],
  refunds:                  ['จำนวนเงินที่ทำการคืนให้ผู้ซื้อ', 'เงินที่คืนไปยังผู้ซื้อ', 'การคืนเงิน', 'Refund'],
}

// ============================================================
// Helpers
// ============================================================

/**
 * Find column by exact match, then by substring match (handles "(฿)" suffixes, extra spaces etc.)
 */
function findCol(headers: string[], candidates: string[]): string | null {
  for (const c of candidates) {
    const norm = c.trim().toLowerCase()
    // Exact
    const exact = headers.find((h) => h.trim().toLowerCase() === norm)
    if (exact) return exact
    // Substring
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

function getField(row: Record<string, string>, colMap: Record<string, string | null>, field: string): string {
  const col = colMap[field]
  return col ? (row[col] ?? '') : ''
}

function parseDateOnly(raw: string): string | null {
  if (!raw || raw.trim() === '' || raw.trim() === '-') return null
  const trimmed = raw.trim()
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
    const parsed = parseDate(trimmed, fmt, new Date())
    if (isValid(parsed)) {
      const y = parsed.getFullYear()
      const mo = String(parsed.getMonth() + 1).padStart(2, '0')
      const d = String(parsed.getDate()).padStart(2, '0')
      return `${y}-${mo}-${d}`
    }
  }
  return null
}

function parseAmount(raw: string): number {
  if (!raw || raw.trim() === '' || raw.trim() === '-') return 0
  // Remove currency symbols, spaces, commas; keep digit, dot, minus
  const cleaned = raw.replace(/[^0-9.\-]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

// ============================================================
// Main Export
// ============================================================

/**
 * Parse Shopee Income / โอนเงินสำเร็จ CSV
 * Handles preamble rows via dynamic header scanning.
 */
export function parseShopeeSettlementCSV(text: string): ShopeeSettlementParseResult {
  const empty = (errors: ShopeeSettlementParseResult['errors']): ShopeeSettlementParseResult => ({
    success: false,
    detectedHeaderRow: -1,
    totalRows: 0,
    rows: [],
    sampleRows: [],
    summary: { totalNetPayout: 0, totalCommission: 0, totalRefunds: 0, orderCount: 0 },
    errors,
    warnings: [],
  })

  const parsed = parseCSVWithDynamicHeader(text, REQUIRED_HEADERS)
  if (!parsed) {
    return empty([{
      message: `ไม่พบ header row ที่มีคอลัมน์: ${REQUIRED_HEADERS.join(', ')}`,
      severity: 'error',
    }])
  }

  const { headerRowIndex, headers, rows } = parsed
  const colMap = buildColMap(headers)

  // Warn about missing optional fee columns
  const missingFeeWarnings: string[] = []
  for (const field of ['commission', 'service_fee', 'payment_processing_fee', 'platform_infra_fee']) {
    if (!colMap[field]) {
      missingFeeWarnings.push(`ไม่พบคอลัมน์ "${field}" — จะใช้ค่า 0`)
    }
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

    // Skip empty/summary rows
    if (!orderId || orderId === '-' || orderId.toLowerCase().includes('total') || orderId.toLowerCase().includes('รวม')) continue

    const paidOutDateRaw = getField(row, colMap, 'paid_out_date').trim()
    const paidOutDate = parseDateOnly(paidOutDateRaw)

    const orderDateRaw = getField(row, colMap, 'order_date').trim()
    const orderDate = parseDateOnly(orderDateRaw)

    const netPayoutRaw = getField(row, colMap, 'net_payout')
    const netPayout = parseAmount(netPayoutRaw)

    const commission = parseAmount(getField(row, colMap, 'commission'))
    const serviceFee = parseAmount(getField(row, colMap, 'service_fee'))
    const paymentProcessingFee = parseAmount(getField(row, colMap, 'payment_processing_fee'))
    const platformInfraFee = parseAmount(getField(row, colMap, 'platform_infra_fee'))
    const shippingBuyerPaid = parseAmount(getField(row, colMap, 'shipping_buyer_paid'))
    const refunds = parseAmount(getField(row, colMap, 'refunds'))

    if (!paidOutDate && !netPayoutRaw) {
      errors.push({ row: rowNumber, field: 'วันที่โอนชำระเงินสำเร็จ', message: `ไม่มีวันที่โอน: order ${orderId}`, severity: 'warning' })
    }

    totalNetPayout += netPayout
    totalCommission += commission
    totalRefunds += refunds

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
    return {
      ...empty(errors.length > 0 ? errors : [{ message: 'ไม่มีแถวข้อมูลที่ valid', severity: 'error' }]),
      detectedHeaderRow: headerRowIndex,
    }
  }

  const allWarnings = [
    `พบ ${settlementRows.length} รายการ (Header row: บรรทัดที่ ${headerRowIndex + 1})`,
    `Net Payout รวม: ฿${totalNetPayout.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
    ...missingFeeWarnings,
  ]

  return {
    success: errors.filter((e) => e.severity === 'error').length === 0,
    detectedHeaderRow: headerRowIndex,
    totalRows: settlementRows.length,
    rows: settlementRows,
    sampleRows: settlementRows.slice(0, 20),
    summary: {
      totalNetPayout,
      totalCommission,
      totalRefunds,
      orderCount: settlementRows.length,
    },
    errors,
    warnings: allWarnings,
  }
}
