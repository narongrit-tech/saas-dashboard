-- Migration 016 v2: Bank Opening Balance
-- Purpose: Store initial balance (ยอดยกมา) for bank accounts
-- Updated: 2026-01-25 (v2 - simplified schema with user_id)

-- ============================================================================
-- Drop old table if exists (from v1)
-- ============================================================================
DROP TABLE IF EXISTS public.bank_opening_balances CASCADE;

-- ============================================================================
-- Create bank_opening_balances table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bank_opening_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  as_of_date DATE NOT NULL DEFAULT '2026-01-01',
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraint: One opening balance per user per bank account
  CONSTRAINT uq_bank_opening_balance_user_account UNIQUE (user_id, bank_account_id)
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_bank_opening_balances_user_id
  ON public.bank_opening_balances(user_id);

CREATE INDEX IF NOT EXISTS idx_bank_opening_balances_bank_account_id
  ON public.bank_opening_balances(bank_account_id);

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE public.bank_opening_balances ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own opening balances
CREATE POLICY "Users can view their own bank opening balances"
  ON public.bank_opening_balances
  FOR SELECT
  USING (user_id = auth.uid());

-- Policy: Users can insert their own opening balances
CREATE POLICY "Users can insert their own bank opening balances"
  ON public.bank_opening_balances
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Policy: Users can update their own opening balances
CREATE POLICY "Users can update their own bank opening balances"
  ON public.bank_opening_balances
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Policy: Users can delete their own opening balances
CREATE POLICY "Users can delete their own bank opening balances"
  ON public.bank_opening_balances
  FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- Trigger: Update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_bank_opening_balances_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_bank_opening_balances_updated_at
  BEFORE UPDATE ON public.bank_opening_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.update_bank_opening_balances_updated_at();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.bank_opening_balances IS
  'Stores opening balances (ยอดยกมา) for bank accounts. One record per user per bank account.';

COMMENT ON COLUMN public.bank_opening_balances.as_of_date IS
  'Date from which this opening balance applies (typically start of year, default 2026-01-01)';

COMMENT ON COLUMN public.bank_opening_balances.opening_balance IS
  'Opening balance amount in THB (can be positive, negative, or zero)';
