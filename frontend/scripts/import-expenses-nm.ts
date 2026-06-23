/**
 * import-expenses-nm.ts
 * Import expenses from NM Cash Flow XLSX format.
 *
 * Reads the "On Record" sheet (first sheet) which has this structure:
 *   Row 1-4 : header/summary block (skip)
 *   Row 5+  : data rows
 *
 * Column indices (0-based):
 *   0 = Date (Excel serial)
 *   5 = Type / Expense category
 *   6 = Description
 *   7 = In Flow (positive = income — skip)
 *   8 = Out Flow (positive = expense — USE THIS)
 *
 * Usage:
 *   npx tsx scripts/import-expenses-nm.ts <file>
 *   e.g. npx tsx scripts/import-expenses-nm.ts "../Raw. Data Nimitt Mind/Expense/[2026] 04 NM Apr-CASH FLOW.xlsx"
 */

import path from 'node:path'
import fs from 'node:fs'
import crypto from 'crypto'
import { config } from 'dotenv'
import * as XLSX from 'xlsx'
import { createServiceClient } from '../src/lib/supabase/service'

config({ path: path.resolve(__dirname, '../.env.local') })

const USER_ID  = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
const BATCH_SZ = 200

// Map NM Cash Flow type → system expense category
type Category = 'Advertising' | 'COGS' | 'Operating' | 'Tax'

const CATEGORY_MAP: Record<string, Category> = {
  'Operation':              'Operating',
  'Operating':              'Operating',
  'Advertising':            'Advertising',
  'Production':             'COGS',
  'Packing':                'COGS',
  'Promotion':              'Advertising',
  'Sponcer':                'Advertising',
  'Sponsor':                'Advertising',
  'Commission':             'Operating',
  'Vat':                    'Tax',
  'Shiping':                'Operating',
  'Shipping':               'Operating',
  'Incentive':              'Operating',
  'ชำระหนี้':               'Operating',
  'Renovate &  Mainten':    'Operating',
  'Renovate & Mainten':     'Operating',
  'Renovate':               'Operating',
  'MCN':                    'Operating',
}

// Category types that should be skipped (income or non-expense)
const SKIP_TYPES = new Set([
  '',
  'Cool Smile revenue',
  'Tiktok Affiliate Income',
  'เงินส่วนตัว',
  "Director's loan",
  'ยอดคงเหลือยกมา',
  'Refund',
  'NMM จ่ายคืนสำรองจ่าย',
  'เงินจาก',
])

