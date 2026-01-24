'use server'

/**
 * Manual Column Mapping - Server Actions
 *
 * Purpose: Support manual column mapping wizard for ads import
 * when auto-parse fails or file has non-standard column names
 */

import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'
import crypto from 'crypto'
import { formatBangkok } from '@/lib/bangkok-time'
import { parse, isValid, format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import type { ReportType, UserPreset, PreviewResult, ParsedRow } from '@/types/manual-mapping'
import { extractColumnIndex } from '@/types/manual-mapping'

interface ActionResult {
  success: boolean
  error?: string
  data?: unknown
}

// ============================================================================
// Helper Functions (Reused from existing import actions)
// ============================================================================

/**
 * Parse date value (Excel serial or string) to Bangkok timezone YYYY-MM-DD
 */
function parseDateValue(dateValue: unknown): string | null {
  if (!dateValue) return null

  let adDate: Date | null = null

  // Try parsing as Excel serial date
  if (typeof dateValue === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30))
    adDate = new Date(excelEpoch.getTime() + dateValue * 86400000)
  } else {
    // Try parsing as string
    const dateStr = String(dateValue)
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
    return null
  }

  return format(toZonedTime(adDate, 'Asia/Bangkok'), 'yyyy-MM-dd')
}

/**
 * Parse number value (strip currency symbols)
 */
function parseNumberValue(value: unknown): number {
  if (typeof value === 'number') return value
  const cleaned = String(value || 0).replace(/[^0-9.-]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

// ============================================================================
// Preset Management
// ============================================================================

/**
 * Load user's column mapping presets for a report type
 */
export async function loadUserPresets(
  reportType: ReportType
): Promise<ActionResult & { presets?: UserPreset[] }> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    const { data, error } = await supabase
      .from('user_column_mappings')
      .select('*')
      .eq('user_id', user.id)
      .eq('report_type', reportType)
      .order('last_used_at', { ascending: false })
      .limit(10)

    if (error) {
      console.error('Error loading presets:', error)
      return { success: false, error: 'ไม่สามารถโหลด presets ได้' }
    }

    return {
      success: true,
      presets: data || [],
    }
  } catch (error) {
    console.error('Error in loadUserPresets:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาด',
    }
  }
}

/**
 * Save or update user preset
 */
export async function saveUserPreset(
  filename: string,
  reportType: ReportType,
  columnMapping: Record<string, string>
): Promise<ActionResult> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    // Check if preset exists
    const { data: existing } = await supabase
      .from('user_column_mappings')
      .select('id, use_count')
      .eq('user_id', user.id)
      .eq('filename_pattern', filename)
      .eq('report_type', reportType)
      .single()

    const now = new Date().toISOString()

    if (existing) {
      // Update existing preset
      const { error: updateError } = await supabase
        .from('user_column_mappings')
        .update({
          column_mapping: columnMapping,
          use_count: existing.use_count + 1,
          last_used_at: now,
          updated_at: now,
        })
        .eq('id', existing.id)

      if (updateError) {
        console.error('Error updating preset:', updateError)
        return { success: false, error: 'ไม่สามารถอัพเดท preset ได้' }
      }
    } else {
      // Insert new preset
      const { error: insertError } = await supabase.from('user_column_mappings').insert({
        user_id: user.id,
        filename_pattern: filename,
        report_type: reportType,
        column_mapping: columnMapping,
        use_count: 1,
        last_used_at: now,
      })

      if (insertError) {
        console.error('Error inserting preset:', insertError)
        return { success: false, error: 'ไม่สามารถบันทึก preset ได้' }
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Error in saveUserPreset:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาด',
    }
  }
}

// ============================================================================
// Parse with Custom Mapping
// ============================================================================

/**
 * Parse Excel file with custom column mapping
 * Returns preview data for validation
 */
