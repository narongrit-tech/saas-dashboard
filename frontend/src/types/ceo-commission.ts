/**
 * CEO Commission Types
 * For tracking commission receipts and Director Loan transfers
 */

import { BankTransaction, BankAccount } from './bank'

export interface CommissionReceipt {
  id: string
  commission_date: string // YYYY-MM-DD format
  platform: string
  gross_amount: number
  personal_used_amount: number
  transferred_to_company_amount: number
  note: string | null
  reference: string | null
  bank_transaction_id: string | null // Linked bank transaction (null for manual entries)
  created_at: string
  updated_at: string
  created_by: string
}

export interface CreateCommissionInput {
  commission_date: string // YYYY-MM-DD format
  platform: string
  gross_amount: number
  personal_used_amount: number
  transferred_to_company_amount: number
  note?: string
  reference?: string
  bank_transaction_id?: string | null // Optional link to bank transaction
}

export interface CommissionFilters {
  startDate?: string
  endDate?: string
  platform?: string | 'All'
  page: number
  perPage: number
}

export interface CommissionSummary {
  total_commissions: number
  total_personal_used: number
  total_transferred: number
  director_loan_balance: number
}

// ============================================================================
// Bank Source Selection Types
// ============================================================================

export interface CommissionSource {
  id: string
  created_by: string
  bank_account_id: string
  created_at: string
}

export interface CommissionSourceWithAccount extends CommissionSource {
  bank_account: BankAccount
}

// ============================================================================
// Import from Bank Types
// ============================================================================

export interface CandidateBankTransaction extends BankTransaction {
  bank_account?: BankAccount // Joined bank account info
}

export interface CandidateFilters {
  startDate?: string
  endDate?: string
  bank_account_id?: string | 'All' // Filter within selected sources
}

export interface CreateCommissionFromBankInput {
  bank_transaction_id: string
  commission_date: string // YYYY-MM-DD format (default from txn date)
  platform: string
  gross_amount: number // Default from deposit amount
  personal_used_amount: number
  transferred_to_company_amount: number
  note?: string
  reference?: string
}

// ============================================================================
// API Response Types
// ============================================================================

export interface GetCommissionSourcesResponse {
  success: boolean
  data?: CommissionSourceWithAccount[]
  error?: string
}

export interface UpdateCommissionSourcesResponse {
  success: boolean
  message?: string
  error?: string
}

export interface GetBankAccountsForSelectionResponse {
  success: boolean
  data?: BankAccount[]
  error?: string
}

export interface GetCandidateBankTransactionsResponse {
  success: boolean
  data?: CandidateBankTransaction[]
  total?: number
  error?: string
}

export interface CreateCommissionFromBankResponse {
  success: boolean
  data?: CommissionReceipt
  error?: string
  warning?: string
}
