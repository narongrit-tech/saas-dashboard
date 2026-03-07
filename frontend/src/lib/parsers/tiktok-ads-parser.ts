/**
 * TikTok Ads Parser - Semantic Column Mapping
 *
 * Supports both:
 * - Campaign-level daily reports (1 row per campaign per day)
 * - Creative-level reports (many rows per campaign, aggregated here by (date, campaignName))
 *
 * Business Rules:
 * - Must have: Campaign, Cost/Spend  (Date optional if reportDate supplied)
 * - Optional but warn: GMV, Orders, ROAS
 * - Aggregates by (date, campaignName) so upsert into ad_daily_performance is correct
 *
 * Performance:
 * - XLSX.read uses minimal parse options (no formulas, styles, HTML)
 * - selectBestSheet uses sheet !ref range (no sheet_to_json scan)
 * - Guarded timing logs: set DEBUG_ADS_IMPORT=1 (Node) or window.__DEBUG_ADS=1 (browser)
 */

import * as XLSX from 'xlsx'
import { parse, isValid, format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

// ─── Debug timing helper ──────────────────────────────────────────────────────
function dbg(msg: string) {
  const enabled =
    (typeof process !== 'undefined' && process.env['DEBUG_ADS_IMPORT'] === '1') ||
    (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>)['__DEBUG_ADS'] === true)
  if (enabled) console.log(`[ads-parser] ${msg}`)
}

// =============================================
// Types
// =============================================

export interface TikTokAdsParseResult {
  success: boolean
  error?: string
  warnings?: string[]
  preview?: TikTokAdsPreview
  debug?: {
    selectedSheet: string | null
    headers: string[]
    mapping: ColumnMapping
    missingFields: string[]
  }
}

export interface TikTokAdsPreview {
  fileName: string
  reportType: 'product' | 'live' | 'unknown'
  reportDateRange: string
  totalSpend: number
  totalGMV: number
  totalOrders: number
  avgROAS: number
  currency: string
  rowCount: number      // raw source rows before aggregation
  daysCount: number
  dailyBreakdown: DailyAdData[]   // aggregated by (date, campaignName)
  detectedColumns: ColumnMapping
  missingOptionalColumns: string[]
}

export interface DailyAdData {
  date: string       // YYYY-MM-DD
  campaignName: string
  spend: number
  gmv: number
  orders: number
  roas: number
}

export interface ColumnMapping {
  date: string | null
  campaign: string | null
  cost: string | null
  gmv: string | null
  orders: string | null
  roas: string | null
  currency: string | null
}

// =============================================
// Semantic Column Tokens (Thai + English)
// =============================================

const COLUMN_TOKENS = {
  date: {
    tokens: [
      'date',
      'วันที่',
      'วันเริ่มต้น',
      'วันเริ่ม',
      'เวลาเริ่มต้น',
      'เวลาเริ่ม',
      '日期',
      'tarih',
      'fecha',
      'start date',
      'start time',
    ],
    priority: 10,
  },
  campaign: {
    tokens: [
      'campaign',
      'แคมเปญ',
      'ชื่อแคมเปญ',
      'ชื่อแคมเปญโฆษณา',
      'ชื่อ live',
      'ชื่อไลฟ์',
      'kampanya',
      'campaña',
      '活动',
      'ad name',
      'creative',
      'campaign name',
    ],
    priority: 10,
  },
  cost: {
    tokens: [
      'cost',
      'spend',
      'ค่าใช้จ่าย',
      'ต้นทุน',          // Thai: cost/expense (appears in TikTok creative reports)
      'chi phí',
      '费用',
      'expense',
      'ad spend',
      'total cost',
    ],
    priority: 10,
  },
  gmv: {
    tokens: [
      'gmv',
      'revenue',
      'รายได้',
      'รายได้ขั้นต้น',   // Thai: gross revenue (TikTok creative report)
      'มูลค่ายอดขาย',
      'ยอดขาย',
      'รายได้รวม',
      'doanh thu',
      '收入',
      'conversion value',
      'total value',
      'total revenue',
      'gross revenue',
    ],
    priority: 5,
  },
  orders: {
    tokens: [
      'order',
      'orders',
      'คำสั่งซื้อ',
      'คำสั่งซื้อ sku',   // TikTok: "คำสั่งซื้อ SKU" (SKU orders)
      'ยอดการซื้อ',
      'จำนวนคำสั่งซื้อ',
      'ออเดอร์',
      'ยอดออเดอร์',
      'đơn hàng',
      '订单',
      'conversion',
      'conversions',
      'purchase',
      'purchases',
      'sale',
      'sales',
    ],
    priority: 5,
  },
  roas: {
    tokens: [
      'roas',
      'roi',
      'return on ad spend',
      'ผลตอบแทน',
    ],
    priority: 3,
  },
  currency: {
    tokens: [
      'currency',
      'สกุลเงิน',
      'tiền tệ',
      '货币',
    ],
    priority: 1,
  },
}

