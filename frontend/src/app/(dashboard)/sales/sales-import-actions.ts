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
import crypto from 'crypto'
import {
  ParsedSalesRow,
  SalesImportPreview,
  SalesImportResult
} from '@/types/sales-import'
import { formatBangkok } from '@/lib/bangkok-time'
import { parse as parseDate, isValid } from 'date-fns'

// ============================================
// Hash Generation (for deduplication)
// ============================================

/**
 * Generate SHA256 hash for sales order line deduplication
 * Matches PostgreSQL function: public.generate_order_line_hash
 */
function generateOrderLineHash(
  userId: string,
  sourcePlatform: string,
  externalOrderId: string,
  productName: string,
  quantity: number,
  totalAmount: number
): string {
  // Format: created_by|source_platform|external_order_id|product_name|quantity|total_amount
  const hashInput = [
    userId,
    sourcePlatform || '',
    externalOrderId || '',
    productName || '',
    quantity.toString(),
    totalAmount.toString(),
  ].join('|')

  return crypto.createHash('sha256').update(hashInput).digest('hex')
}

// ============================================
// Helper Functions
// ============================================

/**
 * Parse various date formats to Bangkok timezone
 */
function parseExcelDate(value: unknown): Date | null {
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
    // Convert to Bangkok timezone and format
    return formatBangkok(date, 'yyyy-MM-dd HH:mm:ss')
  } catch {
    return null
  }
}

/**
 * Normalize number (handle currency symbols, decimals)
 */
function normalizeNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (!value) return 0

  const str = String(value).replace(/[^0-9.-]/g, '') // Strip non-numeric except - and .
  const num = parseFloat(str)
  return isNaN(num) ? 0 : num
}

/**
 * Normalize status to internal status (completed/pending/cancelled)
 * Now supports Thai keywords from TikTok Order Status/Substatus
 */
