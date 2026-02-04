-- ============================================
-- Verification Script: Sales Aggregates RPC Functions
-- Purpose: Test and verify migration-048 functions
-- Date: 2026-02-04
-- ============================================

-- ============================================
-- STEP 1: Verify Functions Exist
-- ============================================

\echo '=========================================='
\echo 'STEP 1: Verify Functions Exist'
\echo '=========================================='

SELECT
    routine_name,
    routine_type,
    data_type AS return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE 'get_sales_%'
ORDER BY routine_name;

-- Expected: 3 functions
-- - get_sales_aggregates
-- - get_sales_aggregates_tiktok_like
-- - get_sales_story_aggregates

-- ============================================
-- STEP 2: Verify Function Parameters
-- ============================================

\echo ''
\echo '=========================================='
\echo 'STEP 2: Verify Function Parameters'
\echo '=========================================='

SELECT
    routine_name,
    parameter_name,
    data_type,
    parameter_mode
FROM information_schema.parameters
WHERE specific_schema = 'public'
  AND specific_name IN (
    SELECT specific_name
    FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name = 'get_sales_aggregates'
  )
ORDER BY ordinal_position;

-- Expected parameters for get_sales_aggregates:
-- p_user_id, p_start_date, p_end_date, p_date_basis,
-- p_source_platform, p_status, p_payment_status

-- ============================================
-- STEP 3: Verify Indexes Created
-- ============================================

\echo ''
\echo '=========================================='
\echo 'STEP 3: Verify Indexes Created'
\echo '=========================================='

SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'sales_orders'
  AND indexname LIKE 'idx_sales_orders_%user%'
ORDER BY indexname;

-- Expected indexes:
-- - idx_sales_orders_created_time_user
-- - idx_sales_orders_paid_time_user
-- - idx_sales_orders_created_at_user
-- - idx_sales_orders_cancelled_time_user
-- - idx_sales_orders_user_platform_dates

-- ============================================
-- STEP 4: Test get_sales_aggregates (Order Basis)
-- ============================================

\echo ''
\echo '=========================================='
\echo 'STEP 4: Test get_sales_aggregates (Order Basis)'
\echo '=========================================='

-- Replace with actual user_id from your database
-- Get first user with sales data
WITH test_user AS (
    SELECT DISTINCT created_by AS user_id
    FROM public.sales_orders
    WHERE created_by IS NOT NULL
    LIMIT 1
)
SELECT * FROM public.get_sales_aggregates(
    (SELECT user_id FROM test_user),
    '2026-01-01'::DATE,
    '2026-02-04'::DATE,
    'order',      -- date basis
    NULL,         -- all platforms
    NULL,         -- all statuses
    NULL          -- all payment statuses
);

-- Expected: Returns aggregated metrics
-- Verify: revenue_gross >= revenue_net
-- Verify: orders_gross >= orders_net
-- Verify: cancel_rate_revenue_pct between 0-100

-- ============================================
-- STEP 5: Test get_sales_aggregates (Paid Basis)
-- ============================================

\echo ''
\echo '=========================================='
\echo 'STEP 5: Test get_sales_aggregates (Paid Basis)'
\echo '=========================================='

WITH test_user AS (
    SELECT DISTINCT created_by AS user_id
    FROM public.sales_orders
    WHERE created_by IS NOT NULL
    LIMIT 1
)
SELECT * FROM public.get_sales_aggregates(
    (SELECT user_id FROM test_user),
    '2026-01-01'::DATE,
    '2026-02-04'::DATE,
    'paid',       -- date basis
    NULL,
    NULL,
    'paid'        -- only paid orders
);

-- Expected: Returns aggregated metrics for paid orders only
-- Verify: Results should differ from order basis (fewer orders)

-- ============================================
-- STEP 6: Test Platform Filter
-- ============================================

\echo ''
\echo '=========================================='
\echo 'STEP 6: Test Platform Filter'
\echo '=========================================='

WITH test_user AS (
    SELECT DISTINCT created_by AS user_id
    FROM public.sales_orders
    WHERE created_by IS NOT NULL
    LIMIT 1
)
SELECT * FROM public.get_sales_aggregates(
    (SELECT user_id FROM test_user),
    '2026-01-01'::DATE,
    '2026-02-04'::DATE,
    'order',
    'tiktok_shop', -- TikTok only
    NULL,
    NULL
);

