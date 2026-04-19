-- ============================================
-- Verification: TikTok Affiliate Content Analytics Layer
-- Run after migration-095.
-- Expected result:
--   - duplicate-grain checks return 0 rows
--   - reconciliation queries return 0 rows
--   - descriptor drift checks return 0 rows
-- ============================================

-- 1) Base view coverage by day and currency
SELECT
  created_by,
  currency,
  order_date,
  COUNT(*) AS row_count,
  ROUND(SUM(gmv), 2) AS gmv_total,
  ROUND(SUM(actual_commission_amount), 2) AS actual_commission_total
FROM public.content_order_analytics_daily_base
GROUP BY created_by, currency, order_date
ORDER BY order_date DESC, created_by, currency
LIMIT 50;

-- 2) Fact-grain preservation + status mapping check
SELECT
  f.created_by,
  f.import_batch_id,
  f.order_id,
  f.sku_id,
  f.product_id,
  f.content_id,
  f.order_settlement_status,
  b.outcome_status,
  b.is_realized,
  b.is_open,
  b.is_lost,
  b.is_failed,
  b.is_loss_outcome,
  b.actual_commission_amount,
  b.reported_commission_amount,
  f.total_earned_amount
FROM public.content_order_facts f
JOIN public.content_order_analytics_daily_base b
  ON b.created_by = f.created_by
 AND b.order_id = f.order_id
 AND b.sku_id = f.sku_id
 AND b.product_id = f.product_id
 AND b.content_id = f.content_id
WHERE b.outcome_status IS DISTINCT FROM CASE
    WHEN f.order_settlement_status = 'settled' THEN 'realized'
    WHEN f.order_settlement_status IN ('pending', 'awaiting_payment') THEN 'open'
    WHEN f.order_settlement_status = 'ineligible' THEN 'lost'
    ELSE 'unknown'
  END
   OR b.is_realized IS DISTINCT FROM (f.order_settlement_status = 'settled')
   OR b.is_open IS DISTINCT FROM (f.order_settlement_status IN ('pending', 'awaiting_payment'))
   OR b.is_lost IS DISTINCT FROM (f.order_settlement_status = 'ineligible')
   OR b.is_failed IS DISTINCT FROM (
     f.order_settlement_status NOT IN ('settled', 'pending', 'awaiting_payment', 'ineligible')
   )
   OR b.is_loss_outcome IS DISTINCT FROM (f.order_settlement_status = 'ineligible')
   OR (
     f.order_settlement_status IN ('pending', 'awaiting_payment')
     AND (
       b.actual_commission_amount <> 0
       OR b.is_loss_outcome
       OR b.is_failed
     )
   )
   OR (
     f.order_settlement_status = 'ineligible'
     AND (
       b.actual_commission_amount <> 0
       OR NOT b.is_loss_outcome
     )
   )
   OR (
     f.order_settlement_status = 'settled'
     AND b.actual_commission_amount IS DISTINCT FROM COALESCE(f.total_earned_amount, 0)::NUMERIC(18, 2)
   )
ORDER BY f.created_by, f.order_id, f.sku_id, f.product_id, f.content_id
LIMIT 100;

-- 3) content_performance_daily duplicate grain check
SELECT
  created_by,
  content_id,
  currency,
  order_date,
  COUNT(*) AS dup_count
FROM public.content_performance_daily
GROUP BY created_by, content_id, currency, order_date
HAVING COUNT(*) > 1
ORDER BY order_date DESC, dup_count DESC;

