-- ============================================
-- Verification Queries for Migration 044
-- Purpose: Quick validation after running migration-044-order-financials.sql
-- ============================================

-- INSTRUCTIONS:
-- 1. Replace 'YOUR_USER_ID' with your actual UUID (get from auth.users table)
-- 2. Replace date ranges as needed
-- 3. Run each query and check expected results (marked as -- Expected: ...)

-- ============================================
-- QUERY 1: Table Exists & Backfill Check
-- ============================================

SELECT
  'order_financials' as table_name,
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE order_amount IS NOT NULL) as with_order_amount,
  COUNT(*) FILTER (WHERE shipped_at IS NOT NULL) as with_shipped_at,
  COUNT(*) FILTER (WHERE metadata->>'backfilled_from' = 'sales_orders') as backfilled_count,
  MIN(created_at) as earliest_record,
  MAX(created_at) as latest_record
FROM order_financials;

-- Expected:
-- total_rows > 0 (backfill ran successfully)
-- with_order_amount > 0 (some orders have order_amount)
-- with_shipped_at > 0 (some orders have shipped_at)
-- backfilled_count > 0 (backfill marked correctly)


-- ============================================
-- QUERY 2: Verify Unique Constraint
-- ============================================

SELECT
  created_by,
  order_id,
  COUNT(*) as duplicate_count
FROM order_financials
GROUP BY created_by, order_id
HAVING COUNT(*) > 1;

-- Expected: 0 rows (no duplicates)


-- ============================================
-- QUERY 3: Compare with sales_orders
-- ============================================

WITH so_stats AS (
  SELECT
    COUNT(DISTINCT order_id) as so_unique_orders,
    COUNT(*) as so_total_lines,
    COUNT(DISTINCT order_id) FILTER (WHERE shipped_at IS NOT NULL) as so_shipped_orders
  FROM sales_orders
),
of_stats AS (
  SELECT
    COUNT(*) as of_total_orders,
    COUNT(*) FILTER (WHERE shipped_at IS NOT NULL) as of_shipped_orders
  FROM order_financials
)
SELECT
  so_unique_orders,
  of_total_orders,
  so_unique_orders - of_total_orders as diff_total,
  so_shipped_orders,
  of_shipped_orders,
  so_shipped_orders - of_shipped_orders as diff_shipped,
  so_total_lines,
  CASE
    WHEN ABS(so_unique_orders - of_total_orders) < 10 THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as test_result
FROM so_stats, of_stats;

-- Expected:
-- diff_total close to 0 (most orders migrated)
-- diff_shipped close to 0 (all shipped orders migrated)
-- test_result = ✓ PASS


-- ============================================
-- QUERY 4: View Integration Test
-- ============================================
-- Replace 'YOUR_USER_ID' with actual UUID

WITH view_agg AS (
  SELECT
    COUNT(*) as view_orders,
    SUM(order_amount) as view_gmv
  FROM sales_orders_order_rollup
  WHERE created_by = 'YOUR_USER_ID'
),
direct_of AS (
  SELECT
    COUNT(*) as of_orders,
    SUM(order_amount) as of_gmv
  FROM order_financials
  WHERE created_by = 'YOUR_USER_ID'
    AND shipped_at IS NOT NULL
),
direct_so AS (
  SELECT
    COUNT(DISTINCT order_id) as so_orders,
    SUM(order_gmv) as so_gmv
  FROM (
    SELECT
      order_id,
      COALESCE(MAX(order_amount), MAX(total_amount)) as order_gmv
    FROM sales_orders
    WHERE created_by = 'YOUR_USER_ID'
      AND shipped_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM order_financials of
        WHERE of.created_by = sales_orders.created_by
          AND of.order_id = sales_orders.order_id
      )
    GROUP BY order_id
  ) t
)
SELECT
  view_orders,
  of_orders + so_orders as expected_orders,
  view_orders - (of_orders + so_orders) as diff_orders,
  view_gmv,
  COALESCE(of_gmv, 0) + COALESCE(so_gmv, 0) as expected_gmv,
  view_gmv - (COALESCE(of_gmv, 0) + COALESCE(so_gmv, 0)) as diff_gmv,
  CASE
    WHEN ABS(view_gmv - (COALESCE(of_gmv, 0) + COALESCE(so_gmv, 0))) < 1.0 THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as test_result
