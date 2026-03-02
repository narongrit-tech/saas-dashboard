-- Migration 074: Ad Import Staging Rows
-- Date: 2026-03-02
-- Purpose: Avoid Next.js 20MB server-action limit by staging parsed rows in DB
--          Client parses XLSX locally, sends small JSON rows → server stores staging
--          Confirm step reads staging rows (no large payload from client)
--
-- NOTE: import_batches.status constraint is NOT changed.
--       Code uses existing 'processing' status for preview/staging state.
--       Staging state is tracked by ad_import_staging_rows existence, not status value.
--
-- Changes:
--   1. CREATE TABLE ad_import_staging_rows (temp holding during preview→confirm window)
--   2. RLS + index

-- ============================================================================
-- 1. Staging table for ads import rows
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
-- 2. RLS
-- ============================================================================
ALTER TABLE public.ad_import_staging_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own staging rows" ON public.ad_import_staging_rows;
CREATE POLICY "Users own staging rows"
  ON public.ad_import_staging_rows
  FOR ALL
  USING (created_by = auth.uid());

-- ============================================================================
-- 3. Index (batch_id query in confirm step)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_ad_import_staging_batch
  ON public.ad_import_staging_rows (created_by, batch_id);

-- ============================================================================
-- 4. Verification
-- ============================================================================
-- SELECT COUNT(*) FROM public.ad_import_staging_rows;
-- SELECT tablename, policyname FROM pg_policies WHERE tablename = 'ad_import_staging_rows';
