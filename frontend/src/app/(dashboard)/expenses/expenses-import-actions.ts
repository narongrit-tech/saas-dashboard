'use server'

/**
 * Expenses Import Server Actions
 * Phase 6: CSV/Excel Import Infrastructure
 *
 * Supports:
 * - Standard Expense Template (our own format)
 * - Generic CSV/Excel (via manual mapping)
 */

import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'
import crypto from 'crypto'
import {
  ParsedExpenseRow,
  ExpensesImportPreview,
  ExpensesImportResult,
  EXPENSE_CATEGORIES,
  ExpenseCategory
} from '@/types/expenses-import'
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
      'yyyy-MM-dd',
      'dd/MM/yyyy',
      'MM/dd/yyyy',
      'yyyy/MM/dd',
      'dd-MM-yyyy',
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
 * Convert date to Bangkok date (YYYY-MM-DD)
 */
function toBangkokDate(date: Date | null): string | null {
  if (!date) return null
  try {
    return formatBangkok(date, 'yyyy-MM-dd')
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
 * Validate category (must be one of the 3 allowed)
 */
function validateCategory(category: any): ExpenseCategory | null {
  if (!category) return null
  const normalized = String(category).trim()

  // Check if it matches one of the allowed categories (case-insensitive)
  const match = EXPENSE_CATEGORIES.find(
    cat => cat.toLowerCase() === normalized.toLowerCase()
  )

  return match || null
}

/**
 * Detect standard expense template format
 */
function detectStandardTemplate(worksheet: XLSX.WorkSheet): boolean {
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null, header: 1 }) as any[][]

  if (rows.length < 1) return false

  const headerRow = rows[0]

  // Check for required columns (flexible matching)
  const requiredColumns = ['Date', 'Category', 'Amount', 'Description']
  const hasRequired = requiredColumns.every(col =>
    headerRow.some((cell: any) => {
      const cellStr = String(cell || '').trim().toLowerCase()
      return cellStr === col.toLowerCase() || cellStr.includes(col.toLowerCase())
    })
  )

  return hasRequired
}

// ============================================
// Main: Parse Expenses File
// ============================================

export async function parseExpensesImportFile(
  fileBuffer: ArrayBuffer,
  fileName: string
): Promise<ExpensesImportPreview> {
  try {
    // Validate file extension
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.csv')) {
      return {
        success: false,
        importType: 'generic',
        totalRows: 0,
        sampleRows: [],
        summary: { totalAmount: 0, byCategory: { Advertising: 0, COGS: 0, Operating: 0 } },
        errors: [{ message: 'รองรับเฉพาะไฟล์ .xlsx และ .csv เท่านั้น', severity: 'error' }],
        warnings: [],
      }
    }

    // Parse Excel/CSV file
    const workbook = XLSX.read(fileBuffer, { type: 'array' })

    if (!workbook.SheetNames.length) {
      return {
        success: false,
        importType: 'generic',
        totalRows: 0,
        sampleRows: [],
        summary: { totalAmount: 0, byCategory: { Advertising: 0, COGS: 0, Operating: 0 } },
        errors: [{ message: 'ไฟล์ไม่มี sheet ใดๆ', severity: 'error' }],
        warnings: [],
      }
    }

    const worksheet = workbook.Sheets[workbook.SheetNames[0]]

    // Detect format
    const isStandard = detectStandardTemplate(worksheet)

    if (!isStandard) {
      return {
        success: false,
        importType: 'generic',
        totalRows: 0,
        sampleRows: [],
        summary: { totalAmount: 0, byCategory: { Advertising: 0, COGS: 0, Operating: 0 } },
        errors: [{
          message: 'ไม่สามารถตรวจจับรูปแบบ Standard Template ได้ กรุณาใช้ Manual Mapping',
          severity: 'error'
        }],
        warnings: [],
      }
    }

    // Parse standard format
    return await parseStandardFormat(worksheet)

  } catch (error: any) {
    console.error('Parse expenses file error:', error)
    return {
      success: false,
      importType: 'generic',
      totalRows: 0,
      sampleRows: [],
      summary: { totalAmount: 0, byCategory: { Advertising: 0, COGS: 0, Operating: 0 } },
      errors: [{ message: `Error: ${error.message}`, severity: 'error' }],
      warnings: [],
    }
  }
}

/**
 * Parse Standard Expense Template format
 */