FROM view_agg, direct_of, direct_so;

-- Expected:
-- diff_orders = 0 (view matches direct aggregation)
-- diff_gmv close to 0 (within rounding error)
-- test_result = ✓ PASS


-- ============================================
-- QUERY 5: Sample Data Check
-- ============================================
-- Replace 'YOUR_USER_ID' with actual UUID

SELECT
  order_id,
  source_platform,
  order_amount,
  shipped_at,
  platform_status,
  metadata->>'amount_source' as amount_source,
  import_batch_id IS NOT NULL as has_batch_id
FROM order_financials
WHERE created_by = 'YOUR_USER_ID'
  AND shipped_at IS NOT NULL
ORDER BY shipped_at DESC
LIMIT 10;

-- Expected:
-- 10 rows returned (sample of recent shipped orders)
-- order_amount IS NOT NULL (or marked as fallback)
-- shipped_at IS NOT NULL
-- amount_source shows 'order_amount' (best) or 'total_amount_fallback' (backfill)


-- ============================================
-- QUERY 6: RLS Policy Check
-- ============================================
-- Run as regular user (not admin)

-- Set role to test user (replace with actual user ID)
-- SET ROLE authenticated;
-- SET request.jwt.claim.sub = 'YOUR_USER_ID';

SELECT COUNT(*) as visible_orders
FROM order_financials;

-- Expected: visible_orders > 0 (RLS allows user to see own data)

-- Test insert (should succeed for own user)
-- INSERT INTO order_financials (created_by, order_id, source_platform, order_amount)
-- VALUES (auth.uid(), 'TEST_ORDER_001', 'test_platform', 100.00);

-- Test delete (should succeed for own data)
-- DELETE FROM order_financials WHERE order_id = 'TEST_ORDER_001';


-- ============================================
-- QUERY 7: Index Performance Check
-- ============================================

EXPLAIN ANALYZE
SELECT COUNT(*)
FROM order_financials
WHERE shipped_at IS NOT NULL
  AND source_platform = 'tiktok_shop';

-- Expected:
-- Query plan uses idx_order_financials_source_platform_shipped_at (index scan)
-- Execution time < 50ms (fast)


-- ============================================
-- SUMMARY CHECK
-- ============================================

SELECT
  'Migration 044 Verification' as check_name,
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'order_financials') THEN '✓'
    ELSE '✗'
  END as table_exists,
  CASE
    WHEN (SELECT COUNT(*) FROM order_financials) > 0 THEN '✓'
    ELSE '✗'
  END as has_data,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'order_financials'
        AND indexname = 'idx_order_financials_shipped_at'
    ) THEN '✓'
    ELSE '✗'
  END as indexes_created,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'order_financials'
        AND policyname = 'order_financials_select_policy'
    ) THEN '✓'
    ELSE '✗'
  END as rls_enabled,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'update_order_financials_updated_at'
    ) THEN '✓'
    ELSE '✗'
  END as trigger_created;

-- Expected: All columns show ✓


-- ============================================
-- END OF VERIFICATION
-- ============================================

-- If all queries pass:
-- ✅ Migration 044 successfully deployed
-- ✅ order_financials table operational
-- ✅ Data backfilled correctly
-- ✅ View integration working
-- ✅ RLS policies active
-- ✅ Ready for production use

-- Next steps:
-- 1. Re-import latest TikTok OrderSKUList file
-- 2. Run QA queries from docs/QA_GMV_RECONCILIATION.md
-- 3. Rebuild profit summaries: SELECT rebuild_profit_summaries(user_id, start_date, end_date);
