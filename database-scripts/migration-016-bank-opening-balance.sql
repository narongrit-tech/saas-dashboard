-- Migration 016: Bank Opening Balance
-- Purpose: Store initial balance (ยอดยกมา) for bank accounts
-- Created: 2026-01-25

-- ============================================================================
-- Create bank_opening_balances table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bank_opening_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),

  -- Constraint: One opening balance per account per date
  CONSTRAINT uq_bank_opening_balance_account_date UNIQUE (bank_account_id, effective_date)
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_bank_opening_balances_account_date
  ON public.bank_opening_balances(bank_account_id, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_opening_balances_created_by
  ON public.bank_opening_balances(created_by);

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE public.bank_opening_balances ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own opening balances
CREATE POLICY "Users can view their own bank opening balances"
  ON public.bank_opening_balances
  FOR SELECT
  USING (created_by = auth.uid());

-- Policy: Users can insert their own opening balances
CREATE POLICY "Users can insert their own bank opening balances"
  ON public.bank_opening_balances
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- Policy: Users can update their own opening balances
CREATE POLICY "Users can update their own bank opening balances"
  ON public.bank_opening_balances
  FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Policy: Users can delete their own opening balances
CREATE POLICY "Users can delete their own bank opening balances"
  ON public.bank_opening_balances
  FOR DELETE
  USING (created_by = auth.uid());

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
  'Stores opening balances (ยอดยกมา) for bank accounts. One record per account per effective date.';

COMMENT ON COLUMN public.bank_opening_balances.effective_date IS
  'Date from which this opening balance applies (typically start of year or import range start)';

COMMENT ON COLUMN public.bank_opening_balances.opening_balance IS
  'Opening balance amount in THB (can be positive, negative, or zero)';

COMMENT ON COLUMN public.bank_opening_balances.note IS
  'Optional note explaining this opening balance (e.g., "Start of year 2026", "Post-audit adjustment")';

-- ============================================================================
-- Grant permissions (if needed)
-- ============================================================================

-- If your project uses service role or specific roles, grant permissions here
-- GRANT ALL ON public.bank_opening_balances TO authenticated;
