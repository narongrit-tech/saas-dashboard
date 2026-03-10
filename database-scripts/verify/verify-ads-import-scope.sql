-- Verification: Ads Import Scope (Migration 082)
-- Run these queries in Supabase SQL editor to verify the migration and feature.

-- ============================================================================
-- 1. Verify column exists
-- ============================================================================

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'import_batches'
  AND column_name = 'import_scope_key';
-- Expected: 1 row — column_name='import_scope_key', data_type='text', is_nullable='YES'

-- ============================================================================
-- 2. Verify indexes exist
-- ============================================================================

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'import_batches'
  AND indexname IN ('idx_import_batches_scope_key_active', 'idx_import_batches_ads_dates');
-- Expected: 2 rows

-- ============================================================================
-- 3. List all ads batches with scope key (to confirm backfill if done)
-- ============================================================================

SELECT
  id,
  report_type,
  status,
  date_min,
  date_max,
  import_scope_key,
  file_name,
  created_at
FROM import_batches
WHERE report_type LIKE 'tiktok_ads_%'
ORDER BY created_at DESC
LIMIT 20;

-- ============================================================================
-- 4. Find overlapping ads batches for a given date range (debug)
-- ============================================================================

-- Replace the dates and user_id below to test overlap detection:
-- SELECT id, report_type, date_min, date_max, import_scope_key, status
-- FROM import_batches
-- WHERE created_by = '<your-user-id>'::uuid
--   AND report_type = 'tiktok_ads_product'
--   AND status = 'success'
--   AND date_min <= '2026-01-31'
--   AND date_max >= '2026-01-01';

-- ============================================================================
-- 5. Check scope key match (REPLACE case)
-- ============================================================================

-- SELECT id, file_name, import_scope_key, status
-- FROM import_batches
-- WHERE created_by = '<your-user-id>'::uuid
--   AND import_scope_key = 'ads:tiktok:product:2026-01-01:2026-01-31'
--   AND status = 'success';
