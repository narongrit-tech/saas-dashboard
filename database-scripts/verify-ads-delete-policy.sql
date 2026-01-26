-- ============================================
-- Verify DELETE RLS policies for ads import
-- Purpose: Test that DELETE operations work for authenticated users
-- Date: 2026-01-26
-- ============================================

-- ============================================
-- 1. Check DELETE policies exist
-- ============================================
SELECT
  tablename,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ad_daily_performance', 'wallet_ledger', 'import_batches')
  AND cmd = 'DELETE'
ORDER BY tablename;

-- Expected: 3 rows (one DELETE policy per table)
-- ad_daily_performance | ad_daily_perf_delete_policy | DELETE | (created_by = auth.uid())
-- import_batches | import_batches_delete_policy | DELETE | (created_by = auth.uid())
-- wallet_ledger | wallet_ledger_delete_policy | DELETE | (created_by = auth.uid())

-- ============================================
-- 2. Test DELETE (DRY RUN - use SELECT to see what would be deleted)
-- ============================================

-- 2a. Find recent test batch_id
SELECT
  id as batch_id,
  report_type,
  row_count,
  file_name,
  created_at
FROM import_batches
WHERE created_by = auth.uid()
  AND report_type LIKE 'tiktok_ads%'
ORDER BY created_at DESC
LIMIT 5;

-- Copy a batch_id from above, then test visibility:

-- 2b. Test ad_daily_performance SELECT (should see rows)
-- Replace <test_batch_id> with actual UUID from step 2a
/*
SELECT
  id,
  ad_date,
  campaign_name,
  spend,
  import_batch_id
FROM ad_daily_performance
WHERE created_by = auth.uid()
  AND import_batch_id = '<test_batch_id>'
LIMIT 5;
*/

-- If rows returned, DELETE should work:
/*
DELETE FROM ad_daily_performance
WHERE created_by = auth.uid()
  AND import_batch_id = '<test_batch_id>'
RETURNING id;
*/

-- 2c. Test wallet_ledger SELECT (should see rows)
/*
SELECT
  id,
  date,
  amount,
  import_batch_id
FROM wallet_ledger
WHERE created_by = auth.uid()
  AND import_batch_id = '<test_batch_id>'
LIMIT 5;
*/

-- If rows returned, DELETE should work:
/*
DELETE FROM wallet_ledger
WHERE created_by = auth.uid()
  AND import_batch_id = '<test_batch_id>'
RETURNING id;
*/

-- 2d. Test import_batches SELECT (should see row)
/*
SELECT
  id,
  report_type,
  row_count,
  file_name
FROM import_batches
WHERE created_by = auth.uid()
  AND id = '<test_batch_id>';
*/

-- If row returned, DELETE should work:
/*
DELETE FROM import_batches
WHERE created_by = auth.uid()
  AND id = '<test_batch_id>'
RETURNING id;
*/

-- ============================================
-- 3. Safe Rollback Template by import_batch_id
-- ============================================

-- COPY THIS BLOCK and replace <batch_id> with actual UUID

-- Step 1: Verify what will be deleted (DRY RUN)
/*
SELECT 'ad_daily_performance' as table_name, COUNT(*) as row_count
FROM ad_daily_performance
WHERE import_batch_id = '<batch_id>' AND created_by = auth.uid()
UNION ALL
SELECT 'wallet_ledger', COUNT(*)
FROM wallet_ledger
WHERE import_batch_id = '<batch_id>' AND created_by = auth.uid()
UNION ALL
SELECT 'import_batches', COUNT(*)
FROM import_batches
WHERE id = '<batch_id>' AND created_by = auth.uid();
*/

-- Step 2: Execute rollback (3 DELETE statements)
-- ⚠️ CAUTION: This will permanently delete data!
/*
-- Delete wallet_ledger entries
DELETE FROM wallet_ledger
WHERE import_batch_id = '<batch_id>'
  AND created_by = auth.uid();

-- Delete ad_daily_performance rows
DELETE FROM ad_daily_performance
WHERE import_batch_id = '<batch_id>'
  AND created_by = auth.uid();

-- Delete import_batch
DELETE FROM import_batches
WHERE id = '<batch_id>'
  AND created_by = auth.uid();
*/

-- Step 3: Verify deletion (should return 0 rows)
/*
SELECT 'ad_daily_performance' as table_name, COUNT(*) as remaining_rows
FROM ad_daily_performance
WHERE import_batch_id = '<batch_id>'
UNION ALL
SELECT 'wallet_ledger', COUNT(*)
FROM wallet_ledger
WHERE import_batch_id = '<batch_id>'
UNION ALL
SELECT 'import_batches', COUNT(*)
FROM import_batches
WHERE id = '<batch_id>';
*/

-- Expected after rollback:
-- ad_daily_performance | 0
-- wallet_ledger | 0
-- import_batches | 0

-- ============================================
-- 4. Cleanup by ad_date (LESS SAFE - deletes all imports for date)
-- ============================================

-- ⚠️ Warning: This deletes ALL imports for the date, not just one batch
-- Only use if you want to clear ALL data for a specific date

/*
-- Step 1: Check what will be deleted
SELECT COUNT(*) as ads_count
FROM ad_daily_performance
WHERE ad_date = '2026-01-16'
  AND created_by = auth.uid();

SELECT COUNT(*) as wallet_count
FROM wallet_ledger
WHERE date = '2026-01-16'
  AND source = 'IMPORTED'
  AND created_by = auth.uid();

-- Step 2: Delete by date (if confirmed)
DELETE FROM ad_daily_performance
WHERE ad_date = '2026-01-16'
  AND created_by = auth.uid();

DELETE FROM wallet_ledger
WHERE date = '2026-01-16'
  AND source = 'IMPORTED'
  AND created_by = auth.uid();

-- Note: import_batches remain (they may reference multiple dates)
*/

-- ============================================
-- 5. Verify RLS enforcement (security check)
-- ============================================

-- This should return 0 rows (cannot see other users' data)
-- Replace <other_user_id> with a different UUID
/*
SELECT COUNT(*) as should_be_zero
FROM ad_daily_performance
WHERE created_by != auth.uid();
*/

-- This should fail with RLS error (cannot delete other users' data)
-- Replace <other_user_id> with a different UUID
/*
DELETE FROM ad_daily_performance
WHERE created_by != auth.uid()
LIMIT 1;
*/

-- Expected: 0 rows deleted (RLS blocks cross-user deletes)

-- ============================================
-- END OF VERIFICATION
-- ============================================
