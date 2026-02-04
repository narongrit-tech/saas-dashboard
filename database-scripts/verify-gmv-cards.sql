-- ============================================
-- Verification Queries for GMV Cards (B, C, Leakage)
-- Purpose: Validate GMV metrics against Excel exports
-- ============================================

-- INSTRUCTIONS:
-- 1. Replace 'YOUR_USER_ID' with your actual UUID
-- 2. Replace date ranges to match your test Excel export
-- 3. Run each query and compare with Excel pivot tables

-- ============================================
-- DEFINITIONS
-- ============================================
-- B (GMV Created) = SUM(order_amount) grouped by DATE(created_time) Bangkok
-- C (GMV Fulfilled) = SUM(order_amount) WHERE shipped_at IS NOT NULL grouped by DATE(shipped_at) Bangkok
-- Leakage = B - C (cancellations + unfulfilled orders)
-- Leakage % = (B - C) / B * 100

-- ============================================
-- QUERY 1: Test View Directly
-- ============================================

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
ORDER BY date_bkk DESC
LIMIT 10;

-- Expected:
-- All dates have data (or NULL for days with no orders)
-- orders_created >= orders_fulfilled (some orders not yet fulfilled)
-- gmv_created >= gmv_fulfilled
-- leakage_pct between 0-100


-- ============================================
-- QUERY 2: Compare B (GMV Created) vs Excel
-- ============================================
-- Excel Instructions:
-- 1. Open TikTok OrderSKUList.xlsx
-- 2. Create pivot table:
--    - Rows: Created Time (grouped by date)
--    - Values: COUNT(DISTINCT Order ID), SUM(Order Amount)
-- 3. Compare total_orders and total_gmv_created

