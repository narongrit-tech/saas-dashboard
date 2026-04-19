-- ============================================
-- Verification: TikTok Affiliate Content Profit Layer
-- Run after migration-097 and a refresh through refresh_content_profit_layer().
-- Expected result:
--   - duplicate-grain checks return 0 rows
--   - prerequisite attribution key / grain checks return 0 rows
--   - allocation conservation checks return 0 rows
--   - content-only allocation fan-out checks return 0 rows
--   - attribution-to-summary reconciliation returns 0 rows
--   - unknown-bucket reconciliation returns 0 rows
--   - commission resolver reconciliation returns 0 rows
--   - ROI null check returns 0 rows
-- ============================================

-- 1) Final attribution prerequisite check:
-- no duplicate winner rows and no blank/null business keys should reach the profit layer
SELECT
  created_by,
  order_id,
  product_id,
  COUNT(*) AS dup_count
FROM public.content_order_attribution
GROUP BY created_by, order_id, product_id
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, created_by, order_id, product_id;

SELECT
  'content_order_attribution' AS relation_name,
  COUNT(*) FILTER (WHERE order_id IS NULL OR BTRIM(order_id) = '') AS bad_order_id_count,
  COUNT(*) FILTER (WHERE product_id IS NULL OR BTRIM(product_id) = '') AS bad_product_id_count,
  COUNT(*) FILTER (WHERE content_id IS NULL OR BTRIM(content_id) = '') AS bad_content_id_count,
  COUNT(*) FILTER (WHERE currency IS NULL OR BTRIM(currency) = '') AS bad_currency_count
FROM public.content_order_attribution
HAVING
  COUNT(*) FILTER (WHERE order_id IS NULL OR BTRIM(order_id) = '') > 0
  OR COUNT(*) FILTER (WHERE product_id IS NULL OR BTRIM(product_id) = '') > 0
  OR COUNT(*) FILTER (WHERE content_id IS NULL OR BTRIM(content_id) = '') > 0
  OR COUNT(*) FILTER (WHERE currency IS NULL OR BTRIM(currency) = '') > 0
UNION ALL
SELECT
  'content_profit_attribution_summary' AS relation_name,
  0::BIGINT AS bad_order_id_count,
  COUNT(*) FILTER (WHERE product_id IS NULL OR BTRIM(product_id) = '') AS bad_product_id_count,
  COUNT(*) FILTER (WHERE content_id IS NULL OR BTRIM(content_id) = '') AS bad_content_id_count,
  COUNT(*) FILTER (WHERE currency IS NULL OR BTRIM(currency) = '') AS bad_currency_count
FROM public.content_profit_attribution_summary
HAVING
  COUNT(*) FILTER (WHERE product_id IS NULL OR BTRIM(product_id) = '') > 0
  OR COUNT(*) FILTER (WHERE content_id IS NULL OR BTRIM(content_id) = '') > 0
  OR COUNT(*) FILTER (WHERE currency IS NULL OR BTRIM(currency) = '') > 0;

-- 2) Final summary duplicate grain check
SELECT
  created_by,
  content_id,
  product_id,
  currency,
  COUNT(*) AS dup_count
FROM public.content_profit_attribution_summary
GROUP BY created_by, content_id, product_id, currency
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, created_by, content_id, product_id, currency;

-- 3) Allocation duplicate / shape check
SELECT
  created_by,
  cost_id,
  product_id,
  currency,
  allocation_status,
  allocation_method,
  COUNT(*) AS dup_count
FROM public.tt_content_cost_allocations
GROUP BY created_by, cost_id, product_id, currency, allocation_status, allocation_method
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, created_by, cost_id, product_id, currency;

-- 4) Raw cost conservation:
-- every input cost row must equal allocated + unallocated slices
WITH expected AS (
  SELECT
    c.created_by,
    c.id AS cost_id,
    c.amount::NUMERIC(18, 2) AS expected_amount
  FROM public.tt_content_costs c
),
actual AS (
  SELECT
    a.created_by,
    a.cost_id,
    ROUND(COALESCE(SUM(a.allocated_amount), 0), 2) AS actual_amount
  FROM public.tt_content_cost_allocations a
  GROUP BY a.created_by, a.cost_id
)
SELECT
  COALESCE(e.created_by, a.created_by) AS created_by,
  COALESCE(e.cost_id, a.cost_id) AS cost_id,
  e.expected_amount,
  a.actual_amount
FROM expected e
FULL OUTER JOIN actual a
  ON a.created_by = e.created_by
 AND a.cost_id = e.cost_id