-- 4) content_performance_daily reconciliation
WITH expected AS (
  SELECT
    b.created_by,
    b.content_id,
    MAX(b.content_type) AS content_type,
    b.currency,
    b.order_date,
    COUNT(*)::BIGINT AS total_orders,
    COUNT(*) FILTER (WHERE b.is_realized)::BIGINT AS successful_orders,
    COUNT(*) FILTER (WHERE b.is_failed)::BIGINT AS failed_orders,
    COUNT(*) FILTER (WHERE b.is_lost)::BIGINT AS cancelled_orders,
    COALESCE(SUM(b.items_sold), 0)::BIGINT AS total_units_sold,
    COALESCE(SUM(b.items_refunded), 0)::BIGINT AS total_units_refunded,
    ROUND(COALESCE(SUM(b.gmv), 0), 2) AS gmv_total,
    ROUND(COALESCE(SUM(b.actual_commission_amount), 0), 2) AS actual_commission_total,
    ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.gmv ELSE 0 END), 0), 2) AS lost_gmv,
    ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.reported_commission_amount ELSE 0 END), 0), 2) AS lost_commission,
    ROUND((COUNT(*) FILTER (WHERE b.is_realized))::NUMERIC / NULLIF(COUNT(*), 0), 6) AS success_rate,
    ROUND((COUNT(*) FILTER (WHERE b.is_lost))::NUMERIC / NULLIF(COUNT(*), 0), 6) AS cancel_rate
  FROM public.content_order_analytics_daily_base b
  GROUP BY b.created_by, b.content_id, b.currency, b.order_date
)
SELECT
  COALESCE(e.created_by, v.created_by) AS created_by,
  COALESCE(e.content_id, v.content_id) AS content_id,
  COALESCE(e.currency, v.currency) AS currency,
  COALESCE(e.order_date, v.order_date) AS order_date,
  e.total_orders AS expected_total_orders,
  v.total_orders AS actual_total_orders,
  e.actual_commission_total AS expected_actual_commission_total,
  v.actual_commission_total AS actual_actual_commission_total
FROM expected e
FULL OUTER JOIN public.content_performance_daily v
  ON v.created_by = e.created_by
 AND v.content_id = e.content_id
 AND v.currency IS NOT DISTINCT FROM e.currency
 AND v.order_date = e.order_date
WHERE v.created_by IS NULL
   OR e.created_by IS NULL
   OR v.content_type IS DISTINCT FROM e.content_type
   OR v.total_orders IS DISTINCT FROM e.total_orders
   OR v.successful_orders IS DISTINCT FROM e.successful_orders
   OR v.failed_orders IS DISTINCT FROM e.failed_orders
   OR v.cancelled_orders IS DISTINCT FROM e.cancelled_orders
   OR v.total_units_sold IS DISTINCT FROM e.total_units_sold
   OR v.total_units_refunded IS DISTINCT FROM e.total_units_refunded
   OR v.gmv_total IS DISTINCT FROM e.gmv_total
   OR v.actual_commission_total IS DISTINCT FROM e.actual_commission_total
   OR v.lost_gmv IS DISTINCT FROM e.lost_gmv
   OR v.lost_commission IS DISTINCT FROM e.lost_commission
   OR v.success_rate IS DISTINCT FROM e.success_rate
   OR v.cancel_rate IS DISTINCT FROM e.cancel_rate
ORDER BY order_date DESC, created_by, content_id
LIMIT 50;

-- 5) content_performance_daily descriptor drift check
SELECT
  created_by,
  content_id,
  currency,
  order_date,
  COUNT(DISTINCT COALESCE(content_type, '<<null>>')) AS distinct_content_types
FROM public.content_order_analytics_daily_base
GROUP BY created_by, content_id, currency, order_date
HAVING COUNT(DISTINCT COALESCE(content_type, '<<null>>')) > 1
ORDER BY order_date DESC, created_by, content_id;

-- 6) content_product_performance_daily duplicate grain check
SELECT
  created_by,
  content_id,
  product_id,
  sku_id,
  currency,
  order_date,
  COUNT(*) AS dup_count
FROM public.content_product_performance_daily
GROUP BY created_by, content_id, product_id, sku_id, currency, order_date
HAVING COUNT(*) > 1
ORDER BY order_date DESC, dup_count DESC;

