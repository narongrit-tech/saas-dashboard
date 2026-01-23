'use server'

/**
 * Tiger Awareness Ads Import - Server Actions
 *
 * Purpose: Import monthly awareness ads (Tiger reports) into TikTok Ads Wallet
 * - Monthly aggregation only (1 wallet entry per file)
 * - NO ad_daily_performance entries (no sales metrics)
 * - Wallet SPEND entry ONLY (cash outflow tracking)
 * - Does NOT affect Accrual P&L
 *
 * Business Rules:
 * - Tiger reports = Brand Awareness campaigns (Reach/VDO View)
 * - NO commerce metrics (GMV/Orders/ROAS)
 * - Purpose: Track real cash spend for cashflow view
 * - Must NOT appear in performance analytics or P&L
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

interface TigerImportPreview {
  fileName: string
  reportDateRange: string
  totalSpend: number
  currency: string
  rowCount: number
  campaignCount: number
  postingDate: string // YYYY-MM-DD (end date of report range)
}

interface TigerCampaignRow {
  campaignName: string
  cost: number
}

/**
 * Step 1: Parse and validate Tiger report file
 * Returns preview data for user confirmation
 */
export async function parseTigerReportFile(
  fileBuffer: ArrayBuffer,
  fileName: string
): Promise<ActionResult & { preview?: TigerImportPreview }> {
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

    // 3. Template detection - STRICT validation
    const firstRow = rows[0]
    const headers = Object.keys(firstRow).map((h) => h.toLowerCase().trim())

    // Must have these columns (awareness report)
    const hasRequiredColumns = ['campaign', 'cost'].every((col) =>
      headers.some((h) => h.includes(col.toLowerCase()))
    )

    if (!hasRequiredColumns) {
      return {
        success: false,
        error: 'Template ไม่ถูกต้อง - ต้องมี columns: Campaign, Cost',
      }
    }

    // Must NOT have commerce/sales columns (this is awareness-only)
    const commerceKeywords = ['gmv', 'order', 'roas', 'conversion value', 'cpa', 'purchase']
    const hasCommerceColumns = headers.some((h) =>
      commerceKeywords.some((keyword) => h.includes(keyword))
    )

    if (hasCommerceColumns) {
      return {
        success: false,
        error:
          '❌ ไฟล์นี้มี sales metrics (GMV/Orders/ROAS) ไม่ใช่ Awareness Report - กรุณาใช้ Performance Ads Import แทน',
      }
    }

    // Filename validation (should contain "Tiger" or "Campaign Report")
    const isValidFilename =
      fileName.toLowerCase().includes('tiger') ||
      fileName.toLowerCase().includes('campaign report')

    if (!isValidFilename) {
      return {
        success: false,
        error:
          '❌ ชื่อไฟล์ไม่ถูกต้อง - ต้องมี "Tiger" หรือ "Campaign Report" ในชื่อไฟล์',
      }
    }

    // 4. Extract campaign data
    const campaignNameKey = headers.find((h) => h.includes('campaign')) || 'campaign'
    const costKey = headers.find((h) => h.includes('cost')) || 'cost'
    const currencyKey = headers.find((h) => h.includes('currency')) || 'currency'

    const campaigns: TigerCampaignRow[] = []
    let totalCost = 0
    let currency = 'THB' // Default

    for (const row of rows) {
      const campaignName = row[campaignNameKey]
      const costValue = row[costKey]

      if (!campaignName || costValue === null || costValue === undefined) {
        continue // Skip empty rows
      }

      const cost = parseFloat(String(costValue).replace(/[^0-9.-]/g, ''))
      if (isNaN(cost)) {
        continue // Skip invalid cost
      }

      campaigns.push({
        campaignName: String(campaignName),
        cost,
      })

      totalCost += cost

      // Extract currency from first row
      if (campaigns.length === 1 && row[currencyKey]) {
        currency = String(row[currencyKey]).toUpperCase()
      }
    }

    if (campaigns.length === 0) {
      return {
        success: false,
        error: 'ไม่พบข้อมูล campaign ที่ valid ในไฟล์',
      }
    }

    // 5. Extract date range from filename
    // Expected format: "Tiger x CoolSmile - client's credit card-Campaign Report-(2024-12-01 to 2024-12-31).xlsx"
    const dateRangeMatch = fileName.match(/\((\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})\)/)

    let startDate: Date | null = null
    let endDate: Date | null = null
    let reportDateRange = 'Unknown'

    if (dateRangeMatch) {
      const [, start, end] = dateRangeMatch
      startDate = parse(start, 'yyyy-MM-dd', new Date())
      endDate = parse(end, 'yyyy-MM-dd', new Date())

      if (isValid(startDate) && isValid(endDate)) {
        reportDateRange = `${format(startDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`
      }
    }

    if (!endDate || !isValid(endDate)) {
      return {
        success: false,
        error:
          'ไม่พบ date range ในชื่อไฟล์ - ต้องมี format: (YYYY-MM-DD to YYYY-MM-DD)',
      }
    }

    // 6. Determine posting date (end date of report, Bangkok timezone)
    const bangkokEndDate = toZonedTime(endDate, 'Asia/Bangkok')
    const postingDate = format(bangkokEndDate, 'yyyy-MM-dd')

    // 7. Build preview
    const preview: TigerImportPreview = {
      fileName,
      reportDateRange,
      totalSpend: Math.round(totalCost * 100) / 100,
      currency,
      rowCount: rows.length,
      campaignCount: campaigns.length,
      postingDate,
    }

    return {
      success: true,
      preview,
      data: { campaigns }, // Pass campaigns for later use
    }
  } catch (error) {
    console.error('Error parsing Tiger report file:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการอ่านไฟล์',
    }
  }
}

