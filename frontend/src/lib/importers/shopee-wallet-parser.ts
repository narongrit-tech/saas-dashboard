/**
 * shopee-wallet-parser.ts
 * Client-side parser for Shopee Transaction Report CSV
 *
 * Source file: "my_balance_transaction_report... - Transaction Report.csv"
 *
 * Key characteristics:
 * - Has preamble rows before actual headers (~row 17 based on typical export)
 * - Header row contains: วันที่, ประเภทการทำธุรกรรม, จำนวนเงิน
 * - Direction: เงินเข้า = credit, เงินออก = debit
 * - Dedup: sha256(platform|occurred_at|transaction_type|direction|amount|ref_id|balance_after)
 */

import { parseCSVWithDynamicHeader } from '@/lib/importers/csvHeaderScanner'
import { parse as parseDate, isValid } from 'date-fns'

// ============================================================
// Types
// ============================================================

export interface ShopeeWalletTransaction {
  occurred_at: string       // ISO string with +07:00 (Bangkok)
  transaction_type: string  // ประเภทการทำธุรกรรม
  description: string | null
  ref_id: string | null     // รหัสคำสั่งซื้อ (null if '-')
  ref_type: 'shopee_order' | 'shopee_withdrawal' | 'shopee_other'
  direction: 'credit' | 'debit'
  amount: number            // Always positive
  status: string | null
  balance_after: number | null
  txn_hash: string
  source_row_number: number
}

export interface ShopeeWalletParseResult {
  success: boolean
  detectedHeaderRow: number
  totalRows: number
  rows: ShopeeWalletTransaction[]
  sampleRows: ShopeeWalletTransaction[]
  summary: {
    totalCredit: number
    totalDebit: number
    netAmount: number
    withdrawalCount: number
    orderCount: number
  }
  errors: Array<{ row?: number; field?: string; message: string; severity: 'error' | 'warning' }>
  warnings: string[]
}

// ============================================================
// Constants
// ============================================================

const REQUIRED_HEADERS = ['วันที่', 'ประเภทการทำธุรกรรม', 'จำนวนเงิน']

const COL = {
  occurred_at: ['วันที่'],
  transaction_type: ['ประเภทการทำธุรกรรม'],
  description: ['คำอธิบาย'],
  ref_id: ['รหัสคำสั่งซื้อ', 'Order ID'],
  direction: ['รูปแบบธุรกรรม'],
  amount: ['จำนวนเงิน'],
  status: ['สถานะ'],
  balance_after: ['ยอดเงินหลังทำธุรกรรมเสร็จสิ้น', 'ยอดคงเหลือ'],
}

// ============================================================
// Helpers
// ============================================================

function findCol(headers: string[], candidates: string[]): string | null {
  for (const candidate of candidates) {
    const norm = candidate.trim().toLowerCase()
    const found = headers.find((h) => h.trim().toLowerCase() === norm)
    if (found) return found
  }
  return null
}

