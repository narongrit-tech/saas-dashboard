-- ============================================
-- Backfill tracking_number from metadata
-- Description: Populate tracking_number column from metadata.tracking_id for existing orders
-- Date: 2026-02-17
-- ============================================

-- IMPORTANT: Run this AFTER deploying the code fix to ensure new imports populate tracking_number directly

-- ============================================
-- 1) Check current state BEFORE backfill
-- ============================================

SELECT '=== BEFORE BACKFILL ===' as status;

SELECT
  COUNT(*) as total_orders,
  COUNT(tracking_number) as with_tracking_column,
  COUNT(CASE WHEN metadata->>'tracking_id' IS NOT NULL THEN 1 END) as with_tracking_metadata,
  ROUND(COUNT(tracking_number)::numeric / NULLIF(COUNT(*), 0)::numeric * 100, 2) as percent_column_populated,
  ROUND(COUNT(CASE WHEN metadata->>'tracking_id' IS NOT NULL THEN 1 END)::numeric / NULLIF(COUNT(*), 0)::numeric * 100, 2) as percent_metadata_populated
FROM public.sales_orders;

-- Show sample of metadata structure
SELECT
  id,
  external_order_id,
  tracking_number as tracking_column,
  metadata->>'tracking_id' as tracking_from_metadata,
  source_platform
FROM public.sales_orders
WHERE metadata->>'tracking_id' IS NOT NULL
LIMIT 5;

-- ============================================
-- 2) Perform backfill
-- ============================================

SELECT '=== STARTING BACKFILL ===' as status;

-- Update tracking_number from metadata.tracking_id
-- Only update rows where:
-- 1. metadata has tracking_id
-- 2. tracking_number is currently NULL (don't overwrite manual edits)
UPDATE public.sales_orders
SET tracking_number = metadata->>'tracking_id'
WHERE metadata->>'tracking_id' IS NOT NULL
  AND metadata->>'tracking_id' != ''
  AND tracking_number IS NULL;

-- Get affected row count
SELECT '✓ Backfill complete' as status;

-- ============================================
-- 3) Verify results AFTER backfill
-- ============================================

SELECT '=== AFTER BACKFILL ===' as status;

SELECT
  COUNT(*) as total_orders,
  COUNT(tracking_number) as with_tracking_column,
  COUNT(CASE WHEN metadata->>'tracking_id' IS NOT NULL THEN 1 END) as with_tracking_metadata,
  ROUND(COUNT(tracking_number)::numeric / NULLIF(COUNT(*), 0)::numeric * 100, 2) as percent_column_populated,
  ROUND(COUNT(CASE WHEN metadata->>'tracking_id' IS NOT NULL THEN 1 END)::numeric / NULLIF(COUNT(*), 0)::numeric * 100, 2) as percent_metadata_populated
FROM public.sales_orders;

-- Show sample of backfilled data
SELECT
  id,
  external_order_id,
  tracking_number,
  source_platform,
  order_date
FROM public.sales_orders
WHERE tracking_number IS NOT NULL
ORDER BY order_date DESC
LIMIT 10;

-- ============================================
-- 4) Verify by source_platform
-- ============================================

SELECT '=== BREAKDOWN BY PLATFORM ===' as status;

SELECT
  source_platform,
  COUNT(*) as total_orders,
  COUNT(tracking_number) as with_tracking,
  ROUND(COUNT(tracking_number)::numeric / NULLIF(COUNT(*), 0)::numeric * 100, 2) as percent_with_tracking
FROM public.sales_orders
GROUP BY source_platform
ORDER BY total_orders DESC;

-- ============================================
-- 5) Test search query performance
-- ============================================

SELECT '=== TESTING SEARCH PERFORMANCE ===' as status;

-- Get a sample tracking number for testing
DO $$
DECLARE
  sample_tracking TEXT;
  search_result_count INTEGER;
BEGIN
  -- Get first non-null tracking number
  SELECT tracking_number INTO sample_tracking
  FROM public.sales_orders
  WHERE tracking_number IS NOT NULL
  LIMIT 1;

  IF sample_tracking IS NOT NULL THEN
    RAISE NOTICE 'Testing search with tracking: %', sample_tracking;

    -- Test exact match
    SELECT COUNT(*) INTO search_result_count
    FROM public.sales_orders
    WHERE tracking_number = sample_tracking;

    RAISE NOTICE '✓ Exact match found: % results', search_result_count;

    -- Test ILIKE match (case-insensitive)
    SELECT COUNT(*) INTO search_result_count
    FROM public.sales_orders
    WHERE tracking_number ILIKE '%' || sample_tracking || '%';

    RAISE NOTICE '✓ ILIKE match found: % results', search_result_count;
  ELSE
    RAISE NOTICE '❌ No tracking numbers found for testing';
  END IF;
END $$;

-- ============================================
-- END OF BACKFILL SCRIPT
-- ============================================

SELECT '=== BACKFILL COMPLETE ===' as status;
