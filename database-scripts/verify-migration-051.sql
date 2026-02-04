-- ============================================
-- Verification Script for Migration 051
-- Check if view logic is working correctly
-- ============================================

-- 1. Check view definition
SELECT
  definition
FROM pg_views
WHERE viewname = 'sales_gmv_daily_summary';

-- 2. Check total for January 2026
SELECT
  'January 2026 Totals' AS period,
  SUM(orders_created) AS total_orders_created,
  SUM(orders_fulfilled) AS total_orders_fulfilled,
  SUM(gmv_created) AS total_gmv_created,
  SUM(gmv_fulfilled) AS total_gmv_fulfilled,
  SUM(leakage_amount) AS total_leakage
FROM sales_gmv_daily_summary
WHERE date_bkk BETWEEN '2026-01-01' AND '2026-01-31';

-- Expected results:
-- total_orders_created: 1767
-- total_orders_fulfilled: 1578
-- total_gmv_created: ~422,483.77
-- total_gmv_fulfilled: ~381,838.04

-- 3. Check daily breakdown (first 5 days)
SELECT
  date_bkk,
  orders_created,
  orders_fulfilled,
  gmv_created,
  gmv_fulfilled,
  leakage_pct
FROM sales_gmv_daily_summary
WHERE date_bkk BETWEEN '2026-01-01' AND '2026-01-05'
ORDER BY date_bkk;

-- 4. Check if order_amount is populated in order_financials
SELECT
  COUNT(*) AS total_records,
  COUNT(order_amount) AS has_order_amount,
  COUNT(*) - COUNT(order_amount) AS null_order_amount,
  SUM(order_amount) AS total_amount
FROM order_financials;

-- Expected (after Migration 050):
-- has_order_amount: should equal total_records
-- null_order_amount: 0

-- 5. Check orders with created_time in January
SELECT
  COUNT(DISTINCT of.order_id) AS total_orders_jan,
  COUNT(DISTINCT CASE
    WHEN of.shipped_at IS NOT NULL
      AND (so.status_group IS NULL OR so.status_group != 'ยกเลิกแล้ว')
    THEN of.order_id
  END) AS fulfilled_orders_jan,
  SUM(COALESCE(of.order_amount, so.total_amount, 0)) AS total_amount_jan
FROM order_financials of
LEFT JOIN sales_orders so ON of.order_id = so.order_id AND of.created_by = so.created_by
WHERE DATE(of.created_time AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31';

-- Expected:
-- total_orders_jan: ~1767
-- fulfilled_orders_jan: ~1578

-- 6. Check cancelled orders in January
SELECT
  COUNT(DISTINCT of.order_id) AS cancelled_orders_jan
FROM order_financials of
LEFT JOIN sales_orders so ON of.order_id = so.order_id AND of.created_by = so.created_by
WHERE DATE(of.created_time AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
  AND so.status_group = 'ยกเลิกแล้ว';

-- Expected: ~187 orders

-- 7. Sample orders to verify logic
SELECT
  of.order_id,
  DATE(of.created_time AT TIME ZONE 'Asia/Bangkok') AS created_date,
  DATE(of.shipped_at AT TIME ZONE 'Asia/Bangkok') AS shipped_date,
  so.status_group,
  COALESCE(of.order_amount, so.total_amount, 0) AS amount,
  CASE
    WHEN of.shipped_at IS NOT NULL
      AND (so.status_group IS NULL OR so.status_group != 'ยกเลิกแล้ว')
    THEN 'fulfilled'
    ELSE 'not_fulfilled'
  END AS fulfillment_status
FROM order_financials of
LEFT JOIN sales_orders so ON of.order_id = so.order_id AND of.created_by = so.created_by
WHERE DATE(of.created_time AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-05'
ORDER BY of.created_time
LIMIT 20;
