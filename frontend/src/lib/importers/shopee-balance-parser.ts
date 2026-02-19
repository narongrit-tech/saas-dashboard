/**
 * shopee-balance-parser.ts
 * Client-side parser for Shopee "My Balance Transaction Report"
 *
 * Source file: "my_balance_transaction_report...xlsx - Transaction Report.csv"
 *
 * Format:
 * - ~16 preamble/metadata rows before the real header row
 * - Header columns (Thai): วันที่ทำธุรกรรม, ประเภทการทำธุรกรรม, หมายเลขอ้างอิง,
 *                           รูปแบบธุรกรรม, สถานะ, จำนวนเงิน, คงเหลือ
 * - Amount is signed: positive = credit, negative = debit
 */

import { parseCSVWithDynamicHeader } from '@/lib/importers/csvHeaderScanner'
import { parse as parseDate, isValid } from 'date-fns'

// ============================================================
// Types
// ============================================================

export interface ShopeeBalanceTransaction {
  occurred_at: string          // ISO +07:00 (Bangkok)
  transaction_type: string     // ประเภทการทำธุรกรรม
  transaction_mode: string | null  // รูปแบบธุรกรรม
  ref_no: string | null        // หมายเลขอ้างอิง
  status: string | null        // สถานะ
  amount: number               // signed: positive = credit, negative = debit
  balance: number | null       // คงเหลือ
  raw: Record<string, string>
  source_row_number: number
}

export interface ShopeeBalanceParseResult {
  success: boolean
  detectedHeaderRow: number
  totalRows: number
  rows: ShopeeBalanceTransaction[]
  sampleRows: ShopeeBalanceTransaction[]
  summary: {
    totalCredit: number
    totalDebit: number
    netAmount: number
    txnCount: number
  }
  errors: Array<{ row?: number; field?: string; message: string; severity: 'error' | 'warning' }>
  warnings: string[]
}

// ============================================================
// Constants
// ============================================================

const REQUIRED_HEADERS = ['วันที่ทำธุรกรรม', 'ประเภทการทำธุรกรรม', 'จำนวนเงิน']

const COL = {
  occurred_at:      ['วันที่ทำธุรกรรม'],
  transaction_type: ['ประเภทการทำธุรกรรม'],
  transaction_mode: ['รูปแบบธุรกรรม'],
  ref_no:           ['หมายเลขอ้างอิง'],
  status:           ['สถานะ'],
  amount:           ['จำนวนเงิน'],
  balance:          ['คงเหลือ', 'ยอดคงเหลือ'],
}

// ============================================================
// Helpers
// ============================================================

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
    map[field] = findCol(headers, candidates as string[])
  }
  return map
}

function getField(row: Record<string, string>, colMap: Record<string, string | null>, field: string): string {
  const col = colMap[field]
  return col ? (row[col] ?? '') : ''
}

function parseBangkokDate(raw: string): string | null {
  if (!raw || raw.trim() === '' || raw.trim() === '-') return null
  const trimmed = raw.trim()
  const formats = [
    'dd/MM/yyyy HH:mm:ss',
    'dd/MM/yyyy HH:mm',
    'dd/MM/yyyy',
    'yyyy-MM-dd HH:mm:ss',
    'yyyy-MM-dd HH:mm',
    'yyyy-MM-dd',
    'MM/dd/yyyy HH:mm:ss',
  ]
  for (const fmt of formats) {
    const parsed = parseDate(trimmed, fmt, new Date())
    if (isValid(parsed)) {
      const y = parsed.getFullYear()
      const mo = String(parsed.getMonth() + 1).padStart(2, '0')
      const d = String(parsed.getDate()).padStart(2, '0')
      const h = String(parsed.getHours()).padStart(2, '0')
      const mi = String(parsed.getMinutes()).padStart(2, '0')
      const s = String(parsed.getSeconds()).padStart(2, '0')
      return `${y}-${mo}-${d} ${h}:${mi}:${s}+07:00`
    }
  }
  return null
}

/**
 * Parse a possibly-signed amount string (e.g. "1,234.56", "-500.00", "฿1,234.56")
 * Returns signed numeric value.
 */
