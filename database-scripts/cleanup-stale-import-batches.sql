-- ============================================
-- Manual Cleanup Script for Stale Import Batches
-- Phase 6: Sales Orders Import - Fix Duplicate Batches
-- ============================================

-- Purpose:
-- Mark stuck 'processing' batches as 'failed' to prevent:
-- 1. Duplicate batch creation
-- 2. "Already processing" false positives
-- 3. Database clutter

-- When to use:
-- - After system crashes or network interruptions
-- - If users report "Already processing" errors for old imports
-- - Periodic maintenance (weekly)

-- ============================================
-- STEP 1: Inspect Current Batches
-- ============================================

-- Check status distribution
SELECT
  status,
  COUNT(*) as count,
  COUNT(CASE WHEN created_at < NOW() - INTERVAL '1 hour' THEN 1 END) as stale_count_1h,
  COUNT(CASE WHEN created_at < NOW() - INTERVAL '30 minutes' THEN 1 END) as stale_count_30m
FROM import_batches
GROUP BY status
ORDER BY status;

-- Inspect stale processing batches (older than 1 hour)
SELECT
  id,
  file_name,
  marketplace,
  report_type,
  status,
  row_count,
  inserted_count,
  created_at,
  created_by,
  notes,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 as age_minutes
FROM import_batches
WHERE
  status = 'processing'
  AND created_at < NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 50;

-- ============================================
-- STEP 2: Mark Stale Batches as Failed
-- ============================================

-- DRY RUN: Preview what will be updated
SELECT
  id,
  file_name,
  status,
  created_at,
  'Would mark as failed' as action
FROM import_batches
WHERE
  status = 'processing'
  AND created_at < NOW() - INTERVAL '1 hour';

-- ACTUAL UPDATE: Mark stale batches as failed
-- Uncomment the following line to execute
/*
UPDATE import_batches
SET
  status = 'failed',
  notes = CASE
    WHEN notes IS NULL THEN 'Marked as failed due to timeout (manual cleanup)'
    ELSE notes || ' | Marked as failed due to timeout (manual cleanup)'
  END
WHERE
  status = 'processing'
  AND created_at < NOW() - INTERVAL '1 hour';
*/

-- ============================================
-- STEP 3: Verify Results
-- ============================================

-- Check status distribution after cleanup
SELECT
  status,
  COUNT(*) as count
FROM import_batches
GROUP BY status
ORDER BY status;

-- Verify no recent processing batches remain stuck
SELECT
  id,
  file_name,
  status,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 as age_minutes
FROM import_batches
WHERE
  status = 'processing'
  AND created_at < NOW() - INTERVAL '1 hour'
LIMIT 10;

-- ============================================
-- STEP 4: Optional - Check Duplicate File Hashes
-- ============================================

-- Find files with multiple batches (potential duplicates)
SELECT
  file_hash,
  marketplace,
  report_type,
  COUNT(*) as batch_count,
  COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
  COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_count,
  MIN(created_at) as first_import,
  MAX(created_at) as last_import
FROM import_batches
WHERE file_hash IS NOT NULL
GROUP BY file_hash, marketplace, report_type
HAVING COUNT(*) > 1
ORDER BY batch_count DESC, last_import DESC
LIMIT 50;

-- ============================================
-- STEP 5: Optional - Archive Old Batches (>30 days)
-- ============================================

-- DRY RUN: Preview old batches that could be archived
SELECT
  id,
  file_name,
  marketplace,
  status,
  created_at,
  inserted_count,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 as age_days
FROM import_batches
WHERE
  created_at < NOW() - INTERVAL '30 days'
ORDER BY created_at ASC
LIMIT 100;

-- To archive: Either delete or move to an archive table
-- (Not implemented in this script - requires business decision)

-- ============================================
-- USAGE NOTES
-- ============================================

-- 1. Always run STEP 1 first to inspect current state
-- 2. Review STEP 2 DRY RUN before executing actual UPDATE
-- 3. Uncomment UPDATE statement in STEP 2 to execute
-- 4. Run STEP 3 to verify cleanup was successful
-- 5. STEP 4 and STEP 5 are optional monitoring queries

-- Safety:
-- - This script only marks batches as 'failed'
-- - It does NOT delete any data
-- - Original notes are preserved (appended with cleanup message)
-- - Only affects batches older than 1 hour

-- Frequency:
-- - Run weekly or after system incidents
-- - Can be automated via cron job (call cleanupStaleImportBatches() function)

-- ============================================
-- END OF SCRIPT
-- ============================================
