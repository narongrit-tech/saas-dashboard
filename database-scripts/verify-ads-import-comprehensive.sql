-- Comprehensive Verification Script for TikTok Ads Daily Import
-- Purpose: Verify that import correctly stores 13 rows with campaign_id/video_id
-- Test Case: 2026-01-16 Product Ads file
-- Expected: 13 rows, spend=80.83, orders=24, revenue=5497.80
-- Test Batch ID: aeee2247-3f46-49d6-94aa-feafb1b6ca91
-- Test User ID: 2c4e254d-c779-4f8a-af93-603dc26e6af0

-- ============================================================================
-- SECTION 1: Verify Row Count (Expected: 13 rows)
-- ============================================================================

SELECT
  COUNT(*) as total_rows,
  CASE
    WHEN COUNT(*) = 13 THEN '✓ PASS: 13 rows found'
    ELSE '✗ FAIL: Expected 13 rows, got ' || COUNT(*)
  END as status
FROM ad_daily_performance
WHERE import_batch_id = 'aeee2247-3f46-49d6-94aa-feafb1b6ca91'
  AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0';

-- ============================================================================
-- SECTION 2: Verify campaign_id and video_id Presence
-- ============================================================================

SELECT
  COUNT(*) as rows_with_campaign_id,
  COUNT(*) FILTER (WHERE campaign_id IS NULL) as null_campaign_id,
  COUNT(*) FILTER (WHERE video_id IS NULL) as null_video_id,
  CASE
    WHEN COUNT(*) FILTER (WHERE campaign_id IS NULL) = 0 THEN '✓ PASS: All rows have campaign_id'
    ELSE '⚠ WARNING: ' || COUNT(*) FILTER (WHERE campaign_id IS NULL) || ' rows missing campaign_id'
  END as campaign_id_status,
  CASE
    WHEN COUNT(*) FILTER (WHERE video_id IS NULL) = 0 THEN '✓ PASS: All rows have video_id'
    ELSE '⚠ WARNING: ' || COUNT(*) FILTER (WHERE video_id IS NULL) || ' rows missing video_id'
  END as video_id_status
FROM ad_daily_performance
WHERE import_batch_id = 'aeee2247-3f46-49d6-94aa-feafb1b6ca91'
  AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0';

-- ============================================================================
-- SECTION 3: Verify Totals Match Expected Values
-- ============================================================================

SELECT
  ROUND(SUM(spend)::numeric, 2) as total_spend,
  SUM(orders) as total_orders,
  ROUND(SUM(revenue)::numeric, 2) as total_revenue,
  CASE
    WHEN ROUND(SUM(spend)::numeric, 2) = 80.83 THEN '✓ PASS'
    ELSE '✗ FAIL: Expected 80.83, got ' || ROUND(SUM(spend)::numeric, 2)
  END as spend_status,
  CASE
    WHEN SUM(orders) = 24 THEN '✓ PASS'
    ELSE '✗ FAIL: Expected 24, got ' || SUM(orders)
  END as orders_status,
  CASE
    WHEN ROUND(SUM(revenue)::numeric, 2) = 5497.80 THEN '✓ PASS'
    ELSE '✗ FAIL: Expected 5497.80, got ' || ROUND(SUM(revenue)::numeric, 2)
  END as revenue_status
FROM ad_daily_performance
WHERE import_batch_id = 'aeee2247-3f46-49d6-94aa-feafb1b6ca91'
  AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0';

-- ============================================================================
-- SECTION 4: Verify No Duplicate Rows (Unique Key Check)
-- ============================================================================

SELECT
  marketplace,
  ad_date,
  campaign_type,
  campaign_name,
  campaign_id,
  video_id,
  COUNT(*) as duplicate_count
FROM ad_daily_performance
WHERE import_batch_id = 'aeee2247-3f46-49d6-94aa-feafb1b6ca91'
  AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
GROUP BY marketplace, ad_date, campaign_type, campaign_name, campaign_id, video_id, created_by
HAVING COUNT(*) > 1;

-- ============================================================================
-- SECTION 5: Verify Campaign Names Not Truncated
-- ============================================================================

SELECT
  campaign_name,
  LENGTH(campaign_name) as name_length,
  campaign_id,
  video_id,
  spend,
  orders,
  revenue
FROM ad_daily_performance
WHERE import_batch_id = 'aeee2247-3f46-49d6-94aa-feafb1b6ca91'
  AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
