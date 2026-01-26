-- ============================================
-- Verification Script: Migration 025
-- Purpose: Verify order_line_hash unique index is correct
-- Date: 2026-01-26
-- ============================================

-- ============================================
-- TEST 1: Check Index Definitions
-- ============================================

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'sales_orders'
  AND indexdef LIKE '%order_line_hash%'
ORDER BY indexname;

-- Expected Result:
-- Only one index: sales_orders_unique_created_by_order_line_hash
-- indexdef should NOT contain "WHERE" clause

-- ============================================
-- TEST 2: Check for Existing Duplicates
-- ============================================

SELECT
  created_by,
  order_line_hash,
  COUNT(*) as duplicate_count,
  array_agg(id) as row_ids
FROM public.sales_orders
WHERE order_line_hash IS NOT NULL
GROUP BY created_by, order_line_hash
HAVING COUNT(*) > 1;

-- Expected: 0 rows (no duplicates)
-- If duplicates exist: Run cleanup below

-- ============================================
-- TEST 3: Check NULL order_line_hash Distribution
-- ============================================

SELECT
  source,
  COUNT(*) as total_rows,
  COUNT(order_line_hash) as rows_with_hash,
  COUNT(*) - COUNT(order_line_hash) as rows_without_hash,
  ROUND(100.0 * (COUNT(*) - COUNT(order_line_hash)) / NULLIF(COUNT(*), 0), 2) as null_percent
FROM public.sales_orders
GROUP BY source
ORDER BY source;

-- Expected:
-- - source='imported': 0% null (all imported rows have hash)
-- - source='manual': can have NULL (manual entries don't need deduplication)

-- ============================================
-- TEST 4: Verify Constraint Exists
-- ============================================

SELECT
  conname as constraint_name,
  contype as constraint_type,
  pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.sales_orders'::regclass
  AND conname LIKE '%order_line_hash%';

-- Expected: May be empty (index-based uniqueness, not constraint)

-- ============================================
-- CLEANUP SCRIPT (if duplicates found in TEST 2)
-- ============================================

-- If TEST 2 returns duplicates, run this:
-- Keep the most recent row (latest created_at), delete older duplicates

-- Step 1: Identify duplicates
-- CREATE TEMP TABLE duplicates_to_delete AS
-- SELECT DISTINCT ON (created_by, order_line_hash) id
-- FROM (
--   SELECT
--     id,
--     created_by,
--     order_line_hash,
--     created_at,
--     ROW_NUMBER() OVER (
--       PARTITION BY created_by, order_line_hash
--       ORDER BY created_at DESC
--     ) as rn
--   FROM public.sales_orders
--   WHERE order_line_hash IS NOT NULL
-- ) ranked
-- WHERE rn > 1;
--
-- Step 2: Review before deletion
-- SELECT * FROM duplicates_to_delete;
--
-- Step 3: Delete duplicates
-- DELETE FROM public.sales_orders WHERE id IN (SELECT id FROM duplicates_to_delete);
--
-- Step 4: Verify no duplicates remain
-- SELECT COUNT(*) FROM duplicates_to_delete;
-- Expected: 0 (temp table will show 0 after deletion)

-- ============================================
-- END OF VERIFICATION
-- ============================================
