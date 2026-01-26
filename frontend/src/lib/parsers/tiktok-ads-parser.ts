/**
 * TikTok Ads Parser - Semantic Column Mapping
 *
 * Purpose: Parse TikTok Ads export files (Product/Live) with flexible column detection
 * - Supports Thai/English/Mixed column names
 * - Auto-detects report type (Product/Live)
 * - Smart sheet selection (pick sheet with most numeric data)
 * - Flexible validation (warn on missing optional metrics)
 *
 * Business Rules:
 * - Must have: Date, Campaign, Cost/Spend
 * - Optional but warn: GMV, Orders, ROAS
 * - Product vs Live: Auto-detect based on column presence
 */

import * as XLSX from 'xlsx'
import { parse, isValid, format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

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
  rowCount: number
  daysCount: number
  dailyBreakdown: DailyAdData[]
  detectedColumns: ColumnMapping
  missingOptionalColumns: string[]
}

export interface DailyAdData {
  date: string // YYYY-MM-DD
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
      'tarih', // Turkish
      'fecha', // Spanish
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
      'ต้นทุน',
      'chi phí', // Vietnamese
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
      'รายได้ขั้นต้น',
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
  // Remove BOM, newlines, special chars from Excel headers
  return text
    .replace(/^\uFEFF/, '') // BOM
    .replace(/[\n\r]/g, ' ') // newlines
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Score a header against a set of tokens
 */
function scoreColumnMatch(header: string, tokens: string[]): number {
  const normalized = normalizeHeaderText(header)

  for (const token of tokens) {
    const normalizedToken = normalizeText(token)

    // Exact match = highest score
    if (normalized === normalizedToken) return 100

    // Contains token = medium score
    if (normalized.includes(normalizedToken)) return 50

    // Token contains header = low score (e.g., "date" matches "update date")
    if (normalizedToken.includes(normalized) && normalized.length > 3) return 30
  }

  return 0
}

/**
 * Build semantic column mapping
 */
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

  // For each field, find best matching header
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

    // Only assign if score is reasonable (> 25)
    if (bestScore > 25 && bestHeader) {
      mapping[field as keyof ColumnMapping] = bestHeader
    }
  }

  return mapping
}

/**
 * Select best sheet from workbook
 * Strategy: Pick sheet with most numeric columns (likely data sheet)
 */
function selectBestSheet(workbook: XLSX.WorkBook): string | null {
  if (workbook.SheetNames.length === 0) return null
  if (workbook.SheetNames.length === 1) return workbook.SheetNames[0]

  let bestSheet: string | null = null
  let maxNumericColumns = 0

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[]

    if (rows.length === 0) continue

    // Count numeric columns (check first 10 rows)
    const sampleRows = rows.slice(0, Math.min(10, rows.length))
    const headers = Object.keys(rows[0])
    let numericCount = 0

    for (const header of headers) {
      const values = sampleRows.map((row) => row[header])
      const numericValues = values.filter(
        (v) => typeof v === 'number' || !isNaN(parseFloat(String(v || '')))
      )

      if (numericValues.length >= sampleRows.length * 0.5) {
        numericCount++
      }
    }

    if (numericCount > maxNumericColumns) {
      maxNumericColumns = numericCount
      bestSheet = sheetName
    }
  }

  return bestSheet || workbook.SheetNames[0]
}

/**
 * Parse date from various formats
 */
function parseDate(value: unknown): Date | null {
  if (!value) return null

  // Excel serial date
  if (typeof value === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30))
    return new Date(excelEpoch.getTime() + value * 86400000)
  }

  // String date - try multiple formats
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
    if (isValid(parsed)) {
      return parsed
    }
  }

  // Try native Date parsing as last resort
  const nativeDate = new Date(dateStr)
  if (isValid(nativeDate)) {
    return nativeDate
  }

  return null
}

/**
 * Parse numeric value (handles currency symbols, commas, etc.)
 */
function parseNumeric(value: unknown): number {
  if (typeof value === 'number') return value
  if (!value) return 0

  const str = String(value)
    .replace(/[^0-9.-]/g, '') // Remove all non-numeric except . and -
    .trim()

  const num = parseFloat(str)
  return isNaN(num) ? 0 : num
}

// =============================================
// Main Parser Function
// =============================================

