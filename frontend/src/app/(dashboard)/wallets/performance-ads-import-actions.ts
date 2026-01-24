'use server'

/**
 * Performance Ads Import - Server Actions
 *
 * Purpose: Import performance ads (Product/Live) with sales metrics
 * - Creates ad_daily_performance records (daily breakdown)
 * - Creates wallet_ledger SPEND entries (daily)
 * - Affects Accrual P&L (Advertising Cost)
 *
 * Business Rules:
 * - Must have sales metrics (GMV/Orders/ROAS)
 * - Daily breakdown (one record per day per campaign)
 * - Product ads: typically daily imports
 * - Live ads: typically weekly imports (multiple days)
 * - Independent imports (no coupling between Product/Live)
 */

import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'
import crypto from 'crypto'
import { formatBangkok } from '@/lib/bangkok-time'
import { parse, isValid, format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

interface ActionResult {
  success: boolean
  error?: string
  data?: unknown
}

interface PerformanceAdsPreview {
  fileName: string
  campaignType: 'product' | 'live'
  reportDateRange: string
  totalSpend: number
  totalGMV: number
  totalOrders: number
  avgROAS: number
  currency: string
  rowCount: number
  daysCount: number
  dailyBreakdown: DailyAdData[]
}

interface DailyAdData {
  date: string // YYYY-MM-DD
  campaignName: string
  spend: number
  gmv: number
  orders: number
  roas: number
}

/**
 * Step 1: Parse and validate Performance Ads file
 * Returns preview data for user confirmation
 */
export async function parsePerformanceAdsFile(
  fileBuffer: ArrayBuffer,
  fileName: string,
  campaignType: 'product' | 'live'
): Promise<ActionResult & { preview?: PerformanceAdsPreview }> {
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
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) {
      return {
        success: false,
        error: 'ไม่พบ worksheet ในไฟล์',
      }
    }

    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null }) as Record<
      string,
      unknown
    >[]

    if (rows.length === 0) {
      return {
        success: false,
        error: 'ไฟล์ว่างเปล่า ไม่มีข้อมูล',
      }
    }

    // 3. Template detection - STRICT validation for performance ads
    const firstRow = rows[0]
    const headers = Object.keys(firstRow).map((h) => h.toLowerCase().trim())

    // Must have these columns (performance report with sales metrics)
    const requiredColumns = ['date', 'campaign', 'cost', 'gmv', 'order']
    const hasRequiredColumns = requiredColumns.every((col) =>
      headers.some((h) => h.includes(col))
    )

    if (!hasRequiredColumns) {
      return {
        success: false,
        error:
          'Template ไม่ถูกต้อง - Performance Ads ต้องมี: Date, Campaign, Cost, GMV, Orders',
      }
    }

    // Must have at least one sales metric indicator
    const salesMetrics = ['gmv', 'order', 'roas', 'conversion']
    const hasSalesMetrics = headers.some((h) =>
      salesMetrics.some((metric) => h.includes(metric))
    )

    if (!hasSalesMetrics) {
      return {
        success: false,
        error:
          '❌ ไฟล์นี้ไม่มี sales metrics (GMV/Orders/ROAS) - ถ้าเป็น Awareness Ads ให้ใช้ Tiger Import',
      }
    }

    // 4. Extract column mappings
    const dateKey = headers.find((h) => h.includes('date')) || 'date'
    const campaignKey = headers.find((h) => h.includes('campaign')) || 'campaign'
    const costKey = headers.find((h) => h.includes('cost') || h.includes('spend')) || 'cost'
    const gmvKey =
      headers.find((h) => h.includes('gmv') || h.includes('revenue')) || 'gmv'
    const orderKey =
      headers.find((h) => h.includes('order') || h.includes('conversion')) || 'orders'
    const roasKey = headers.find((h) => h.includes('roas') || h.includes('roi')) || 'roas'
    const currencyKey = headers.find((h) => h.includes('currency')) || 'currency'

    // 5. Parse daily data
    const dailyData: DailyAdData[] = []
    let totalSpend = 0
    let totalGMV = 0
    let totalOrders = 0
    let currency = 'THB' // Default

    const seenDates = new Set<string>()

    for (const row of rows) {
      // Parse date
      const dateValue = row[dateKey]
      if (!dateValue) continue

      let adDate: Date | null = null

      // Try parsing as Excel serial date
      if (typeof dateValue === 'number') {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30))
        adDate = new Date(excelEpoch.getTime() + dateValue * 86400000)
      } else {
        // Try parsing as string
        const dateStr = String(dateValue)
        // Try common formats
        const formats = ['yyyy-MM-dd', 'MM/dd/yyyy', 'dd/MM/yyyy', 'yyyy/MM/dd']
        for (const fmt of formats) {
          const parsed = parse(dateStr, fmt, new Date())
          if (isValid(parsed)) {
            adDate = parsed
            break
          }
        }
      }

      if (!adDate || !isValid(adDate)) {
        continue // Skip invalid dates
      }

      const dateFormatted = format(toZonedTime(adDate, 'Asia/Bangkok'), 'yyyy-MM-dd')
      seenDates.add(dateFormatted)

      // Parse campaign name
      const campaignName = row[campaignKey]
      if (!campaignName) continue

      // Parse numbers
      const spend = parseFloat(String(row[costKey] || 0).replace(/[^0-9.-]/g, ''))
      const gmv = parseFloat(String(row[gmvKey] || 0).replace(/[^0-9.-]/g, ''))
      const orders = parseFloat(String(row[orderKey] || 0).replace(/[^0-9.-]/g, ''))
      let roas = parseFloat(String(row[roasKey] || 0).replace(/[^0-9.-]/g, ''))

      if (isNaN(spend) || isNaN(gmv) || isNaN(orders)) {
        continue // Skip invalid rows
      }

      // Calculate ROAS if not provided
      if (isNaN(roas) || roas === 0) {
        roas = spend > 0 ? gmv / spend : 0
      }

      dailyData.push({
        date: dateFormatted,
        campaignName: String(campaignName),
        spend,
        gmv,
        orders: Math.round(orders), // Orders should be integer
        roas: Math.round(roas * 100) / 100,
      })

      totalSpend += spend
      totalGMV += gmv
      totalOrders += orders

      // Extract currency from first row
      if (dailyData.length === 1 && row[currencyKey]) {
        currency = String(row[currencyKey]).toUpperCase()
      }
    }

    if (dailyData.length === 0) {
      return {
        success: false,
        error: 'ไม่พบข้อมูลที่ valid ในไฟล์',
      }
    }

    // 6. Calculate summary
    const avgROAS = totalSpend > 0 ? totalGMV / totalSpend : 0
    const dates = Array.from(seenDates).sort()
    const reportDateRange =
      dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'Unknown'

    // 7. Build preview
    const preview: PerformanceAdsPreview = {
      fileName,
      campaignType,
      reportDateRange,
      totalSpend: Math.round(totalSpend * 100) / 100,
      totalGMV: Math.round(totalGMV * 100) / 100,
      totalOrders: Math.round(totalOrders),
      avgROAS: Math.round(avgROAS * 100) / 100,
      currency,
      rowCount: rows.length,
      daysCount: seenDates.size,
      dailyBreakdown: dailyData,
    }

    return {
      success: true,
      preview,
    }
  } catch (error) {
    console.error('Error parsing Performance Ads file:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการอ่านไฟล์',
    }
  }
}

