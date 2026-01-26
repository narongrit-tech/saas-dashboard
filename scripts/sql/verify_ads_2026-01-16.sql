-- ============================================
-- Verification Script: TikTok Product Ads for 2026-01-16
-- Purpose: Verify correct data after cleanup + re-import
-- Date: 2026-01-26
-- ============================================

-- ============================================
-- TEST 1: Row Count Verification
-- ============================================
-- Expected: 13 rows (13 unique campaigns for 2026-01-16)

SELECT
    COUNT(*) as total_rows,
    COUNT(DISTINCT campaign_name) as unique_campaigns,
    COUNT(DISTINCT campaign_id) as unique_campaign_ids,
    COUNT(DISTINCT video_id) as unique_video_ids
FROM public.ad_daily_performance
WHERE ad_date = '2026-01-16'
    AND campaign_type = 'product'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0';

-- Expected output:
-- total_rows: 13
-- unique_campaigns: 13
-- unique_campaign_ids: 13
-- unique_video_ids: 13

-- ============================================
-- TEST 2: Aggregated Metrics Verification
-- ============================================
-- Expected totals:
-- - sum(spend) = 80.83
-- - sum(orders) = 24
-- - sum(revenue) = 5497.80

SELECT
    SUM(spend) as total_spend,
    SUM(orders) as total_orders,
    SUM(revenue) as total_revenue,
    ROUND(AVG(roi), 2) as avg_roi,
    MIN(spend) as min_spend,
    MAX(spend) as max_spend
FROM public.ad_daily_performance
WHERE ad_date = '2026-01-16'
    AND campaign_type = 'product'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0';

-- Expected output:
-- total_spend: 80.83
-- total_orders: 24
-- total_revenue: 5497.80
-- avg_roi: ~68.00 (calculated from 5497.80 / 80.83)

-- ============================================
-- TEST 3: Campaign List (No Duplicates)
-- ============================================
-- Verify all 13 campaigns exist with no duplicates

SELECT
    campaign_name,
    campaign_id,
    video_id,
    spend,
    orders,
    revenue,
    ROUND(roi, 2) as roi,
    created_at
FROM public.ad_daily_performance
WHERE ad_date = '2026-01-16'
    AND campaign_type = 'product'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
ORDER BY campaign_name;

-- Expected: 13 rows, no duplicate campaign_name
-- Each row should have unique campaign_id and video_id

-- ============================================
-- TEST 4: Campaign ID and Video ID Population
-- ============================================
-- Verify campaign_id and video_id are populated correctly

SELECT
    COUNT(*) as total_rows,
    COUNT(campaign_id) as rows_with_campaign_id,
    COUNT(video_id) as rows_with_video_id,
    COUNT(CASE WHEN campaign_id IS NULL THEN 1 END) as null_campaign_id,
    COUNT(CASE WHEN video_id IS NULL THEN 1 END) as null_video_id
FROM public.ad_daily_performance
WHERE ad_date = '2026-01-16'
    AND campaign_type = 'product'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0';

-- Expected output:
-- total_rows: 13
-- rows_with_campaign_id: 13 (100% populated)
-- rows_with_video_id: 13 (100% populated)
-- null_campaign_id: 0
-- null_video_id: 0

-- ============================================
-- TEST 5: Duplicate Detection
-- ============================================
-- Should return 0 rows (no duplicates allowed)

SELECT
    marketplace,
    ad_date,
    campaign_type,
    COALESCE(campaign_id, '') as campaign_id,
    COALESCE(video_id, '') as video_id,
    created_by,
    COUNT(*) as duplicate_count
FROM public.ad_daily_performance
WHERE ad_date = '2026-01-16'
    AND campaign_type = 'product'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
GROUP BY
    marketplace,
    ad_date,
    campaign_type,
    COALESCE(campaign_id, ''),
    COALESCE(video_id, ''),
    created_by
HAVING COUNT(*) > 1;

-- Expected: 0 rows (no duplicates)

