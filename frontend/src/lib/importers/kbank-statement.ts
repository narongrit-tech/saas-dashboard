import * as XLSX from 'xlsx'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import crypto from 'crypto'

const BANGKOK_TZ = 'Asia/Bangkok'

// KBank Business statement export — Thai + English column variants
const COLUMN_MAPPINGS: Record<string, string[]> = {
  txn_date: [
    'วันที่', 'date', 'transaction date', 'txn date', 'วันที่รายการ', 'วันเวลา', 'เวลา',
  ],
  description: [
    'รายการ', 'transaction', 'description', 'details', 'รายละเอียด', 'detail', 'transaction description',
  ],
  reference_id: [
    'เลขที่อ้างอิง', 'reference', 'ref', 'reference no', 'ref no', 'reference no.',
    'ref no.', 'reference number', 'เลขที่', 'เลขอ้างอิง',
  ],
  withdrawal: [
    'ถอน', 'debit', 'withdrawal', 'withdrawal (baht)', 'เงินออก', 'จ่าย', 'credit (debit)',
  ],
  deposit: [
    'ฝาก', 'credit', 'deposit', 'deposit (baht)', 'เงินเข้า', 'รับ',
  ],
  balance: [
    'ยอดคงเหลือ', 'balance', 'outstanding balance', 'ยอดคงเหลือล่าสุด',
  ],
  channel: [
    'ช่องทาง', 'channel', 'service channel', 'ประเภทรายการ',
  ],
}

export interface NormalizedBankRow {
  txn_date: Date
  description: string
  reference_id: string | null
  withdrawal: number | null
  deposit: number | null
  balance: number | null
  channel: string | null
}

export function calculateFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/**
 * Compute SHA256 txn_hash matching the formula in generate_bank_txn_hash() SQL function.
 * Format: bank_account_id|txn_date|withdrawal|deposit|description
 */
export function computeTxnHash(
  bankAccountId: string,
  txnDate: Date,
  withdrawal: number | null,
  deposit: number | null,
  description: string
): string {
  const dateStr = txnDate.toISOString().slice(0, 10)  // YYYY-MM-DD
  const payload = [
    bankAccountId,
    dateStr,
    (withdrawal ?? 0).toString(),
    (deposit ?? 0).toString(),
    description,
  ].join('|')
  return crypto.createHash('sha256').update(payload).digest('hex')
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
  const s = String(value).replace(/,/g, '').trim()
  if (s === '-' || s === '') return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function parseDate(value: unknown): Date | null {
  if (!value) return null
  if (typeof value === 'number') {
    // Excel serial date
    const excelEpoch = new Date(1899, 11, 30)
    const date = new Date(excelEpoch.getTime() + value * 86400000)
    return fromZonedTime(toZonedTime(date, BANGKOK_TZ), BANGKOK_TZ)
  }
  if (typeof value === 'string') {
    // DD/MM/YYYY (KBank Thai format)
    const ddmmyyyy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (ddmmyyyy) {
      const [, d, m, y] = ddmmyyyy
      const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
      const date = new Date(iso)
      if (!isNaN(date.getTime())) return fromZonedTime(toZonedTime(date, BANGKOK_TZ), BANGKOK_TZ)
    }
    // ISO or other parseable format
    const date = new Date(value)
    if (!isNaN(date.getTime())) return fromZonedTime(toZonedTime(date, BANGKOK_TZ), BANGKOK_TZ)
  }
  return null
}

function getCellValue(worksheet: XLSX.WorkSheet, row: number, col: number): string {
  const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })]
  if (!cell) return ''
  // For date-type cells return the ISO string so parseDate gets a stable format
  // (cell.w uses locale-dependent short format like "4/30/26" which fails our regex)
  if (cell.t === 'd' && cell.v instanceof Date) return cell.v.toISOString()
  if (cell.w) return String(cell.w).trim()
  if (cell.v !== null && cell.v !== undefined) return String(cell.v).trim()
  return ''
}

export function parseBankStatementExcel(buffer: Buffer): {
  rows: NormalizedBankRow[]
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

  const sheetRef = worksheet['!ref']
  let endRow = 1
  let endCol = 30

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

  // Find header row: scan for a row with txn_date or withdrawal column
  let headerRowIndex = -1
  for (let r = 0; r < Math.min(30, endRow + 1); r++) {
    const candidates: string[] = []
    for (let c = 0; c <= endCol; c++) candidates.push(getCellValue(worksheet, r, c))
    if (
      findColumn(candidates, COLUMN_MAPPINGS.txn_date) !== -1 ||
      findColumn(candidates, COLUMN_MAPPINGS.withdrawal) !== -1
    ) {
      headerRowIndex = r
      break
    }
  }

  if (headerRowIndex === -1) throw new Error('Could not find header row — expected วันที่/Date or ถอน/Debit column')

  const headers: string[] = []
  for (let c = 0; c <= endCol; c++) headers.push(getCellValue(worksheet, headerRowIndex, c))

  const cols = {
    txn_date:    findColumn(headers, COLUMN_MAPPINGS.txn_date),
    description: findColumn(headers, COLUMN_MAPPINGS.description),
    reference_id: findColumn(headers, COLUMN_MAPPINGS.reference_id),
    withdrawal:  findColumn(headers, COLUMN_MAPPINGS.withdrawal),
    deposit:     findColumn(headers, COLUMN_MAPPINGS.deposit),
    balance:     findColumn(headers, COLUMN_MAPPINGS.balance),
    channel:     findColumn(headers, COLUMN_MAPPINGS.channel),
  }

  if (cols.txn_date === -1) {
    warnings.push('Date column not found — skipping date parsing')
  }

  const rows: NormalizedBankRow[] = []

  for (let r = headerRowIndex + 1; r <= endRow; r++) {
    const dateRaw = cols.txn_date !== -1 ? getCellValue(worksheet, r, cols.txn_date) : ''
    const txnDate = parseDate(dateRaw)
    if (!txnDate) continue  // Skip rows without a valid date

    const desc = cols.description !== -1 ? getCellValue(worksheet, r, cols.description) || '' : ''
    if (!desc) continue  // Skip summary/footer rows

    rows.push({
      txn_date: txnDate,
      description: desc,
      reference_id: cols.reference_id !== -1 ? getCellValue(worksheet, r, cols.reference_id) || null : null,
      withdrawal: cols.withdrawal !== -1 ? parseNumeric(getCellValue(worksheet, r, cols.withdrawal)) : null,
      deposit:    cols.deposit !== -1 ? parseNumeric(getCellValue(worksheet, r, cols.deposit)) : null,
      balance:    cols.balance !== -1 ? parseNumeric(getCellValue(worksheet, r, cols.balance)) : null,
      channel:    cols.channel !== -1 ? getCellValue(worksheet, r, cols.channel) || null : null,
    })
  }

  return { rows, warnings }
}
