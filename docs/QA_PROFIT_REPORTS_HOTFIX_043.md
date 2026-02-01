# QA Checklist: Profit Reports Hotfix (Migration 043)

**Feature:** Fix GMV calculation + Ads/COGS join multiplication
**Date:** 2026-02-02
**Migration:** 043
**Tester:** _______________

## Overview

**What Changed:**
- Added order-level columns to sales_orders (order_amount, shipping_fee_after_discount, etc.)
- Updated sales_orders_order_rollup view to use COALESCE(order_amount, total_amount)
- Fixed rebuild_profit_summaries() to pre-aggregate ads and COGS before joining
- Updated TikTok OrderSKUList importer to populate new order-level fields

**Why:**
- GMV must be order-level, not SKU-level (prevent double/triple counting)
- Ads spend join multiplication: multiple ad rows per day/platform multiplied spend
- COGS join multiplication: multiple allocation rows per order multiplied COGS
- Missing order-level fields from TikTok import caused data loss

## Prerequisites

- [ ] Migration 043 applied to database
- [ ] Re-import TikTok OrderSKUList after migration (to populate order_amount)
- [ ] Run "Rebuild Summaries" for Jan 2026 after re-import
- [ ] User has both sales orders and ad_daily_performance data

---

## QA Verification Queries

### Query A: Expected GMV (Order-Level Manual Calculation)

**Purpose:** Calculate GMV manually using order-level MAX aggregation

```sql
-- Replace YOUR_USER_ID with actual UUID
-- Replace date range as needed

SELECT SUM(order_gmv) as expected_gmv
FROM (
  SELECT
    order_id,
    COALESCE(MAX(order_amount), MAX(total_amount)) as order_gmv
  FROM sales_orders
  WHERE created_by = 'YOUR_USER_ID'
    AND DATE(order_date AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
    AND platform_status NOT IN ('Cancelled', 'Refunded')
  GROUP BY order_id
) t;
```

**Expected Result:** Total GMV in THB (e.g., 300,000.00)

**Result:** _______________ THB

---

### Query B: Rollup View GMV

**Purpose:** Verify rollup view matches manual calculation

```sql
SELECT SUM(order_amount) as rollup_gmv
FROM sales_orders_order_rollup
WHERE created_by = 'YOUR_USER_ID'
  AND order_date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
  AND platform_status NOT IN ('Cancelled', 'Refunded');
```

**Expected Result:** Should EQUAL Query A result

**Result:** _______________ THB

**Match Query A?** ☐ YES ☐ NO

---

### Query C: Ads Total from Source Table

**Purpose:** Verify ads spend total BEFORE join

```sql
-- Replace date range and platform as needed
SELECT
  marketplace,
  SUM(spend) as total_ads_spend,
  COUNT(*) as ad_rows
FROM ad_daily_performance
WHERE created_by = 'YOUR_USER_ID'
  AND ad_date BETWEEN '2026-01-01' AND '2026-01-31'
  AND campaign_type != 'live'
  AND marketplace = 'tiktok'  -- Change to shopee, lazada, etc. if needed
GROUP BY marketplace;
```

**Expected Result:** Total ads spend per platform

**Result:**
- tiktok: _______________ THB (___ rows)
- shopee: _______________ THB (___ rows)

---

### Query D: Platform Net Profit Ads Spend (After Rebuild)

**Purpose:** Verify ads spend in summary table matches source (no multiplication)

```sql
SELECT
  platform,
  SUM(ads_spend) as summary_ads_spend,
  COUNT(*) as summary_rows
FROM platform_net_profit_daily
WHERE created_by = 'YOUR_USER_ID'
  AND date BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY platform;
```

**Expected Result:** Should EQUAL Query C for each platform

**Result:**
- tiktok: _______________ THB (___ rows)
- shopee: _______________ THB (___ rows)

**Match Query C?** ☐ YES ☐ NO

---

### Query E: COGS Total from Source Table

**Purpose:** Verify COGS total BEFORE join

```sql
SELECT
  SUM(amount) as total_cogs,
  COUNT(*) as cogs_rows,
  COUNT(DISTINCT order_id) as unique_orders_with_cogs
FROM inventory_cogs_allocations
WHERE created_by = 'YOUR_USER_ID'
  AND is_reversal = false
  AND order_id IN (
    SELECT order_id
    FROM sales_orders
    WHERE created_by = 'YOUR_USER_ID'
      AND DATE(order_date AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
      AND platform_status NOT IN ('Cancelled', 'Refunded')
  );
```

