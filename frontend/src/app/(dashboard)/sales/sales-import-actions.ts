'use server'

/**
 * Sales Import Server Actions
 * Phase 6: CSV/Excel Import Infrastructure
 *
 * Supports:
 * - TikTok Shop (OrderSKUList .xlsx)
 * - Shopee (via manual mapping)
 * - Generic CSV/Excel (via manual mapping)
 */

import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'
import {
  ParsedSalesRow,
  SalesImportPreview,
  SalesImportResult,
  TIKTOK_SHOP_PRESET
} from '@/types/sales-import'
import { getBangkokNow, formatBangkok } from '@/lib/bangkok-time'
import { zonedTimeToUtc } from 'date-fns-tz'
import { parse as parseDate, isValid } from 'date-fns'

const BANGKOK_TZ = 'Asia/Bangkok'

// ============================================
// Helper Functions
// ============================================

/**
 * Parse various date formats to Bangkok timezone
 */
function parseExcelDate(value: any): Date | null {
  if (!value) return null

  // Handle Excel serial date number
  if (typeof value === 'number') {
    const excelEpoch = new Date('1899-12-30T00:00:00Z')
    return new Date(excelEpoch.getTime() + value * 86400000)
  }

  // Handle string dates
  if (typeof value === 'string') {
    const trimmed = value.trim()

    // Try multiple formats
    const formats = [
      'dd/MM/yyyy HH:mm:ss', // TikTok format
      'dd/MM/yyyy',
      'yyyy-MM-dd HH:mm:ss',
      'yyyy-MM-dd',
      'MM/dd/yyyy',
      'yyyy/MM/dd',
    ]

    for (const format of formats) {
      const parsed = parseDate(trimmed, format, new Date())
      if (isValid(parsed)) {
        return parsed
      }
    }
  }

  // Handle Date object
  if (value instanceof Date && isValid(value)) {
    return value
  }

  return null
}

/**
 * Convert date to Bangkok timezone and format
 */
function toBangkokDatetime(date: Date | null): string | null {
  if (!date) return null
  try {
    // Convert to Bangkok timezone
    const bangkokDate = zonedTimeToUtc(date, BANGKOK_TZ)
    return formatBangkok(bangkokDate, 'yyyy-MM-dd HH:mm:ss')
  } catch (error) {
    return null
  }
}

/**
 * Normalize number (handle currency symbols, decimals)
 */
function normalizeNumber(value: any): number {
  if (typeof value === 'number') return value
  if (!value) return 0

  const str = String(value).replace(/[^0-9.-]/g, '') // Strip non-numeric except - and .
  const num = parseFloat(str)
  return isNaN(num) ? 0 : num
}

/**
 * Normalize status from TikTok to our system
 */
function normalizeStatus(tiktokStatus?: string): string {
  if (!tiktokStatus) return 'pending'

  const status = tiktokStatus.toLowerCase()
  if (status.includes('delivered') || status.includes('completed')) return 'completed'
  if (status.includes('cancel') || status.includes('return')) return 'cancelled'
  return 'pending'
}

/**
 * Check if file is TikTok Shop format
 */
function detectTikTokFormat(workbook: XLSX.WorkBook, worksheet: XLSX.WorkSheet): boolean {
  // Check if sheet name is "OrderSKUList"
  const sheetName = workbook.SheetNames[0]
  if (sheetName !== 'OrderSKUList') return false

  // Parse first 2 rows to check structure
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null, header: 1 }) as any[][]

  if (rows.length < 2) return false

  const headerRow = rows[0]

  // Check for required TikTok columns
  const requiredColumns = ['Order ID', 'Product Name', 'Quantity', 'Created Time']
  const hasRequired = requiredColumns.every(col =>
    headerRow.some((cell: any) => String(cell).trim() === col)
  )

  return hasRequired
}

// ============================================
// Main: Parse TikTok Shop File
// ============================================

