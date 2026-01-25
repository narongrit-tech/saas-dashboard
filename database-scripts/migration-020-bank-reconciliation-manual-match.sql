-- Migration 020: Bank Reconciliation Manual Match Enhancement
-- Purpose: Add manual override functionality for bank reconciliation
-- Created: 2026-01-26
--
-- Changes:
-- 1. Add matched_type column (expense/wallet_topup/wallet_spend/settlement/adjustment/ignore)
-- 2. Add matched_record_id column (nullable - for ignore/adjustment)
-- 3. Add metadata column for future extensibility
-- 4. Update RLS policies (immutable audit trail)
-- 5. Add unique constraint per bank_transaction_id

-- ============================================================================
-- TABLE ALTERATIONS: bank_reconciliations
-- ============================================================================

-- Add new columns
ALTER TABLE public.bank_reconciliations
  ADD COLUMN IF NOT EXISTS matched_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS matched_record_id UUID,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Add CHECK constraint for matched_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bank_reconciliations_matched_type_check'
  ) THEN
    ALTER TABLE public.bank_reconciliations
      ADD CONSTRAINT bank_reconciliations_matched_type_check
      CHECK (matched_type IN ('expense', 'wallet_topup', 'wallet_spend', 'settlement', 'adjustment', 'ignore'));
  END IF;
END $$;

-- Add UNIQUE constraint per bank_transaction_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bank_reconciliations_bank_txn_unique'
  ) THEN
    ALTER TABLE public.bank_reconciliations
      ADD CONSTRAINT bank_reconciliations_bank_txn_unique
      UNIQUE (bank_transaction_id);
  END IF;
END $$;

-- Update existing data: map old entity_type to new matched_type
UPDATE public.bank_reconciliations
SET
  matched_type = CASE
    WHEN entity_type = 'settlement' THEN 'settlement'
    WHEN entity_type = 'expense' THEN 'expense'
    WHEN entity_type = 'wallet_topup' THEN 'wallet_topup'
    ELSE 'adjustment'
  END,
  matched_record_id = entity_id,
  created_by = matched_by,
  created_at = matched_at
WHERE matched_type IS NULL;

-- Make new columns NOT NULL after backfill
ALTER TABLE public.bank_reconciliations
  ALTER COLUMN matched_type SET NOT NULL,
  ALTER COLUMN created_by SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

-- Make old columns NULLABLE (for backward compatibility)
-- These columns are kept but no longer required for new inserts
ALTER TABLE public.bank_reconciliations
  ALTER COLUMN entity_type DROP NOT NULL,
  ALTER COLUMN entity_id DROP NOT NULL,
  ALTER COLUMN matched_amount DROP NOT NULL,
  ALTER COLUMN matched_by DROP NOT NULL,
  ALTER COLUMN matched_at DROP NOT NULL;

-- Drop old columns (optional - uncomment if old columns no longer needed)
-- ALTER TABLE public.bank_reconciliations DROP COLUMN IF EXISTS entity_type;
-- ALTER TABLE public.bank_reconciliations DROP COLUMN IF EXISTS entity_id;
-- ALTER TABLE public.bank_reconciliations DROP COLUMN IF EXISTS matched_amount;
-- ALTER TABLE public.bank_reconciliations DROP COLUMN IF EXISTS matching_rule;
-- ALTER TABLE public.bank_reconciliations DROP COLUMN IF EXISTS matched_by;
-- ALTER TABLE public.bank_reconciliations DROP COLUMN IF EXISTS matched_at;

-- ============================================================================
-- UPDATE INDEXES
-- ============================================================================

-- Add index for created_by + created_at (for user reconciliation history)
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_user_created
  ON public.bank_reconciliations(created_by, created_at DESC);

-- Add index for matched_type (for filtering by reconciliation type)
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_matched_type
  ON public.bank_reconciliations(matched_type);

-- ============================================================================
-- UPDATE RLS POLICIES (Immutable Audit Trail)
-- ============================================================================

-- Drop existing UPDATE/DELETE policies
DROP POLICY IF EXISTS "Users can update own bank reconciliations" ON public.bank_reconciliations;
DROP POLICY IF EXISTS "Users can delete own bank reconciliations" ON public.bank_reconciliations;

-- Update SELECT policy to use created_by (not matched_by)
DROP POLICY IF EXISTS "Users can view own bank reconciliations" ON public.bank_reconciliations;
CREATE POLICY "Users can view own bank reconciliations"
  ON public.bank_reconciliations FOR SELECT
  USING (created_by = auth.uid());

-- Update INSERT policy to use created_by
DROP POLICY IF EXISTS "Users can insert own bank reconciliations" ON public.bank_reconciliations;
CREATE POLICY "Users can insert own bank reconciliations"
  ON public.bank_reconciliations FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- NO UPDATE/DELETE policies → immutable audit trail

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN public.bank_reconciliations.matched_type IS
  'Type of reconciliation: expense, wallet_topup, wallet_spend, settlement, adjustment, ignore';

COMMENT ON COLUMN public.bank_reconciliations.matched_record_id IS
  'FK to expenses/wallet_ledger/settlement_transactions (nullable for adjustment/ignore)';

COMMENT ON COLUMN public.bank_reconciliations.metadata IS
  'Additional data (adjustment_type, ignore_reason, etc.)';

COMMENT ON COLUMN public.bank_reconciliations.created_by IS
  'User who created this reconciliation (replaces matched_by)';

COMMENT ON COLUMN public.bank_reconciliations.created_at IS
  'When reconciliation was created (replaces matched_at)';

COMMENT ON CONSTRAINT bank_reconciliations_bank_txn_unique ON public.bank_reconciliations IS
  'Each bank transaction can only be reconciled once';

COMMENT ON CONSTRAINT bank_reconciliations_matched_type_check ON public.bank_reconciliations IS
  'Valid match types: expense, wallet_topup, wallet_spend, settlement, adjustment, ignore';

-- ============================================================================
-- GRANTS (inherited from migration-014, no changes needed)
-- ============================================================================

-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_reconciliations TO authenticated;
-- Already granted in migration-014, UPDATE/DELETE now blocked by RLS

-- ============================================================================
-- END OF MIGRATION 020
-- ============================================================================