-- ============================================
-- TEST 6: Import Batch Linkage
-- ============================================
-- Verify all rows are linked to a valid import batch

SELECT
    adp.id,
    adp.ad_date,
    adp.campaign_name,
    adp.spend,
    adp.import_batch_id,
    ib.report_type,
    ib.metadata->>'reportDate' as report_date,
    ib.metadata->>'adsType' as ads_type,
    ib.status,
    ib.created_at as batch_created_at
FROM public.ad_daily_performance adp
LEFT JOIN public.import_batches ib ON adp.import_batch_id = ib.id
WHERE adp.ad_date = '2026-01-16'
    AND adp.campaign_type = 'product'
    AND adp.created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
ORDER BY adp.campaign_name;

-- Expected: 13 rows with valid import_batch_id
-- All rows should have:
-- - report_type = 'tiktok_ads_daily'
-- - report_date = '2026-01-16'
-- - ads_type = 'product'
-- - status = 'completed'

-- ============================================
-- TEST 7: Wallet Ledger Linkage
-- ============================================
-- Verify wallet SPEND entry exists and is correctly linked

SELECT
    wl.id,
    wl.wallet_id,
    wl.date,
    wl.entry_type,
    wl.direction,
    wl.amount,
    wl.source,
    wl.import_batch_id,
    w.name as wallet_name,
    ib.metadata->>'reportDate' as report_date
FROM public.wallet_ledger wl
JOIN public.wallets w ON wl.wallet_id = w.id
LEFT JOIN public.import_batches ib ON wl.import_batch_id = ib.id
WHERE wl.date = '2026-01-16'
    AND wl.entry_type = 'SPEND'
    AND wl.created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
ORDER BY wl.created_at DESC;

-- Expected: 1 row (single aggregated SPEND entry)
-- Should have:
-- - wallet_name = 'TikTok Ads' (or similar)
-- - amount = 80.83 (sum of all ad spend for 2026-01-16)
-- - entry_type = 'SPEND'
-- - direction = 'OUT'
-- - source = 'IMPORTED'

-- ============================================
-- TEST 8: ROI Calculation Verification
-- ============================================
-- Verify ROI is calculated correctly for all campaigns

SELECT
    campaign_name,
    spend,
    revenue,
    roi as stored_roi,
    CASE
        WHEN spend > 0 THEN ROUND((revenue / spend)::numeric, 4)
        ELSE NULL
    END as calculated_roi,
    CASE
        WHEN spend > 0 AND ABS(roi - (revenue / spend)) > 0.01 THEN 'MISMATCH'
        ELSE 'OK'
    END as roi_check
FROM public.ad_daily_performance
WHERE ad_date = '2026-01-16'
    AND campaign_type = 'product'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
ORDER BY campaign_name;

-- Expected: All rows should have roi_check = 'OK'
-- ROI formula: revenue / spend
-- Tolerance: 0.01 (acceptable rounding difference)

-- ============================================
-- TEST 9: Data Integrity Checks
-- ============================================

-- Check for negative values (should be 0 rows)
SELECT
    campaign_name,
    spend,
    orders,
    revenue
FROM public.ad_daily_performance
WHERE ad_date = '2026-01-16'
    AND campaign_type = 'product'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
    AND (spend < 0 OR orders < 0 OR revenue < 0);
-- Expected: 0 rows

-- Check for logical inconsistencies (revenue > 0 but orders = 0)
SELECT
    campaign_name,
    spend,
    orders,
    revenue
FROM public.ad_daily_performance
WHERE ad_date = '2026-01-16'
    AND campaign_type = 'product'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
    AND revenue > 0
    AND orders = 0;
-- Expected: 0 rows (if revenue exists, orders should exist)

-- ============================================
-- TEST 10: Comparison with Import Batch Metadata
-- ============================================

-- Verify import batch metadata matches aggregated data
SELECT
    ib.id as batch_id,
    ib.metadata->>'reportDate' as report_date,
    ib.row_count as batch_row_count,
    ib.inserted_count as batch_inserted_count,
    COUNT(adp.id) as actual_row_count,
    SUM(adp.spend) as actual_total_spend
