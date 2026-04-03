-- ============================================
-- Migration 095: TikTok Affiliate Content Analytics Layer
-- Scope:
--   - module-local daily analytics views on top of public.content_order_facts
--   - no changes to existing SaaS sales / finance / wallet / reconciliation tables
--   - no UI objects
-- Notes:
--   - uses views first, not physical rollup tables
--   - keeps money aggregations currency-safe by grouping by currency
--   - uses total_earned_amount only for provisional actual commission analytics
-- ============================================

BEGIN;

-- ============================================
-- 1) BASE DAILY ANALYTICS VIEW
-- ============================================

CREATE OR REPLACE VIEW public.content_order_analytics_daily_base
WITH (security_invoker = true) AS
SELECT
  f.created_by,
  f.content_id,
  f.content_type,
  f.product_id,
  f.sku_id,
  f.product_name,
  f.attribution_type,
  f.currency,
  DATE(f.order_date AT TIME ZONE 'Asia/Bangkok') AS order_date,
  f.is_successful,
  f.is_cancelled,
  (NOT f.is_successful AND NOT f.is_cancelled) AS is_failed,
  ((NOT f.is_successful AND NOT f.is_cancelled) OR f.is_cancelled) AS is_loss_outcome,
  COALESCE(f.items_sold, 0)::BIGINT AS items_sold,
  COALESCE(f.items_refunded, 0)::BIGINT AS items_refunded,
  COALESCE(f.gmv, 0)::NUMERIC(18, 2) AS gmv,
  COALESCE(f.total_earned_amount, 0)::NUMERIC(18, 2) AS actual_commission_amount
FROM public.content_order_facts f
WHERE f.order_date IS NOT NULL;

COMMENT ON VIEW public.content_order_analytics_daily_base IS
'Module-local daily analytics base for Content Ops attribution rollups. Uses Asia/Bangkok business day and preserves currency as a required grouping dimension for money metrics.';

-- ============================================
-- 2) DAILY ANALYTICS VIEWS
-- ============================================

CREATE OR REPLACE VIEW public.content_performance_daily
WITH (security_invoker = true) AS
SELECT
  b.created_by,
  b.content_id,
  MAX(b.content_type) AS content_type,
  b.currency,
  b.order_date,
  COUNT(*)::BIGINT AS total_orders,
  COUNT(*) FILTER (WHERE b.is_successful)::BIGINT AS successful_orders,
  COUNT(*) FILTER (WHERE b.is_failed)::BIGINT AS failed_orders,
  COUNT(*) FILTER (WHERE b.is_cancelled)::BIGINT AS cancelled_orders,
  COALESCE(SUM(b.items_sold), 0)::BIGINT AS total_units_sold,
  COALESCE(SUM(b.items_refunded), 0)::BIGINT AS total_units_refunded,
  ROUND(COALESCE(SUM(b.gmv), 0), 2) AS gmv_total,
  ROUND(COALESCE(SUM(b.actual_commission_amount), 0), 2) AS actual_commission_total,
  ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.gmv ELSE 0 END), 0), 2) AS lost_gmv,
  ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.actual_commission_amount ELSE 0 END), 0), 2) AS lost_commission,
  ROUND((COUNT(*) FILTER (WHERE b.is_successful))::NUMERIC / NULLIF(COUNT(*), 0), 6) AS success_rate,
  ROUND((COUNT(*) FILTER (WHERE b.is_cancelled))::NUMERIC / NULLIF(COUNT(*), 0), 6) AS cancel_rate
FROM public.content_order_analytics_daily_base b
GROUP BY b.created_by, b.content_id, b.currency, b.order_date;

COMMENT ON VIEW public.content_performance_daily IS
'Daily content-level attribution analytics for the Content Ops module. Grain: created_by + content_id + currency + order_date.';

