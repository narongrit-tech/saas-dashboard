/**
 * TikTok Creator Video Performance Export — Parser Foundation
 *
 * Input: Creator-Video-Performance_*.xlsx
 * Format: Row 0 = date-range metadata, Row 1 = blank, Row 2 = Thai headers, Row 3+ = data
 *
 * Responsibilities:
 *   parse → normalize → validate → return ParseResult<NormalizedTikTokVideoStatRow>
 *
 * NOT wired to DB. Not a UI module. Isolation boundary: Content Ops ingestion only.
 * Duplicate video IDs are surfaced in meta — NOT silently deduped here.
 */

import * as XLSX from 'xlsx'

// ─── Canonical row type ───────────────────────────────────────────────────────

export type NormalizedTikTokVideoStatRow = {
  videoIdRaw: string
  videoTitle: string

  postedAtRaw: string
  postedAt?: string // ISO 8601 with +07:00 when parseable

  durationRaw: string
  durationSec?: number

  gmvTotalRaw?: string
  gmvTotal?: number

  gmvDirectRaw?: string
  gmvDirect?: number

  viewsRaw?: string
  views?: number

  unitsSoldRaw?: string
  unitsSold?: number

  ctrRaw?: string
  ctr?: number // 0–1 decimal

  watchFullRateRaw?: string
  watchFullRate?: number // 0–1 decimal

  newFollowersRaw?: string
  newFollowers?: number

  source: 'tiktok_video_performance_export'
}

// ─── Result contract ──────────────────────────────────────────────────────────

export type ParseError = {
  row?: number
  field?: string
  code: ParseErrorCode
  message: string
  rawValue?: unknown
}

export type ParseErrorCode =
  | 'SHEET_NOT_FOUND'
  | 'HEADER_ROW_NOT_FOUND'
  | 'MISSING_REQUIRED_COLUMN'
  | 'MISSING_REQUIRED_VALUE'
  | 'INVALID_CURRENCY'
  | 'INVALID_PERCENT'
  | 'INVALID_INTEGER'
  | 'INVALID_DURATION'
  | 'INVALID_DATETIME'
  | 'NEGATIVE_VALUE'
  | 'DUPLICATE_VIDEO_ID'

export type ParseMeta = {
  sheetName?: string
  headerRowIndex: number
  rowCount: number
  detectedHeaders: string[]
  missingRequiredFields: string[]
  dateRangeRaw?: string
  duplicateVideoIds?: string[]
}

export type ParseResult<T> = {
  ok: boolean
  data?: T[]
  errors?: ParseError[]
  meta: ParseMeta
}

// ─── Header alias map (Thai → canonical field) ────────────────────────────────
//
// Keys are the result of normalizeHeader() applied to each raw Thai column label.
// normalizeHeader() lowercases, strips zero-width chars, collapses whitespace.

type CanonicalField = keyof NormalizedTikTokVideoStatRow

const HEADER_ALIAS_MAP: Record<string, CanonicalField> = {
  'ชื่อวิดีโอ': 'videoTitle',
  'โพสต์แล้ว': 'postedAtRaw',
  'ระยะเวลา': 'durationRaw',
  'gmv': 'gmvTotalRaw',
  'gmv โดยตรง': 'gmvDirectRaw',
  'ยอดการดู': 'viewsRaw',
  'จำนวนที่ขายได้': 'unitsSoldRaw',
  'ctr': 'ctrRaw',
  'การดูจนจบ': 'watchFullRateRaw',
  'ผู้ติดตามใหม่': 'newFollowersRaw',
  'รหัส': 'videoIdRaw',
}

const REQUIRED_FIELDS: CanonicalField[] = ['videoIdRaw', 'videoTitle', 'postedAtRaw']

// A header row must contain at least one of these anchor values to be accepted.
const ANCHOR_NORMALIZED_HEADERS = new Set<string>(['ชื่อวิดีโอ', 'รหัส'])

// ─── normalizeHeader ──────────────────────────────────────────────────────────

/**
 * Normalize a raw header string to a stable comparison key.
 * NFC-normalize Thai, strip zero-width chars, collapse whitespace, lowercase.
 */
