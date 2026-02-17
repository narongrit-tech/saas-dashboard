-- Migration 058: CEO Commission Flow
-- Purpose: Track CEO commission receipts and Director Loan transfers
-- Date: 2026-02-17
-- Author: Claude Code

-- ============================================================================
-- 1. Extend wallet_type to include DIRECTOR_LOAN
-- ============================================================================

-- Drop existing CHECK constraint
ALTER TABLE wallets
  DROP CONSTRAINT IF EXISTS wallets_wallet_type_valid;

-- Recreate with DIRECTOR_LOAN included
ALTER TABLE wallets
  ADD CONSTRAINT wallets_wallet_type_valid
  CHECK (wallet_type IN ('ADS', 'SUBSCRIPTION', 'OTHER', 'DIRECTOR_LOAN'));

-- ============================================================================
-- 2. Create ceo_commission_receipts table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ceo_commission_receipts (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Audit
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Commission data (Bangkok timezone, stored as DATE)
  commission_date DATE NOT NULL,
  platform TEXT NOT NULL CHECK (platform <> ''),

  -- Amounts (2 decimal precision)
  gross_amount NUMERIC(12, 2) NOT NULL CHECK (gross_amount > 0),
  personal_used_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (personal_used_amount >= 0),
  transferred_to_company_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (transferred_to_company_amount >= 0),

  -- Balance equation constraint
  CONSTRAINT amount_balance_check CHECK (
    gross_amount = personal_used_amount + transferred_to_company_amount
  ),

  -- Optional metadata
  note TEXT,
  reference TEXT
);

-- ============================================================================
-- 3. Create indexes
-- ============================================================================

-- Performance: Query by date (most common filter)
CREATE INDEX idx_ceo_commission_date
  ON ceo_commission_receipts(commission_date DESC);

-- Performance: Query by platform
CREATE INDEX idx_ceo_commission_platform
  ON ceo_commission_receipts(platform);

-- Performance: Query by creator (for RLS)
CREATE INDEX idx_ceo_commission_created_by
  ON ceo_commission_receipts(created_by);

-- Idempotency: Prevent duplicate commission on same date + platform + user
CREATE UNIQUE INDEX idx_ceo_commission_unique
  ON ceo_commission_receipts(commission_date, platform, created_by);

-- ============================================================================
-- 4. Create updated_at trigger
-- ============================================================================

CREATE TRIGGER trg_ceo_commission_updated_at
  BEFORE UPDATE ON ceo_commission_receipts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Note: update_updated_at_column() function should already exist from previous migrations

-- ============================================================================
-- 5. Enable RLS (Row Level Security)
-- ============================================================================

ALTER TABLE ceo_commission_receipts ENABLE ROW LEVEL SECURITY;

-- Policy: Users can SELECT their own records
CREATE POLICY ceo_commission_select_own
  ON ceo_commission_receipts
  FOR SELECT
  USING (created_by = auth.uid());

-- Policy: Users can INSERT their own records
CREATE POLICY ceo_commission_insert_own
  ON ceo_commission_receipts
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- Policy: Users can UPDATE their own records
CREATE POLICY ceo_commission_update_own
  ON ceo_commission_receipts
  FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Note: No DELETE policy initially (append-only design)
-- If needed later, add: CREATE POLICY ceo_commission_delete_own ...

-- ============================================================================
-- 6. Add column comments (documentation)
-- ============================================================================

COMMENT ON TABLE ceo_commission_receipts IS
  'Tracks CEO commission receipts from platforms (e.g., TikTok). Records how much was used personally vs transferred to company as Director Loan.';

COMMENT ON COLUMN ceo_commission_receipts.commission_date IS
  'Date when commission was received (Bangkok timezone, stored as DATE).';

COMMENT ON COLUMN ceo_commission_receipts.platform IS
  'Platform that paid the commission (e.g., "TikTok", "Shopee").';

COMMENT ON COLUMN ceo_commission_receipts.gross_amount IS
  'Total commission received before any split.';

COMMENT ON COLUMN ceo_commission_receipts.personal_used_amount IS
  'Amount used personally by CEO (not transferred to company).';

COMMENT ON COLUMN ceo_commission_receipts.transferred_to_company_amount IS
  'Amount transferred to company (recorded as Director Loan via wallet_ledger).';

COMMENT ON COLUMN ceo_commission_receipts.reference IS
  'Optional external reference (e.g., transaction ID, bank reference).';

-- ============================================================================
-- 7. Verification queries (run after migration)
-- ============================================================================

-- Check table created
-- SELECT * FROM information_schema.tables WHERE table_name = 'ceo_commission_receipts';

-- Check wallet constraint updated
-- SELECT constraint_name, check_clause
-- FROM information_schema.check_constraints
-- WHERE constraint_name = 'wallets_wallet_type_valid';

-- Check indexes
-- SELECT indexname FROM pg_indexes WHERE tablename = 'ceo_commission_receipts';

-- Check RLS enabled
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'ceo_commission_receipts';

-- ============================================================================
-- End of migration-058
-- ============================================================================
