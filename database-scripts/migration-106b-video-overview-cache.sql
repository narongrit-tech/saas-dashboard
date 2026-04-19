-- ============================================================
-- Migration 106b: Add video_overview_cache table
-- Run this if migration-106 was already applied (tables + views exist)
-- but video_overview_cache does not exist yet.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) video_overview_cache table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.video_overview_cache (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                 UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  canonical_id               UUID        NOT NULL REFERENCES public.video_master(id) ON DELETE CASCADE,
  tiktok_video_id            TEXT        NOT NULL,
  video_title                TEXT,
  posted_at                  DATE,
  duration_sec               INTEGER,
  post_url                   TEXT,
  content_type               TEXT        NOT NULL DEFAULT 'video',

  -- Studio engagement (latest snapshot)
  last_scraped_at            TIMESTAMPTZ,
  headline_video_views       BIGINT,
  headline_likes_total       INTEGER,
  headline_comments_total    INTEGER,
  headline_shares_total      INTEGER,
  watched_full_video_rate    NUMERIC(8, 4),
  average_watch_time_seconds NUMERIC(10, 2),
  analytics_new_followers    INTEGER,
  traffic_sources            JSONB,

  -- Perf stats (latest import)
  last_perf_imported_at      TIMESTAMPTZ,
  perf_views                 BIGINT,
  gmv_total                  NUMERIC(18, 2),
  gmv_direct                 NUMERIC(18, 2),
  units_sold                 INTEGER,
  ctr                        NUMERIC(8, 6),
  perf_watch_full_rate       NUMERIC(8, 4),

  -- Sales (aggregate across all matched affiliate content_ids)
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

CREATE INDEX IF NOT EXISTS idx_voc_created_by_views
  ON public.video_overview_cache(created_by, headline_video_views DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_voc_created_by_gmv
  ON public.video_overview_cache(created_by, gmv_total DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_voc_created_by_posted_at
  ON public.video_overview_cache(created_by, posted_at DESC NULLS LAST);

DROP TRIGGER IF EXISTS trg_video_overview_cache_updated_at ON public.video_overview_cache;
CREATE TRIGGER trg_video_overview_cache_updated_at
  BEFORE UPDATE ON public.video_overview_cache
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.video_overview_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voc_select ON public.video_overview_cache;
CREATE POLICY voc_select ON public.video_overview_cache
  FOR SELECT TO authenticated USING (created_by = auth.uid());

DROP POLICY IF EXISTS voc_insert ON public.video_overview_cache;
CREATE POLICY voc_insert ON public.video_overview_cache
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS voc_update ON public.video_overview_cache;
CREATE POLICY voc_update ON public.video_overview_cache
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS voc_delete ON public.video_overview_cache;
CREATE POLICY voc_delete ON public.video_overview_cache
  FOR DELETE TO authenticated USING (created_by = auth.uid());

GRANT SELECT ON public.video_overview_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_overview_cache TO service_role;

-- ============================================================
-- 2) Backfill cache from existing views
-- ============================================================

INSERT INTO public.video_overview_cache (
  created_by, canonical_id, tiktok_video_id, video_title, posted_at, duration_sec, post_url, content_type,
  last_scraped_at, headline_video_views, headline_likes_total, headline_comments_total, headline_shares_total,
  watched_full_video_rate, average_watch_time_seconds, analytics_new_followers, traffic_sources,
  last_perf_imported_at, perf_views, gmv_total, gmv_direct, units_sold, ctr, perf_watch_full_rate,
  total_realized_gmv, total_commission, settled_order_count, total_order_count, sales_product_count,
  has_studio_data, has_perf_data, has_sales_data
)
WITH latest_eng AS (
  SELECT DISTINCT ON (canonical_id, created_by)
    canonical_id, created_by, scraped_at,
    headline_video_views, headline_likes_total, headline_comments_total, headline_shares_total,
    watched_full_video_rate, average_watch_time_seconds, analytics_new_followers, traffic_sources
  FROM public.video_engagement_daily
  ORDER BY canonical_id, created_by, scraped_at DESC
),
latest_perf AS (
  SELECT DISTINCT ON (canonical_id, created_by)
    canonical_id, created_by, imported_at,
    views, gmv_total, gmv_direct, units_sold, ctr, watch_full_rate
  FROM public.video_performance_daily
  ORDER BY canonical_id, created_by, imported_at DESC
),
sales_agg AS (
  SELECT
    canonical_id, created_by,
    SUM(gmv)        FILTER (WHERE is_settled) AS total_realized_gmv,
    SUM(commission) FILTER (WHERE is_settled) AS total_commission,
    COUNT(DISTINCT order_id) FILTER (WHERE is_settled) AS settled_order_count,
    COUNT(DISTINCT order_id)                            AS total_order_count,
    COUNT(DISTINCT product_id)                          AS sales_product_count
  FROM public.video_sales_fact
  GROUP BY canonical_id, created_by
)
SELECT
  vm.created_by, vm.id,
  vm.tiktok_video_id, vm.video_title, vm.posted_at, vm.duration_sec, vm.post_url, vm.content_type,
  e.scraped_at,
  e.headline_video_views, e.headline_likes_total, e.headline_comments_total, e.headline_shares_total,
  e.watched_full_video_rate, e.average_watch_time_seconds, e.analytics_new_followers, e.traffic_sources,
  p.imported_at,
  p.views, p.gmv_total, p.gmv_direct, p.units_sold, p.ctr, p.watch_full_rate,
  s.total_realized_gmv, s.total_commission, s.settled_order_count, s.total_order_count, s.sales_product_count,
  (e.canonical_id IS NOT NULL), (p.canonical_id IS NOT NULL), (s.canonical_id IS NOT NULL)
FROM public.video_master vm
LEFT JOIN latest_eng  e ON e.canonical_id = vm.id AND e.created_by = vm.created_by
LEFT JOIN latest_perf p ON p.canonical_id = vm.id AND p.created_by = vm.created_by
LEFT JOIN sales_agg   s ON s.canonical_id = vm.id AND s.created_by = vm.created_by
ON CONFLICT (created_by, canonical_id) DO UPDATE SET
  tiktok_video_id            = EXCLUDED.tiktok_video_id,
  video_title                = EXCLUDED.video_title,
  posted_at                  = EXCLUDED.posted_at,
  duration_sec               = EXCLUDED.duration_sec,
  post_url                   = EXCLUDED.post_url,
  content_type               = EXCLUDED.content_type,
  last_scraped_at            = EXCLUDED.last_scraped_at,
  headline_video_views       = EXCLUDED.headline_video_views,
  headline_likes_total       = EXCLUDED.headline_likes_total,
  headline_comments_total    = EXCLUDED.headline_comments_total,
  headline_shares_total      = EXCLUDED.headline_shares_total,
  watched_full_video_rate    = EXCLUDED.watched_full_video_rate,
  average_watch_time_seconds = EXCLUDED.average_watch_time_seconds,
  analytics_new_followers    = EXCLUDED.analytics_new_followers,
  traffic_sources            = EXCLUDED.traffic_sources,
  last_perf_imported_at      = EXCLUDED.last_perf_imported_at,
  perf_views                 = EXCLUDED.perf_views,
  gmv_total                  = EXCLUDED.gmv_total,
  gmv_direct                 = EXCLUDED.gmv_direct,
  units_sold                 = EXCLUDED.units_sold,
  ctr                        = EXCLUDED.ctr,
  perf_watch_full_rate       = EXCLUDED.perf_watch_full_rate,
  total_realized_gmv         = EXCLUDED.total_realized_gmv,
  total_commission           = EXCLUDED.total_commission,
  settled_order_count        = EXCLUDED.settled_order_count,
  total_order_count          = EXCLUDED.total_order_count,
  sales_product_count        = EXCLUDED.sales_product_count,
  has_studio_data            = EXCLUDED.has_studio_data,
  has_perf_data              = EXCLUDED.has_perf_data,
  has_sales_data             = EXCLUDED.has_sales_data,
  updated_at                 = NOW();

-- ============================================================
-- 3) Drop old video_overview_view if it exists
-- ============================================================

DROP VIEW IF EXISTS public.video_overview_view;

COMMIT;