**Expected Result:** Total COGS in THB

**Result:** _______________ THB (___ rows, ___ unique orders)

---

### Query F: Platform Net Profit COGS (After Rebuild)

**Purpose:** Verify COGS in summary table matches source (no multiplication)

```sql
SELECT
  SUM(cogs) as summary_cogs
FROM platform_net_profit_daily
WHERE created_by = 'YOUR_USER_ID'
  AND date BETWEEN '2026-01-01' AND '2026-01-31';
```

**Expected Result:** Should EQUAL Query E result

**Result:** _______________ THB

**Match Query E?** ☐ YES ☐ NO

---

### Query G: New Order-Level Columns Populated

**Purpose:** Verify new columns are populated from import

```sql
-- Check if order_amount is populated (should be non-null for TikTok orders after re-import)
SELECT
  COUNT(*) as total_rows,
  COUNT(order_amount) as with_order_amount,
  COUNT(shipping_fee_after_discount) as with_shipping,
  COUNT(taxes) as with_taxes,
  AVG(order_amount) as avg_order_amount
FROM sales_orders
WHERE created_by = 'YOUR_USER_ID'
  AND DATE(order_date AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
  AND source_platform ILIKE '%tiktok%';
```

**Expected Result:**
- with_order_amount should be > 0 (ideally = total_rows if re-imported)
- avg_order_amount should be reasonable (e.g., 100-5000 THB)

**Result:**
- Total rows: _______________
- With order_amount: _______________
- With shipping: _______________
- With taxes: _______________
- Avg order amount: _______________ THB

---

### Query H: GMV Comparison (Before vs After)

**Purpose:** Compare platform_net_profit_daily GMV before/after hotfix

**Before Hotfix (Query old data if backed up):**
```sql
-- If you backed up platform_net_profit_daily before rebuild:
SELECT SUM(gmv) as old_gmv FROM platform_net_profit_daily_backup
WHERE created_by = 'YOUR_USER_ID'
  AND date BETWEEN '2026-01-01' AND '2026-01-31';
```

**After Hotfix:**
```sql
SELECT SUM(gmv) as new_gmv FROM platform_net_profit_daily
WHERE created_by = 'YOUR_USER_ID'
  AND date BETWEEN '2026-01-01' AND '2026-01-31';
```

**Expected Result:**
- new_gmv should be LOWER than old_gmv (if SKU duplicates existed)
- Reduction: typically 30-50% for TikTok orders with 2-3 SKUs per order average

**Result:**
- Old GMV: _______________ THB (if available)
- New GMV: _______________ THB
- Reduction: _______________% (expected: 30-50%)

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

**Result:** ☐ PASS ☐ FAIL

**Notes:** _______________________________________________

---

### RT-002: Platform Net Profit Shows Correct Data

**Steps:**
1. After rebuild, refresh Profit Reports page
2. Check D1-D table (Platform Net Profit)
3. Compare with Query D results

**Expected:**
- GMV matches Query B (rollup view)
- Ads Spend matches Query C (no multiplication)
- COGS matches Query E (no multiplication)
- Net Profit = GMV - Ads - COGS

**Result:** ☐ PASS ☐ FAIL

**Notes:** _______________________________________________

---

### RT-003: Re-Import TikTok OrderSKUList Populates New Fields

**Steps:**
1. Download fresh TikTok OrderSKUList from TikTok Seller Center (Jan 2026)
2. Import via Sales Import
3. Check Query G to verify order_amount populated

**Expected:**
- order_amount populated for new imports
- Import succeeds without errors
- Dedupe still works (no duplicate order lines)

**Result:** ☐ PASS ☐ FAIL

**Notes:** _______________________________________________

---

## Edge Cases

### EC-001: Orders Without order_amount (Historical Data)

**Scenario:** Old imports before migration 043 don't have order_amount

**Expected Behavior:**
- Rollup view uses COALESCE(order_amount, total_amount)
- Historical data still works (uses total_amount as fallback)
- GMV calculated correctly (MAX per order_id)

**Verify:**
```sql
SELECT
  COUNT(*) as orders_without_order_amount,
  SUM(order_amount) as gmv_from_fallback
FROM sales_orders_order_rollup
WHERE created_by = 'YOUR_USER_ID'
  AND order_date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
  AND order_amount IS NOT NULL;  -- These used MAX(total_amount)
```

**Result:** ☐ PASS ☐ FAIL

---

### EC-002: Multiple Ad Rows Per Day/Platform

