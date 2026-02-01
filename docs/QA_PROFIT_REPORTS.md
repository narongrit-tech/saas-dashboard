# QA Checklist: Profit Reports Order-Level Rollup

**Feature:** Order-level GMV aggregation + Platform normalization for ads join
**Date:** 2026-02-01
**Migration:** 042
**Tester:** _______________

## Overview

**What Changed:**
- Created view `sales_orders_order_rollup` for order-level rollup (1 row per order_id)
- Updated `rebuild_profit_summaries()` to use rollup view for platform_net_profit_daily
- Fixed platform mapping: "TikTok Shop" → "tiktok" for ads join
- GMV now calculated as SUM(MAX(total_amount) per order_id) to handle SKU-level duplicates

**Why:**
- TikTok OrderSKUList creates multiple rows per order_id (SKU-level)
- Previous SUM(total_amount) across all SKU rows inflated GMV
- Platform mismatch prevented ads spend attribution

## Prerequisites

- [ ] Migration 042 applied to database
- [ ] Sales orders exist with source_platform containing "TikTok Shop", "Shopee", etc.
- [ ] Ad performance data exists with marketplace = 'tiktok', 'shopee', etc.
- [ ] User has run "Rebuild Summaries" after migration

## QA SQL Queries (Copy/Paste)

### A) Rollup View GMV Validation

**Purpose:** Verify rollup view GMV equals manual order-level MAX aggregation

```sql
-- Replace YOUR_USER_ID with actual UUID
-- Replace date range as needed

-- 1. GMV from rollup view
SELECT
  SUM(order_amount) as rollup_gmv
FROM sales_orders_order_rollup
WHERE created_by = 'YOUR_USER_ID'
  AND order_date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
  AND platform_status NOT IN ('Cancelled', 'Refunded');

-- 2. GMV from manual order-level MAX aggregation
SELECT
  SUM(max_amt) as manual_gmv
FROM (
  SELECT
    order_id,
    MAX(total_amount) as max_amt
  FROM sales_orders
  WHERE created_by = 'YOUR_USER_ID'
    AND DATE(order_date AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
    AND platform_status NOT IN ('Cancelled', 'Refunded')
  GROUP BY order_id
) t;

-- 3. Compare: Should be EQUAL (within rounding error)
-- Expected: rollup_gmv = manual_gmv
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### B) Platform Mapping Verification

**Purpose:** Verify source_platform → platform_key mapping

```sql
-- Check distinct platform mappings
SELECT DISTINCT
  platform_raw,
  platform_key,
  COUNT(*) as order_count
FROM sales_orders_order_rollup
WHERE created_by = 'YOUR_USER_ID'
GROUP BY platform_raw, platform_key
ORDER BY order_count DESC;

-- Expected mappings:
-- 'TikTok Shop' → 'tiktok'
-- 'Shopee' → 'shopee'
-- 'Lazada' → 'lazada'
-- NULL or empty → 'unknown'
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### C) Ads Marketplace Join Compatibility

**Purpose:** Verify ad_daily_performance.marketplace matches rollup platform_key

```sql
-- 1. Distinct marketplace values in ads
SELECT DISTINCT marketplace, COUNT(*) as ad_rows
FROM ad_daily_performance
WHERE created_by = 'YOUR_USER_ID'
  AND ad_date BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY marketplace
ORDER BY ad_rows DESC;

-- Expected: 'tiktok', 'shopee', etc. (lowercase, no spaces)

-- 2. Distinct platform_key values in rollup
SELECT DISTINCT platform_key, COUNT(*) as order_rows
FROM sales_orders_order_rollup
WHERE created_by = 'YOUR_USER_ID'
  AND order_date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY platform_key
ORDER BY order_rows DESC;

-- 3. Check join success rate
SELECT
  s.platform_key,
  COUNT(DISTINCT s.order_id) as orders_with_platform,
  COUNT(DISTINCT CASE WHEN ads.ad_date IS NOT NULL THEN s.order_date_bkk END) as days_with_ads
FROM sales_orders_order_rollup s
LEFT JOIN ad_daily_performance ads
  ON ads.ad_date = s.order_date_bkk
  AND ads.marketplace = s.platform_key
  AND ads.created_by = 'YOUR_USER_ID'
WHERE s.created_by = 'YOUR_USER_ID'
  AND s.order_date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY s.platform_key;

-- Expected: days_with_ads > 0 for platforms with ad spend
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### D) platform_net_profit_daily Rows After Rebuild

**Purpose:** Verify summary table populated correctly

```sql
-- Replace YOUR_USER_ID
-- Ensure Rebuild Summaries was run for 2026-01-01 to 2026-01-31

