-- ============================================
-- Verification: Ad Daily Performance Upsert Fix
-- Purpose: Verify upsert properly updates numeric columns
-- Date: 2026-01-26
-- ============================================

-- Step 1: Check current data (BEFORE re-import)
\echo '=== BEFORE RE-IMPORT ==='
SELECT
  COUNT(*) as row_count,
  SUM(spend)::numeric(10,2) as total_spend,
  SUM(revenue)::numeric(10,2) as total_revenue,
  SUM(orders) as total_orders,
  MIN(spend)::numeric(10,2) as min_spend,
  MAX(spend)::numeric(10,2) as max_spend
FROM ad_daily_performance
WHERE ad_date = '2026-01-16'
  AND campaign_type = 'product';

\echo '\n=== Sample Rows (Current) ==='
SELECT
  ad_date,
  campaign_name,
  spend,
  revenue,
  orders,
  roi,
  updated_at
FROM ad_daily_performance
WHERE ad_date = '2026-01-16'
  AND campaign_type = 'product'
ORDER BY spend DESC
LIMIT 5;

-- Expected (BEFORE fix):
-- - row_count: 13
-- - total_spend: 0.00
-- - total_revenue: 0.00
-- - total_orders: 0

-- ============================================
-- After re-import, run again:
-- ============================================
-- Expected (AFTER fix):
-- - row_count: 13 (same)
-- - total_spend: ≈ 80.83
-- - total_revenue: ≈ 5497.8
-- - total_orders: 24
-- - min_spend > 0, max_spend > 0

-- Step 2: Verify totals match import summary
\echo '\n=== Total Breakdown by Campaign ==='
SELECT
  campaign_name,
  spend::numeric(10,2),
  revenue::numeric(10,2),
  orders,
  roi::numeric(10,4),
  updated_at
FROM ad_daily_performance
WHERE ad_date = '2026-01-16'
  AND campaign_type = 'product'
ORDER BY spend DESC;

-- Step 3: Check for zero rows (should be NONE after fix)
\echo '\n=== Zero Rows Check (should be empty) ==='
SELECT
  COUNT(*) as zero_row_count
FROM ad_daily_performance
WHERE ad_date = '2026-01-16'
  AND campaign_type = 'product'
  AND spend = 0
  AND revenue = 0
  AND orders = 0;

-- Expected: 0 (no zero rows)

-- ============================================
-- END OF VERIFICATION
-- ============================================