export function normalizeHeader(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// ─── Value parsers ────────────────────────────────────────────────────────────

/** "฿665.73" → 665.73  |  "" / "-" → null */
export function parseCurrencyTHB(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  if (str === '' || str === '-') return null
  const cleaned = str.replace(/฿/g, '').replace(/,/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

/** "3803" → 3803  |  "" → null */
export function parseInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  if (str === '' || str === '-') return null
  const n = parseInt(str.replace(/,/g, ''), 10)
  return isNaN(n) ? null : n
}

/** "2.58%" → 0.0258  |  "" / "-" → null */
export function parsePercent(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  if (str === '' || str === '-') return null
  const cleaned = str.replace(/%/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n / 100
}

/**
 * "1min 8s" → 68  |  "55s" → 55  |  "2min" → 120  |  "01:35" → 95
 * Returns null for unparseable input.
 */
export function parseDurationToSec(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  if (str === '' || str === '-') return null

  // "1min 8s" | "1min 13s" | "55s"
  const minSecMatch = str.match(/^(?:(\d+)\s*min\s+)?(\d+)\s*s$/i)
  if (minSecMatch) {
    const mins = minSecMatch[1] ? parseInt(minSecMatch[1], 10) : 0
    const secs = parseInt(minSecMatch[2], 10)
    return mins * 60 + secs
  }

  // "2min" (no seconds)
  const minOnlyMatch = str.match(/^(\d+)\s*min$/i)
  if (minOnlyMatch) return parseInt(minOnlyMatch[1], 10) * 60

  // "01:35" MM:SS  or  "01:35:00" HH:MM:SS
  const colonMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (colonMatch) {
    if (colonMatch[3] !== undefined) {
      return (
        parseInt(colonMatch[1], 10) * 3600 +
        parseInt(colonMatch[2], 10) * 60 +
        parseInt(colonMatch[3], 10)
      )
    }
    return parseInt(colonMatch[1], 10) * 60 + parseInt(colonMatch[2], 10)
  }

  return null
}

/**
 * "2026-04-16 08:00" → raw string + ISO 8601 tagged as Bangkok (+07:00).
 * No timezone conversion is performed — the raw TikTok timestamp is assumed
 * to already be in Bangkok local time.
 */
export function parsePostedAt(value: unknown): { raw: string; iso?: string } {
  if (value === null || value === undefined) return { raw: '' }
  const raw = String(value).trim()
  if (raw === '') return { raw: '' }

  const dtMatch = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?$/)
  if (dtMatch) {
    return { raw, iso: `${dtMatch[1]}T${dtMatch[2]}:00+07:00` }
  }

  return { raw }
}

// ─── Internal: header detection ───────────────────────────────────────────────

function rowContainsAnchor(row: unknown[]): boolean {
  return row.some((cell) => {
    if (cell === null || cell === undefined) return false
    return ANCHOR_NORMALIZED_HEADERS.has(normalizeHeader(String(cell)))
  })
}

function findHeaderRowIndex(rows: unknown[][], maxScan = 10): number | null {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    if (rowContainsAnchor(rows[i])) return i
  }
  return null
}

// ─── Internal: column index map ───────────────────────────────────────────────

function buildColumnIndexMap(
  headerRow: unknown[]
): Map<CanonicalField, number> {
  const map = new Map<CanonicalField, number>()
  for (let i = 0; i < headerRow.length; i++) {
    const cell = headerRow[i]
    if (cell === null || cell === undefined) continue
    const normalized = normalizeHeader(String(cell))
    const field = HEADER_ALIAS_MAP[normalized]
    if (field !== undefined) map.set(field, i)
  }
  return map
}

function getRaw(
  row: unknown[],
  colMap: Map<CanonicalField, number>,
  field: CanonicalField
): string {
  const idx = colMap.get(field)
  if (idx === undefined) return ''
  const v = row[idx]
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

// ─── Internal: per-row validation helpers ─────────────────────────────────────

function pushIfInvalid(
  errors: ParseError[],
  condition: boolean,
  err: ParseError
): void {
  if (condition) errors.push(err)
}

// ─── Main parse function ──────────────────────────────────────────────────────

export type TikTokVideoPerformanceParseOptions = {
  /** Override which sheet to read. Defaults to first sheet. */
  sheetName?: string
}

export function parseTikTokVideoPerformanceExport(
  fileBuffer: Buffer,
  options?: TikTokVideoPerformanceParseOptions
): ParseResult<NormalizedTikTokVideoStatRow> {
  const errors: ParseError[] = []

  // ── Read workbook ──────────────────────────────────────────────────────────
  const wb = XLSX.read(fileBuffer, {
    type: 'buffer',
    cellDates: false,
    cellNF: false,
    cellHTML: false,
    cellStyles: false,
  })

  const sheetName = options?.sheetName ?? wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]

  if (!ws) {
    return {
      ok: false,
      errors: [
        {
          code: 'SHEET_NOT_FOUND',
          message: `Sheet "${sheetName}" not found in workbook`,
        },
      ],
      meta: {
        sheetName,
        headerRowIndex: -1,
        rowCount: 0,
        detectedHeaders: [],
        missingRequiredFields: [],
      },
    }
  }

  // ── Convert to 2D array ────────────────────────────────────────────────────
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: '',
    raw: true,
  }) as unknown[][]

  // ── Extract date-range metadata from row 0 ─────────────────────────────────
  let dateRangeRaw: string | undefined
  if (raw.length > 0) {
    const firstCell = String(raw[0][0] ?? '').trim()
    if (firstCell.includes('~') || /\d{4}-\d{2}-\d{2}/.test(firstCell)) {
      dateRangeRaw = firstCell
    }
  }

  // ── Detect header row ──────────────────────────────────────────────────────
  const headerRowIndex = findHeaderRowIndex(raw)

  if (headerRowIndex === null) {
    return {
      ok: false,
      errors: [
        {
          code: 'HEADER_ROW_NOT_FOUND',
          message: 'Could not find a row containing expected Thai video export headers',
        },
      ],
      meta: {
        sheetName,
        headerRowIndex: -1,
        rowCount: 0,
        detectedHeaders: [],
        missingRequiredFields: [],
        dateRangeRaw,
      },
    }
  }

  const headerRow = raw[headerRowIndex]
  const detectedHeaders = headerRow
    .map((c) => String(c ?? '').trim())
    .filter(Boolean)

  const colMap = buildColumnIndexMap(headerRow)

  // ── Check required columns are present ────────────────────────────────────
  const missingRequiredFields = REQUIRED_FIELDS.filter((f) => !colMap.has(f))

  if (missingRequiredFields.length > 0) {
    for (const field of missingRequiredFields) {
      errors.push({
        code: 'MISSING_REQUIRED_COLUMN',
        field,
        message: `Required column "${field}" not found in header row`,
      })
    }
    return {
      ok: false,
      errors,
      meta: {
        sheetName,
        headerRowIndex,
        rowCount: 0,
        detectedHeaders,
        missingRequiredFields,
        dateRangeRaw,
      },
    }
  }

  // ── Process data rows ──────────────────────────────────────────────────────
  const dataRows = raw.slice(headerRowIndex + 1)
  const data: NormalizedTikTokVideoStatRow[] = []
  const videoIdFirstSeen = new Map<string, number>()
  const duplicateVideoIds = new Set<string>()

  for (let ri = 0; ri < dataRows.length; ri++) {
    const row = dataRows[ri]
    // 1-indexed row number relative to original sheet
    const sourceRow = headerRowIndex + 1 + ri + 1

    // Skip blank rows
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) {
      continue
    }

    // ── Required field values ────────────────────────────────────────────────
    const videoIdRaw = getRaw(row, colMap, 'videoIdRaw')
    const videoTitle = getRaw(row, colMap, 'videoTitle')
    const postedAtRaw = getRaw(row, colMap, 'postedAtRaw')

    const rowFatal: ParseError[] = []
    if (!videoIdRaw)
      rowFatal.push({ row: sourceRow, field: 'videoIdRaw', code: 'MISSING_REQUIRED_VALUE', message: 'videoIdRaw is empty', rawValue: videoIdRaw })
    if (!videoTitle)
      rowFatal.push({ row: sourceRow, field: 'videoTitle', code: 'MISSING_REQUIRED_VALUE', message: 'videoTitle is empty', rawValue: videoTitle })
    if (!postedAtRaw)
      rowFatal.push({ row: sourceRow, field: 'postedAtRaw', code: 'MISSING_REQUIRED_VALUE', message: 'postedAtRaw is empty', rawValue: postedAtRaw })

    if (rowFatal.length > 0) {
      errors.push(...rowFatal)
      continue
    }

    // ── Duplicate detection ──────────────────────────────────────────────────
    if (videoIdFirstSeen.has(videoIdRaw)) {
      duplicateVideoIds.add(videoIdRaw)
      errors.push({
        row: sourceRow,
        field: 'videoIdRaw',
        code: 'DUPLICATE_VIDEO_ID',
        message: `videoIdRaw "${videoIdRaw}" first seen at row ${videoIdFirstSeen.get(videoIdRaw)}`,
        rawValue: videoIdRaw,
      })
    } else {
      videoIdFirstSeen.set(videoIdRaw, sourceRow)
    }

    // ── Optional raw values ──────────────────────────────────────────────────
    const durationRaw = getRaw(row, colMap, 'durationRaw')
    const gmvTotalRaw = getRaw(row, colMap, 'gmvTotalRaw')
    const gmvDirectRaw = getRaw(row, colMap, 'gmvDirectRaw')
    const viewsRaw = getRaw(row, colMap, 'viewsRaw')
    const unitsSoldRaw = getRaw(row, colMap, 'unitsSoldRaw')
    const ctrRaw = getRaw(row, colMap, 'ctrRaw')
    const watchFullRateRaw = getRaw(row, colMap, 'watchFullRateRaw')
    const newFollowersRaw = getRaw(row, colMap, 'newFollowersRaw')

    // ── Parse + validate ─────────────────────────────────────────────────────
    const postedAtParsed = parsePostedAt(postedAtRaw)

    const durationSec = durationRaw ? parseDurationToSec(durationRaw) : undefined
    pushIfInvalid(errors, Boolean(durationRaw) && durationSec === null, {
      row: sourceRow, field: 'durationRaw', code: 'INVALID_DURATION',
      message: `Cannot parse duration: "${durationRaw}"`, rawValue: durationRaw,
    })

    const gmvTotal = gmvTotalRaw ? parseCurrencyTHB(gmvTotalRaw) : undefined
    pushIfInvalid(errors, Boolean(gmvTotalRaw) && gmvTotal === null, {
      row: sourceRow, field: 'gmvTotalRaw', code: 'INVALID_CURRENCY',
      message: `Cannot parse GMV: "${gmvTotalRaw}"`, rawValue: gmvTotalRaw,
    })
    pushIfInvalid(errors, typeof gmvTotal === 'number' && gmvTotal < 0, {
      row: sourceRow, field: 'gmvTotal', code: 'NEGATIVE_VALUE',
      message: `GMV is negative: ${gmvTotal}`, rawValue: gmvTotalRaw,
    })

    const gmvDirect = gmvDirectRaw ? parseCurrencyTHB(gmvDirectRaw) : undefined
    pushIfInvalid(errors, Boolean(gmvDirectRaw) && gmvDirect === null, {
      row: sourceRow, field: 'gmvDirectRaw', code: 'INVALID_CURRENCY',
      message: `Cannot parse GMV Direct: "${gmvDirectRaw}"`, rawValue: gmvDirectRaw,
    })
    pushIfInvalid(errors, typeof gmvDirect === 'number' && gmvDirect < 0, {
      row: sourceRow, field: 'gmvDirect', code: 'NEGATIVE_VALUE',
      message: `GMV Direct is negative: ${gmvDirect}`, rawValue: gmvDirectRaw,
    })

    const views = viewsRaw ? parseInteger(viewsRaw) : undefined
    pushIfInvalid(errors, Boolean(viewsRaw) && views === null, {
      row: sourceRow, field: 'viewsRaw', code: 'INVALID_INTEGER',
      message: `Cannot parse views: "${viewsRaw}"`, rawValue: viewsRaw,
    })
    pushIfInvalid(errors, typeof views === 'number' && views < 0, {
      row: sourceRow, field: 'views', code: 'NEGATIVE_VALUE',
      message: `views is negative: ${views}`, rawValue: viewsRaw,
    })

    const unitsSold = unitsSoldRaw ? parseInteger(unitsSoldRaw) : undefined
    pushIfInvalid(errors, Boolean(unitsSoldRaw) && unitsSold === null, {
      row: sourceRow, field: 'unitsSoldRaw', code: 'INVALID_INTEGER',
      message: `Cannot parse unitsSold: "${unitsSoldRaw}"`, rawValue: unitsSoldRaw,
    })
    pushIfInvalid(errors, typeof unitsSold === 'number' && unitsSold < 0, {
      row: sourceRow, field: 'unitsSold', code: 'NEGATIVE_VALUE',
      message: `unitsSold is negative: ${unitsSold}`, rawValue: unitsSoldRaw,
    })

    const ctr = ctrRaw ? parsePercent(ctrRaw) : undefined
    pushIfInvalid(errors, Boolean(ctrRaw) && ctr === null, {
      row: sourceRow, field: 'ctrRaw', code: 'INVALID_PERCENT',
      message: `Cannot parse CTR: "${ctrRaw}"`, rawValue: ctrRaw,
    })
    pushIfInvalid(errors, typeof ctr === 'number' && (ctr < 0 || ctr > 1), {
      row: sourceRow, field: 'ctr', code: 'INVALID_PERCENT',
      message: `CTR out of [0,1] range: ${ctr}`, rawValue: ctrRaw,
    })

    const watchFullRate = watchFullRateRaw ? parsePercent(watchFullRateRaw) : undefined
    pushIfInvalid(errors, Boolean(watchFullRateRaw) && watchFullRate === null, {
      row: sourceRow, field: 'watchFullRateRaw', code: 'INVALID_PERCENT',
      message: `Cannot parse watch-full rate: "${watchFullRateRaw}"`, rawValue: watchFullRateRaw,
    })
    pushIfInvalid(errors, typeof watchFullRate === 'number' && (watchFullRate < 0 || watchFullRate > 1), {
      row: sourceRow, field: 'watchFullRate', code: 'INVALID_PERCENT',
      message: `watchFullRate out of [0,1] range: ${watchFullRate}`, rawValue: watchFullRateRaw,
    })

    const newFollowers = newFollowersRaw ? parseInteger(newFollowersRaw) : undefined
    pushIfInvalid(errors, Boolean(newFollowersRaw) && newFollowers === null, {
      row: sourceRow, field: 'newFollowersRaw', code: 'INVALID_INTEGER',
      message: `Cannot parse newFollowers: "${newFollowersRaw}"`, rawValue: newFollowersRaw,
    })
    pushIfInvalid(errors, typeof newFollowers === 'number' && newFollowers < 0, {
      row: sourceRow, field: 'newFollowers', code: 'NEGATIVE_VALUE',
      message: `newFollowers is negative: ${newFollowers}`, rawValue: newFollowersRaw,
    })

    // ── Build normalized row ─────────────────────────────────────────────────
    const normalized: NormalizedTikTokVideoStatRow = {
      videoIdRaw,
      videoTitle,
      postedAtRaw,
      ...(postedAtParsed.iso !== undefined && { postedAt: postedAtParsed.iso }),
      durationRaw,
      ...(typeof durationSec === 'number' && { durationSec }),
      ...(gmvTotalRaw && { gmvTotalRaw }),
      ...(typeof gmvTotal === 'number' && { gmvTotal }),
      ...(gmvDirectRaw && { gmvDirectRaw }),
      ...(typeof gmvDirect === 'number' && { gmvDirect }),
      ...(viewsRaw && { viewsRaw }),
      ...(typeof views === 'number' && { views }),
      ...(unitsSoldRaw && { unitsSoldRaw }),
      ...(typeof unitsSold === 'number' && { unitsSold }),
      ...(ctrRaw && { ctrRaw }),
      ...(typeof ctr === 'number' && { ctr }),
      ...(watchFullRateRaw && { watchFullRateRaw }),
      ...(typeof watchFullRate === 'number' && { watchFullRate }),
      ...(newFollowersRaw && { newFollowersRaw }),
      ...(typeof newFollowers === 'number' && { newFollowers }),
      source: 'tiktok_video_performance_export',
    }

    data.push(normalized)
  }

  const duplicateVideoIdsArr = Array.from(duplicateVideoIds)

  // ok = true when structural parse succeeded and at least some rows are available
  // Per-row validation errors (MISSING_REQUIRED_VALUE, INVALID_*, NEGATIVE_VALUE,
  // DUPLICATE_VIDEO_ID) do not make ok = false — they are surfaced in errors[].
  const fatalCodes = new Set<ParseErrorCode>([
    'SHEET_NOT_FOUND',
    'HEADER_ROW_NOT_FOUND',
    'MISSING_REQUIRED_COLUMN',
  ])
  const hasFatal = errors.some((e) => fatalCodes.has(e.code))

  return {
    ok: !hasFatal,
    data,
    errors: errors.length > 0 ? errors : undefined,
    meta: {
      sheetName,
      headerRowIndex,
      rowCount: data.length,
      detectedHeaders,
      missingRequiredFields,
      dateRangeRaw,
      duplicateVideoIds:
        duplicateVideoIdsArr.length > 0 ? duplicateVideoIdsArr : undefined,
    },
  }
}
