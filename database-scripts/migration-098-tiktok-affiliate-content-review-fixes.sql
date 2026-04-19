-- ============================================
-- Migration 098: TikTok Affiliate Content Review Fixes
-- Scope:
--   - preserve fact-grain join keys in the analytics base view
--   - correct realized/open/lost status semantics for interim analytics
--   - keep the module isolated from SaaS sales / finance / wallet / reconciliation tables
-- ============================================

BEGIN;

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
  (f.order_settlement_status NOT IN ('settled', 'pending', 'awaiting_payment', 'ineligible')) AS is_failed,
  (f.order_settlement_status = 'ineligible') AS is_loss_outcome,
  COALESCE(f.items_sold, 0)::BIGINT AS items_sold,
  COALESCE(f.items_refunded, 0)::BIGINT AS items_refunded,
  COALESCE(f.gmv, 0)::NUMERIC(18, 2) AS gmv,
  CASE
    WHEN f.order_settlement_status = 'settled'
      THEN COALESCE(f.total_earned_amount, 0)::NUMERIC(18, 2)
    ELSE 0::NUMERIC(18, 2)
  END AS actual_commission_amount,
  f.import_batch_id,
  f.order_id,
  f.order_settlement_status,
  CASE
    WHEN f.order_settlement_status = 'settled' THEN 'realized'
    WHEN f.order_settlement_status IN ('pending', 'awaiting_payment') THEN 'open'
    WHEN f.order_settlement_status = 'ineligible' THEN 'lost'
    ELSE 'unknown'
  END AS outcome_status,
  (f.order_settlement_status = 'settled') AS is_realized,
  (f.order_settlement_status IN ('pending', 'awaiting_payment')) AS is_open,
  (f.order_settlement_status = 'ineligible') AS is_lost,
  COALESCE(f.total_earned_amount, 0)::NUMERIC(18, 2) AS reported_commission_amount
FROM public.content_order_facts f
WHERE f.order_date IS NOT NULL;

COMMENT ON VIEW public.content_order_analytics_daily_base IS
'Module-local daily analytics base for Content Ops attribution rollups. Grain stays at one fact row per created_by + order_id + sku_id + product_id + content_id. actual_commission_amount is settled-only; pending and awaiting_payment remain open; ineligible is treated as lost.';

CREATE OR REPLACE VIEW public.content_performance_daily
WITH (security_invoker = true) AS
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
GROUP BY b.created_by, b.content_id, b.currency, b.order_date;

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
GROUP BY b.created_by, b.content_id, b.product_id, b.sku_id, b.currency, b.order_date;

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
  COUNT(*) FILTER (WHERE b.is_realized)::BIGINT AS successful_orders,
  COUNT(*) FILTER (WHERE b.is_failed)::BIGINT AS failed_orders,
  COUNT(*) FILTER (WHERE b.is_lost)::BIGINT AS cancelled_orders,
  COALESCE(SUM(b.items_sold), 0)::BIGINT AS total_units_sold,
  ROUND(COALESCE(SUM(b.gmv), 0), 2) AS gmv_total,
  ROUND(COALESCE(SUM(b.actual_commission_amount), 0), 2) AS actual_commission_total,
  ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.gmv ELSE 0 END), 0), 2) AS lost_gmv,
  ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.reported_commission_amount ELSE 0 END), 0), 2) AS lost_commission
FROM public.content_order_analytics_daily_base b
GROUP BY b.created_by, b.product_id, b.sku_id, b.currency, b.order_date;

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
  ROUND(COALESCE(SUM(CASE WHEN b.is_loss_outcome THEN b.reported_commission_amount ELSE 0 END), 0), 2) AS lost_commission
FROM public.content_order_analytics_daily_base b
GROUP BY b.created_by, b.content_id, b.currency, b.order_date, b.attribution_type;

CREATE OR REPLACE VIEW public.content_loss_daily
WITH (security_invoker = true) AS
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
GROUP BY b.created_by, b.content_id, b.currency, b.order_date;

COMMIT;
