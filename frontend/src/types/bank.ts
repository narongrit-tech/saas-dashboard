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
  // Cash In Classification
  cash_in_type: CashInType | null;
  cash_in_ref_type: string | null;
  cash_in_ref_id: string | null;
  classified_at: string | null;
  classified_by: string | null;
}

// ============================================================================
// Cash In Classification Types
// ============================================================================

export const CASH_IN_TYPES = {
  SALES_SETTLEMENT: 'SALES_SETTLEMENT',
  SALES_PAYOUT_ADJUSTMENT: 'SALES_PAYOUT_ADJUSTMENT',
  DIRECTOR_LOAN: 'DIRECTOR_LOAN',
  CAPITAL_INJECTION: 'CAPITAL_INJECTION',
  LOAN_PROCEEDS: 'LOAN_PROCEEDS',
  REFUND_IN: 'REFUND_IN',
  VENDOR_REFUND: 'VENDOR_REFUND',
  TAX_REFUND: 'TAX_REFUND',
  INTERNAL_TRANSFER_IN: 'INTERNAL_TRANSFER_IN',
  WALLET_WITHDRAWAL: 'WALLET_WITHDRAWAL',
  REBATE_CASHBACK: 'REBATE_CASHBACK',
  OTHER_INCOME: 'OTHER_INCOME',
  REVERSAL_CORRECTION_IN: 'REVERSAL_CORRECTION_IN',
  OTHER: 'OTHER',
} as const;

export type CashInType = keyof typeof CASH_IN_TYPES;

export const CASH_IN_TYPE_LABELS: Record<CashInType, string> = {
  SALES_SETTLEMENT: 'เงินจากการขาย (Settlement)',
  SALES_PAYOUT_ADJUSTMENT: 'ปรับยอด Settlement',
  DIRECTOR_LOAN: 'เงินกู้จากผู้ถือหุ้น/กรรมการ',
  CAPITAL_INJECTION: 'เงินลงทุนเพิ่ม',
  LOAN_PROCEEDS: 'เงินกู้จากสถาบันการเงิน',
  REFUND_IN: 'เงินคืนจากลูกค้า',
  VENDOR_REFUND: 'เงินคืนจากซัพพลายเออร์',
  TAX_REFUND: 'เงินคืนภาษี',
  INTERNAL_TRANSFER_IN: 'โอนเงินภายในบริษัท (เข้า)',
  WALLET_WITHDRAWAL: 'ถอนเงินจาก Wallet',
  REBATE_CASHBACK: 'Rebate/Cashback',
  OTHER_INCOME: 'รายได้อื่นๆ',
  REVERSAL_CORRECTION_IN: 'ปรับปรุง/ยกเลิกรายการ (เข้า)',
  OTHER: 'อื่นๆ (ระบุ)',
};

export interface CashInClassificationPayload {
  cash_in_type: CashInType;
  cash_in_ref_type?: string | null;
  cash_in_ref_id?: string | null;
  note?: string | null;
}

export interface CashInSelectionSummary {
  count: number;
  sum_amount: number;
  total_matching: number;
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
  status: 'pending' | 'completed' | 'failed' | 'rolled_back';
  import_mode: 'append' | 'replace_range' | 'replace_all';
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

// ============================================================================
// Import Enhancements Types (Overlap Detection + History + Rollback)
// ============================================================================

export interface ImportOverlapInfo {
  existing_count: number;
  date_range: { start: string; end: string };
  file_count: number;
}

export interface CheckImportOverlapResponse {
  success: boolean;
  overlap?: ImportOverlapInfo;
  error?: string;
}

export interface GetBankImportHistoryResponse {
  success: boolean;
  data?: BankStatementImportBatch[];
  error?: string;
}

export interface RollbackBankImportResponse {
  success: boolean;
  deleted_count?: number;
  message?: string;
  error?: string;
}

// ============================================================================
// Cash In Classification Response Types
// ============================================================================

export interface GetCashInSelectionSummaryResponse {
  success: boolean;
  data?: CashInSelectionSummary;
  error?: string;
}

export interface ApplyCashInTypeResponse {
  success: boolean;
  affected_rows?: number;
  message?: string;
  error?: string;
}

export interface GetCashInTransactionsResponse {
  success: boolean;
  data?: {
    transactions: BankTransaction[];
    total: number;
  };
  error?: string;
}

// ============================================================================
// Cash In Import Template Types
// ============================================================================

export interface CashInImportRow {
  bank_account: string;
  txn_datetime: string; // YYYY-MM-DD HH:mm:ss
  amount: number;
  description: string;
  cash_in_type: string;
  bank_txn_id?: string;
  note?: string;
}

export interface CashInImportPreviewRow {
  row_index: number;
  status: 'MATCHED' | 'UNMATCHED' | 'INVALID' | 'CONFLICT';
  reason?: string;
  matched_txn_id?: string;
  input_data: CashInImportRow;
  current_cash_in_type?: string | null;
  conflict_details?: {
    current_type: string;
    new_type: string;
  };
}

export interface CashInImportPreview {
  total_rows: number;
  matched: number;
  unmatched: number;
  invalid: number;
  conflicts: number;
  rows: CashInImportPreviewRow[];
}

export interface DownloadCashInTemplateResponse {
  success: boolean;
  base64?: string;
  filename?: string;
  error?: string;
}

export interface ParseCashInImportResponse {
  success: boolean;
  data?: CashInImportPreview;
  error?: string;
}

export interface ApplyCashInImportResponse {
  success: boolean;
  updated_count?: number;
  message?: string;
  error?: string;
}
