/**
 * Smoke test — TikTok Video Performance Export parser
 *
 * Usage (from frontend/):
 *   npx tsx scripts/smoke-tiktok-video-export.ts
 *   npx tsx scripts/smoke-tiktok-video-export.ts --file /path/to/Creator-Video-Performance_*.xlsx
 *
 * No secrets. No DB. No side effects.
 */

import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'

import {
  parseTikTokVideoPerformanceExport,
  parseCurrencyTHB,
  parseDurationToSec,
  parsePercent,
  parseInteger,
  parsePostedAt,
  normalizeHeader,
} from '../src/lib/content-ops/tiktok-video-performance-export'

// ─── Inline fixture ───────────────────────────────────────────────────────────
//
// Mirrors the real export structure:
//   Row 0: date-range metadata
//   Row 1: blank
//   Row 2: Thai headers
//   Row 3+: data

function buildFixtureBuffer(): Buffer {
  const sheetData: unknown[][] = [
    // Row 0: date range metadata
    ['2026-04-16 ~ 2026-04-16', '', '', '', '', '', '', '', '', '', ''],
    // Row 1: blank
    ['', '', '', '', '', '', '', '', '', '', ''],
    // Row 2: headers (as exported by TikTok)
    [
      'ชื่อวิดีโอ',
      'โพสต์แล้ว',
      'ระยะเวลา',
      'GMV',
      'GMV โดยตรง',
      'ยอดการดู',
      'จำนวนที่ขายได้',
      'CTR',
      'การดูจนจบ',
      'ผู้ติดตามใหม่',
      'รหัส',
    ],
    // Row 3: data row 1
    [
      'วิดีโอรีวิวสินค้า A',
      '2026-04-16 08:00',
      '1min 8s',
      '฿665.73',
      '฿665.73',
      '3803',
      '5',
      '2.58%',
      '1.13%',
      '2',
      '1731712211734463628',
    ],
    // Row 4: data row 2
    [
      'วิดีโอสาธิตสินค้า B',
      '2026-04-16 10:30',
      '55s',
      '฿0.00',
      '฿0.00',
      '1200',
      '0',
      '1.80%',
      '0.90%',
      '0',
      '1731712211734463999',
    ],
    // Row 5: data row 3 (longer video)
    [
      'ไลฟ์สดทดสอบ',
      '2026-04-16 14:00',
      '1min 13s',
      '฿1200.00',
      '฿1000.00',
      '5500',
      '12',
      '3.10%',
      '2.05%',
      '8',
      '1731712211734464444',
    ],
    // Row 6: duplicate video ID (same as row 3 — for duplicate detection test)
    [
      'วิดีโอรีวิวสินค้า A (copy)',
      '2026-04-16 09:00',
      '1min 8s',
      '฿200.00',
      '฿200.00',
      '500',
      '1',
      '1.50%',
      '0.80%',
      '1',
      '1731712211734463628', // ← same ID as row 3
    ],
  ]

  const ws = XLSX.utils.aoa_to_sheet(sheetData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return buf
}

// ─── Unit-level helper tests ──────────────────────────────────────────────────

function runHelperTests(): void {
  console.log('\n── Helper parser tests ──────────────────────────────────────')

  const checks: Array<{ label: string; got: unknown; want: unknown }> = [
    // parseCurrencyTHB
    { label: 'parseCurrencyTHB "฿665.73"', got: parseCurrencyTHB('฿665.73'), want: 665.73 },
    { label: 'parseCurrencyTHB "฿0.00"', got: parseCurrencyTHB('฿0.00'), want: 0 },
    { label: 'parseCurrencyTHB ""', got: parseCurrencyTHB(''), want: null },
    { label: 'parseCurrencyTHB "-"', got: parseCurrencyTHB('-'), want: null },

    // parseDurationToSec
    { label: 'parseDurationToSec "1min 8s"', got: parseDurationToSec('1min 8s'), want: 68 },
    { label: 'parseDurationToSec "55s"', got: parseDurationToSec('55s'), want: 55 },
    { label: 'parseDurationToSec "1min 13s"', got: parseDurationToSec('1min 13s'), want: 73 },
    { label: 'parseDurationToSec "2min"', got: parseDurationToSec('2min'), want: 120 },
    { label: 'parseDurationToSec "01:35"', got: parseDurationToSec('01:35'), want: 95 },
    { label: 'parseDurationToSec ""', got: parseDurationToSec(''), want: null },

    // parsePercent
    { label: 'parsePercent "2.58%"', got: parsePercent('2.58%'), want: 0.0258 },
    { label: 'parsePercent "1.13%"', got: parsePercent('1.13%'), want: 0.0113 },
    { label: 'parsePercent ""', got: parsePercent(''), want: null },
    { label: 'parsePercent "-"', got: parsePercent('-'), want: null },

    // parseInteger
    { label: 'parseInteger "3803"', got: parseInteger('3803'), want: 3803 },
    { label: 'parseInteger "0"', got: parseInteger('0'), want: 0 },
    { label: 'parseInteger ""', got: parseInteger(''), want: null },

    // parsePostedAt
    {
      label: 'parsePostedAt iso',
      got: parsePostedAt('2026-04-16 08:00').iso,
      want: '2026-04-16T08:00:00+07:00',
    },
    { label: 'parsePostedAt raw', got: parsePostedAt('2026-04-16 08:00').raw, want: '2026-04-16 08:00' },
    { label: 'parsePostedAt empty', got: parsePostedAt('').raw, want: '' },

    // normalizeHeader
    { label: 'normalizeHeader "GMV โดยตรง"', got: normalizeHeader('GMV โดยตรง'), want: 'gmv โดยตรง' },
    { label: 'normalizeHeader "  CTR  "', got: normalizeHeader('  CTR  '), want: 'ctr' },
  ]

  let passed = 0
  for (const { label, got, want } of checks) {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
    if (ok) passed++
  }
  console.log(`\n  ${passed}/${checks.length} helper tests passed`)
}

// ─── Integration test against fixture ────────────────────────────────────────

function runFixtureTest(buf: Buffer): void {
  console.log('\n── Fixture parse test ───────────────────────────────────────')

  const result = parseTikTokVideoPerformanceExport(buf)

  console.log(`\n  ok: ${result.ok}`)
  console.log(`  meta.sheetName: ${result.meta.sheetName}`)
  console.log(`  meta.headerRowIndex: ${result.meta.headerRowIndex}`)
  console.log(`  meta.rowCount: ${result.meta.rowCount}`)
  console.log(`  meta.dateRangeRaw: ${result.meta.dateRangeRaw}`)
  console.log(`  meta.detectedHeaders: ${result.meta.detectedHeaders.join(', ')}`)
  console.log(`  meta.duplicateVideoIds: ${JSON.stringify(result.meta.duplicateVideoIds)}`)

  if (result.errors && result.errors.length > 0) {
    console.log(`\n  errors (${result.errors.length}):`)
    for (const e of result.errors) {
      console.log(`    [row ${e.row ?? '-'}] ${e.code} — ${e.field ?? ''}: ${e.message}`)
    }
  }

  if (result.data && result.data.length > 0) {
    console.log(`\n  data rows (${result.data.length}):`)
    for (const row of result.data) {
      console.log(
        `    videoId=${row.videoIdRaw} | title="${row.videoTitle}" | posted=${row.postedAt ?? row.postedAtRaw}` +
        ` | dur=${row.durationSec}s | gmv=${row.gmvTotal} | views=${row.views} | ctr=${row.ctr} | watchFull=${row.watchFullRate}`
      )
    }
  }

  // Assertions
  const asserts: Array<{ label: string; pass: boolean }> = [
    { label: 'ok is true', pass: result.ok === true },
    { label: 'headerRowIndex is 2', pass: result.meta.headerRowIndex === 2 },
    { label: 'rowCount is 4 (including duplicate)', pass: result.meta.rowCount === 4 },
    { label: 'dateRangeRaw detected', pass: result.meta.dateRangeRaw === '2026-04-16 ~ 2026-04-16' },
    {
      label: 'duplicateVideoIds contains 1731712211734463628',
      pass: result.meta.duplicateVideoIds?.includes('1731712211734463628') === true,
    },
    {
      label: 'first row durationSec = 68',
      pass: result.data?.[0]?.durationSec === 68,
    },
    {
      label: 'first row gmvTotal = 665.73',
      pass: result.data?.[0]?.gmvTotal === 665.73,
    },
    {
      label: 'first row ctr ≈ 0.0258',
      pass: Math.abs((result.data?.[0]?.ctr ?? -1) - 0.0258) < 0.0001,
    },
    {
      label: 'first row postedAt has +07:00',
      pass: result.data?.[0]?.postedAt?.includes('+07:00') === true,
    },
    {
      label: 'DUPLICATE_VIDEO_ID error present',
      pass: result.errors?.some((e) => e.code === 'DUPLICATE_VIDEO_ID') === true,
    },
  ]

  console.log('\n  assertions:')
  let passed = 0
  for (const { label, pass } of asserts) {
    console.log(`    ${pass ? '✓' : '✗'} ${label}`)
    if (pass) passed++
  }
  console.log(`\n  ${passed}/${asserts.length} fixture assertions passed`)
}

// ─── Real file test (optional) ────────────────────────────────────────────────

function runRealFileTest(filePath: string): void {
  console.log(`\n── Real file test: ${filePath} ─────────────────────────────`)

  if (!fs.existsSync(filePath)) {
    console.log('  File not found, skipping.')
    return
  }

  const buf = fs.readFileSync(filePath)
  const result = parseTikTokVideoPerformanceExport(buf)

  console.log(`  ok: ${result.ok}`)
  console.log(`  meta.rowCount: ${result.meta.rowCount}`)
  console.log(`  meta.headerRowIndex: ${result.meta.headerRowIndex}`)
  console.log(`  meta.dateRangeRaw: ${result.meta.dateRangeRaw}`)
  console.log(`  meta.detectedHeaders: ${result.meta.detectedHeaders.join(', ')}`)
  console.log(`  errors: ${result.errors?.length ?? 0}`)
  if (result.meta.duplicateVideoIds?.length) {
    console.log(`  duplicateVideoIds: ${result.meta.duplicateVideoIds.join(', ')}`)
  }
  if (result.data && result.data.length > 0) {
    console.log(`  first row: ${JSON.stringify(result.data[0], null, 2)}`)
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const fileFlag = args.indexOf('--file')
const realFilePath = fileFlag !== -1 ? args[fileFlag + 1] : undefined

runHelperTests()
runFixtureTest(buildFixtureBuffer())
if (realFilePath) runRealFileTest(realFilePath)

console.log('\n── Done ─────────────────────────────────────────────────────\n')