**Scenario:** ad_daily_performance has 5 rows for 2026-01-15 / tiktok

**Expected Behavior:**
- Pre-aggregated daily_ads CTE sums to single row per day/platform
- Join to orders is 1:1 (no multiplication)
- platform_net_profit_daily shows correct total spend

**Verify:**
```sql
-- Check if any day/platform has multiple ad rows (should be aggregated in rebuild)
SELECT ad_date, marketplace, COUNT(*) as ad_rows
FROM ad_daily_performance
WHERE created_by = 'YOUR_USER_ID'
  AND ad_date BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY ad_date, marketplace
HAVING COUNT(*) > 1;
```

**If rows > 1 exist:** Verify Query D still matches Query C (no multiplication)

**Result:** ☐ PASS ☐ FAIL

---

### EC-003: Multiple COGS Allocations Per Order

**Scenario:** Order has 3 SKUs, each with COGS allocation (3 rows)

**Expected Behavior:**
- Pre-aggregated cogs_by_order CTE sums to single row per order_id
- Join to orders is 1:1 (no multiplication)
- platform_net_profit_daily shows correct total COGS

**Verify:**
```sql
-- Check if any order has multiple COGS rows (should be aggregated in rebuild)
SELECT order_id, COUNT(*) as cogs_rows, SUM(amount) as total_cogs
FROM inventory_cogs_allocations
WHERE created_by = 'YOUR_USER_ID'
  AND is_reversal = false
  AND order_id IN (
    SELECT order_id FROM sales_orders_order_rollup
    WHERE created_by = 'YOUR_USER_ID'
      AND order_date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
  )
GROUP BY order_id
HAVING COUNT(*) > 1
LIMIT 5;
```

**If rows > 1 exist:** Verify Query F still matches Query E (no multiplication)

**Result:** ☐ PASS ☐ FAIL

---

## Performance Tests

### PT-001: Rebuild Performance

**Query:**
```sql
SELECT rebuild_profit_summaries(
  'YOUR_USER_ID'::uuid,
  '2026-01-01'::date,
  '2026-01-31'::date
);
```

**Expected:** < 15 seconds for 10,000 orders

**Result:** _______________ seconds

---

## Summary

**Total Test Cases:** 8 Main + 3 Edge + 1 Performance = 12

**Passed:** ___________
**Failed:** ___________
**Blocked:** ___________

**Critical Issues Found:**
- _______________________________________________
- _______________________________________________

**Minor Issues Found:**
- _______________________________________________
- _______________________________________________

**Sign-off:**
- [ ] All critical test cases passed
- [ ] Query A = Query B (rollup GMV correct)
- [ ] Query C = Query D (ads no multiplication)
- [ ] Query E = Query F (COGS no multiplication)
- [ ] New fields populated (Query G)
- [ ] Re-import works (RT-003)
- [ ] Ready for production

**Tester Signature:** _______________ **Date:** _______________
**Reviewer Signature:** _______________ **Date:** _______________

---

## Quick Reference: Key Queries

**Get Your User ID:**
```sql
SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';
```

**Force Rebuild:**
```sql
SELECT rebuild_profit_summaries(
  'YOUR_USER_ID'::uuid,
  '2026-01-01'::date,
  '2026-01-31'::date
);
```

**Check Rollup View:**
```sql
SELECT * FROM sales_orders_order_rollup
WHERE created_by = 'YOUR_USER_ID'
  AND order_date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
LIMIT 10;
```

---

## Rollback Plan

**If GMV still wrong:**
1. Check if order_amount is populated (Query G)
2. If not populated: Re-import TikTok OrderSKUList
3. If populated but wrong: Check rollup view definition

**If ads spend multiplied:**
1. Check Query C vs Query D
2. If D > C: daily_ads CTE not working
3. Check for multiple ad rows per day/platform (EC-002)

**If COGS multiplied:**
1. Check Query E vs Query F
2. If F > E: cogs_by_order CTE not working
3. Check for multiple COGS rows per order (EC-003)

**Revert Migration (Last Resort):**
```sql
-- Restore migration-042 function (copy from migration-042 file)
-- Drop new columns (data loss warning):
ALTER TABLE sales_orders DROP COLUMN IF EXISTS order_amount;
ALTER TABLE sales_orders DROP COLUMN IF EXISTS shipping_fee_after_discount;
-- etc.
```

---

**Document Version:** 1.0
**Last Updated:** 2026-02-02
**Maintained By:** Development Team