CREATE OR REPLACE VIEW public.content_product_performance_daily
WITH (security_invoker = true) AS
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
  COUNT(*) FILTER (WHERE b.is_successful)::BIGINT AS successful_orders,
  COUNT(*) FILTER (WHERE b.is_failed)::BIGINT AS failed_orders,
  COUNT(*) FILTER (WHERE b.is_cancelled)::BIGINT AS cancelled_orders,
  COALESCE(SUM(b.items_sold), 0)::BIGINT AS total_units_sold,
  COALESCE(SUM(b.items_refunded), 0)::BIGINT AS total_units_refunded,
  ROUND(COALESCE(SUM(b.gmv), 0), 2) AS gmv_total,
  ROUND(COALESCE(SUM(b.actual_commission_amount), 0), 2) AS actual_commission_total,
  ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.gmv ELSE 0 END), 0), 2) AS lost_gmv,
  ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.actual_commission_amount ELSE 0 END), 0), 2) AS lost_commission
FROM public.content_order_analytics_daily_base b
GROUP BY b.created_by, b.content_id, b.product_id, b.sku_id, b.currency, b.order_date;

COMMENT ON VIEW public.content_product_performance_daily IS
'Daily content-to-product attribution analytics for the Content Ops module. Grain: created_by + content_id + product_id + sku_id + currency + order_date.';

CREATE OR REPLACE VIEW public.product_performance_daily
WITH (security_invoker = true) AS
SELECT
  b.created_by,
  b.product_id,
  b.sku_id,
  MAX(b.product_name) AS product_name,
  b.currency,
  b.order_date,
  COUNT(*)::BIGINT AS total_orders,
  COUNT(*) FILTER (WHERE b.is_successful)::BIGINT AS successful_orders,
  COUNT(*) FILTER (WHERE b.is_failed)::BIGINT AS failed_orders,
  COUNT(*) FILTER (WHERE b.is_cancelled)::BIGINT AS cancelled_orders,
  COALESCE(SUM(b.items_sold), 0)::BIGINT AS total_units_sold,
  ROUND(COALESCE(SUM(b.gmv), 0), 2) AS gmv_total,
  ROUND(COALESCE(SUM(b.actual_commission_amount), 0), 2) AS actual_commission_total,
  ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.gmv ELSE 0 END), 0), 2) AS lost_gmv,
  ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.actual_commission_amount ELSE 0 END), 0), 2) AS lost_commission
FROM public.content_order_analytics_daily_base b
GROUP BY b.created_by, b.product_id, b.sku_id, b.currency, b.order_date;

COMMENT ON VIEW public.product_performance_daily IS
'Daily product-level attribution analytics for the Content Ops module. Grain: created_by + product_id + sku_id + currency + order_date.';

CREATE OR REPLACE VIEW public.content_channel_split_daily
WITH (security_invoker = true) AS
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
  ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.actual_commission_amount ELSE 0 END), 0), 2) AS lost_commission
FROM public.content_order_analytics_daily_base b
GROUP BY b.created_by, b.content_id, b.currency, b.order_date, b.attribution_type;

COMMENT ON VIEW public.content_channel_split_daily IS
'Daily attribution channel split for each content item in the Content Ops module. Grain: created_by + content_id + currency + order_date + attribution_type.';

CREATE OR REPLACE VIEW public.content_loss_daily
WITH (security_invoker = true) AS
SELECT
  b.created_by,
  b.content_id,
  b.currency,
  b.order_date,
  COUNT(*) FILTER (WHERE b.is_loss_outcome)::BIGINT AS lost_orders,
  ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.gmv ELSE 0 END), 0), 2) AS lost_gmv,
  ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.actual_commission_amount ELSE 0 END), 0), 2) AS lost_commission,
  COUNT(*) FILTER (WHERE b.is_cancelled)::BIGINT AS cancelled_orders,
  COUNT(*) FILTER (WHERE b.is_failed)::BIGINT AS failed_orders,
  ROUND((COUNT(*) FILTER (WHERE b.is_cancelled))::NUMERIC / NULLIF(COUNT(*), 0), 6) AS cancel_rate
FROM public.content_order_analytics_daily_base b
GROUP BY b.created_by, b.content_id, b.currency, b.order_date;

COMMENT ON VIEW public.content_loss_daily IS
'Daily cancelled and failed-outcome analytics for each content item in the Content Ops module. Grain: created_by + content_id + currency + order_date.';

COMMIT;
