# QA: GMV Reconciliation (Order Financials)

**Purpose**: Validate GMV/Sales stability after migration-044 (order_financials table).

**Date**: 2026-02-03

**Related**: migration-044-order-financials.sql

---

## Overview

After implementing `order_financials` table:
- **GMV source of truth**: `order_financials.order_amount` (order-level)
- **Revenue recognition**: `shipped_at IS NOT NULL` (orders that have shipped)
- **Reconciliation target**: TikTok OrderSKUList Excel export (shipped orders)

---

## Pre-Migration Checklist

### 1. Backup Current Data
```sql
-- Count current sales_orders
SELECT
  COUNT(*) as total_rows,
  COUNT(DISTINCT order_id) as unique_orders,
  SUM(COALESCE(order_amount, total_amount)) as current_gmv
FROM sales_orders
WHERE shipped_at IS NOT NULL;
```

---

## Post-Migration Verification Queries

### 1. Verify Backfill Completed
```sql
-- Check backfilled orders from sales_orders
SELECT
  COUNT(*) as backfilled_orders,
  COUNT(*) FILTER (WHERE order_amount IS NOT NULL) as with_order_amount,
  COUNT(*) FILTER (WHERE shipped_at IS NOT NULL) as with_shipped_at,
  COUNT(*) FILTER (WHERE metadata->>'backfilled_from' = 'sales_orders') as marked_backfill
FROM order_financials;

-- Expected: backfilled_orders > 0, most have shipped_at
```

### 2. Compare Order Count (Excel vs DB)
```sql
-- Replace YOUR_USER_ID with actual UUID
-- Replace date range with Excel export date range

-- Count shipped orders in order_financials
SELECT COUNT(*) as db_shipped_orders
FROM order_financials
WHERE created_by = 'YOUR_USER_ID'
  AND shipped_at IS NOT NULL
  AND shipped_at::DATE BETWEEN '2026-01-01' AND '2026-01-31';

-- Count from Excel:
-- 1. Open TikTok OrderSKUList Excel
-- 2. Filter "Shipped Time" column: remove blanks
-- 3. Count unique "Order ID" values
-- Expected: db_shipped_orders ≈ Excel unique order count
```

### 3. Compare GMV Sum (Excel vs DB)
```sql
-- Replace YOUR_USER_ID with actual UUID
-- Replace date range

-- Sum shipped GMV from order_financials
SELECT
  SUM(order_amount) as db_gmv,
  COUNT(*) as db_orders,
  AVG(order_amount) as db_avg_order_value
FROM order_financials
WHERE created_by = 'YOUR_USER_ID'
  AND shipped_at IS NOT NULL
  AND shipped_at::DATE BETWEEN '2026-01-01' AND '2026-01-31';

-- Sum from Excel:
-- 1. Filter "Shipped Time" column: remove blanks
-- 2. Remove duplicate "Order ID" rows (keep first)
-- 3. SUM("Order Amount") column
-- Expected: db_gmv ≈ Excel SUM(Order Amount) for shipped, unique orders
```

### 4. Detect Missing Orders (in sales_orders but not in order_financials)
```sql
-- Find orders that exist in sales_orders with shipped_at but missing in order_financials
-- Replace YOUR_USER_ID

WITH so_shipped AS (
  SELECT DISTINCT order_id
  FROM sales_orders
  WHERE created_by = 'YOUR_USER_ID'
    AND shipped_at IS NOT NULL
)
SELECT
  COUNT(*) as missing_orders
FROM so_shipped
LEFT JOIN order_financials of USING(order_id)
WHERE of.order_id IS NULL;

-- Expected: missing_orders = 0 (all shipped orders migrated)
```

### 5. Detect NULL order_amount for Shipped Orders
```sql
-- Find shipped orders with NULL order_amount (data quality issue)
-- Replace YOUR_USER_ID

SELECT
  COUNT(*) as null_amount_shipped_orders,
  ARRAY_AGG(order_id) FILTER (WHERE order_amount IS NULL) as sample_order_ids
FROM order_financials
WHERE created_by = 'YOUR_USER_ID'
  AND shipped_at IS NOT NULL
  AND order_amount IS NULL
LIMIT 10;

-- Expected: null_amount_shipped_orders = 0 after re-import
-- If > 0: need to re-import TikTok OrderSKUList to populate order_amount
```

### 6. Per-Day GMV Comparison
```sql
-- Daily GMV breakdown for manual spot-check
-- Replace YOUR_USER_ID and date range

SELECT
  DATE(shipped_at AT TIME ZONE 'Asia/Bangkok') as ship_date,
  COUNT(*) as orders,
  SUM(order_amount) as gmv,
  AVG(order_amount) as aov
FROM order_financials
WHERE created_by = 'YOUR_USER_ID'
  AND shipped_at IS NOT NULL
  AND shipped_at::DATE BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY DATE(shipped_at AT TIME ZONE 'Asia/Bangkok')
ORDER BY ship_date DESC;

-- Compare per-day with Excel pivot table:
-- 1. Create pivot table: Rows = "Shipped Time" (grouped by date), Values = COUNT(DISTINCT Order ID), SUM(Order Amount)
-- 2. Compare daily gmv and orders
```