export async function parseSalesImportFile(
  fileBuffer: ArrayBuffer,
  fileName: string
): Promise<SalesImportPreview> {
  try {
    // Validate file extension
    if (!fileName.endsWith('.xlsx')) {
      return {
        success: false,
        importType: 'generic',
        totalRows: 0,
        sampleRows: [],
        summary: { totalRevenue: 0, totalOrders: 0, uniqueOrderIds: 0, lineCount: 0 },
        errors: [{ message: 'รองรับเฉพาะไฟล์ .xlsx เท่านั้น', severity: 'error' }],
        warnings: [],
      }
    }

    // Parse Excel file
    const workbook = XLSX.read(fileBuffer, { type: 'array' })

    if (!workbook.SheetNames.length) {
      return {
        success: false,
        importType: 'generic',
        totalRows: 0,
        sampleRows: [],
        summary: { totalRevenue: 0, totalOrders: 0, uniqueOrderIds: 0, lineCount: 0 },
        errors: [{ message: 'ไฟล์ Excel ไม่มี sheet ใดๆ', severity: 'error' }],
        warnings: [],
      }
    }

    const worksheet = workbook.Sheets[workbook.SheetNames[0]]

    // Detect format
    const isTikTok = detectTikTokFormat(workbook, worksheet)

    if (!isTikTok) {
      return {
        success: false,
        importType: 'generic',
        totalRows: 0,
        sampleRows: [],
        summary: { totalRevenue: 0, totalOrders: 0, uniqueOrderIds: 0, lineCount: 0 },
        errors: [{
          message: 'ไม่สามารถตรวจจับรูปแบบ TikTok Shop (OrderSKUList) ได้ กรุณาใช้ Manual Mapping',
          severity: 'error'
        }],
        warnings: [],
      }
    }

    // Parse TikTok format
    return await parseTikTokFormat(workbook, worksheet)

  } catch (error: any) {
    console.error('Parse sales file error:', error)
    return {
      success: false,
      importType: 'generic',
      totalRows: 0,
      sampleRows: [],
      summary: { totalRevenue: 0, totalOrders: 0, uniqueOrderIds: 0, lineCount: 0 },
      errors: [{ message: `Error: ${error.message}`, severity: 'error' }],
      warnings: [],
    }
  }
}

/**
 * Parse TikTok Shop OrderSKUList format
 */
