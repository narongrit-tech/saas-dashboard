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
 *
 * Supports: .csv (UTF-8/BOM) and .xlsx
 */

import * as XLSX from 'xlsx'
import { parseCSVWithDynamicHeader } from '@/lib/importers/csvHeaderScanner'
import { parse as parseDateFns, isValid } from 'date-fns'

// ============================================================
// Types
// ============================================================

export interface ShopeeBalanceTransaction {
  occurred_at: string                          // ISO +07:00 (Bangkok)
  transaction_type: string                     // ประเภทการทำธุรกรรม
  transaction_mode: string | null              // รูปแบบธุรกรรม
  ref_no: string | null                        // หมายเลขอ้างอิง
  status: string | null                        // สถานะ
  amount: number                               // signed: positive = credit, negative = debit
  balance: number | null                       // คงเหลือ
  raw: Record<string, string | number>         // full row for audit
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
// Shared helpers (handle both string and number cell values)
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
 * Parse date — handles:
 *  - Thai/ISO string formats: dd/MM/yyyy HH:mm:ss, yyyy-MM-dd, etc.
 *  - Excel serial date numbers (e.g. 45678.1234)
 * Returns Bangkok ISO string (+07:00)
 */
function parseBangkokDate(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '' || raw === '-') return null

  // Excel numeric serial date
  if (typeof raw === 'number') {
    const ms = (raw - 25569) * 86400000
    const d = new Date(ms)
    if (!isValid(d)) return null
    const y = d.getUTCFullYear()
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    const h = String(d.getUTCHours()).padStart(2, '0')
    const mi = String(d.getUTCMinutes()).padStart(2, '0')
    const s = String(d.getUTCSeconds()).padStart(2, '0')
    return `${y}-${mo}-${day} ${h}:${mi}:${s}+07:00`
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
    'MM/dd/yyyy HH:mm:ss',
    'MM/dd/yyyy',
  ]
  for (const fmt of formats) {
    const parsed = parseDateFns(trimmed, fmt, new Date())
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
 * Parse signed amount (e.g. "1,234.56", "-500.00", "฿1,234.56", or native number)
 * Returns signed numeric value.
 */
function parseSignedAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '' || raw === '-') return null
  if (typeof raw === 'number') return isNaN(raw) ? null : raw
  const s = String(raw).trim()
  if (!s || s === '-') return null
  const cleaned = s.replace(/[^0-9.\-]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function parseUnsignedAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '' || raw === '-') return null
  if (typeof raw === 'number') return isNaN(raw) ? null : Math.abs(raw)
  const cleaned = String(raw).replace(/[^0-9.]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

// ============================================================
// Core processing (shared between CSV and XLSX paths)
// ============================================================

function processBalanceRows(
  rows: Record<string, string | number>[],
  headers: string[],
  headerRowIndex: number
): ShopeeBalanceParseResult {
  const makeEmpty = (errors: ShopeeBalanceParseResult['errors']): ShopeeBalanceParseResult => ({
    success: false,
    detectedHeaderRow: headerRowIndex,
    totalRows: 0,
    rows: [],
    sampleRows: [],
    summary: { totalCredit: 0, totalDebit: 0, netAmount: 0, txnCount: 0 },
    errors,
    warnings: [],
  })

  const colMap = buildColMap(headers)

  const txnRows: ShopeeBalanceTransaction[] = []
  const errors: ShopeeBalanceParseResult['errors'] = []
  let totalCredit = 0
  let totalDebit = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = headerRowIndex + 2 + i

    const occurredAtRaw = getRawValue(row, colMap, 'occurred_at')
    const transactionType = getField(row, colMap, 'transaction_type').trim()
    const amountRaw = getRawValue(row, colMap, 'amount')

    // Skip summary/footer/empty rows
    if (!transactionType || transactionType.includes('ยอดรวม') || transactionType.toLowerCase().includes('total')) continue
    if (!occurredAtRaw || String(occurredAtRaw) === '-') continue

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
    const refNo = refNoRaw && refNoRaw !== '-' ? refNoRaw : null

    const statusRaw = getField(row, colMap, 'status').trim()
    const status = statusRaw && statusRaw !== '-' ? statusRaw : null

    const balanceRaw = getRawValue(row, colMap, 'balance')
    const balance = parseUnsignedAmount(balanceRaw)

    if (amount > 0) totalCredit += amount
    else if (amount < 0) totalDebit += Math.abs(amount)

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
    return makeEmpty(errors.length > 0 ? errors : [{ message: 'ไม่มีแถวข้อมูลที่ valid', severity: 'error' }])
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

// ============================================================
// CSV path
// ============================================================

export function parseShopeeBalanceCSV(text: string): ShopeeBalanceParseResult {
  const parsed = parseCSVWithDynamicHeader(text, REQUIRED_HEADERS)
  if (!parsed) {
    return {
      success: false,
      detectedHeaderRow: -1,
      totalRows: 0,
      rows: [],
      sampleRows: [],
      summary: { totalCredit: 0, totalDebit: 0, netAmount: 0, txnCount: 0 },
      errors: [{ message: `ไม่พบ header row ที่มีคอลัมน์: ${REQUIRED_HEADERS.join(', ')}`, severity: 'error' }],
      warnings: [],
    }
  }
  // CSV rows are all strings — cast to shared type
  return processBalanceRows(parsed.rows as Record<string, string | number>[], parsed.headers, parsed.headerRowIndex)
}

// ============================================================
// XLSX path
// ============================================================

export function parseShopeeBalanceXLSX(buffer: ArrayBuffer): ShopeeBalanceParseResult {
  const failResult = (message: string): ShopeeBalanceParseResult => ({
    success: false,
    detectedHeaderRow: -1,
    totalRows: 0,
    rows: [],
    sampleRows: [],
    summary: { totalCredit: 0, totalDebit: 0, netAmount: 0, txnCount: 0 },
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

    // Scan for header row
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
    if (headerRowIndex === -1) continue // try next sheet

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
    return processBalanceRows(dataRows, headers, headerRowIndex)
  }

  return failResult(`ไม่พบ header row ที่มีคอลัมน์: ${REQUIRED_HEADERS.join(', ')} ในทุก sheet`)
}

// ============================================================
// Unified entry point (auto-detect format from fileName)
// ============================================================

/**
 * Parse Shopee Balance Transaction Report — auto-detects CSV vs XLSX
 * @param buffer  ArrayBuffer of the file
 * @param fileName  Original file name (used to pick parser)
 */
export async function parseShopeeBalanceFile(buffer: ArrayBuffer, fileName: string): Promise<ShopeeBalanceParseResult> {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return parseShopeeBalanceXLSX(buffer)
  }
  // CSV / TXT: decode text then parse
  const text = new TextDecoder('utf-8').decode(buffer)
  return parseShopeeBalanceCSV(text)
}
