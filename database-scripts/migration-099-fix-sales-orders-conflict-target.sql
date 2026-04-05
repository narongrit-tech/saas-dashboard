-- ============================================================
-- Migration 099: Fix sales_orders ON CONFLICT target (42P10 hotfix)
-- PURPOSE: Replace composite index (created_by, order_line_hash) with
--          single-column index (order_line_hash) to match the onConflict
--          target used in sales-import-actions.ts.
--
-- ROOT CAUSE:
--   Code (sales-import-actions.ts L1102, L1703) uses:
--     .upsert(rows, { onConflict: 'order_line_hash' })
--   DB (from migration-025) has:
--     UNIQUE INDEX sales_orders_unique_created_by_order_line_hash
--       ON sales_orders(created_by, order_line_hash)
--   PostgreSQL 42P10: no unique constraint matches ON CONFLICT on
--   single column 'order_line_hash' → import fails on every chunk.
--
-- WHY THIS FIX IS CORRECT:
--   Migration-093 was written alongside the code change (onConflict:
--   'order_line_hash') but was never applied to production. This migration
--   is a targeted, standalone equivalent of the sales_orders portion of
--   migration-093. It is safe to apply without migration-093's other changes.
--
-- DEDUP BEHAVIOUR AFTER FIX:
--   - order_line_hash still includes created_by in its hash input, so
--     each user's import produces a user-scoped unique hash → same-user
--     re-import is idempotent (upsert updates in place).
--   - Cross-user dedup for the same file is handled at the import_batches
--     level (file_hash + report_type unique index).
--   - NULL order_line_hash rows (manual entries) each remain distinct
--     because PostgreSQL treats NULLs as unique in indexes.
--
-- PRECHECK: Confirm 0 rows before applying (should always be 0 because
--   hash includes created_by, so same-hash rows cannot come from
--   different users):
--
--   SELECT order_line_hash, COUNT(*) AS cnt
--   FROM public.sales_orders
--   WHERE order_line_hash IS NOT NULL
--   GROUP BY order_line_hash
--   HAVING COUNT(*) > 1
--   LIMIT 5;
--
-- DATE: 2026-04-05
-- AUTHOR: Claude (bugfix for 42P10 on sales import)
-- ============================================================


-- ============================================================
-- STEP 1: Drop all existing order_line_hash indexes (any variant)
-- ============================================================

-- Drop composite index from migration-025
DROP INDEX IF EXISTS public.sales_orders_unique_created_by_order_line_hash;

-- Drop any leftover partial index from migration-024
DROP INDEX IF EXISTS public.idx_sales_orders_order_line_hash_unique;

-- Safety net: drop any other partial indexes on order_line_hash
DO $$
DECLARE
  idx_rec RECORD;
BEGIN
  FOR idx_rec IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'sales_orders'
      AND indexdef   LIKE '%order_line_hash%'
      AND indexname  != 'sales_orders_unique_order_line_hash'  -- keep target if it already exists
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', idx_rec.indexname);
    RAISE NOTICE 'Dropped index: %', idx_rec.indexname;
  END LOOP;
END $$;


-- ============================================================
-- STEP 2: Create canonical single-column unique index
-- ============================================================

-- This is the index that PostgREST/Supabase needs to resolve
-- .upsert({ onConflict: 'order_line_hash' }) correctly.
-- Non-partial (no WHERE clause) is required — partial indexes are NOT
-- eligible for ON CONFLICT inference in PostgREST.
CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_unique_order_line_hash
  ON public.sales_orders(order_line_hash);

COMMENT ON INDEX public.sales_orders_unique_order_line_hash IS
  'Canonical dedup index for sales import ON CONFLICT. '
  'Single-column (order_line_hash); no WHERE clause required for PostgREST inference. '
  'hash input = created_by|source_platform|external_order_id|product_name|qty|amount '
  '→ same-user re-import is idempotent; cross-user file dedup via import_batches. '
  'Replaces sales_orders_unique_created_by_order_line_hash (migration-025). '
  'Equivalent to the sales_orders block in migration-093.';


-- ============================================================
-- VERIFY (run after applying)
-- ============================================================
-- See: database-scripts/verify-sales-orders-conflict-constraint.sql
-- Quick check:
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename  = 'sales_orders'
--   AND indexdef   LIKE '%order_line_hash%'
-- ORDER BY indexname;
--
-- Expected: exactly one row
--   indexname  = sales_orders_unique_order_line_hash
--   indexdef   = CREATE UNIQUE INDEX ... ON public.sales_orders USING btree (order_line_hash)
--   (NO "WHERE" clause, NO "created_by")
-- ============================================================
