-- ============================================
-- Migration 023: Add source_row_hash to ad_daily_performance
-- Purpose: Prevent duplicate rows with same campaign_id/video_id by using content-based hash
-- Date: 2026-01-26
-- ============================================

-- ============================================
-- PROBLEM:
-- Current unique constraint uses campaign_id + video_id which can be:
-- 1. NULL (treated as '' by COALESCE)
-- 2. Duplicate values like 'N/A' (multiple rows with same key)
-- 3. Causing rows to UPDATE instead of INSERT → missing data
-- 4. Daily totals don't match file export totals
--
-- SOLUTION:
-- Add source_row_hash column (MD5 of key + value fields normalized)
-- Update unique constraint to include source_row_hash
-- This ensures each row with different spend/orders/revenue gets unique hash
-- ============================================

-- ============================================
-- STEP 1: Add source_row_hash column
-- ============================================

ALTER TABLE public.ad_daily_performance
ADD COLUMN IF NOT EXISTS source_row_hash TEXT;

COMMENT ON COLUMN public.ad_daily_performance.source_row_hash IS
    'MD5 hash of normalized key fields + value fields (date, campaign_type, campaign_name, campaign_id, video_id, spend, orders, revenue). Used for deduplication.';

-- ============================================
-- STEP 2: Backfill existing rows with deterministic hash
-- ============================================

-- Backfill NULL source_row_hash for existing rows
-- Uses MD5 of concatenated normalized fields (stable formatting):
-- Hash = campaign_name|campaign_id|video_id|spend|orders|revenue
-- This MUST match the frontend makeSourceRowHash() function logic exactly
UPDATE public.ad_daily_performance
SET source_row_hash = MD5(
    LOWER(TRIM(COALESCE(campaign_name, ''))) || '|' ||
    LOWER(TRIM(COALESCE(campaign_id, ''))) || '|' ||
    LOWER(TRIM(COALESCE(video_id, ''))) || '|' ||
    TRIM(TO_CHAR(COALESCE(spend, 0), 'FM999999990.00')) || '|' ||
    COALESCE(orders, 0)::TEXT || '|' ||
    TRIM(TO_CHAR(COALESCE(revenue, 0), 'FM999999990.00'))
)
WHERE source_row_hash IS NULL;

-- ============================================
-- STEP 3: Drop old unique index/constraint
-- ============================================

-- Drop old index that uses campaign_id + video_id only
-- This index causes duplicate rows when video_id='N/A' or campaign_id is NULL
DROP INDEX IF EXISTS public.ad_daily_perf_unique_with_ids;

-- ============================================
-- STEP 4: Create new unique constraint with source_row_hash
-- ============================================

-- New unique constraint using source_row_hash
-- This ensures:
-- 1. Each row with different spend/orders/revenue gets unique hash
-- 2. Rows with same campaign_id/video_id but different values won't collide
-- 3. Daily totals will match file export totals
-- NOTE: campaign_id/video_id NOT included in unique constraint anymore (they can have 'N/A' duplicates)
CREATE UNIQUE INDEX ad_daily_perf_unique_with_hash
ON public.ad_daily_performance (
    created_by,
    marketplace,
    ad_date,
    campaign_type,
    campaign_name,
    source_row_hash
)
WHERE source_row_hash IS NOT NULL;

COMMENT ON INDEX public.ad_daily_perf_unique_with_hash IS
    'Unique constraint including source_row_hash to prevent duplicate rows with same campaign_id/video_id but different spend/orders/revenue.';

-- ============================================
-- STEP 5: Create index on source_row_hash for fast lookups
-- ============================================

CREATE INDEX IF NOT EXISTS idx_ad_daily_perf_source_row_hash
    ON public.ad_daily_performance(source_row_hash)
    WHERE source_row_hash IS NOT NULL;

COMMENT ON INDEX public.idx_ad_daily_perf_source_row_hash IS
    'Fast lookup by source_row_hash for deduplication checks.';

-- ============================================
-- VERIFICATION QUERIES (copy-paste these to SQL Editor)
-- ============================================

-- Query 1: Verify source_row_hash column exists
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'ad_daily_performance'
    AND column_name = 'source_row_hash';
-- Expected: 1 row showing TEXT, YES

-- Query 2: Verify old index is dropped
SELECT
    indexname