function normalizeStatus(orderStatus?: string, orderSubstatus?: string): string {
  // Check Order Substatus first (more specific)
  if (orderSubstatus) {
    const sub = orderSubstatus.toLowerCase()
    // Thai: ยกเลิกคำสั่งซื้อ, คืนสินค้า, ยกเลิก
    if (sub.includes('ยกเลิก') || sub.includes('คืนสินค้า')) return 'cancelled'
    // Thai: จัดส่งแล้ว, ส่งสำเร็จ, จัดส่งสำเร็จ
    if (sub.includes('จัดส่งแล้ว') || sub.includes('ส่งสำเร็จ') || sub.includes('จัดส่งสำเร็จ')) return 'completed'
  }

  // Check Order Status (broader category)
  if (orderStatus) {
    const status = orderStatus.toLowerCase()
    // Thai: ยกเลิกแล้ว
    if (status.includes('ยกเลิก')) return 'cancelled'
    // English fallbacks
    if (status.includes('delivered') || status.includes('completed')) return 'completed'
    if (status.includes('cancel') || status.includes('return')) return 'cancelled'
  }

  // Default to pending for orders that are "รอจัดส่ง", "อยู่ระหว่างงานขนส่ง", etc.
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
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null, header: 1 }) as unknown[][]

  if (rows.length < 2) return false

  const headerRow = rows[0]

  // Check for required TikTok columns
  const requiredColumns = ['Order ID', 'Product Name', 'Quantity', 'Created Time']
  const hasRequired = requiredColumns.every(col =>
    headerRow.some((cell: unknown) => String(cell).trim() === col)
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

  } catch (error: unknown) {
    console.error('Parse sales file error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      importType: 'generic',
      totalRows: 0,
      sampleRows: [],
      summary: { totalRevenue: 0, totalOrders: 0, uniqueOrderIds: 0, lineCount: 0 },
      errors: [{ message: `Error: ${errorMessage}`, severity: 'error' }],
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
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null }) as Record<string, unknown>[]

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

      // Parse status (TikTok columns)
      const orderStatus = row['Order Status'] as string | undefined // ที่จัดส่ง, ชำระเงินแล้ว, ยกเลิกแล้ว
      const orderSubstatus = row['Order Substatus'] as string | undefined // รอจัดส่ง, อยู่ระหว่างงานขนส่ง, ยกเลิกคำสั่งซื้อ

      // Internal status for business logic (completed/pending/cancelled)
      const status = normalizeStatus(orderStatus, orderSubstatus)

      // Parse fulfillment timestamps
      const paidTime = parseExcelDate(row['Paid Time'])
      const shippedTime = parseExcelDate(row['Shipped Time'])
      const deliveredTime = parseExcelDate(row['Delivered Time'])
      const cancelledTime = parseExcelDate(row['Cancelled Time'])

      // Derive payment status
      const paymentStatus = paidTime ? 'paid' : 'unpaid'

      // Build metadata for extended TikTok data
      const toStringOrNull = (val: unknown): string | null => val ? String(val) : null
      const metadata: Record<string, string | null> = {
        source_report: 'OrderSKUList',
        variation: toStringOrNull(row['Variation']),
        cancelled_time: cancelledTime ? toBangkokDatetime(cancelledTime) : null,
        cancel_reason: toStringOrNull(row['Cancel Reason']),
        tracking_id: toStringOrNull(row['Tracking ID']),
        payment_method: toStringOrNull(row['Payment Method']),
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
        status, // Internal status (completed/pending/cancelled)
        metadata,
        rowNumber,

        // UX v2: Platform-specific fields
        source_platform: 'tiktok_shop',
        external_order_id: String(orderId).trim(),
        // FIX: platform_status = Order Substatus (รอจัดส่ง, อยู่ระหว่างงานขนส่ง) - MAIN UI STATUS
        platform_status: orderSubstatus ? String(orderSubstatus).trim() : null,
        // NEW: status_group = Order Status (ที่จัดส่ง, ชำระเงินแล้ว, ยกเลิกแล้ว) - Group filter
        status_group: orderStatus ? String(orderStatus).trim() : null,
        platform_substatus: null, // Deprecated
        payment_status: paymentStatus,
        paid_at: paidTime ? toBangkokDatetime(paidTime) : null,
        shipped_at: shippedTime ? toBangkokDatetime(shippedTime) : null,
        delivered_at: deliveredTime ? toBangkokDatetime(deliveredTime) : null,
        seller_sku: row['Seller SKU'] ? String(row['Seller SKU']).trim() : null,
        sku_id: row['SKU ID'] ? String(row['SKU ID']).trim() : null,
      })

      uniqueOrderIds.add(String(orderId).trim())

      // Only count revenue for completed orders
      if (status === 'completed') {
        totalRevenue += lineRevenue
      }

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      errors.push({
        row: rowNumber,
        message: `Parse error: ${errorMessage}`,
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

/**
 * Create import batch and prepare for chunked import
 */
export async function createImportBatch(
  fileHash: string,
  fileName: string,
  totalRows: number,
  dateRange: string
): Promise<{ success: boolean; batchId?: string; error?: string }> {
  const supabase = createClient()

  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return {
        success: false,
        error: 'Authentication required',
      }
    }

    // Check for duplicate import
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
      }
    }

    // Create import batch record
    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        file_hash: fileHash,
        marketplace: 'tiktok_shop',
        report_type: 'sales_order_sku_list',
        period: dateRange,
        file_name: fileName,
        row_count: totalRows,
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
      }
    }

    return {
      success: true,
      batchId: batch.id,
    }
  } catch (error: unknown) {
    console.error('Create batch error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Import a chunk of sales data
 */
export async function importSalesChunk(
  batchId: string,
  chunkData: ParsedSalesRow[],
  chunkIndex: number,
  totalChunks: number
): Promise<{ success: boolean; inserted: number; error?: string }> {
  const supabase = createClient()

  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return {
        success: false,
        inserted: 0,
        error: 'Authentication required',
      }
    }

    // Insert sales orders (chunk) with order_line_hash for deduplication
    const salesRows = chunkData.map((row) => {
      const orderLineHash = generateOrderLineHash(
        user.id,
        row.source_platform || row.marketplace || '',
        row.external_order_id || row.order_id || '',
        row.product_name || '',
        row.quantity || 0,
        row.total_amount || 0
      )

      return {
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
        order_line_hash: orderLineHash,
        source: 'imported',
        import_batch_id: batchId,
        metadata: row.metadata || {},
        created_by: user.id,

        // UX v2: Platform-specific fields
        source_platform: row.source_platform,
        external_order_id: row.external_order_id,
        platform_status: row.platform_status,
        status_group: row.status_group,
        platform_substatus: row.platform_substatus,
        payment_status: row.payment_status,
        paid_at: row.paid_at,
        shipped_at: row.shipped_at,
        delivered_at: row.delivered_at,
        seller_sku: row.seller_sku,
        sku_id: row.sku_id,
      }
    })

    // Insert with duplicate detection
    let insertedCount = 0
    let skippedCount = 0

    const { data: insertedRows, error: insertError } = await supabase
      .from('sales_orders')
      .insert(salesRows)
      .select()

    if (insertError) {
      // Check if it's a duplicate key error
      if (insertError.code === '23505' || insertError.message.includes('duplicate')) {
        console.log(
          `Duplicate orders detected in chunk ${chunkIndex + 1}/${totalChunks}, inserting individually...`
        )

        // Insert one by one to identify duplicates
        for (const row of salesRows) {
          const { data, error } = await supabase.from('sales_orders').insert(row).select()

          if (error) {
            if (error.code === '23505' || error.message.includes('duplicate')) {
              skippedCount++
            } else {
              console.error('Insert order error:', error)
            }
          } else if (data && data.length > 0) {
            insertedCount++
          }
        }
      } else {
        // Other error - fail the chunk
        console.error(`Insert error (chunk ${chunkIndex + 1}/${totalChunks}):`, insertError)
        return {
          success: false,
          inserted: 0,
          skipped: 0,
          error: `Insert failed: ${insertError.message}`,
        }
      }
    } else {
      // Bulk insert succeeded - no duplicates
      insertedCount = insertedRows?.length || 0
    }

    return {
      success: true,
      inserted: insertedCount,
      skipped: skippedCount,
    }
  } catch (error: unknown) {
    console.error('Import chunk error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      inserted: 0,
      error: errorMessage,
    }
  }
}

