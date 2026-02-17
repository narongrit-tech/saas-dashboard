-- Migration 059: CEO Commission Bank Sources + Transaction Linking
-- Purpose: Link CEO commissions to actual bank transactions with strict source filtering
-- Date: 2026-02-17
-- Author: Claude Code (Orchestration)

-- ============================================================================
-- 1. Create ceo_commission_sources table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ceo_commission_sources (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Audit
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Source bank account
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,

  -- Idempotency: user can only add each bank account once
  CONSTRAINT ceo_commission_sources_unique UNIQUE (created_by, bank_account_id)
);

-- Index for RLS performance
CREATE INDEX idx_ceo_commission_sources_created_by
  ON ceo_commission_sources(created_by);

-- Index for bank account lookups
CREATE INDEX idx_ceo_commission_sources_bank_account
  ON ceo_commission_sources(bank_account_id);

-- Enable RLS
ALTER TABLE ceo_commission_sources ENABLE ROW LEVEL SECURITY;

-- Policy: Users can SELECT their own sources
CREATE POLICY ceo_commission_sources_select_own
  ON ceo_commission_sources
  FOR SELECT
  USING (created_by = auth.uid());

-- Policy: Users can INSERT their own sources
CREATE POLICY ceo_commission_sources_insert_own
  ON ceo_commission_sources
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- Policy: Users can DELETE their own sources
CREATE POLICY ceo_commission_sources_delete_own
  ON ceo_commission_sources
  FOR DELETE
  USING (created_by = auth.uid());

-- Comments
COMMENT ON TABLE ceo_commission_sources IS
  'User-selected bank accounts that are sources of CEO commission. Used to filter candidate transactions in import-from-bank flow.';

COMMENT ON COLUMN ceo_commission_sources.bank_account_id IS
  'Bank account that receives CEO commission deposits (e.g., CEO personal account).';

-- ============================================================================
-- 2. Add bank_transaction_id to ceo_commission_receipts
-- ============================================================================