/**
 * Step 2: Import Tiger report into wallet
 * Creates single SPEND entry in wallet_ledger
 */
export async function importTigerReportToWallet(
  fileBuffer: ArrayBuffer,
  fileName: string,
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
        error: 'Tiger import ต้องใช้กับ ADS Wallet เท่านั้น',
      }
    }

    // 3. Parse file again (with validation)
    const parseResult = await parseTigerReportFile(fileBuffer, fileName)
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
      .eq('report_type', 'tiger_awareness_monthly')
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
        report_type: 'tiger_awareness_monthly',
        period: `MONTHLY - ${preview.reportDateRange}`,
        file_name: fileName,
        file_hash: fileHash,
        row_count: preview.rowCount,
        inserted_count: 1, // Will create 1 wallet entry
        status: 'processing',
        created_by: user.id,
      })
      .select()
      .single()

    if (batchError || !batch) {
      console.error('Error creating import batch:', batchError)
      return { success: false, error: 'ไม่สามารถสร้าง import batch ได้' }
    }

    // 6. Create single wallet_ledger SPEND entry (monthly aggregation)
    const monthLabel = format(parse(preview.postingDate, 'yyyy-MM-dd', new Date()), 'yyyy-MM')
    const note = `Monthly Awareness Spend (Tiger) - ${monthLabel}\nReport: ${preview.reportDateRange}\n${preview.campaignCount} campaigns`

    const { error: ledgerError } = await supabase.from('wallet_ledger').insert({
      wallet_id: adsWalletId,
      date: preview.postingDate,
      entry_type: 'SPEND',
      direction: 'OUT',
      amount: preview.totalSpend,
      source: 'IMPORTED',
      import_batch_id: batch.id,
      reference_id: fileName,
      note,
      created_by: user.id,
    })

    if (ledgerError) {
      console.error('Error creating wallet ledger entry:', ledgerError)

      // Update batch status to failed
      await supabase
        .from('import_batches')
        .update({ status: 'failed', notes: ledgerError.message })
        .eq('id', batch.id)

      return {
        success: false,
        error: `ไม่สามารถสร้าง wallet entry ได้: ${ledgerError.message}`,
      }
    }

    // 7. Update batch status to success
    await supabase
      .from('import_batches')
      .update({
        status: 'success',
        notes: `Successfully imported ${preview.campaignCount} campaigns, total spend: ${preview.totalSpend} ${preview.currency}`,
      })
      .eq('id', batch.id)

    return {
      success: true,
      data: {
        batchId: batch.id,
        totalSpend: preview.totalSpend,
        currency: preview.currency,
        postingDate: preview.postingDate,
        campaignCount: preview.campaignCount,
      },
    }
  } catch (error) {
    console.error('Unexpected error in importTigerReportToWallet:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}
