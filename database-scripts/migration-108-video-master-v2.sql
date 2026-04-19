-- ============================================================
-- Migration 108: Video Master V2 — Clean Rebuild Path
-- Scope:
--   video_master_v2         — V2 canonical registry (isolated from V1)
--   video_source_mapping_v2 — V2 cross-source audit trail
--   video_overview_cache_v2 — V2 pre-aggregated per-video cache
--
-- Design:
--   - V1 tables (video_master, video_source_mapping, video_overview_cache) are UNTOUCHED
--   - V2 tables start EMPTY — populated by import-studio-analytics-v2.ts + sync-thumbnails-to-v2.ts
--   - V2 cache rebuild joins V1 staging tables (tiktok_studio_analytics_rows, tiktok_video_perf_stats)
--     for engagement/perf data — no need to duplicate staging tables
--   - RLS mirrors V1 (auth.uid() = created_by)
--
-- Run once in Supabase SQL editor. Safe to re-run (IF NOT EXISTS guards).
-- After running, verify: SELECT count(*) FROM video_master_v2;  -- should be 0
-- ============================================================

BEGIN;

-- ============================================================
-- 1) video_master_v2 — V2 canonical video registry
-- ============================================================

CREATE TABLE IF NOT EXISTS public.video_master_v2 (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  tiktok_video_id   TEXT        NOT NULL,
  content_type      TEXT        NOT NULL DEFAULT 'video'
    CHECK (content_type IN ('video', 'live', 'showcase', 'unknown')),

  video_title       TEXT,
  posted_at         DATE,
  duration_sec      INTEGER,
  post_url          TEXT,
  thumbnail_url     TEXT,
  thumbnail_source  TEXT,
  title_source      TEXT,

  UNIQUE (created_by, tiktok_video_id)
);

CREATE INDEX IF NOT EXISTS idx_vm2_created_by_video_id
  ON public.video_master_v2(created_by, tiktok_video_id);

CREATE INDEX IF NOT EXISTS idx_vm2_created_by_posted_at
  ON public.video_master_v2(created_by, posted_at DESC);

CREATE OR REPLACE FUNCTION update_updated_at_column_v2()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_video_master_v2_updated_at ON public.video_master_v2;
CREATE TRIGGER trg_video_master_v2_updated_at
  BEFORE UPDATE ON public.video_master_v2
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.video_master_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vm2_select ON public.video_master_v2;
CREATE POLICY vm2_select ON public.video_master_v2
  FOR SELECT TO authenticated USING (created_by = auth.uid());

DROP POLICY IF EXISTS vm2_insert ON public.video_master_v2;
CREATE POLICY vm2_insert ON public.video_master_v2
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS vm2_update ON public.video_master_v2;
CREATE POLICY vm2_update ON public.video_master_v2
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS vm2_delete ON public.video_master_v2;
CREATE POLICY vm2_delete ON public.video_master_v2
  FOR DELETE TO authenticated USING (created_by = auth.uid());

COMMENT ON TABLE public.video_master_v2 IS
  'V2 canonical video registry. Rebuilt clean from V2 scrape. '
  'Isolated from video_master (V1) — compare side-by-side before cutover.';

-- ============================================================
-- 2) video_source_mapping_v2 — V2 cross-source audit trail
-- ============================================================

CREATE TABLE IF NOT EXISTS public.video_source_mapping_v2 (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  source_type         TEXT        NOT NULL
    CHECK (source_type IN ('studio_analytics', 'perf_stats', 'affiliate')),
  external_id         TEXT        NOT NULL,

  canonical_id        UUID        REFERENCES public.video_master_v2(id) ON DELETE SET NULL,
  match_stage         INTEGER     CHECK (match_stage IN (1, 2, 3)),
  confidence_score    NUMERIC(5,4) CHECK (confidence_score BETWEEN 0 AND 1),
  match_status        TEXT        NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('matched', 'unmatched', 'needs_review', 'conflict')),
  match_reason        TEXT,

  latest_source_table TEXT,
  latest_source_row_id UUID,
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  reviewed_at         TIMESTAMPTZ,
  reviewed_by         UUID        REFERENCES auth.users(id),

  UNIQUE (created_by, source_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_vsm2_created_by_type
  ON public.video_source_mapping_v2(created_by, source_type);

CREATE INDEX IF NOT EXISTS idx_vsm2_canonical_id
  ON public.video_source_mapping_v2(canonical_id);

CREATE INDEX IF NOT EXISTS idx_vsm2_status
  ON public.video_source_mapping_v2(created_by, match_status);

DROP TRIGGER IF EXISTS trg_video_source_mapping_v2_updated_at ON public.video_source_mapping_v2;
CREATE TRIGGER trg_video_source_mapping_v2_updated_at
  BEFORE UPDATE ON public.video_source_mapping_v2
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.video_source_mapping_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vsm2_select ON public.video_source_mapping_v2;
CREATE POLICY vsm2_select ON public.video_source_mapping_v2
  FOR SELECT TO authenticated USING (created_by = auth.uid());

DROP POLICY IF EXISTS vsm2_insert ON public.video_source_mapping_v2;
CREATE POLICY vsm2_insert ON public.video_source_mapping_v2
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS vsm2_update ON public.video_source_mapping_v2;
CREATE POLICY vsm2_update ON public.video_source_mapping_v2
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS vsm2_delete ON public.video_source_mapping_v2;
CREATE POLICY vsm2_delete ON public.video_source_mapping_v2
  FOR DELETE TO authenticated USING (created_by = auth.uid());

COMMENT ON TABLE public.video_source_mapping_v2 IS
  'V2 cross-source matching audit trail. Mirrors video_source_mapping for V2 canonical IDs.';

-- ============================================================
-- 3) video_overview_cache_v2 — V2 pre-aggregated per-video cache
-- ============================================================

