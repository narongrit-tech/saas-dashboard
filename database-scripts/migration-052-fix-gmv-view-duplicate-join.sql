-- ============================================
-- Migration 052: Fix GMV View Duplicate Join
-- Issue: LEFT JOIN sales_orders (line-level) causes duplicate rows and inflated GMV
-- Fix: Remove JOIN since order_financials.order_amount is now populated correctly
-- Date: 2026-02-04
-- ============================================

-- Drop existing view
DROP VIEW IF EXISTS public.sales_gmv_daily_summary;

-- Recreate view WITHOUT duplicate join
CREATE OR REPLACE VIEW public.sales_gmv_daily_summary AS
WITH of_created AS (
  -- ALL orders created on this date (from order_financials)
  SELECT
    of.created_by,
    of.order_id,
    DATE(of.created_time AT TIME ZONE 'Asia/Bangkok') AS date_bkk,
    of.order_amount,  -- FIXED: No need to COALESCE with sales_orders anymore
    'created'::text AS metric_type
  FROM order_financials of
  WHERE of.created_time IS NOT NULL
    AND of.order_amount IS NOT NULL  -- Only include orders with valid amounts
),
of_fulfilled AS (
  -- FULFILLED orders: created on this date + has shipped_at + NOT cancelled
  SELECT
    of.created_by,
    of.order_id,
    DATE(of.created_time AT TIME ZONE 'Asia/Bangkok') AS date_bkk,
    of.order_amount,  -- FIXED: Use order_financials.order_amount directly
    'fulfilled'::text AS metric_type
  FROM order_financials of
  WHERE of.created_time IS NOT NULL
    AND of.order_amount IS NOT NULL
    AND of.shipped_at IS NOT NULL  -- Must have shipped_at
    -- Check cancelled status from order_financials or fallback to sales_orders
    AND NOT EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.order_id::text = of.order_id
        AND so.created_by = of.created_by
        AND so.status_group = 'ยกเลิกแล้ว'
    )
),
so_created AS (
  -- Fallback: orders in sales_orders but not in order_financials
  -- (Should be rare/none after proper import)
  SELECT
    sales_orders.created_by,
    sales_orders.order_id::text as order_id,
    DATE(sales_orders.created_time AT TIME ZONE 'Asia/Bangkok') AS date_bkk,
    SUM(sales_orders.total_amount) AS order_amount,  -- Sum line-level amounts
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
  -- Fallback: fulfilled orders from sales_orders
  SELECT
    sales_orders.created_by,
    sales_orders.order_id::text as order_id,
    DATE(sales_orders.created_time AT TIME ZONE 'Asia/Bangkok') AS date_bkk,
    SUM(sales_orders.total_amount) AS order_amount,  -- Sum line-level amounts
    'fulfilled'::text AS metric_type
  FROM sales_orders
  WHERE sales_orders.created_time IS NOT NULL
    AND sales_orders.shipped_at IS NOT NULL
    AND (sales_orders.status_group IS NULL OR sales_orders.status_group != 'ยกเลิกแล้ว')
    AND NOT EXISTS (
      SELECT 1 FROM order_financials of2
      WHERE of2.created_by = sales_orders.created_by
        AND of2.order_id = sales_orders.order_id::text
    )
  GROUP BY sales_orders.created_by, sales_orders.order_id, DATE(sales_orders.created_time AT TIME ZONE 'Asia/Bangkok')
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
  'Daily GMV summary - FIXED: No duplicate join, uses order_financials.order_amount directly';

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Test query - should match order_financials totals now
SELECT
  'order_financials' as source,
  COUNT(DISTINCT order_id) as orders,
  ROUND(SUM(order_amount), 2) as total
FROM order_financials
WHERE DATE(created_time AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'

UNION ALL

SELECT
  'gmv_view' as source,
  SUM(orders_created)::bigint as orders,
  ROUND(SUM(gmv_created), 2) as total
FROM sales_gmv_daily_summary
WHERE date_bkk BETWEEN '2026-01-01' AND '2026-01-31';

-- Should show identical values!
-- Expected: 1,767 orders, ฿419,417.65

-- ============================================
-- KEY CHANGES FROM MIGRATION 051
-- ============================================
--
-- BEFORE (Migration 051 - WRONG):
-- - LEFT JOIN sales_orders (line-level) → duplicate rows
-- - COALESCE(of.order_amount, so.total_amount) → counted N times per order
-- - Result: Inflated GMV (฿484,184 vs ฿419,417)
--
-- AFTER (Migration 052 - CORRECT):
-- - NO JOIN to sales_orders in of_created/of_fulfilled CTEs
-- - Use order_financials.order_amount directly (already correct)
-- - Result: Accurate GMV (฿419,417 ✓)
--
-- ============================================
-- END OF MIGRATION
-- ============================================
