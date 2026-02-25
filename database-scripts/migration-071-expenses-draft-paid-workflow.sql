-- Migration 071: Expenses Draft → Paid Workflow
-- Adds lifecycle status (DRAFT/PAID), planned_date, paid_date, vendor, and future-proof fields
-- Phase A: manual confirm paid with slip attachment required
-- Phase C (future): bank reconcile suggest via bank_transaction_id

-- ============================================================
-- 1. Create expense_status enum (idempotent)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_status') THEN
    CREATE TYPE expense_status AS ENUM ('DRAFT', 'PAID');
  END IF;
END$$;

-- ============================================================
-- 2. Add new columns to expenses table
-- ============================================================
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS expense_status expense_status NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS planned_date DATE,
  ADD COLUMN IF NOT EXISTS paid_date DATE,
  ADD COLUMN IF NOT EXISTS paid_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_confirmed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS vendor TEXT,
  ADD COLUMN IF NOT EXISTS bank_transaction_id UUID NULL;  -- future-proof for Phase C, unused now

-- ============================================================
-- 3. Backfill existing expenses as PAID
-- All records entered before this migration are treated as already-confirmed payments.
-- planned_date = expense_date (the original entry date)
-- paid_date    = expense_date (best estimate; no slip required retroactively)
-- paid_confirmed_at = created_at (when the record was originally created)
-- ============================================================
UPDATE expenses
SET
  expense_status     = 'PAID',
  planned_date       = expense_date::date,
  paid_date          = expense_date::date,
  paid_confirmed_at  = created_at
WHERE paid_date IS NULL;

-- ============================================================
-- 4. Indexes for common query patterns
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_expenses_status_date ON expenses(expense_status, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_status_paid_date ON expenses(expense_status, paid_date) WHERE paid_date IS NOT NULL;

-- ============================================================
-- 5. RLS: No changes needed
-- expenses table already enforces created_by = auth.uid() via migration-066
-- ============================================================

-- Verify: SELECT expense_status, COUNT(*) FROM expenses GROUP BY expense_status;
-- Expected: all existing rows → PAID, no DRAFT rows after backfill
