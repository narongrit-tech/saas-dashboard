-- ============================================
-- DEBUG: Sales Date Mismatch (920 vs 1386)
-- Find why UI shows 920 orders but TikTok export shows 1386
-- Date Range: 2026-01-01 to 2026-01-28
-- ============================================

-- HYPOTHESIS: created_time IS NULL for some orders → filtered out by DB query

-- ============================================
-- CHECK 1: Total orders and lines in date range
-- ============================================

-- Using created_time (what UI uses at DB level)
SELECT
  'created_time filter' as method,
  COUNT(*) as lines_total,
  COUNT(DISTINCT external_order_id) as orders_distinct
FROM sales_orders
WHERE created_time >= '2026-01-01'
  AND created_time < '2026-01-29' -- end of day 2026-01-28
  AND source_platform = 'tiktok_shop';

-- Using created_time OR order_date (with fallback)
SELECT
  'created_time OR order_date' as method,
  COUNT(*) as lines_total,
  COUNT(DISTINCT external_order_id) as orders_distinct
FROM sales_orders
WHERE (
  created_time >= '2026-01-01'
  AND created_time < '2026-01-29'
)
OR (
  created_time IS NULL
  AND order_date >= '2026-01-01'
  AND order_date < '2026-01-29'
)
AND source_platform = 'tiktok_shop';

-- Using order_date only
SELECT
  'order_date only' as method,
  COUNT(*) as lines_total,
  COUNT(DISTINCT external_order_id) as orders_distinct
FROM sales_orders
WHERE order_date >= '2026-01-01'
  AND order_date < '2026-01-29'
  AND source_platform = 'tiktok_shop';

-- ============================================
-- CHECK 2: How many rows have NULL created_time?
-- ============================================

SELECT
  'created_time NULL count' as check_type,
  COUNT(*) as rows_with_null_created_time,
  COUNT(DISTINCT external_order_id) as orders_with_null_created_time,
  MIN(order_date) as min_order_date,
  MAX(order_date) as max_order_date
FROM sales_orders
WHERE created_time IS NULL
  AND order_date >= '2026-01-01'
  AND order_date < '2026-01-29'
  AND source_platform = 'tiktok_shop';

-- ============================================
-- CHECK 3: Sample orders with NULL created_time
-- ============================================

SELECT
  external_order_id,
  order_date,
  created_time,
  paid_time,
  total_amount,
  platform_status,
  payment_status,
  metadata->>'created_time' as metadata_created_time
FROM sales_orders
WHERE created_time IS NULL
  AND order_date >= '2026-01-01'
  AND order_date < '2026-01-29'
  AND source_platform = 'tiktok_shop'
ORDER BY order_date DESC
LIMIT 20;

-- ============================================
-- CHECK 4: Date filtering with Bangkok timezone
-- (Ensure we use correct date boundaries)
-- ============================================

-- Convert to Bangkok date and count
SELECT
  'Bangkok date filter' as method,
  COUNT(*) as lines_total,
  COUNT(DISTINCT external_order_id) as orders_distinct
FROM sales_orders
WHERE DATE(COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok') >= '2026-01-01'
  AND DATE(COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok') <= '2026-01-28'
  AND source_platform = 'tiktok_shop';

-- ============================================
-- CHECK 5: Migration-029 backfill coverage
-- ============================================

-- Check if migration-029 backfill worked
SELECT
  'migration-029 coverage' as check_type,
  COUNT(*) as total_rows,
  COUNT(created_time) as rows_with_created_time,
  COUNT(*) - COUNT(created_time) as rows_without_created_time,
  ROUND((COUNT(created_time)::decimal / NULLIF(COUNT(*), 0)) * 100, 2) as coverage_pct
FROM sales_orders
WHERE source_platform = 'tiktok_shop'
  AND order_date >= '2026-01-01'
  AND order_date < '2026-01-29';

-- ============================================
-- CHECK 6: Find "missing" orders (in DB but not in UI)
-- ============================================

-- Orders that should appear but don't (466 orders missing = 1386 - 920)
WITH ui_filter AS (
  SELECT DISTINCT external_order_id
  FROM sales_orders
  WHERE created_time >= '2026-01-01'
    AND created_time < '2026-01-29'
    AND source_platform = 'tiktok_shop'
),
all_orders AS (
  SELECT DISTINCT external_order_id
  FROM sales_orders
  WHERE (
    (created_time >= '2026-01-01' AND created_time < '2026-01-29')
    OR (created_time IS NULL AND order_date >= '2026-01-01' AND order_date < '2026-01-29')
  )
  AND source_platform = 'tiktok_shop'
)
SELECT
  a.external_order_id,
  CASE
    WHEN u.external_order_id IS NULL THEN 'MISSING_FROM_UI'
    ELSE 'IN_UI'
  END as status,
  COUNT(*) as count
FROM all_orders a
LEFT JOIN ui_filter u ON a.external_order_id = u.external_order_id
GROUP BY a.external_order_id, u.external_order_id
HAVING u.external_order_id IS NULL
ORDER BY a.external_order_id
LIMIT 50;

-- ============================================
-- EXPECTED RESULTS:
-- ============================================
-- If CHECK 2 shows > 0 rows with NULL created_time in date range:
--   → This is the root cause
--   → UI filter "created_time >= startDate" excludes these orders
--   → Need to fix query to use "COALESCE(created_time, order_date)"
--
-- If CHECK 2 shows 0 rows with NULL created_time:
--   → Problem is elsewhere (timezone, status filter, etc.)
--   → Investigate CHECK 4 (Bangkok timezone conversion)
-- ============================================
