/**
 * Client-Side Sales File Parser
 * Parse TikTok Shop OrderSKUList on client to avoid ArrayBuffer in Server Actions
 */

import * as XLSX from 'xlsx'
import { parse as parseDate, isValid } from 'date-fns'
import { formatBangkok } from '@/lib/bangkok-time'
import { ParsedSalesRow, SalesImportPreview } from '@/types/sales-import'

const BANGKOK_TZ = 'Asia/Bangkok'

/**
 * Parse Excel date to Bangkok timezone string
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

  if (value instanceof Date && isValid(value)) {
    return value
  }

  return null
}

/**
 * Convert Date to Bangkok timezone string
 */
function toBangkokDatetime(date: Date | null): string | null {
  if (!date) return null
  try {
    return formatBangkok(date, 'yyyy-MM-dd HH:mm:ss')
  } catch (error) {
    return null
  }
}

/**
 * Normalize number
 */
function normalizeNumber(value: any): number {
  if (typeof value === 'number') return value
  if (!value) return 0
  const str = String(value).replace(/[^0-9.-]/g, '')
  const num = parseFloat(str)
  return isNaN(num) ? 0 : num
}

/**
 * Normalize status
 */
function normalizeStatus(tiktokStatus?: string): string {
  if (!tiktokStatus) return 'pending'
  const status = tiktokStatus.toLowerCase()
  if (status.includes('delivered') || status.includes('completed')) return 'completed'
  if (status.includes('cancel') || status.includes('return')) return 'cancelled'
  return 'pending'
}

/**
 * Parse TikTok Shop OrderSKUList file (client-side)
 */
export async function parseTikTokFile(
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

    // Check for OrderSKUList sheet
    const sheetName = workbook.SheetNames[0]
    if (sheetName !== 'OrderSKUList') {
      return {
        success: false,
        importType: 'generic',
        totalRows: 0,
        sampleRows: [],
        summary: { totalRevenue: 0, totalOrders: 0, uniqueOrderIds: 0, lineCount: 0 },
        errors: [{
          message: `ไม่พบ sheet "OrderSKUList" (พบ: "${sheetName}") - กรุณาใช้ TikTok Shop export format`,
          severity: 'error'
        }],
        warnings: [],
      }
    }

    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null }) as any[]

    console.log('📋 TikTok OrderSKUList structure:', {
      sheetName,
      totalRawRows: rows.length,
      firstRowSample: rows[0] ? {
        orderId: rows[0]['Order ID'],
        createdTime: rows[0]['Created Time'],
        productName: rows[0]['Product Name']
      } : 'N/A',
      note: 'rows[0] = Excel Row 2 (description), rows[1] = Excel Row 3 (data)'
    })

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

    // Parse rows
    const parsedRows: ParsedSalesRow[] = []
    const errors: Array<{ row?: number; field?: string; message: string; severity: 'error' | 'warning' }> = []
    const uniqueOrderIds = new Set<string>()

    let minDate: Date | null = null
    let maxDate: Date | null = null
    let totalRevenue = 0

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNumber = i + 2 // Excel rows start at 1, +1 for header

      // CRITICAL: TikTok OrderSKUList has Row 2 as description row (MUST SKIP)
      // Row 1 = Headers, Row 2 = Description text, Row 3+ = Data
      // After sheet_to_json, rows[0] = Excel Row 2 (description)
      if (i === 0) {
        console.log('⏭️  Skipping Row 2 (description row)')
        continue
      }

      // Skip empty/invalid rows
      const orderId = row['Order ID']
      if (!orderId || String(orderId).trim() === '') {
        continue
      }

      // Additional check: Skip if Order ID is not numeric/alphanumeric pattern
      // TikTok Order IDs are typically long numeric strings
      const orderIdStr = String(orderId).trim()
      if (orderIdStr.length < 10 || !/^[0-9A-Za-z\-_]+$/.test(orderIdStr)) {
        console.log(`⏭️  Skipping row ${rowNumber}: Order ID "${orderIdStr}" doesn't match expected pattern`)
        continue
      }

      try {
        // Parse created_time
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

        // Parse line revenue
        const lineRevenue = normalizeNumber(row['SKU Subtotal After Discount'])
        const unitPrice = qty > 0 ? lineRevenue / qty : 0

        // Parse status
        const orderStatus = row['Order Status']
        const status = normalizeStatus(orderStatus)

        // Build metadata (plain objects only)
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

        // Add parsed row (plain object)
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

    // Log parsing summary
    console.log('✅ TikTok parsing complete:', {
      totalRawRows: rows.length,
      parsedRows: parsedRows.length,
      skippedRows: rows.length - parsedRows.length - errors.length,
      errorRows: errors.filter(e => e.severity === 'error').length,
      warningRows: errors.filter(e => e.severity === 'warning').length,
      uniqueOrders: uniqueOrderIds.size
    })

    // Check if any valid rows
    if (parsedRows.length === 0) {
      return {
        success: false,
        importType: 'tiktok_shop',
        totalRows: rows.length,
        sampleRows: [],
        summary: { totalRevenue: 0, totalOrders: 0, uniqueOrderIds: 0, lineCount: 0 },
        errors: errors.length > 0 ? errors : [{ message: 'ไม่มีแถวที่ valid (ทุกแถวมี error)', severity: 'error' }],
        warnings: [],
      }
    }

    // Date range
    const dateRange = minDate && maxDate ? {
      start: formatBangkok(minDate, 'yyyy-MM-dd'),
      end: formatBangkok(maxDate, 'yyyy-MM-dd'),
    } : undefined

    // Sample rows
    const sampleRows = parsedRows.slice(0, 5)

    return {
      success: errors.filter(e => e.severity === 'error').length === 0,
      importType: 'tiktok_shop',
      dateRange,
      totalRows: parsedRows.length,
      sampleRows,
      allRows: parsedRows, // All rows for import
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

  } catch (error: any) {
    console.error('Parse TikTok file error:', error)
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
