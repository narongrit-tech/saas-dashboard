#!/usr/bin/env node
/**
 * Debug script: inspect TikTok Ads xlsx structure + detect parsing issues
 * Usage: npx tsx scripts/debug-ads-xlsx.ts <path-to-xlsx>
 */
import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: npx tsx scripts/debug-ads-xlsx.ts <path-to-xlsx> [fallback-date YYYY-MM-DD]')
  process.exit(1)
}
// Optional fallback date when file has no date column (e.g. creative-level reports)
const FALLBACK_DATE: string | null = process.argv[3] ?? null

const absPath = path.resolve(filePath)
if (!fs.existsSync(absPath)) {
  console.error(`File not found: ${absPath}`)
  process.exit(1)
}

// ─── Timings ────────────────────────────────────────────────────────────────
function t(label: string, fn: () => void) {
  const start = Date.now()
  fn()
  console.log(`  ⏱  ${label}: ${Date.now() - start}ms\n`)
}

// ─── Helpers (mirrors tiktok-ads-parser.ts) ─────────────────────────────────
function normalizeHeader(text: string): string {
  return String(text)
    .replace(/^\uFEFF/, '')
    .replace(/[\n\r]/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

const COLUMN_TOKENS = {
  date:     ['date','วันที่','วันเริ่มต้น','วันเริ่ม','เวลาเริ่มต้น','เวลาเริ่ม','start date','start time','日期'],
  campaign: ['campaign','แคมเปญ','ชื่อแคมเปญ','ชื่อแคมเปญโฆษณา','ชื่อ live','ชื่อไลฟ์','ad name','creative','campaign name','活动'],
  cost:     ['cost','spend','ค่าใช้จ่าย','ต้นทุน','ad spend','total cost','费用'],
  gmv:      ['gmv','revenue','รายได้','รายได้ขั้นต้น','มูลค่ายอดขาย','ยอดขาย','conversion value','total value','收入'],
  orders:   ['order','orders','คำสั่งซื้อ','คำสั่งซื้อ sku','จำนวนคำสั่งซื้อ','conversion','conversions','purchase','purchases','订单'],
  roas:     ['roas','roi','return on ad spend','ผลตอบแทน'],
  currency: ['currency','สกุลเงิน','货币'],
}

function scoreColumn(header: string, tokens: string[]): number {
  const norm = normalizeHeader(header)
  for (const token of tokens) {
    const t = token.toLowerCase().trim()
    if (norm === t) return 100
    if (norm.includes(t)) return 50
    if (t.includes(norm) && norm.length > 3) return 30
  }
  return 0
}

function detectColumns(headers: string[]) {
  const result: Record<string, string | null> = {}
  const scores: Record<string, { header: string; score: number }[]> = {}

  for (const [field, tokens] of Object.entries(COLUMN_TOKENS)) {
    const candidates = headers
      .map(h => ({ header: h, score: scoreColumn(h, tokens) }))
      .filter(x => x.score > 25)
      .sort((a, b) => b.score - a.score)

    scores[field] = candidates.slice(0, 3)
    result[field] = candidates[0]?.header ?? null
  }

  return { result, scores }
}

function parseNumeric(value: unknown): number {
  if (typeof value === 'number') return value
  if (!value) return 0
  const str = String(value).replace(/[^0-9.-]/g, '').trim()
  const num = parseFloat(str)
  return isNaN(num) ? 0 : num
}

// ─── Excel serial → date string ─────────────────────────────────────────────
function excelSerialToDate(serial: number): string {
  const epoch = new Date(Date.UTC(1899, 11, 30))
  const d = new Date(epoch.getTime() + serial * 86400000)
  return d.toISOString().slice(0, 10)
}

function parseDateRaw(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    // Could be Excel serial date OR an hour number (0-23) if hourly breakdown
    if (value < 100) return `HOUR_VALUE:${value}` // likely hour 0-23, not a date
    return excelSerialToDate(value)
  }
  const s = String(value).trim()
  // Try to detect date patterns
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10) // YYYY-MM-DD or datetime
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    const [m, d, y] = s.split('/').map(Number)
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  if (/^\d{2}:\d{2}/.test(s)) return `TIME_ONLY:${s}` // time only
  return `UNKNOWN_FORMAT:${s.slice(0, 30)}`
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
console.log('═'.repeat(70))
console.log(`📂 File: ${path.basename(absPath)}`)
console.log(`   Size: ${(fs.statSync(absPath).size / 1024 / 1024).toFixed(2)} MB`)
console.log('═'.repeat(70))

let workbook: XLSX.WorkBook
t('XLSX.read (full)', () => {
  const data = fs.readFileSync(absPath)
  workbook = XLSX.read(data, { type: 'buffer', cellDates: false })
})

console.log(`📋 Sheets (${workbook!.SheetNames.length}): ${workbook!.SheetNames.map(s => `"${s}"`).join(', ')}`)
console.log()

// ─── Per-sheet info ──────────────────────────────────────────────────────────
for (const sheetName of workbook!.SheetNames) {
  const sheet = workbook!.Sheets[sheetName]
  const ref = sheet['!ref'] ?? 'empty'
  console.log(`  Sheet: "${sheetName}"  ref=${ref}`)

  if (!sheet['!ref']) continue

  // Get raw rows
  let rows: Record<string, unknown>[]
  t(`  sheet_to_json "${sheetName}"`, () => {
    rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true }) as Record<string, unknown>[]
  })

  const rowCount = rows!.length
  console.log(`  Rows: ${rowCount}`)

  if (rowCount === 0) continue

  const headers = Object.keys(rows![0])
  console.log(`  Headers (${headers.length}):`)
  headers.forEach((h, i) => console.log(`    [${i}] "${h}"  →  normalized: "${normalizeHeader(h)}"`))
  console.log()

  // Column detection
  const { result: mapping, scores } = detectColumns(headers)
  console.log('  🔍 Column Detection:')
  for (const [field, matched] of Object.entries(mapping)) {
    const topCandidates = scores[field].map(x => `"${x.header}"(${x.score})`).join(', ')
    console.log(`    ${field.padEnd(10)}: ${matched ? `✅ "${matched}"` : '❌ not found'}  candidates: [${topCandidates || 'none'}]`)
  }
  console.log()

  // Sample raw rows
  console.log('  📊 First 5 raw rows:')
  rows!.slice(0, 5).forEach((row, i) => {
    console.log(`  Row ${i + 1}:`)
    for (const h of headers.slice(0, 12)) {
      const val = row[h]
      const type = typeof val
      console.log(`    "${h}": ${JSON.stringify(val)}  (${type})`)
    }
    console.log()
  })

  // Date column analysis
  if (mapping.date) {
    const dateCol = mapping.date
    console.log(`  📅 Date column "${dateCol}" — first 20 values:`)
    const dateValues = rows!.slice(0, 20).map(r => parseDateRaw(r[dateCol]))
    const unique = Array.from(new Set(dateValues))
    console.log(`    Values: ${unique.map(v => `"${v}"`).join(', ')}`)

    // Count distinct dates
    const allDates = rows!.map(r => parseDateRaw(r[dateCol])).filter(Boolean)
    const dateCounts: Record<string, number> = {}
    for (const d of allDates) {
      dateCounts[d!] = (dateCounts[d!] ?? 0) + 1
    }
    console.log(`  📅 All distinct date values + row counts:`)
    for (const [d, count] of Object.entries(dateCounts).sort()) {
      console.log(`    "${d}": ${count} rows`)
    }
    console.log()
  }

  // Aggregate for all rows + filter to target date
  // When no date column, use FALLBACK_DATE (from CLI arg) for every row
  const TARGET_DATE = FALLBACK_DATE ?? '2026-02-01'
  const hasDateCol = !!mapping.date
  if (!hasDateCol && FALLBACK_DATE) {
    console.log(`  ℹ️  No date column — using fallback date: ${FALLBACK_DATE} for all rows`)
    console.log()
  }

  let totalSpend = 0, totalGMV = 0, totalOrders = 0, rowsAll = 0, rowsFiltered = 0
  let filtSpend = 0, filtGMV = 0, filtOrders = 0

  // Also aggregate by campaignName (mirrors real parser's Map logic)
  const campaignAgg = new Map<string, { spend: number; gmv: number; orders: number }>()

  for (const row of rows!) {
    const spend = parseNumeric(mapping.cost ? row[mapping.cost] : 0)
    const gmv   = parseNumeric(mapping.gmv  ? row[mapping.gmv]  : 0)
    const orders= parseNumeric(mapping.orders ? row[mapping.orders] : 0)
    totalSpend  += spend
    totalGMV    += gmv
    totalOrders += orders
    rowsAll++

    // Skip rows with no activity — mirrors real parser filter
    if (spend === 0 && gmv === 0 && orders === 0) continue

    // Date resolution
    const rawDate = hasDateCol && mapping.date
      ? parseDateRaw(row[mapping.date])
      : (FALLBACK_DATE ?? null)
    const isTarget = rawDate?.startsWith(TARGET_DATE) || rawDate === TARGET_DATE
    if (isTarget) {
      filtSpend  += spend
      filtGMV    += gmv
      filtOrders += orders
      rowsFiltered++

      // Per-campaign aggregation (mirrors real parser)
      const campaignName = mapping.campaign ? String(row[mapping.campaign] ?? '') : 'UNKNOWN'
      const existing = campaignAgg.get(campaignName)
      if (existing) {
        existing.spend  += spend
        existing.gmv    += gmv
        existing.orders += orders
      } else {
        campaignAgg.set(campaignName, { spend, gmv, orders })
      }
    }
  }

  console.log(`  📈 Aggregates — ALL rows (${rowsAll}):`)
  console.log(`    totalSpend  = ${totalSpend.toFixed(2)}`)
  console.log(`    totalGMV    = ${totalGMV.toFixed(2)}`)
  console.log(`    totalOrders = ${totalOrders}`)
  console.log()
  console.log(`  📈 Aggregates — filtered to ${TARGET_DATE} (${rowsFiltered} raw rows → ${campaignAgg.size} campaigns after aggregation):`)
  console.log(`    totalSpend  = ${filtSpend.toFixed(2)}`)
  console.log(`    totalGMV    = ${filtGMV.toFixed(2)}`)
  console.log(`    totalOrders = ${filtOrders}`)
  console.log()
  if (campaignAgg.size > 0 && campaignAgg.size <= 20) {
    console.log(`  📊 Per-campaign breakdown (${TARGET_DATE}):`)
    const entries = Array.from(campaignAgg.entries()).sort((a, b) => b[1].spend - a[1].spend)
    for (const [name, v] of entries) {
      console.log(`    ${name.slice(0, 60).padEnd(60)} | spend=${v.spend.toFixed(2)} gmv=${v.gmv.toFixed(2)} orders=${v.orders}`)
    }
    console.log()
  } else if (campaignAgg.size > 20) {
    console.log(`  📊 Top 20 campaigns by spend (${TARGET_DATE}):`)
    const entries = Array.from(campaignAgg.entries()).sort((a, b) => b[1].spend - a[1].spend).slice(0, 20)
    for (const [name, v] of entries) {
      console.log(`    ${name.slice(0, 60).padEnd(60)} | spend=${v.spend.toFixed(2)} gmv=${v.gmv.toFixed(2)} orders=${v.orders}`)
    }
    console.log()
  }
}

console.log('─'.repeat(70))
console.log('✅ Debug complete')