async function parseTikTokFormat(
  workbook: XLSX.WorkBook,
  worksheet: XLSX.WorkSheet
): Promise<SalesImportPreview> {
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null }) as any[]

  if (rows.length === 0) {
    return {
      success: false,
      importType: 'tiktok_shop',
      totalRows: 0,
      sampleRows: [],
      summary: { totalRevenue: 0, totalOrders: 0, uniqueOrderIds: 0, lineCount: 0 },
      errors: [{ message: 'ไฟล์ว่างเปล่า (ไม่มีข้อมูล)', severity: 'error' }],
      warnings: [],
    }
  }

  // TikTok has Row 1 = headers, Row 2 = description (SKIP), Row 3+ = data
  // After sheet_to_json, Row 2 might have nulls or invalid data - we'll filter

  const parsedRows: ParsedSalesRow[] = []
  const errors: Array<{ row?: number; field?: string; message: string; severity: 'error' | 'warning' }> = []
  const uniqueOrderIds = new Set<string>()

  let minDate: Date | null = null
  let maxDate: Date | null = null
  let totalRevenue = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = i + 2 // Excel rows start at 1, + 1 for header = row 2+

    // Skip description row (Row 2 in Excel) - typically has null or invalid data
    // Check if Order ID exists and is valid
    const orderId = row['Order ID']
    if (!orderId || String(orderId).trim() === '') {
      // Skip empty rows (likely row 2 or other invalid rows)
      continue
    }

    try {
      // Parse created_time (use as order_date for P&L bucket)
      const createdTimeRaw = row['Created Time']
      const createdTime = parseExcelDate(createdTimeRaw)

      if (!createdTime) {
        errors.push({
          row: rowNumber,
          field: 'Created Time',
          message: 'วันที่ไม่ถูกต้อง',
          severity: 'error'
        })
        continue
      }

      const orderDate = toBangkokDatetime(createdTime)
      if (!orderDate) {
        errors.push({
          row: rowNumber,
          field: 'Created Time',
          message: 'ไม่สามารถแปลงวันที่เป็น Bangkok timezone ได้',
          severity: 'error'
        })
        continue
      }

      // Track date range
      if (!minDate || createdTime < minDate) minDate = createdTime
      if (!maxDate || createdTime > maxDate) maxDate = createdTime

      // Parse product name
      const productName = row['Product Name']
      if (!productName || String(productName).trim() === '') {
        errors.push({
          row: rowNumber,
          field: 'Product Name',
          message: 'ไม่มีชื่อสินค้า',
          severity: 'error'
        })
        continue
      }

      // Parse quantity
      const qty = normalizeNumber(row['Quantity'])
      if (qty <= 0) {
        errors.push({
          row: rowNumber,
          field: 'Quantity',
          message: 'Quantity ต้องมากกว่า 0',
          severity: 'error'
        })
        continue
      }

      // Parse line revenue (SKU Subtotal After Discount)
      const lineRevenue = normalizeNumber(row['SKU Subtotal After Discount'])

      // Calculate unit price from line revenue / qty
      const unitPrice = qty > 0 ? lineRevenue / qty : 0

      // Parse status
      const orderStatus = row['Order Status']
      const status = normalizeStatus(orderStatus)

      // Build metadata for rich TikTok data
      const metadata: any = {
        source_report: 'OrderSKUList',
        sku_id: row['SKU ID'] || null,
        seller_sku: row['Seller SKU'] || null,
        variation: row['Variation'] || null,
        order_status: orderStatus || null,
        order_substatus: row['Order Substatus'] || null,
        paid_time: row['Paid Time'] ? toBangkokDatetime(parseExcelDate(row['Paid Time'])) : null,
        shipped_time: row['Shipped Time'] ? toBangkokDatetime(parseExcelDate(row['Shipped Time'])) : null,
        delivered_time: row['Delivered Time'] ? toBangkokDatetime(parseExcelDate(row['Delivered Time'])) : null,
        cancelled_time: row['Cancelled Time'] ? toBangkokDatetime(parseExcelDate(row['Cancelled Time'])) : null,
        cancel_reason: row['Cancel Reason'] || null,
        tracking_id: row['Tracking ID'] || null,
        payment_method: row['Payment Method'] || null,
      }

      // Add parsed row
      parsedRows.push({
        order_id: String(orderId).trim(),
        marketplace: 'tiktok_shop',
        channel: 'TikTok Shop',
        product_name: String(productName).trim(),
        sku: row['SKU ID'] ? String(row['SKU ID']).trim() : undefined,
        quantity: qty,
        unit_price: unitPrice,
        total_amount: lineRevenue,
        order_date: orderDate,
        status,
        metadata,
        rowNumber,
      })

      uniqueOrderIds.add(String(orderId).trim())

      // Only count revenue for completed orders
      if (status === 'completed') {
        totalRevenue += lineRevenue
      }

    } catch (error: any) {
      errors.push({
        row: rowNumber,
        message: `Parse error: ${error.message}`,
        severity: 'error'
      })
    }
  }

  // Check if any valid rows
  if (parsedRows.length === 0) {
    return {
      success: false,
      importType: 'tiktok_shop',
      totalRows: rows.length,
      sampleRows: [],
      summary: { totalRevenue: 0, totalOrders: 0, uniqueOrderIds: 0, lineCount: 0 },
      errors: [{ message: 'ไม่มีแถวที่ valid (ทุกแถวมี error)', severity: 'error' }],
      warnings: [],
    }
  }

  // Date range
  const dateRange = minDate && maxDate ? {
    start: formatBangkok(minDate, 'yyyy-MM-dd'),
    end: formatBangkok(maxDate, 'yyyy-MM-dd'),
  } : undefined

  // Sample rows (first 5)
  const sampleRows = parsedRows.slice(0, 5)

  return {
    success: errors.filter(e => e.severity === 'error').length === 0,
    importType: 'tiktok_shop',
    dateRange,
    totalRows: parsedRows.length,
    sampleRows,
    allRows: parsedRows, // Include all rows for import
    summary: {
      totalRevenue,
      totalOrders: uniqueOrderIds.size,
      uniqueOrderIds: uniqueOrderIds.size,
      lineCount: parsedRows.length,
    },
    errors,
    warnings: [
      `พบ ${parsedRows.length} line items จาก ${uniqueOrderIds.size} orders`,
      'Line-level import: แต่ละ SKU เก็บแยก row (ไม่ double-count order totals)'
    ],
  }
}

// ============================================
// Main: Import Sales to System
// ============================================

