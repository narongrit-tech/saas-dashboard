-- ============================================
-- Migration 096: TikTok Content Order Attribution
-- Scope:
--   - module-local attribution transformation on top of public.content_order_facts
--   - deterministic last-touch winner selection at the locked business grain
--   - no changes to existing SaaS sales / finance / wallet / reconciliation tables
--   - no UI objects
-- Notes:
--   - source facts stay in public.content_order_facts
--   - final output is public.content_order_attribution
--   - candidate rows remain queryable for conflict and unknown-status surfacing
-- ============================================

BEGIN;

-- ============================================
-- 1) HELPER FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION public.tiktok_affiliate_resolve_actual_commission(
  p_total_earned_amount NUMERIC,
  p_total_commission_amount NUMERIC
)
RETURNS NUMERIC(18, 2)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ROUND(COALESCE(p_total_earned_amount, p_total_commission_amount, 0), 2)::NUMERIC(18, 2)
$$;

COMMENT ON FUNCTION public.tiktok_affiliate_resolve_actual_commission(NUMERIC, NUMERIC) IS
'Line-level commission resolver for Content Ops. Uses total_earned_amount as the source of truth when present, with total_commission_amount as the deterministic fallback.';

CREATE OR REPLACE FUNCTION public.tiktok_affiliate_rollup_status(p_statuses TEXT[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  WITH distinct_statuses AS (
    SELECT ARRAY(
      SELECT DISTINCT status
      FROM unnest(COALESCE(p_statuses, ARRAY[]::TEXT[])) AS status
      WHERE status IS NOT NULL
      ORDER BY status
    ) AS statuses
  )
  SELECT CASE
    WHEN COALESCE(array_length(statuses, 1), 0) = 0 THEN 'unknown'
    WHEN array_length(statuses, 1) = 1 THEN statuses[1]
    ELSE 'mixed'
  END
  FROM distinct_statuses
$$;

COMMENT ON FUNCTION public.tiktok_affiliate_rollup_status(TEXT[]) IS
'Safe rollup for order_settlement_status when multiple source fact rows collapse into one order-product-content row. Returns mixed instead of coercing conflicting statuses.';

CREATE OR REPLACE FUNCTION public.tiktok_affiliate_map_business_bucket(p_normalized_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_normalized_status
    WHEN 'settled' THEN 'realized'
    WHEN 'pending' THEN 'open'
    WHEN 'awaiting_payment' THEN 'open'
    WHEN 'ineligible' THEN 'lost'
    ELSE 'unknown'
  END
$$;

COMMENT ON FUNCTION public.tiktok_affiliate_map_business_bucket(TEXT) IS
'Content Ops business-bucket mapper. Supported statuses resolve to realized/open/lost; unsupported or mixed statuses surface explicitly as unknown.';

-- ============================================
-- 2) ATTRIBUTION CANDIDATES
-- Grain:
--   1 candidate row per created_by + order_id + product_id + content_id
-- Purpose:
--   collapse normalized line facts across sku_id while preserving content_id
-- ============================================

CREATE OR REPLACE VIEW public.content_order_attribution_candidates
WITH (security_invoker = true) AS
WITH fact_rows AS (
  SELECT
    f.id AS source_fact_id,
    f.created_by,
    f.import_batch_id,
    f.staging_row_id,
    f.updated_at AS source_fact_updated_at,
    f.created_at AS source_fact_created_at,
    COALESCE(s.created_at, f.created_at) AS source_staging_created_at,
    f.source_platform,
    f.order_id,
    f.product_id,
    f.content_id,
    f.sku_id,
    f.content_type,
    f.product_name,
    f.currency,
    f.order_date,
    f.commission_settlement_date,
    f.order_settlement_status AS normalized_status,
    f.order_settlement_status_raw,
    COALESCE(f.gmv, 0)::NUMERIC(18, 2) AS gmv_amount,
    public.tiktok_affiliate_resolve_actual_commission(
      f.total_earned_amount,
      f.total_commission_amount
    ) AS resolved_commission_amount,
    f.total_earned_amount,
    f.total_commission_amount
  FROM public.content_order_facts f
  LEFT JOIN public.tiktok_affiliate_order_raw_staging s
    ON s.id = f.staging_row_id
),
aggregated AS (
  SELECT
    r.created_by,
    MAX(r.source_platform) AS source_platform,
    r.order_id,
    r.product_id,
    r.content_id,
    CASE
      WHEN COUNT(DISTINCT COALESCE(r.content_type, '<<null>>')) = 1 THEN MAX(r.content_type)
      ELSE 'other'
    END AS content_type,
    MAX(r.product_name) AS product_name,
    CASE
      WHEN COUNT(DISTINCT COALESCE(r.currency, '<<null>>')) = 1 THEN MAX(r.currency)
      ELSE 'MIXED'
    END AS currency,
    MIN(r.order_date) AS order_date,
    MAX(r.order_date) AS latest_order_date,
    MAX(r.commission_settlement_date) AS commission_settlement_date,
    public.tiktok_affiliate_rollup_status(
      ARRAY_AGG(r.normalized_status ORDER BY r.normalized_status, r.sku_id, r.source_fact_id)
    ) AS normalized_status,
    ARRAY_AGG(DISTINCT r.normalized_status ORDER BY r.normalized_status) AS normalized_status_values,
    ROUND(COALESCE(SUM(r.gmv_amount), 0), 2) AS gmv,
    ROUND(COALESCE(SUM(r.resolved_commission_amount), 0), 2) AS commission,
    ROUND(COALESCE(SUM(COALESCE(r.total_earned_amount, 0)), 0), 2) AS source_total_earned_amount,
    ROUND(COALESCE(SUM(COALESCE(r.total_commission_amount, 0)), 0), 2) AS source_total_commission_amount,
    COUNT(*)::BIGINT AS source_fact_count,
    COUNT(DISTINCT r.sku_id)::BIGINT AS source_sku_count,
    ARRAY_AGG(DISTINCT r.sku_id ORDER BY r.sku_id)
      FILTER (WHERE r.sku_id IS NOT NULL) AS source_sku_ids,
    ARRAY_AGG(r.source_fact_id ORDER BY r.source_fact_updated_at DESC, r.source_fact_id DESC) AS source_fact_ids,
    ARRAY_AGG(r.staging_row_id ORDER BY r.source_fact_updated_at DESC NULLS LAST, r.staging_row_id DESC)
      FILTER (WHERE r.staging_row_id IS NOT NULL) AS source_staging_row_ids,
    ARRAY_AGG(DISTINCT r.import_batch_id ORDER BY r.import_batch_id)
      FILTER (WHERE r.import_batch_id IS NOT NULL) AS source_import_batch_ids,
    MAX(r.source_fact_updated_at) AS latest_source_fact_updated_at,
    MAX(r.source_fact_created_at) AS latest_source_fact_created_at,
    MAX(r.source_staging_created_at) AS latest_source_staging_created_at
  FROM fact_rows r
  WHERE r.order_id IS NOT NULL
    AND r.product_id IS NOT NULL
    AND r.content_id IS NOT NULL
  GROUP BY r.created_by, r.order_id, r.product_id, r.content_id
)
SELECT
  a.created_by,
  a.source_platform,
  a.order_id,
  a.product_id,
  a.content_id,
  a.content_type,
  a.product_name,
  a.currency,
  a.order_date,
  a.latest_order_date,
  a.commission_settlement_date,
  a.normalized_status,
  a.normalized_status_values,
  public.tiktok_affiliate_map_business_bucket(a.normalized_status) AS business_bucket,
  public.tiktok_affiliate_map_business_bucket(a.normalized_status) = 'realized' AS is_realized,
  public.tiktok_affiliate_map_business_bucket(a.normalized_status) = 'open' AS is_open,
  public.tiktok_affiliate_map_business_bucket(a.normalized_status) = 'lost' AS is_lost,
  a.gmv,
  a.commission,
  a.commission AS actual_commission_total,
  a.source_total_earned_amount,
  a.source_total_commission_amount,
  a.source_fact_count,
  a.source_sku_count,
  a.source_sku_ids,
  a.source_fact_ids,
  a.source_staging_row_ids,
  a.source_import_batch_ids,
  a.latest_source_fact_updated_at,
  a.latest_source_fact_created_at,
  a.latest_source_staging_created_at,
  a.normalized_status NOT IN ('settled', 'pending', 'awaiting_payment', 'ineligible') AS has_unsupported_status,
  a.currency = 'MIXED' AS has_mixed_currency,
  'line_level_coalesce(total_earned_amount, total_commission_amount, 0)'::TEXT AS commission_source_rule
FROM aggregated a;

COMMENT ON VIEW public.content_order_attribution_candidates IS
'Module-local attribution candidates collapsed to one row per created_by + order_id + product_id + content_id. Preserves traceability before final last-touch winner selection.';

-- ============================================
-- 3) FINAL ATTRIBUTION VIEW
-- Grain:
--   1 winner row per created_by + order_id + product_id
-- Business meaning:
--   1 row = 1 order + 1 product + 1 content
-- Resolver:
--   deterministic TikTok last-touch winner selection
-- ============================================

CREATE OR REPLACE VIEW public.content_order_attribution
WITH (security_invoker = true) AS
WITH candidate_sets AS (
  SELECT
    c.created_by,
    c.order_id,
    c.product_id,
    COUNT(*)::BIGINT AS content_candidate_count,
    ARRAY_AGG(
      c.content_id
      ORDER BY
        c.latest_source_fact_updated_at DESC,
        c.latest_source_staging_created_at DESC,
        public.tiktok_affiliate_status_rank(c.normalized_status) DESC,
        (c.commission_settlement_date IS NOT NULL)::INT DESC,
        c.commission_settlement_date DESC NULLS LAST,
        c.content_id DESC
    ) AS competing_content_ids
  FROM public.content_order_attribution_candidates c
  GROUP BY c.created_by, c.order_id, c.product_id
),
ranked AS (
  SELECT
    c.*,
    s.content_candidate_count,
    s.competing_content_ids,
    ROW_NUMBER() OVER (
      PARTITION BY c.created_by, c.order_id, c.product_id
      ORDER BY
        c.latest_source_fact_updated_at DESC,
        c.latest_source_staging_created_at DESC,
        public.tiktok_affiliate_status_rank(c.normalized_status) DESC,
        (c.commission_settlement_date IS NOT NULL)::INT DESC,
        c.commission_settlement_date DESC NULLS LAST,
        c.content_id DESC
    ) AS attribution_rank
  FROM public.content_order_attribution_candidates c
  INNER JOIN candidate_sets s
    ON s.created_by = c.created_by
   AND s.order_id = c.order_id
   AND s.product_id = c.product_id
)
SELECT
  r.created_by,
  r.source_platform,
  r.order_id,
  r.product_id,
  r.content_id,
  r.content_type,
  r.product_name,
  r.currency,
  r.order_date,
  r.latest_order_date,
  r.commission_settlement_date,
  r.normalized_status,
  r.normalized_status_values,
  r.business_bucket,
  r.is_realized,
  r.is_open,
  r.is_lost,
  r.gmv,
  r.commission,
  r.actual_commission_total,
  r.source_total_earned_amount,
  r.source_total_commission_amount,
  r.source_fact_count,
  r.source_sku_count,
  r.source_sku_ids,
  r.source_fact_ids,
  r.source_staging_row_ids,
  r.source_import_batch_ids,
  r.latest_source_fact_updated_at,
  r.latest_source_fact_created_at,
  r.latest_source_staging_created_at,
  r.has_unsupported_status,
  r.has_mixed_currency,
  r.content_candidate_count,
  r.competing_content_ids,
  r.attribution_rank,
  'deterministic_last_touch_v1'::TEXT AS attribution_resolution_rule,
  r.commission_source_rule
FROM ranked r
WHERE r.attribution_rank = 1;

COMMENT ON VIEW public.content_order_attribution IS
'Final module-local attribution output for Content Ops. Grain is exactly one row per created_by + order_id + product_id, with one deterministically selected content_id and explicit business bucket flags.';

COMMIT;
