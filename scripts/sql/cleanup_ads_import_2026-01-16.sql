-- ============================================
-- Cleanup Script: Remove Duplicate Ads Import for 2026-01-16
-- Purpose: Clean up duplicate TikTok Product Ads data for 2026-01-16
-- Created: 2026-01-26
-- ============================================

-- ============================================
-- STEP 1: Find affected batch IDs
-- ============================================
-- Find all import batches for Product Ads on 2026-01-16 by specific user
-- Expected: Multiple batches due to re-imports

SELECT
    id,
    report_type,
    metadata->>'reportDate' as report_date,
    metadata->>'adsType' as ads_type,
    row_count,
    inserted_count,
    created_at
FROM public.import_batches
WHERE report_type = 'tiktok_ads_daily'
    AND metadata->>'reportDate' = '2026-01-16'
    AND metadata->>'adsType' = 'product'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
ORDER BY created_at DESC;

-- ============================================
-- STEP 2: Preview affected wallet_ledger entries
-- ============================================
-- Check wallet entries before deletion
-- Expected: Multiple SPEND entries with same date/amount

SELECT
    wl.id,
    wl.wallet_id,
    wl.date,
    wl.entry_type,
    wl.amount,
    wl.import_batch_id,
    ib.created_at as batch_created_at
FROM public.wallet_ledger wl
JOIN public.import_batches ib ON wl.import_batch_id = ib.id
WHERE ib.report_type = 'tiktok_ads_daily'
    AND ib.metadata->>'reportDate' = '2026-01-16'
    AND ib.metadata->>'adsType' = 'product'
    AND ib.created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
ORDER BY ib.created_at DESC, wl.date;

-- ============================================
-- STEP 3: Preview affected ad_daily_performance entries
-- ============================================
-- Check ad performance entries before deletion
-- Expected: Duplicate campaigns with same date/campaign_name

SELECT
    adp.id,
    adp.ad_date,
    adp.campaign_type,
    adp.campaign_name,
    adp.spend,
    adp.orders,
    adp.revenue,
    adp.roi,
    adp.import_batch_id,
    ib.created_at as batch_created_at
FROM public.ad_daily_performance adp
JOIN public.import_batches ib ON adp.import_batch_id = ib.id
WHERE ib.report_type = 'tiktok_ads_daily'
    AND ib.metadata->>'reportDate' = '2026-01-16'
    AND ib.metadata->>'adsType' = 'product'
    AND ib.created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
ORDER BY adp.campaign_name, ib.created_at DESC;

-- ============================================
-- STEP 4: DELETE wallet_ledger entries
-- ============================================
-- Delete wallet entries linked to duplicate import batches
-- ⚠️ WARNING: This is destructive. Review preview queries first!

-- Uncomment to execute:
/*
DELETE FROM public.wallet_ledger
WHERE import_batch_id IN (
    SELECT id
    FROM public.import_batches
    WHERE report_type = 'tiktok_ads_daily'
        AND metadata->>'reportDate' = '2026-01-16'
        AND metadata->>'adsType' = 'product'
        AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
);
*/

-- ============================================
-- STEP 5: DELETE ad_daily_performance entries
-- ============================================
-- Delete ad performance entries linked to duplicate import batches
-- ⚠️ WARNING: This is destructive. Review preview queries first!

-- Uncomment to execute:
/*
DELETE FROM public.ad_daily_performance
WHERE import_batch_id IN (
    SELECT id
    FROM public.import_batches
    WHERE report_type = 'tiktok_ads_daily'
        AND metadata->>'reportDate' = '2026-01-16'
        AND metadata->>'adsType' = 'product'
        AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
);
*/

-- ============================================
-- STEP 6: DELETE import_batches
-- ============================================
-- Delete duplicate import batch records
-- ⚠️ WARNING: This is destructive. Review preview queries first!

-- Uncomment to execute:
/*
DELETE FROM public.import_batches
WHERE report_type = 'tiktok_ads_daily'
    AND metadata->>'reportDate' = '2026-01-16'
    AND metadata->>'adsType' = 'product'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0';
*/