FROM public.import_batches ib
LEFT JOIN public.ad_daily_performance adp ON ib.id = adp.import_batch_id
WHERE ib.report_type = 'tiktok_ads_daily'
    AND ib.metadata->>'reportDate' = '2026-01-16'
    AND ib.metadata->>'adsType' = 'product'
    AND ib.created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
GROUP BY ib.id, ib.metadata->>'reportDate', ib.row_count, ib.inserted_count;

-- Expected: 1 batch with:
-- - batch_row_count = 13
-- - batch_inserted_count = 13
-- - actual_row_count = 13
-- - actual_total_spend = 80.83

-- ============================================
-- SUMMARY TEST
-- ============================================
-- Run this query last to get a complete summary

SELECT
    '2026-01-16' as verification_date,
    'product' as campaign_type,
    (SELECT COUNT(*) FROM public.ad_daily_performance
     WHERE ad_date = '2026-01-16' AND campaign_type = 'product'
     AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') as total_campaigns,
    (SELECT SUM(spend) FROM public.ad_daily_performance
     WHERE ad_date = '2026-01-16' AND campaign_type = 'product'
     AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') as total_spend,
    (SELECT SUM(orders) FROM public.ad_daily_performance
     WHERE ad_date = '2026-01-16' AND campaign_type = 'product'
     AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') as total_orders,
    (SELECT SUM(revenue) FROM public.ad_daily_performance
     WHERE ad_date = '2026-01-16' AND campaign_type = 'product'
     AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') as total_revenue,
    (SELECT COUNT(*) FROM public.wallet_ledger
     WHERE date = '2026-01-16' AND entry_type = 'SPEND'
     AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') as wallet_entries,
    CASE
        WHEN (SELECT COUNT(*) FROM public.ad_daily_performance
              WHERE ad_date = '2026-01-16' AND campaign_type = 'product'
              AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') = 13
        AND (SELECT SUM(spend) FROM public.ad_daily_performance
             WHERE ad_date = '2026-01-16' AND campaign_type = 'product'
             AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') = 80.83
        AND (SELECT SUM(orders) FROM public.ad_daily_performance
             WHERE ad_date = '2026-01-16' AND campaign_type = 'product'
             AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') = 24
        AND (SELECT SUM(revenue) FROM public.ad_daily_performance
             WHERE ad_date = '2026-01-16' AND campaign_type = 'product'
             AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') = 5497.80
        THEN '✅ PASS'
        ELSE '❌ FAIL'
    END as verification_status;

-- Expected output:
-- verification_date: 2026-01-16
-- campaign_type: product
-- total_campaigns: 13
-- total_spend: 80.83
-- total_orders: 24
-- total_revenue: 5497.80
-- wallet_entries: 1
-- verification_status: ✅ PASS

-- ============================================
-- USAGE INSTRUCTIONS
-- ============================================
/*
RUN THIS SCRIPT AFTER:
1. Cleanup script (cleanup_ads_import_2026-01-16.sql) executed
2. Migration 021 (migration-021-ads-add-campaign-ids.sql) applied
3. Fresh import with campaign_id + video_id populated

INTERPRETATION:
- All TEST queries should pass (0 errors, expected values match)
- SUMMARY TEST should show "✅ PASS"
- If any test fails, investigate the specific query output
- Use TEST results to identify missing or incorrect data

COMMON ISSUES:
1. Row count ≠ 13 → Duplicates or missing campaigns
2. Total spend ≠ 80.83 → Wrong data or missing rows
3. NULL campaign_id/video_id → Parser not updated
4. Duplicate detection returns rows → Unique constraint violated
5. ROI mismatch → Calculation error or data corruption

NEXT STEPS:
- If all tests pass → Data is clean and ready for production
- If tests fail → Review import logic and re-run cleanup
- Document any persistent issues in JIRA/GitHub
*/

-- ============================================
-- END OF VERIFICATION SCRIPT
-- ============================================
