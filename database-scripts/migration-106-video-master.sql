-- ============================================================
-- Migration 106: Video Master System
-- Scope:
--   video_master          — canonical registry (1 row per TikTok video per user)
--   video_source_mapping  — cross-source audit trail (stage 1/2/3 matching)
--   video_engagement_daily (VIEW) — studio analytics joined to canonical video
--   video_performance_daily (VIEW) — perf stats joined to canonical video
--   video_sales_fact (VIEW)        — affiliate orders joined via source mapping
--   video_perf_products (VIEW)     — sales grouped by (canonical_id, product_id)
--   video_overview_view (VIEW)     — unified row per video (all metrics)
--
-- Design:
--   - All existing tables untouched (append-only, raw data preserved)
--   - Views derive data from existing tables + new mapping
--   - Backfill runs as part of migration (no re-upload required)
--   - ID equivalence: studio.post_id = perf.video_id_raw = affiliate.content_id (for video type)
--
-- Does NOT touch: finance, sales_orders, wallet, reconciliation, P&L
-- ============================================================

BEGIN;

-- ============================================================
-- 1) video_master — canonical video registry
-- ============================================================

CREATE TABLE IF NOT EXISTS public.video_master (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Canonical TikTok identity
  tiktok_video_id   TEXT        NOT NULL,
  content_type      TEXT        NOT NULL DEFAULT 'video'
    CHECK (content_type IN ('video', 'live', 'showcase', 'unknown')),

  -- Best-available metadata (from most recent authoritative source)
  video_title       TEXT,
  posted_at         DATE,
  duration_sec      INTEGER,
  post_url          TEXT,
  title_source      TEXT,   -- 'studio_analytics' | 'perf_stats' | 'manual'

  UNIQUE (created_by, tiktok_video_id)
);

CREATE INDEX IF NOT EXISTS idx_vm_created_by_video_id
  ON public.video_master(created_by, tiktok_video_id);

CREATE INDEX IF NOT EXISTS idx_vm_created_by_posted_at
  ON public.video_master(created_by, posted_at DESC);

CREATE TRIGGER trg_video_master_updated_at
  BEFORE UPDATE ON public.video_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.video_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vm_select ON public.video_master;
CREATE POLICY vm_select ON public.video_master
  FOR SELECT TO authenticated USING (created_by = auth.uid());

DROP POLICY IF EXISTS vm_insert ON public.video_master;
CREATE POLICY vm_insert ON public.video_master
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS vm_update ON public.video_master;
CREATE POLICY vm_update ON public.video_master
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS vm_delete ON public.video_master;
CREATE POLICY vm_delete ON public.video_master
  FOR DELETE TO authenticated USING (created_by = auth.uid());

COMMENT ON TABLE public.video_master IS
  'Canonical video registry. One row per TikTok video per user. '
  'All video analytics views are rooted here. tiktok_video_id is the stable join key.';

-- ============================================================
-- 2) video_source_mapping — cross-source audit trail
-- ============================================================

CREATE TABLE IF NOT EXISTS public.video_source_mapping (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Source identity
  source_type         TEXT        NOT NULL
    CHECK (source_type IN ('studio_analytics', 'perf_stats', 'affiliate')),
  external_id         TEXT        NOT NULL,   -- post_id | video_id_raw | content_id

  -- Canonical resolution
  canonical_id        UUID        REFERENCES public.video_master(id) ON DELETE SET NULL,
  match_stage         INTEGER     CHECK (match_stage IN (1, 2, 3)),
  confidence_score    NUMERIC(5,4) CHECK (confidence_score BETWEEN 0 AND 1),
  match_status        TEXT        NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('matched', 'unmatched', 'needs_review', 'conflict')),
  match_reason        TEXT,

  -- Latest representative row (for UI display)
  latest_source_table TEXT,
  latest_source_row_id UUID,
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Human review
  reviewed_at         TIMESTAMPTZ,
  reviewed_by         UUID        REFERENCES auth.users(id),

  UNIQUE (created_by, source_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_vsm_created_by_type
  ON public.video_source_mapping(created_by, source_type);

CREATE INDEX IF NOT EXISTS idx_vsm_canonical_id
  ON public.video_source_mapping(canonical_id);

CREATE INDEX IF NOT EXISTS idx_vsm_status
  ON public.video_source_mapping(created_by, match_status);

CREATE INDEX IF NOT EXISTS idx_vsm_external_id
  ON public.video_source_mapping(created_by, external_id);

CREATE TRIGGER trg_video_source_mapping_updated_at
  BEFORE UPDATE ON public.video_source_mapping
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.video_source_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vsm_select ON public.video_source_mapping;
CREATE POLICY vsm_select ON public.video_source_mapping
  FOR SELECT TO authenticated USING (created_by = auth.uid());

DROP POLICY IF EXISTS vsm_insert ON public.video_source_mapping;
CREATE POLICY vsm_insert ON public.video_source_mapping
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS vsm_update ON public.video_source_mapping;
CREATE POLICY vsm_update ON public.video_source_mapping
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS vsm_delete ON public.video_source_mapping;
CREATE POLICY vsm_delete ON public.video_source_mapping
  FOR DELETE TO authenticated USING (created_by = auth.uid());

COMMENT ON TABLE public.video_source_mapping IS
  'Cross-source matching audit trail. One row per (user, source_type, external_id). '
  'Tracks which stage matched the source ID to a canonical video and at what confidence.';

-- ============================================================
-- 3) video_overview_cache — pre-aggregated per-video row (replaces heavy view)
-- ============================================================
-- Rebuilt by TypeScript after each import sync. Eliminates nested CTE view query.

