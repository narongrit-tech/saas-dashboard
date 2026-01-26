-- ============================================
-- Migration 025: Fix order_line_hash unique index to match ON CONFLICT
-- Purpose: Drop partial unique index (WHERE IS NOT NULL) and create full unique index
-- Date: 2026-01-26
-- ============================================

-- ============================================
-- PROBLEM STATEMENT
-- ============================================
-- Current state (migration-024):
--   CREATE UNIQUE INDEX ... WHERE order_line_hash IS NOT NULL
-- This is a PARTIAL unique index that does NOT work with:
--   .upsert(..., { onConflict: 'created_by,order_line_hash' })
--
-- PostgreSQL requires ON CONFLICT to reference a unique constraint WITHOUT a WHERE clause.
--
-- Solution:
--   1. Drop all partial unique indexes on order_line_hash
--   2. Create full unique index on (created_by, order_line_hash) WITHOUT WHERE clause
--
-- This means:
--   - Rows with order_line_hash=NULL can still exist (manual rows)
--   - But duplicates with same (created_by, order_line_hash) are blocked
--   - Upsert ON CONFLICT will work correctly
-- ============================================

-- ============================================
-- STEP 1: Drop all partial unique indexes
-- ============================================

-- Drop known partial index from migration-024
DROP INDEX IF EXISTS public.idx_sales_orders_order_line_hash_unique;

-- Drop any other known problematic indexes
DROP INDEX IF EXISTS public.sales_orders_unique_created_by_order_line_hash;
DROP INDEX IF EXISTS public.sales_orders_unique_order_line_hash;
DROP INDEX IF EXISTS public.sales_orders_unique_order_line_hash_only;

-- ============================================
-- STEP 2: Search and drop ALL partial indexes on order_line_hash
-- ============================================

-- Find and drop any indexes with WHERE clause on order_line_hash
-- This is a safety net in case other migrations added indexes
DO $$
DECLARE
  idx_rec RECORD;
BEGIN
  FOR idx_rec IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'sales_orders'
      AND indexdef LIKE '%order_line_hash%'
      AND indexdef LIKE '%WHERE%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', idx_rec.indexname);
    RAISE NOTICE 'Dropped partial index: %', idx_rec.indexname;
  END LOOP;
END $$;

-- ============================================
-- STEP 3: Create canonical full unique index
-- ============================================

-- Create full unique index WITHOUT WHERE clause
-- This allows:
--   1. Rows with order_line_hash=NULL (manual rows, no deduplication)
--   2. Duplicate detection for imported rows (order_line_hash NOT NULL)
--   3. Upsert ON CONFLICT to work correctly
CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_unique_created_by_order_line_hash
ON public.sales_orders(created_by, order_line_hash);

-- Add comment for clarity
COMMENT ON INDEX public.sales_orders_unique_created_by_order_line_hash IS
'Full unique index (no WHERE clause) to support ON CONFLICT in upsert operations. Allows NULL order_line_hash for manual entries.';

-- ============================================
-- VERIFICATION (Run manually after migration)
-- ============================================

-- 1. Check that no partial indexes exist on order_line_hash
-- SELECT
--   indexname,
--   indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename = 'sales_orders'
--   AND indexdef LIKE '%order_line_hash%'
-- ORDER BY indexname;
--
-- Expected: Only one index (sales_orders_unique_created_by_order_line_hash) WITHOUT WHERE clause

-- 2. Verify upsert works (test import idempotency)
-- Import same file twice → should result in same row count (no duplicates)

-- 3. Check for existing duplicates (should return 0 rows)
-- SELECT
--   created_by,
--   order_line_hash,
--   COUNT(*) as duplicate_count,
--   array_agg(id) as row_ids
-- FROM public.sales_orders
-- WHERE order_line_hash IS NOT NULL
-- GROUP BY created_by, order_line_hash
-- HAVING COUNT(*) > 1;
--
-- If duplicates exist: Manual cleanup required before migration
-- Delete older duplicates: DELETE FROM sales_orders WHERE id = ANY('{uuid1,uuid2,...}');

-- ============================================
-- END OF MIGRATION
-- ============================================
