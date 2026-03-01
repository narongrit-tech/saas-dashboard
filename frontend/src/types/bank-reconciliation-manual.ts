// Bank Reconciliation Manual Match Types
// Created: 2026-01-26

export type BankReconciliationMatchType =
  | 'expense'
  | 'wallet_topup'
  | 'wallet_spend'
  | 'settlement'
  | 'adjustment'
  | 'ignore';

export interface BankReconciliation {
  id: string;
  bank_transaction_id: string;
  matched_type: BankReconciliationMatchType;
  matched_record_id: string | null;
  created_by: string;
  created_at: string;
  notes: string | null;
  metadata: Record<string, any> | null;
}

export interface SuggestedMatch {
  entity_type: 'settlement' | 'expense' | 'wallet_topup';
  entity_id: string;
  date: string;
  description: string;
  amount: number;
  match_score: number; // 0-100
  match_reason: string;
}

export interface ManualMatchFormData {
  action:
    | 'match_settlement'
    | 'match_expense'
    | 'match_wallet'
    | 'create_expense'
    | 'create_wallet_topup'
    | 'create_wallet_spend'
    | 'adjustment'
    | 'ignore';

  // For creating expense
  expense?: {
    category: 'Advertising' | 'COGS' | 'Operating' | 'Tax';
    subcategory?: string;
    description: string;
    amount: number;
  };

  // For creating wallet entries
  wallet?: {
    wallet_id: string;
    amount: number;
  };

  // For matching existing records
  match?: {
    entity_type: 'settlement' | 'expense' | 'wallet_topup';
    entity_id: string;
  };

  // For adjustment
  adjustment?: {
    type: 'bank_error' | 'timing_difference' | 'other';
    notes: string;
  };

  // For ignore
  ignore?: {
    reason: string;
  };

  // Common notes
  notes?: string;
}

export interface WalletOption {
  id: string;
  name: string;
  wallet_type: string;
}