CREATE TABLE IF NOT EXISTS public.video_overview_cache (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                 UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Video identity (mirrors video_master)
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

  -- Coverage flags (drives "Both/Studio/Perf/Sales" badge)
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

COMMENT ON TABLE public.video_overview_cache IS
  'Pre-aggregated 1-row-per-video cache. Rebuilt by TypeScript (video-master-sync) after each import. '
  'Replaces the nested-CTE video_overview_view to eliminate statement timeouts.';

-- ============================================================
-- 4) BACKFILL existing data → video_master + video_source_mapping
-- ============================================================

-- 3a: Seed from studio analytics (post_id = tiktok_video_id, stage 1)
INSERT INTO public.video_master (
  created_by, tiktok_video_id, video_title, posted_at, post_url,
  title_source, created_at
)
SELECT DISTINCT ON (created_by, post_id)
  created_by,
  post_id,
  video_title,
  posted_at,
  post_url,
  'studio_analytics',
  created_at
FROM public.tiktok_studio_analytics_rows
WHERE post_id IS NOT NULL AND post_id <> ''
ORDER BY created_by, post_id, scraped_at DESC
ON CONFLICT (created_by, tiktok_video_id) DO UPDATE SET
  video_title  = COALESCE(EXCLUDED.video_title, video_master.video_title),
  posted_at    = COALESCE(EXCLUDED.posted_at, video_master.posted_at),
  post_url     = COALESCE(EXCLUDED.post_url, video_master.post_url),
  title_source = CASE
    WHEN EXCLUDED.video_title IS NOT NULL THEN 'studio_analytics'
    ELSE video_master.title_source
  END,
  updated_at = NOW();

-- 3b: Seed from perf stats (video_id_raw = tiktok_video_id, stage 1)
--     Studio analytics title takes precedence (COALESCE keeps existing)
INSERT INTO public.video_master (
  created_by, tiktok_video_id, video_title, posted_at, duration_sec,
  title_source, created_at
)
SELECT DISTINCT ON (created_by, video_id_raw)
  created_by,
  video_id_raw,
  video_title,
  posted_at::DATE,
  duration_sec,
  'perf_stats',
  created_at
FROM public.tiktok_video_perf_stats
WHERE video_id_raw IS NOT NULL AND video_id_raw <> ''
ORDER BY created_by, video_id_raw, created_at DESC
ON CONFLICT (created_by, tiktok_video_id) DO UPDATE SET
  -- Studio title takes precedence; fill gaps from perf stats
  video_title  = COALESCE(video_master.video_title, EXCLUDED.video_title),
  posted_at    = COALESCE(video_master.posted_at, EXCLUDED.posted_at),
  duration_sec = COALESCE(video_master.duration_sec, EXCLUDED.duration_sec),
  updated_at   = NOW();

-- 3c: Source mappings — studio analytics
INSERT INTO public.video_source_mapping (
  created_by, source_type, external_id, canonical_id,
  match_stage, confidence_score, match_status, match_reason,
  latest_source_table, last_seen_at
)
SELECT DISTINCT ON (tsar.created_by, tsar.post_id)
  tsar.created_by,
  'studio_analytics',
  tsar.post_id,
  vm.id,
  1,
  1.0000,
  'matched',
  'backfill:stage1:post_id=tiktok_video_id',
  'tiktok_studio_analytics_rows',
  tsar.scraped_at
