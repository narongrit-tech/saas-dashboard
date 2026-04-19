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
-- 3) BACKFILL existing data → video_master + video_source_mapping
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

-- 4e: video_overview_view — 1 row per canonical video, all latest metrics
CREATE OR REPLACE VIEW public.video_overview_view AS
WITH latest_eng AS (
  SELECT DISTINCT ON (canonical_id, created_by)
    canonical_id, created_by, snapshot_date, scraped_at,
    headline_video_views, headline_likes_total, headline_comments_total,
    headline_shares_total, watched_full_video_rate, average_watch_time_seconds,
    analytics_new_followers, traffic_sources
  FROM public.video_engagement_daily
  ORDER BY canonical_id, created_by, scraped_at DESC
),
latest_perf AS (
  SELECT DISTINCT ON (canonical_id, created_by)
    canonical_id, created_by, import_date, imported_at,
    views, gmv_total, gmv_direct, units_sold, ctr, watch_full_rate,
    perf_new_followers, duration_sec
  FROM public.video_performance_daily
  ORDER BY canonical_id, created_by, imported_at DESC
),
sales_agg AS (
  SELECT
    canonical_id,
    created_by,
    SUM(gmv)        FILTER (WHERE is_settled)             AS total_realized_gmv,
    SUM(commission) FILTER (WHERE is_settled)             AS total_commission,
    COUNT(DISTINCT order_id) FILTER (WHERE is_settled)    AS settled_order_count,
    COUNT(DISTINCT order_id)                              AS total_order_count,
    COUNT(DISTINCT product_id)                            AS sales_product_count
  FROM public.video_sales_fact
  GROUP BY canonical_id, created_by
)
SELECT
  vm.id,
  vm.created_by,
  vm.tiktok_video_id,
  vm.video_title,
  vm.posted_at,
  vm.duration_sec,
  vm.post_url,
  vm.content_type,
  vm.created_at,
  -- Studio engagement (latest snapshot)
  e.snapshot_date            AS last_scraped_date,
  e.scraped_at               AS last_scraped_at,
  e.headline_video_views,
  e.headline_likes_total,
  e.headline_comments_total,
  e.headline_shares_total,
  e.watched_full_video_rate,
  e.average_watch_time_seconds,
  e.analytics_new_followers,
  e.traffic_sources,
  -- Perf stats (latest import)
  p.import_date              AS last_perf_date,
  p.imported_at              AS last_perf_imported_at,
  p.views                    AS perf_views,
  p.gmv_total,
  p.gmv_direct,
  p.units_sold,
  p.ctr,
  p.watch_full_rate          AS perf_watch_full_rate,
  p.perf_new_followers,
  -- Sales (aggregate)
  s.total_realized_gmv,
  s.total_commission,
  s.settled_order_count,
  s.total_order_count,
  s.sales_product_count,
  -- Coverage flags
  (e.canonical_id IS NOT NULL) AS has_studio_data,
  (p.canonical_id IS NOT NULL) AS has_perf_data,
  (s.canonical_id IS NOT NULL) AS has_sales_data
FROM public.video_master vm
LEFT JOIN latest_eng  e ON e.canonical_id = vm.id AND e.created_by = vm.created_by
LEFT JOIN latest_perf p ON p.canonical_id = vm.id AND p.created_by = vm.created_by
LEFT JOIN sales_agg   s ON s.canonical_id = vm.id AND s.created_by = vm.created_by;

COMMENT ON VIEW public.video_overview_view IS
  'Unified video row with latest engagement, latest perf stats, and aggregated sales. '
  'Use this view for the main video overview page. Filter by created_by for RLS compliance.';

-- ============================================================
-- 5) GRANTs on views (required for PostgREST access)
-- ============================================================

GRANT SELECT ON public.video_engagement_daily   TO authenticated, service_role;
GRANT SELECT ON public.video_performance_daily  TO authenticated, service_role;
GRANT SELECT ON public.video_sales_fact         TO authenticated, service_role;
GRANT SELECT ON public.video_perf_products      TO authenticated, service_role;
GRANT SELECT ON public.video_overview_view      TO authenticated, service_role;

COMMIT;
