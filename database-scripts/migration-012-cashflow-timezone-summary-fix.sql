-- Migration 012: Cashflow Daily Summary Timezone Fix
-- Purpose: Fix "date shift by 1 day" bug in cashflow_daily_summary
-- Issue: Summary table showed wrong dates (e.g., user selects 2026-01-25 but table shows 2026-01-24)
-- Root Cause: Date filtering in API used UTC date instead of Bangkok date
-- Solution: API now uses formatBangkok() to ensure date filtering matches database timezone
-- Date: 2026-01-25

-- ============================================
-- BACKGROUND: What was the problem?
-- ============================================
-- Database function rebuild_cashflow_daily_summary() ALREADY uses correct timezone:
--   - (settled_time AT TIME ZONE 'Asia/Bangkok')::date
--   - (estimated_settle_time AT TIME ZONE 'Asia/Bangkok')::date
--
-- However, the API layer was filtering by WRONG date:
--   - Client sends: Date(2026-01-25 00:00 Bangkok) = 2026-01-24T17:00Z (UTC)
--   - Old API code: startDate.toISOString().split('T')[0] = '2026-01-24' ❌
--   - New API code: formatBangkok(startDate, 'yyyy-MM-dd') = '2026-01-25' ✅
--
-- Result: User selects Jan 25 but sees Jan 24 data (shifted by timezone offset)

-- ============================================
-- A) NO DATABASE CHANGES NEEDED
-- ============================================
-- The database function is already correct (from migration-010).
-- This migration only documents the fix and provides verification queries.
--
-- If you want to verify the function is correct, you can check:

-- EXPLAIN: rebuild_cashflow_daily_summary function
SELECT pg_get_functiondef('rebuild_cashflow_daily_summary'::regproc);

-- You should see lines like:
--   (estimated_settle_time AT TIME ZONE 'Asia/Bangkok')::date
--   (settled_time AT TIME ZONE 'Asia/Bangkok')::date

-- ============================================
-- B) VERIFY EXISTING INDEXES
-- ============================================
-- Indexes from migration-010 should already exist:

-- Check if indexes exist
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE tablename IN ('cashflow_daily_summary', 'settlement_transactions', 'unsettled_transactions')
ORDER BY tablename, indexname;

-- Expected indexes:
-- 1. idx_cashflow_daily_summary_user_date (created_by, date)
-- 2. idx_settlement_transactions_user_marketplace_time (created_by, marketplace, settled_time)
-- 3. idx_unsettled_transactions_user_marketplace_time (created_by, marketplace, estimated_settle_time)

-- ============================================
-- C) REBUILD COMMAND (FOR MANUAL EXECUTION)
-- ============================================
-- After deploying this migration, rebuild summary for affected date ranges:
--
-- Step 1: Get user UUID
-- SELECT id, email FROM auth.users;
--
-- Step 2: Rebuild summary for January 2026
-- SELECT rebuild_cashflow_daily_summary(
--   'YOUR_USER_UUID'::UUID,
--   '2026-01-01'::date,
--   '2026-01-31'::date
-- );
--
-- This will delete and recreate all summary rows for the date range,
-- ensuring dates are correctly bucketed by Bangkok timezone.

-- ============================================
-- D) DEBUG QUERIES (VERIFICATION)
-- ============================================

-- Query 1: Check actual TH date vs UTC date
-- Purpose: Verify that settled_time at UTC 17:00 on 2026-01-24 = TH date 2026-01-25
--
-- SELECT
--   settled_time,
--   settled_time::date AS utc_date,
--   (settled_time AT TIME ZONE 'Asia/Bangkok')::date AS th_date,
--   settlement_amount
-- FROM settlement_transactions
-- WHERE marketplace='tiktok' AND created_by=auth.uid()
-- ORDER BY settled_time DESC
-- LIMIT 20;
--
-- Expected:
-- settled_time = '2026-01-24 17:00:00+00' → th_date = '2026-01-25' ✅

-- Query 2: Check summary table dates
-- Purpose: Verify that summary.date matches TH date (not UTC date)
--
-- SELECT date, forecast_sum, forecast_count, actual_sum, actual_count
-- FROM cashflow_daily_summary
-- WHERE created_by=auth.uid()
--   AND date BETWEEN '2026-01-01' AND '2026-01-31'
-- ORDER BY date;
--
-- Expected:
-- Transactions with settled_time = '2026-01-24 17:00+00' should appear in date='2026-01-25' row ✅

-- Query 3: Compare raw transactions vs summary aggregation
-- Purpose: Verify that summary matches raw data (same timezone bucketing)
--
-- WITH raw_actual AS (
--   SELECT
--     (settled_time AT TIME ZONE 'Asia/Bangkok')::date AS th_date,
--     SUM(settlement_amount) AS total_amount,
--     COUNT(*) AS total_count
--   FROM settlement_transactions
--   WHERE created_by=auth.uid()
--     AND (settled_time AT TIME ZONE 'Asia/Bangkok')::date = '2026-01-25'
--   GROUP BY (settled_time AT TIME ZONE 'Asia/Bangkok')::date
-- ),
-- summary_actual AS (
--   SELECT
--     date,
--     actual_sum,
--     actual_count
--   FROM cashflow_daily_summary
--   WHERE created_by=auth.uid()
--     AND date = '2026-01-25'
-- )
-- SELECT
--   raw_actual.th_date,
--   raw_actual.total_amount AS raw_total,
--   summary_actual.actual_sum AS summary_total,
--   raw_actual.total_count AS raw_count,
--   summary_actual.actual_count AS summary_count,
--   CASE
--     WHEN raw_actual.total_amount = summary_actual.actual_sum THEN '✅ Match'
--     ELSE '❌ Mismatch'
--   END AS status
-- FROM raw_actual
-- FULL OUTER JOIN summary_actual ON raw_actual.th_date = summary_actual.date;
--
-- Expected: status = '✅ Match' (raw and summary should match exactly)

-- ============================================
-- E) WHAT WAS CHANGED (SUMMARY)
-- ============================================
--
-- Files modified:
-- 1. frontend/src/app/(dashboard)/finance/marketplace-wallets/finance/marketplace-wallets-api-actions.ts
--    - Added: import { formatBangkok } from '@/lib/bangkok-time'
--    - Changed: .gte('date', startDate.toISOString().split('T')[0])
--      → .gte('date', formatBangkok(startDate, 'yyyy-MM-dd'))
--    - Applied to: getCashflowSummary, getDailyCashflowSummary, rebuildCashflowSummary
--
-- 2. frontend/src/app/(dashboard)/finance/marketplace-wallets/page.tsx
--    - Changed: formatDate() to parse date string as local date (not UTC)
--    - Prevents: new Date('2026-01-25') → UTC midnight → timezone shift
--
-- Database changes: NONE (already correct from migration-010)

-- ============================================
-- F) MIGRATION COMPLETE
-- ============================================

RAISE NOTICE '[Migration 012] Cashflow timezone summary fix - No database changes needed. API layer fixed.';
RAISE NOTICE '[Migration 012] Run rebuild_cashflow_daily_summary() to refresh existing data if needed.';