FROM public.tiktok_studio_analytics_rows tsar
JOIN public.video_master vm
  ON vm.created_by = tsar.created_by AND vm.tiktok_video_id = tsar.post_id
WHERE tsar.post_id IS NOT NULL AND tsar.post_id <> ''
ORDER BY tsar.created_by, tsar.post_id, tsar.scraped_at DESC
ON CONFLICT (created_by, source_type, external_id) DO UPDATE SET
  canonical_id    = EXCLUDED.canonical_id,
  match_status    = EXCLUDED.match_status,
  last_seen_at    = EXCLUDED.last_seen_at,
  updated_at      = NOW();

-- 3d: Source mappings — perf stats
INSERT INTO public.video_source_mapping (
  created_by, source_type, external_id, canonical_id,
  match_stage, confidence_score, match_status, match_reason,
  latest_source_table, last_seen_at
)
SELECT DISTINCT ON (tvps.created_by, tvps.video_id_raw)
  tvps.created_by,
  'perf_stats',
  tvps.video_id_raw,
  vm.id,
  1,
  1.0000,
  'matched',
  'backfill:stage1:video_id_raw=tiktok_video_id',
  'tiktok_video_perf_stats',
  tvps.created_at
FROM public.tiktok_video_perf_stats tvps
JOIN public.video_master vm
  ON vm.created_by = tvps.created_by AND vm.tiktok_video_id = tvps.video_id_raw
WHERE tvps.video_id_raw IS NOT NULL AND tvps.video_id_raw <> ''
ORDER BY tvps.created_by, tvps.video_id_raw, tvps.created_at DESC
ON CONFLICT (created_by, source_type, external_id) DO UPDATE SET
  canonical_id = EXCLUDED.canonical_id,
  match_status = EXCLUDED.match_status,
  last_seen_at = EXCLUDED.last_seen_at,
  updated_at   = NOW();

-- 3e: Source mappings — affiliate (stage 1: content_id = tiktok_video_id for video type)
INSERT INTO public.video_source_mapping (
  created_by, source_type, external_id, canonical_id,
  match_stage, confidence_score, match_status, match_reason,
  latest_source_table, last_seen_at
)
SELECT DISTINCT ON (cof.created_by, cof.content_id)
  cof.created_by,
  'affiliate',
  cof.content_id,
  vm.id,
  1,
  1.0000,
  'matched',
  'backfill:stage1:content_id=tiktok_video_id',
  'content_order_facts',
  MAX(cof.created_at) OVER (PARTITION BY cof.created_by, cof.content_id)
FROM public.content_order_facts cof
JOIN public.video_master vm
  ON vm.created_by = cof.created_by AND vm.tiktok_video_id = cof.content_id
WHERE cof.content_id IS NOT NULL AND cof.content_id <> ''
ORDER BY cof.created_by, cof.content_id, cof.created_at DESC
ON CONFLICT (created_by, source_type, external_id) DO UPDATE SET
  canonical_id = EXCLUDED.canonical_id,
  match_status = EXCLUDED.match_status,
  last_seen_at = EXCLUDED.last_seen_at,
  updated_at   = NOW();

-- 3f: Unmatched affiliate content_ids (no video in video_master for this content_id)
INSERT INTO public.video_source_mapping (
  created_by, source_type, external_id, canonical_id,
  match_stage, confidence_score, match_status, match_reason,
  latest_source_table, last_seen_at
)
SELECT DISTINCT ON (cof.created_by, cof.content_id)
  cof.created_by,
  'affiliate',
  cof.content_id,
  NULL,
  NULL,
  NULL,
  'unmatched',
  'backfill:no_video_master_row',
  'content_order_facts',
  MAX(cof.created_at) OVER (PARTITION BY cof.created_by, cof.content_id)
FROM public.content_order_facts cof
LEFT JOIN public.video_master vm
  ON vm.created_by = cof.created_by AND vm.tiktok_video_id = cof.content_id
WHERE cof.content_id IS NOT NULL
  AND cof.content_id <> ''
  AND vm.id IS NULL
ORDER BY cof.created_by, cof.content_id, cof.created_at DESC
ON CONFLICT (created_by, source_type, external_id) DO NOTHING;

-- ============================================================
-- 4) VIEWS
-- ============================================================

