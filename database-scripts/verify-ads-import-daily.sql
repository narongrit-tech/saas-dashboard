-- =====================================================
-- Ads Import Daily Verification Script
-- Purpose: Verify reportDate + adsType implementation
-- Date: 2026-01-26
-- =====================================================

-- SECTION 1: RECENT IMPORTS OVERVIEW
-- =====================================================
-- Check last 10 imports with metadata
SELECT
  ib.id,
  ib.file_name,
  ib.report_type,
  ib.marketplace,
  ib.status,
  ib.row_count,
  ib.inserted_count,
  ib.updated_count,
  ib.error_count,
  ib.metadata->>'reportDate' as report_date,
  ib.metadata->>'adsType' as ads_type,
  LEFT(ib.file_hash, 12) as file_hash_prefix,
  ib.created_at,
  ib.notes
FROM import_batches ib
WHERE ib.created_by = auth.uid()
  AND ib.report_type IN ('tiktok_ads_product', 'tiktok_ads_live', 'tiktok_ads_daily')
ORDER BY ib.created_at DESC
LIMIT 10;

-- Expected: All recent imports should have metadata with reportDate + adsType

-- SECTION 2: AD DAILY PERFORMANCE RECORDS
-- =====================================================
-- Check recent ad performance records
SELECT
  adp.id,
  adp.marketplace,
  adp.ad_date,
  adp.campaign_type,
  adp.campaign_name,
  adp.spend,
  adp.revenue,
  adp.orders,
  adp.roi,
  adp.source,
  adp.import_batch_id,
  adp.created_at
FROM ad_daily_performance adp
WHERE adp.created_by = auth.uid()
ORDER BY adp.created_at DESC
LIMIT 20;

-- Expected: ad_date should match reportDate (or file date if present)
-- Expected: campaign_type should match adsType
-- Expected: source = 'imported'

-- SECTION 3: WALLET LEDGER ENTRIES
-- =====================================================
-- Check wallet SPEND entries (daily aggregated)
SELECT
  wl.id,
  wl.date,
  wl.entry_type,
  wl.direction,
  wl.amount,
  wl.source,
  wl.note,
  wl.import_batch_id,
  wl.created_at,
  w.name as wallet_name,
  w.wallet_type
FROM wallet_ledger wl
JOIN wallets w ON wl.wallet_id = w.id
WHERE wl.created_by = auth.uid()
  AND w.wallet_type = 'ADS'
  AND wl.source = 'IMPORTED'
ORDER BY wl.created_at DESC
LIMIT 20;

-- Expected: One SPEND entry per day (aggregated)
-- Expected: date should match ad_date from ad_daily_performance
-- Expected: amount = sum of spend for that day
-- Expected: direction = 'OUT'

-- SECTION 4: DAILY AGGREGATION VERIFICATION
-- =====================================================
-- Verify one wallet entry per day per import
SELECT
  wl.date,
  wl.import_batch_id,
  COUNT(*) as entry_count,
  SUM(wl.amount) as total_amount,
  MAX(wl.created_at) as latest_entry
FROM wallet_ledger wl
JOIN wallets w ON wl.wallet_id = w.id
WHERE wl.created_by = auth.uid()
  AND w.wallet_type = 'ADS'
  AND wl.source = 'IMPORTED'
  AND wl.created_at > NOW() - INTERVAL '1 hour'
GROUP BY wl.date, wl.import_batch_id
ORDER BY wl.date DESC, wl.import_batch_id;

-- Expected: Each (date, import_batch_id) combination should have entry_count = 1
-- If entry_count > 1, there's an aggregation bug

-- SECTION 5: DEDUPLICATION VERIFICATION
-- =====================================================
-- Check for duplicate imports (should be none)
SELECT
  file_hash,
  metadata->>'reportDate' as report_date,
  metadata->>'adsType' as ads_type,
  COUNT(*) as duplicate_count,
  ARRAY_AGG(id ORDER BY created_at) as batch_ids,
  ARRAY_AGG(file_name ORDER BY created_at) as file_names,
  MIN(created_at) as first_import,
  MAX(created_at) as last_import
FROM import_batches
WHERE created_by = auth.uid()
  AND status = 'success'
  AND report_type IN ('tiktok_ads_product', 'tiktok_ads_live', 'tiktok_ads_daily')
GROUP BY file_hash, metadata->>'reportDate', metadata->>'adsType'
HAVING COUNT(*) > 1;

-- Expected: Empty result (no duplicates)
-- If rows returned, deduplication is broken

-- SECTION 6: METADATA COMPLETENESS CHECK
-- =====================================================
-- Verify all imports have metadata
SELECT
  ib.id,
  ib.file_name,
  ib.report_type,
  ib.metadata IS NULL as missing_metadata,
  ib.metadata->>'reportDate' IS NULL as missing_report_date,
  ib.metadata->>'adsType' IS NULL as missing_ads_type,
  ib.created_at
