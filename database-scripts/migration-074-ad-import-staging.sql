-- Migration 074: Ad Import Staging Rows
-- Date: 2026-03-02
-- Purpose: Avoid Next.js 20MB server-action limit by staging parsed rows in DB
--          Client parses XLSX locally, sends small JSON rows → server stores staging
--          Confirm step reads staging rows (no large payload from client)
--
-- Changes:
--   1. ALTER import_batches status CHECK → add 'staging'
--   2. CREATE TABLE ad_import_staging_rows (temp holding during preview→confirm window)
--   3. RLS + index

-- ============================================================================
-- 1. Extend import_batches status constraint to include 'staging'
-- ============================================================================
ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_status_check;

ALTER TABLE public.import_batches
  ADD CONSTRAINT import_batches_status_check
  CHECK (status IN ('processing', 'success', 'failed', 'rolled_back', 'deleted', 'staging'));

COMMENT ON CONSTRAINT import_batches_status_check ON public.import_batches IS
'Valid status values: processing (active import), success (completed), failed (error),
rolled_back (data removed), deleted (hard purged), staging (preview parsed, awaiting confirm)';

-- ============================================================================
-- 2. Staging table for ads import rows
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ad_import_staging_rows (
  id            UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by    UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_id      UUID          NOT NULL,
  row_index     INT           NOT NULL,
  ad_date       DATE          NOT NULL,
  campaign_name TEXT          NOT NULL,
  spend         NUMERIC(14,4) NOT NULL DEFAULT 0,
  gmv           NUMERIC(14,4) NOT NULL DEFAULT 0,
  orders        INT           NOT NULL DEFAULT 0,
  roas          NUMERIC(10,4) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. RLS
-- ============================================================================
ALTER TABLE public.ad_import_staging_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own staging rows" ON public.ad_import_staging_rows;
CREATE POLICY "Users own staging rows"
  ON public.ad_import_staging_rows
  FOR ALL
  USING (created_by = auth.uid());

-- ============================================================================
-- 4. Index (batch_id query in confirm step)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_ad_import_staging_batch
  ON public.ad_import_staging_rows (created_by, batch_id);

-- ============================================================================
-- 5. Verification
-- ============================================================================
-- SELECT COUNT(*) FROM public.ad_import_staging_rows;
-- SELECT constraint_name, check_clause FROM information_schema.check_constraints
--   WHERE constraint_name = 'import_batches_status_check';
