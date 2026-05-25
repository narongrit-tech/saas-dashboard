/**
 * classify-bank-inflows.ts
 * Reads all NM Cash Flow XLSX files (Jan–May 2026), extracts InFlow rows,
 * matches them to bank_transactions by (txn_date, deposit amount),
 * and updates cash_in_type on each matched row.
 *
 * Usage:
 *   npx tsx scripts/classify-bank-inflows.ts [--dry-run]
 */

import path from 'node:path'
import fs from 'node:fs'
import { config } from 'dotenv'
import * as XLSX from 'xlsx'
import { createServiceClient } from '../src/lib/supabase/service'

config({ path: path.resolve(__dirname, '../.env.local') })

const EXPENSE_DIR = path.resolve(__dirname, '../../Raw. Data Nimitt Mind/Expense')
const DRY_RUN = process.argv.includes('--dry-run')

const CASH_FLOW_FILES = [
  '_[2026] 01 NM Jan-CASH FLOW.xlsx',
  '_[2026] 02 NM Feb-CASH FLOW.xlsx',
  '_[2026] 03 NM Mar-CASH FLOW (1).xlsx',
  '[2026] 04 NM Apr-CASH FLOW.xlsx',
  '_[2026] 05 NM May-CASH FLOW.xlsx',
]

// Normalize Cash Flow type (col 5) → cash_in_type label
const TYPE_MAP: Record<string, string> = {
  'MCN':                      'MCN',
  'Cool Smile revenue':       'Cool Smile Revenue',
  'Sponcer':                  'Sponsorship',
  'Sponsor':                  'Sponsorship',
  'Incentive':                'Incentive',
  "Director's loan":          "Director's Loan",
  'Tiktok Affiliate Income':  'Affiliate Income',
  'NMM จ่ายคืนสำรองจ่าย':    'Internal Reimbursement',
  'เงินจาก':                  'Transfer In',
  'Refund':                   'Refund',
}

// Jan 2026 format: col 5 is empty — infer type from description (col 6)
const DESC_TYPE_MAP: Record<string, string> = {
  'ถอนเงินจาก Tiktok Shop Cool Smile':    'Cool Smile Revenue',
  'ถอนเงินจาก Tiktok Shop Cool Wellness': 'Cool Smile Revenue',
  'ถอนเงินจากร้านค้า Shopee Cool Smile':  'Cool Smile Revenue',
  'เงินกู้กรรมการ (รายได้จาก TikTok)':   "Director's Loan",
  'โอนเงินคืนค่าจ้างตัดต่อ VDO':          'Refund',
  'โอนเงินคืนค่าไฟฟ้า 288/24':            'Refund',
}

// Types (col 5) that are NOT actual income — skip
const SKIP_TYPES = new Set([
  'ยอดคงเหลือยกมา',
])

// Descriptions (col 6) to skip when col 5 is empty (Jan format)
const SKIP_DESCS = new Set([
  'ยอดคงเหลือยกมา',
])

interface InFlowRow {
  date:    string    // YYYY-MM-DD
  type:    string    // normalized label
  rawType: string
  desc:    string
  amount:  number
  file:    string
}

function excelSerialToISO(serial: number): string | null {
  if (!serial || serial < 44000) return null
  const ms = (serial - 25569) * 86400000
  const d  = new Date(ms)
  if (isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
}

function parseInFlows(filePath: string): InFlowRow[] {
  const buf = fs.readFileSync(filePath)
  const wb  = XLSX.read(buf, { type: 'buffer', cellDates: false })
  const ws  = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]

  const result: InFlowRow[] = []
  const fname = path.basename(filePath)

  for (let i = 4; i < raw.length; i++) {
    const row    = raw[i] as unknown[]
    const serial = typeof row[0] === 'number' ? row[0] : null
    if (!serial) continue

    const date = excelSerialToISO(serial)
    if (!date) continue

    const inFlowRaw = row[7]
    if (typeof inFlowRaw !== 'number' || inFlowRaw <= 0) continue

    const rawType = String(row[5] ?? '').trim()
    const desc    = String(row[6] ?? '').trim()

    if (SKIP_TYPES.has(rawType)) continue
    // Jan format: col 5 empty — check desc skip list before desc-type lookup
    if (rawType === '' && SKIP_DESCS.has(desc)) continue

    const typeNorm = rawType.replace(/\s+/g, ' ').trim()
    let label = TYPE_MAP[typeNorm]

    // Fallback: Jan format has empty col 5 — infer from description
    if (!label && typeNorm === '') {
      label = DESC_TYPE_MAP[desc]
    }

    if (!label) {
      process.stderr.write(`[WARN] Unknown InFlow type "${rawType}" desc="${desc}" in ${fname} row ${i+1} — skipped\n`)
      continue
    }

    result.push({ date, type: label, rawType, desc, amount: inFlowRaw, file: fname })
  }

  return result
}

