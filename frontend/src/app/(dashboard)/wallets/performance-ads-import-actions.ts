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
import crypto from 'crypto'
import { formatBangkok } from '@/lib/bangkok-time'
import { parseTikTokAdsFile } from '@/lib/parsers/tiktok-ads-parser'
import type { TikTokAdsPreview, DailyAdData } from '@/lib/parsers/tiktok-ads-parser'

interface ActionResult {
  success: boolean
  error?: string
  warnings?: string[]
  data?: unknown
}

interface PerformanceAdsPreview extends TikTokAdsPreview {
  campaignType?: 'product' | 'live' // For backward compatibility
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
    // Use new semantic parser
    const result = await parseTikTokAdsFile(fileBuffer, fileName)

    if (!result.success) {
      return {
        success: false,
        error: result.error,
      }
    }

    // Enhance preview with user-selected campaignType (for backward compatibility)
    const preview: PerformanceAdsPreview = {
      ...result.preview!,
      campaignType, // Override detected type with user selection
    }

    return {
      success: true,
      warnings: result.warnings,
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
