-- ============================================
-- Migration: Import Batches Table
-- Description: Track file import batches with stats
-- Phase: 2A
-- Date: 2026-01-19
-- ============================================

-- ============================================
-- TABLE: import_batches
-- ============================================

CREATE TABLE IF NOT EXISTS public.import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    marketplace TEXT NOT NULL,
    report_type TEXT NOT NULL,  -- e.g. 'tiktok_onhold', 'tiktok_ads_daily'
    period TEXT,                -- e.g. 'MTD', 'DAILY', or date range string

    file_name TEXT,
    file_hash TEXT,             -- SHA256 hash to prevent duplicates

    -- Import statistics
    row_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,

    status TEXT NOT NULL DEFAULT 'processing',  -- processing|success|failed
    notes TEXT,

    CONSTRAINT import_batches_row_count_non_negative CHECK (row_count >= 0),
    CONSTRAINT import_batches_inserted_count_non_negative CHECK (inserted_count >= 0),
    CONSTRAINT import_batches_updated_count_non_negative CHECK (updated_count >= 0),
    CONSTRAINT import_batches_skipped_count_non_negative CHECK (skipped_count >= 0),
    CONSTRAINT import_batches_error_count_non_negative CHECK (error_count >= 0),
    CONSTRAINT import_batches_status_valid CHECK (status IN ('processing', 'success', 'failed'))
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_import_batches_created_by_date
    ON public.import_batches(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_batches_marketplace_report_type
    ON public.import_batches(marketplace, report_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_batches_file_hash
    ON public.import_batches(file_hash)
    WHERE file_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_import_batches_status
    ON public.import_batches(status);

-- ============================================
-- TRIGGERS
-- ============================================

DROP TRIGGER IF EXISTS update_import_batches_updated_at ON public.import_batches;
CREATE TRIGGER update_import_batches_updated_at
    BEFORE UPDATE ON public.import_batches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

-- Users can view their own import batches
DROP POLICY IF EXISTS "import_batches_select_policy" ON public.import_batches;
CREATE POLICY "import_batches_select_policy"
    ON public.import_batches FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

-- Users can insert their own import batches
DROP POLICY IF EXISTS "import_batches_insert_policy" ON public.import_batches;
CREATE POLICY "import_batches_insert_policy"
    ON public.import_batches FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

-- Users can update their own import batches
DROP POLICY IF EXISTS "import_batches_update_policy" ON public.import_batches;
CREATE POLICY "import_batches_update_policy"
    ON public.import_batches FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

-- Users can delete their own import batches
DROP POLICY IF EXISTS "import_batches_delete_policy" ON public.import_batches;
CREATE POLICY "import_batches_delete_policy"
    ON public.import_batches FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE public.import_batches IS 'Track file import batches with statistics and status';
COMMENT ON COLUMN public.import_batches.file_hash IS 'SHA256 hash of file content to prevent duplicate imports';
COMMENT ON COLUMN public.import_batches.report_type IS 'Type of report: tiktok_onhold, tiktok_ads_daily, etc.';

-- ============================================
-- END OF MIGRATION
-- ============================================