WHERE a.created_by IS NULL
   OR e.created_by IS NULL
   OR a.actual_amount IS DISTINCT FROM e.expected_amount
ORDER BY created_by, cost_id;

-- 5) Direct product-scoped costs must stay 100% direct
SELECT
  c.created_by,
  c.id AS cost_id,
  c.content_id,
  c.product_id,
  c.currency,
  c.cost_date,
  c.amount AS expected_amount,
  a.allocated_amount AS actual_amount,
  a.allocation_method
FROM public.tt_content_costs c
LEFT JOIN public.tt_content_cost_allocations a
  ON a.created_by = c.created_by
 AND a.cost_id = c.id
 AND a.product_id = c.product_id
 AND a.currency = c.currency
 AND a.allocation_status = 'allocated'
WHERE c.product_id IS NOT NULL
  AND (
    a.cost_id IS NULL
    OR a.allocation_method IS DISTINCT FROM 'direct'
    OR a.allocated_amount IS DISTINCT FROM c.amount
  )
ORDER BY c.created_by, c.cost_date DESC, c.content_id, c.product_id;

-- 6) Content-only allocation fan-out must match the distinct product basis set
WITH basis_products AS (
  SELECT
    coa.created_by,
    coa.content_id,
    coa.product_id,
    coa.currency,
    DATE(coa.order_date AT TIME ZONE 'Asia/Bangkok') AS business_date
  FROM public.content_order_attribution coa
  WHERE coa.order_date IS NOT NULL
  GROUP BY
    coa.created_by,
    coa.content_id,
    coa.product_id,
    coa.currency,
    DATE(coa.order_date AT TIME ZONE 'Asia/Bangkok')
),
expected AS (
  SELECT
    c.created_by,
    c.id AS cost_id,
    COUNT(DISTINCT b.product_id)::BIGINT AS expected_allocated_product_count
  FROM public.tt_content_costs c
  JOIN basis_products b
    ON b.created_by = c.created_by
   AND b.content_id = c.content_id
   AND b.currency = c.currency
   AND b.business_date = c.cost_date
  WHERE c.product_id IS NULL
  GROUP BY c.created_by, c.id
),
actual AS (
  SELECT
    c.created_by,
    c.id AS cost_id,
    COUNT(*) FILTER (
      WHERE a.allocation_status = 'allocated'
        AND a.product_id IS NOT NULL
    )::BIGINT AS actual_allocated_product_count
  FROM public.tt_content_costs c
  LEFT JOIN public.tt_content_cost_allocations a
    ON a.created_by = c.created_by
   AND a.cost_id = c.id
  WHERE c.product_id IS NULL
  GROUP BY c.created_by, c.id
)
SELECT
  COALESCE(e.created_by, a.created_by) AS created_by,
  COALESCE(e.cost_id, a.cost_id) AS cost_id,
  COALESCE(e.expected_allocated_product_count, 0) AS expected_allocated_product_count,
  COALESCE(a.actual_allocated_product_count, 0) AS actual_allocated_product_count
FROM expected e
FULL OUTER JOIN actual a
  ON a.created_by = e.created_by
 AND a.cost_id = e.cost_id
WHERE COALESCE(e.expected_allocated_product_count, 0)
   IS DISTINCT FROM COALESCE(a.actual_allocated_product_count, 0)
ORDER BY created_by, cost_id;

-- 7) Final summary must reconcile back to public.content_order_attribution
WITH expected AS (
  SELECT
    coa.created_by,
    coa.content_id,
    coa.product_id,
    coa.currency,
    COUNT(*)::BIGINT AS total_orders,
    COUNT(*) FILTER (WHERE coa.is_realized)::BIGINT AS successful_orders,
    COUNT(*) FILTER (WHERE coa.is_open)::BIGINT AS open_orders,
    COUNT(*) FILTER (WHERE coa.is_lost)::BIGINT AS lost_orders,
    ROUND(COALESCE(SUM(CASE WHEN coa.is_realized THEN coa.gmv ELSE 0 END), 0), 2) AS gmv_realized,
    ROUND(COALESCE(SUM(CASE WHEN coa.is_open THEN coa.gmv ELSE 0 END), 0), 2) AS gmv_open,
    ROUND(COALESCE(SUM(CASE WHEN coa.is_lost THEN coa.gmv ELSE 0 END), 0), 2) AS gmv_lost,
    ROUND(COALESCE(SUM(CASE WHEN coa.is_realized THEN coa.actual_commission_total ELSE 0 END), 0), 2) AS commission_realized,
    ROUND(COALESCE(SUM(CASE WHEN coa.is_open THEN coa.actual_commission_total ELSE 0 END), 0), 2) AS commission_open,
    ROUND(COALESCE(SUM(CASE WHEN coa.is_lost THEN coa.actual_commission_total ELSE 0 END), 0), 2) AS commission_lost
  FROM public.content_order_attribution coa
  GROUP BY coa.created_by, coa.content_id, coa.product_id, coa.currency
)
SELECT
  COALESCE(e.created_by, s.created_by) AS created_by,
  COALESCE(e.content_id, s.content_id) AS content_id,
  COALESCE(e.product_id, s.product_id) AS product_id,
  COALESCE(e.currency, s.currency) AS currency,
  e.total_orders AS expected_total_orders,
  s.total_orders AS actual_total_orders
