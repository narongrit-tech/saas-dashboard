-- ============================================
-- Verification Script: Import Rollback RLS Policies
-- Purpose: Verify all RLS policies exist for rollback functions
-- Created: 2026-01-26
-- ============================================

-- ============================================
-- 1. Check RPC Functions Exist
-- ============================================

SELECT
  routine_name,
  routine_type,
  security_type,
  routine_definition IS NOT NULL AS has_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('rollback_import_batch', 'cleanup_stuck_batches')
ORDER BY routine_name;

-- Expected output:
-- rollback_import_batch | FUNCTION | DEFINER | true
-- cleanup_stuck_batches | FUNCTION | DEFINER | true

-- ============================================
-- 2. Check RLS Policies for import_batches
-- ============================================

SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  qual IS NOT NULL AS has_using_clause,
  with_check IS NOT NULL AS has_check_clause
FROM pg_policies
WHERE tablename = 'import_batches'
ORDER BY cmd, policyname;

-- Expected output (4 policies):
-- import_batches_select_policy | SELECT | true  | false
-- import_batches_insert_policy | INSERT | false | true
-- import_batches_update_policy | UPDATE | true  | true
-- import_batches_delete_policy | DELETE | true  | false

-- ============================================
-- 3. Check RLS Policies for wallet_ledger
-- ============================================

SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  qual IS NOT NULL AS has_using_clause,
  with_check IS NOT NULL AS has_check_clause
FROM pg_policies
WHERE tablename = 'wallet_ledger'
ORDER BY cmd, policyname;

-- Expected output (4 policies):
-- wallet_ledger_select_policy | SELECT | true  | false
-- wallet_ledger_insert_policy | INSERT | false | true
-- wallet_ledger_update_policy | UPDATE | true  | true
-- wallet_ledger_delete_policy | DELETE | true  | false

-- ============================================
-- 4. Check RLS Policies for ad_daily_performance
-- ============================================

SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  qual IS NOT NULL AS has_using_clause,
  with_check IS NOT NULL AS has_check_clause
FROM pg_policies
WHERE tablename = 'ad_daily_performance'
ORDER BY cmd, policyname;

-- Expected output (4 policies):
-- ad_daily_perf_select_policy | SELECT | true  | false
-- ad_daily_perf_insert_policy | INSERT | false | true
-- ad_daily_perf_update_policy | UPDATE | true  | true
-- ad_daily_perf_delete_policy | DELETE | true  | false

-- ============================================
-- 5. Check RLS is ENABLED on all tables
-- ============================================

SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE tablename IN ('import_batches', 'wallet_ledger', 'ad_daily_performance')
ORDER BY tablename;

-- Expected output (all should be true):
-- import_batches        | true
-- wallet_ledger         | true
-- ad_daily_performance  | true

-- ============================================
-- 6. Check Indexes for Performance
-- ============================================

-- Indexes used by rollback_import_batch:
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE indexname IN (
  'idx_wallet_ledger_import_batch',
  'idx_import_batches_status',
  'idx_import_batches_created_by_date'
)
ORDER BY tablename, indexname;

-- Expected output:
-- wallet_ledger   | idx_wallet_ledger_import_batch       | CREATE INDEX ... (import_batch_id) WHERE ...
-- import_batches  | idx_import_batches_status            | CREATE INDEX ... (status)
-- import_batches  | idx_import_batches_created_by_date   | CREATE INDEX ... (created_by, created_at DESC)

-- ============================================
-- 7. Test Function Permissions
-- ============================================

-- Check who can execute the functions:
SELECT
  routine_schema,
  routine_name,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_name IN ('rollback_import_batch', 'cleanup_stuck_batches')
ORDER BY routine_name, grantee;

-- Expected: 'authenticated' role should have EXECUTE privilege

-- ============================================
-- 8. Summary: All Checks Passed
-- ============================================

-- Run this query to verify all critical components:
SELECT
  'Functions Exist' AS check_name,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) = 2 THEN '✅ PASS' ELSE '❌ FAIL' END AS status
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('rollback_import_batch', 'cleanup_stuck_batches')

UNION ALL

SELECT
  'import_batches RLS Policies' AS check_name,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) = 4 THEN '✅ PASS' ELSE '❌ FAIL' END AS status
FROM pg_policies
WHERE tablename = 'import_batches'

UNION ALL

SELECT
  'wallet_ledger RLS Policies' AS check_name,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) = 4 THEN '✅ PASS' ELSE '❌ FAIL' END AS status
FROM pg_policies
WHERE tablename = 'wallet_ledger'

UNION ALL

SELECT
  'ad_daily_performance RLS Policies' AS check_name,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) = 4 THEN '✅ PASS' ELSE '❌ FAIL' END AS status
FROM pg_policies
WHERE tablename = 'ad_daily_performance'

UNION ALL

SELECT
  'RLS Enabled on All Tables' AS check_name,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) = 3 THEN '✅ PASS' ELSE '❌ FAIL' END AS status
FROM pg_tables
WHERE tablename IN ('import_batches', 'wallet_ledger', 'ad_daily_performance')
  AND rowsecurity = true

UNION ALL

SELECT
  'Performance Indexes Exist' AS check_name,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) = 3 THEN '✅ PASS' ELSE '❌ FAIL' END AS status
FROM pg_indexes
WHERE indexname IN (
  'idx_wallet_ledger_import_batch',
  'idx_import_batches_status',
  'idx_import_batches_created_by_date'
);

-- Expected output: All checks should show '✅ PASS'

-- ============================================
-- END OF VERIFICATION SCRIPT
-- ============================================
