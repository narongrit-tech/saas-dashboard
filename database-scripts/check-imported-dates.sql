-- Check if newly imported data has correct dates

-- 1. Check Jan 16 orders (should be ~432, not 4)
SELECT
  COUNT(DISTINCT order_id) AS jan16_orders,
  SUM(order_amount) AS jan16_amount
FROM order_financials
WHERE DATE(created_time AT TIME ZONE 'Asia/Bangkok') = '2026-01-16';

-- Expected: ~432 orders, ~102,731 THB

-- 2. Check Jan 17 orders (should be ~41, not 453)
SELECT
  COUNT(DISTINCT order_id) AS jan17_orders,
  SUM(order_amount) AS jan17_amount
FROM order_financials
WHERE DATE(created_time AT TIME ZONE 'Asia/Bangkok') = '2026-01-17';

-- Expected: ~41 orders, ~9,991 THB

-- 3. Check sample orders on Jan 16 with timestamps
SELECT
  order_id,
  created_time,
  DATE(created_time AT TIME ZONE 'Asia/Bangkok') AS date_bkk,
  TO_CHAR(created_time AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS time_bkk,
  order_amount
FROM order_financials
WHERE DATE(created_time AT TIME ZONE 'Asia/Bangkok') = '2026-01-16'
ORDER BY created_time DESC
LIMIT 10;

-- 4. Check if there are orders with timestamp near midnight
SELECT
  order_id,
  created_time,
  DATE(created_time AT TIME ZONE 'Asia/Bangkok') AS date_bkk,
  TO_CHAR(created_time AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS time_bkk
FROM order_financials
WHERE DATE(created_time AT TIME ZONE 'Asia/Bangkok') IN ('2026-01-16', '2026-01-17')
  AND EXTRACT(HOUR FROM (created_time AT TIME ZONE 'Asia/Bangkok')) >= 23
ORDER BY created_time
LIMIT 20;