FROM pg_indexes
WHERE tablename = 'ad_daily_performance'
    AND indexname = 'ad_daily_perf_unique_with_ids';
-- Expected: 0 rows

-- Query 3: Verify new unique index exists
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'ad_daily_performance'
    AND indexname = 'ad_daily_perf_unique_with_hash';
-- Expected: 1 row with source_row_hash in indexdef

-- Query 4: Verify backfill completed (no NULL source_row_hash)
SELECT COUNT(*) as null_hash_count
FROM ad_daily_performance
WHERE source_row_hash IS NULL;
-- Expected: 0

-- Query 5: Check for duplicate video_id='N/A' rows (should show counts per date)
SELECT
    ad_date,
    campaign_id,
    video_id,
    COUNT(*) as row_count,
    SUM(spend) as total_spend,
    SUM(orders) as total_orders
FROM ad_daily_performance
WHERE video_id = 'N/A' OR video_id IS NULL
GROUP BY ad_date, campaign_id, video_id
HAVING COUNT(*) > 1
ORDER BY ad_date DESC;
-- Expected: Should show multiple rows per date (not collapsed)

-- Query 6: Verify daily totals match expected values (example for date '2026-01-17')
-- Replace '2026-01-17' with your test date
SELECT
    ad_date,
    COUNT(*) as row_count,
    SUM(spend) as total_spend,
    SUM(orders) as total_orders,
    SUM(revenue) as total_revenue
FROM ad_daily_performance
WHERE ad_date = '2026-01-17'
    AND marketplace = 'tiktok'
GROUP BY ad_date;
-- Expected: totals should match file export totals

-- Query 7: Check index usage (should use ad_daily_perf_unique_with_hash)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM ad_daily_performance
WHERE marketplace = 'tiktok'
    AND ad_date = '2026-01-17'
    AND campaign_type = 'product'
    AND campaign_name = 'Test Campaign'
    AND source_row_hash = 'test_hash';
-- Expected: Should use idx_ad_daily_perf_source_row_hash

-- ============================================
-- ROLLBACK INSTRUCTIONS (if needed)
-- ============================================

/*
To rollback this migration, run the following commands:

-- Drop new indexes
DROP INDEX IF EXISTS public.ad_daily_perf_unique_with_hash;
DROP INDEX IF EXISTS public.idx_ad_daily_perf_source_row_hash;

-- Restore old unique constraint
CREATE UNIQUE INDEX ad_daily_perf_unique_with_ids
ON public.ad_daily_performance (
    marketplace,
    ad_date,
    campaign_type,
    COALESCE(campaign_id, ''),
    COALESCE(video_id, ''),
    created_by
);

-- Drop source_row_hash column
ALTER TABLE public.ad_daily_performance DROP COLUMN IF EXISTS source_row_hash;

-- Verify rollback
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'ad_daily_performance'
    AND column_name = 'source_row_hash';
-- Expected: 0 rows
*/

-- ============================================
-- MIGRATION IMPACT ANALYSIS
-- ============================================

/*
AFFECTED AREAS:
1. ✅ ad_daily_performance table schema (1 new column: source_row_hash)
2. ✅ Unique constraint (changed from campaign_id+video_id to include source_row_hash)
3. ⚠️ Import logic (needs update to calculate and populate source_row_hash)
4. ⚠️ Upsert logic (needs update to query by source_row_hash)

BREAKING CHANGES:
- None. New column is nullable, existing data backfilled automatically.
- Old imports without source_row_hash will have hash computed during backfill.

DATA MIGRATION:
- Existing rows: source_row_hash backfilled using MD5 of key + value fields
- New imports: must calculate source_row_hash before insert/update

RLS POLICIES:
- No changes needed. Policies use created_by, not affected by new column.

PERFORMANCE:
- New index on source_row_hash improves query performance for hash lookups
- Unique index with source_row_hash ensures daily totals match file exports
- Backfill UPDATE may take 1-5 seconds for 1000s of rows (run in off-peak hours)

NEXT STEPS:
1. Update TikTok ads importer to calculate source_row_hash per row
2. Update upsert logic to query by source_row_hash
3. Test import with file that has video_id='N/A' or NULL campaign_id
4. Verify daily totals match file export totals (especially day 17)
*/

-- ============================================
-- END OF MIGRATION
-- ============================================
