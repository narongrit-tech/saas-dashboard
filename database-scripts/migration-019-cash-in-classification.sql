-- Migration 019: Cash In Classification
-- Purpose: Add cash_in_type columns to bank_transactions for categorizing inflows
-- Created: 2026-02-17

-- ============================================================================
-- ALTER TABLE: bank_transactions (add cash_in classification columns)
-- ============================================================================

-- Add columns for cash in classification
ALTER TABLE public.bank_transactions
ADD COLUMN IF NOT EXISTS cash_in_type TEXT NULL,
ADD COLUMN IF NOT EXISTS cash_in_ref_type TEXT NULL,
ADD COLUMN IF NOT EXISTS cash_in_ref_id TEXT NULL,
ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS classified_by UUID NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.bank_transactions.cash_in_type IS 'Classification type for cash inflows: SALES_SETTLEMENT, DIRECTOR_LOAN, CAPITAL_INJECTION, LOAN_PROCEEDS, REFUND_IN, VENDOR_REFUND, TAX_REFUND, INTERNAL_TRANSFER_IN, WALLET_WITHDRAWAL, REBATE_CASHBACK, OTHER_INCOME, REVERSAL_CORRECTION_IN, OTHER, SALES_PAYOUT_ADJUSTMENT';
COMMENT ON COLUMN public.bank_transactions.cash_in_ref_type IS 'Optional reference entity type (e.g., settlement, expense, invoice)';
COMMENT ON COLUMN public.bank_transactions.cash_in_ref_id IS 'Optional reference entity id (UUID or text identifier)';
COMMENT ON COLUMN public.bank_transactions.classified_at IS 'Timestamp when the transaction was classified';
COMMENT ON COLUMN public.bank_transactions.classified_by IS 'User who classified the transaction';

-- Add foreign key for classified_by (optional, can reference auth.users)
ALTER TABLE public.bank_transactions
ADD CONSTRAINT fk_bank_transactions_classified_by
FOREIGN KEY (classified_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add index for filtering by classification status
CREATE INDEX IF NOT EXISTS idx_bank_txn_cash_in_type
ON public.bank_transactions(cash_in_type)
WHERE cash_in_type IS NOT NULL;

-- Add index for unclassified cash inflows (most common query)
CREATE INDEX IF NOT EXISTS idx_bank_txn_unclassified_inflows
ON public.bank_transactions(bank_account_id, txn_date DESC)
WHERE cash_in_type IS NULL AND deposit > 0;

-- ============================================================================
-- RLS POLICIES (Update existing policies to include new columns)
-- ============================================================================

-- Users can update cash_in classification on their own transactions
CREATE POLICY "Users can update cash_in classification on own transactions"
  ON public.bank_transactions FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- ============================================================================
-- GRANTS
-- ============================================================================

-- Ensure authenticated users can update bank_transactions (for classification)
GRANT UPDATE ON public.bank_transactions TO authenticated;

-- ============================================================================
-- END OF MIGRATION 019
-- ============================================================================