-- 7) content_product_performance_daily reconciliation
WITH expected AS (
  SELECT
    b.created_by,
    b.content_id,
    b.product_id,
    b.sku_id,
    MAX(b.product_name) AS product_name,
    MAX(b.content_type) AS content_type,
    b.currency,
    b.order_date,
    COUNT(*)::BIGINT AS total_orders,
    COUNT(*) FILTER (WHERE b.is_realized)::BIGINT AS successful_orders,
    COUNT(*) FILTER (WHERE b.is_failed)::BIGINT AS failed_orders,
    COUNT(*) FILTER (WHERE b.is_lost)::BIGINT AS cancelled_orders,
    COALESCE(SUM(b.items_sold), 0)::BIGINT AS total_units_sold,
    COALESCE(SUM(b.items_refunded), 0)::BIGINT AS total_units_refunded,
    ROUND(COALESCE(SUM(b.gmv), 0), 2) AS gmv_total,
    ROUND(COALESCE(SUM(b.actual_commission_amount), 0), 2) AS actual_commission_total,
    ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.gmv ELSE 0 END), 0), 2) AS lost_gmv,
    ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.reported_commission_amount ELSE 0 END), 0), 2) AS lost_commission
  FROM public.content_order_analytics_daily_base b
  GROUP BY b.created_by, b.content_id, b.product_id, b.sku_id, b.currency, b.order_date
)
SELECT
  COALESCE(e.created_by, v.created_by) AS created_by,
  COALESCE(e.content_id, v.content_id) AS content_id,
  COALESCE(e.product_id, v.product_id) AS product_id,
  COALESCE(e.sku_id, v.sku_id) AS sku_id,
  COALESCE(e.currency, v.currency) AS currency,
  COALESCE(e.order_date, v.order_date) AS order_date,
  e.total_orders AS expected_total_orders,
  v.total_orders AS actual_total_orders
FROM expected e
FULL OUTER JOIN public.content_product_performance_daily v
  ON v.created_by = e.created_by
 AND v.content_id = e.content_id
 AND v.product_id = e.product_id
 AND v.sku_id = e.sku_id
 AND v.currency IS NOT DISTINCT FROM e.currency
 AND v.order_date = e.order_date
WHERE v.created_by IS NULL
   OR e.created_by IS NULL
   OR v.product_name IS DISTINCT FROM e.product_name
   OR v.content_type IS DISTINCT FROM e.content_type
   OR v.total_orders IS DISTINCT FROM e.total_orders
   OR v.successful_orders IS DISTINCT FROM e.successful_orders
   OR v.failed_orders IS DISTINCT FROM e.failed_orders
   OR v.cancelled_orders IS DISTINCT FROM e.cancelled_orders
   OR v.total_units_sold IS DISTINCT FROM e.total_units_sold
   OR v.total_units_refunded IS DISTINCT FROM e.total_units_refunded
   OR v.gmv_total IS DISTINCT FROM e.gmv_total
   OR v.actual_commission_total IS DISTINCT FROM e.actual_commission_total
   OR v.lost_gmv IS DISTINCT FROM e.lost_gmv
   OR v.lost_commission IS DISTINCT FROM e.lost_commission
ORDER BY order_date DESC, created_by, content_id, product_id, sku_id
LIMIT 50;

-- 8) content_product_performance_daily descriptor drift check
SELECT
  created_by,
  content_id,
  product_id,
  sku_id,
  currency,
  order_date,
  COUNT(DISTINCT COALESCE(product_name, '<<null>>')) AS distinct_product_names,
  COUNT(DISTINCT COALESCE(content_type, '<<null>>')) AS distinct_content_types
FROM public.content_order_analytics_daily_base
GROUP BY created_by, content_id, product_id, sku_id, currency, order_date
HAVING COUNT(DISTINCT COALESCE(product_name, '<<null>>')) > 1
    OR COUNT(DISTINCT COALESCE(content_type, '<<null>>')) > 1
ORDER BY order_date DESC, created_by, content_id, product_id, sku_id;

-- 9) product_performance_daily duplicate grain check
SELECT
  created_by,
  product_id,
  sku_id,
  currency,
  order_date,
  COUNT(*) AS dup_count
FROM public.product_performance_daily
GROUP BY created_by, product_id, sku_id, currency, order_date
HAVING COUNT(*) > 1
ORDER BY order_date DESC, dup_count DESC;

