-- Migration 014: Bank Module
-- Purpose: Bank statement import, transactions tracking, and reconciliation
-- Created: 2026-01-25

-- ============================================================================
-- TABLE: bank_accounts
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_name VARCHAR(100) NOT NULL,
  account_number VARCHAR(50) NOT NULL,
  account_type VARCHAR(50) NOT NULL DEFAULT 'savings',
  currency VARCHAR(3) NOT NULL DEFAULT 'THB',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_accounts_account_type_check CHECK (account_type IN ('savings', 'current', 'fixed_deposit', 'other'))
);

COMMENT ON TABLE public.bank_accounts IS 'Bank accounts for company cash tracking';
COMMENT ON COLUMN public.bank_accounts.account_type IS 'savings, current, fixed_deposit, other';

-- ============================================================================
-- TABLE: bank_statement_import_batches
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.bank_statement_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  imported_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  metadata JSONB,
  CONSTRAINT bank_statement_import_batches_status_check CHECK (status IN ('pending', 'completed', 'failed')),
  CONSTRAINT bank_statement_import_batches_file_hash_unique UNIQUE (bank_account_id, file_hash)
);

COMMENT ON TABLE public.bank_statement_import_batches IS 'Import batch tracking for bank statements';
COMMENT ON COLUMN public.bank_statement_import_batches.file_hash IS 'SHA256 hash for deduplication per bank account';
COMMENT ON COLUMN public.bank_statement_import_batches.metadata IS 'File format, parser version, date range, etc.';

-- ============================================================================
-- TABLE: bank_transactions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  import_batch_id UUID REFERENCES public.bank_statement_import_batches(id) ON DELETE SET NULL,
  txn_date DATE NOT NULL,
  description TEXT,
  withdrawal NUMERIC(15,2) NOT NULL DEFAULT 0,
  deposit NUMERIC(15,2) NOT NULL DEFAULT 0,
  balance NUMERIC(15,2),
  channel VARCHAR(50),
  reference_id VARCHAR(100),
  raw JSONB,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_transactions_amounts_check CHECK (
    (withdrawal >= 0 AND deposit >= 0) AND NOT (withdrawal > 0 AND deposit > 0)
  )
);

COMMENT ON TABLE public.bank_transactions IS 'Bank transactions from statement imports';
COMMENT ON COLUMN public.bank_transactions.txn_date IS 'Transaction date in Asia/Bangkok timezone';
COMMENT ON COLUMN public.bank_transactions.balance IS 'Running balance from bank statement';
COMMENT ON COLUMN public.bank_transactions.channel IS 'ATM, Transfer, Online, etc.';
COMMENT ON COLUMN public.bank_transactions.raw IS 'Original row data from import';
COMMENT ON CONSTRAINT bank_transactions_amounts_check ON public.bank_transactions IS 'Withdrawal and deposit cannot both be non-zero';

-- ============================================================================
-- TABLE: bank_reconciliations
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.bank_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id UUID NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  matched_amount NUMERIC(15,2) NOT NULL,
  matching_rule VARCHAR(100),
  matched_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  CONSTRAINT bank_reconciliations_entity_type_check CHECK (entity_type IN ('settlement', 'expense', 'wallet_topup'))
);

