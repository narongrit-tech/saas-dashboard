-- ============================================
-- Migration 021: Add Campaign IDs to ad_daily_performance
-- Purpose: Support campaign_id and video_id for unique constraint
-- Date: 2026-01-26
-- ============================================

-- ============================================
-- PROBLEM:
-- Current unique constraint uses campaign_name which can be:
-- 1. NULL (for campaigns without names)
-- 2. Duplicate (same name across different campaigns)
-- 3. Non-unique across video_id (same campaign, different videos)
--
-- SOLUTION:
-- Add campaign_id and video_id columns for proper uniqueness
-- Update unique constraint to use COALESCE for NULL safety
-- ============================================

-- ============================================
-- STEP 1: Add new columns
-- ============================================

-- Add campaign_id column (TikTok campaign ID or platform-specific ID)
ALTER TABLE public.ad_daily_performance
ADD COLUMN IF NOT EXISTS campaign_id TEXT;

-- Add video_id column (TikTok video ID or creative ID)
ALTER TABLE public.ad_daily_performance
ADD COLUMN IF NOT EXISTS video_id TEXT;

-- ============================================
-- STEP 2: Drop old unique constraint
-- ============================================

-- Drop old constraint that relied on campaign_name
-- This constraint fails when campaign_name is NULL or duplicate
-- NOTE: Must use ALTER TABLE ... DROP CONSTRAINT (not DROP INDEX)
-- because the constraint owns the index
ALTER TABLE public.ad_daily_performance
DROP CONSTRAINT IF EXISTS ad_daily_perf_unique_per_campaign;

-- ============================================
-- STEP 3: Create new unique constraint with NULL safety
-- ============================================

-- New unique constraint using campaign_id and video_id
-- Uses COALESCE to handle NULL values (treat NULL as empty string for uniqueness)
-- This ensures:
-- 1. Same campaign_id + video_id + date = duplicate (blocked)
-- 2. NULL campaign_id is treated as '' for uniqueness check
-- 3. NULL video_id is treated as '' for uniqueness check
CREATE UNIQUE INDEX ad_daily_perf_unique_with_ids
ON public.ad_daily_performance (
    marketplace,
    ad_date,
    campaign_type,
    COALESCE(campaign_id, ''),
    COALESCE(video_id, ''),
    created_by
);

-- ============================================
-- STEP 4: Add comments for new columns
-- ============================================

COMMENT ON COLUMN public.ad_daily_performance.campaign_id IS
    'Platform-specific campaign ID (e.g., TikTok campaign_id). Used for deduplication.';

COMMENT ON COLUMN public.ad_daily_performance.video_id IS
    'Platform-specific video/creative ID (e.g., TikTok video_id). Used for deduplication.';

-- ============================================
-- STEP 5: Optional - Create indexes for performance
-- ============================================

-- Index on campaign_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_ad_daily_perf_campaign_id
    ON public.ad_daily_performance(campaign_id)
    WHERE campaign_id IS NOT NULL;

-- Index on video_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_ad_daily_perf_video_id
    ON public.ad_daily_performance(video_id)
    WHERE video_id IS NOT NULL;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Verify new columns exist
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'ad_daily_performance'
    AND column_name IN ('campaign_id', 'video_id');
-- Expected: 2 rows showing TEXT, YES

-- Verify new unique index exists
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'ad_daily_performance'
    AND indexname = 'ad_daily_perf_unique_with_ids';
-- Expected: 1 row with COALESCE in indexdef

-- Verify old index is dropped
SELECT
    indexname
FROM pg_indexes
WHERE tablename = 'ad_daily_performance'
    AND indexname = 'ad_daily_perf_unique_per_campaign';
-- Expected: 0 rows

-- ============================================
-- ROLLBACK INSTRUCTIONS
-- ============================================

/*
To rollback this migration, run the following commands:

-- Drop new indexes
DROP INDEX IF EXISTS ad_daily_perf_unique_with_ids;
DROP INDEX IF EXISTS idx_ad_daily_perf_campaign_id;
DROP INDEX IF EXISTS idx_ad_daily_perf_video_id;

-- Restore old unique constraint
CREATE UNIQUE INDEX ad_daily_perf_unique_per_campaign
ON public.ad_daily_performance (
    marketplace,
    ad_date,
    campaign_type,
    campaign_name,
    created_by
);

-- Drop new columns
ALTER TABLE public.ad_daily_performance DROP COLUMN IF EXISTS campaign_id;
ALTER TABLE public.ad_daily_performance DROP COLUMN IF EXISTS video_id;

-- Verify rollback
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'ad_daily_performance'
    AND column_name IN ('campaign_id', 'video_id');
-- Expected: 0 rows
*/

-- ============================================
-- MIGRATION IMPACT ANALYSIS
-- ============================================

/*
AFFECTED AREAS:
1. ✅ ad_daily_performance table schema (2 new columns)
2. ✅ Unique constraint (changed from campaign_name to campaign_id + video_id)
3. ⚠️ Import logic (needs update to populate campaign_id + video_id)
4. ⚠️ Ad parser (needs update to extract campaign_id + video_id from files)

BREAKING CHANGES:
- None. New columns are nullable, existing data is unaffected.
- Old imports without campaign_id/video_id will use COALESCE('') for uniqueness.

DATA MIGRATION:
- No data migration needed for existing rows.
- New imports must populate campaign_id and video_id for proper deduplication.

RLS POLICIES:
- No changes needed. Policies use created_by, not affected by new columns.

PERFORMANCE:
- New indexes improve query performance for campaign_id and video_id lookups.
- Unique index may be slightly slower due to COALESCE, but negligible impact.

NEXT STEPS:
1. Update TikTok ads parser to extract campaign_id and video_id from files
2. Update import action to pass campaign_id and video_id to database
3. Test import with new columns populated
4. Verify no duplicate errors occur
*/

-- ============================================
-- END OF MIGRATION
-- ============================================