-- Add column (nullable - manual entries won't have bank_transaction_id)
ALTER TABLE ceo_commission_receipts
  ADD COLUMN IF NOT EXISTS bank_transaction_id UUID NULL
    REFERENCES bank_transactions(id) ON DELETE SET NULL;

-- Idempotency: Each bank transaction can only be declared as commission once per user
CREATE UNIQUE INDEX idx_ceo_commission_receipts_bank_txn_unique
  ON ceo_commission_receipts(created_by, bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL;

-- Index for lookups
CREATE INDEX idx_ceo_commission_receipts_bank_txn
  ON ceo_commission_receipts(bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL;

-- Comment
COMMENT ON COLUMN ceo_commission_receipts.bank_transaction_id IS
  'Links this commission receipt to a bank transaction (null for manual entries). Unique per user to prevent duplicate declarations.';

-- ============================================================================
-- 3. Verify wallet_ledger idempotency (reference_id already exists)
-- ============================================================================

-- Note: wallet_ledger already has reference_id column (checked in types/wallets.ts line 35)
-- We use reference_id format: 'CEO_COMMISSION:{receipt_id}' for idempotency
-- Application code will check existing wallet_ledger entries before creating TOP_UP

-- Add comment to clarify usage
COMMENT ON COLUMN wallet_ledger.reference_id IS
  'External reference ID for idempotency. Examples:
   - CEO_COMMISSION:{uuid} = Director Loan from CEO commission transfer
   - TT_CASHFLOW:{uuid} = TikTok cashflow import
   - MANUAL = Manual entry';

-- Optional: Create partial index for CEO commission lookups (performance)
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_ceo_commission_ref
  ON wallet_ledger(reference_id)
  WHERE reference_id LIKE 'CEO_COMMISSION:%';

-- ============================================================================
-- 4. Helper: Get candidate bank transactions for CEO commission
-- ============================================================================

-- This is a documented query pattern (not a view, to avoid RLS complexity)
-- Application code will implement this query with proper filters

/*
QUERY PATTERN: Get candidate bank transactions for CEO commission import

SELECT bt.*
FROM bank_transactions bt
WHERE bt.created_by = auth.uid()
  AND bt.bank_account_id IN (
    -- Only from user-selected commission source accounts
    SELECT bank_account_id
    FROM ceo_commission_sources
    WHERE created_by = auth.uid()
  )
  AND bt.deposit > 0  -- Money IN only
  AND bt.bank_transaction_id NOT IN (
    -- Not already declared as commission
    SELECT bank_transaction_id
    FROM ceo_commission_receipts
    WHERE created_by = auth.uid()
      AND bank_transaction_id IS NOT NULL
  )
  -- Optional filters:
  -- AND bt.txn_date >= ? (start date)
  -- AND bt.txn_date <= ? (end date)
  -- AND bt.cash_in_type IS NULL (unclassified only)
ORDER BY bt.txn_date DESC, bt.created_at DESC;
*/

-- ============================================================================
-- 5. Data Integrity Checks
-- ============================================================================

-- Check 1: Verify no orphaned commission sources (should be impossible with FK CASCADE)
DO $$
DECLARE
  orphan_count INT;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM ceo_commission_sources cs
  WHERE NOT EXISTS (
    SELECT 1 FROM bank_accounts ba
    WHERE ba.id = cs.bank_account_id
  );

  IF orphan_count > 0 THEN
    RAISE WARNING 'Found % orphaned ceo_commission_sources records', orphan_count;
  END IF;
END $$;

-- Check 2: Verify no duplicate bank_transaction_id declarations per user
DO $$
DECLARE
  dupe_count INT;
BEGIN
  SELECT COUNT(*) INTO dupe_count
  FROM (
    SELECT created_by, bank_transaction_id, COUNT(*) as cnt
    FROM ceo_commission_receipts
    WHERE bank_transaction_id IS NOT NULL
    GROUP BY created_by, bank_transaction_id
    HAVING COUNT(*) > 1
  ) dupes;

  IF dupe_count > 0 THEN
    RAISE WARNING 'Found % duplicate bank_transaction_id declarations (constraint will prevent new ones)', dupe_count;
  END IF;
END $$;

-- ============================================================================
-- 6. Migration Summary
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 059: CEO Commission Bank Sources - COMPLETED';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Created:';
  RAISE NOTICE '  - ceo_commission_sources table (with RLS)';
  RAISE NOTICE '  - bank_transaction_id column in ceo_commission_receipts';
  RAISE NOTICE '  - Unique constraint on (created_by, bank_transaction_id)';
  RAISE NOTICE '  - Indexes for performance';
  RAISE NOTICE '';
  RAISE NOTICE 'Notes:';
  RAISE NOTICE '  - wallet_ledger.reference_id already exists (reusing for idempotency)';
  RAISE NOTICE '  - Format: CEO_COMMISSION:{receipt_id}';
  RAISE NOTICE '  - Application code must check wallet_ledger before creating TOP_UP';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '  1. Update TypeScript types';
  RAISE NOTICE '  2. Implement server actions for source management';
  RAISE NOTICE '  3. Implement import-from-bank flow';
  RAISE NOTICE '  4. Add Settings UI for bank source selection';
  RAISE NOTICE '  5. Add Import from Bank dialog';
  RAISE NOTICE '=================================================================';
END $$;

-- ============================================================================
-- 7. Verification Queries (run after migration to verify)
-- ============================================================================

-- Check tables created
-- SELECT * FROM information_schema.tables
-- WHERE table_name IN ('ceo_commission_sources', 'ceo_commission_receipts');

-- Check RLS enabled
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE tablename = 'ceo_commission_sources';

-- Check indexes
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename IN ('ceo_commission_sources', 'ceo_commission_receipts')
-- ORDER BY tablename, indexname;

-- Check constraints
-- SELECT constraint_name, constraint_type
-- FROM information_schema.table_constraints
-- WHERE table_name IN ('ceo_commission_sources', 'ceo_commission_receipts')
-- ORDER BY table_name, constraint_type;

-- ============================================================================
-- End of migration-059
-- ============================================================================
