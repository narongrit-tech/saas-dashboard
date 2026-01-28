-- ============================================
-- Migration 026: Import Batches Date Tracking
-- Description: Add date tracking fields for import batches to support date basis filtering
-- Date: 2026-01-27
-- ============================================

-- Add date tracking columns to import_batches
ALTER TABLE public.import_batches
ADD COLUMN IF NOT EXISTS date_min DATE,
ADD COLUMN IF NOT EXISTS date_max DATE,
ADD COLUMN IF NOT EXISTS date_basis_used TEXT;

-- Add check constraint for date_basis_used
ALTER TABLE public.import_batches
DROP CONSTRAINT IF EXISTS import_batches_date_basis_valid;

ALTER TABLE public.import_batches
ADD CONSTRAINT import_batches_date_basis_valid
CHECK (date_basis_used IS NULL OR date_basis_used IN ('order_date', 'paid_at'));

-- Add index for date range queries
CREATE INDEX IF NOT EXISTS idx_import_batches_date_range
    ON public.import_batches(date_min, date_max)
    WHERE date_min IS NOT NULL AND date_max IS NOT NULL;

-- Add comments
COMMENT ON COLUMN public.import_batches.date_min IS 'Minimum date from imported data (based on date_basis_used)';
COMMENT ON COLUMN public.import_batches.date_max IS 'Maximum date from imported data (based on date_basis_used)';
COMMENT ON COLUMN public.import_batches.date_basis_used IS 'Date field used for filtering: order_date or paid_at';

-- ============================================
-- END OF MIGRATION
-- ============================================