export async function parseWithCustomMapping(
  fileBuffer: ArrayBuffer,
  fileName: string,
  reportType: ReportType,
  columnMapping: Record<string, string>, // systemField -> excelColumn (with index: "Cost__0")
  dateRange?: { startDate: string; endDate: string } // For Tiger only
): Promise<ActionResult & { preview?: PreviewResult }> {
  try {
    // 1. Validate inputs
    if (!fileBuffer || !reportType || !columnMapping) {
      return { success: false, error: 'ข้อมูลไม่ครบถ้วน' }
    }

    // 2. Parse Excel file
    const workbook = XLSX.read(fileBuffer, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) {
      return { success: false, error: 'ไม่พบ worksheet ในไฟล์' }
    }

    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null }) as Record<
      string,
      unknown
    >[]

    if (rows.length === 0) {
      return { success: false, error: 'ไฟล์ว่างเปล่า ไม่มีข้อมูล' }
    }

    // 3. Get headers and validate
    const firstRow = rows[0]
    const headers = Object.keys(firstRow)

    if (headers.length === 0) {
      return {
        success: false,
        error: 'ไฟล์ไม่มี header row - กรุณาตรวจสอบว่าแถวแรกเป็นชื่อ columns',
      }
    }

    // 4. Build reverse mapping (excelColumn__index -> systemField)
    const reverseMapping = new Map<string, string>()
    Object.entries(columnMapping).forEach(([systemField, excelColumnValue]) => {
      if (excelColumnValue) {
        reverseMapping.set(excelColumnValue, systemField)
      }
    })

    // 5. Parse rows based on report type
    const parsedRows: ParsedRow[] = []
    let totalSpend = 0
    let totalRevenue = 0
    let totalOrders = 0
    const seenDates = new Set<string>()
    const warnings: string[] = []

    for (const row of rows) {
      const parsed: ParsedRow = {
        campaignName: '',
        spend: 0,
      }

      // Map each system field
      let hasData = false
      for (const [excelColumnValue, systemField] of reverseMapping) {
        // Extract column name and index
        const columnIndex = extractColumnIndex(excelColumnValue)
        const columnName = excelColumnValue.split('__')[0]

        // Get value from row (try both with and without index)
        const value = row[excelColumnValue] ?? row[columnName]
        if (value === null || value === undefined) continue

        hasData = true

        // Map to system field
        switch (systemField) {
          case 'ad_date':
            if (reportType !== 'tiger') {
              const dateStr = parseDateValue(value)
              if (dateStr) {
                parsed.date = dateStr
                seenDates.add(dateStr)
              }
            }
            break
          case 'campaign_name':
            parsed.campaignName = String(value).trim()
            break
          case 'spend':
            parsed.spend = parseNumberValue(value)
            totalSpend += parsed.spend
            break
          case 'orders':
            if (reportType !== 'tiger') {
              parsed.orders = Math.round(parseNumberValue(value))
              totalOrders += parsed.orders || 0
            }
            break
          case 'revenue':
            if (reportType !== 'tiger') {
              parsed.revenue = parseNumberValue(value)
              totalRevenue += parsed.revenue || 0
            }
            break
          case 'roi':
            if (reportType !== 'tiger') {
              parsed.roi = parseNumberValue(value)
            }
            break
        }
      }

      // Calculate ROAS if not provided (Product/Live only)
      if (reportType !== 'tiger' && !parsed.roi && parsed.spend > 0 && parsed.revenue) {
        parsed.roi = parsed.revenue / parsed.spend
      }

      // Round ROAS
      if (parsed.roi) {
        parsed.roi = Math.round(parsed.roi * 100) / 100
      }

      // Only add rows with campaign name and spend
      if (hasData && parsed.campaignName && parsed.spend > 0) {
        parsedRows.push(parsed)
      }
    }

    if (parsedRows.length === 0) {
      return {
        success: false,
        error: 'ไม่พบข้อมูลที่ valid ในไฟล์ - กรุณาตรวจสอบ column mapping',
      }
    }

    // 6. Validate based on report type
    const validation = await validateMappedData(reportType, parsedRows, dateRange)

    // 7. Build preview
    let dateRangeStr: string | null = null
    if (reportType === 'tiger') {
      if (dateRange) {
        dateRangeStr = `${dateRange.startDate} to ${dateRange.endDate}`
      }
    } else {
      const dates = Array.from(seenDates).sort()
      if (dates.length > 0) {
        dateRangeStr = `${dates[0]} to ${dates[dates.length - 1]}`
      }
    }

    const avgROAS =
      reportType !== 'tiger' && totalSpend > 0 ? totalRevenue / totalSpend : undefined

    const preview: PreviewResult = {
      success: validation.errors.length === 0,
      dateRange: dateRangeStr,
      totalSpend: Math.round(totalSpend * 100) / 100,
      totalRevenue: reportType !== 'tiger' ? Math.round(totalRevenue * 100) / 100 : undefined,
      totalOrders: reportType !== 'tiger' ? Math.round(totalOrders) : undefined,
      avgROAS: avgROAS !== undefined ? Math.round(avgROAS * 100) / 100 : undefined,
      recordCount: parsedRows.length,
      sampleRows: parsedRows.slice(0, 5), // First 5 rows
      warnings: [...warnings, ...validation.warnings],
      errors: validation.errors,
    }

    return {
      success: true,
      preview,
    }
  } catch (error) {
    console.error('Error parsing with custom mapping:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการอ่านไฟล์',
    }
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate mapped data based on business rules
 */
async function validateMappedData(
  reportType: ReportType,
  data: ParsedRow[],
  dateRange?: { startDate: string; endDate: string }
): Promise<{ warnings: string[]; errors: string[] }> {
  const warnings: string[] = []
  const errors: string[] = []

  // 1. Tiger-specific validation
  if (reportType === 'tiger') {
    // Date range required
    if (!dateRange || !dateRange.startDate || !dateRange.endDate) {
      errors.push('❌ Tiger report ต้องระบุ date range (start date และ end date)')
    } else if (new Date(dateRange.endDate) < new Date(dateRange.startDate)) {
      errors.push('❌ End date ต้องมากกว่าหรือเท่ากับ start date')
    }

    // Must NOT have commerce data
    const hasCommerceData = data.some((row) => row.orders || row.revenue || row.roi)
    if (hasCommerceData) {
      errors.push(
        '❌ Tiger report (Awareness Ads) ไม่ควรมี sales metrics (Orders/GMV/ROAS) - ใช้ Performance Ads Import แทน'
      )
    }
  }

  // 2. Product/Live-specific validation
  if (reportType === 'product' || reportType === 'live') {
    // Must have dates
    const missingDates = data.filter((row) => !row.date)
    if (missingDates.length > 0) {
      errors.push(`❌ พบ ${missingDates.length} แถวที่ไม่มี date - กรุณาตรวจสอบ column mapping`)
    }

    // Must have commerce data
    const hasOrders = data.some((row) => row.orders && row.orders > 0)
    const hasRevenue = data.some((row) => row.revenue && row.revenue > 0)

    if (!hasOrders) {
      errors.push('❌ Performance report ต้องมี Orders (จำนวน orders > 0)')
    }
    if (!hasRevenue) {
      errors.push('❌ Performance report ต้องมี GMV/Revenue (ยอดขาย > 0)')
    }

    // Duplicate dates warning
    const dates = data.map((row) => row.date).filter(Boolean) as string[]
    const uniqueDates = new Set(dates)
    if (dates.length > uniqueDates.size) {
      warnings.push('⚠️ พบวันที่ซ้ำกันในไฟล์ - อาจมีหลาย campaigns ในวันเดียวกัน')
    }
  }

  // 3. Common validation
  const missingCampaigns = data.filter((row) => !row.campaignName)
  if (missingCampaigns.length > 0) {
    errors.push(`❌ พบ ${missingCampaigns.length} แถวที่ไม่มี campaign name`)
  }

  const zeroSpend = data.filter((row) => row.spend <= 0)
  if (zeroSpend.length > 0) {
    warnings.push(`⚠️ พบ ${zeroSpend.length} แถวที่ spend = 0 - จะถูกข้ามในการ import`)
  }

  return { warnings, errors }
}

// ============================================================================
// Execute Import (Wrapper)
// ============================================================================

/**
 * Execute manual import with custom column mapping
 * Reuses existing import logic from performance-ads-import-actions / tiger-import-actions
 */
export async function executeManualImport(
  fileBuffer: ArrayBuffer,
  fileName: string,
  reportType: ReportType,
  columnMapping: Record<string, string>,
  adsWalletId: string,
  dateRange?: { startDate: string; endDate: string },
  savePreset = true
): Promise<ActionResult> {
  try {
    // 1. Parse and validate
    const parseResult = await parseWithCustomMapping(
      fileBuffer,
      fileName,
      reportType,
      columnMapping,
      dateRange
    )

    if (!parseResult.success || !parseResult.preview) {
      return {
        success: false,
        error: parseResult.error || 'ไม่สามารถ parse ไฟล์ได้',
      }
    }

    if (parseResult.preview.errors.length > 0) {
      return {
        success: false,
        error: `Validation errors: ${parseResult.preview.errors.join(', ')}`,
      }
    }

    // 2. Authenticate user
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    // 3. Check file hash (duplicate detection)
    const fileHash = crypto.createHash('sha256').update(Buffer.from(fileBuffer)).digest('hex')

    const reportTypeStr =
      reportType === 'tiger' ? 'tiger_awareness_monthly' : `tiktok_ads_${reportType}`

    const { data: existingBatch } = await supabase
      .from('import_batches')
      .select('id, file_name, created_at')
      .eq('file_hash', fileHash)
      .eq('report_type', reportTypeStr)
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

    // 4. Create import_batch
    const { preview } = parseResult
    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        marketplace: 'tiktok',
        report_type: reportTypeStr,
        period: preview.dateRange || 'Manual',
        file_name: fileName,
        file_hash: fileHash,
        row_count: preview.recordCount,
        inserted_count: 0,
        status: 'processing',
        created_by: user.id,
      })
      .select()
      .single()

    if (batchError || !batch) {
      console.error('Error creating import batch:', batchError)
      return { success: false, error: 'ไม่สามารถสร้าง import batch ได้' }
    }

    // 5. Insert data based on report type
    let insertedCount = 0

    if (reportType === 'tiger') {
      // Tiger: Insert single wallet entry
      if (!dateRange) {
        return { success: false, error: 'Tiger import ต้องระบุ date range' }
      }

      const postingDate = dateRange.endDate // Use end date
      const monthLabel = format(new Date(dateRange.endDate), 'yyyy-MM')

      const { error: ledgerError } = await supabase.from('wallet_ledger').insert({
        wallet_id: adsWalletId,
        date: postingDate,
        entry_type: 'SPEND',
        direction: 'OUT',
        amount: preview.totalSpend,
        source: 'IMPORTED',
        import_batch_id: batch.id,
        note: `Monthly Awareness Spend (Tiger) - ${monthLabel}\nReport: ${preview.dateRange}\nManual Import: ${fileName}`,
        created_by: user.id,
      })

      if (ledgerError) {
        console.error('Error inserting wallet entry:', ledgerError)
        return { success: false, error: 'ไม่สามารถสร้าง wallet entry ได้' }
      }

      insertedCount = 1
    } else {
      // Product/Live: Insert ad_daily_performance + wallet_ledger
      // Reuse parsing but with custom mapping
      const dailyMap = new Map<string, { campaigns: ParsedRow[]; totalSpend: number }>()

      preview.sampleRows.forEach((row) => {
        if (!row.date) return
        const existing = dailyMap.get(row.date) || { campaigns: [], totalSpend: 0 }
        existing.campaigns.push(row)
        existing.totalSpend += row.spend
        dailyMap.set(row.date, existing)
      })

      // Insert ad_daily_performance
      for (const row of preview.sampleRows) {
        if (!row.date) continue

        const { error: perfError } = await supabase.from('ad_daily_performance').upsert(
          {
            marketplace: 'tiktok',
            ad_date: row.date,
            campaign_type: reportType,
            campaign_name: row.campaignName,
            spend: row.spend,
            orders: row.orders || 0,
            revenue: row.revenue || 0,
            roi: row.roi || 0,
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
        } else {
          insertedCount++
        }
      }

      // Insert wallet_ledger (one per day, aggregated)
      for (const [date, { totalSpend }] of dailyMap) {
        await supabase.from('wallet_ledger').insert({
          wallet_id: adsWalletId,
          date,
          entry_type: 'SPEND',
          direction: 'OUT',
          amount: totalSpend,
          source: 'IMPORTED',
          import_batch_id: batch.id,
          note: `${reportType === 'product' ? 'Product' : 'Live'} Ads Spend - ${date}\nManual Import: ${fileName}`,
          created_by: user.id,
        })
      }
    }

    // 6. Update batch status
    await supabase
      .from('import_batches')
      .update({
        inserted_count: insertedCount,
        status: 'completed',
      })
      .eq('id', batch.id)

    // 7. Save preset if requested
    if (savePreset) {
      await saveUserPreset(fileName, reportType, columnMapping)
    }

    return {
      success: true,
      data: {
        recordCount: insertedCount,
        totalSpend: preview.totalSpend,
        totalRevenue: preview.totalRevenue,
        avgROAS: preview.avgROAS,
      },
    }
  } catch (error) {
    console.error('Error in executeManualImport:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาด',
    }
  }
}