CREATE TABLE IF NOT EXISTS public.video_overview_cache_v2 (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                 UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  canonical_id               UUID        NOT NULL REFERENCES public.video_master_v2(id) ON DELETE CASCADE,
  tiktok_video_id            TEXT        NOT NULL,
  video_title                TEXT,
  posted_at                  DATE,
  duration_sec               INTEGER,
  post_url                   TEXT,
  thumbnail_url              TEXT,
  thumbnail_source           TEXT,
  content_type               TEXT        NOT NULL DEFAULT 'video',

  -- Studio engagement (from tiktok_studio_analytics_rows — V1 staging reused)
  last_scraped_at            TIMESTAMPTZ,
  headline_video_views       BIGINT,
  headline_likes_total       INTEGER,
  headline_comments_total    INTEGER,
  headline_shares_total      INTEGER,
  watched_full_video_rate    NUMERIC(8, 4),
  average_watch_time_seconds NUMERIC(10, 2),
  analytics_new_followers    INTEGER,
  traffic_sources            JSONB,

  -- Perf stats (from tiktok_video_perf_stats — V1 staging reused)
  last_perf_imported_at      TIMESTAMPTZ,
  perf_views                 BIGINT,
  gmv_total                  NUMERIC(18, 2),
  gmv_direct                 NUMERIC(18, 2),
  units_sold                 INTEGER,
  ctr                        NUMERIC(8, 6),
  perf_watch_full_rate       NUMERIC(8, 4),

  -- Sales aggregates (from content_order_facts via video_source_mapping_v2)
  total_realized_gmv         NUMERIC(18, 2),
  total_commission           NUMERIC(18, 2),
  settled_order_count        INTEGER,
  total_order_count          INTEGER,
  sales_product_count        INTEGER,

  -- Coverage flags
  has_studio_data            BOOLEAN     NOT NULL DEFAULT FALSE,
  has_perf_data              BOOLEAN     NOT NULL DEFAULT FALSE,
  has_sales_data             BOOLEAN     NOT NULL DEFAULT FALSE,

  UNIQUE (created_by, canonical_id)
);

CREATE INDEX IF NOT EXISTS idx_voc2_created_by_views
  ON public.video_overview_cache_v2(created_by, headline_video_views DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_voc2_created_by_gmv
  ON public.video_overview_cache_v2(created_by, gmv_total DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_voc2_created_by_posted_at
  ON public.video_overview_cache_v2(created_by, posted_at DESC NULLS LAST);

DROP TRIGGER IF EXISTS trg_video_overview_cache_v2_updated_at ON public.video_overview_cache_v2;
CREATE TRIGGER trg_video_overview_cache_v2_updated_at
  BEFORE UPDATE ON public.video_overview_cache_v2
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.video_overview_cache_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voc2_select ON public.video_overview_cache_v2;
CREATE POLICY voc2_select ON public.video_overview_cache_v2
  FOR SELECT TO authenticated USING (created_by = auth.uid());

DROP POLICY IF EXISTS voc2_insert ON public.video_overview_cache_v2;
CREATE POLICY voc2_insert ON public.video_overview_cache_v2
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS voc2_update ON public.video_overview_cache_v2;
CREATE POLICY voc2_update ON public.video_overview_cache_v2
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS voc2_delete ON public.video_overview_cache_v2;
CREATE POLICY voc2_delete ON public.video_overview_cache_v2
  FOR DELETE TO authenticated USING (created_by = auth.uid());

COMMENT ON TABLE public.video_overview_cache_v2 IS
  'V2 pre-aggregated 1-row-per-video cache. Rebuilt by TypeScript (video-master-v2-sync) after V2 import. '
  'canonical_id references video_master_v2. Engagement/perf data joined from V1 staging tables.';

COMMIT;

-- ============================================================
-- Verify (run manually after migration)
-- ============================================================
-- SELECT
--   (SELECT count(*) FROM video_master_v2)         AS vm2_rows,
--   (SELECT count(*) FROM video_source_mapping_v2) AS vsm2_rows,
--   (SELECT count(*) FROM video_overview_cache_v2) AS voc2_rows;
-- All three should be 0 — tables are empty until V2 import runs.