FROM expected e
FULL OUTER JOIN public.content_profit_attribution_summary s
  ON s.created_by = e.created_by
 AND s.content_id = e.content_id
 AND s.product_id = e.product_id
 AND s.currency = e.currency
WHERE s.created_by IS NULL
   OR (
    e.created_by IS NULL
    AND (
      s.total_orders <> 0
      OR s.successful_orders <> 0
      OR s.open_orders <> 0
      OR s.lost_orders <> 0
      OR s.gmv_realized <> 0
      OR s.gmv_open <> 0
      OR s.gmv_lost <> 0
      OR s.commission_realized <> 0
      OR s.commission_open <> 0
      OR s.commission_lost <> 0
    )
   )
   OR s.total_orders IS DISTINCT FROM e.total_orders
   OR s.successful_orders IS DISTINCT FROM e.successful_orders
   OR s.open_orders IS DISTINCT FROM e.open_orders
   OR s.lost_orders IS DISTINCT FROM e.lost_orders
   OR s.gmv_realized IS DISTINCT FROM e.gmv_realized
   OR s.gmv_open IS DISTINCT FROM e.gmv_open
   OR s.gmv_lost IS DISTINCT FROM e.gmv_lost
   OR s.commission_realized IS DISTINCT FROM e.commission_realized
   OR s.commission_open IS DISTINCT FROM e.commission_open
   OR s.commission_lost IS DISTINCT FROM e.commission_lost
ORDER BY created_by, content_id, product_id, currency
LIMIT 100;

-- 8) Unknown-bucket rows must reconcile to the hidden order gap in summary
WITH expected AS (
  SELECT
    coa.created_by,
    coa.content_id,
    coa.product_id,
    coa.currency,
    COUNT(*) FILTER (WHERE coa.business_bucket = 'unknown')::BIGINT AS unknown_orders,
    ROUND(COALESCE(SUM(CASE WHEN coa.business_bucket = 'unknown' THEN coa.gmv ELSE 0 END), 0), 2) AS unknown_gmv,
    ROUND(COALESCE(SUM(CASE WHEN coa.business_bucket = 'unknown' THEN coa.actual_commission_total ELSE 0 END), 0), 2) AS unknown_commission
  FROM public.content_order_attribution coa
  GROUP BY coa.created_by, coa.content_id, coa.product_id, coa.currency
)
SELECT
  COALESCE(e.created_by, s.created_by) AS created_by,
  COALESCE(e.content_id, s.content_id) AS content_id,
  COALESCE(e.product_id, s.product_id) AS product_id,
  COALESCE(e.currency, s.currency) AS currency,
  COALESCE(e.unknown_orders, 0) AS expected_unknown_orders,
  COALESCE(s.total_orders - s.successful_orders - s.open_orders - s.lost_orders, 0) AS summary_hidden_orders,
  COALESCE(e.unknown_gmv, 0) AS unknown_gmv_not_bucketed_in_summary,
  COALESCE(e.unknown_commission, 0) AS unknown_commission_not_bucketed_in_summary
FROM expected e
FULL OUTER JOIN public.content_profit_attribution_summary s
  ON s.created_by = e.created_by
 AND s.content_id = e.content_id
 AND s.product_id = e.product_id
 AND s.currency = e.currency
WHERE COALESCE(e.unknown_orders, 0)
   IS DISTINCT FROM COALESCE(s.total_orders - s.successful_orders - s.open_orders - s.lost_orders, 0)
ORDER BY created_by, content_id, product_id, currency
LIMIT 100;

