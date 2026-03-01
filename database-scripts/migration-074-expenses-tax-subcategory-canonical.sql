-- Migration 074: Canonical expenses.subcategory + Tax category enablement
-- Purpose:
-- 1) Backfill canonical subcategory from legacy sub_category to prevent data drift
-- 2) Keep legacy sub_category column for backward compatibility (do not drop yet)
-- 3) Ensure category remains TEXT (no enum changes)

BEGIN;

-- Safety: ensure canonical column exists
ALTER TABLE public.expenses
ADD COLUMN IF NOT EXISTS subcategory VARCHAR(100);

-- Backfill canonical subcategory from legacy column where needed
UPDATE public.expenses
SET subcategory = COALESCE(subcategory, sub_category)
WHERE subcategory IS NULL
  AND sub_category IS NOT NULL;

COMMIT;

-- Note:
-- - We intentionally keep public.expenses.sub_category for now.
-- - Application code has been updated to read/write canonical `subcategory` only.
