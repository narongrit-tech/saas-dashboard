-- ============================================
-- CASHFLOW DEBUG QUERIES
-- ============================================
-- Purpose: Quick diagnostic queries for cashflow troubleshooting
-- Date: 2026-01-25

-- ============================================
-- HEALTH CHECKS
-- ============================================

-- 1. Check RLS status (MUST BE false after migration-011)
SELECT
  tablename,
  rowsecurity,
  CASE
    WHEN rowsecurity = false THEN '✅ Disabled (correct)'
    ELSE '❌ Enabled (will block service role imports)'
  END as status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('settlement_transactions', 'unsettled_transactions', 'cashflow_daily_summary');

-- 2. Check NULL estimated_settle_time (MUST BE 0)
SELECT
  COUNT(*) as total_rows,
  COUNT(CASE WHEN estimated_settle_time IS NULL THEN 1 END) as null_count,
  ROUND(
    100.0 * COUNT(CASE WHEN estimated_settle_time IS NULL THEN NULLIF(COUNT(*), 0),
    2
  ) as null_percentage,
  CASE
    WHEN COUNT(CASE WHEN estimated_settle_time IS NULL THEN 1 END) = 0 THEN '✅ All rows have dates'
    ELSE '❌ NULL dates found - run migration-011 backfill'
  END as status
FROM unsettled_transactions
WHERE marketplace = 'tiktok';

-- 3. Check indexes (performance)
SELECT
  tablename,
  indexname,
  CASE
    WHEN indexname LIKE '%marketplace%' THEN '✅ Marketplace index'
    WHEN indexname LIKE '%date%' THEN '✅ Date index'
    ELSE 'ℹ️  Other index'
  END as index_type
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('settlement_transactions', 'unsettled_transactions', 'cashflow_daily_summary')
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- ============================================
-- DATA COUNTS
-- ============================================

-- 4. Overall counts
SELECT
  (SELECT COUNT(*) FROM unsettled_transactions WHERE marketplace = 'tiktok') as forecast_count,
  (SELECT COUNT(*) FROM settlement_transactions WHERE marketplace = 'tiktok') as actual_count,
  (SELECT COUNT(*) FROM cashflow_daily_summary) as summary_rows,
  (SELECT COUNT(*) FROM import_batches WHERE marketplace = 'tiktok') as import_batches;

-- 5. Reconciliation status
SELECT
  status,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM unsettled_transactions
WHERE marketplace = 'tiktok'
GROUP BY status
ORDER BY count DESC;

-- Expected:
-- settled = matched with actual
-- unsettled = waiting for settlement

-- ============================================
-- DAILY SUMMARY VERIFICATION
-- ============================================

-- 6. Daily summary for current month
SELECT
  date,
  forecast_sum,
  forecast_count,
  actual_sum,
  actual_count,
  gap_sum,
  CASE
    WHEN forecast_count > 0 AND actual_count > 0 THEN '✅ Matched'
    WHEN forecast_count > 0 AND actual_count = 0 THEN '⚠️  Forecast only'
    WHEN forecast_count = 0 AND actual_count > 0 THEN 'ℹ️  Actual only'
    ELSE '❌ Empty'
  END as status
FROM cashflow_daily_summary
WHERE date >= DATE_TRUNC('month', CURRENT_DATE)
ORDER BY date;

-- 7. Summary vs raw data verification (spot check)
-- Compare summary table with raw aggregation
WITH raw_forecast AS (
  SELECT
    (estimated_settle_time AT TIME ZONE 'Asia/Bangkok')::date AS date,
    SUM(estimated_settlement_amount) AS forecast_sum,
    COUNT(*) AS forecast_count
  FROM unsettled_transactions
  WHERE marketplace = 'tiktok'
    AND estimated_settle_time >= DATE_TRUNC('month', CURRENT_DATE)
    AND status = 'unsettled'
  GROUP BY (estimated_settle_time AT TIME ZONE 'Asia/Bangkok')::date
),
raw_actual AS (
  SELECT
    (settled_time AT TIME ZONE 'Asia/Bangkok')::date AS date,
    SUM(settlement_amount) AS actual_sum,
    COUNT(*) AS actual_count
  FROM settlement_transactions
  WHERE marketplace = 'tiktok'
    AND settled_time >= DATE_TRUNC('month', CURRENT_DATE)
  GROUP BY (settled_time AT TIME ZONE 'Asia/Bangkok')::date
)
SELECT
  s.date,
  s.forecast_sum AS summary_forecast,
  COALESCE(rf.forecast_sum, 0) AS raw_forecast,
  s.forecast_sum - COALESCE(rf.forecast_sum, 0) AS forecast_diff,
  s.actual_sum AS summary_actual,
  COALESCE(ra.actual_sum, 0) AS raw_actual,
  s.actual_sum - COALESCE(ra.actual_sum, 0) AS actual_diff,
  CASE
    WHEN ABS(s.forecast_sum - COALESCE(rf.forecast_sum, 0)) < 0.01
     AND ABS(s.actual_sum - COALESCE(ra.actual_sum, 0)) < 0.01
    THEN '✅ Match'
    ELSE '❌ Mismatch - rebuild needed'
  END as verification
FROM cashflow_daily_summary s
LEFT JOIN raw_forecast rf ON rf.date = s.date
LEFT JOIN raw_actual ra ON ra.date = s.date
WHERE s.date >= DATE_TRUNC('month', CURRENT_DATE)
ORDER BY s.date
LIMIT 10;

-- ============================================
-- TIMEZONE VERIFICATION
-- ============================================

-- 8. Verify timezone bucketing (UTC 17:00 → Thai date)
SELECT
  txn_id,
  settled_time AS utc_time,
  settled_time AT TIME ZONE 'Asia/Bangkok' AS bangkok_time,
  (settled_time AT TIME ZONE 'Asia/Bangkok')::date AS thai_date,
  CASE
    WHEN (settled_time AT TIME ZONE 'Asia/Bangkok')::date = DATE(settled_time AT TIME ZONE 'Asia/Bangkok')
    THEN '✅ Correct TZ bucketing'
    ELSE '❌ Wrong TZ bucketing'
  END as verification
FROM settlement_transactions
WHERE marketplace = 'tiktok'
  AND settled_time >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY settled_time DESC
LIMIT 10;

-- ============================================
-- EXCEPTION DETECTION
-- ============================================

-- 9. Find forecast without match (exceptions)
SELECT
  u.txn_id,
  u.estimated_settle_time AT TIME ZONE 'Asia/Bangkok' AS expected_settle_thai,
  u.estimated_settlement_amount,
  u.status,
  CASE
    WHEN u.estimated_settle_time < NOW() THEN '⚠️  Overdue'
    ELSE 'ℹ️  Future'
  END as overdue_status
FROM unsettled_transactions u
LEFT JOIN settlement_transactions s
  ON s.marketplace = u.marketplace
  AND s.txn_id = u.txn_id
WHERE u.marketplace = 'tiktok'
  AND u.status = 'unsettled'
  AND s.id IS NULL
ORDER BY u.estimated_settle_time
LIMIT 20;

-- 10. Find actual without forecast
SELECT
  s.txn_id,
  s.settled_time AT TIME ZONE 'Asia/Bangkok' AS settled_thai,
  s.settlement_amount,
  'ℹ️  No matching forecast' as note
FROM settlement_transactions s
LEFT JOIN unsettled_transactions u
  ON u.marketplace = s.marketplace
  AND u.txn_id = s.txn_id
WHERE s.marketplace = 'tiktok'
  AND u.id IS NULL
ORDER BY s.settled_time DESC
LIMIT 20;

-- ============================================
-- IMPORT HISTORY
-- ============================================

-- 11. Recent imports
SELECT
  id,
  report_type,
  file_name,
  status,
  row_count,
  inserted_count,
  updated_count,
  error_count,
  notes,
  created_at AT TIME ZONE 'Asia/Bangkok' AS imported_at_thai
FROM import_batches
WHERE marketplace = 'tiktok'
ORDER BY created_at DESC
LIMIT 10;

-- 12. Import success rate
SELECT
  report_type,
  COUNT(*) as total_imports,
  COUNT(CASE WHEN status = 'success' THEN 1 END) as successful,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
  ROUND(100.0 * COUNT(CASE WHEN status = 'success' THEN 1 END) / COUNT(*), 2) as success_rate
FROM import_batches
WHERE marketplace = 'tiktok'
GROUP BY report_type;

-- ============================================
-- MANUAL OPERATIONS
-- ============================================

-- 13. Manually rebuild summary (replace USER_UUID)
-- Get user UUID first:
-- SELECT id, email FROM auth.users;

-- Then run:
-- SELECT rebuild_cashflow_daily_summary(
--   'YOUR_USER_UUID'::uuid,
--   '2026-01-01'::date,
--   '2026-01-31'::date
-- );

-- Expected output:
-- NOTICE: [Cashflow] Summary rebuilt: start=2026-01-01, end=2026-01-31, rows=25

-- 14. Clear all cashflow data (DANGEROUS - testing only)
-- TRUNCATE unsettled_transactions CASCADE;
-- TRUNCATE settlement_transactions CASCADE;
-- TRUNCATE cashflow_daily_summary CASCADE;
-- TRUNCATE import_batches CASCADE;

-- 15. Reset specific import (allow re-upload)
-- DELETE FROM import_batches
-- WHERE marketplace = 'tiktok'
--   AND file_name = 'your_file_name.xlsx';

-- ============================================
-- PERFORMANCE DIAGNOSTICS
-- ============================================

-- 16. Query plan for daily summary (check index usage)
EXPLAIN ANALYZE
SELECT date, forecast_sum, actual_sum, gap_sum
FROM cashflow_daily_summary
WHERE date >= '2026-01-01' AND date <= '2026-01-31'
ORDER BY date;

-- Expected: Index Scan using idx_cashflow_daily_summary_date

-- 17. Query plan for forecast (check index usage)
EXPLAIN ANALYZE
SELECT COUNT(*)
FROM unsettled_transactions
WHERE marketplace = 'tiktok'
  AND estimated_settle_time >= '2026-01-01'
  AND estimated_settle_time < '2026-02-01'
  AND status = 'unsettled';

-- Expected: Index Scan using idx_unsettled_transactions_marketplace_date

-- 18. Table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS indexes_size
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('settlement_transactions', 'unsettled_transactions', 'cashflow_daily_summary')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- ============================================
-- END OF DEBUG QUERIES
-- ============================================

-- Quick health check (run this first):
-- SELECT 'RLS Status' as check_name, tablename, CASE WHEN rowsecurity = false THEN '✅' ELSE '❌' END FROM pg_tables WHERE tablename IN ('settlement_transactions', 'unsettled_transactions', 'cashflow_daily_summary')
-- UNION ALL
-- SELECT 'NULL Dates' as check_name, 'unsettled_transactions', CASE WHEN COUNT(CASE WHEN estimated_settle_time IS NULL THEN 1 END) = 0 THEN '✅' ELSE '❌' END FROM unsettled_transactions WHERE marketplace = 'tiktok';
