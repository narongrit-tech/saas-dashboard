-- ============================================
-- Migration 105: TikTok Studio Analytics Staging + Combined View
-- Scope:
--   tiktok_studio_analytics_batches — batch-level tracking per JSON snapshot file
--   tiktok_studio_analytics_rows    — per-video analytics rows (lifetime stats at scrape time)
--   tiktok_video_combined_stats     — view joining analytics rows + video perf stats by video_id
--
-- Notes:
--   - Source: studio-analytics-*.analytics-rows.json (TikTok Studio web scrape)
--   - Join key: tiktok_studio_analytics_rows.post_id = tiktok_video_perf_stats.video_id_raw
--   - Multiple snapshots per video_id are stored — the view uses the latest per video.
--   - watched_full_video_rate stored as 0–1 decimal (raw input ÷ 100).
--   - Does NOT touch finance, wallet, reconciliation, or affiliate orders.
-- ============================================

BEGIN;

-- ============================================
-- 1) IMPORT BATCH TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS public.tiktok_studio_analytics_batches (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  snapshot_id       TEXT,
  source_file_name  TEXT        NOT NULL,
  source_file_hash  TEXT,
  scraped_at        TIMESTAMPTZ,

  status            TEXT        NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'staged', 'failed')),

  raw_row_count     INTEGER     NOT NULL DEFAULT 0 CHECK (raw_row_count >= 0),
  staged_row_count  INTEGER     NOT NULL DEFAULT 0 CHECK (staged_row_count >= 0),
  invalid_row_count INTEGER     NOT NULL DEFAULT 0 CHECK (invalid_row_count >= 0),

  notes             TEXT,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tsab_created_by_date
  ON public.tiktok_studio_analytics_batches(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tsab_status
  ON public.tiktok_studio_analytics_batches(created_by, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tsab_file_hash
  ON public.tiktok_studio_analytics_batches(created_by, source_file_hash, created_at DESC)
  WHERE source_file_hash IS NOT NULL;

CREATE TRIGGER trg_tiktok_studio_analytics_batches_updated_at
  BEFORE UPDATE ON public.tiktok_studio_analytics_batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.tiktok_studio_analytics_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tsab_select ON public.tiktok_studio_analytics_batches;
CREATE POLICY tsab_select ON public.tiktok_studio_analytics_batches
  FOR SELECT TO authenticated USING (created_by = auth.uid());

DROP POLICY IF EXISTS tsab_insert ON public.tiktok_studio_analytics_batches;
CREATE POLICY tsab_insert ON public.tiktok_studio_analytics_batches
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tsab_update ON public.tiktok_studio_analytics_batches;
CREATE POLICY tsab_update ON public.tiktok_studio_analytics_batches
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tsab_delete ON public.tiktok_studio_analytics_batches;
CREATE POLICY tsab_delete ON public.tiktok_studio_analytics_batches
  FOR DELETE TO authenticated USING (created_by = auth.uid());

COMMENT ON TABLE public.tiktok_studio_analytics_batches IS
  'Batch-level tracking for TikTok Studio analytics JSON snapshot imports. One row per uploaded file.';

-- ============================================
-- 2) PER-VIDEO ANALYTICS ROWS
-- ============================================

CREATE TABLE IF NOT EXISTS public.tiktok_studio_analytics_rows (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                 UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_batch_id            UUID        NOT NULL
    REFERENCES public.tiktok_studio_analytics_batches(id) ON DELETE CASCADE,

  -- Snapshot identity
  snapshot_id                TEXT        NOT NULL,
  scraped_at                 TIMESTAMPTZ NOT NULL,

  -- Video identity
  post_id                    TEXT        NOT NULL,
  post_url                   TEXT,

  -- Content
  video_title                TEXT,
  caption                    TEXT,
  posted_at_raw              TEXT,
  posted_at                  DATE,
  updated_at_raw             TEXT,
  updated_at                 DATE,

  -- Views & engagement (lifetime totals at scrape time)
  headline_video_views       BIGINT      CHECK (headline_video_views >= 0),
  headline_likes_total       INTEGER     CHECK (headline_likes_total >= 0),
  headline_comments_total    INTEGER     CHECK (headline_comments_total >= 0),
  headline_shares_total      INTEGER     CHECK (headline_shares_total >= 0),
  headline_saves_total       INTEGER     CHECK (headline_saves_total >= 0),

  -- Watch metrics
  total_play_time_seconds    BIGINT      CHECK (total_play_time_seconds >= 0),
  average_watch_time_seconds NUMERIC(10, 2),
  watched_full_video_rate    NUMERIC(8, 4),  -- 0–1 decimal (raw % ÷ 100)

  -- Creator metrics
  new_followers              INTEGER,
  est_rewards_amount         NUMERIC(18, 2),
  retention_rate_note        TEXT,

  -- Traffic breakdown
  traffic_sources            JSONB,

  -- Audit
  raw_payload                JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source_row_number          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tsar_import_batch_id
  ON public.tiktok_studio_analytics_rows(import_batch_id);

CREATE INDEX IF NOT EXISTS idx_tsar_created_by
  ON public.tiktok_studio_analytics_rows(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tsar_post_id
  ON public.tiktok_studio_analytics_rows(created_by, post_id);

CREATE INDEX IF NOT EXISTS idx_tsar_scraped_at
  ON public.tiktok_studio_analytics_rows(created_by, scraped_at DESC);

ALTER TABLE public.tiktok_studio_analytics_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tsar_select ON public.tiktok_studio_analytics_rows;
CREATE POLICY tsar_select ON public.tiktok_studio_analytics_rows
  FOR SELECT TO authenticated USING (created_by = auth.uid());

DROP POLICY IF EXISTS tsar_insert ON public.tiktok_studio_analytics_rows;
CREATE POLICY tsar_insert ON public.tiktok_studio_analytics_rows
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tsar_update ON public.tiktok_studio_analytics_rows;
CREATE POLICY tsar_update ON public.tiktok_studio_analytics_rows
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tsar_delete ON public.tiktok_studio_analytics_rows;
CREATE POLICY tsar_delete ON public.tiktok_studio_analytics_rows
  FOR DELETE TO authenticated USING (created_by = auth.uid());

COMMENT ON TABLE public.tiktok_studio_analytics_rows IS
  'Per-video analytics rows scraped from TikTok Studio. Lifetime stats at scrape time. Multiple snapshots per post_id are kept.';
COMMENT ON COLUMN public.tiktok_studio_analytics_rows.post_id IS
  'TikTok video ID. Join key: post_id = tiktok_video_perf_stats.video_id_raw.';
COMMENT ON COLUMN public.tiktok_studio_analytics_rows.watched_full_video_rate IS
  'Watch-full rate as 0–1 decimal. Raw scrape value is a percentage — divided by 100 on import.';

-- ============================================
-- 3) COMBINED VIEW
-- Joins latest analytics snapshot per video with latest perf stats per video.
-- Uses DISTINCT ON for "latest per (post_id, created_by)".
-- ============================================

CREATE OR REPLACE VIEW public.tiktok_video_combined_stats AS
WITH latest_analytics AS (
  SELECT DISTINCT ON (post_id, created_by)
    post_id,
    created_by,
    snapshot_id,
    scraped_at,
    post_url,
    video_title                AS analytics_title,
    caption,
    posted_at                  AS analytics_posted_at,
    headline_video_views,
    headline_likes_total,
    headline_comments_total,
    headline_shares_total,
    headline_saves_total,
    total_play_time_seconds,
    average_watch_time_seconds,
    watched_full_video_rate,
    new_followers              AS analytics_new_followers,
    est_rewards_amount,
    traffic_sources
  FROM public.tiktok_studio_analytics_rows
  ORDER BY post_id, created_by, scraped_at DESC
),
latest_perf AS (
  SELECT DISTINCT ON (video_id_raw, created_by)
    video_id_raw,
    created_by,
    video_title                AS perf_title,
    posted_at                  AS perf_posted_at,
    duration_sec,
    gmv_total,
    gmv_direct,
    views                      AS perf_views,
    units_sold,
    ctr,
    watch_full_rate            AS perf_watch_full_rate,
    new_followers              AS perf_new_followers,
    source_file
  FROM public.tiktok_video_perf_stats
  ORDER BY video_id_raw, created_by, created_at DESC
)
SELECT
  COALESCE(a.post_id, p.video_id_raw)                       AS video_id,
  COALESCE(a.created_by, p.created_by)                      AS created_by,
  COALESCE(a.analytics_title, p.perf_title)                 AS video_title,
  COALESCE(a.analytics_posted_at, p.perf_posted_at::DATE)   AS posted_at,
  a.post_url,
  a.caption,
  -- Analytics side (lifetime at last scrape)
  a.snapshot_id,
  a.scraped_at,
  a.headline_video_views,
  a.headline_likes_total,
  a.headline_comments_total,
  a.headline_shares_total,
  a.headline_saves_total,
  a.total_play_time_seconds,
  a.average_watch_time_seconds,
  a.watched_full_video_rate,
  a.analytics_new_followers,
  a.est_rewards_amount,
  a.traffic_sources,
  -- Perf side (latest rolling window)
  p.duration_sec,
  p.gmv_total,
  p.gmv_direct,
  p.perf_views,
  p.units_sold,
  p.ctr,
  p.perf_watch_full_rate,
  p.perf_new_followers,
  p.source_file                                             AS perf_source_file
FROM latest_analytics a
FULL OUTER JOIN latest_perf p
  ON  a.post_id    = p.video_id_raw
  AND a.created_by = p.created_by;

COMMENT ON VIEW public.tiktok_video_combined_stats IS
  'Latest analytics snapshot per video joined with latest perf stats per video. '
  'video_id links tiktok_studio_analytics_rows.post_id to tiktok_video_perf_stats.video_id_raw.';

COMMIT;
