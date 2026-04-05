-- ============================================================
-- Migration 101: Deduplicate settlement_transactions and apply
--                UNIQUE (marketplace, txn_id) constraint
--
-- PURPOSE:
--   The old constraint was UNIQUE (marketplace, txn_id, created_by).
--   New business rule: one row per (marketplace, txn_id) across all users.
--   Before creating the new constraint we must remove any rows where the
--   same (marketplace, txn_id) pair exists more than once.
--
-- SAFETY MODEL:
--   For each duplicate group:
--     - Keep the row with the EARLIEST created_at.
--     - Delete all later rows in the group.
--   Financial data is preserved: the earliest import is authoritative.
--   No orphaned FK risk: bank_reconciliations.matched_record_id is a plain
--   UUID column with no FK constraint to settlement_transactions.
--
-- HOW TO RUN:
--   Paste this entire file into Supabase Dashboard → SQL Editor.
--   Run the PRECHECK section first (it is SELECT-only and safe).
--   Review the output, then run the CLEANUP section.
--
-- DATE: 2026-04-05
-- ============================================================


-- ============================================================
-- SECTION 0: PRECHECK (SELECT ONLY — run this first)
-- ============================================================

-- 0-A: Count distinct duplicate groups
SELECT
  COUNT(DISTINCT (marketplace, txn_id)) AS duplicate_groups,
  SUM(cnt - 1)                          AS extra_rows_to_delete
FROM (
  SELECT marketplace, txn_id, COUNT(*) AS cnt
  FROM public.settlement_transactions
  GROUP BY marketplace, txn_id
  HAVING COUNT(*) > 1
) dup;
-- Expected BEFORE cleanup: any number ≥ 0
-- Expected AFTER  cleanup: 0 duplicate_groups, 0 extra_rows_to_delete

-- 0-B: Preview the duplicate rows that WILL be deleted
--      (all rows except the earliest per group)
SELECT
  d.id,
  d.marketplace,
  d.txn_id,
  d.created_by,
  d.created_at,
  d.settlement_amount,
  d.source,
  'WILL DELETE' AS action
FROM public.settlement_transactions d
WHERE d.id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY marketplace, txn_id
        ORDER BY created_at ASC   -- keep earliest
      ) AS rn
    FROM public.settlement_transactions
  ) ranked
  WHERE rn > 1
)
ORDER BY d.marketplace, d.txn_id, d.created_at;

-- 0-C: Preview rows that WILL BE KEPT (one per duplicate group)
SELECT
  k.id,
  k.marketplace,
  k.txn_id,
  k.created_by,
  k.created_at,
  k.settlement_amount,
  'WILL KEEP' AS action
FROM public.settlement_transactions k
WHERE k.id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY marketplace, txn_id
        ORDER BY created_at ASC
      ) AS rn
    FROM public.settlement_transactions
    WHERE (marketplace, txn_id) IN (
      SELECT marketplace, txn_id
      FROM public.settlement_transactions
      GROUP BY marketplace, txn_id
      HAVING COUNT(*) > 1
    )
  ) ranked
  WHERE rn = 1
)
ORDER BY k.marketplace, k.txn_id;

-- 0-D: Check bank_reconciliations soft references to rows that will be deleted
--      (matched_record_id is plain UUID — no FK, but good to know)
SELECT
  br.id              AS reconciliation_id,
  br.matched_record_id,
  br.matched_type,
  st.txn_id,
  st.marketplace,
  'SOFT REF TO BE DELETED' AS warning
FROM public.bank_reconciliations br
JOIN public.settlement_transactions st ON st.id = br.matched_record_id
WHERE st.id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY marketplace, txn_id
             ORDER BY created_at ASC
           ) AS rn
    FROM public.settlement_transactions
  ) ranked
  WHERE rn > 1
);
-- If rows returned: bank_reconciliations.matched_record_id points to a row
-- that will be deleted. The reconciliation record itself is not deleted, but
-- matched_record_id will become a dangling UUID.
-- Recommended: review these manually before proceeding, or re-reconcile after.


-- ============================================================
-- SECTION 1: CLEANUP (Wrapped in transaction — safe to rollback)
-- ============================================================
-- Run this section only after reviewing PRECHECK output.
-- ROLLBACK is available if anything looks wrong.

BEGIN;

-- Capture row count before
DO $$
DECLARE
  total_before INT;
  dup_groups   INT;
  extra_rows   INT;
BEGIN
  SELECT COUNT(*) INTO total_before FROM public.settlement_transactions;
  SELECT
    COUNT(DISTINCT (marketplace, txn_id)),
    COALESCE(SUM(cnt - 1), 0)
  INTO dup_groups, extra_rows
  FROM (
    SELECT marketplace, txn_id, COUNT(*) AS cnt
    FROM public.settlement_transactions
    GROUP BY marketplace, txn_id
    HAVING COUNT(*) > 1
  ) dup;

  RAISE NOTICE '=== BEFORE CLEANUP ===';
  RAISE NOTICE 'Total rows       : %', total_before;
  RAISE NOTICE 'Duplicate groups : %', dup_groups;
  RAISE NOTICE 'Rows to delete   : %', extra_rows;
END $$;