// =============================================
// Utility Functions
// =============================================

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[()[\]:]/g, '')
}

function normalizeHeaderText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')  // BOM
    .replace(/[\n\r]/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

function scoreColumnMatch(header: string, tokens: string[]): number {
  const normalized = normalizeHeaderText(header)

  for (const token of tokens) {
    const normalizedToken = normalizeText(token)

    if (normalized === normalizedToken) return 100
    if (normalized.includes(normalizedToken)) return 50
    if (normalizedToken.includes(normalized) && normalized.length > 3) return 30
  }

  return 0
}

function buildColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    date: null,
    campaign: null,
    cost: null,
    gmv: null,
    orders: null,
    roas: null,
    currency: null,
  }

  for (const [field, config] of Object.entries(COLUMN_TOKENS)) {
    let bestScore = 0
    let bestHeader: string | null = null

    for (const header of headers) {
      const score = scoreColumnMatch(header, config.tokens)
      if (score > bestScore) {
        bestScore = score
        bestHeader = header
      }
    }

    if (bestScore > 25 && bestHeader) {
      mapping[field as keyof ColumnMapping] = bestHeader
    }
  }

  return mapping
}

/**
 * Select best sheet by row count (uses !ref range — no sheet_to_json scan)
 * Falls back to first sheet if all sheets have empty refs.
 */
function selectBestSheet(workbook: XLSX.WorkBook): string | null {
  if (workbook.SheetNames.length === 0) return null
  if (workbook.SheetNames.length === 1) return workbook.SheetNames[0]

  let bestSheet = workbook.SheetNames[0]
  let maxRows = 0

  for (const name of workbook.SheetNames) {
    const ref = workbook.Sheets[name]?.['!ref']
    if (!ref) continue
    const range = XLSX.utils.decode_range(ref)
    const rowCount = range.e.r - range.s.r + 1
    if (rowCount > maxRows) {
      maxRows = rowCount
      bestSheet = name
    }
  }

  return bestSheet
}

/**
 * Parse date from various formats to YYYY-MM-DD (Bangkok timezone)
 */
function parseDate(value: unknown): Date | null {
  if (!value) return null

  // Excel serial date
  if (typeof value === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30))
    return new Date(excelEpoch.getTime() + value * 86400000)
  }

  const dateStr = String(value).trim()
  const formats = [
    'yyyy-MM-dd',
    'MM/dd/yyyy',
    'dd/MM/yyyy',
    'yyyy/MM/dd',
    'dd-MM-yyyy',
    'yyyy.MM.dd',
    'dd.MM.yyyy',
  ]

  for (const fmt of formats) {
    const parsed = parse(dateStr, fmt, new Date())
    if (isValid(parsed)) return parsed
  }

  const nativeDate = new Date(dateStr)
  if (isValid(nativeDate)) return nativeDate

  return null
}

/**
 * Parse numeric value — handles string numbers, currency symbols, commas
 * Examples: "198.430", "1,234.56", "฿1234", null → 0
 */
function parseNumeric(value: unknown): number {
  if (typeof value === 'number') return value
  if (!value) return 0

  const str = String(value)
    .replace(/[^0-9.-]/g, '')
    .trim()

  const num = parseFloat(str)
  return isNaN(num) ? 0 : num
}

// =============================================
// Main Parser Function
// =============================================

