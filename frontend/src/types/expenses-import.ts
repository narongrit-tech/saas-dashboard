/**
 * Expenses Import Types
 * Phase 6: CSV/Excel Import Infrastructure
 */

export type ExpensesImportType = 'standard_template' | 'generic'

export type ExpensesImportSource = 'manual' | 'imported'

/**
 * Valid expense categories (business rules)
 */
export const EXPENSE_CATEGORIES = ['Advertising', 'COGS', 'Operating'] as const
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]

/**
 * Standard Expense Template Fields
 * Our own template format for imports
 */
export const STANDARD_EXPENSE_FIELDS = {
  expense_date: { label: 'Date', required: true },
  category: { label: 'Category', required: true },
  amount: { label: 'Amount', required: true },
  description: { label: 'Description', required: true },
  vendor: { label: 'Vendor', required: false },
  payment_method: { label: 'Payment Method', required: false },
  notes: { label: 'Notes', required: false },
}

/**
 * Generic Expense Fields (for mapping wizard)
 */
export const GENERIC_EXPENSE_FIELDS = {
  expense_date: { label: 'Expense Date', required: true },
  category: { label: 'Category', required: true },
  amount: { label: 'Amount', required: true },
  description: { label: 'Description', required: true },
  vendor: { label: 'Vendor', required: false },
  payment_method: { label: 'Payment Method', required: false },
  sub_category: { label: 'Sub Category', required: false },
  receipt_url: { label: 'Receipt URL', required: false },
  notes: { label: 'Notes', required: false },
}

/**
 * Parsed Expense Row (normalized for insert)
 */
export interface ParsedExpenseRow {
  expense_date: string // YYYY-MM-DD (Bangkok)
  category: ExpenseCategory
  sub_category?: string
  description: string
  amount: number
  vendor?: string
  payment_method?: string
  receipt_url?: string
  notes?: string
  rowNumber?: number // for error reporting
}

/**
 * Expenses Import Preview Result
 */
export interface ExpensesImportPreview {
  success: boolean
  importType: ExpensesImportType
  dateRange?: {
    start: string
    end: string
  }
  totalRows: number
  sampleRows: ParsedExpenseRow[] // First 5 rows for preview
  allRows?: ParsedExpenseRow[] // All parsed rows for import
  summary: {
    totalAmount: number
    byCategory: {
      Advertising: number
      COGS: number
      Operating: number
    }
  }
  errors: Array<{
    row?: number
    field?: string
    message: string
    severity: 'error' | 'warning'
  }>
  warnings: string[]
}

/**
 * Expenses Import Result
 */
export interface ExpensesImportResult {
  success: boolean
  batchId?: string
  inserted: number
  skipped: number
  errors: number
  error?: string
  summary?: {
    dateRange: string
    totalAmount: number
    expenseCount: number
  }
}
