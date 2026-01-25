-- Migration 017: Bank Reported Balance
-- Purpose: Store bank-reported balances to detect mismatches
-- Created: 2026-01-25

-- ============================================================================
-- Create bank_reported_balances table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bank_reported_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  reported_as_of_date DATE NOT NULL,
  reported_balance NUMERIC(14, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_bank_reported_balances_user_account
  ON public.bank_reported_balances(user_id, bank_account_id);

CREATE INDEX IF NOT EXISTS idx_bank_reported_balances_date
  ON public.bank_reported_balances(bank_account_id, reported_as_of_date DESC);

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE public.bank_reported_balances ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own reported balances
CREATE POLICY "Users can view their own bank reported balances"
  ON public.bank_reported_balances
  FOR SELECT
  USING (user_id = auth.uid());

-- Policy: Users can insert their own reported balances
CREATE POLICY "Users can insert their own bank reported balances"
  ON public.bank_reported_balances
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Policy: Users can delete their own reported balances
CREATE POLICY "Users can delete their own bank reported balances"
  ON public.bank_reported_balances
  FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.bank_reported_balances IS
  'Stores bank-reported balances for comparison with calculated balances. Used to detect mismatches.';

COMMENT ON COLUMN public.bank_reported_balances.reported_as_of_date IS
  'Date of the bank-reported balance (typically end of selected date range)';

COMMENT ON COLUMN public.bank_reported_balances.reported_balance IS
  'Balance as reported by the bank (from statement or online banking)';
