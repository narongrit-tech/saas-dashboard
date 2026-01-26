-- ============================================
-- Migration 020: Add metadata column to import_batches
-- Description: Store additional import context (reportDate, adsType, etc.)
-- Date: 2026-01-26
-- Purpose: Fix ads import confirm error (missing metadata column)
-- ============================================

-- ============================================
-- ADD COLUMN
-- ============================================

-- Add metadata column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'import_batches'
      AND column_name = 'metadata'
  ) THEN
    ALTER TABLE public.import_batches
    ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;

    RAISE NOTICE 'Added metadata column to import_batches';
  ELSE
    RAISE NOTICE 'metadata column already exists';
  END IF;
END $$;

-- ============================================
-- CREATE INDEX
-- ============================================

-- Create GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_import_batches_metadata
  ON public.import_batches USING gin(metadata);

-- ============================================
-- UPDATE EXISTING ROWS
-- ============================================

-- Set default empty object for existing NULL values
UPDATE public.import_batches
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;

-- ============================================
-- COMMENT
-- ============================================

COMMENT ON COLUMN public.import_batches.metadata IS
  'Additional import context (JSONB): reportDate, adsType, fileName, etc.';

-- ============================================
-- VERIFY
-- ============================================

-- Show column info
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'import_batches'
  AND column_name = 'metadata';

-- Show sample data
SELECT
  id,
  report_type,
  metadata,
  created_at
FROM public.import_batches
ORDER BY created_at DESC
LIMIT 3;

-- ============================================
-- END OF MIGRATION
-- ============================================