-- Replace YOUR_USER_ID and date range
WITH db_created AS (
  SELECT
    COUNT(DISTINCT order_id) as total_orders,
    SUM(order_amount) as total_gmv_created
  FROM order_financials
  WHERE created_by = 'YOUR_USER_ID'
    AND created_time IS NOT NULL
    AND DATE(created_time AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
)
SELECT
  total_orders,
  ROUND(total_gmv_created, 2) as total_gmv_created,
  'Compare with Excel: COUNT(DISTINCT Order ID) and SUM(Order Amount) by Created Time date' as instruction
FROM db_created;

-- Expected:
-- total_orders = Excel COUNT(DISTINCT Order ID) with Created Time filter
-- total_gmv_created = Excel SUM(Order Amount) with Created Time filter


-- ============================================
-- QUERY 3: Compare C (GMV Fulfilled) vs Excel
-- ============================================
-- Excel Instructions:
-- 1. Open TikTok OrderSKUList.xlsx
-- 2. Filter: Shipped Time IS NOT BLANK
-- 3. Create pivot table:
--    - Rows: Shipped Time (grouped by date)
--    - Values: COUNT(DISTINCT Order ID), SUM(Order Amount)
-- 4. Compare total_fulfilled_orders and total_gmv_fulfilled

-- Replace YOUR_USER_ID and date range
WITH db_fulfilled AS (
  SELECT
    COUNT(DISTINCT order_id) as total_fulfilled_orders,
    SUM(order_amount) as total_gmv_fulfilled
  FROM order_financials
  WHERE created_by = 'YOUR_USER_ID'
    AND shipped_at IS NOT NULL
    AND DATE(shipped_at AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
)
SELECT
  total_fulfilled_orders,
  ROUND(total_gmv_fulfilled, 2) as total_gmv_fulfilled,
  'Compare with Excel: COUNT(DISTINCT Order ID) and SUM(Order Amount) WHERE Shipped Time NOT NULL' as instruction
FROM db_fulfilled;

-- Expected:
-- total_fulfilled_orders = Excel COUNT(DISTINCT Order ID) with Shipped Time NOT BLANK filter
-- total_gmv_fulfilled = Excel SUM(Order Amount) with Shipped Time NOT BLANK filter


-- ============================================
-- QUERY 4: Calculate Leakage Manually and Compare with View
-- ============================================

-- Replace YOUR_USER_ID and date range
WITH manual_calc AS (
  -- B: Created GMV
  SELECT
    COUNT(DISTINCT of1.order_id) as orders_created,
    SUM(of1.order_amount) as gmv_created
  FROM order_financials of1
  WHERE of1.created_by = 'YOUR_USER_ID'
    AND of1.created_time IS NOT NULL
    AND DATE(of1.created_time AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
),
manual_fulfilled AS (
  -- C: Fulfilled GMV
  SELECT
    COUNT(DISTINCT of2.order_id) as orders_fulfilled,
    SUM(of2.order_amount) as gmv_fulfilled
  FROM order_financials of2
  WHERE of2.created_by = 'YOUR_USER_ID'
    AND of2.shipped_at IS NOT NULL
    AND DATE(of2.shipped_at AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
),
manual_leakage AS (
  SELECT
    c.orders_created,
    ROUND(c.gmv_created, 2) as gmv_created,
    f.orders_fulfilled,
    ROUND(f.gmv_fulfilled, 2) as gmv_fulfilled,
    ROUND(c.gmv_created - f.gmv_fulfilled, 2) as leakage_amount,
    CASE
      WHEN c.gmv_created > 0 THEN
        ROUND(((c.gmv_created - f.gmv_fulfilled) / c.gmv_created) * 100, 2)
      ELSE 0
    END as leakage_pct
  FROM manual_calc c, manual_fulfilled f
),
view_agg AS (
  SELECT
    SUM(orders_created) as orders_created,
    ROUND(SUM(gmv_created), 2) as gmv_created,
    SUM(orders_fulfilled) as orders_fulfilled,
    ROUND(SUM(gmv_fulfilled), 2) as gmv_fulfilled,
    ROUND(SUM(leakage_amount), 2) as leakage_amount,
    ROUND(AVG(leakage_pct), 2) as leakage_pct_avg
  FROM sales_gmv_daily_summary
  WHERE created_by = 'YOUR_USER_ID'
    AND date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
)
SELECT
  'Manual Calculation' as source,
  m.orders_created,
  m.gmv_created,
  m.orders_fulfilled,
  m.gmv_fulfilled,
  m.leakage_amount,
  m.leakage_pct
FROM manual_leakage m
UNION ALL
SELECT
  'View Aggregation' as source,
  v.orders_created,
  v.gmv_created,
  v.orders_fulfilled,
  v.gmv_fulfilled,
  v.leakage_amount,
  v.leakage_pct_avg as leakage_pct
FROM view_agg v;

-- Expected:
-- Manual and View should match (within rounding error)
-- leakage_amount = gmv_created - gmv_fulfilled
-- leakage_pct = (leakage_amount / gmv_created) * 100


-- ============================================
-- QUERY 5: Per-Day Breakdown (Manual QA)
-- ============================================
-- Use this to spot-check individual days against Excel

-- Replace YOUR_USER_ID and date range
SELECT
  date_bkk,
  orders_created,
  ROUND(gmv_created, 2) as gmv_created,
  orders_fulfilled,
  ROUND(gmv_fulfilled, 2) as gmv_fulfilled,
  ROUND(leakage_amount, 2) as leakage_amount,
  ROUND(leakage_pct, 2) as leakage_pct
FROM sales_gmv_daily_summary
WHERE created_by = 'YOUR_USER_ID'
  AND date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
ORDER BY date_bkk DESC;

-- Excel Instructions:
-- 1. Create 2 pivot tables side by side:
--    a) Created Time (by date) → COUNT(DISTINCT Order ID), SUM(Order Amount)
--    b) Shipped Time (by date) → COUNT(DISTINCT Order ID), SUM(Order Amount)
-- 2. Compare per-day values with this query
-- 3. Spot-check 3-5 random dates for accuracy


-- ============================================
-- QUERY 6: Sanity Check - Leakage Should Be Positive
-- ============================================

-- Replace YOUR_USER_ID and date range
SELECT
  COUNT(*) as days_with_negative_leakage,
  ARRAY_AGG(date_bkk) FILTER (WHERE leakage_amount < 0) as negative_dates
FROM sales_gmv_daily_summary
WHERE created_by = 'YOUR_USER_ID'
  AND date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
  AND leakage_amount < 0;

-- Expected:
-- days_with_negative_leakage = 0 (leakage should always be >= 0)
-- If > 0: investigate negative_dates (data quality issue)


-- ============================================
-- QUERY 7: Check for Missing created_time
-- ============================================

-- Find orders with shipped_at but missing created_time (data quality)
-- Replace YOUR_USER_ID

SELECT
  COUNT(*) as missing_created_time_count,
  ARRAY_AGG(order_id) FILTER (WHERE created_time IS NULL) as sample_order_ids
FROM order_financials
WHERE created_by = 'YOUR_USER_ID'
  AND shipped_at IS NOT NULL
  AND created_time IS NULL
LIMIT 10;

-- Expected:
-- missing_created_time_count = 0 after backfill and re-import
-- If > 0: need to backfill created_time or re-import


-- ============================================
-- QUERY 8: Compare Source (order_financials vs sales_orders fallback)
-- ============================================

-- Check how much data comes from order_financials vs sales_orders fallback
-- Replace YOUR_USER_ID and date range

WITH of_count AS (
  SELECT COUNT(DISTINCT order_id) as from_order_financials
  FROM order_financials
  WHERE created_by = 'YOUR_USER_ID'
    AND created_time IS NOT NULL
    AND DATE(created_time AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
),
so_count AS (
  SELECT COUNT(DISTINCT order_id) as from_sales_orders_fallback
  FROM sales_orders
  WHERE created_by = 'YOUR_USER_ID'
    AND created_time IS NOT NULL
    AND DATE(created_time AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
    AND NOT EXISTS (
      SELECT 1 FROM order_financials of2
      WHERE of2.created_by = sales_orders.created_by
        AND of2.order_id = sales_orders.order_id
    )
)
SELECT
  of_count.from_order_financials,
  so_count.from_sales_orders_fallback,
  CASE
    WHEN of_count.from_order_financials + so_count.from_sales_orders_fallback > 0 THEN
      ROUND((of_count.from_order_financials::NUMERIC /
        (of_count.from_order_financials + so_count.from_sales_orders_fallback)) * 100, 2)
    ELSE 0
  END as pct_from_order_financials
FROM of_count, so_count;

-- Expected:
-- pct_from_order_financials > 95% (most data from order_financials)
-- If < 90%: need to re-import to populate order_financials


-- ============================================
-- QUERY 9: Test Empty Date Range
-- ============================================

-- Test view behavior with no data
SELECT *
FROM sales_gmv_daily_summary
WHERE created_by = 'YOUR_USER_ID'
  AND date_bkk BETWEEN '2099-01-01' AND '2099-01-31';

-- Expected: 0 rows (no errors)


-- ============================================
-- SUMMARY CHECKLIST
-- ============================================

/*
✅ PASS Criteria:
1. Query 1: View returns data for date range
2. Query 2: B (gmv_created) matches Excel SUM(Order Amount) by Created Time ±1%
3. Query 3: C (gmv_fulfilled) matches Excel SUM(Order Amount) WHERE Shipped Time NOT NULL ±1%
4. Query 4: Manual calculation matches view aggregation
5. Query 5: Spot-check 3+ days matches Excel per-day values
6. Query 6: No negative leakage values
7. Query 7: No missing created_time for shipped orders
8. Query 8: >90% data from order_financials (not fallback)
9. Query 9: Empty range returns 0 rows (no errors)

❌ FAIL Indicators:
- GMV mismatch >1% vs Excel → re-import TikTok data
- Negative leakage → data integrity issue
- Missing created_time → need backfill/re-import
- Low order_financials % → migration incomplete

Next Steps After Verification:
1. If PASS: Deploy to production ✅
2. If FAIL: Fix data issues, re-run verification
3. Document any known discrepancies (e.g., partial returns not supported)
*/

-- ============================================
-- END OF VERIFICATION
-- ============================================
