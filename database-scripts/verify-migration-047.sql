-- ============================================
-- Verification Script: Migration 047
-- Purpose: Verify get_ads_summary RPC function
-- ============================================

\echo '================================================'
\echo 'Migration 047 Verification'
\echo '================================================'
\echo ''

-- ============================================
-- 1. Verify function exists
-- ============================================

\echo '1. Checking if get_ads_summary function exists...'
SELECT
    proname AS function_name,
    pg_get_function_identity_arguments(oid) AS arguments,
    prosecdef AS is_security_definer
FROM pg_proc
WHERE proname = 'get_ads_summary'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

\echo ''

-- ============================================
-- 2. Verify function permissions
-- ============================================

\echo '2. Checking function permissions...'
SELECT
    grantee,
    privilege_type
FROM information_schema.routine_privileges
WHERE routine_name = 'get_ads_summary'
    AND routine_schema = 'public';

\echo ''

-- ============================================
-- 3. Test function with sample data
-- ============================================

\echo '3. Testing function with current user (if data exists)...'
\echo 'Note: Replace user_id with actual UUID for testing'
\echo ''

-- Get a sample user_id
\echo 'Sample user_ids in ad_daily_performance:'
SELECT DISTINCT created_by
FROM public.ad_daily_performance
LIMIT 3;

\echo ''

-- Test with sample user (replace with actual user_id)
\echo 'Test query template (replace user_id):'
\echo 'SELECT * FROM public.get_ads_summary('
\echo '    ''00000000-0000-0000-0000-000000000000''::UUID,'
\echo '    ''2026-01-01''::DATE,'
\echo '    ''2026-02-04''::DATE,'
\echo '    NULL'
\echo ');'

\echo ''

-- ============================================
-- 4. Compare RPC vs manual aggregate
-- ============================================

\echo '4. Comparing RPC function vs manual aggregate...'
\echo 'Note: Run this test with a real user_id'
\echo ''

-- Manual aggregate (template)
\echo 'Manual aggregate query template:'
\echo 'SELECT'
\echo '    COALESCE(SUM(spend), 0) AS manual_total_spend,'
\echo '    COALESCE(SUM(revenue), 0) AS manual_total_revenue,'
\echo '    COALESCE(SUM(orders), 0) AS manual_total_orders'
\echo 'FROM public.ad_daily_performance'
\echo 'WHERE created_by = ''00000000-0000-0000-0000-000000000000''::UUID'
\echo '    AND ad_date >= ''2026-01-01''::DATE'
\echo '    AND ad_date <= ''2026-02-04''::DATE;'

\echo ''

-- ============================================
-- 5. Test campaign type filter
-- ============================================

\echo '5. Test campaign type filter...'
\echo 'Query template (replace user_id):'
\echo ''
\echo 'All campaigns:'
\echo 'SELECT * FROM public.get_ads_summary(''USER_ID''::UUID, ''2026-01-01''::DATE, ''2026-02-04''::DATE, NULL);'
\echo ''
\echo 'Product campaigns only:'
\echo 'SELECT * FROM public.get_ads_summary(''USER_ID''::UUID, ''2026-01-01''::DATE, ''2026-02-04''::DATE, ''product'');'
\echo ''
\echo 'Live campaigns only:'
\echo 'SELECT * FROM public.get_ads_summary(''USER_ID''::UUID, ''2026-01-01''::DATE, ''2026-02-04''::DATE, ''live'');'

\echo ''

-- ============================================
-- 6. Performance test
-- ============================================

\echo '6. Performance test (requires actual user_id)...'
\echo 'Run with EXPLAIN ANALYZE to verify performance:'
\echo ''
\echo 'EXPLAIN ANALYZE'
\echo 'SELECT * FROM public.get_ads_summary('
\echo '    ''USER_ID''::UUID,'
\echo '    ''2026-01-01''::DATE,'
\echo '    ''2026-12-31''::DATE,'
\echo '    NULL'
\echo ');'

\echo ''
\echo '================================================'
\echo 'Verification Complete'
\echo '================================================'
\echo ''
\echo 'Next steps:'
\echo '1. Replace USER_ID placeholders with actual user UUIDs'
\echo '2. Run test queries to verify function behavior'
\echo '3. Compare RPC results with manual aggregates'
\echo '4. Test campaign type filters'
\echo '5. Run EXPLAIN ANALYZE for performance verification'
\echo ''
