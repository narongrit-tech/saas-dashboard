// Bank Module Types
// Created: 2026-01-25

export interface BankAccount {
  id: string;
  created_by: string;
  bank_name: string;
  account_number: string;
  account_type: 'savings' | 'current' | 'fixed_deposit' | 'other';
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BankTransaction {
  id: string;
  bank_account_id: string;
  import_batch_id: string | null;
  txn_date: string; // YYYY-MM-DD
  description: string | null;
  withdrawal: number;
  deposit: number;
  balance: number | null;
  channel: string | null;
  reference_id: string | null;
  raw: Record<string, any> | null;
  created_by: string;
  created_at: string;
}

export interface BankStatementImportBatch {
  id: string;
  bank_account_id: string;
  file_name: string;
  file_hash: string;
  imported_by: string;
  imported_at: string;
  row_count: number;
  inserted_count: number;
  status: 'pending' | 'completed' | 'failed';
  metadata: Record<string, any> | null;
}

export interface BankOpeningBalance {
  id: string;
  user_id: string;
  bank_account_id: string;
  as_of_date: string; // YYYY-MM-DD
  opening_balance: number;
  created_at: string;
  updated_at: string;
}

export interface BankReportedBalance {
  id: string;
  user_id: string;
  bank_account_id: string;
  reported_as_of_date: string; // YYYY-MM-DD
  reported_balance: number;
  created_at: string;
}

export interface BankReconciliation {
  id: string;
  bank_transaction_id: string;
  entity_type: 'settlement' | 'expense' | 'wallet_topup';
  entity_id: string;
  matched_amount: number;
  matching_rule: string | null;
  matched_by: string;
  matched_at: string;
  notes: string | null;
}

// ============================================================================
// Daily Summary Types
// ============================================================================

export interface BankDailySummary {
  date: string; // YYYY-MM-DD
  cash_in: number; // deposits
  cash_out: number; // withdrawals
  net: number; // cash_in - cash_out
  running_balance: number;
  transaction_count: number;
}

export interface BankDailySummaryWithOpening {
  summaries: BankDailySummary[];
  opening_balance_used: number;
  opening_balance_date: string | null; // YYYY-MM-DD or null if no opening balance
}

// ============================================================================
// Import Preview Types
// ============================================================================

export interface BankStatementPreview {
  file_name: string;
  file_hash: string;
  date_range: {
    start: string;
    end: string;
  };
  total_deposits: number;
  total_withdrawals: number;
  net: number;
  row_count: number;
  sample_rows: BankTransactionRow[];
  errors: string[];
  warnings: string[];
}

export interface BankTransactionRow {
  txn_date: string;
  description: string;
  withdrawal: number;
  deposit: number;
  balance: number | null;
  channel: string | null;
  reference_id: string | null;
}

// ============================================================================
// Column Mapping Types (for manual mapping wizard)
// ============================================================================

export interface BankColumnMapping {
  txn_date: string; // Excel column name
  description: string;
  withdrawal: string;
  deposit: string;
  balance?: string; // optional
  channel?: string; // optional
  reference_id?: string; // optional
}

export interface BankStatementFormat {
  format_type: 'kbiz' | 'kplus' | 'generic';
  detected_columns: string[];
  auto_mapping: BankColumnMapping | null;
  requires_manual_mapping: boolean;
}

// ============================================================================
// Reconciliation Types
// ============================================================================

export interface ReconciliationSummary {
  date_range: {
    start: string;
    end: string;
  };
  bank_summary: {
    total_in: number;
    total_out: number;
    net: number;
  };
  internal_summary: {
    settlements: number;
    expenses: number;
    wallet_topups: number;
    total: number;
  };
  reconciliation: {
    matched_count: number;
    matched_amount: number;
    unmatched_bank_count: number;
    unmatched_bank_amount: number;
    unmatched_internal_count: number;
    unmatched_internal_amount: number;
  };
  gap: number; // bank_net - internal_total
}

export interface UnmatchedBankTransaction extends BankTransaction {
  suggested_match: {
    entity_type: 'settlement' | 'expense' | 'wallet_topup';
    entity_id: string;
    description: string;
    amount: number;
    match_score: number; // 0-100
  } | null;
}

export interface UnmatchedInternalRecord {
  entity_type: 'settlement' | 'expense' | 'wallet_topup';
  entity_id: string;
  date: string;
  description: string;
  amount: number;
  suggested_match: {
    bank_txn_id: string;
    bank_description: string;
    bank_amount: number;
    match_score: number; // 0-100
  } | null;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface GetBankAccountsResponse {
  success: boolean;
  data?: BankAccount[];
  error?: string;
}

export interface GetBankDailySummaryResponse {
  success: boolean;
  data?: BankDailySummary[];
  opening_balance_used?: number;
  opening_balance_date?: string | null;
  error?: string;
}

export interface GetBankTransactionsResponse {
  success: boolean;
  data?: {
    transactions: BankTransaction[];
    total: number;
  };
  error?: string;
}

export interface ImportBankStatementResponse {
  success: boolean;
  batchId?: string;
  insertedCount?: number;
  message?: string; // User-friendly message including duplicate stats
  error?: string;
}

export interface ParseBankStatementResponse {
  success: boolean;
  data?: BankStatementPreview;
  errors?: string[];
}

export interface ExportBankTransactionsResponse {
  success: boolean;
  csv?: string;
  filename?: string;
  error?: string;
}

export interface GetReconciliationSummaryResponse {
  success: boolean;
  data?: ReconciliationSummary;
  error?: string;
}

export interface GetUnmatchedTransactionsResponse {
  success: boolean;
  data?: UnmatchedBankTransaction[];
  error?: string;
}

export interface GetUnmatchedInternalRecordsResponse {
  success: boolean;
  data?: UnmatchedInternalRecord[];
  error?: string;
}

export interface RunAutoReconciliationResponse {
  success: boolean;
  matchedCount?: number;
  error?: string;
}

export interface GetOpeningBalanceResponse {
  success: boolean;
  data?: BankOpeningBalance | null;
  error?: string;
}

export interface UpsertOpeningBalanceResponse {
  success: boolean;
  data?: BankOpeningBalance;
  error?: string;
}

export interface GetReportedBalanceResponse {
  success: boolean;
  data?: BankReportedBalance | null;
  error?: string;
}

export interface SaveReportedBalanceResponse {
  success: boolean;
  data?: BankReportedBalance;
  error?: string;
}

export interface BankBalanceSummary {
  opening_balance: number;
  net_movement: number;
  expected_closing_balance: number;
  reported_balance: number | null;
  delta: number | null; // reported - expected (null if no reported balance)
  reported_as_of_date: string | null;
}