function buildColMap(headers: string[]): Record<string, string | null> {
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

function parseShopeeDate(raw: string): string | null {
  if (!raw || raw.trim() === '' || raw.trim() === '-') return null
  const trimmed = raw.trim()
  const formats = [
    'dd/MM/yyyy HH:mm:ss',
    'dd/MM/yyyy HH:mm',
    'dd/MM/yyyy',
    'yyyy-MM-dd HH:mm:ss',
    'yyyy-MM-dd HH:mm',
    'yyyy-MM-dd',
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

function parseAmount(raw: string): number {
  if (!raw || raw.trim() === '' || raw.trim() === '-') return 0
  const cleaned = raw.replace(/[^0-9.-]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : Math.abs(num) // Always positive; use direction for sign
}

function mapDirection(raw: string): 'credit' | 'debit' {
  const s = raw.trim()
  if (s === 'เงินเข้า' || s.toLowerCase() === 'credit' || s === 'IN') return 'credit'
  if (s === 'เงินออก' || s.toLowerCase() === 'debit' || s === 'OUT') return 'debit'
  // Fallback: if amount is negative → debit
  return 'debit'
}

function mapRefType(
  refId: string | null,
  transactionType: string
): 'shopee_order' | 'shopee_withdrawal' | 'shopee_other' {
  if (refId) return 'shopee_order'
  if (transactionType.includes('การถอนเงิน') || transactionType.toLowerCase().includes('withdrawal')) {
    return 'shopee_withdrawal'
  }
  return 'shopee_other'
}

/**
 * Compute a deterministic txn_hash using FNV-1a + djb2 (browser + server compatible, no crypto deps)
 * Returns a 40-char hex string unique enough for dedup purposes.
 */
function makeTxnHash(
  occurredAt: string,
  transactionType: string,
  direction: string,
  amount: number,
  refId: string | null,
  balanceAfter: number | null
): string {
  const input = [
    'shopee',
    occurredAt,
    transactionType,
    direction,
    amount.toFixed(2),
    refId ?? '',
    balanceAfter != null ? balanceAfter.toFixed(2) : '',
  ].join('|')

  // FNV-1a 32-bit
  let h1 = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i)
    h1 = (h1 * 0x01000193) >>> 0
  }

  // djb2 32-bit
  let h2 = 5381
  for (let i = 0; i < input.length; i++) {
    h2 = (((h2 << 5) + h2) ^ input.charCodeAt(i)) >>> 0
  }

  // Length + char codes of every 7th char (adds content fingerprint)
  let h3 = input.length
  for (let i = 0; i < input.length; i += 7) {
    h3 = (h3 * 31 + input.charCodeAt(i)) >>> 0
  }

  return (
    h1.toString(16).padStart(8, '0') +
    h2.toString(16).padStart(8, '0') +
    h3.toString(16).padStart(8, '0')
  )
}

// ============================================================
// Main Export
// ============================================================

/**
 * Parse Shopee Transaction Report CSV
 * Handles preamble rows via dynamic header scanning.
 */
export function parseShopeeWalletCSV(text: string): ShopeeWalletParseResult {
  const empty = (errors: ShopeeWalletParseResult['errors']): ShopeeWalletParseResult => ({
    success: false,
    detectedHeaderRow: -1,
    totalRows: 0,
    rows: [],
    sampleRows: [],
    summary: { totalCredit: 0, totalDebit: 0, netAmount: 0, withdrawalCount: 0, orderCount: 0 },
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

  const txnRows: ShopeeWalletTransaction[] = []
  const errors: ShopeeWalletParseResult['errors'] = []
  let totalCredit = 0
  let totalDebit = 0
  let withdrawalCount = 0
  let orderCount = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = headerRowIndex + 2 + i // 1-indexed

    const occurredAtRaw = getField(row, colMap, 'occurred_at')
    const transactionType = getField(row, colMap, 'transaction_type').trim()
    const amountRaw = getField(row, colMap, 'amount')

    // Skip summary/footer rows (e.g. ยอดรวม, Total, empty type)
    if (!transactionType || transactionType.includes('ยอดรวม') || transactionType.includes('Total')) continue
    if (!occurredAtRaw || occurredAtRaw === '-') continue

    const occurredAt = parseShopeeDate(occurredAtRaw)
    if (!occurredAt) {
      errors.push({ row: rowNumber, field: 'วันที่', message: `วันที่ไม่ถูกต้อง: "${occurredAtRaw}"`, severity: 'warning' })
      continue
    }

    const amount = parseAmount(amountRaw)
    if (amount <= 0) {
      errors.push({ row: rowNumber, field: 'จำนวนเงิน', message: `จำนวนเงินไม่ถูกต้อง: "${amountRaw}"`, severity: 'warning' })
      continue
    }

    const directionRaw = getField(row, colMap, 'direction')
    const direction = mapDirection(directionRaw)

    const description = getField(row, colMap, 'description') || null
    const refIdRaw = getField(row, colMap, 'ref_id').trim()
    const refId = refIdRaw && refIdRaw !== '-' && refIdRaw !== '' ? refIdRaw : null
    const status = getField(row, colMap, 'status') || null
    const balanceAfterRaw = getField(row, colMap, 'balance_after')
    const balanceAfter = balanceAfterRaw && balanceAfterRaw !== '-' ? parseAmount(balanceAfterRaw) : null

    const refType = mapRefType(refId, transactionType)
    const txnHash = makeTxnHash(occurredAt, transactionType, direction, amount, refId, balanceAfter)

    if (direction === 'credit') {
      totalCredit += amount
    } else {
      totalDebit += amount
    }
    if (refType === 'shopee_withdrawal') withdrawalCount++
    if (refType === 'shopee_order') orderCount++

    txnRows.push({
      occurred_at: occurredAt,
      transaction_type: transactionType,
      description,
      ref_id: refId,
      ref_type: refType,
      direction,
      amount,
      status,
      balance_after: balanceAfter,
      txn_hash: txnHash,
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
      withdrawalCount,
      orderCount,
    },
    errors,
    warnings: [
      `พบ ${txnRows.length} รายการ (Header row: บรรทัดที่ ${headerRowIndex + 1})`,
      `เงินเข้า: ${totalCredit.toLocaleString('th-TH', { minimumFractionDigits: 2 })} THB`,
      `เงินออก: ${totalDebit.toLocaleString('th-TH', { minimumFractionDigits: 2 })} THB`,
    ],
  }
}