-- 9) Final summary cost reconciliation
WITH expected AS (
  SELECT
    a.created_by,
    a.content_id,
    a.product_id,
    a.currency,
    ROUND(COALESCE(SUM(CASE WHEN a.cost_type = 'ads' AND a.allocation_status = 'allocated' THEN a.allocated_amount ELSE 0 END), 0), 2) AS ads_cost,
    ROUND(COALESCE(SUM(CASE WHEN a.cost_type = 'creator' AND a.allocation_status = 'allocated' THEN a.allocated_amount ELSE 0 END), 0), 2) AS creator_cost,
    ROUND(COALESCE(SUM(CASE WHEN a.cost_type = 'misc' AND a.allocation_status = 'allocated' THEN a.allocated_amount ELSE 0 END), 0), 2) AS other_cost
  FROM public.tt_content_cost_allocations a
  WHERE a.allocation_status = 'allocated'
    AND a.product_id IS NOT NULL
  GROUP BY a.created_by, a.content_id, a.product_id, a.currency
)
SELECT
  COALESCE(e.created_by, s.created_by) AS created_by,
  COALESCE(e.content_id, s.content_id) AS content_id,
  COALESCE(e.product_id, s.product_id) AS product_id,
  COALESCE(e.currency, s.currency) AS currency,
  e.ads_cost AS expected_ads_cost,
  s.ads_cost AS actual_ads_cost,
  e.creator_cost AS expected_creator_cost,
  s.creator_cost AS actual_creator_cost,
  e.other_cost AS expected_other_cost,
  s.other_cost AS actual_other_cost
FROM expected e
FULL OUTER JOIN public.content_profit_attribution_summary s
  ON s.created_by = e.created_by
 AND s.content_id = e.content_id
 AND s.product_id = e.product_id
 AND s.currency = e.currency
WHERE s.created_by IS NULL
   OR (
    e.created_by IS NULL
    AND (
      s.ads_cost <> 0
      OR s.creator_cost <> 0
      OR s.other_cost <> 0
      OR s.total_cost <> 0
    )
   )
   OR s.ads_cost IS DISTINCT FROM e.ads_cost
   OR s.creator_cost IS DISTINCT FROM e.creator_cost
   OR s.other_cost IS DISTINCT FROM e.other_cost
   OR s.total_cost IS DISTINCT FROM ROUND(
     COALESCE(e.ads_cost, 0) + COALESCE(e.creator_cost, 0) + COALESCE(e.other_cost, 0),
     2
   )
ORDER BY created_by, content_id, product_id, currency
LIMIT 100;

-- 10) Commission resolver reconciliation on final winners
WITH expected AS (
  SELECT
    f.created_by,
    f.order_id,
    f.product_id,
    f.content_id,
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
    ) AS expected_actual_commission_total
  FROM public.content_order_facts f
  WHERE f.order_id IS NOT NULL
    AND f.product_id IS NOT NULL
    AND f.content_id IS NOT NULL
  GROUP BY f.created_by, f.order_id, f.product_id, f.content_id
)
SELECT
  coa.created_by,
  coa.order_id,
  coa.product_id,
  coa.content_id,
  e.expected_actual_commission_total,
  coa.actual_commission_total,
  coa.source_total_earned_amount,
  coa.source_total_commission_amount,
  coa.commission_source_rule
FROM public.content_order_attribution coa
JOIN expected e
  ON e.created_by = coa.created_by
 AND e.order_id = coa.order_id
 AND e.product_id = coa.product_id
 AND e.content_id = coa.content_id
WHERE coa.actual_commission_total IS DISTINCT FROM e.expected_actual_commission_total
ORDER BY coa.created_by, coa.order_id, coa.product_id, coa.content_id
LIMIT 100;

-- 11) Profit / ROI formula check
SELECT
  created_by,
  content_id,
  product_id,
  currency,
  commission_realized,
  total_cost,
  profit,
  roi
FROM public.content_profit_attribution_summary
WHERE profit IS DISTINCT FROM ROUND(commission_realized - total_cost, 2)
   OR (
     total_cost = 0
     AND roi IS NOT NULL
   )
   OR (
     total_cost > 0
     AND roi IS DISTINCT FROM ROUND((commission_realized - total_cost) / NULLIF(total_cost, 0), 6)
   )
ORDER BY created_by, content_id, product_id, currency
LIMIT 100;

-- 12) Unallocated costs are expected to remain visible, not hidden
SELECT
  created_by,
  cost_id,
  content_id,
  currency,
  cost_date,
  allocation_method,
  allocated_amount
FROM public.tt_content_cost_allocations
WHERE allocation_status = 'unallocated'
ORDER BY cost_date DESC, created_by, content_id, cost_id
LIMIT 50;