ORDER BY campaign_name;

-- ============================================================================
-- SECTION 6: Verify Wallet Ledger Consistency
-- ============================================================================

WITH ad_totals AS (
  SELECT
    ad_date,
    SUM(spend) as daily_spend
  FROM ad_daily_performance
  WHERE import_batch_id = 'aeee2247-3f46-49d6-94aa-feafb1b6ca91'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
  GROUP BY ad_date
),
wallet_totals AS (
  SELECT
    date,
    SUM(amount) as wallet_amount
  FROM wallet_ledger
  WHERE import_batch_id = 'aeee2247-3f46-49d6-94aa-feafb1b6ca91'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
    AND entry_type = 'SPEND'
  GROUP BY date
)
SELECT
  COALESCE(a.ad_date::text, w.date) as date,
  ROUND(COALESCE(a.daily_spend, 0)::numeric, 2) as ad_spend,
  ROUND(COALESCE(w.wallet_amount, 0)::numeric, 2) as wallet_spend,
  CASE
    WHEN ROUND(a.daily_spend::numeric, 2) = ROUND(w.wallet_amount::numeric, 2) THEN '✓ MATCH'
    ELSE '✗ MISMATCH'
  END as status
FROM ad_totals a
FULL OUTER JOIN wallet_totals w ON a.ad_date::text = w.date
ORDER BY date;

-- ============================================================================
-- SECTION 7: Verify Import Batch Metadata
-- ============================================================================

SELECT
  id,
  report_type,
  status,
  row_count,
  inserted_count,
  updated_count,
  error_count,
  file_name,
  created_at,
  notes,
  metadata
FROM import_batches
WHERE id = 'aeee2247-3f46-49d6-94aa-feafb1b6ca91'
  AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0';

-- ============================================================================
-- SECTION 8: Check for Stuck Processing Batches
-- ============================================================================

SELECT
  id,
  report_type,
  status,
  file_hash,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at))/60 as minutes_stuck
FROM import_batches
WHERE status = 'processing'
  AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
ORDER BY created_at DESC;

-- ============================================================================
-- SECTION 9: Verify RLS Isolation (User Cannot See Other Users' Data)
-- ============================================================================

SELECT
  COUNT(*) as my_rows,
  COUNT(*) FILTER (WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') as verified_owner
FROM ad_daily_performance
WHERE import_batch_id = 'aeee2247-3f46-49d6-94aa-feafb1b6ca91';

-- ============================================================================
-- SECTION 10: Summary Report
-- ============================================================================

WITH test_results AS (
  SELECT
    COUNT(*) as actual_rows,
    ROUND(SUM(spend)::numeric, 2) as actual_spend,
    SUM(orders) as actual_orders,
    ROUND(SUM(revenue)::numeric, 2) as actual_revenue
  FROM ad_daily_performance
  WHERE import_batch_id = 'aeee2247-3f46-49d6-94aa-feafb1b6ca91'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
)
SELECT
  'Row Count' as metric,
  13 as expected,
  actual_rows as actual,
  CASE WHEN actual_rows = 13 THEN '✓ PASS' ELSE '✗ FAIL' END as status
FROM test_results
UNION ALL
SELECT
  'Total Spend',
  80.83,
  actual_spend,
  CASE WHEN actual_spend = 80.83 THEN '✓ PASS' ELSE '✗ FAIL' END
FROM test_results
UNION ALL
SELECT
  'Total Orders',
  24,
  actual_orders,
  CASE WHEN actual_orders = 24 THEN '✓ PASS' ELSE '✗ FAIL' END
FROM test_results
UNION ALL
SELECT
  'Total Revenue',
  5497.80,
  actual_revenue,
  CASE WHEN actual_revenue = 5497.80 THEN '✓ PASS' ELSE '✗ FAIL' END
FROM test_results;

-- ============================================================================
-- MANUAL VERIFICATION STEPS
-- ============================================================================

-- 1. Run all 10 sections above
-- 2. Check that all PASS statuses are green checkmarks
-- 3. Verify no duplicates in Section 4 (should return 0 rows)
-- 4. Verify no stuck batches in Section 8 (should return 0 rows or old ones only)
-- 5. Check wallet consistency in Section 6 (all should be MATCH)
-- 6. Review summary in Section 10 (all metrics should be PASS)
