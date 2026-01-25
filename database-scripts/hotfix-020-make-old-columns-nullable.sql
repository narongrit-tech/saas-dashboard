-- HOTFIX: Make old bank_reconciliations columns NULLABLE
-- Purpose: Fix "null value in column entity_type violates not-null constraint" error
-- Context: Migration-020 added new columns but kept old columns as NOT NULL
-- Solution: Make old columns nullable so new code can insert without them
--
-- Run this if you get error: "null value in column entity_type violates not-null constraint"
--
-- Created: 2026-01-26

-- Make old columns NULLABLE (for backward compatibility)
ALTER TABLE public.bank_reconciliations
  ALTER COLUMN entity_type DROP NOT NULL,
  ALTER COLUMN entity_id DROP NOT NULL,
  ALTER COLUMN matched_amount DROP NOT NULL,
  ALTER COLUMN matched_by DROP NOT NULL,
  ALTER COLUMN matched_at DROP NOT NULL;

-- Verify changes
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'bank_reconciliations'
  AND table_schema = 'public'
ORDER BY ordinal_position;
