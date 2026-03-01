-- migration-073-analytics-presets.sql
-- =============================================
-- Purpose: Create analytics_presets table for the Analytics Builder feature.
--          Users can save/load/rename/delete custom metric expression presets.
--          Per-user isolation enforced via RLS (created_by = auth.uid()).
--
-- Run:    psql $DATABASE_URL -f database-scripts/migration-073-analytics-presets.sql
-- =============================================

-- =============================================
-- STEP 1: Create table
-- =============================================

CREATE TABLE IF NOT EXISTS public.analytics_presets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        NOT NULL DEFAULT auth.uid()
                            REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  definition    jsonb       NOT NULL,
  last_used_at  timestamptz NULL
);

-- =============================================
-- STEP 2: Index for listing user's presets (most-recently-updated first)
-- =============================================

CREATE INDEX IF NOT EXISTS idx_analytics_presets_created_by_updated_at
  ON public.analytics_presets (created_by, updated_at DESC);

-- =============================================
-- STEP 3: auto-update updated_at trigger
-- =============================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_presets_updated_at ON public.analytics_presets;
CREATE TRIGGER trg_analytics_presets_updated_at
  BEFORE UPDATE ON public.analytics_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================
-- STEP 4: Enable RLS
-- =============================================

ALTER TABLE public.analytics_presets ENABLE ROW LEVEL SECURITY;

-- =============================================
-- STEP 5: RLS Policies (owner-only, idempotent)
-- =============================================

DROP POLICY IF EXISTS "analytics_presets_select_policy" ON public.analytics_presets;
CREATE POLICY "analytics_presets_select_policy"
  ON public.analytics_presets
  FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS "analytics_presets_insert_policy" ON public.analytics_presets;
CREATE POLICY "analytics_presets_insert_policy"
  ON public.analytics_presets
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "analytics_presets_update_policy" ON public.analytics_presets;
CREATE POLICY "analytics_presets_update_policy"
  ON public.analytics_presets
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "analytics_presets_delete_policy" ON public.analytics_presets;
CREATE POLICY "analytics_presets_delete_policy"
  ON public.analytics_presets
  FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

-- =============================================
-- VERIFY (run separately to confirm migration)
-- =============================================
-- Query 1: Table exists
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'analytics_presets';
--
-- Query 2: RLS enabled
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname = 'analytics_presets';
--   → relrowsecurity = true
--
-- Query 3: 4 policies exist
--   SELECT policyname FROM pg_policies
--   WHERE tablename = 'analytics_presets' ORDER BY policyname;
--
-- Query 4: Index exists
--   SELECT indexname FROM pg_indexes WHERE tablename = 'analytics_presets';
