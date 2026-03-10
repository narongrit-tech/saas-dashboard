-- Migration 082: Ads Import Scope Key
-- Date: 2026-03-10
-- Purpose: Adds import_scope_key for deterministic ads import scope matching and safe REPLACE

-- ============================================================================
-- 1. Add import_scope_key column to import_batches
-- ============================================================================

ALTER TABLE public.import_batches
ADD COLUMN IF NOT EXISTS import_scope_key TEXT;

COMMENT ON COLUMN public.import_batches.import_scope_key IS
'Deterministic scope key for ads imports. Format: ads:{marketplace}:{campaign_type}:{date_start}:{date_end}
Example: ads:tiktok:product:2026-01-01:2026-01-31
Used to detect overlapping/duplicate imports and suggest REPLACE vs APPEND.';

-- ============================================================================
-- 2. Index for scope key lookups (active batches only)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_import_batches_scope_key_active
ON public.import_batches(created_by, import_scope_key)
WHERE import_scope_key IS NOT NULL AND status = 'success';

-- ============================================================================
-- 3. Index for date-range overlap detection on ads batches
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_import_batches_ads_dates
ON public.import_batches(created_by, report_type, date_min, date_max)
WHERE report_type LIKE 'tiktok_ads_%' AND status = 'success';

-- ============================================================================
-- Verification
-- ============================================================================

-- Check column exists:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'import_batches' AND column_name = 'import_scope_key';

-- Check indexes:
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename = 'import_batches'
--   AND indexname IN ('idx_import_batches_scope_key_active', 'idx_import_batches_ads_dates');
