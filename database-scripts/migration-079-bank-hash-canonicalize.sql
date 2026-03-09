-- Migration 079: Bank Transaction Hash Canonicalization
-- Purpose:
--   The TypeScript generateBankTxnHash used .toString() for amounts, producing
--   "10000" (no decimals). PostgreSQL generate_bank_txn_hash uses NUMERIC::TEXT
--   which produces "10000.00" (with decimals). Same real-world transaction →
--   two different hashes → both rows survived migration-078's dedup.
--
--   This migration:
--   1. Updates the PG function to use 0.00 (NUMERIC literal) so NULL fallback
--      also produces ".00" format consistently.
--   2. Migrates classifications from content-duplicate rows to canonical rows.
--   3. Deletes content-duplicates (same business fields, different hash format).
--   4. Force-recomputes ALL txn_hash to PG canonical format.
--   5. Recreates the unique index (drop first to allow UPDATE).
--
--   After this migration TypeScript uses .toFixed(2) (migration applied in
--   the same commit) and PG uses 0.00 literal — both produce matching hashes.
-- Created: 2026-03-09

-- ============================================================================
-- Step 0: Fix PG function to use 0.00 so NULL fallback also has .00 format
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_bank_txn_hash(
  p_bank_account_id UUID,
  p_txn_date DATE,
  p_withdrawal NUMERIC,
  p_deposit NUMERIC,
  p_description TEXT
) RETURNS VARCHAR(64) AS $$
BEGIN
  -- Uses 0.00 (NUMERIC literal) so COALESCE(NULL, 0.00)::TEXT = "0.00"
  -- matching TypeScript's (0).toFixed(2) = "0.00"
  RETURN encode(
    digest(
      p_bank_account_id::TEXT || '|' ||
      p_txn_date::TEXT || '|' ||
      COALESCE(p_withdrawal, 0.00)::TEXT || '|' ||
      COALESCE(p_deposit, 0.00)::TEXT || '|' ||
      COALESCE(p_description, ''),
      'sha256'
    ),
    'hex'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- Step 1: Drop the unique index temporarily to allow mass UPDATE of txn_hash
-- ============================================================================

DROP INDEX IF EXISTS idx_bank_transactions_unique_hash;

-- ============================================================================
-- Step 2: Migrate classifications from content-duplicate rows → canonical rows
-- Canonical = earliest created_at per canonical business-field hash
-- Uses ON CONFLICT DO NOTHING — canonical rows keep their own classification if exists
-- ============================================================================

INSERT INTO public.bank_txn_classifications (
  bank_transaction_id,
  created_by,
  include_as_revenue,
  revenue_channel,
  revenue_type,
  note,
  updated_at
)
SELECT
  canonical_id,
  cls_created_by,
  include_as_revenue,
  revenue_channel,
  revenue_type,
  note,
  updated_at
FROM (
  -- Find all classifications on non-canonical (duplicate) rows, paired with canonical ID
  SELECT
    canon.id                  AS canonical_id,
    cls.created_by            AS cls_created_by,
    cls.include_as_revenue,
    cls.revenue_channel,
    cls.revenue_type,
    cls.note,
    cls.updated_at
  FROM public.bank_txn_classifications cls
  JOIN public.bank_transactions dup ON dup.id = cls.bank_transaction_id
  -- Canonical row = earliest created_at in same content-duplicate group
  JOIN LATERAL (
    SELECT id
    FROM public.bank_transactions sub
    WHERE sub.created_by      = dup.created_by
      AND sub.bank_account_id = dup.bank_account_id
      AND generate_bank_txn_hash(
            sub.bank_account_id,
            sub.txn_date,
            COALESCE(sub.withdrawal, 0.00),
            COALESCE(sub.deposit, 0.00),
            sub.description
          )
        = generate_bank_txn_hash(
            dup.bank_account_id,
            dup.txn_date,
            COALESCE(dup.withdrawal, 0.00),
            COALESCE(dup.deposit, 0.00),
            dup.description
          )
    ORDER BY sub.created_at ASC
    LIMIT 1
  ) canon ON canon.id != dup.id  -- only process rows that are NOT already canonical
) subq
ON CONFLICT (bank_transaction_id, created_by) DO NOTHING;

-- ============================================================================
-- Step 3: Delete content-duplicate rows (keep earliest created_at per content group)
-- "Content group" = same canonical hash (business fields)
-- ============================================================================

DELETE FROM public.bank_transactions
WHERE id NOT IN (
  SELECT DISTINCT ON (
    created_by,
    bank_account_id,
    generate_bank_txn_hash(
      bank_account_id,
      txn_date,
      COALESCE(withdrawal, 0.00),
      COALESCE(deposit, 0.00),
      description
    )
  )
  id
  FROM public.bank_transactions
  ORDER BY
    created_by,
    bank_account_id,
    generate_bank_txn_hash(
      bank_account_id,
      txn_date,
      COALESCE(withdrawal, 0.00),
      COALESCE(deposit, 0.00),
      description
    ),
    created_at ASC
);

-- ============================================================================
-- Step 4: Force-recompute ALL txn_hash to canonical PG format
-- Now safe since index is dropped and duplicates are removed
-- ============================================================================

UPDATE public.bank_transactions
SET txn_hash = generate_bank_txn_hash(
  bank_account_id,
  txn_date,
  COALESCE(withdrawal, 0.00),
  COALESCE(deposit, 0.00),
  description
);

-- ============================================================================
-- Step 5: Recreate unique index on canonical hashes
-- ============================================================================

CREATE UNIQUE INDEX idx_bank_transactions_unique_hash
  ON public.bank_transactions(created_by, bank_account_id, txn_hash)
  WHERE txn_hash IS NOT NULL;

-- Keep the faster lookup index (created by migration-018)
CREATE INDEX IF NOT EXISTS idx_bank_transactions_hash
  ON public.bank_transactions(txn_hash)
  WHERE txn_hash IS NOT NULL;

-- ============================================================================
-- Verification queries (run manually after applying)
-- ============================================================================

-- 1. Remaining content-duplicates (should be 0):
-- SELECT bank_account_id, txn_date, withdrawal, deposit, description, COUNT(*)
-- FROM public.bank_transactions
-- GROUP BY bank_account_id, txn_date, withdrawal, deposit, description
-- HAVING COUNT(*) > 1;

-- 2. Remaining txn_hash duplicates (should be 0):
-- SELECT created_by, bank_account_id, txn_hash, COUNT(*)
-- FROM public.bank_transactions WHERE txn_hash IS NOT NULL
-- GROUP BY created_by, bank_account_id, txn_hash HAVING COUNT(*) > 1;

-- 3. Rows with NULL txn_hash (should be 0):
-- SELECT COUNT(*) FROM public.bank_transactions WHERE txn_hash IS NULL;

-- 4. Sample hash format check (all should end in .00 pattern in the hash input):
-- SELECT txn_hash, txn_date, deposit, withdrawal FROM public.bank_transactions LIMIT 5;