-- 1. Check rows exist
SELECT
  COUNT(*) as total_rows,
  MIN(date) as min_date,
  MAX(date) as max_date,
  COUNT(DISTINCT date) as distinct_dates,
  COUNT(DISTINCT platform) as distinct_platforms
FROM platform_net_profit_daily
WHERE created_by = 'YOUR_USER_ID'
  AND date BETWEEN '2026-01-01' AND '2026-01-31';

-- Expected:
-- total_rows > 0
-- distinct_dates = number of days with orders in range
-- distinct_platforms = platforms used (tiktok, shopee, etc.)

-- 2. Check GMV matches rollup
SELECT
  SUM(gmv) as summary_gmv
FROM platform_net_profit_daily
WHERE created_by = 'YOUR_USER_ID'
  AND date BETWEEN '2026-01-01' AND '2026-01-31';

-- Compare with Query A rollup_gmv: Should be EQUAL

-- 3. Check ads_spend is populated (if ads exist)
SELECT
  platform,
  SUM(ads_spend) as total_ads
FROM platform_net_profit_daily
WHERE created_by = 'YOUR_USER_ID'
  AND date BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY platform;

-- Expected: ads_spend > 0 for platforms with ad_daily_performance data
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### E) product_profit_daily Uniqueness Check

**Purpose:** Verify no duplicate key violations

```sql
-- Check for duplicate keys (should return 0 rows)
SELECT
  created_by,
  date,
  platform,
  product_id,
  COUNT(*) as row_count
FROM product_profit_daily
WHERE created_by = 'YOUR_USER_ID'
  AND date BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY created_by, date, platform, product_id
HAVING COUNT(*) > 1;

-- Expected: 0 rows (no duplicates)
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### F) Product Revenue Sanity Check

**Purpose:** Verify product-level revenue matches SKU-level sum

```sql
-- 1. Product revenue from summary table
SELECT
  SUM(revenue) as product_summary_revenue
FROM product_profit_daily
WHERE created_by = 'YOUR_USER_ID'
  AND date BETWEEN '2026-01-01' AND '2026-01-31';

-- 2. SKU-level revenue from sales_orders (direct)
SELECT
  SUM(total_amount) as sku_level_revenue
