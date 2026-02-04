-- ============================================
-- Migration 045: Add created_time to order_financials + GMV Cards View
-- Purpose: Enable GMV tracking by Created Date (B) and Shipped Date (C)
-- Date: 2026-02-03
--
-- KEY METRICS:
-- B = GMV (Orders Created) by created_time date
-- C = GMV (Fulfilled) by shipped_at date
-- Leakage = B - C (cancellations, unfulfilled)
-- ============================================

BEGIN;

-- ============================================
-- 1) ADD created_time COLUMN TO order_financials
-- ============================================

-- Add created_time (TikTok "Created Time" - when customer placed order)
ALTER TABLE public.order_financials
ADD COLUMN IF NOT EXISTS created_time TIMESTAMPTZ;

COMMENT ON COLUMN public.order_financials.created_time IS
'When customer placed the order (TikTok Created Time). Used for GMV by created date (B metric).';

-- Create index for created_time (for B metric queries)
CREATE INDEX IF NOT EXISTS idx_order_financials_created_time
  ON public.order_financials(created_time)
  WHERE created_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_financials_platform_created
  ON public.order_financials(source_platform, created_time)
  WHERE created_time IS NOT NULL;

-- ============================================
-- 2) BACKFILL created_time FROM sales_orders
-- ============================================

-- Update order_financials with created_time from sales_orders (MAX per order_id)
UPDATE order_financials of
SET created_time = so_agg.created_time
FROM (
  SELECT
    created_by,
    order_id,
    MAX(created_time) as created_time
  FROM sales_orders
  WHERE created_time IS NOT NULL
  GROUP BY created_by, order_id
) so_agg
WHERE of.created_by = so_agg.created_by
  AND of.order_id = so_agg.order_id
  AND of.created_time IS NULL;

-- ============================================
-- 3) CREATE VIEW: sales_gmv_daily_summary
-- ============================================

CREATE OR REPLACE VIEW public.sales_gmv_daily_summary AS
WITH
-- Layer 1: Get order-level data from order_financials (primary source)
of_created AS (
  SELECT
    created_by,
    order_id,
    DATE(created_time AT TIME ZONE 'Asia/Bangkok') as date_bkk,
    order_amount,
    'created' as metric_type
  FROM order_financials
  WHERE created_time IS NOT NULL
),
of_fulfilled AS (
  SELECT
    created_by,
    order_id,
    DATE(shipped_at AT TIME ZONE 'Asia/Bangkok') as date_bkk,
    order_amount,
    'fulfilled' as metric_type
  FROM order_financials
  WHERE shipped_at IS NOT NULL
),
-- Layer 2: Fallback for orders not in order_financials (legacy data from sales_orders)
so_created AS (
  SELECT
    created_by,
    order_id,
    DATE(created_time AT TIME ZONE 'Asia/Bangkok') as date_bkk,
    COALESCE(MAX(order_amount), MAX(total_amount)) as order_amount,
    'created' as metric_type
  FROM sales_orders
  WHERE created_time IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM order_financials of2
      WHERE of2.created_by = sales_orders.created_by
        AND of2.order_id = sales_orders.order_id
    )
  GROUP BY created_by, order_id, DATE(created_time AT TIME ZONE 'Asia/Bangkok')
),
so_fulfilled AS (
  SELECT
    created_by,
    order_id,
    DATE(shipped_at AT TIME ZONE 'Asia/Bangkok') as date_bkk,
    COALESCE(MAX(order_amount), MAX(total_amount)) as order_amount,
    'fulfilled' as metric_type
  FROM sales_orders
  WHERE shipped_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM order_financials of2
      WHERE of2.created_by = sales_orders.created_by
        AND of2.order_id = sales_orders.order_id
    )
  GROUP BY created_by, order_id, DATE(shipped_at AT TIME ZONE 'Asia/Bangkok')
),
-- Layer 3: Combine both sources
all_orders AS (
  SELECT * FROM of_created
  UNION ALL
  SELECT * FROM of_fulfilled
  UNION ALL
  SELECT * FROM so_created
  UNION ALL
  SELECT * FROM so_fulfilled
),
-- Layer 4: Aggregate by date and metric_type
daily_metrics AS (
  SELECT
    created_by,
    date_bkk,
    metric_type,
    COUNT(DISTINCT order_id) as orders,
    SUM(order_amount) as gmv
  FROM all_orders
  GROUP BY created_by, date_bkk, metric_type
),
-- Layer 5: Pivot to get created and fulfilled side by side
pivoted AS (
  SELECT
    created_by,
    date_bkk,
    MAX(CASE WHEN metric_type = 'created' THEN orders ELSE 0 END) as orders_created,
    MAX(CASE WHEN metric_type = 'created' THEN gmv ELSE 0 END) as gmv_created,
    MAX(CASE WHEN metric_type = 'fulfilled' THEN orders ELSE 0 END) as orders_fulfilled,
    MAX(CASE WHEN metric_type = 'fulfilled' THEN gmv ELSE 0 END) as gmv_fulfilled
  FROM daily_metrics
  GROUP BY created_by, date_bkk
)
-- Final: Calculate leakage
SELECT
  created_by,
  date_bkk,
  COALESCE(gmv_created, 0) as gmv_created,
  COALESCE(orders_created, 0) as orders_created,
  COALESCE(gmv_fulfilled, 0) as gmv_fulfilled,
  COALESCE(orders_fulfilled, 0) as orders_fulfilled,
  COALESCE(gmv_created, 0) - COALESCE(gmv_fulfilled, 0) as leakage_amount,
  CASE
    WHEN COALESCE(gmv_created, 0) > 0 THEN
      ((COALESCE(gmv_created, 0) - COALESCE(gmv_fulfilled, 0)) / gmv_created) * 100
    ELSE 0
  END as leakage_pct
FROM pivoted;

COMMENT ON VIEW public.sales_gmv_daily_summary IS
'Daily GMV summary with B (created), C (fulfilled), and leakage metrics.
B (gmv_created) = Orders by created_time date (when customer placed order)
C (gmv_fulfilled) = Orders by shipped_at date (when order shipped)
Leakage = B - C (cancellations + unfulfilled orders)
Source: order_financials (primary) + sales_orders (fallback for legacy)';

-- ============================================
-- 4) VERIFICATION QUERY (Manual QA)
-- ============================================

/*
-- Test view with sample date range
-- Replace YOUR_USER_ID with actual UUID

SELECT
  date_bkk,
  orders_created,
  gmv_created,
  orders_fulfilled,
  gmv_fulfilled,
  leakage_amount,
  ROUND(leakage_pct, 2) as leakage_pct
FROM sales_gmv_daily_summary
WHERE created_by = 'YOUR_USER_ID'
  AND date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
ORDER BY date_bkk DESC;

-- Expected:
-- orders_created >= orders_fulfilled (some orders not yet fulfilled)
-- gmv_created >= gmv_fulfilled (some GMV leaked to cancellations)
-- leakage_pct between 0-100
*/

COMMIT;

-- ============================================
-- END OF MIGRATION 045
-- ============================================
