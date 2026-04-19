-- ============================================
-- Verification: TikTok Content Order Attribution
-- Run after migration-096.
-- Expected result:
--   - duplicate-grain checks return 0 rows
--   - supported-status bucket mismatches return 0 rows
--   - missing-key checks return 0 rows
--   - candidate-to-final reconciliation returns 0 rows
--   - unsupported statuses are surfaced explicitly, not silently dropped
-- ============================================

-- 1) Candidate and final coverage snapshot
SELECT
  'candidates' AS layer,
  COUNT(*) AS row_count,
  ROUND(COALESCE(SUM(gmv), 0), 2) AS gmv_total,
  ROUND(COALESCE(SUM(commission), 0), 2) AS commission_total
FROM public.content_order_attribution_candidates
UNION ALL
SELECT
  'final' AS layer,
  COUNT(*) AS row_count,
  ROUND(COALESCE(SUM(gmv), 0), 2) AS gmv_total,
  ROUND(COALESCE(SUM(commission), 0), 2) AS commission_total
FROM public.content_order_attribution;

-- 2) Final grain duplicate check: one row only per created_by + order_id + product_id
SELECT
  created_by,
  order_id,
  product_id,
  COUNT(*) AS dup_count
FROM public.content_order_attribution
GROUP BY created_by, order_id, product_id
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, created_by, order_id, product_id;

-- 3) Candidate grain duplicate check: one row only per created_by + order_id + product_id + content_id
SELECT
  created_by,
  order_id,
  product_id,
  content_id,
  COUNT(*) AS dup_count
FROM public.content_order_attribution_candidates
GROUP BY created_by, order_id, product_id, content_id
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, created_by, order_id, product_id, content_id;

-- 4) Required-key safety: final rows must keep content_id and product_id
SELECT
  COUNT(*) FILTER (WHERE content_id IS NULL) AS missing_content_id,
  COUNT(*) FILTER (WHERE product_id IS NULL) AS missing_product_id,
  COUNT(*) FILTER (WHERE order_id IS NULL) AS missing_order_id
FROM public.content_order_attribution;

-- 5) Supported-status bucket mapping must always resolve correctly
SELECT
  created_by,
  order_id,
  product_id,
  content_id,
  normalized_status,
  business_bucket
FROM public.content_order_attribution
WHERE normalized_status IN ('settled', 'pending', 'awaiting_payment', 'ineligible')
  AND business_bucket IS DISTINCT FROM CASE normalized_status
    WHEN 'settled' THEN 'realized'
    WHEN 'pending' THEN 'open'
    WHEN 'awaiting_payment' THEN 'open'
    WHEN 'ineligible' THEN 'lost'
  END
ORDER BY created_by, order_id, product_id, content_id;

-- 6) Unsupported or mixed statuses must be visible explicitly in candidates
SELECT
  created_by,
  order_id,
  product_id,
  content_id,
  normalized_status,
  normalized_status_values,
  business_bucket,
  source_fact_count,
  source_fact_ids
FROM public.content_order_attribution_candidates
WHERE has_unsupported_status
ORDER BY latest_source_fact_updated_at DESC, created_by, order_id, product_id, content_id
LIMIT 50;

-- 7) Deterministic no-split surface: rows that had more than one candidate content_id
SELECT
  created_by,
  order_id,
  product_id,
  content_id AS winner_content_id,
  content_candidate_count,
  competing_content_ids,
  attribution_resolution_rule,
  latest_source_fact_updated_at
FROM public.content_order_attribution
WHERE content_candidate_count > 1
ORDER BY latest_source_fact_updated_at DESC, created_by, order_id, product_id
LIMIT 50;

-- 8) Candidate aggregation reconciliation back to content_order_facts
WITH expected AS (
  SELECT
    f.created_by,
    f.order_id,
    f.product_id,
    f.content_id,
    ROUND(COALESCE(SUM(COALESCE(f.gmv, 0)), 0), 2) AS expected_gmv,
    ROUND(
      COALESCE(
        SUM(
          public.tiktok_affiliate_resolve_actual_commission(
            f.total_earned_amount,
            f.total_commission_amount
          )
        ),
        0
      ),
      2
    ) AS expected_commission,
    COUNT(*)::BIGINT AS expected_fact_count
  FROM public.content_order_facts f
  WHERE f.order_id IS NOT NULL
    AND f.product_id IS NOT NULL
    AND f.content_id IS NOT NULL
  GROUP BY f.created_by, f.order_id, f.product_id, f.content_id
)
SELECT
  COALESCE(e.created_by, c.created_by) AS created_by,
  COALESCE(e.order_id, c.order_id) AS order_id,
  COALESCE(e.product_id, c.product_id) AS product_id,
  COALESCE(e.content_id, c.content_id) AS content_id,
  e.expected_gmv,
  c.gmv AS actual_gmv,
  e.expected_commission,
  c.commission AS actual_commission,
  e.expected_fact_count,
  c.source_fact_count AS actual_fact_count
FROM expected e
FULL OUTER JOIN public.content_order_attribution_candidates c
  ON c.created_by = e.created_by
 AND c.order_id = e.order_id
 AND c.product_id = e.product_id
 AND c.content_id = e.content_id
WHERE c.created_by IS NULL
   OR e.created_by IS NULL
   OR c.gmv IS DISTINCT FROM e.expected_gmv
   OR c.commission IS DISTINCT FROM e.expected_commission
   OR c.source_fact_count IS DISTINCT FROM e.expected_fact_count
ORDER BY created_by, order_id, product_id, content_id
LIMIT 50;

-- 9) Final winner reconciliation: final view must match rank-1 candidates exactly
WITH candidate_sets AS (
  SELECT
    c.created_by,
    c.order_id,
    c.product_id,
    COUNT(*)::BIGINT AS content_candidate_count
  FROM public.content_order_attribution_candidates c
  GROUP BY c.created_by, c.order_id, c.product_id
),
ranked AS (
  SELECT
    c.created_by,
    c.order_id,
    c.product_id,
    c.content_id,
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
  COALESCE(r.created_by, f.created_by) AS created_by,
  COALESCE(r.order_id, f.order_id) AS order_id,
  COALESCE(r.product_id, f.product_id) AS product_id,
  r.content_id AS expected_content_id,
  f.content_id AS final_content_id
FROM ranked r
FULL OUTER JOIN public.content_order_attribution f
  ON f.created_by = r.created_by
 AND f.order_id = r.order_id
 AND f.product_id = r.product_id
WHERE (r.attribution_rank = 1 OR r.created_by IS NULL)
  AND (
    f.created_by IS NULL
    OR r.created_by IS NULL
    OR f.content_id IS DISTINCT FROM r.content_id
  )
ORDER BY created_by, order_id, product_id
LIMIT 50;

-- 10) Sample final rows for spot-checking traceability
SELECT
  created_by,
  order_id,
  product_id,
  content_id,
  normalized_status,
  business_bucket,
  is_realized,
  is_open,
  is_lost,
  gmv,
  commission,
  source_fact_count,
  source_sku_ids,
  source_import_batch_ids
FROM public.content_order_attribution
ORDER BY latest_source_fact_updated_at DESC, created_by, order_id, product_id
LIMIT 50;
