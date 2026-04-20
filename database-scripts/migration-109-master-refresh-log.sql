-- ============================================================
-- Migration 109: tt_master_refresh_log
-- Tracks runs of the master refresh pipeline (product/shop/cache rebuild).
-- Used for: concurrency lock (prevent double-runs), observability.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tt_master_refresh_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status           TEXT        NOT NULL CHECK (status IN ('running', 'done', 'error')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  facts_read       INTEGER,
  products_upserted INTEGER,
  shops_upserted   INTEGER,
  cache_updated    INTEGER,
  error_message    TEXT
);

CREATE INDEX IF NOT EXISTS idx_ttmrl_created_by_started
  ON public.tt_master_refresh_log (created_by, started_at DESC);

ALTER TABLE public.tt_master_refresh_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ttmrl_all ON public.tt_master_refresh_log;
CREATE POLICY ttmrl_all ON public.tt_master_refresh_log
  FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

COMMIT;