-- Expected: Returns aggregated metrics for TikTok orders only
-- Verify: orders_distinct should be <= total from Step 4

-- ============================================
-- STEP 7: Test Status Filter
-- ============================================

\echo ''
\echo '=========================================='
\echo 'STEP 7: Test Status Filter'
\echo '=========================================='

WITH test_user AS (
    SELECT DISTINCT created_by AS user_id
    FROM public.sales_orders
    WHERE created_by IS NOT NULL
    LIMIT 1
)
SELECT * FROM public.get_sales_aggregates(
    (SELECT user_id FROM test_user),
    '2026-01-01'::DATE,
    '2026-02-04'::DATE,
    'order',
    NULL,
    ARRAY['ชำระเงินแล้ว', 'ที่จัดส่ง'], -- Specific statuses
    NULL
);

-- Expected: Returns aggregated metrics for specific statuses only
-- Verify: orders_distinct should be <= total from Step 4

-- ============================================
-- STEP 8: Test Empty Result Set
-- ============================================

\echo ''
\echo '=========================================='
\echo 'STEP 8: Test Empty Result Set'
\echo '=========================================='

WITH test_user AS (
    SELECT DISTINCT created_by AS user_id
    FROM public.sales_orders
    WHERE created_by IS NOT NULL
    LIMIT 1
)
SELECT * FROM public.get_sales_aggregates(
    (SELECT user_id FROM test_user),
    '1970-01-01'::DATE,  -- Ancient date, no data
    '1970-01-02'::DATE,
    'order',
    NULL,
    NULL,
    NULL
);

-- Expected: All metrics should be 0
-- Verify: revenue_gross = 0, orders_gross = 0, etc.

-- ============================================
-- STEP 9: Test get_sales_aggregates_tiktok_like
-- ============================================

\echo ''
\echo '=========================================='
\echo 'STEP 9: Test get_sales_aggregates_tiktok_like'
\echo '=========================================='

WITH test_user AS (
    SELECT DISTINCT created_by AS user_id
    FROM public.sales_orders
    WHERE created_by IS NOT NULL
    LIMIT 1
)
SELECT * FROM public.get_sales_aggregates_tiktok_like(
    (SELECT user_id FROM test_user),
    '2026-01-01'::DATE,
    '2026-02-04'::DATE,
    NULL,         -- all platforms
    NULL,         -- all statuses
    NULL          -- all payment statuses
);

-- Expected: Returns TikTok-style aggregates
-- Verify: total_created_orders >= cancelled_created_orders
-- Verify: cancel_rate between 0-100

-- ============================================
-- STEP 10: Test get_sales_story_aggregates
-- ============================================

\echo ''
\echo '=========================================='
\echo 'STEP 10: Test get_sales_story_aggregates'
\echo '=========================================='

WITH test_user AS (
    SELECT DISTINCT created_by AS user_id
    FROM public.sales_orders
    WHERE created_by IS NOT NULL
    LIMIT 1
)
SELECT * FROM public.get_sales_story_aggregates(
    (SELECT user_id FROM test_user),
    '2026-01-01'::DATE,
    '2026-02-04'::DATE,
    NULL,         -- all platforms
    NULL,         -- all statuses
    NULL          -- all payment statuses
);

-- Expected: Returns Story aggregates
-- Verify: gross_revenue_created >= net_revenue_after_same_day_cancel
-- Verify: total_created_orders >= net_orders_after_same_day_cancel
-- Verify: has_cancelled_at = FALSE (fallback mode)

-- ============================================
-- STEP 11: Compare with Client-Side Calculation
-- ============================================

\echo ''
\echo '=========================================='
\echo 'STEP 11: Compare with Client-Side Calculation'
\echo '=========================================='

