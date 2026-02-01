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

      // Parse order-level fields (same across all SKU rows for same order_id)
      const orderAmount = normalizeNumber(row['Order Amount'])
      const shippingFeeAfterDiscount = normalizeNumber(row['Shipping Fee After Discount'])
      const originalShippingFee = normalizeNumber(row['Original Shipping Fee'])
      const shippingFeeSellerDiscount = normalizeNumber(row['Shipping Fee Seller Discount'])
      const shippingFeePlatformDiscount = normalizeNumber(row['Shipping Fee Platform Discount'])
      const paymentPlatformDiscount = normalizeNumber(row['Payment platform discount'])
      const taxes = normalizeNumber(row['Taxes'])
      const smallOrderFee = normalizeNumber(row['Small Order Fee'])

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

        // Order-level fields (duplicated across SKU rows - handled by view)
        order_amount: orderAmount || null,
        shipping_fee_after_discount: shippingFeeAfterDiscount || null,
        original_shipping_fee: originalShippingFee || null,
        shipping_fee_seller_discount: shippingFeeSellerDiscount || null,
        shipping_fee_platform_discount: shippingFeePlatformDiscount || null,
        payment_platform_discount: paymentPlatformDiscount || null,
        taxes: taxes || null,
        small_order_fee: smallOrderFee || null,
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
 * @param formData - FormData containing: fileHash, fileName, totalRows, dateRange, allowReimport
 */
