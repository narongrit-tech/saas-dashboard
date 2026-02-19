-- ============================================
-- Migration 061: COGS Partial Allocation Tracking
-- Description: Add 'partial' status + missing_skus/allocated_skus to run items
--              Add partial counter to runs table
-- Date: 2026-02-19
-- Purpose: Surface partial allocations (bundle components partially done)
-- ============================================

BEGIN;

-- ============================================
-- 1. Add 'partial' status to run_items
-- ============================================

-- Drop old check constraint
ALTER TABLE public.inventory_cogs_apply_run_items
    DROP CONSTRAINT IF EXISTS inventory_cogs_apply_run_items_status_check;

-- Re-add with 'partial' included
ALTER TABLE public.inventory_cogs_apply_run_items
    ADD CONSTRAINT inventory_cogs_apply_run_items_status_check
    CHECK (status IN ('successful', 'skipped', 'failed', 'partial'));

COMMENT ON COLUMN public.inventory_cogs_apply_run_items.status IS 'Result: successful, skipped, failed, or partial (bundle component partially allocated)';

-- ============================================
-- 2. Add missing_skus and allocated_skus columns to run_items
-- ============================================

ALTER TABLE public.inventory_cogs_apply_run_items
    ADD COLUMN IF NOT EXISTS missing_skus TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.inventory_cogs_apply_run_items
    ADD COLUMN IF NOT EXISTS allocated_skus TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.inventory_cogs_apply_run_items.missing_skus IS 'Component SKUs that failed allocation (for bundle orders)';
COMMENT ON COLUMN public.inventory_cogs_apply_run_items.allocated_skus IS 'Component SKUs that were successfully allocated (for bundle orders)';

-- ============================================
-- 3. Add partial counter to runs table
-- ============================================

ALTER TABLE public.inventory_cogs_apply_runs
    ADD COLUMN IF NOT EXISTS partial INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.inventory_cogs_apply_runs.partial IS 'Orders with partial allocation (some bundle components done, some missing)';

-- Update existing count constraint to include partial
ALTER TABLE public.inventory_cogs_apply_runs
    DROP CONSTRAINT IF EXISTS cogs_apply_runs_counts_non_negative;

ALTER TABLE public.inventory_cogs_apply_runs
    ADD CONSTRAINT cogs_apply_runs_counts_non_negative
    CHECK (
        total >= 0 AND eligible >= 0 AND successful >= 0
        AND skipped >= 0 AND failed >= 0 AND partial >= 0
    );

-- ============================================
-- 4. Index for missing_skus queries (GIN for array search)
-- ============================================

CREATE INDEX IF NOT EXISTS idx_cogs_apply_run_items_missing_skus
ON public.inventory_cogs_apply_run_items USING GIN (missing_skus)
WHERE array_length(missing_skus, 1) > 0;

-- ============================================
-- VERIFICATION
-- ============================================

DO $$
BEGIN
    -- Check 'partial' status is valid
    IF EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'inventory_cogs_apply_run_items_status_check'
    ) THEN
        RAISE NOTICE 'Status check constraint updated with partial';
    END IF;

    -- Check new columns exist
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'inventory_cogs_apply_run_items'
        AND column_name = 'missing_skus'
    ) THEN
        RAISE NOTICE 'Column missing_skus added';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'inventory_cogs_apply_run_items'
        AND column_name = 'allocated_skus'
    ) THEN
        RAISE NOTICE 'Column allocated_skus added';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'inventory_cogs_apply_runs'
        AND column_name = 'partial'
    ) THEN
        RAISE NOTICE 'Column partial added to runs';
    END IF;

    RAISE NOTICE 'Migration 061 completed successfully!';
END $$;

COMMIT;