-- ============================================
-- STEP 7: FORCE CLEANUP (Orphan Rows)
-- ============================================
-- This section handles orphan rows (rows without import_batch_id or wrong linkage)
-- Use ONLY if normal cleanup doesn't remove all duplicates

-- Preview orphan ad_daily_performance rows:
SELECT
    id,
    ad_date,
    campaign_type,
    campaign_name,
    spend,
    orders,
    revenue,
    roi,
    import_batch_id,
    created_at
FROM public.ad_daily_performance
WHERE ad_date = '2026-01-16'
    AND campaign_type = 'product'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
    AND (
        import_batch_id IS NULL
        OR import_batch_id NOT IN (
            SELECT id FROM public.import_batches
            WHERE report_type = 'tiktok_ads_daily'
        )
    )
ORDER BY campaign_name, created_at DESC;

-- Force delete orphan ad_daily_performance rows:
-- ⚠️ WARNING: Only use if normal cleanup failed. This ignores import_batch_id.

-- Uncomment to execute:
/*
DELETE FROM public.ad_daily_performance
WHERE ad_date = '2026-01-16'
    AND campaign_type = 'product'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0';
*/

-- Preview orphan wallet_ledger rows:
SELECT
    id,
    wallet_id,
    date,
    entry_type,
    amount,
    note,
    import_batch_id,
    created_at
FROM public.wallet_ledger
WHERE date = '2026-01-16'
    AND entry_type = 'SPEND'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
    AND (
        import_batch_id IS NULL
        OR import_batch_id NOT IN (
            SELECT id FROM public.import_batches
            WHERE report_type = 'tiktok_ads_daily'
        )
    )
ORDER BY created_at DESC;

-- Force delete orphan wallet_ledger rows:
-- ⚠️ WARNING: Only use if normal cleanup failed. This ignores import_batch_id.

-- Uncomment to execute:
/*
DELETE FROM public.wallet_ledger
WHERE date = '2026-01-16'
    AND entry_type = 'SPEND'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0';
*/

-- ============================================
-- STEP 8: Verify Cleanup
-- ============================================
-- Run these queries after cleanup to verify all duplicates are removed

-- Check remaining import_batches:
SELECT COUNT(*) as remaining_batches
FROM public.import_batches
WHERE report_type = 'tiktok_ads_daily'
    AND metadata->>'reportDate' = '2026-01-16'
    AND metadata->>'adsType' = 'product'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0';
-- Expected: 0

-- Check remaining ad_daily_performance:
SELECT COUNT(*) as remaining_ads
FROM public.ad_daily_performance
WHERE ad_date = '2026-01-16'
    AND campaign_type = 'product'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0';
-- Expected: 0 (if full cleanup) or 13 (if keeping one clean import)

-- Check remaining wallet_ledger:
SELECT COUNT(*) as remaining_ledger
FROM public.wallet_ledger
WHERE date = '2026-01-16'
    AND entry_type = 'SPEND'
    AND created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0';
-- Expected: 0 (if full cleanup) or 1 (if keeping one clean import)

-- ============================================
-- USAGE INSTRUCTIONS
-- ============================================
/*
RECOMMENDED WORKFLOW:

1. Run STEP 1-3 (Preview queries) to understand the data
2. Review the results carefully
3. If data looks correct, uncomment and run STEP 4-6 (Deletions) in order
4. Run STEP 8 (Verify) to confirm cleanup success
5. Only use STEP 7 (Force Cleanup) if normal cleanup leaves orphan rows

ROLLBACK:
- This script does NOT support rollback
- Make sure to backup data before running DELETE commands
- Consider wrapping in a transaction for safety:
  BEGIN;
  -- run delete commands
  -- verify results
  COMMIT; -- or ROLLBACK;

NOTES:
- All DELETE commands are commented by default (safe to run as-is)
- Uncomment only the sections you want to execute
- Always run preview queries first
- Monitor affected row counts
*/

-- ============================================
-- END OF CLEANUP SCRIPT
-- ============================================