function parseSignedAmount(raw: string): number | null {
  if (!raw || raw.trim() === '' || raw.trim() === '-') return null
  // Preserve the sign, strip everything except digits, dot, minus
  const cleaned = raw.replace(/[^0-9.\-]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function parseUnsignedAmount(raw: string): number | null {
  if (!raw || raw.trim() === '' || raw.trim() === '-') return null
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

// ============================================================
// Main Export
// ============================================================

/**
 * Parse Shopee "My Balance Transaction Report" CSV
 * Handles preamble rows via dynamic header scanning.
 */
export function parseShopeeBalanceCSV(text: string): ShopeeBalanceParseResult {
  const empty = (errors: ShopeeBalanceParseResult['errors']): ShopeeBalanceParseResult => ({
    success: false,
    detectedHeaderRow: -1,
    totalRows: 0,
    rows: [],
    sampleRows: [],
    summary: { totalCredit: 0, totalDebit: 0, netAmount: 0, txnCount: 0 },
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

  const txnRows: ShopeeBalanceTransaction[] = []
  const errors: ShopeeBalanceParseResult['errors'] = []
  let totalCredit = 0
  let totalDebit = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = headerRowIndex + 2 + i

    const occurredAtRaw = getField(row, colMap, 'occurred_at')
    const transactionType = getField(row, colMap, 'transaction_type').trim()
    const amountRaw = getField(row, colMap, 'amount')

    // Skip summary/footer/empty rows
    if (!transactionType || transactionType.includes('ยอดรวม') || transactionType.toLowerCase().includes('total')) continue
    if (!occurredAtRaw || occurredAtRaw === '-') continue
    // Skip if all key fields are empty
    if (!occurredAtRaw && !transactionType && !amountRaw) continue

    const occurredAt = parseBangkokDate(occurredAtRaw)
    if (!occurredAt) {
      errors.push({ row: rowNumber, field: 'วันที่ทำธุรกรรม', message: `วันที่ไม่ถูกต้อง: "${occurredAtRaw}"`, severity: 'warning' })
      continue
    }

    const amount = parseSignedAmount(amountRaw)
    if (amount === null) {
      errors.push({ row: rowNumber, field: 'จำนวนเงิน', message: `จำนวนเงินไม่ถูกต้อง: "${amountRaw}"`, severity: 'warning' })
      continue
    }

    const transactionModeRaw = getField(row, colMap, 'transaction_mode').trim()
    const transactionMode = transactionModeRaw && transactionModeRaw !== '-' ? transactionModeRaw : null

    const refNoRaw = getField(row, colMap, 'ref_no').trim()
    const refNo = refNoRaw && refNoRaw !== '-' && refNoRaw !== '' ? refNoRaw : null

    const statusRaw = getField(row, colMap, 'status').trim()
    const status = statusRaw && statusRaw !== '-' ? statusRaw : null

    const balanceRaw = getField(row, colMap, 'balance')
    const balance = parseUnsignedAmount(balanceRaw)

    if (amount > 0) {
      totalCredit += amount
    } else if (amount < 0) {
      totalDebit += Math.abs(amount)
    }

    txnRows.push({
      occurred_at: occurredAt,
      transaction_type: transactionType,
      transaction_mode: transactionMode,
      ref_no: refNo,
      status,
      amount,
      balance,
      raw: { ...row },
      source_row_number: rowNumber,
    })
  }

  if (txnRows.length === 0) {
    return {
      ...empty(errors.length > 0 ? errors : [{ message: 'ไม่มีแถวข้อมูลที่ valid', severity: 'error' }]),
      detectedHeaderRow: headerRowIndex,
    }
  }

  return {
    success: errors.filter((e) => e.severity === 'error').length === 0,
    detectedHeaderRow: headerRowIndex,
    totalRows: txnRows.length,
    rows: txnRows,
    sampleRows: txnRows.slice(0, 20),
    summary: {
      totalCredit,
      totalDebit,
      netAmount: totalCredit - totalDebit,
      txnCount: txnRows.length,
    },
    errors,
    warnings: [
      `พบ ${txnRows.length} รายการ (Header row: บรรทัดที่ ${headerRowIndex + 1})`,
      `เงินเข้า: ฿${totalCredit.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
      `เงินออก: ฿${totalDebit.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
    ],
  }
}