/**
 * Finalize import batch after all chunks are imported
 */
export async function finalizeImportBatch(
  batchId: string,
  totalInserted: number,
  parsedData: ParsedSalesRow[]
): Promise<SalesImportResult> {
  const supabase = createClient()

  try {
    // Post-insert verification: Count actual rows in database
    const { count: actualCount } = await supabase
      .from('sales_orders')
      .select('*', { count: 'exact', head: true })
      .eq('import_batch_id', batchId)

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
        .eq('id', batchId)

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
        notes: `Successfully imported ${verifiedCount} rows (chunked import)`,
      })
      .eq('id', batchId)

    // Calculate summary
    const totalRevenue = parsedData
      .filter(r => r.status === 'completed')
      .reduce((sum, r) => sum + r.total_amount, 0)

    const uniqueOrders = new Set(parsedData.map(r => r.order_id)).size

    const dateRange = parsedData.length > 0
      ? `${parsedData[0].order_date} to ${parsedData[parsedData.length - 1].order_date}`
      : 'N/A'

    return {
      success: true,
      batchId: batchId,
      inserted: verifiedCount,
      skipped: 0,
      errors: 0,
      summary: {
        dateRange,
        totalRevenue,
        orderCount: uniqueOrders,
      },
    }
  } catch (error: unknown) {
    console.error('Finalize batch error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: errorMessage,
      inserted: 0,
      skipped: 0,
      errors: 0,
    }
  }
}

/**
 * Legacy: Import all at once (for backward compatibility)
 * @deprecated Use chunked import instead (createImportBatch + importSalesChunk + finalizeImportBatch)
 */
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

    // Insert sales orders (line-level) with UX v2 fields and order_line_hash
    const salesRows = parsedData.map((row) => {
      const orderLineHash = generateOrderLineHash(
        user.id,
        row.source_platform || row.marketplace || '',
        row.external_order_id || row.order_id || '',
        row.product_name || '',
        row.quantity || 0,
        row.total_amount || 0
      )

      return {
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
        order_line_hash: orderLineHash,
        source: 'imported',
        import_batch_id: batch.id,
        metadata: row.metadata || {},
        created_by: user.id,

        // UX v2: Platform-specific fields
        source_platform: row.source_platform,
        external_order_id: row.external_order_id,
        platform_status: row.platform_status,
        status_group: row.status_group,
        platform_substatus: row.platform_substatus,
        payment_status: row.payment_status,
        paid_at: row.paid_at,
        shipped_at: row.shipped_at,
        delivered_at: row.delivered_at,
        seller_sku: row.seller_sku,
        sku_id: row.sku_id,
      }
    })

    // Insert with duplicate detection
    let insertedCount = 0
    let skippedCount = 0

    const { data: insertedRows, error: insertError } = await supabase
      .from('sales_orders')
      .insert(salesRows)
      .select()

    if (insertError) {
      // Check if it's a duplicate key error
      if (insertError.code === '23505' || insertError.message.includes('duplicate')) {
        console.log('Duplicate orders detected, inserting individually...')

        // Insert one by one to identify duplicates
        for (const row of salesRows) {
          const { data, error } = await supabase.from('sales_orders').insert(row).select()

          if (error) {
            if (error.code === '23505' || error.message.includes('duplicate')) {
              skippedCount++
            } else {
              console.error('Insert order error:', error)
            }
          } else if (data && data.length > 0) {
            insertedCount++
          }
        }
      } else {
        // Other error - fail the import
        console.error('Insert error:', insertError)

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
    } else {
      // Bulk insert succeeded - no duplicates
      insertedCount = insertedRows?.length || 0
    }

    // Check if any rows were inserted
    if (insertedCount === 0 && skippedCount === 0) {
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
    const statusMessage =
      skippedCount > 0
        ? `Imported ${insertedCount} rows (${skippedCount} duplicates skipped)`
        : `Successfully imported ${insertedCount} rows`

    await supabase
      .from('import_batches')
      .update({
        status: 'success',
        inserted_count: insertedCount,
        skipped_count: skippedCount,
        notes: statusMessage,
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
      skipped: skippedCount,
      errors: 0,
      summary: {
        dateRange,
        totalRevenue,
        orderCount: uniqueOrders,
      },
    }

  } catch (error: unknown) {
    console.error('Import sales error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: errorMessage,
      inserted: 0,
      skipped: 0,
      errors: 0,
    }
  }
}