/**
 * Step 2: Import Performance Ads into system
 * Creates ad_daily_performance records + wallet_ledger SPEND entries
 */
export async function importPerformanceAdsToSystem(
  fileBuffer: ArrayBuffer,
  fileName: string,
  campaignType: 'product' | 'live',
  adsWalletId: string
): Promise<ActionResult> {
  try {
    // 1. Authenticate user
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // 2. Verify wallet exists and is ADS type
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id, name, wallet_type')
      .eq('id', adsWalletId)
      .single()

    if (walletError || !wallet) {
      return { success: false, error: 'ไม่พบ wallet ที่เลือก' }
    }

    if (wallet.wallet_type !== 'ADS') {
      return {
        success: false,
        error: 'Performance Ads import ต้องใช้กับ ADS Wallet เท่านั้น',
      }
    }

    // 3. Parse file again (with validation)
    const parseResult = await parsePerformanceAdsFile(fileBuffer, fileName, campaignType)
    if (!parseResult.success || !parseResult.preview) {
      return {
        success: false,
        error: parseResult.error || 'ไม่สามารถอ่านไฟล์ได้',
      }
    }

    const { preview } = parseResult

    // 4. Check for duplicate file (using file hash)
    const fileHash = crypto.createHash('sha256').update(Buffer.from(fileBuffer)).digest('hex')

    const { data: existingBatch } = await supabase
      .from('import_batches')
      .select('id, file_name, created_at')
      .eq('file_hash', fileHash)
      .eq('report_type', `tiktok_ads_${campaignType}`)
      .single()

    if (existingBatch) {
      return {
        success: false,
        error: `ไฟล์นี้ถูก import ไปแล้ว - "${existingBatch.file_name}" เมื่อ ${formatBangkok(
          new Date(existingBatch.created_at),
          'yyyy-MM-dd HH:mm'
        )}`,
      }
    }

    // 5. Create import_batch record
    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        marketplace: 'tiktok',
        report_type: `tiktok_ads_${campaignType}`,
        period: preview.reportDateRange,
        file_name: fileName,
        file_hash: fileHash,
        row_count: preview.rowCount,
        inserted_count: 0, // Will update later
        status: 'processing',
        created_by: user.id,
      })
      .select()
      .single()

    if (batchError || !batch) {
      console.error('Error creating import batch:', batchError)
      return { success: false, error: 'ไม่สามารถสร้าง import batch ได้' }
    }

    // 6. Insert ad_daily_performance records (upsert by unique constraint)
    let perfInsertedCount = 0

    for (const dailyData of preview.dailyBreakdown) {
      const { error: perfError } = await supabase.from('ad_daily_performance').upsert(
        {
          marketplace: 'tiktok',
          ad_date: dailyData.date,
          campaign_type: campaignType,
          campaign_name: dailyData.campaignName,
          spend: dailyData.spend,
          orders: dailyData.orders,
          revenue: dailyData.gmv,
          roi: dailyData.roas,
          source: 'imported',
          import_batch_id: batch.id,
          created_by: user.id,
        },
        {
          onConflict: 'marketplace,ad_date,campaign_type,campaign_name,created_by',
        }
      )

      if (perfError) {
        console.error('Error inserting ad_daily_performance:', perfError)
        // Continue with other records
      } else {
        perfInsertedCount++
      }
    }

    // 7. Aggregate spend per day for wallet entries
    const dailySpendMap = new Map<string, number>()
    for (const data of preview.dailyBreakdown) {
      const current = dailySpendMap.get(data.date) || 0
      dailySpendMap.set(data.date, current + data.spend)
    }

    // 8. Insert wallet_ledger SPEND entries (one per day)
    let walletInsertedCount = 0

    for (const [date, totalSpend] of Array.from(dailySpendMap.entries())) {
      const note = `${campaignType === 'product' ? 'Product' : 'Live'} Ads Spend - ${date}`

      const { error: ledgerError } = await supabase.from('wallet_ledger').insert({
        wallet_id: adsWalletId,
        date,
        entry_type: 'SPEND',
        direction: 'OUT',
        amount: Math.round(totalSpend * 100) / 100,
        source: 'IMPORTED',
        import_batch_id: batch.id,
        reference_id: fileName,
        note,
        created_by: user.id,
      })

      if (ledgerError) {
        console.error('Error creating wallet ledger entry:', ledgerError)
        // Continue with other dates
      } else {
        walletInsertedCount++
      }
    }

    // 9. Update batch status to success
    await supabase
      .from('import_batches')
      .update({
        status: 'success',
        inserted_count: perfInsertedCount,
        notes: `Performance: ${perfInsertedCount} records, Wallet: ${walletInsertedCount} entries, Total: ${preview.totalSpend} ${preview.currency}`,
      })
      .eq('id', batch.id)

    return {
      success: true,
      data: {
        batchId: batch.id,
        performanceRecords: perfInsertedCount,
        walletEntries: walletInsertedCount,
        totalSpend: preview.totalSpend,
        totalGMV: preview.totalGMV,
        totalOrders: preview.totalOrders,
        avgROAS: preview.avgROAS,
        daysCount: preview.daysCount,
      },
    }
  } catch (error) {
    console.error('Unexpected error in importPerformanceAdsToSystem:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}