export async function parseTikTokAdsFile(
  fileBuffer: Uint8Array,
  fileName: string,
  reportDate?: string   // YYYY-MM-DD — used for all rows if file has no date column
): Promise<TikTokAdsParseResult> {
  const warnings: string[] = []

  try {
    if (!fileName.toLowerCase().endsWith('.xlsx')) {
      return { success: false, error: 'ไฟล์ต้องเป็น .xlsx เท่านั้น (Excel format)' }
    }

    // ── 1. Parse workbook (minimal options for speed) ─────────────────────
    let t0 = Date.now()
    const workbook = XLSX.read(fileBuffer, {
      type: 'array',
      cellDates: false,     // keep dates as serial numbers / strings (we parse manually)
      cellFormula: false,   // skip formula parsing
      cellStyles: false,    // skip style parsing
      cellHTML: false,      // skip HTML generation
      cellNF: false,        // skip number format parsing
      sheetStubs: false,    // skip empty cell stubs
    })
    dbg(`XLSX.read: ${Date.now() - t0}ms`)

    // ── 2. Select best sheet (by row count, no re-parse) ──────────────────
    const sheetName = selectBestSheet(workbook)
    if (!sheetName) {
      return { success: false, error: 'ไม่พบ worksheet ที่มีข้อมูลใช้งานได้' }
    }

    // ── 3. Convert sheet to rows ───────────────────────────────────────────
    t0 = Date.now()
    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      defval: null,
      raw: true,            // raw cell values (faster, no date conversion)
    }) as Record<string, unknown>[]
    dbg(`sheet_to_json (${rows.length} rows): ${Date.now() - t0}ms`)

    if (rows.length === 0) {
      return { success: false, error: 'ไฟล์ว่างเปล่า ไม่มีข้อมูล' }
    }

    // ── 4. Column mapping ─────────────────────────────────────────────────
    const headers = Object.keys(rows[0])
    const mapping = buildColumnMapping(headers)

    const missingRequired: string[] = []
    const hasDateColumn = !!mapping.date

    if (!hasDateColumn && !reportDate) {
      missingRequired.push('Date (วันที่) - หรือระบุ Report Date')
    }
    if (!mapping.campaign) missingRequired.push('Campaign (แคมเปญ)')
    if (!mapping.cost)     missingRequired.push('Cost/Spend (ค่าใช้จ่าย / ต้นทุน)')

    if (missingRequired.length > 0) {
      return {
        success: false,
        error: `ไม่พบ columns ที่จำเป็น: ${missingRequired.join(', ')}\n\nColumns ที่มีในไฟล์: ${headers.join(', ')}`,
        debug: { selectedSheet: sheetName, headers, mapping, missingFields: missingRequired },
      }
    }

    if (!hasDateColumn && reportDate) {
      warnings.push(`⚠️ ไฟล์ไม่มี Date column — ใช้ Report Date (${reportDate}) สำหรับทุก row`)
    }

    const missingOptional: string[] = []
    if (!mapping.gmv) {
      missingOptional.push('GMV/Revenue')
      warnings.push('⚠️ ไม่พบ GMV/Revenue — จะใช้ค่า 0')
    }
    if (!mapping.orders) {
      missingOptional.push('Orders')
      warnings.push('⚠️ ไม่พบ Orders — จะใช้ค่า 0')
    }
    if (!mapping.roas) {
      warnings.push('ℹ️ ไม่พบ ROAS — จะคำนวณจาก GMV/Cost')
    }

    // ── 5. Auto-detect report type ────────────────────────────────────────
    let reportType: 'product' | 'live' | 'unknown' = 'unknown'
    if (mapping.gmv || mapping.orders) {
      const sampleCampaigns = rows
        .slice(0, 10)
        .map((row) => String(row[mapping.campaign!] || '').toLowerCase())
      const hasLiveKeywords = sampleCampaigns.some(
        (name) => name.includes('live') || name.includes('stream')
      )
      reportType = hasLiveKeywords ? 'live' : 'product'
    } else {
      warnings.push('⚠️ ไฟล์ไม่มี sales metrics (GMV/Orders) — ถ้าเป็น Awareness Ads ควรใช้ Tiger Import แทน')
    }

    // ── 6. Parse & aggregate rows by (date, campaignName) ─────────────────
    //
    // IMPORTANT: Files may be creative-level (many rows per campaign × creative × product).
    // The ad_daily_performance table has a unique constraint on (marketplace, ad_date,
    // campaign_type, campaign_name, created_by). If we upsert without aggregating, later
    // rows would overwrite earlier rows for the same campaign → wrong totals.
    //
    // Fix: aggregate all rows for the same (date, campaignName) by summing spend/gmv/orders.
    //
    t0 = Date.now()
    const campaignAggregates = new Map<string, {
      date: string
      campaignName: string
      spend: number
      gmv: number
      orders: number
      roasSum: number   // only used if explicit roas column found
      roasCount: number
    }>()

    let currency = 'THB'
    const seenDates = new Set<string>()
    let rawRowCount = 0
    let dateResolvedCount = 0
    let droppedInvalidDateCount = 0
    let droppedMissingCampaignCount = 0
    let droppedZeroActivityCount = 0

    for (const row of rows) {
      // Resolve date
      let dateFormatted: string
      if (hasDateColumn && mapping.date) {
        const adDate = parseDate(row[mapping.date])
        if (!adDate || !isValid(adDate)) {
          droppedInvalidDateCount++
          continue
        }
        dateFormatted = format(toZonedTime(adDate, 'Asia/Bangkok'), 'yyyy-MM-dd')
      } else if (reportDate) {
        dateFormatted = reportDate
      } else {
        droppedInvalidDateCount++
        continue
      }
      dateResolvedCount++

      // Resolve campaign
      const rawCampaign = row[mapping.campaign!]
      if (!rawCampaign) {
        droppedMissingCampaignCount++
        continue
      }
      const campaignName = String(rawCampaign)

      // Parse numbers
      const spend  = parseNumeric(row[mapping.cost!])
      const gmv    = mapping.gmv    ? parseNumeric(row[mapping.gmv])    : 0
      const orders = mapping.orders ? parseNumeric(row[mapping.orders]) : 0
      const roas   = mapping.roas   ? parseNumeric(row[mapping.roas])   : 0

      // Skip rows with no activity (spend=0, gmv=0, orders=0)
      // This filters out inactive creatives/campaigns that appear in creative-level
      // reports but had no delivery on this day — keeps DB clean and totals accurate.
      if (spend === 0 && gmv === 0 && orders === 0) {
        droppedZeroActivityCount++
        continue
      }

      // Aggregate
      const key = `${dateFormatted}\x00${campaignName}`
      const existing = campaignAggregates.get(key)
      if (existing) {
        existing.spend  += spend
        existing.gmv    += gmv
        existing.orders += orders
        if (mapping.roas && roas > 0) {
          existing.roasSum   += roas
          existing.roasCount += 1
        }
      } else {
        seenDates.add(dateFormatted)
        campaignAggregates.set(key, {
          date: dateFormatted,
          campaignName,
          spend,
          gmv,
          orders,
          roasSum: roas,
          roasCount: roas > 0 ? 1 : 0,
        })
      }

      // Extract currency once
      if (rawRowCount === 0 && mapping.currency && row[mapping.currency]) {
        currency = String(row[mapping.currency]).toUpperCase()
      }

      rawRowCount++
    }
    dbg(`row aggregation (${rawRowCount} raw → ${campaignAggregates.size} aggregated): ${Date.now() - t0}ms`)
    console.log('[AdsParser] row-flow', {
      fileName,
      reportDateInput: reportDate ?? null,
      sourceRows: rows.length,
      dateResolvedCount,
      droppedInvalidDateCount,
      droppedMissingCampaignCount,
      droppedZeroActivityCount,
      rowsAfterValidation: rawRowCount,
      aggregatedRows: campaignAggregates.size,
    })

    if (campaignAggregates.size === 0) {
      return {
        success: false,
        error: 'ไม่พบข้อมูลที่ valid ในไฟล์ (ตรวจสอบ campaign, cost columns)',
      }
    }

    // ── 7. Build DailyAdData[] from aggregates ─────────────────────────────
    let totalSpend = 0, totalGMV = 0, totalOrders = 0

    const dailyData: DailyAdData[] = Array.from(campaignAggregates.values()).map((entry) => {
      totalSpend  += entry.spend
      totalGMV    += entry.gmv
      totalOrders += entry.orders

      // ROAS: use average of explicit values if available, otherwise calculate
      let roas: number
      if (mapping.roas && entry.roasCount > 0) {
        roas = entry.roasSum / entry.roasCount
      } else {
        roas = entry.spend > 0 ? entry.gmv / entry.spend : 0
      }

      return {
        date: entry.date,
        campaignName: entry.campaignName,
        spend:  Math.round(entry.spend  * 100) / 100,
        gmv:    Math.round(entry.gmv    * 100) / 100,
        orders: Math.round(entry.orders),
        roas:   Math.round(roas * 100) / 100,
      }
    })

    const avgROAS = totalSpend > 0 ? totalGMV / totalSpend : 0
    const dates = Array.from(seenDates).sort()
    const reportDateRange = dates.length > 0
      ? `${dates[0]} to ${dates[dates.length - 1]}`
      : 'Unknown'

    const preview: TikTokAdsPreview = {
      fileName,
      reportType,
      reportDateRange,
      totalSpend:  Math.round(totalSpend  * 100) / 100,
      totalGMV:    Math.round(totalGMV    * 100) / 100,
      totalOrders: Math.round(totalOrders),
      avgROAS:     Math.round(avgROAS * 100) / 100,
      currency,
      rowCount: rawRowCount,           // original source row count
      daysCount: seenDates.size,
      dailyBreakdown: dailyData,       // aggregated (much fewer entries)
      detectedColumns: mapping,
      missingOptionalColumns: missingOptional,
    }

    dbg(`done — ${rawRowCount} raw rows → ${dailyData.length} aggregated entries`)
    return {
      success: true,
      warnings: warnings.length > 0 ? warnings : undefined,
      preview,
    }
  } catch (error) {
    console.error('Error parsing TikTok Ads file:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการอ่านไฟล์',
    }
  }
}
