/**
 * shopee-balance-parser.ts
 * Client-side parser for Shopee "My Balance Transaction Report"
 *
 * Source file: "my_balance_transaction_report...xlsx - Transaction Report.csv"
 *
 * Actual header columns (confirmed from real file):
 *   วันที่ | ประเภทการทำธุรกรรม | คำอธิบาย | รหัสคำสั่งซื้อ |
 *   รูปแบบธุรกรรม | จำนวนเงิน | สถานะ | ยอดเงินหลังทำธุรกรรมเสร็จสิ้น
 *
 * Header row appears around row 15–25 (varies by export date range).
 * Scan up to MAX_HEADER_SCAN_ROWS to find it.
 *
 * Supports: .csv (UTF-8/BOM) and .xlsx
 */

import * as XLSX from 'xlsx'
import { parseCSVLine } from '@/lib/importers/csvHeaderScanner'
import { parse as parseDateFns, isValid } from 'date-fns'

// ============================================================
// Constants
// ============================================================

/** How many rows to scan before giving up looking for the header */
const MAX_HEADER_SCAN_ROWS = 50

/**
 * ALL THREE must appear in the header row (trimmed, case-insensitive includes).
 * Using the exact Thai strings from the actual Shopee export.
 */
const REQUIRED_HEADERS = ['วันที่', 'ประเภทการทำธุรกรรม', 'จำนวนเงิน'] as const

/**
 * Column name candidates for each logical field.
 * First match wins (exact → substring fallback).
 */
const COL = {
  occurred_at:      ['วันที่', 'วันที่ทำธุรกรรม'],
  transaction_type: ['ประเภทการทำธุรกรรม'],
  description:      ['คำอธิบาย'],
  ref_no:           ['รหัสคำสั่งซื้อ', 'หมายเลขอ้างอิง', 'Order ID'],
  transaction_mode: ['รูปแบบธุรกรรม'],
  status:           ['สถานะ'],
  amount:           ['จำนวนเงิน'],
  balance:          ['ยอดเงินหลังทำธุรกรรมเสร็จสิ้น', 'ยอดคงเหลือ', 'คงเหลือ'],
}

// ============================================================
// Types
// ============================================================

export interface ShopeeBalanceTransaction {
  occurred_at: string                          // ISO +07:00 (Bangkok)
  transaction_type: string                     // ประเภทการทำธุรกรรม
  transaction_mode: string | null              // รูปแบบธุรกรรม
  ref_no: string | null                        // รหัสคำสั่งซื้อ
  status: string | null                        // สถานะ
  amount: number                               // signed: positive = credit, negative = debit
  balance: number | null                       // ยอดเงินหลังทำธุรกรรมเสร็จสิ้น
  raw: Record<string, string | number>
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
// Column map helpers
// ============================================================

function findCol(headers: string[], candidates: string[]): string | null {
  for (const c of candidates) {
    const norm = c.trim().toLowerCase()
    // Exact match first
    const exact = headers.find((h) => h.trim().toLowerCase() === norm)
    if (exact) return exact
    // Substring fallback (handles minor suffix differences)
    const sub = headers.find((h) => h.trim().toLowerCase().includes(norm))
    if (sub) return sub
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
  return v === null || v === undefined ? '' : String(v)
}

function getRawValue(row: Record<string, string | number>, colMap: Record<string, string | null>, field: string): string | number {
  const col = colMap[field]
  return col ? (row[col] ?? '') : ''
}

// ============================================================
// Value parsers (handle string and number cell values)
// ============================================================

/**
 * Parse date → Bangkok ISO string (+07:00)
 * Handles: Thai/ISO strings, Excel serial date numbers
 */
function parseBangkokDate(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '' || raw === '-') return null

  // Excel numeric serial date (e.g. 45678.1234)
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

/** Parse signed amount — handles "฿1,234.56", "-500", native number */
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
// Core row processing (shared between CSV and XLSX paths)
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
  const parseErrors: ShopeeBalanceParseResult['errors'] = []
  let totalCredit = 0
  let totalDebit = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = headerRowIndex + 2 + i // 1-indexed source row

    const occurredAtRaw = getRawValue(row, colMap, 'occurred_at')
    const transactionType = getField(row, colMap, 'transaction_type').trim()
    const amountRaw = getRawValue(row, colMap, 'amount')

    // Skip footer/summary/empty rows
    if (!transactionType || transactionType.includes('ยอดรวม') || transactionType.toLowerCase().includes('total')) continue
    if (!occurredAtRaw || String(occurredAtRaw) === '-' || String(occurredAtRaw) === '') continue

    const occurredAt = parseBangkokDate(occurredAtRaw)
    if (!occurredAt) {
      parseErrors.push({
        row: rowNumber,
        field: 'วันที่',
        message: `วันที่ไม่ถูกต้อง: "${occurredAtRaw}"`,
        severity: 'warning',
      })
      continue
    }

    const amount = parseSignedAmount(amountRaw)
    if (amount === null) {
      parseErrors.push({
        row: rowNumber,
        field: 'จำนวนเงิน',
        message: `จำนวนเงินไม่ถูกต้อง: "${amountRaw}"`,
        severity: 'warning',
      })
      continue
    }

    const transactionModeRaw = getField(row, colMap, 'transaction_mode').trim()
    const transactionMode = transactionModeRaw && transactionModeRaw !== '-' ? transactionModeRaw : null

    const refNoRaw = getField(row, colMap, 'ref_no').trim()
    const refNo = refNoRaw && refNoRaw !== '-' ? refNoRaw : null

    const statusRaw = getField(row, colMap, 'status').trim()
    const status = statusRaw && statusRaw !== '-' ? statusRaw : null

    const balance = parseUnsignedAmount(getRawValue(row, colMap, 'balance'))

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
    return makeEmpty(parseErrors.length > 0 ? parseErrors : [{ message: 'ไม่มีแถวข้อมูลที่ valid', severity: 'error' }])
  }

