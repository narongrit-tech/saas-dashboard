-- ============================================
-- CASHFLOW TIMEZONE FIX VERIFICATION
-- ============================================
-- Purpose: Verify timezone bucketing and estimated_settle_time fixes
-- Run after: migration-010-cashflow-performance.sql + re-import data
-- Date: 2026-01-25

-- ============================================
-- STEP 1: RE-RUN MIGRATION (if needed)
-- ============================================
-- Run migration-010-cashflow-performance.sql first if not applied yet

-- ============================================
-- STEP 2: VERIFY INDEXES CREATED
-- ============================================
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename IN ('settlement_transactions', 'unsettled_transactions', 'cashflow_daily_summary')
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- Expected indexes:
-- - idx_settlement_transactions_user_date
-- - idx_settlement_transactions_user_marketplace_date
-- - idx_settlement_transactions_user_marketplace_time (NEW)
-- - idx_unsettled_transactions_user_date
-- - idx_unsettled_transactions_user_marketplace_date
-- - idx_unsettled_transactions_user_marketplace_time (NEW)
-- - idx_unsettled_transactions_status
-- - idx_cashflow_daily_summary_user_date

-- ============================================
-- STEP 3: RE-IMPORT DATA (MANUAL STEP)
-- ============================================
-- 1. Go to /finance/marketplace-wallets page
-- 2. Import Onhold file (with "Delivered + N days")
-- 3. Import Income file
-- 4. Check console logs for:
--    [Onhold Parser] estimated_settle_time NULL count: 0 (0.0%)
--    [Onhold Parser] First 3 estimated_settle_time: [dates...]

-- ============================================
-- STEP 4: REBUILD SUMMARY WITH TIMEZONE FIX
-- ============================================
-- Get your user ID first
SELECT id, email FROM auth.users;

-- Run rebuild (replace YOUR_USER_UUID with actual UUID)
SELECT rebuild_cashflow_daily_summary(
  'YOUR_USER_UUID',
  '2026-01-01'::date,
  '2026-01-31'::date
);

-- Expected output:
-- NOTICE: [Cashflow] Summary rebuilt: start=2026-01-01, end=2026-01-31, rows=25
-- rebuild_cashflow_daily_summary
-- -------------------------------
--                            25

-- ============================================
-- STEP 5: VERIFY NO NULL estimated_settle_time
-- ============================================
SELECT
  COUNT(*) as total_rows,
  COUNT(CASE WHEN estimated_settle_time IS NULL THEN 1 END) as null_count,
  ROUND(
    100.0 * COUNT(CASE WHEN estimated_settle_time IS NULL THEN 1 END) / NULLIF(COUNT(*), 0),
    2
  ) as null_percentage
FROM unsettled_transactions
WHERE marketplace = 'tiktok';

-- Expected:
-- total_rows | null_count | null_percentage
-- -----------|------------|----------------
--       253  |          0 |           0.00
-- ✅ null_count MUST be 0

-- ============================================
-- STEP 6: VERIFY TIMEZONE BUCKETING (CRITICAL)
-- ============================================
-- Check raw settlement_transactions for UTC 17:00
SELECT
  txn_id,
  settled_time AS utc_time,
  settled_time AT TIME ZONE 'Asia/Bangkok' AS bangkok_time,
  (settled_time AT TIME ZONE 'Asia/Bangkok')::date AS thai_date,
  settlement_amount
FROM settlement_transactions
WHERE settled_time >= '2026-01-24 17:00:00+00'
  AND settled_time < '2026-01-25 17:00:00+00'
ORDER BY settled_time
LIMIT 10;

-- Expected:
-- utc_time: 2026-01-24 17:00:00+00 → bangkok_time: 2026-01-25 00:00:00 → thai_date: 2026-01-25
-- ✅ Thai date should be 2026-01-25 (NOT 2026-01-24)

-- ============================================
-- STEP 7: VERIFY DAILY SUMMARY HAS CORRECT DATES
-- ============================================
-- Check daily summary for 2026-01-25
SELECT
  date,
  forecast_sum,
  forecast_count,
  actual_sum,
  actual_count,
  gap_sum