COMMENT ON TABLE public.bank_reconciliations IS 'Reconciliation between bank transactions and internal records';
COMMENT ON COLUMN public.bank_reconciliations.entity_type IS 'settlement (settlement_transactions), expense (expenses), wallet_topup (wallet_ledger)';
COMMENT ON COLUMN public.bank_reconciliations.entity_id IS 'FK to settlement_transactions, expenses, or wallet_ledger';
COMMENT ON COLUMN public.bank_reconciliations.matching_rule IS 'e.g., amount_date_exact, amount_date_near, amount_keyword';

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_bank_accounts_user ON public.bank_accounts(created_by);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_active ON public.bank_accounts(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_bank_import_batches_account ON public.bank_statement_import_batches(bank_account_id, imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_import_batches_hash ON public.bank_statement_import_batches(file_hash);

CREATE INDEX IF NOT EXISTS idx_bank_txn_account_date ON public.bank_transactions(bank_account_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_txn_description_gin ON public.bank_transactions USING GIN (to_tsvector('simple', description));
CREATE INDEX IF NOT EXISTS idx_bank_txn_batch ON public.bank_transactions(import_batch_id);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_bank_txn ON public.bank_reconciliations(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_entity ON public.bank_reconciliations(entity_type, entity_id);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;

-- bank_accounts policies
CREATE POLICY "Users can view own bank accounts"
  ON public.bank_accounts FOR SELECT
  USING (created_by = auth.uid());

CREATE POLICY "Users can insert own bank accounts"
  ON public.bank_accounts FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update own bank accounts"
  ON public.bank_accounts FOR UPDATE
  USING (created_by = auth.uid());

CREATE POLICY "Users can delete own bank accounts"
  ON public.bank_accounts FOR DELETE
  USING (created_by = auth.uid());

-- bank_statement_import_batches policies
CREATE POLICY "Users can view own bank import batches"
  ON public.bank_statement_import_batches FOR SELECT
  USING (imported_by = auth.uid());

CREATE POLICY "Users can insert own bank import batches"
  ON public.bank_statement_import_batches FOR INSERT
  WITH CHECK (imported_by = auth.uid());

-- bank_transactions policies
CREATE POLICY "Users can view own bank transactions"
  ON public.bank_transactions FOR SELECT
  USING (created_by = auth.uid());

CREATE POLICY "Users can insert own bank transactions"
  ON public.bank_transactions FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- bank_reconciliations policies
CREATE POLICY "Users can view own bank reconciliations"
  ON public.bank_reconciliations FOR SELECT
  USING (matched_by = auth.uid());

CREATE POLICY "Users can insert own bank reconciliations"
  ON public.bank_reconciliations FOR INSERT
  WITH CHECK (matched_by = auth.uid());

CREATE POLICY "Users can update own bank reconciliations"
  ON public.bank_reconciliations FOR UPDATE
  USING (matched_by = auth.uid());

CREATE POLICY "Users can delete own bank reconciliations"
  ON public.bank_reconciliations FOR DELETE
  USING (matched_by = auth.uid());

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Updated_at trigger for bank_accounts
CREATE OR REPLACE FUNCTION public.update_bank_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_bank_accounts_updated_at
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_bank_accounts_updated_at();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get opening balance from first transaction
CREATE OR REPLACE FUNCTION public.get_bank_opening_balance(
  p_bank_account_id UUID,
  p_start_date DATE
) RETURNS NUMERIC AS $$
DECLARE
  v_first_txn RECORD;
  v_opening_balance NUMERIC;
BEGIN
  -- Find first transaction on or after start_date
  SELECT balance, withdrawal, deposit
  INTO v_first_txn
  FROM public.bank_transactions
  WHERE bank_account_id = p_bank_account_id
    AND txn_date >= p_start_date
    AND created_by = auth.uid()
  ORDER BY txn_date ASC, created_at ASC
  LIMIT 1;

  IF v_first_txn.balance IS NULL THEN
    RETURN 0;
  END IF;

  -- Opening balance = first transaction balance - deposit + withdrawal
  v_opening_balance := v_first_txn.balance - COALESCE(v_first_txn.deposit, 0) + COALESCE(v_first_txn.withdrawal, 0);

  RETURN COALESCE(v_opening_balance, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.get_bank_opening_balance IS 'Calculate opening balance from first transaction in date range';

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO authenticated;
GRANT SELECT, INSERT ON public.bank_statement_import_batches TO authenticated;
GRANT SELECT, INSERT ON public.bank_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_reconciliations TO authenticated;

-- ============================================================================
-- END OF MIGRATION 014
-- ============================================================================