export async function createImportBatch(
  formData: FormData
): Promise<{
  success: boolean;
  batchId?: string;
  error?: string;
  status?: 'duplicate_file' | 'already_processing' | 'created';
  fileName?: string;
  importedAt?: string;
  createdAt?: string;
  message?: string;
  // For duplicate_file: existing batch info for replace operation
  existingBatchId?: string;
  existingRowCount?: number;
}> {
  const supabase = createClient()

  // GUARD: Log Supabase URL for debugging
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'NOT_SET'
  console.log(`[createImportBatch] Starting import, Project: ${supabaseUrl.replace(/https?:\/\//, '').split('.')[0]}`)

  try {
    // Extract values from FormData
    const fileHash = formData.get('fileHash') as string
    const fileName = formData.get('fileName') as string
    const totalRows = parseInt(formData.get('totalRows') as string, 10)
    const dateRange = formData.get('dateRange') as string
    const allowReimport = formData.get('allowReimport') === 'true'

    console.log(`[createImportBatch] File: ${fileName}, Rows: ${totalRows}, AllowReimport: ${allowReimport}`)

    // Validate required fields
    if (!fileHash || !fileName || isNaN(totalRows)) {
      return {
        success: false,
        error: 'Missing required fields: fileHash, fileName, or totalRows',
      }
    }

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return {
        success: false,
        error: 'Authentication required',
      }
    }

    // STEP 2: Smart Deduplication - Check file_hash with actual DB verification
    if (!allowReimport) {
      console.log(`[createImportBatch][DEDUP] Checking for existing imports with file_hash: ${fileHash.substring(0, 16)}...`)

      // Find latest batch with this file_hash (any status)
      const { data: existingBatch, error: checkError } = await supabase
        .from('import_batches')
        .select('id, file_name, created_at, status, inserted_count')
        .eq('file_hash', fileHash)
        .eq('marketplace', 'tiktok_shop')
        .eq('report_type', 'sales_order_sku_list')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingBatch) {
        console.log(`[createImportBatch][DEDUP] Found existing batch: ${existingBatch.id}`)
        console.log(`[createImportBatch][DEDUP] Status: ${existingBatch.status}, Claimed inserted_count: ${existingBatch.inserted_count}`)

        // CRITICAL: Verify actual rows in sales_orders (source of truth)
        const { count: actualRowCount, error: countError } = await supabase
          .from('sales_orders')
          .select('*', { count: 'exact', head: true })
          .eq('import_batch_id', existingBatch.id)

        const verifiedCount = actualRowCount || 0
        console.log(`[createImportBatch][DEDUP] Verified rows in sales_orders: ${verifiedCount}`)

        if (countError) {
          console.error(`[createImportBatch][DEDUP] Count verification failed:`, countError)
          // Fail safe: block if we can't verify
          return {
            success: false,
            status: 'duplicate_file',
            fileName: existingBatch.file_name || fileName,
            importedAt: existingBatch.created_at,
            message: 'ไฟล์นี้ถูก import ไปแล้ว (ไม่สามารถตรวจสอบข้อมูลได้)'
          }
        }

        // CASE 1: Has actual data in DB → BLOCK (with replace option)
        if (verifiedCount > 0) {
          console.log(`[createImportBatch][DECISION] ❌ BLOCK - File has ${verifiedCount} rows in DB`)
          return {
            success: false,
            status: 'duplicate_file',
            fileName: existingBatch.file_name || fileName,
            importedAt: existingBatch.created_at,
            message: `ไฟล์นี้ถูก import ไปแล้ว (${verifiedCount} รายการในระบบ)`,
            // For replace operation
            existingBatchId: existingBatch.id,
            existingRowCount: verifiedCount,
          }
        }

        // CASE 2: No actual data in DB (orphaned batch) → ALLOW AUTO RE-IMPORT
        console.log(`[createImportBatch][DECISION] ⚠️ ALLOW AUTO REIMPORT - Previous batch ${existingBatch.id} has 0 rows in DB (orphaned)`)
        console.log(`[createImportBatch][DECISION] Reason: Batch status=${existingBatch.status}, claimed=${existingBatch.inserted_count} but actual=0`)
        // Fall through to create new batch
      } else {
        console.log(`[createImportBatch][DEDUP] No existing batch found for this file_hash`)
      }
    } else {
      console.log(`[createImportBatch][DECISION] ✅ ALLOW REIMPORT - User confirmed (allowReimport=true)`)
    }

    // STEP 3: Check for existing PROCESSING batch (within last 30 min)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: existingProcessing, error: procError } = await supabase
      .from('import_batches')
      .select('id, created_at, file_name')
      .eq('file_hash', fileHash)
      .eq('marketplace', 'tiktok_shop')
      .eq('report_type', 'sales_order_sku_list')
      .eq('created_by', user.id)
      .eq('status', 'processing')
      .gte('created_at', thirtyMinAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingProcessing) {
      // Import already in progress
      return {
        success: false,
        status: 'already_processing',
        batchId: existingProcessing.id,
        fileName: existingProcessing.file_name || fileName,
        createdAt: existingProcessing.created_at,
        message: 'กำลัง import ไฟล์นี้อยู่ กรุณารอสักครู่'
      }
    }

    // Re-import mode: log for audit (only if allowReimport=true)
    if (allowReimport) {
      console.log(`[RE-IMPORT] User: ${user.id} | File: ${fileName} | FileHash: ${fileHash.substring(0, 8)}...`)
    }

    // STEP 4: NOW create new batch
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
      console.error('[createImportBatch] Batch creation error:', batchError)
      return {
        success: false,
        error: 'Failed to create import batch',
      }
    }

    console.log(`[createImportBatch] ✓ Batch created: ${batch.id} (${batch.id.substring(0, 8)}...)`)

    return {
      success: true,
      status: 'created',
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
 * Replace existing import batch with new import
 * Deletes all sales_orders for the existing batch and marks it as replaced
 * @param formData - FormData containing: existingBatchId, marketplace, reportType, fileHash
 */
export async function replaceSalesImportBatch(
  formData: FormData
): Promise<{
  success: boolean;
  error?: string;
  deletedCount?: number;
}> {
  const supabase = createClient()

  try {
    // Extract values from FormData
    const existingBatchId = formData.get('existingBatchId') as string
    const marketplace = formData.get('marketplace') as string
    const reportType = formData.get('reportType') as string
    const fileHash = formData.get('fileHash') as string

    console.log(`[replaceSalesImportBatch] ━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`[replaceSalesImportBatch] START - Replace existing batch`)
    console.log(`[replaceSalesImportBatch] Batch ID: ${existingBatchId}`)
    console.log(`[replaceSalesImportBatch] Marketplace: ${marketplace}`)
    console.log(`[replaceSalesImportBatch] Report Type: ${reportType}`)
    console.log(`[replaceSalesImportBatch] File Hash: ${fileHash.substring(0, 16)}...`)

    // Validate required fields
    if (!existingBatchId || !marketplace || !reportType || !fileHash) {
      return {
        success: false,
        error: 'Missing required fields: existingBatchId, marketplace, reportType, or fileHash',
      }
    }

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return {
        success: false,
        error: 'Authentication required',
      }
    }

    // SAFETY: Verify this batch belongs to the user and matches file_hash
    const { data: existingBatch, error: verifyError } = await supabase
      .from('import_batches')
      .select('id, file_hash, created_by, file_name, inserted_count')
      .eq('id', existingBatchId)
      .eq('marketplace', marketplace)
      .eq('report_type', reportType)
      .eq('created_by', user.id)
      .single()

    if (verifyError || !existingBatch) {
      console.error('[replaceSalesImportBatch] Batch verification failed:', verifyError)
      return {
        success: false,
        error: 'Existing batch not found or unauthorized',
      }
    }

    if (existingBatch.file_hash !== fileHash) {
      console.error('[replaceSalesImportBatch] File hash mismatch!')
      return {
        success: false,
        error: 'File hash mismatch - cannot replace different file',
      }
    }

    console.log(`[replaceSalesImportBatch] ✓ Batch verified: ${existingBatch.file_name}`)

    // STEP 1: Delete all sales_orders for this batch
    console.log(`[replaceSalesImportBatch] STEP 1: Deleting sales_orders...`)
    const { error: deleteError, count: deletedCount } = await supabase
      .from('sales_orders')
      .delete({ count: 'exact' })
      .eq('import_batch_id', existingBatchId)
      .eq('created_by', user.id) // Safety: only delete user's own data

    if (deleteError) {
      console.error('[replaceSalesImportBatch] Delete failed:', deleteError)
      return {
        success: false,
        error: `Failed to delete existing data: ${deleteError.message}`,
      }
    }

    console.log(`[replaceSalesImportBatch] ✓ Deleted ${deletedCount || 0} rows from sales_orders`)

    // STEP 2: Mark batch as replaced
    console.log(`[replaceSalesImportBatch] STEP 2: Marking batch as replaced...`)
    const replacedAt = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('import_batches')
      .update({
        status: 'replaced',
        notes: `Replaced by re-import at ${replacedAt}. Original count: ${existingBatch.inserted_count || 0}`,
        updated_at: replacedAt,
      })
      .eq('id', existingBatchId)

    if (updateError) {
      console.error('[replaceSalesImportBatch] Update batch failed:', updateError)
      // Non-fatal: data already deleted, just log warning
      console.warn('[replaceSalesImportBatch] WARNING: Batch status not updated but data deleted')
    } else {
      console.log(`[replaceSalesImportBatch] ✓ Batch marked as replaced`)
    }

    console.log(`[replaceSalesImportBatch] ✅ REPLACE SUCCESS`)
    console.log(`[replaceSalesImportBatch] ━━━━━━━━━━━━━━━━━━━━━━━━`)

    return {
      success: true,
      deletedCount: deletedCount || 0,
    }
  } catch (error: unknown) {
    console.error('[replaceSalesImportBatch] Unexpected error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Import a chunk of sales data
 * @param formData - FormData containing: batchId, chunkDataJson, chunkIndex, totalChunks
 */
export async function importSalesChunk(
  formData: FormData
): Promise<{ success: boolean; inserted: number; error?: string }> {
  const supabase = createClient()

  // GUARD: Log Supabase URL for debugging
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'NOT_SET'

  try {
    // Extract values from FormData
    const batchId = formData.get('batchId') as string
    const chunkDataJson = formData.get('chunkDataJson') as string
    const chunkIndex = parseInt(formData.get('chunkIndex') as string, 10)
    const totalChunks = parseInt(formData.get('totalChunks') as string, 10)

    // DEFINITIVE LOG: Function entry point
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`[importSalesChunk] ✓ ENTER - Function called successfully`)
    console.log(`[importSalesChunk] Batch ID: ${batchId}`)
    console.log(`[importSalesChunk] Chunk: ${chunkIndex + 1}/${totalChunks}`)
    console.log(`[importSalesChunk] Data size: ${chunkDataJson?.length || 0} bytes`)
    console.log(`[importSalesChunk] Project: ${supabaseUrl.replace(/https?:\/\//, '').split('.')[0]}`)
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

    // DEBUG MODE (LOG ONLY — NO THROW)
    // Set SALES_IMPORT_DEBUG_THROW=1 to see function execution without breaking import
    if (process.env.SALES_IMPORT_DEBUG_THROW === '1') {
      console.log(`[importSalesChunk] 🔍 DEBUG MODE ACTIVE: Function executed successfully (chunk ${chunkIndex + 1}/${totalChunks})`)
      console.log(`[importSalesChunk] 🔍 DEBUG: Continuing with normal import flow...`)
    }

    // Validate required fields
    if (!batchId || !chunkDataJson || isNaN(chunkIndex) || isNaN(totalChunks)) {
      // Mark batch as failed
      if (batchId) {
        await supabase
          .from('import_batches')
          .update({
            status: 'failed',
            notes: 'Chunk import failed: Missing required fields'
          })
          .eq('id', batchId)
      }

      return {
        success: false,
        inserted: 0,
        error: 'Missing required fields: batchId, chunkDataJson, chunkIndex, or totalChunks',
      }
    }

    // Parse JSON string to array
    const chunkData: ParsedSalesRow[] = JSON.parse(chunkDataJson)

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      // Mark batch as failed
      await supabase
        .from('import_batches')
        .update({
          status: 'failed',
          notes: 'Authentication failed during chunk import'
        })
        .eq('id', batchId)

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

        // TikTok Business Timestamps (from parser)
        created_time: row.created_time,
        paid_time: row.paid_time,
        cancelled_time: row.cancelled_time,

        // Order-level fields (TikTok OrderSKUList)
        order_amount: row.order_amount,
        shipping_fee_after_discount: row.shipping_fee_after_discount,
        original_shipping_fee: row.original_shipping_fee,
        shipping_fee_seller_discount: row.shipping_fee_seller_discount,
        shipping_fee_platform_discount: row.shipping_fee_platform_discount,
        payment_platform_discount: row.payment_platform_discount,
        taxes: row.taxes,
        small_order_fee: row.small_order_fee,
      }
    })

    // Upsert with idempotency (safe field updates on conflict)
    let insertedCount = 0
    let updatedCount = 0

    console.log(`[importSalesChunk] Upserting ${salesRows.length} rows...`)

    const { data: upsertedRows, error: upsertError } = await supabase
      .from('sales_orders')
      .upsert(salesRows, {
        onConflict: 'created_by,order_line_hash',
        ignoreDuplicates: false, // Update existing rows
      })
      .select()

    if (upsertError) {
      console.error(`[importSalesChunk] Upsert error (chunk ${chunkIndex + 1}/${totalChunks}):`, upsertError)
      console.error(`[importSalesChunk] Error details:`, {
        code: upsertError.code,
        message: upsertError.message,
        details: upsertError.details,
        hint: upsertError.hint
      })

      // Mark batch as failed
      await supabase
        .from('import_batches')
        .update({
          status: 'failed',
          notes: `Chunk ${chunkIndex + 1}/${totalChunks} failed: ${upsertError.message}. Code: ${upsertError.code}. Batch: ${batchId}`
        })
        .eq('id', batchId)

      return {
        success: false,
        inserted: 0,
        error: `Upsert failed: ${upsertError.message} (Code: ${upsertError.code})`,
      }
    }

    // Count inserted rows (new rows have been created)
    // Note: Supabase upsert doesn't distinguish between insert and update
    // We'll count all returned rows as processed
    insertedCount = upsertedRows?.length || 0

    console.log(`[importSalesChunk] ✓ Upsert completed: ${insertedCount} rows processed`)

    // GUARD: Warn if returned count doesn't match expected
    if (insertedCount !== salesRows.length) {
      console.warn(`[importSalesChunk] WARNING: Upsert returned ${insertedCount} rows but expected ${salesRows.length}`)
    }

    return {
      success: true,
      inserted: insertedCount,
    }
  } catch (error: unknown) {
    console.error('Import chunk error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Mark batch as failed
    const batchId = formData.get('batchId') as string
    if (batchId) {
      await supabase
        .from('import_batches')
        .update({
          status: 'failed',
          notes: `Chunk import error: ${errorMessage}`
        })
        .eq('id', batchId)
    }

    return {
      success: false,
      inserted: 0,
      error: errorMessage,
    }
  }
}

/**
 * Finalize import batch after all chunks are imported
 * @param formData - FormData containing: batchId, totalInserted, parsedDataJson
 */
export async function finalizeImportBatch(
  formData: FormData
): Promise<SalesImportResult> {
  const supabase = createClient()

  // GUARD: Log Supabase URL for debugging environment mismatches
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'NOT_SET'

  try {
    // Extract values from FormData
    const batchId = formData.get('batchId') as string
    const totalInserted = parseInt(formData.get('totalInserted') as string, 10)
    const parsedDataJson = formData.get('parsedDataJson') as string

    // DEFINITIVE LOG: Function entry point
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`[finalizeImportBatch] ✓ ENTER - Function called successfully`)
    console.log(`[finalizeImportBatch] Batch ID: ${batchId}`)
    console.log(`[finalizeImportBatch] Total Inserted: ${totalInserted}`)
    console.log(`[finalizeImportBatch] Data size: ${parsedDataJson?.length || 0} bytes`)
    console.log(`[finalizeImportBatch] Project: ${supabaseUrl.replace(/https?:\/\//, '').split('.')[0]}`)
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

    // DEBUG MODE (LOG ONLY — NO THROW)
    // Set SALES_IMPORT_DEBUG_THROW=1 to see function execution without breaking import
    if (process.env.SALES_IMPORT_DEBUG_THROW === '1') {
      console.log(`[finalizeImportBatch] 🔍 DEBUG MODE ACTIVE: Function executed successfully`)
      console.log(`[finalizeImportBatch] 🔍 DEBUG: Continuing with verification and finalization...`)
    }

    // Validate required fields
    if (!batchId || isNaN(totalInserted) || !parsedDataJson) {
      // Mark batch as failed before returning
      if (batchId) {
        await supabase
          .from('import_batches')
          .update({
            status: 'failed',
            notes: `Finalization failed: Missing required fields. Project: ${supabaseUrl.split('.')[0]}`
          })
          .eq('id', batchId)
      }

      return {
        success: false,
        error: 'Missing required fields: batchId, totalInserted, or parsedDataJson',
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
      }
    }

    // Parse JSON string to array
    const parsedData: ParsedSalesRow[] = JSON.parse(parsedDataJson)

    // CRITICAL: Post-insert verification - Count actual rows in database
    // This is the ONLY source of truth for success/failure
    console.log(`[finalizeImportBatch][VERIFY] ━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`[finalizeImportBatch][VERIFY] Batch: ${batchId.substring(0, 8)}...`)
    console.log(`[finalizeImportBatch][VERIFY] Expected rows: ${parsedData.length}`)
    console.log(`[finalizeImportBatch][VERIFY] Querying sales_orders...`)

    const { count: actualCount, error: countError } = await supabase
      .from('sales_orders')
      .select('*', { count: 'exact', head: true })
      .eq('import_batch_id', batchId)

    const verifiedCount = actualCount || 0

    console.log(`[finalizeImportBatch][VERIFY] Result: expected=${parsedData.length}, actual=${verifiedCount}`)
    console.log(`[finalizeImportBatch][VERIFY] Count error: ${countError?.message || 'none'}`)
    console.log(`[finalizeImportBatch][VERIFY] ━━━━━━━━━━━━━━━━━━━━━━━━`)

    if (countError) {
      console.error('[finalizeImportBatch][VERIFY] ❌ Count verification ERROR:', countError)
      // Mark batch as failed
      await supabase
        .from('import_batches')
        .update({
          status: 'failed',
          notes: `Verification error: ${countError.message}. Project: ${supabaseUrl.split('.')[0]}. Batch: ${batchId}`
        })
        .eq('id', batchId)

      return {
        success: false,
        error: `Verification failed: ${countError.message}`,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: parsedData.length,
      }
    }

    // CRITICAL CHECK: Verify rows actually exist in database
    // This prevents false success when import silently fails
    if (verifiedCount === 0) {
      console.error(`[finalizeImportBatch][VERIFY] ❌❌❌ CRITICAL: 0 rows found in DB`)
      console.error(`[finalizeImportBatch][VERIFY] Expected: ${parsedData.length} rows`)
      console.error(`[finalizeImportBatch][VERIFY] Got: 0 rows`)
      console.error(`[finalizeImportBatch][VERIFY] Project: ${supabaseUrl}`)
      console.error(`[finalizeImportBatch][VERIFY] Batch ID: ${batchId}`)

      // DOUBLE-CHECK: Query one more time to be absolutely sure
      console.log(`[finalizeImportBatch][VERIFY] Running double-check query...`)
      const { data: doubleCheckRows, error: doubleCheckError } = await supabase
        .from('sales_orders')
        .select('id')
        .eq('import_batch_id', batchId)
        .limit(1)

      const doubleCheckCount = doubleCheckRows?.length || 0
      console.error(`[finalizeImportBatch][VERIFY] Double-check result: ${doubleCheckCount} rows found`)

      if (doubleCheckCount === 0) {
        console.error(`[finalizeImportBatch][DECISION] ❌ FAIL IMPORT - 0 rows verified in DB`)
      }

      // No rows inserted (possible RLS block, auth failure, or environment mismatch)
      await supabase
        .from('import_batches')
        .update({
          status: 'failed',
          inserted_count: 0,
          error_count: parsedData.length,
          notes: `Import failed: 0 rows verified in DB (expected ${parsedData.length}). Possible causes: RLS block, auth error, or wrong Supabase project. Project: ${supabaseUrl.split('.')[0]}. Batch: ${batchId}`,
        })
        .eq('id', batchId)

      return {
        success: false,
        error: `Import failed: 0 rows inserted into database.\n\nExpected: ${parsedData.length} rows\nVerified: 0 rows\nBatch ID: ${batchId.substring(0, 8)}...\nProject: ${supabaseUrl.split('.')[0]}\n\nกรุณาตรวจสอบว่าคุณกำลังใช้ Supabase project ที่ถูกต้อง หรือติดต่อผู้ดูแลระบบ`,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: parsedData.length,
      }
    }

    console.log(`[finalizeImportBatch][VERIFY] ✅ Verification PASSED: ${verifiedCount} rows confirmed in DB`)
    console.log(`[finalizeImportBatch][DECISION] ✅ IMPORT SUCCESS`)

    // Calculate date range and determine date basis
    let dateMin: string | null = null
    let dateMax: string | null = null
    let dateBasisUsed: 'order_date' | 'paid_at' = 'order_date'

    // Check if most rows have paid_at
    const paidAtCount = parsedData.filter(r => r.paid_at).length
    const paidAtRatio = paidAtCount / parsedData.length

    // Use paid_at as basis if >50% of rows have it
    if (paidAtRatio > 0.5) {
      dateBasisUsed = 'paid_at'
      const paidDates = parsedData
        .filter(r => r.paid_at)
        .map(r => r.paid_at!.split(' ')[0]) // Extract date part
        .sort()
      if (paidDates.length > 0) {
        dateMin = paidDates[0]
        dateMax = paidDates[paidDates.length - 1]
      }
    } else {
      // Use order_date as basis
      dateBasisUsed = 'order_date'
      const orderDates = parsedData
        .filter(r => r.order_date)
        .map(r => r.order_date.split(' ')[0]) // Extract date part
        .sort()
      if (orderDates.length > 0) {
        dateMin = orderDates[0]
        dateMax = orderDates[orderDates.length - 1]
      }
    }

    // Calculate insert vs skip counts
    // verifiedCount = actual rows in DB (unique lines after deduplication)
    // parsedData.length = total lines attempted to import
    // skipped = lines that were duplicates (blocked by order_line_hash unique constraint)
    const insertedCount = verifiedCount
    const skippedCount = Math.max(0, parsedData.length - verifiedCount)
    const updatedCount = 0 // Upsert with ON CONFLICT DO NOTHING doesn't update

    // Update batch status to success with date tracking
    const { error: updateError } = await supabase
      .from('import_batches')
      .update({
        status: 'success',
        inserted_count: insertedCount,
        updated_count: updatedCount,
        skipped_count: skippedCount,
        date_min: dateMin,
        date_max: dateMax,
        date_basis_used: dateBasisUsed,
        notes: `Successfully imported ${insertedCount} rows (skipped ${skippedCount} duplicates, basis: ${dateBasisUsed})`,
      })
      .eq('id', batchId)

    if (updateError) {
      console.error('Failed to update batch status:', updateError)
      // Still mark as failed to avoid stuck processing
      await supabase
        .from('import_batches')
        .update({
          status: 'failed',
          notes: `Status update error: ${updateError.message}`
        })
        .eq('id', batchId)

      return {
        success: false,
        error: 'Failed to finalize import batch',
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: parsedData.length,
      }
    }

    // Calculate summary
    const totalRevenue = parsedData
      .filter(r => r.status === 'completed')
      .reduce((sum, r) => sum + r.total_amount, 0)

    const uniqueOrders = new Set(parsedData.map(r => r.order_id)).size

    const dateRangeString = dateMin && dateMax
      ? `${dateMin} to ${dateMax}`
      : 'N/A'

    return {
      success: true,
      batchId: batchId,
      inserted: insertedCount,
      updated: updatedCount,
      skipped: skippedCount,
      errors: 0,
      dateBasisUsed,
      dateRange: dateMin && dateMax ? { min: dateMin, max: dateMax } : undefined,
      summary: {
        dateRange: dateRangeString,
        totalRevenue,
        orderCount: uniqueOrders,
      },
    }
  } catch (error: unknown) {
    console.error('Finalize batch error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Mark batch as failed to avoid stuck processing
    const batchId = formData.get('batchId') as string
    if (batchId) {
      await supabase
        .from('import_batches')
        .update({
          status: 'failed',
          notes: `Unexpected error: ${errorMessage}`
        })
        .eq('id', batchId)
    }

    return {
      success: false,
      error: errorMessage,
      inserted: 0,
      updated: 0,
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
        updated: 0,
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
        updated: 0,
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
        updated: 0,
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

        // TikTok Business Timestamps (from parser)
        created_time: row.created_time,
        paid_time: row.paid_time,
        cancelled_time: row.cancelled_time,

        // Order-level fields (TikTok OrderSKUList)
        order_amount: row.order_amount,
        shipping_fee_after_discount: row.shipping_fee_after_discount,
        original_shipping_fee: row.original_shipping_fee,
        shipping_fee_seller_discount: row.shipping_fee_seller_discount,
        shipping_fee_platform_discount: row.shipping_fee_platform_discount,
        payment_platform_discount: row.payment_platform_discount,
        taxes: row.taxes,
        small_order_fee: row.small_order_fee,
      }
    })

    // Upsert with idempotency (safe field updates on conflict)
    let insertedCount = 0

    const { data: upsertedRows, error: upsertError } = await supabase
      .from('sales_orders')
      .upsert(salesRows, {
        onConflict: 'created_by,order_line_hash',
        ignoreDuplicates: false, // Update existing rows
      })
      .select()

    if (upsertError) {
      console.error('Upsert error:', upsertError)

      await supabase
        .from('import_batches')
        .update({
          status: 'failed',
          error_count: parsedData.length,
          notes: `Upsert failed: ${upsertError.message}`,
        })
        .eq('id', batch.id)

      return {
        success: false,
        error: `Upsert failed: ${upsertError.message}`,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: parsedData.length,
      }
    }

    // Count inserted rows (new rows have been created)
    // Note: Supabase upsert doesn't distinguish between insert and update
    // We'll assume success and count all returned rows as processed
    insertedCount = upsertedRows?.length || 0

    // Check if any rows were inserted
    if (insertedCount === 0) {
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
        updated: 0,
        skipped: 0,
        errors: parsedData.length,
      }
    }

    // Update batch status to success
    await supabase
      .from('import_batches')
      .update({
        status: 'success',
        inserted_count: insertedCount,
        notes: `Successfully imported/updated ${insertedCount} rows (idempotent)`,
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
      updated: 0, // Legacy function doesn't track updates separately
      skipped: 0, // Upsert doesn't track skipped (updates in place)
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
      updated: 0,
      skipped: 0,
      errors: 0,
    }
  }
}
