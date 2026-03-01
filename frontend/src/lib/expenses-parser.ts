/**
 * Client-Side Expenses File Parser
 * Parse Standard Expense Template on client to avoid ArrayBuffer in Server Actions
 */

import * as XLSX from 'xlsx'
import { parse as parseDate, isValid } from 'date-fns'
import { formatBangkok } from '@/lib/bangkok-time'
import {
  ParsedExpenseRow,
  ExpensesImportPreview,
  EXPENSE_CATEGORIES,
  ExpenseCategory
} from '@/types/expenses-import'

/**
 * Parse Excel date
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

  if (value instanceof Date && isValid(value)) {
    return value
  }

  return null
}

/**
 * Convert Date to Bangkok date string
 */
function toBangkokDate(date: Date | null): string | null {
  if (!date) return null
  try {
    return formatBangkok(date, 'yyyy-MM-dd')
  } catch {
    return null
  }
}

/**
 * Normalize number
 */
function normalizeNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (!value) return 0
  const str = String(value).replace(/[^0-9.-]/g, '')
  const num = parseFloat(str)
  return isNaN(num) ? 0 : num
}

/**
 * Validate category
 */
function validateCategory(category: unknown): ExpenseCategory | null {
  if (!category) return null
  const normalized = String(category).trim()
  const match = EXPENSE_CATEGORIES.find(
    cat => cat.toLowerCase() === normalized.toLowerCase()
  )
  return match || null
}

/**
 * Detect standard expense template
 */
function detectStandardTemplate(worksheet: XLSX.WorkSheet): boolean {
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null, header: 1 }) as unknown[][]
  if (rows.length < 1) return false

  const headerRow = rows[0]
  const requiredColumns = ['Date', 'Category', 'Amount', 'Description']
  const hasRequired = requiredColumns.every(col =>
    headerRow.some((cell: unknown) => {
      const cellStr = String(cell || '').trim().toLowerCase()
      return cellStr === col.toLowerCase() || cellStr.includes(col.toLowerCase())
    })
  )

  return hasRequired
}

/**
 * Parse Standard Expense Template file (client-side)
 */
export async function parseExpensesFile(
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
        summary: { totalAmount: 0, byCategory: { Advertising: 0, COGS: 0, Operating: 0, Tax: 0 } },
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
        summary: { totalAmount: 0, byCategory: { Advertising: 0, COGS: 0, Operating: 0, Tax: 0 } },
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
        summary: { totalAmount: 0, byCategory: { Advertising: 0, COGS: 0, Operating: 0, Tax: 0 } },
        errors: [{
          message: 'ไม่สามารถตรวจจับรูปแบบ Standard Template ได้ (ต้องมี: Date, Category, Amount, Description)',
          severity: 'error'
        }],
        warnings: [],
      }
    }

    // Parse rows
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null }) as Record<string, unknown>[]

    if (rows.length === 0) {
      return {
        success: false,
        importType: 'standard_template',
        totalRows: 0,
        sampleRows: [],
        summary: { totalAmount: 0, byCategory: { Advertising: 0, COGS: 0, Operating: 0, Tax: 0 } },
        errors: [{ message: 'ไฟล์ว่างเปล่า (ไม่มีข้อมูล)', severity: 'error' }],
        warnings: [],
      }
    }

    const parsedRows: ParsedExpenseRow[] = []
    const errors: Array<{ row?: number; field?: string; message: string; severity: 'error' | 'warning' }> = []

    let minDate: Date | null = null
    let maxDate: Date | null = null
    let totalAmount = 0
    const byCategory = { Advertising: 0, COGS: 0, Operating: 0, Tax: 0 }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNumber = i + 2

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
        const subCategory = row['Sub Category'] || row['sub_category'] || row['subcategory']
        const notes = row['Notes'] || row['notes']

        // Add parsed row (plain object)
        parsedRows.push({
          expense_date: expenseDate,
          category,
          subcategory: subCategory ? String(subCategory).trim() : undefined,
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
        importType: 'standard_template',
        totalRows: rows.length,
        sampleRows: [],
        summary: { totalAmount: 0, byCategory: { Advertising: 0, COGS: 0, Operating: 0, Tax: 0 } },
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
      importType: 'standard_template',
      dateRange,
      totalRows: parsedRows.length,
      sampleRows,
      allRows: parsedRows, // All rows for import
      summary: {
        totalAmount,
        byCategory,
      },
      errors,
      warnings: [],
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      importType: 'generic',
      totalRows: 0,
      sampleRows: [],
      summary: { totalAmount: 0, byCategory: { Advertising: 0, COGS: 0, Operating: 0, Tax: 0 } },
      errors: [{ message: `Error: ${errorMessage}`, severity: 'error' }],
      warnings: [],
    }
  }
}