### 7. Verify View Integration (sales_orders_order_rollup)
```sql
-- Check that view correctly uses order_financials
-- Replace YOUR_USER_ID and date range

-- View aggregation
WITH view_agg AS (
  SELECT
    SUM(order_amount) as view_gmv,
    COUNT(*) as view_orders
  FROM sales_orders_order_rollup
  WHERE created_by = 'YOUR_USER_ID'
    AND order_date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
),
-- Direct order_financials aggregation
direct_agg AS (
  SELECT
    SUM(order_amount) as direct_gmv,
    COUNT(*) as direct_orders
  FROM order_financials
  WHERE created_by = 'YOUR_USER_ID'
    AND shipped_at IS NOT NULL
    AND DATE(shipped_at AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
)
SELECT
  view_gmv,
  direct_gmv,
  view_orders,
  direct_orders,
  CASE
    WHEN ABS(view_gmv - direct_gmv) < 1.0 THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as gmv_match,
  CASE
    WHEN view_orders = direct_orders THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as orders_match
FROM view_agg, direct_agg;

-- Expected: gmv_match = PASS, orders_match = PASS
```

---

## Post-Import Verification (After Re-Importing TikTok File)

### 8. Verify order_amount Populated
```sql
-- After re-importing TikTok OrderSKUList, check order_amount coverage
-- Replace YOUR_USER_ID

SELECT
  COUNT(*) as total_rows,
  COUNT(order_amount) as with_order_amount,
  COUNT(order_amount) * 100.0 / COUNT(*) as populate_pct,
  COUNT(*) FILTER (WHERE shipped_at IS NOT NULL AND order_amount IS NULL) as shipped_missing_amount
FROM order_financials
WHERE created_by = 'YOUR_USER_ID'
  AND source_platform ILIKE '%tiktok%';

-- Expected after re-import:
-- populate_pct > 95%
-- shipped_missing_amount = 0
```

### 9. Check Import Batch Linkage
```sql
-- Verify order_financials rows link to import_batch_id
-- Replace YOUR_USER_ID

SELECT
  ib.file_name,
  ib.created_at as import_date,
  COUNT(of.id) as order_count,
  SUM(of.order_amount) as batch_gmv
FROM order_financials of
JOIN import_batches ib ON of.import_batch_id = ib.id
WHERE of.created_by = 'YOUR_USER_ID'
GROUP BY ib.file_name, ib.created_at
ORDER BY ib.created_at DESC
LIMIT 10;

-- Expected: Recent imports show order_count > 0
```

---

## Rollback Verification

### 10. Test Import Rollback
```sql
-- After using "Replace Import" in UI, verify cleanup
-- Replace BATCH_ID with the replaced batch ID

-- Check order_financials deleted for replaced batch
SELECT COUNT(*) as orphaned_order_financials
FROM order_financials
WHERE import_batch_id = 'BATCH_ID';

-- Expected: orphaned_order_financials = 0 (cleaned up)
```

---

## Known Discrepancies (Expected)

1. **Cancelled After Ship**: Orders cancelled after shipping still count toward GMV (by design)
   - Filter: `shipped_at IS NOT NULL` (revenue recognition at ship time)
   - Cancelled orders with `shipped_at` are still revenue

2. **Partial Returns**: Not yet implemented (future enhancement)
   - Current GMV does not account for partial SKU returns

3. **Total_amount vs Order_amount**:
   - `total_amount` (sales_orders) = SKU-level line revenue
   - `order_amount` (order_financials) = TikTok order-level total (may differ due to shipping/fees)
   - **Always use order_amount for GMV**

---

## Troubleshooting

### Issue: GMV doesn't match Excel
**Check**:
1. Date range filter: Are you using `shipped_at` date or `order_date`?
   - **Correct**: Filter by `shipped_at::DATE` (ship date)
   - Excel: Filter by "Shipped Time" date
2. Order deduplication: Excel has duplicate SKU rows per order
   - **Correct**: Use `COUNT(DISTINCT order_id)` or query `order_financials` (already deduplicated)
3. Cancelled orders: Are cancelled-after-ship orders included?
   - **Correct**: Include orders where `shipped_at IS NOT NULL` regardless of cancellation

### Issue: NULL order_amount for shipped orders
**Solution**: Re-import TikTok OrderSKUList file
- New import will populate `order_financials.order_amount` from "Order Amount" column
- Backfill used fallback (max(total_amount)) which may be inaccurate

### Issue: Missing orders in order_financials
**Solution**: Run backfill SQL manually (see migration-044 STEP 5)
- Or wait for next import (will auto-populate missing orders)

---

## Sign-Off Checklist

- [ ] All verification queries return expected results
- [ ] GMV sum matches Excel export (within 1% tolerance)
- [ ] Shipped order count matches Excel unique orders
- [ ] NULL order_amount count = 0 for shipped orders
- [ ] View integration test passes
- [ ] Import rollback test passes
- [ ] Profit reports show correct GMV after rebuild

**Approved By**: _____________
**Date**: _____________