FROM import_batches ib
WHERE ib.created_by = auth.uid()
  AND ib.report_type IN ('tiktok_ads_product', 'tiktok_ads_live', 'tiktok_ads_daily')
  AND (
    ib.metadata IS NULL
    OR ib.metadata->>'reportDate' IS NULL
    OR ib.metadata->>'adsType' IS NULL
  )
ORDER BY ib.created_at DESC
LIMIT 10;

-- Expected: Empty result (all imports should have complete metadata)
-- If rows returned, metadata storage is broken

-- SECTION 7: DATE CONSISTENCY CHECK
-- =====================================================
-- Verify ad_date matches reportDate (for files without date column)
-- This query compares ad_date with metadata reportDate
SELECT
  adp.ad_date,
  ib.metadata->>'reportDate' as metadata_report_date,
  adp.ad_date::text = ib.metadata->>'reportDate' as dates_match,
  ib.file_name,
  ib.report_type,
  COUNT(*) as row_count
FROM ad_daily_performance adp
JOIN import_batches ib ON adp.import_batch_id = ib.id
WHERE adp.created_by = auth.uid()
  AND adp.created_at > NOW() - INTERVAL '1 hour'
GROUP BY adp.ad_date, ib.metadata->>'reportDate', ib.file_name, ib.report_type
ORDER BY adp.ad_date DESC;

-- Expected: dates_match = true for files without date column
-- Expected: dates_match = false for files with date column (file date used)

-- SECTION 8: CAMPAIGN TYPE CONSISTENCY CHECK
-- =====================================================
-- Verify campaign_type matches adsType
SELECT
  adp.campaign_type,
  ib.metadata->>'adsType' as metadata_ads_type,
  adp.campaign_type = ib.metadata->>'adsType' as types_match,
  ib.file_name,
  COUNT(*) as row_count
FROM ad_daily_performance adp
JOIN import_batches ib ON adp.import_batch_id = ib.id
WHERE adp.created_by = auth.uid()
  AND adp.created_at > NOW() - INTERVAL '1 hour'
GROUP BY adp.campaign_type, ib.metadata->>'adsType', ib.file_name
ORDER BY adp.campaign_type;

-- Expected: types_match = true for all rows
-- If types_match = false, adsType override is broken

-- SECTION 9: WALLET BALANCE VERIFICATION
-- =====================================================
-- Compare total spend from ad_daily_performance with wallet ledger
WITH ad_spend AS (
  SELECT
    ib.id as batch_id,
    ib.file_name,
    SUM(adp.spend) as total_ad_spend
  FROM ad_daily_performance adp
  JOIN import_batches ib ON adp.import_batch_id = ib.id
  WHERE adp.created_by = auth.uid()
    AND adp.created_at > NOW() - INTERVAL '1 hour'
  GROUP BY ib.id, ib.file_name
),
wallet_spend AS (
  SELECT
    wl.import_batch_id as batch_id,
    SUM(wl.amount) as total_wallet_spend
  FROM wallet_ledger wl
  JOIN wallets w ON wl.wallet_id = w.id
  WHERE wl.created_by = auth.uid()
    AND w.wallet_type = 'ADS'
    AND wl.created_at > NOW() - INTERVAL '1 hour'
  GROUP BY wl.import_batch_id
)
SELECT
  a.batch_id,
  a.file_name,
  a.total_ad_spend,
  w.total_wallet_spend,
  ABS(a.total_ad_spend - COALESCE(w.total_wallet_spend, 0)) as difference,
  CASE
    WHEN ABS(a.total_ad_spend - COALESCE(w.total_wallet_spend, 0)) < 0.01 THEN 'OK'
    ELSE 'MISMATCH'
  END as status
FROM ad_spend a
LEFT JOIN wallet_spend w ON a.batch_id = w.batch_id
ORDER BY a.batch_id DESC;

-- Expected: difference < 0.01 (allowing for rounding)
-- Expected: status = 'OK' for all rows
-- If MISMATCH, wallet aggregation is broken

-- SECTION 10: IMPORT BATCH STATUS CHECK
-- =====================================================
-- Check for failed imports
SELECT
  ib.id,
  ib.file_name,
  ib.report_type,
  ib.status,
  ib.error_count,
  ib.notes,
  ib.metadata->>'reportDate' as report_date,
  ib.metadata->>'adsType' as ads_type,
  ib.created_at
FROM import_batches ib
WHERE ib.created_by = auth.uid()
  AND ib.status IN ('failed', 'processing')
  AND ib.created_at > NOW() - INTERVAL '24 hours'
ORDER BY ib.created_at DESC;

-- Expected: Empty result (all imports should succeed)
-- If rows returned, investigate failure reasons

-- SECTION 11: RLS VERIFICATION
-- =====================================================
-- Verify users can only see their own imports
SELECT
  COUNT(*) as other_user_imports,
  CASE
    WHEN COUNT(*) = 0 THEN 'RLS OK'
    ELSE 'RLS BROKEN - SECURITY ISSUE'
  END as rls_status
