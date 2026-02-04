-- ============================================
-- Migration 049: Fix GMV View to Handle NULL order_amount
-- Issue: order_financials.order_amount is NULL, causing GMV to show 0
-- Fix: JOIN with sales_orders to get total_amount when order_amount is NULL
-- Date: 2026-02-04
-- ============================================

-- Drop existing view
DROP VIEW IF EXISTS public.sales_gmv_daily_summary;

-- Recreate view with fix
CREATE OR REPLACE VIEW public.sales_gmv_daily_summary AS
WITH of_created AS (
  SELECT
    of.created_by,
    of.order_id,
    DATE(of.created_time AT TIME ZONE 'Asia/Bangkok') AS date_bkk,
    -- FIX: Use sales_orders.total_amount when order_amount is NULL
    COALESCE(of.order_amount, so.total_amount, 0) AS order_amount,
    'created'::text AS metric_type
  FROM order_financials of
  LEFT JOIN sales_orders so ON of.order_id = so.order_id AND of.created_by = so.created_by
  WHERE of.created_time IS NOT NULL
),
of_fulfilled AS (
  SELECT
    of.created_by,
    of.order_id,
    DATE(of.shipped_at AT TIME ZONE 'Asia/Bangkok') AS date_bkk,
    -- FIX: Use sales_orders.total_amount when order_amount is NULL
    COALESCE(of.order_amount, so.total_amount, 0) AS order_amount,
    'fulfilled'::text AS metric_type
  FROM order_financials of
  LEFT JOIN sales_orders so ON of.order_id = so.order_id AND of.created_by = so.created_by
  WHERE of.shipped_at IS NOT NULL
),
so_created AS (
  SELECT
    sales_orders.created_by,
    sales_orders.order_id,
    DATE(sales_orders.created_time AT TIME ZONE 'Asia/Bangkok') AS date_bkk,
    COALESCE(MAX(sales_orders.order_amount), MAX(sales_orders.total_amount)) AS order_amount,
    'created'::text AS metric_type
  FROM sales_orders
  WHERE sales_orders.created_time IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM order_financials of2
      WHERE of2.created_by = sales_orders.created_by
      AND of2.order_id = sales_orders.order_id::text
    )
  GROUP BY sales_orders.created_by, sales_orders.order_id, DATE(sales_orders.created_time AT TIME ZONE 'Asia/Bangkok')
),
so_fulfilled AS (
  SELECT
    sales_orders.created_by,
    sales_orders.order_id,
    DATE(sales_orders.shipped_at AT TIME ZONE 'Asia/Bangkok') AS date_bkk,
    COALESCE(MAX(sales_orders.order_amount), MAX(sales_orders.total_amount)) AS order_amount,
    'fulfilled'::text AS metric_type
  FROM sales_orders
  WHERE sales_orders.shipped_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM order_financials of2
      WHERE of2.created_by = sales_orders.created_by
      AND of2.order_id = sales_orders.order_id::text
    )
  GROUP BY sales_orders.created_by, sales_orders.order_id, DATE(sales_orders.shipped_at AT TIME ZONE 'Asia/Bangkok')
),
all_orders AS (
  SELECT * FROM of_created
  UNION ALL
  SELECT * FROM of_fulfilled
  UNION ALL
  SELECT * FROM so_created
  UNION ALL
  SELECT * FROM so_fulfilled
),
daily_metrics AS (
  SELECT
    created_by,
    date_bkk,
    metric_type,
    COUNT(DISTINCT order_id) AS orders,
    SUM(order_amount) AS gmv
  FROM all_orders
  GROUP BY created_by, date_bkk, metric_type
),
pivoted AS (
  SELECT
    created_by,
    date_bkk,
    MAX(CASE WHEN metric_type = 'created' THEN orders ELSE 0 END) AS orders_created,
    MAX(CASE WHEN metric_type = 'created' THEN gmv ELSE 0 END) AS gmv_created,
    MAX(CASE WHEN metric_type = 'fulfilled' THEN orders ELSE 0 END) AS orders_fulfilled,
    MAX(CASE WHEN metric_type = 'fulfilled' THEN gmv ELSE 0 END) AS gmv_fulfilled
  FROM daily_metrics
  GROUP BY created_by, date_bkk
)
SELECT
  created_by,
  date_bkk,
  COALESCE(gmv_created, 0) AS gmv_created,
  COALESCE(orders_created, 0) AS orders_created,
  COALESCE(gmv_fulfilled, 0) AS gmv_fulfilled,
  COALESCE(orders_fulfilled, 0) AS orders_fulfilled,
  (COALESCE(gmv_created, 0) - COALESCE(gmv_fulfilled, 0)) AS leakage_amount,
  CASE
    WHEN COALESCE(gmv_created, 0) > 0
    THEN ((COALESCE(gmv_created, 0) - COALESCE(gmv_fulfilled, 0)) / gmv_created) * 100
    ELSE 0
  END AS leakage_pct
FROM pivoted;

-- Grant permissions
GRANT SELECT ON public.sales_gmv_daily_summary TO authenticated;

-- Add comment
COMMENT ON VIEW public.sales_gmv_daily_summary IS
  'Daily GMV summary with fallback to sales_orders.total_amount when order_financials.order_amount is NULL';

-- ============================================
-- VERIFICATION
-- ============================================

-- Test query - should show GMV values now (not 0)
-- SELECT * FROM sales_gmv_daily_summary
-- WHERE date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
-- LIMIT 10;
