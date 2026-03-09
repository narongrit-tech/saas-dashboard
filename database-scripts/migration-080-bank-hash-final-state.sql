-- Migration 080: Bank Transaction Hash — Final State Verification & Safety Net
-- Purpose:
--   Idempotent guard that ensures the bank_transactions table is in the correct
--   state on ALL environments (production, staging, fresh dev) regardless of
--   whether migrations 078 and/or 079 were applied.
--
--   Safe to re-run at any time. Fast no-op when state is already correct.
--
-- Background:
--   Migration 078 (2026-03-09): backfilled txn_hash for NULL rows, removed
--     hash-identical duplicates. Incomplete — did not catch cross-format dupes.
--   Migration 079 (2026-03-09): fixed PG hash function (0.00 vs 0), force-
--     recomputed all hashes to canonical format, removed content-identical dupes
--     that survived 078 due to different hash formats (TS vs PG number format).
--   This migration is a safety net if 078 or 079 did not fully apply.
--
-- Canonical hash format: generate_bank_txn_hash with COALESCE(..., 0.00)
--   amounts formatted as NUMERIC with 2 decimal places ("10000.00" not "10000")
--   TypeScript uses (amount).toFixed(2) to match.
-- Created: 2026-03-09

-- ============================================================================
-- Step 0: Ensure PG hash function is at canonical version (idempotent)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_bank_txn_hash(
  p_bank_account_id UUID,
  p_txn_date DATE,
  p_withdrawal NUMERIC,
  p_deposit NUMERIC,
  p_description TEXT
) RETURNS VARCHAR(64) AS $$
BEGIN
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
-- Step 1: Backfill any remaining NULL txn_hash rows (idempotent)
-- ============================================================================

UPDATE public.bank_transactions
SET txn_hash = generate_bank_txn_hash(
  bank_account_id, txn_date,
  COALESCE(withdrawal, 0.00),
  COALESCE(deposit, 0.00),
  description
)
WHERE txn_hash IS NULL;

-- ============================================================================
-- Step 2: Migrate classifications from content-duplicate rows → canonical rows
-- Canonical = earliest created_at per canonical business-field hash group.
-- ON CONFLICT DO NOTHING: canonical's own classification is never overwritten.
-- Idempotent: on clean systems this INSERT touches 0 rows.
-- ============================================================================

INSERT INTO public.bank_txn_classifications (
  bank_transaction_id, created_by,
  include_as_revenue, revenue_channel, revenue_type, note, updated_at
)
SELECT
  canon.id      AS bank_transaction_id,
  cls.created_by,
  cls.include_as_revenue,
  cls.revenue_channel,
  cls.revenue_type,
  cls.note,
  cls.updated_at
FROM public.bank_txn_classifications cls
JOIN public.bank_transactions dup ON dup.id = cls.bank_transaction_id
JOIN LATERAL (
  SELECT id
  FROM public.bank_transactions sub
  WHERE sub.created_by      = dup.created_by
    AND sub.bank_account_id = dup.bank_account_id
    AND generate_bank_txn_hash(
          sub.bank_account_id, sub.txn_date,
          COALESCE(sub.withdrawal, 0.00), COALESCE(sub.deposit, 0.00),
          sub.description)
      = generate_bank_txn_hash(
          dup.bank_account_id, dup.txn_date,
          COALESCE(dup.withdrawal, 0.00), COALESCE(dup.deposit, 0.00),
          dup.description)
  ORDER BY sub.created_at ASC
  LIMIT 1
) canon ON canon.id != dup.id   -- only rows that are NOT already canonical
ON CONFLICT (bank_transaction_id, created_by) DO NOTHING;

-- ============================================================================
-- Step 3: Delete content-duplicate rows (keep earliest created_at per group)
-- Idempotent: on clean systems this DELETE touches 0 rows.
-- ON DELETE CASCADE removes orphaned classifications on the deleted rows.
-- ============================================================================

DELETE FROM public.bank_transactions
WHERE id NOT IN (
  SELECT DISTINCT ON (
    created_by,
    bank_account_id,
    generate_bank_txn_hash(
      bank_account_id, txn_date,
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
      bank_account_id, txn_date,
      COALESCE(withdrawal, 0.00),
      COALESCE(deposit, 0.00),
      description
    ),
    created_at ASC
);

-- ============================================================================
-- Step 4: Canonicalize txn_hash for any rows with stale format
-- Drops and recreates index only if needed — skipped on clean systems.
-- ============================================================================

DO $$
DECLARE
  stale_count INT;
BEGIN
  SELECT COUNT(*) INTO stale_count
  FROM public.bank_transactions
  WHERE txn_hash IS DISTINCT FROM generate_bank_txn_hash(
    bank_account_id, txn_date,
    COALESCE(withdrawal, 0.00),
    COALESCE(deposit, 0.00),
    description
  );

  IF stale_count > 0 THEN
    RAISE NOTICE 'migration-080: % rows with non-canonical txn_hash — re-canonicalizing.', stale_count;

    DROP INDEX IF EXISTS idx_bank_transactions_unique_hash;

    UPDATE public.bank_transactions
    SET txn_hash = generate_bank_txn_hash(
      bank_account_id, txn_date,
      COALESCE(withdrawal, 0.00),
      COALESCE(deposit, 0.00),
      description
    );

    CREATE UNIQUE INDEX idx_bank_transactions_unique_hash
      ON public.bank_transactions(created_by, bank_account_id, txn_hash)
      WHERE txn_hash IS NOT NULL;

    RAISE NOTICE 'migration-080: Re-canonicalization complete, index recreated.';
  ELSE
    RAISE NOTICE 'migration-080: All txn_hash values already canonical. Skipping update.';
  END IF;
END $$;

-- ============================================================================
-- Step 5: Ensure unique index exists (safe if already created above)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'bank_transactions'
      AND indexname  = 'idx_bank_transactions_unique_hash'
  ) THEN
    CREATE UNIQUE INDEX idx_bank_transactions_unique_hash
      ON public.bank_transactions(created_by, bank_account_id, txn_hash)
      WHERE txn_hash IS NOT NULL;
    RAISE NOTICE 'migration-080: Unique index created.';
  ELSE
    RAISE NOTICE 'migration-080: Unique index already exists.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_hash
  ON public.bank_transactions(txn_hash)
  WHERE txn_hash IS NOT NULL;

-- ============================================================================
-- Step 6: State validation — raises EXCEPTION if anything is still wrong
-- ============================================================================

DO $$
DECLARE
  null_count  INT;
  dup_count   INT;
  total_count INT;
BEGIN
  SELECT COUNT(*) INTO total_count FROM public.bank_transactions;

  SELECT COUNT(*) INTO null_count
  FROM public.bank_transactions
  WHERE txn_hash IS NULL;

  SELECT COUNT(*) INTO dup_count FROM (
    SELECT 1
    FROM public.bank_transactions
    WHERE txn_hash IS NOT NULL
    GROUP BY created_by, bank_account_id, txn_hash
    HAVING COUNT(*) > 1
  ) sub;

  RAISE NOTICE 'migration-080 final state: total_rows=%, null_hash=%, dup_groups=%',
    total_count, null_count, dup_count;

  IF null_count > 0 OR dup_count > 0 THEN
    RAISE EXCEPTION
      'migration-080 FAILED state check: null_hash=%, dup_groups=%. Manual intervention required.',
      null_count, dup_count;
  END IF;

  RAISE NOTICE 'migration-080 PASSED. Bank transactions table is clean and canonical.';
END $$;
