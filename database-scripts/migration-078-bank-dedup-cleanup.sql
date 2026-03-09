-- Migration 078: Bank Transaction Deduplication Cleanup
-- Purpose:
--   1. Backfill txn_hash for all existing NULL rows (migration-018 left backfill commented out)
--   2. Migrate classifications from duplicate rows to canonical rows before deletion
--   3. Delete duplicate bank_transactions (keep earliest created_at per group)
-- Root cause: migration-018 added partial unique index WHERE txn_hash IS NOT NULL,
--   but the backfill UPDATE was commented out. Old NULL-hash rows + new rows with
--   same content created visible duplicates in the Dashboard bank inflow selector.
-- Created: 2026-03-09

-- ============================================================================
-- Step 1: Backfill txn_hash for all NULL rows
-- ============================================================================

UPDATE public.bank_transactions
SET txn_hash = public.generate_bank_txn_hash(
  bank_account_id,
  txn_date,
  COALESCE(withdrawal, 0),
  COALESCE(deposit, 0),
  description
)
WHERE txn_hash IS NULL;

-- Verify: should return 0 after backfill
-- SELECT COUNT(*) FROM public.bank_transactions WHERE txn_hash IS NULL;

-- ============================================================================
-- Step 2: Move classifications from duplicate rows → canonical rows
-- Canonical = earliest created_at per (created_by, bank_account_id, txn_hash)
-- Only move if the canonical row does NOT already have a classification for that user
-- Uses ON CONFLICT DO NOTHING to skip if canonical already classified
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
  canonical.id         AS bank_transaction_id,
  cls.created_by,
  cls.include_as_revenue,
  cls.revenue_channel,
  cls.revenue_type,
  cls.note,
  cls.updated_at
FROM public.bank_txn_classifications cls
JOIN public.bank_transactions dup
  ON dup.id = cls.bank_transaction_id
-- Find the canonical (earliest) row in the same duplicate group
JOIN LATERAL (
  SELECT id
  FROM public.bank_transactions sub
  WHERE sub.created_by     = dup.created_by
    AND sub.bank_account_id = dup.bank_account_id
    AND sub.txn_hash        = dup.txn_hash
    AND sub.txn_hash IS NOT NULL
  ORDER BY sub.created_at ASC
  LIMIT 1
) canonical ON canonical.id != dup.id  -- only process actual duplicate rows
ON CONFLICT (bank_transaction_id, created_by) DO NOTHING;

-- ============================================================================
-- Step 3: Delete duplicate rows (keep earliest created_at per group)
-- ON DELETE CASCADE on bank_txn_classifications removes leftover classifications
-- on the deleted duplicate rows (canonical rows keep their classifications
-- from Step 2 above)
-- ============================================================================

DELETE FROM public.bank_transactions
WHERE txn_hash IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (created_by, bank_account_id, txn_hash) id
    FROM public.bank_transactions
    WHERE txn_hash IS NOT NULL
    ORDER BY created_by, bank_account_id, txn_hash, created_at ASC
  );

-- ============================================================================
-- Step 4: Safety check — show remaining duplicate count (should be 0)
-- Run this manually after applying to verify:
-- ============================================================================

-- SELECT created_by, bank_account_id, txn_hash, COUNT(*) AS cnt
-- FROM public.bank_transactions
-- WHERE txn_hash IS NOT NULL
-- GROUP BY created_by, bank_account_id, txn_hash
-- HAVING COUNT(*) > 1
-- ORDER BY cnt DESC;

-- ============================================================================
-- Step 5: Verify no orphaned bank_txn_classifications remain
-- ============================================================================

-- SELECT COUNT(*) FROM public.bank_txn_classifications cls
-- WHERE NOT EXISTS (
--   SELECT 1 FROM public.bank_transactions bt WHERE bt.id = cls.bank_transaction_id
-- );

-- ============================================================================
-- Notes
-- ============================================================================

COMMENT ON TABLE public.bank_transactions IS
  'Bank statement transactions. txn_hash is SHA256(bank_account_id|txn_date|withdrawal|deposit|description). Partial unique index on (created_by, bank_account_id, txn_hash) WHERE txn_hash IS NOT NULL prevents row-level duplicates.';
