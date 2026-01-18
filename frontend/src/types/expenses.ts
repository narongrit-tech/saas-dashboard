export type ExpenseCategory = 'Advertising' | 'COGS' | 'Operating'

export interface Expense {
  id: string
  expense_date: string
  category: ExpenseCategory
  amount: number
  description?: string | null
  notes?: string | null
  source?: string | null
  created_at: string
  updated_at: string
  created_by?: string | null
}

export interface ExpenseFilters {
  category?: ExpenseCategory | 'All'
  startDate?: string
  endDate?: string
  search?: string
  page: number
  perPage: number
}

export interface CreateExpenseInput {
  expense_date: string
  category: ExpenseCategory
  amount: number
  note?: string
}