async function main() {
  const supabase = createServiceClient()

  // 1. Parse all InFlow rows from all Cash Flow files
  const allInflows: InFlowRow[] = []
  for (const fname of CASH_FLOW_FILES) {
    const fp = path.join(EXPENSE_DIR, fname)
    if (!fs.existsSync(fp)) { process.stderr.write(`[WARN] File not found: ${fname}\n`); continue }
    const rows = parseInFlows(fp)
    console.log(`  ${fname}: ${rows.length} InFlow rows`)
    allInflows.push(...rows)
  }
  console.log(`\nTotal InFlow rows to match: ${allInflows.length}`)

  // 2. Fetch all unclassified deposit rows from bank_transactions
  const { data: deposits, error: depErr } = await supabase
    .from('bank_transactions')
    .select('id, txn_date, deposit')
    .gt('deposit', 0)
    .is('cash_in_type', null)

  if (depErr) throw new Error(`Failed to fetch deposits: ${depErr.message}`)
  console.log(`Unclassified bank deposit rows: ${deposits!.length}\n`)

  // Build a lookup map: "YYYY-MM-DD|amount" → row ids[]
  const depositMap = new Map<string, string[]>()
  for (const d of deposits!) {
    const key = `${d.txn_date}|${d.deposit}`
    const list = depositMap.get(key) ?? []
    list.push(d.id)
    depositMap.set(key, list)
  }

  // Helper: try exact date, then +1 day, then -1 day
  function findIds(date: string, amount: number): { ids: string[]; offset: number } {
    for (const offset of [0, 1, -1]) {
      const d   = new Date(date + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() + offset)
      const key = `${d.toISOString().substring(0, 10)}|${amount}`
      const ids  = depositMap.get(key)
      if (ids && ids.length > 0) return { ids, offset }
    }
    return { ids: [], offset: 0 }
  }

  // 3. Match InFlow rows → bank_transaction ids
  let matched    = 0
  let unmatched  = 0
  let updated    = 0

  for (const inflow of allInflows) {
    const { ids, offset } = findIds(inflow.date, inflow.amount)

    if (ids.length === 0) {
      process.stderr.write(`[UNMATCHED] ${inflow.date} ${inflow.amount} "${inflow.rawType}" (${inflow.file})\n`)
      unmatched++
      continue
    }

    matched++
    const bankDate = (() => {
      const d = new Date(inflow.date + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() + offset)
      return d.toISOString().substring(0, 10)
    })()

    if (DRY_RUN) {
      const offsetNote = offset !== 0 ? ` [date+${offset}: bank=${bankDate}]` : ''
      console.log(`[DRY] Would update ${ids.length} row(s): ${inflow.date} ${inflow.amount} → cash_in_type="${inflow.type}"${offsetNote}`)
      continue
    }

    const { error: upErr } = await supabase
      .from('bank_transactions')
      .update({ cash_in_type: inflow.type })
      .in('id', ids)

    if (upErr) {
      process.stderr.write(`[ERROR] update failed for ${inflow.date}|${inflow.amount}: ${upErr.message}\n`)
    } else {
      updated += ids.length
      depositMap.delete(`${bankDate}|${inflow.amount}`)
    }
  }

  console.log('\n=== Result ===')
  console.log(`Matched:   ${matched}`)
  console.log(`Unmatched: ${unmatched}`)
  if (!DRY_RUN) console.log(`Updated rows: ${updated}`)
  else console.log('(dry-run — no changes written)')
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
