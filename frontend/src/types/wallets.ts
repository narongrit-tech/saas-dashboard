/**
 * Wallet Types
 * For Multi-Wallet Foundation (Phase 3)
 */

export type WalletType = 'ADS' | 'SUBSCRIPTION' | 'OTHER'

export type LedgerEntryType = 'TOP_UP' | 'SPEND' | 'REFUND' | 'ADJUSTMENT'

export type LedgerDirection = 'IN' | 'OUT'

export type LedgerSource = 'MANUAL' | 'IMPORTED'

export interface Wallet {
  id: string
  name: string
  wallet_type: WalletType
  currency: string
  is_active: boolean
  description?: string | null
  created_at: string
  updated_at: string
  created_by: string
}

export interface WalletLedger {
  id: string
  wallet_id: string
  date: string // DATE in format YYYY-MM-DD
  entry_type: LedgerEntryType
  direction: LedgerDirection
  amount: number
  source: LedgerSource
  import_batch_id?: string | null
  reference_id?: string | null
  note?: string | null
  created_at: string
  updated_at: string
  created_by: string
}

export interface WalletWithLedgerCount extends Wallet {
  ledger_count?: number
}

export interface CreateLedgerInput {
  wallet_id: string
  date: string // YYYY-MM-DD format
  entry_type: LedgerEntryType
  direction: LedgerDirection
  amount: number
  reference_id?: string
  note?: string
}

export interface UpdateLedgerInput {
  date: string // YYYY-MM-DD format
  entry_type: LedgerEntryType
  direction: LedgerDirection
  amount: number
  reference_id?: string
  note?: string
}

export interface LedgerFilters {
  wallet_id?: string
  startDate?: string
  endDate?: string
  entry_type?: LedgerEntryType | 'All'
  source?: LedgerSource | 'All'
  page: number
  perPage: number
}

/**
 * Wallet Balance Summary
 * Used for displaying wallet balance over a date range
 */
export interface WalletBalance {
  wallet_id: string
  wallet_name: string
  opening_balance: number
  total_in: number
  total_out: number
  net_change: number
  closing_balance: number
  // Breakdown by entry type
  top_up_total: number
  spend_total: number
  refund_total: number
  adjustment_in: number
  adjustment_out: number
}

/**
 * Extended ledger entry with wallet info
 * For display purposes (joins wallet data)
 */
export interface WalletLedgerExtended extends WalletLedger {
  wallet_name?: string
  wallet_type?: WalletType
}