FROM cashflow_daily_summary
WHERE date >= '2026-01-24'
  AND date <= '2026-01-26'
ORDER BY date;

-- Expected:
-- date       | forecast_sum | forecast_count | actual_sum | actual_count | gap_sum
-- -----------|--------------|----------------|------------|--------------|--------
-- 2026-01-24 |      XXXX.XX |             XX |    XXXX.XX |           XX | ±XXX.XX
-- 2026-01-25 |      XXXX.XX |             XX |    XXXX.XX |           XX | ±XXX.XX  ← MUST have actual_sum > 0
-- 2026-01-26 |      XXXX.XX |             XX |    XXXX.XX |           XX | ±XXX.XX

-- ✅ 2026-01-25 MUST show actual_sum and actual_count > 0
-- (because settled_time 17:00+00 on 2026-01-24 = Thai date 2026-01-25)

-- ============================================
-- STEP 8: COMPARE BEFORE/AFTER BUCKET COUNTS
-- ============================================
-- Show bucketing with OLD method (wrong)
SELECT
  DATE(settled_time) AS old_method_date,
  COUNT(*) AS row_count,
  SUM(settlement_amount) AS total_amount
FROM settlement_transactions
WHERE settled_time >= '2026-01-24 00:00:00+00'
  AND settled_time < '2026-01-27 00:00:00+00'
GROUP BY DATE(settled_time)
ORDER BY old_method_date;

-- Show bucketing with NEW method (correct)
SELECT
  (settled_time AT TIME ZONE 'Asia/Bangkok')::date AS new_method_date,
  COUNT(*) AS row_count,
  SUM(settlement_amount) AS total_amount
FROM settlement_transactions
WHERE settled_time >= '2026-01-24 00:00:00+00'
  AND settled_time < '2026-01-27 00:00:00+00'
GROUP BY (settled_time AT TIME ZONE 'Asia/Bangkok')::date
ORDER BY new_method_date;

-- Expected:
-- OLD method shows more rows on 2026-01-24
-- NEW method shows more rows on 2026-01-25
-- ✅ NEW method matches user expectation (Thai business day)

-- ============================================
-- STEP 9: VERIFY PERFORMANCE (OPTIONAL)
-- ============================================
-- Check if indexes are being used
EXPLAIN ANALYZE
SELECT
  (settled_time AT TIME ZONE 'Asia/Bangkok')::date AS thai_date,
  SUM(settlement_amount) AS total_amount,
  COUNT(*) AS row_count
FROM settlement_transactions
WHERE created_by = 'YOUR_USER_UUID'
  AND marketplace = 'tiktok'
  AND settled_time >= '2026-01-01 00:00:00+00'
  AND settled_time < '2026-02-01 00:00:00+00'
GROUP BY (settled_time AT TIME ZONE 'Asia/Bangkok')::date;

-- Expected:
-- → Index Scan using idx_settlement_transactions_user_marketplace_time
-- ✅ Should use composite index (not seq scan)

-- ============================================
-- ACCEPTANCE CRITERIA (ALL MUST PASS)
-- ============================================
-- ✅ NULL estimated_settle_time count = 0
-- ✅ settled_time 17:00+00 → Thai date 2026-01-25 (not 2026-01-24)
-- ✅ Daily summary 2026-01-25 has actual_sum > 0
-- ✅ Indexes created and being used
-- ✅ Rebuild function logs NOTICE message
-- ✅ Frontend /finance/marketplace-wallets page shows correct daily buckets

-- ============================================
-- TROUBLESHOOTING
-- ============================================
-- If null_count > 0:
-- → Re-import Onhold file (parser should handle "Delivered + N days" now)

-- If Thai date still wrong:
-- → Check if migration-010 applied correctly
-- → Run: DROP FUNCTION rebuild_cashflow_daily_summary(UUID, DATE, DATE);
-- → Re-run migration-010-cashflow-performance.sql

-- If daily summary empty:
-- → Run rebuild function (STEP 4)
-- → Check user UUID matches auth.uid()