-- 10) product_performance_daily reconciliation
WITH expected AS (
  SELECT
    b.created_by,
    b.product_id,
    b.sku_id,
    MAX(b.product_name) AS product_name,
    b.currency,
    b.order_date,
    COUNT(*)::BIGINT AS total_orders,
    COUNT(*) FILTER (WHERE b.is_realized)::BIGINT AS successful_orders,
    COUNT(*) FILTER (WHERE b.is_failed)::BIGINT AS failed_orders,
    COUNT(*) FILTER (WHERE b.is_lost)::BIGINT AS cancelled_orders,
    COALESCE(SUM(b.items_sold), 0)::BIGINT AS total_units_sold,
    ROUND(COALESCE(SUM(b.gmv), 0), 2) AS gmv_total,
    ROUND(COALESCE(SUM(b.actual_commission_amount), 0), 2) AS actual_commission_total,
    ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.gmv ELSE 0 END), 0), 2) AS lost_gmv,
    ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.reported_commission_amount ELSE 0 END), 0), 2) AS lost_commission
  FROM public.content_order_analytics_daily_base b
  GROUP BY b.created_by, b.product_id, b.sku_id, b.currency, b.order_date
)
SELECT
  COALESCE(e.created_by, v.created_by) AS created_by,
  COALESCE(e.product_id, v.product_id) AS product_id,
  COALESCE(e.sku_id, v.sku_id) AS sku_id,
  COALESCE(e.currency, v.currency) AS currency,
  COALESCE(e.order_date, v.order_date) AS order_date,
  e.total_orders AS expected_total_orders,
  v.total_orders AS actual_total_orders
FROM expected e
FULL OUTER JOIN public.product_performance_daily v
  ON v.created_by = e.created_by
 AND v.product_id = e.product_id
 AND v.sku_id = e.sku_id
 AND v.currency IS NOT DISTINCT FROM e.currency
 AND v.order_date = e.order_date
WHERE v.created_by IS NULL
   OR e.created_by IS NULL
   OR v.product_name IS DISTINCT FROM e.product_name
   OR v.total_orders IS DISTINCT FROM e.total_orders
   OR v.successful_orders IS DISTINCT FROM e.successful_orders
   OR v.failed_orders IS DISTINCT FROM e.failed_orders
   OR v.cancelled_orders IS DISTINCT FROM e.cancelled_orders
   OR v.total_units_sold IS DISTINCT FROM e.total_units_sold
   OR v.gmv_total IS DISTINCT FROM e.gmv_total
   OR v.actual_commission_total IS DISTINCT FROM e.actual_commission_total
   OR v.lost_gmv IS DISTINCT FROM e.lost_gmv
   OR v.lost_commission IS DISTINCT FROM e.lost_commission
ORDER BY order_date DESC, created_by, product_id, sku_id
LIMIT 50;

-- 11) product_performance_daily descriptor drift check
SELECT
  created_by,
  product_id,
  sku_id,
  currency,
  order_date,
  COUNT(DISTINCT COALESCE(product_name, '<<null>>')) AS distinct_product_names
FROM public.content_order_analytics_daily_base
GROUP BY created_by, product_id, sku_id, currency, order_date
HAVING COUNT(DISTINCT COALESCE(product_name, '<<null>>')) > 1
ORDER BY order_date DESC, created_by, product_id, sku_id;

-- 12) content_channel_split_daily duplicate grain check
SELECT
  created_by,
  content_id,
  currency,
  order_date,
  attribution_type,
  COUNT(*) AS dup_count
FROM public.content_channel_split_daily
GROUP BY created_by, content_id, currency, order_date, attribution_type
HAVING COUNT(*) > 1
ORDER BY order_date DESC, dup_count DESC;

