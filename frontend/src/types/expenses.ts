export type ExpenseCategory = 'Advertising' | 'COGS' | 'Operating'

export type ExpenseStatus = 'DRAFT' | 'PAID'

export interface Expense {
  id: string
  expense_date: string
  category: ExpenseCategory
  subcategory?: string | null
  amount: number
  description?: string | null
  notes?: string | null
  source?: string | null
  expense_status: ExpenseStatus
  planned_date?: string | null
  paid_date?: string | null
  paid_confirmed_at?: string | null
  paid_confirmed_by?: string | null
  vendor?: string | null
  bank_transaction_id?: string | null
  created_at: string
  updated_at: string
  created_by?: string | null
}

export interface ExpenseAttachment {
  id: string
  expense_id: string
  file_path: string
  file_name: string
  file_type?: string | null
  file_size?: number | null
  uploaded_at: string
  uploaded_by: string
  created_by: string
  // signed_url is populated client-side after fetching, not stored in DB
  signed_url?: string | null
}

export interface ExpenseFilters {
  category?: ExpenseCategory | 'All'
  status?: ExpenseStatus | 'All'
  startDate?: string
  endDate?: string
  search?: string
  page: number
  perPage: number
}

export interface CreateExpenseInput {
  expense_date: string
  category: ExpenseCategory
  subcategory?: string
  amount: number
  note?: string
  planned_date?: string
  vendor?: string
}

export interface UpdateExpenseInput {
  expense_date: string
  category: ExpenseCategory
  subcategory?: string
  amount: number
  note?: string
  vendor?: string
}