export async function importSalesToSystem(
  fileHash: string,
  fileName: string,
  parsedData: ParsedSalesRow[]
): Promise<SalesImportResult> {
  const supabase = createClient()

  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return {
        success: false,
        error: 'Authentication required',
        inserted: 0,
        skipped: 0,
        errors: 0,
      }
    }

    // File hash already calculated on client-side (no need to recalculate)

    // Check for duplicate import (only block if previous import was successful)
    const { data: existingBatch } = await supabase
      .from('import_batches')
      .select('id, file_name, created_at, status, inserted_count')
      .eq('file_hash', fileHash)
      .eq('marketplace', 'tiktok_shop')
      .eq('status', 'success')
      .gt('inserted_count', 0)
      .single()

    if (existingBatch) {
      return {
        success: false,
        error: `ไฟล์นี้ถูก import สำเร็จไปแล้ว - "${existingBatch.file_name}" (${formatBangkok(new Date(existingBatch.created_at), 'yyyy-MM-dd HH:mm')})`,
        inserted: 0,
        skipped: 0,
        errors: 0,
      }
    }

    // Create import batch record
    const dateRange = parsedData.length > 0
      ? `${parsedData[0].order_date} to ${parsedData[parsedData.length - 1].order_date}`
      : 'N/A'

    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        file_hash: fileHash,
        marketplace: 'tiktok_shop',
        report_type: 'sales_order_sku_list',
        period: dateRange,
        file_name: fileName,
        row_count: parsedData.length,
        inserted_count: 0,
        updated_count: 0,
        skipped_count: 0,
        error_count: 0,
        status: 'processing',
        created_by: user.id,
      })
      .select()
      .single()

    if (batchError || !batch) {
      console.error('Batch creation error:', batchError)
      return {
        success: false,
        error: 'Failed to create import batch',
        inserted: 0,
        skipped: 0,
        errors: 0,
      }
    }

    // Insert sales orders (line-level) with UX v2 fields
    const salesRows = parsedData.map(row => ({
      order_id: row.order_id,
      marketplace: row.marketplace,
      channel: row.channel,
      product_name: row.product_name,
      sku: row.sku,
      quantity: row.quantity,
      unit_price: row.unit_price,
      total_amount: row.total_amount,
      cost_per_unit: row.cost_per_unit,
      order_date: row.order_date,
      status: row.status,
      customer_name: row.customer_name,
      notes: row.notes,
      source: 'imported',
      import_batch_id: batch.id,
      metadata: row.metadata || {},
      created_by: user.id,

      // UX v2: Platform-specific fields
      source_platform: row.source_platform,
      external_order_id: row.external_order_id,
      platform_status: row.platform_status,
      platform_substatus: row.platform_substatus,
      payment_status: row.payment_status,
      paid_at: row.paid_at,
      shipped_at: row.shipped_at,
      delivered_at: row.delivered_at,
      seller_sku: row.seller_sku,
      sku_id: row.sku_id,
    }))

    const { data: insertedRows, error: insertError } = await supabase
      .from('sales_orders')
      .insert(salesRows)
      .select()

    if (insertError) {
      console.error('Insert error:', insertError)

      // Update batch status to failed
      await supabase
        .from('import_batches')
        .update({
          status: 'failed',
          error_count: parsedData.length,
          notes: `Insert failed: ${insertError.message}`,
        })
        .eq('id', batch.id)

      return {
        success: false,
        error: `Insert failed: ${insertError.message}`,
        inserted: 0,
        skipped: 0,
        errors: parsedData.length,
      }
    }

    const insertedCount = insertedRows?.length || 0

    // Post-insert verification: Count actual rows in database
    const { count: actualCount } = await supabase
      .from('sales_orders')
      .select('*', { count: 'exact', head: true })
      .eq('import_batch_id', batch.id)

    const verifiedCount = actualCount || 0

    // Check if insert was actually successful
    if (verifiedCount === 0) {
      // No rows inserted (possible RLS block or silent failure)
      await supabase
        .from('import_batches')
        .update({
          status: 'failed',
          inserted_count: 0,
          error_count: parsedData.length,
          notes: 'Import failed: 0 rows inserted. Possible RLS policy issue or authentication error.',
        })
        .eq('id', batch.id)

      return {
        success: false,
        error: 'Import failed: 0 rows inserted. กรุณาตรวจสอบ permissions หรือติดต่อผู้ดูแลระบบ',
        inserted: 0,
        skipped: 0,
        errors: parsedData.length,
      }
    }

    // Update batch status to success
    await supabase
      .from('import_batches')
      .update({
        status: 'success',
        inserted_count: verifiedCount,
        notes: `Successfully imported ${verifiedCount} rows`,
      })
      .eq('id', batch.id)

    // Calculate summary
    const totalRevenue = parsedData
      .filter(r => r.status === 'completed')
      .reduce((sum, r) => sum + r.total_amount, 0)

    const uniqueOrders = new Set(parsedData.map(r => r.order_id)).size

    return {
      success: true,
      batchId: batch.id,
      inserted: insertedCount,
      skipped: 0,
      errors: 0,
      summary: {
        dateRange,
        totalRevenue,
        orderCount: uniqueOrders,
      },
    }

  } catch (error: any) {
    console.error('Import sales error:', error)
    return {
      success: false,
      error: error.message,
      inserted: 0,
      skipped: 0,
      errors: 0,
    }
  }
}
