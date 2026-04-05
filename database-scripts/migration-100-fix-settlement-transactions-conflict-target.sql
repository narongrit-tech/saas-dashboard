-- ============================================================
-- Migration 100: Fix settlement_transactions ON CONFLICT target (42P10 hotfix)
-- PURPOSE: Replace UNIQUE (marketplace, txn_id, created_by) with
--          UNIQUE (marketplace, txn_id) to match the onConflict target
--          used in tiktok-income.ts.
--
-- ROOT CAUSE:
--   Code (tiktok-income.ts L421-426) uses:
--     .upsert(rows, { onConflict: 'marketplace,txn_id' })
--   DB (from migration-004) has:
--     CONSTRAINT settlement_txns_unique_per_marketplace
--       UNIQUE (marketplace, txn_id, created_by)
--   PostgreSQL 42P10: no unique constraint matches ON CONFLICT on
--   (marketplace, txn_id) without created_by → import fails silently.
--
-- SAME ROOT CAUSE AS:
--   migration-099-fix-sales-orders-conflict-target.sql
--   Both are targeted fixes for the settlement_transactions portion of
--   migration-093-team-unique-constraint-hardening.sql which was never
--   applied to production.
--
-- WHY THIS FIX IS CORRECT:
--   Team-level dedup: one transaction per (marketplace, txn_id) regardless
--   of which team member imported it. File-level dedup prevents the same
--   file from being imported twice (import_batches.file_hash + report_type).
--
-- DATE: 2026-04-05
-- AUTHOR: Claude (bugfix for 42P10 on TikTok income import)
-- ============================================================


-- ============================================================
-- PRECHECK: Run this first — must return 0 rows before proceeding.
-- Checks for cross-user duplicate (marketplace, txn_id) pairs.
-- Should always be 0 because each user's imports should be deduplicated
-- by the import_batches file-level dedup, but verify to be safe.
-- ============================================================

-- SELECT marketplace, txn_id, COUNT(DISTINCT created_by) AS user_count
-- FROM public.settlement_transactions
-- GROUP BY marketplace, txn_id
-- HAVING COUNT(DISTINCT created_by) > 1
-- LIMIT 5;

-- If rows returned: two team members imported the same txn_id via different files.
-- Resolution: delete the older duplicate rows before applying this migration.
-- SELECT id, marketplace, txn_id, created_by, created_at
-- FROM public.settlement_transactions
-- WHERE (marketplace, txn_id) IN (
--   SELECT marketplace, txn_id FROM public.settlement_transactions
--   GROUP BY marketplace, txn_id HAVING COUNT(DISTINCT created_by) > 1
-- )
-- ORDER BY marketplace, txn_id, created_at;


-- ============================================================
-- STEP 1: Drop old composite constraint (includes created_by)
-- ============================================================

ALTER TABLE public.settlement_transactions
  DROP CONSTRAINT IF EXISTS settlement_txns_unique_per_marketplace;


-- ============================================================
-- STEP 2: Add new team-level constraint (no created_by)
-- ============================================================

ALTER TABLE public.settlement_transactions
  ADD CONSTRAINT settlement_txns_unique_per_marketplace
  UNIQUE (marketplace, txn_id);

COMMENT ON CONSTRAINT settlement_txns_unique_per_marketplace
  ON public.settlement_transactions IS
  'Team-level dedup: one row per (marketplace, txn_id) across all team members. '
  'Replaces (marketplace, txn_id, created_by) from migration-004. '
  'Required for PostgREST ON CONFLICT inference with onConflict: ''marketplace,txn_id''. '
  'Equivalent to the settlement_transactions block in migration-093.';


-- ============================================================
-- VERIFY (run after applying)
-- See: database-scripts/verify-sales-orders-conflict-constraint.sql
-- for the pattern. Quick check for this table:
-- ============================================================
-- SELECT
--   conname,
--   pg_get_constraintdef(oid) AS definition
-- FROM pg_constraint
-- WHERE conrelid = 'public.settlement_transactions'::regclass
--   AND contype = 'u'
--   AND conname = 'settlement_txns_unique_per_marketplace';
--
-- Expected: UNIQUE (marketplace, txn_id)  ← no created_by
-- ============================================================