export async function parseTikTokAdsFile(
  fileBuffer: ArrayBuffer,
  fileName: string,
  reportDate?: string // Optional report date (YYYY-MM-DD) - used if file has no date column
): Promise<TikTokAdsParseResult> {
  const warnings: string[] = []

  try {
    // 1. Validate file extension
    if (!fileName.toLowerCase().endsWith('.xlsx')) {
      return {
        success: false,
        error: 'ไฟล์ต้องเป็น .xlsx เท่านั้น (Excel format)',
      }
    }

    // 2. Parse Excel file
    const workbook = XLSX.read(fileBuffer, { type: 'array' })

    // 3. Select best sheet
    const sheetName = selectBestSheet(workbook)
    if (!sheetName) {
      return {
        success: false,
        error: 'ไม่พบ worksheet ที่มีข้อมูลใช้งานได้',
      }
    }

    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null }) as Record<string, unknown>[]

    if (rows.length === 0) {
      return {
        success: false,
        error: 'ไฟล์ว่างเปล่า ไม่มีข้อมูล',
      }
    }

    // 4. Build column mapping
    const headers = Object.keys(rows[0])
    const mapping = buildColumnMapping(headers)

    // 5. Validate required columns
    const missingRequired: string[] = []
    const hasDateColumn = !!mapping.date

    // Date is optional if reportDate is provided
    if (!hasDateColumn && !reportDate) {
      missingRequired.push('Date (วันที่) - หรือระบุ Report Date')
    }
    if (!mapping.campaign) missingRequired.push('Campaign (แคมเปญ)')
    if (!mapping.cost) missingRequired.push('Cost/Spend (ค่าใช้จ่าย)')

    if (missingRequired.length > 0) {
      return {
        success: false,
        error: `ไม่พบ columns ที่จำเป็น: ${missingRequired.join(', ')}\n\nColumns ที่มีในไฟล์: ${headers.join(', ')}`,
        debug: {
          selectedSheet: sheetName,
          headers,
          mapping,
          missingFields: missingRequired,
        },
      }
    }

    // Warn if no date column but reportDate provided
    if (!hasDateColumn && reportDate) {
      warnings.push(`⚠️ ไฟล์ไม่มี Date column - จะใช้ Report Date (${reportDate}) สำหรับทุก row`)
    }

    // 6. Check optional columns and warn
    const missingOptional: string[] = []
    if (!mapping.gmv) {
      missingOptional.push('GMV/Revenue')
      warnings.push('⚠️ ไม่พบ GMV/Revenue - จะใช้ค่า 0')
    }
    if (!mapping.orders) {
      missingOptional.push('Orders')
      warnings.push('⚠️ ไม่พบ Orders - จะใช้ค่า 0')
    }
    if (!mapping.roas) {
      warnings.push('ℹ️ ไม่พบ ROAS - จะคำนวณจาก GMV/Cost')
    }

    // 7. Detect report type
    // If has GMV + Orders → likely Product/Live performance report
    // If only Cost → might be awareness (should use Tiger import)
    let reportType: 'product' | 'live' | 'unknown' = 'unknown'
    if (mapping.gmv || mapping.orders) {
      // Heuristic: Check if campaign names contain "live" or "livestream"
      const sampleCampaigns = rows
        .slice(0, 10)
        .map((row) => String(row[mapping.campaign!] || '').toLowerCase())

      const hasLiveKeywords = sampleCampaigns.some(
        (name) => name.includes('live') || name.includes('stream')
      )

      reportType = hasLiveKeywords ? 'live' : 'product'
    } else {
      warnings.push(
        '⚠️ ไฟล์นี้ไม่มี sales metrics (GMV/Orders) - ถ้าเป็น Awareness Ads ควรใช้ Tiger Import แทน'
      )
    }

    // 8. Parse daily data
    const dailyData: DailyAdData[] = []
    let totalSpend = 0
    let totalGMV = 0
    let totalOrders = 0
    let currency = 'THB' // Default
    const seenDates = new Set<string>()

    for (const row of rows) {
      // Parse date - use reportDate if no date column in file
      let dateFormatted: string
      if (hasDateColumn && mapping.date) {
        const dateValue = row[mapping.date]
        const adDate = parseDate(dateValue)

        if (!adDate || !isValid(adDate)) {
          continue // Skip invalid dates
        }

        dateFormatted = format(toZonedTime(adDate, 'Asia/Bangkok'), 'yyyy-MM-dd')
      } else if (reportDate) {
        // Use provided reportDate for all rows
        dateFormatted = reportDate
      } else {
        continue // No date available, skip
      }

      seenDates.add(dateFormatted)

      // Parse campaign name
      const campaignName = row[mapping.campaign!]
      if (!campaignName) continue

      // Parse numbers
      const spend = parseNumeric(row[mapping.cost!])
      const gmv = mapping.gmv ? parseNumeric(row[mapping.gmv]) : 0
      const orders = mapping.orders ? parseNumeric(row[mapping.orders]) : 0
      let roas = mapping.roas ? parseNumeric(row[mapping.roas]) : 0

      // Calculate ROAS if not provided
      if (roas === 0 && spend > 0) {
        roas = gmv / spend
      }

      dailyData.push({
        date: dateFormatted,
        campaignName: String(campaignName),
        spend,
        gmv,
        orders: Math.round(orders),
        roas: Math.round(roas * 100) / 100,
      })

      totalSpend += spend
      totalGMV += gmv
      totalOrders += orders

      // Extract currency from first row
      if (dailyData.length === 1 && mapping.currency && row[mapping.currency]) {
        currency = String(row[mapping.currency]).toUpperCase()
      }
    }

    if (dailyData.length === 0) {
      return {
        success: false,
        error: 'ไม่พบข้อมูลที่ valid ในไฟล์ (ตรวจสอบ date, campaign, cost columns)',
      }
    }

    // 9. Calculate summary
    const avgROAS = totalSpend > 0 ? totalGMV / totalSpend : 0
    const dates = Array.from(seenDates).sort()
    const reportDateRange =
      dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'Unknown'

    // 10. Build preview
    const preview: TikTokAdsPreview = {
      fileName,
      reportType,
      reportDateRange,
      totalSpend: Math.round(totalSpend * 100) / 100,
      totalGMV: Math.round(totalGMV * 100) / 100,
      totalOrders: Math.round(totalOrders),
      avgROAS: Math.round(avgROAS * 100) / 100,
      currency,
      rowCount: rows.length,
      daysCount: seenDates.size,
      dailyBreakdown: dailyData,
      detectedColumns: mapping,
      missingOptionalColumns: missingOptional,
    }

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