async function parseStandardFormat(
  worksheet: XLSX.WorkSheet
): Promise<ExpensesImportPreview> {
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null }) as any[]

  if (rows.length === 0) {
    return {
      success: false,
      importType: 'standard_template',
      totalRows: 0,
      sampleRows: [],
      summary: { totalAmount: 0, byCategory: { Advertising: 0, COGS: 0, Operating: 0 } },
      errors: [{ message: 'ไฟล์ว่างเปล่า (ไม่มีข้อมูล)', severity: 'error' }],
      warnings: [],
    }
  }

  const parsedRows: ParsedExpenseRow[] = []
  const errors: Array<{ row?: number; field?: string; message: string; severity: 'error' | 'warning' }> = []

  let minDate: Date | null = null
  let maxDate: Date | null = null
  let totalAmount = 0
  const byCategory = { Advertising: 0, COGS: 0, Operating: 0 }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = i + 2 // Excel rows start at 1, + 1 for header = row 2+

    try {
      // Parse date
      const dateRaw = row['Date'] || row['date'] || row['Expense Date'] || row['expense_date']
      const parsedDate = parseExcelDate(dateRaw)

      if (!parsedDate) {
        errors.push({
          row: rowNumber,
          field: 'Date',
          message: 'วันที่ไม่ถูกต้อง',
          severity: 'error'
        })
        continue
      }

      const expenseDate = toBangkokDate(parsedDate)
      if (!expenseDate) {
        errors.push({
          row: rowNumber,
          field: 'Date',
          message: 'ไม่สามารถแปลงวันที่เป็น Bangkok timezone ได้',
          severity: 'error'
        })
        continue
      }

      // Track date range
      if (!minDate || parsedDate < minDate) minDate = parsedDate
      if (!maxDate || parsedDate > maxDate) maxDate = parsedDate

      // Parse category
      const categoryRaw = row['Category'] || row['category']
      const category = validateCategory(categoryRaw)

      if (!category) {
        errors.push({
          row: rowNumber,
          field: 'Category',
          message: `Category ต้องเป็น ${EXPENSE_CATEGORIES.join(', ')} เท่านั้น (ได้รับ: "${categoryRaw}")`,
          severity: 'error'
        })
        continue
      }

      // Parse amount
      const amountRaw = row['Amount'] || row['amount']
      const amount = normalizeNumber(amountRaw)

      if (amount < 0) {
        errors.push({
          row: rowNumber,
          field: 'Amount',
          message: 'Amount ต้องเป็นค่าบวก',
          severity: 'error'
        })
        continue
      }

      // Parse description (required)
      const description = row['Description'] || row['description']
      if (!description || String(description).trim() === '') {
        errors.push({
          row: rowNumber,
          field: 'Description',
          message: 'Description ต้องระบุ',
          severity: 'error'
        })
        continue
      }

      // Parse optional fields
      const vendor = row['Vendor'] || row['vendor']
      const paymentMethod = row['Payment Method'] || row['payment_method']
      const subCategory = row['Sub Category'] || row['sub_category']
      const notes = row['Notes'] || row['notes']

      // Add parsed row
      parsedRows.push({
        expense_date: expenseDate,
        category,
        sub_category: subCategory ? String(subCategory).trim() : undefined,
        description: String(description).trim(),
        amount,
        vendor: vendor ? String(vendor).trim() : undefined,
        payment_method: paymentMethod ? String(paymentMethod).trim() : undefined,
        notes: notes ? String(notes).trim() : undefined,
        rowNumber,
      })

      // Update summary
      totalAmount += amount
      byCategory[category] += amount

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
      importType: 'standard_template',
      totalRows: rows.length,
      sampleRows: [],
      summary: { totalAmount: 0, byCategory: { Advertising: 0, COGS: 0, Operating: 0 } },
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
    importType: 'standard_template',
    dateRange,
    totalRows: parsedRows.length,
    sampleRows,
    allRows: parsedRows, // Include all rows for import
    summary: {
      totalAmount,
      byCategory,
    },
    errors,
    warnings: [],
  }
}

// ============================================
// Main: Import Expenses to System
// ============================================

export async function importExpensesToSystem(
  fileBuffer: ArrayBuffer,
  fileName: string,
  parsedData: ParsedExpenseRow[]
): Promise<ExpensesImportResult> {
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

    // Calculate file hash
    const fileHash = crypto
      .createHash('sha256')
      .update(Buffer.from(fileBuffer))
      .digest('hex')

    // Check for duplicate import
    const { data: existingBatch } = await supabase
      .from('import_batches')
      .select('id, file_name, created_at')
      .eq('file_hash', fileHash)
      .eq('report_type', 'expenses')
      .single()

    if (existingBatch) {
      return {
        success: false,
        error: `ไฟล์นี้ถูก import ไปแล้ว - "${existingBatch.file_name}" (${formatBangkok(new Date(existingBatch.created_at), 'yyyy-MM-dd HH:mm')})`,
        inserted: 0,
        skipped: 0,
        errors: 0,
      }
    }

    // Create import batch record
    const dateRange = parsedData.length > 0
      ? `${parsedData[0].expense_date} to ${parsedData[parsedData.length - 1].expense_date}`
      : 'N/A'

    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        file_hash: fileHash,
        marketplace: 'internal',
        report_type: 'expenses',
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

    // Insert expenses
    const expenseRows = parsedData.map(row => ({
      expense_date: row.expense_date,
      category: row.category,
      sub_category: row.sub_category,
      description: row.description,
      amount: row.amount,
      vendor: row.vendor,
      payment_method: row.payment_method,
      notes: row.notes,
      source: 'imported',
      import_batch_id: batch.id,
      created_by: user.id,
    }))

    const { data: insertedRows, error: insertError } = await supabase
      .from('expenses')
      .insert(expenseRows)
      .select()

    if (insertError) {
      console.error('Insert error:', insertError)

      // Update batch status to failed
      await supabase
        .from('import_batches')
        .update({
          status: 'failed',
          error_count: parsedData.length,
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

    // Update batch status to success
    await supabase
      .from('import_batches')
      .update({
        status: 'success',
        inserted_count: insertedCount,
      })
      .eq('id', batch.id)

    // Calculate summary
    const totalAmount = parsedData.reduce((sum, r) => sum + r.amount, 0)

    return {
      success: true,
      batchId: batch.id,
      inserted: insertedCount,
      skipped: 0,
      errors: 0,
      summary: {
        dateRange,
        totalAmount,
        expenseCount: insertedCount,
      },
    }

  } catch (error: any) {
    console.error('Import expenses error:', error)
    return {
      success: false,
      error: error.message,
      inserted: 0,
      skipped: 0,
      errors: 0,
    }
  }
}