-- Manual calculation for comparison
WITH test_user AS (
    SELECT DISTINCT created_by AS user_id
    FROM public.sales_orders
    WHERE created_by IS NOT NULL
    LIMIT 1
),
filtered_lines AS (
    SELECT
        COALESCE(external_order_id, order_id) AS order_key,
        total_amount,
        quantity,
        COALESCE(created_time, order_date) AS effective_created_time,
        cancelled_time
    FROM public.sales_orders
    WHERE created_by = (SELECT user_id FROM test_user)
        AND (COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok')::DATE >= '2026-01-01'
        AND (COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok')::DATE <= '2026-02-04'
),
order_aggregates AS (
    SELECT
        order_key,
        MAX(total_amount) AS order_amount,
        SUM(quantity) AS total_units,
        CASE
            WHEN MAX(cancelled_time) IS NOT NULL AND MAX(effective_created_time) IS NOT NULL
                AND (MAX(cancelled_time) AT TIME ZONE 'Asia/Bangkok')::DATE = (MAX(effective_created_time) AT TIME ZONE 'Asia/Bangkok')::DATE
            THEN TRUE
            ELSE FALSE
        END AS is_cancelled_same_day
    FROM filtered_lines
    GROUP BY order_key
)
SELECT
    'Manual Calculation' AS source,
    ROUND(SUM(order_amount), 2) AS revenue_gross,
    ROUND(SUM(CASE WHEN NOT is_cancelled_same_day THEN order_amount ELSE 0 END), 2) AS revenue_net,
    COUNT(*) AS orders_gross,
    SUM(CASE WHEN NOT is_cancelled_same_day THEN 1 ELSE 0 END) AS orders_net,
    SUM(CASE WHEN is_cancelled_same_day THEN 1 ELSE 0 END) AS cancelled_same_day_orders
FROM order_aggregates

UNION ALL

SELECT
    'RPC Function' AS source,
    revenue_gross,
    revenue_net,
    orders_gross,
    orders_net,
    cancelled_same_day_orders
FROM public.get_sales_aggregates(
    (SELECT user_id FROM test_user),
    '2026-01-01'::DATE,
    '2026-02-04'::DATE,
    'order',
    NULL,
    NULL,
    NULL
);

-- Expected: Both rows should have identical values
-- This confirms the RPC function matches the manual calculation

-- ============================================
-- STEP 12: Performance Comparison
-- ============================================

\echo ''
\echo '=========================================='
\echo 'STEP 12: Performance Comparison'
\echo '=========================================='

\timing on

-- Test RPC function performance
WITH test_user AS (
    SELECT DISTINCT created_by AS user_id
    FROM public.sales_orders
    WHERE created_by IS NOT NULL
    LIMIT 1
)
SELECT 'RPC Function Timing' AS test;

WITH test_user AS (
    SELECT DISTINCT created_by AS user_id
    FROM public.sales_orders
    WHERE created_by IS NOT NULL
    LIMIT 1
)
SELECT * FROM public.get_sales_aggregates(
    (SELECT user_id FROM test_user),
    '2026-01-01'::DATE,
    '2026-02-04'::DATE,
    'order',
    NULL,
    NULL,
    NULL
);

\timing off

-- Expected: Query should complete in < 500ms for typical datasets
-- Compare with client-side fetching (which would take 5-10 seconds for 10k orders)

-- ============================================
-- STEP 13: Verify Grants
-- ============================================

\echo ''
\echo '=========================================='
\echo 'STEP 13: Verify Grants'
\echo '=========================================='

SELECT
    routine_name,
    grantee,
    privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name LIKE 'get_sales_%'
  AND grantee = 'authenticated'
ORDER BY routine_name;

-- Expected: EXECUTE privilege for all 3 functions to 'authenticated' role

-- ============================================
-- STEP 14: Summary
-- ============================================

\echo ''
\echo '=========================================='
\echo 'VERIFICATION SUMMARY'
\echo '=========================================='
\echo 'If all tests passed:'
\echo '  ✓ Functions created successfully'
\echo '  ✓ Indexes created for performance'
\echo '  ✓ RPC results match manual calculation'
\echo '  ✓ Performance improvement verified'
\echo '  ✓ Grants configured correctly'
\echo ''
\echo 'Next steps:'
\echo '  1. Update frontend/src/app/(dashboard)/sales/actions.ts'
\echo '  2. Test client-side integration'
\echo '  3. Deploy to production'
\echo '=========================================='