  return {
    success: parseErrors.filter((e) => e.severity === 'error').length === 0,
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
    errors: parseErrors,
    warnings: [
      `พบ ${txnRows.length} รายการ (Header row: บรรทัดที่ ${headerRowIndex + 1})`,
      `เงินเข้า: ฿${totalCredit.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
      `เงินออก: ฿${totalDebit.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
    ],
  }
}

// ============================================================
// CSV header scanner (inline, MAX_HEADER_SCAN_ROWS limit)
// ============================================================

interface CsvScanResult {
  headerRowIndex: number
  headers: string[]
  dataRows: Record<string, string | number>[]
}

function scanCsvForHeader(text: string): CsvScanResult | null {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const limit = Math.min(lines.length, MAX_HEADER_SCAN_ROWS)

  for (let i = 0; i < limit; i++) {
    const line = lines[i]
    // Check if this line contains ALL required header strings
    if (REQUIRED_HEADERS.every((h) => line.includes(h))) {
      const headers = parseCSVLine(line).map((h) => h.trim())

      // Build data rows below the header
      const dataRows: Record<string, string | number>[] = []
      for (let r = i + 1; r < lines.length; r++) {
        const dataLine = lines[r].trim()
        if (!dataLine) continue
        const values = parseCSVLine(lines[r])
        const obj: Record<string, string | number> = {}
        headers.forEach((h, idx) => {
          obj[h] = (values[idx] ?? '').trim()
        })
        dataRows.push(obj)
      }

      return { headerRowIndex: i, headers, dataRows }
    }
  }
  return null
}

// ============================================================
// CSV path
// ============================================================

export function parseShopeeBalanceCSV(text: string): ShopeeBalanceParseResult {
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

  const scanned = scanCsvForHeader(text)
  if (!scanned) {
    return failResult(
      `ไม่พบ header row ใน ${MAX_HEADER_SCAN_ROWS} แถวแรก ` +
      `(ต้องมีคอลัมน์: ${REQUIRED_HEADERS.join(', ')})`
    )
  }

  console.log(`[ShopeeBalance CSV] detectedHeaderRowIndex: ${scanned.headerRowIndex}`)

  const result = processBalanceRows(scanned.dataRows, scanned.headers, scanned.headerRowIndex)

  console.log(`[ShopeeBalance CSV] totalRowsParsed: ${result.totalRows}`)

  return result
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

    let headerRowIndex = -1
    let headerRow: (string | number)[] = []

    const limit = Math.min(rawRows.length, MAX_HEADER_SCAN_ROWS)
    for (let r = 0; r < limit; r++) {
      const rowStr = rawRows[r].map((c) => String(c ?? '')).join(',')
      if (REQUIRED_HEADERS.every((h) => rowStr.includes(h))) {
        headerRowIndex = r
        headerRow = rawRows[r]
        break
      }
    }

    if (headerRowIndex === -1) continue // try next sheet

    console.log(`[ShopeeBalance XLSX] sheet="${sheetName}" detectedHeaderRowIndex: ${headerRowIndex}`)

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

    const result = processBalanceRows(dataRows, headers, headerRowIndex)

    console.log(`[ShopeeBalance XLSX] totalRowsParsed: ${result.totalRows}`)

    return result
  }

  return failResult(
    `ไม่พบ header row ใน ${MAX_HEADER_SCAN_ROWS} แถวแรกของทุก sheet ` +
    `(ต้องมีคอลัมน์: ${REQUIRED_HEADERS.join(', ')})`
  )
}

// ============================================================
// Unified entry point (auto-detect format from fileName)
// ============================================================

/**
 * Parse Shopee Balance Transaction Report — auto-detects CSV vs XLSX
 * @param buffer   ArrayBuffer of the file (works for both formats)
 * @param fileName Original file name (used to pick parser)
 */
export async function parseShopeeBalanceFile(
  buffer: ArrayBuffer,
  fileName: string
): Promise<ShopeeBalanceParseResult> {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return parseShopeeBalanceXLSX(buffer)
  }
  // CSV / TXT: decode and parse
  const text = new TextDecoder('utf-8').decode(buffer)
  return parseShopeeBalanceCSV(text)
}