-- 13) content_channel_split_daily reconciliation
WITH expected AS (
  SELECT
    b.created_by,
    b.content_id,
    b.currency,
    b.order_date,
    b.attribution_type,
    COUNT(*)::BIGINT AS total_orders,
    ROUND(COALESCE(SUM(b.gmv), 0), 2) AS gmv_total,
    ROUND(COALESCE(SUM(b.actual_commission_amount), 0), 2) AS actual_commission_total,
    ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.gmv ELSE 0 END), 0), 2) AS lost_gmv,
    ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.reported_commission_amount ELSE 0 END), 0), 2) AS lost_commission
  FROM public.content_order_analytics_daily_base b
  GROUP BY b.created_by, b.content_id, b.currency, b.order_date, b.attribution_type
)
SELECT
  COALESCE(e.created_by, v.created_by) AS created_by,
  COALESCE(e.content_id, v.content_id) AS content_id,
  COALESCE(e.currency, v.currency) AS currency,
  COALESCE(e.order_date, v.order_date) AS order_date,
  COALESCE(e.attribution_type, v.attribution_type) AS attribution_type,
  e.total_orders AS expected_total_orders,
  v.total_orders AS actual_total_orders
FROM expected e
FULL OUTER JOIN public.content_channel_split_daily v
  ON v.created_by = e.created_by
 AND v.content_id = e.content_id
 AND v.currency IS NOT DISTINCT FROM e.currency
 AND v.order_date = e.order_date
 AND v.attribution_type = e.attribution_type
WHERE v.created_by IS NULL
   OR e.created_by IS NULL
   OR v.total_orders IS DISTINCT FROM e.total_orders
   OR v.gmv_total IS DISTINCT FROM e.gmv_total
   OR v.actual_commission_total IS DISTINCT FROM e.actual_commission_total
   OR v.lost_gmv IS DISTINCT FROM e.lost_gmv
   OR v.lost_commission IS DISTINCT FROM e.lost_commission
ORDER BY order_date DESC, created_by, content_id, attribution_type
LIMIT 50;

-- 14) content_loss_daily duplicate grain check
SELECT
  created_by,
  content_id,
  currency,
  order_date,
  COUNT(*) AS dup_count
FROM public.content_loss_daily
GROUP BY created_by, content_id, currency, order_date
HAVING COUNT(*) > 1
ORDER BY order_date DESC, dup_count DESC;

-- 15) content_loss_daily reconciliation
WITH expected AS (
  SELECT
    b.created_by,
    b.content_id,
    b.currency,
    b.order_date,
    COUNT(*) FILTER (WHERE b.is_loss_outcome)::BIGINT AS lost_orders,
    ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.gmv ELSE 0 END), 0), 2) AS lost_gmv,
    ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.reported_commission_amount ELSE 0 END), 0), 2) AS lost_commission,
    COUNT(*) FILTER (WHERE b.is_lost)::BIGINT AS cancelled_orders,
    COUNT(*) FILTER (WHERE b.is_failed)::BIGINT AS failed_orders,
    ROUND((COUNT(*) FILTER (WHERE b.is_lost))::NUMERIC / NULLIF(COUNT(*), 0), 6) AS cancel_rate
  FROM public.content_order_analytics_daily_base b
  GROUP BY b.created_by, b.content_id, b.currency, b.order_date
)
SELECT
  COALESCE(e.created_by, v.created_by) AS created_by,
  COALESCE(e.content_id, v.content_id) AS content_id,
  COALESCE(e.currency, v.currency) AS currency,
  COALESCE(e.order_date, v.order_date) AS order_date,
  e.lost_orders AS expected_lost_orders,
  v.lost_orders AS actual_lost_orders
FROM expected e
FULL OUTER JOIN public.content_loss_daily v
  ON v.created_by = e.created_by
 AND v.content_id = e.content_id
 AND v.currency IS NOT DISTINCT FROM e.currency
 AND v.order_date = e.order_date
WHERE v.created_by IS NULL
   OR e.created_by IS NULL
   OR v.lost_orders IS DISTINCT FROM e.lost_orders
   OR v.lost_gmv IS DISTINCT FROM e.lost_gmv
   OR v.lost_commission IS DISTINCT FROM e.lost_commission
   OR v.cancelled_orders IS DISTINCT FROM e.cancelled_orders
   OR v.failed_orders IS DISTINCT FROM e.failed_orders
   OR v.cancel_rate IS DISTINCT FROM e.cancel_rate
ORDER BY order_date DESC, created_by, content_id
LIMIT 50;