function excelSerialToISO(serial: number): string | null {
  if (!serial || serial < 44000) return null // sanity: before 2020
  const ms = (serial - 25569) * 86400000
  const d  = new Date(ms)
  if (isNaN(d.getTime())) return null
  const y  = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dy = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${dy}`
}

function parseAmount(v: unknown): number {
  if (typeof v === 'number') return isNaN(v) ? 0 : Math.abs(v)
  if (!v || String(v).trim() === '' || String(v).trim() === '-') return 0
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? 0 : n
}

function expenseHash(userId: string, date: string, category: string, amount: number, description: string): string {
  return crypto
    .createHash('sha256')
    .update([userId, date, category, amount.toString(), description || ''].join('|'))
    .digest('hex')
}

interface ExpenseRow {
  expense_date: string
  category:     Category
  description:  string
  amount:       number
  source_row:   number
}

function parseSheet(ws: XLSX.WorkSheet): ExpenseRow[] {
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
  const result: ExpenseRow[] = []
  const skippedTypes = new Set<string>()

  // Data starts at row index 4 (0-based) = Excel row 5
  for (let i = 4; i < raw.length; i++) {
    const row    = raw[i] as unknown[]
    const serial = typeof row[0] === 'number' ? row[0] : null
    if (!serial) continue

    const date = excelSerialToISO(serial)
    if (!date) continue

    const typeRaw    = String(row[5] ?? '').trim()
    const desc       = String(row[6] ?? '').trim()
    const outFlowRaw = row[8]
    const outFlow    = parseAmount(outFlowRaw)

    if (outFlow <= 0) continue
    if (SKIP_TYPES.has(typeRaw)) continue

    // Normalize type for lookup (collapse multiple spaces)
    const typeNorm = typeRaw.replace(/\s+/g, ' ').trim()
    const category = CATEGORY_MAP[typeNorm]

    if (!category) {
      skippedTypes.add(typeRaw)
      continue
    }

    result.push({ expense_date: date, category, description: desc || typeRaw, amount: outFlow, source_row: i + 1 })
  }

  if (skippedTypes.size > 0) {
    process.stderr.write(`[WARN] Unknown types (skipped): ${[...skippedTypes].join(', ')}\n`)
  }

  return result
}

async function main() {
  // Parse --file and --created-by flags
  const fileIdx = process.argv.indexOf('--file')
  const filePath = fileIdx >= 0 && fileIdx + 1 < process.argv.length ? process.argv[fileIdx + 1] : process.argv[2]
  
  if (!filePath) throw new Error('Usage: npx tsx scripts/import-expenses-nm.ts --file <path-to-xlsx>')

  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(__dirname, filePath)
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${absPath}`)

  const supabase = createServiceClient()

  const buf   = fs.readFileSync(absPath)
  const fHash = crypto.createHash('sha256').update(buf).digest('hex')
  const fName = path.basename(absPath)

  // Idempotency
  const { data: existing } = await supabase
    .from('import_batches')
    .select('id')
    .eq('file_hash', fHash)
    .eq('report_type', 'expenses')
    .eq('status', 'success')
    .maybeSingle()

  if (existing) {
    const { count } = await supabase
      .from('expenses')
      .select('*', { count: 'exact', head: true })
      .eq('import_batch_id', existing.id)
    if ((count ?? 0) > 0) {
      console.log(JSON.stringify({ status: 'already_imported', batchId: existing.id, rows: count }))
      return
    }
  }

  // Parse "On Record" sheet (first sheet)
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('No sheet found in workbook')

  const rows = parseSheet(ws)
  if (rows.length === 0) throw new Error('No valid expense rows found in "On Record" sheet')

  const dates = rows.map(r => r.expense_date).sort()
  const dateRange = `${dates[0]} to ${dates[dates.length - 1]}`

  console.log(`Parsed ${rows.length} expense rows from "${fName}" (${dateRange})`)

  // Create batch
  const { data: batch, error: batchErr } = await supabase
    .from('import_batches')
    .insert({
      file_hash:      fHash,
      marketplace:    'internal',
      report_type:    'expenses',
      period:         dateRange,
      file_name:      fName,
      row_count:      rows.length,
      inserted_count: 0,
      updated_count:  0,
      skipped_count:  0,
      error_count:    0,
      status:         'processing',
      created_by:     USER_ID,
    })
    .select()
    .single()

  if (batchErr || !batch) throw new Error(`Batch creation failed: ${batchErr?.message}`)

  let inserted = 0
  let skipped  = 0

  for (let i = 0; i < rows.length; i += BATCH_SZ) {
    const chunk = rows.slice(i, i + BATCH_SZ)

    const expRows = chunk.map(r => ({
      expense_date:    r.expense_date,
      category:        r.category,
      description:     r.description,
      amount:          r.amount,
      expense_hash:    expenseHash(USER_ID, r.expense_date, r.category, r.amount, r.description),
      source:          'imported',
      import_batch_id: batch.id,
      created_by:      USER_ID,
    }))

    // Upsert on expense_hash (unique dedup key)
    const { data: upserted, error: upErr } = await supabase
      .from('expenses')
      .upsert(expRows, { onConflict: 'created_by,expense_hash', ignoreDuplicates: true })
      .select('id')

    if (upErr) {
      await supabase.from('import_batches')
        .update({ status: 'failed', notes: upErr.message })
        .eq('id', batch.id)
      throw new Error(`Upsert failed: ${upErr.message}`)
    }

    const n = upserted?.length ?? 0
    inserted += n
    skipped  += chunk.length - n
    process.stdout.write(`\r  ${Math.min(i + BATCH_SZ, rows.length)}/${rows.length} (ins=${inserted} skip=${skipped})`)
  }
  process.stdout.write('\n')

  await supabase.from('import_batches')
    .update({ status: 'success', inserted_count: inserted, skipped_count: skipped })
    .eq('id', batch.id)

  const byCategory: Record<string, number> = {}
  for (const r of rows) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + r.amount
  }

  console.log(JSON.stringify({ success: true, batchId: batch.id, inserted, skipped, dateRange, byCategory }))
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