FROM import_batches
WHERE created_by != auth.uid();

-- Expected: other_user_imports = 0
-- Expected: rls_status = 'RLS OK'
-- If other_user_imports > 0, RLS is broken (CRITICAL)

-- SECTION 12: PERFORMANCE METRICS
-- =====================================================
-- Check import performance
SELECT
  ib.file_name,
  ib.row_count,
  ib.inserted_count,
  EXTRACT(EPOCH FROM (ib.updated_at - ib.created_at)) as import_duration_seconds,
  CASE
    WHEN ib.row_count > 0 THEN EXTRACT(EPOCH FROM (ib.updated_at - ib.created_at)) / ib.row_count
    ELSE NULL
  END as seconds_per_row,
  ib.created_at
FROM import_batches ib
WHERE ib.created_by = auth.uid()
  AND ib.status = 'success'
  AND ib.report_type IN ('tiktok_ads_product', 'tiktok_ads_live', 'tiktok_ads_daily')
  AND ib.created_at > NOW() - INTERVAL '24 hours'
ORDER BY ib.created_at DESC
LIMIT 10;

-- Expected: import_duration_seconds < 60 for files < 1000 rows
-- Expected: seconds_per_row < 0.1

-- SECTION 13: DATA INTEGRITY CHECK
-- =====================================================
-- Verify no orphaned records
SELECT
  'Orphaned ad_daily_performance' as issue_type,
  COUNT(*) as orphaned_count
FROM ad_daily_performance adp
WHERE adp.created_by = auth.uid()
  AND adp.import_batch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM import_batches ib
    WHERE ib.id = adp.import_batch_id
  )
UNION ALL
SELECT
  'Orphaned wallet_ledger' as issue_type,
  COUNT(*) as orphaned_count
FROM wallet_ledger wl
WHERE wl.created_by = auth.uid()
  AND wl.import_batch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM import_batches ib
    WHERE ib.id = wl.import_batch_id
  );

-- Expected: orphaned_count = 0 for both
-- If orphaned_count > 0, foreign key constraint is missing

-- SECTION 14: SUMMARY REPORT
-- =====================================================
-- Overall health check
SELECT
  'Total Imports (24h)' as metric,
  COUNT(*) as value
FROM import_batches
WHERE created_by = auth.uid()
  AND report_type IN ('tiktok_ads_product', 'tiktok_ads_live', 'tiktok_ads_daily')
  AND created_at > NOW() - INTERVAL '24 hours'
UNION ALL
SELECT
  'Successful Imports',
  COUNT(*)
FROM import_batches
WHERE created_by = auth.uid()
  AND report_type IN ('tiktok_ads_product', 'tiktok_ads_live', 'tiktok_ads_daily')
  AND status = 'success'
  AND created_at > NOW() - INTERVAL '24 hours'
UNION ALL
SELECT
  'Failed Imports',
  COUNT(*)
FROM import_batches
WHERE created_by = auth.uid()
  AND report_type IN ('tiktok_ads_product', 'tiktok_ads_live', 'tiktok_ads_daily')
  AND status = 'failed'
  AND created_at > NOW() - INTERVAL '24 hours'
UNION ALL
SELECT
  'Total Ad Records (24h)',
  COUNT(*)
FROM ad_daily_performance
WHERE created_by = auth.uid()
  AND created_at > NOW() - INTERVAL '24 hours'
UNION ALL
SELECT
  'Total Wallet Entries (24h)',
  COUNT(*)
FROM wallet_ledger wl
JOIN wallets w ON wl.wallet_id = w.id
WHERE wl.created_by = auth.uid()
  AND w.wallet_type = 'ADS'
  AND wl.source = 'IMPORTED'
  AND wl.created_at > NOW() - INTERVAL '24 hours'
UNION ALL
SELECT
  'Duplicates Detected',
  COUNT(*)
FROM (
  SELECT file_hash, metadata->>'reportDate', metadata->>'adsType'
  FROM import_batches
  WHERE created_by = auth.uid()
    AND status = 'success'
  GROUP BY file_hash, metadata->>'reportDate', metadata->>'adsType'
  HAVING COUNT(*) > 1
) duplicates;

-- Expected:
-- - Total Imports > 0 (if tests were run)
-- - Successful Imports = Total Imports (100% success rate)
-- - Failed Imports = 0
-- - Duplicates Detected = 0

-- =====================================================
-- END OF VERIFICATION SCRIPT
-- =====================================================

-- NOTES FOR TESTER:
-- 1. Run this script AFTER completing manual imports
-- 2. All queries should return expected results
-- 3. If any query fails, investigate before production
-- 4. Save query results as evidence for QA report

-- CRITICAL CHECKS:
-- - Section 5: Deduplication (must be empty)
-- - Section 6: Metadata completeness (must be empty)
-- - Section 9: Wallet balance match (difference < 0.01)
-- - Section 11: RLS verification (must be 0)
-- - Section 13: Data integrity (must be 0)