-- Delete all duplicate rows, keeping the earliest (lowest created_at) per group
DELETE FROM public.settlement_transactions
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY marketplace, txn_id
        ORDER BY created_at ASC   -- keep earliest; delete rn > 1
      ) AS rn
    FROM public.settlement_transactions
  ) ranked
  WHERE rn > 1
);


-- Capture row count after and verify
DO $$
DECLARE
  total_after  INT;
  dup_groups   INT;
  rows_deleted INT;
BEGIN
  SELECT COUNT(*) INTO total_after FROM public.settlement_transactions;
  SELECT COUNT(DISTINCT (marketplace, txn_id))
  INTO dup_groups
  FROM (
    SELECT marketplace, txn_id, COUNT(*) AS cnt
    FROM public.settlement_transactions
    GROUP BY marketplace, txn_id
    HAVING COUNT(*) > 1
  ) dup;

  RAISE NOTICE '=== AFTER DELETE ===';
  RAISE NOTICE 'Total rows remaining : %', total_after;
  RAISE NOTICE 'Duplicate groups left: %  (must be 0 to proceed)', dup_groups;

  IF dup_groups > 0 THEN
    RAISE EXCEPTION
      'Duplicates still exist after DELETE (% groups). Rolling back.',
      dup_groups;
  END IF;

  RAISE NOTICE 'Duplicate check PASSED — safe to apply constraint.';
END $$;


-- ============================================================
-- SECTION 2: DROP OLD CONSTRAINT + CREATE NEW
-- ============================================================

-- Drop old composite constraint (marketplace, txn_id, created_by)
ALTER TABLE public.settlement_transactions
  DROP CONSTRAINT IF EXISTS settlement_txns_unique_per_marketplace;

-- Create new team-level constraint (marketplace, txn_id)
ALTER TABLE public.settlement_transactions
  ADD CONSTRAINT settlement_txns_unique_per_marketplace
  UNIQUE (marketplace, txn_id);

COMMENT ON CONSTRAINT settlement_txns_unique_per_marketplace
  ON public.settlement_transactions IS
  'Team-level dedup: one row per (marketplace, txn_id) across all team members. '
  'Replaced (marketplace, txn_id, created_by) from migration-004. '
  'Required for upsert onConflict: ''marketplace,txn_id'' in tiktok-income.ts. '
  'Applied via migration-101 after deduplication cleanup.';


-- ============================================================
-- SECTION 3: VALIDATION
-- ============================================================

-- V-1: Confirm 0 duplicate groups remain
DO $$
DECLARE dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT marketplace, txn_id
    FROM public.settlement_transactions
    GROUP BY marketplace, txn_id
    HAVING COUNT(*) > 1
  ) dup;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: % duplicate (marketplace,txn_id) groups remain', dup_count;
  ELSE
    RAISE NOTICE 'V-1 PASSED: 0 duplicate groups';
  END IF;
END $$;

-- V-2: Confirm new constraint exists with correct columns
DO $$
DECLARE col_list TEXT;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY pos.pos)
  INTO col_list
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS pos(attnum, pos)
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = pos.attnum
  WHERE n.nspname = 'public'
    AND t.relname = 'settlement_transactions'
    AND c.conname = 'settlement_txns_unique_per_marketplace'
    AND c.contype = 'u';

  IF col_list IS DISTINCT FROM 'marketplace,txn_id' THEN
    RAISE EXCEPTION 'VALIDATION FAILED: constraint columns = [%], expected [marketplace,txn_id]', col_list;
  ELSE
    RAISE NOTICE 'V-2 PASSED: constraint columns = [%]', col_list;
  END IF;
END $$;

-- V-3: Confirm old constraint (with created_by) is gone
DO $$
DECLARE found_old INT;
BEGIN
  SELECT COUNT(*) INTO found_old
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'settlement_transactions'
    AND c.conname = 'settlement_txns_unique_per_marketplace'
    AND array_length(c.conkey, 1) = 3;  -- old constraint had 3 columns

  IF found_old > 0 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: old 3-column constraint still exists';
  ELSE
    RAISE NOTICE 'V-3 PASSED: old 3-column constraint is gone';
  END IF;
END $$;

COMMIT;
-- ↑ All three validations must PASS before COMMIT executes.
-- If any RAISE EXCEPTION fires, the transaction is rolled back automatically.


-- ============================================================
-- SECTION 4: POST-COMMIT VERIFICATION (run after COMMIT)
-- ============================================================

-- Confirm final state of constraint
SELECT
  c.conname                                                AS constraint_name,
  c.contype                                               AS type,
  string_agg(a.attname, ',' ORDER BY pos.pos)            AS columns,
  pg_get_constraintdef(c.oid)                             AS definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS pos(attnum, pos)
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = pos.attnum
WHERE n.nspname = 'public'
  AND t.relname = 'settlement_transactions'
  AND c.conname = 'settlement_txns_unique_per_marketplace'
GROUP BY c.conname, c.contype, c.oid;

-- Expected:
--   constraint_name = settlement_txns_unique_per_marketplace
--   type = u
--   columns = marketplace,txn_id
--   definition = UNIQUE (marketplace, txn_id)

-- Confirm total row count (sanity check)
SELECT
  COUNT(*)                      AS total_rows,
  COUNT(DISTINCT (marketplace, txn_id)) AS unique_pairs
FROM public.settlement_transactions;
-- total_rows should equal unique_pairs (no duplicates)