-- 4a: video_engagement_daily — studio analytics joined to canonical video
CREATE OR REPLACE VIEW public.video_engagement_daily AS
SELECT
  vm.id              AS canonical_id,
  vm.created_by,
  tsar.scraped_at    AS scraped_at,
  tsar.scraped_at::DATE AS snapshot_date,
  tsar.headline_video_views,
  tsar.headline_likes_total,
  tsar.headline_comments_total,
  tsar.headline_shares_total,
  tsar.headline_saves_total,
  tsar.total_play_time_seconds,
  tsar.average_watch_time_seconds,
  tsar.watched_full_video_rate,
  tsar.new_followers  AS analytics_new_followers,
  tsar.traffic_sources
FROM public.video_master vm
JOIN public.tiktok_studio_analytics_rows tsar
  ON tsar.post_id    = vm.tiktok_video_id
 AND tsar.created_by = vm.created_by;

COMMENT ON VIEW public.video_engagement_daily IS
  'All studio analytics snapshots joined to canonical video. '
  'Multiple rows per video (one per scrape). Use DISTINCT ON scraped_at DESC for latest.';

-- 4b: video_performance_daily — perf stats joined to canonical video
CREATE OR REPLACE VIEW public.video_performance_daily AS
SELECT
  vm.id              AS canonical_id,
  vm.created_by,
  tvps.created_at    AS imported_at,
  tvps.created_at::DATE AS import_date,
  tvps.views,
  tvps.gmv_total,
  tvps.gmv_direct,
  tvps.units_sold,
  tvps.ctr,
  tvps.watch_full_rate,
  tvps.new_followers AS perf_new_followers,
  tvps.duration_sec,
  tvps.source_file
FROM public.video_master vm
JOIN public.tiktok_video_perf_stats tvps
  ON tvps.video_id_raw = vm.tiktok_video_id
 AND tvps.created_by   = vm.created_by;

COMMENT ON VIEW public.video_performance_daily IS
  'All perf stat imports joined to canonical video. '
  'Multiple rows per video (one per xlsx import). Use ORDER BY imported_at DESC LIMIT 1 for latest.';

-- 4c: video_sales_fact — affiliate facts joined via source mapping (matched only)
CREATE OR REPLACE VIEW public.video_sales_fact AS
SELECT
  vm.id              AS canonical_id,
  vsm.created_by,
  cof.content_id,
  cof.order_id,
  cof.product_id,
  cof.sku_id,
  cof.gmv,
  cof.total_commission_amount AS commission,
  cof.order_settlement_status,
  (cof.order_settlement_status = 'settled') AS is_settled,
  cof.order_date
FROM public.content_order_facts cof
JOIN public.video_source_mapping vsm
  ON vsm.source_type  = 'affiliate'
 AND vsm.external_id  = cof.content_id
 AND vsm.created_by   = cof.created_by
 AND vsm.match_status = 'matched'
JOIN public.video_master vm
  ON vm.id = vsm.canonical_id;

COMMENT ON VIEW public.video_sales_fact IS
  'Affiliate order facts joined to canonical video via video_source_mapping. '
  'Only matched rows included. Grain: (canonical_id, order_id, product_id, sku_id).';

-- 4d: video_perf_products — sales aggregated by (canonical_id, product_id)
CREATE OR REPLACE VIEW public.video_perf_products AS
SELECT
  vsf.canonical_id,
  vsf.created_by,
  vsf.product_id,
  COUNT(DISTINCT vsf.order_id)                                       AS order_count,
  COUNT(DISTINCT vsf.order_id) FILTER (WHERE vsf.is_settled)        AS settled_order_count,
  SUM(vsf.gmv)                                                       AS total_gmv,
  SUM(vsf.gmv)        FILTER (WHERE vsf.is_settled)                  AS realized_gmv,
  SUM(vsf.commission)                                                AS total_commission,
  SUM(vsf.commission) FILTER (WHERE vsf.is_settled)                  AS realized_commission
FROM public.video_sales_fact vsf
GROUP BY vsf.canonical_id, vsf.created_by, vsf.product_id;

COMMENT ON VIEW public.video_perf_products IS
  'Sales aggregated per (canonical video, product). Useful for video detail pages.';

-- 5g: Backfill video_overview_cache from views created above
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
-- 6) GRANTs (views need explicit grants for PostgREST; cache table uses RLS)
-- ============================================================

GRANT SELECT ON public.video_engagement_daily   TO authenticated, service_role;
GRANT SELECT ON public.video_performance_daily  TO authenticated, service_role;
GRANT SELECT ON public.video_sales_fact         TO authenticated, service_role;
GRANT SELECT ON public.video_perf_products      TO authenticated, service_role;
-- video_overview_cache: authenticated users read via RLS; service_role writes bypass RLS
GRANT SELECT ON public.video_overview_cache     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_overview_cache TO service_role;

COMMIT;