FROM sales_orders
WHERE created_by = 'YOUR_USER_ID'
  AND DATE(order_date AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
  AND platform_status NOT IN ('Cancelled', 'Refunded');

-- Expected: product_summary_revenue = sku_level_revenue
-- (Product revenue is SKU-level, not order-level)
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### G) source_split_daily Uniqueness Check

**Purpose:** Verify source split rows are unique

```sql
-- Check for duplicate keys (should return 0 rows)
SELECT
  created_by,
  date,
  platform,
  source_bucket,
  COUNT(*) as row_count
FROM source_split_daily
WHERE created_by = 'YOUR_USER_ID'
  AND date BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY created_by, date, platform, source_bucket
HAVING COUNT(*) > 1;

-- Expected: 0 rows (no duplicates)
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### H) Order Count Verification

**Purpose:** Verify order counts match between rollup and summary

```sql
-- 1. Distinct orders in rollup view
SELECT
  COUNT(DISTINCT order_id) as rollup_order_count
FROM sales_orders_order_rollup
WHERE created_by = 'YOUR_USER_ID'
  AND order_date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
  AND platform_status NOT IN ('Cancelled', 'Refunded');

-- 2. Sum of orders in source_split_daily
SELECT
  SUM(orders) as source_split_order_count
FROM source_split_daily
WHERE created_by = 'YOUR_USER_ID'
  AND date BETWEEN '2026-01-01' AND '2026-01-31';

-- Expected: rollup_order_count = source_split_order_count
-- (Each order appears exactly once per source bucket)
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### I) D1-D Platform Net Profit Validation (Manual)

**Purpose:** Verify Profit Reports UI matches SQL

```sql
-- Platform Net Profit for January 2026
SELECT
  platform,
  SUM(gmv) as total_gmv,
  SUM(ads_spend) as total_ads,
  SUM(cogs) as total_cogs,
  SUM(net_profit) as total_profit,
  CASE
    WHEN SUM(gmv) > 0 THEN (SUM(net_profit) / SUM(gmv)) * 100
    ELSE 0
  END as profit_margin_pct
FROM platform_net_profit_daily
WHERE created_by = 'YOUR_USER_ID'
  AND date BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY platform
ORDER BY total_gmv DESC;

-- Steps:
-- 1. Run this query
-- 2. Open Profit Reports page, select Jan 2026, platform filter = all
-- 3. Compare D1-D table totals with SQL results

-- Expected: GMV, Ads, COGS, Net Profit match (within rounding)
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

## Edge Cases

### EC-001: Orders with Multiple SKUs (Same Order ID)

**Scenario:** Order has 3 SKUs with different total_amount values

**Setup:**
```sql
-- Insert test order with SKU duplicates
INSERT INTO sales_orders (order_id, seller_sku, product_name, total_amount, source_platform, platform_status, created_by, order_date)
VALUES
  ('TEST-001', 'SKU-A', 'Product A', 100.00, 'TikTok Shop', 'Delivered', 'YOUR_USER_ID', '2026-01-15 10:00:00+07'),
  ('TEST-001', 'SKU-B', 'Product B', 100.00, 'TikTok Shop', 'Delivered', 'YOUR_USER_ID', '2026-01-15 10:00:00+07'),
  ('TEST-001', 'SKU-C', 'Product C', 100.00, 'TikTok Shop', 'Delivered', 'YOUR_USER_ID', '2026-01-15 10:00:00+07');
```

**Expected:**
- Rollup view: 1 row, order_amount = 100.00 (MAX)
- platform_net_profit_daily: GMV contribution = 100.00 (not 300.00)
- product_profit_daily: 3 rows (SKU-level), total revenue = 300.00

**Query:**
```sql
SELECT order_amount FROM sales_orders_order_rollup WHERE order_id = 'TEST-001';
-- Expected: 100.00

SELECT SUM(revenue) FROM product_profit_daily WHERE date = '2026-01-15' AND platform = 'tiktok';
-- Expected: includes 300.00 from TEST-001 (SKU-level)
```

**Result:** PASS / FAIL

---

### EC-002: Platform Name Variations

**Scenario:** Orders with platform names: "TikTok Shop", "TIKTOK", "tiktok shop"

**Expected:**
- All map to platform_key = 'tiktok'

**Query:**
```sql
SELECT DISTINCT platform_raw, platform_key
FROM sales_orders_order_rollup
WHERE platform_raw ILIKE '%tiktok%';

-- Expected: All rows have platform_key = 'tiktok'
```

**Result:** PASS / FAIL

---

### EC-003: Missing Ads Data

**Scenario:** Orders exist but no ad_daily_performance for same date/platform

**Expected:**
- platform_net_profit_daily: ads_spend = 0
- No errors during rebuild

**Query:**
```sql
SELECT date, platform, gmv, ads_spend
FROM platform_net_profit_daily
WHERE created_by = 'YOUR_USER_ID'
  AND date = '2026-01-XX' -- date with no ads
  AND platform = 'tiktok';

-- Expected: ads_spend = 0 (not NULL)
```

**Result:** PASS / FAIL

---

## Regression Tests

### RT-001: Rebuild Summaries Button Works

**Steps:**
1. Navigate to /reports/profit
2. Select date range: 2026-01-01 to 2026-01-31
3. Click "Rebuild Summaries"

**Expected:**
- Toast: "Rebuild Complete (X rows affected)"
- Console: "[Rebuild] Success: { userId: ..., rowsAffected: X }"
- No errors

**Result:** PASS / FAIL

---

### RT-002: D1-D Platform Net Profit Shows Data

**Steps:**
1. After rebuild, refresh Profit Reports page
2. Check D1-D table (Platform Net Profit)

**Expected:**
- Rows displayed for each platform
- GMV > 0
- Ads Spend > 0 (if ads exist)
- Net Profit calculated

**Result:** PASS / FAIL

---

### RT-003: D1-B Product Profit Shows Data

**Steps:**
1. Check D1-B table (Product Profit)

**Expected:**
- Rows displayed for each product
- Revenue > 0
- Allocated Ads > 0 (if ads exist)
- Margin calculated

**Result:** PASS / FAIL

---

## Performance Tests

### PT-001: Rollup View Performance

**Query:**
```sql
EXPLAIN ANALYZE
SELECT *
FROM sales_orders_order_rollup
WHERE created_by = 'YOUR_USER_ID'
  AND order_date_bkk BETWEEN '2026-01-01' AND '2026-01-31';
```

**Expected:** < 500ms for 10,000 orders

**Result:** ___ ms

---

### PT-002: Rebuild Function Performance

**Query:**
```sql
SELECT rebuild_profit_summaries(
  'YOUR_USER_ID'::uuid,
  '2026-01-01'::date,
  '2026-01-31'::date
);
```

**Expected:** < 10 seconds for 10,000 orders

**Result:** ___ seconds

---

## Summary

**Total Test Cases:** 9 Main + 3 Edge + 3 Regression + 2 Performance = 17
**Passed:** ___
**Failed:** ___
**Blocked:** ___

**Critical Issues Found:**
- _______________________________________________
- _______________________________________________

**Minor Issues Found:**
- _______________________________________________
- _______________________________________________

**Sign-off:**
- [ ] All critical test cases passed
- [ ] Rollup GMV matches manual calculation (Query A)
- [ ] Platform mapping correct (Query B)
- [ ] Ads join working (Query C)
- [ ] No duplicate key violations (Queries E, G)
- [ ] D1-D UI matches SQL (Query I)
- [ ] Ready for production

**Tester Signature:** _______________ **Date:** _______________
**Reviewer Signature:** _______________ **Date:** _______________

---

## Quick Reference: Key Queries

**Get Your User ID:**
```sql
SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';
```

**Check Rollup View Row Count:**
```sql
SELECT COUNT(*) FROM sales_orders_order_rollup WHERE created_by = 'YOUR_USER_ID';
```

**Check Summary Tables Row Count:**
```sql
SELECT
  (SELECT COUNT(*) FROM platform_net_profit_daily WHERE created_by = 'YOUR_USER_ID') as platform_rows,
  (SELECT COUNT(*) FROM product_profit_daily WHERE created_by = 'YOUR_USER_ID') as product_rows,
  (SELECT COUNT(*) FROM source_split_daily WHERE created_by = 'YOUR_USER_ID') as source_rows;
```

**Force Rebuild:**
```sql
SELECT rebuild_profit_summaries(
  'YOUR_USER_ID'::uuid,
  '2026-01-01'::date,
  '2026-01-31'::date
);
```

---

**Document Version:** 1.0
**Last Updated:** 2026-02-01
**Maintained By:** Development Team
