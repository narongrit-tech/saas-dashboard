-- Check if new data was imported

-- 1. Count records in order_financials
SELECT
  'order_financials' AS table_name,
  COUNT(*) AS total_records,
  COUNT(DISTINCT order_id) AS unique_orders,
  MAX(created_time) AS latest_created_time,
  MAX(updated_at) AS latest_updated_at
FROM order_financials;

-- 2. Count records in sales_orders
SELECT
  'sales_orders' AS table_name,
  COUNT(*) AS total_records,
  COUNT(DISTINCT order_id) AS unique_orders,
  MAX(created_time) AS latest_created_time,
  MAX(updated_at) AS latest_updated_at
FROM sales_orders;

-- 3. Check records created today (Feb 4, 2026)
SELECT
  COUNT(DISTINCT order_id) AS orders_created_today
FROM order_financials
WHERE DATE(created_time AT TIME ZONE 'Asia/Bangkok') = '2026-02-04';

-- Expected: ~44 orders (ที่จะจัดส่ง)

-- 4. Check total for YTD (Jan 1 - Feb 4)
SELECT
  COUNT(DISTINCT order_id) AS total_orders_ytd,
  SUM(COALESCE(order_amount, 0)) AS total_amount_ytd
FROM order_financials
WHERE DATE(created_time AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-02-04';

-- Expected: ~1,948 orders, ~467,132.68 THB

-- 5. Check if there are records NOT in order_financials
SELECT
  COUNT(*) AS records_only_in_sales_orders
FROM sales_orders so
WHERE NOT EXISTS (
  SELECT 1 FROM order_financials of
  WHERE of.order_id = so.order_id::text
    AND of.created_by = so.created_by
);
