# Manual Test Guide: Migration 048 - Sales Aggregates

## Prerequisites

1. **Database Access:** Ability to run SQL commands via psql or Supabase SQL Editor
2. **Test Data:** At least 100 sales orders with variety (different platforms, dates, statuses)
3. **User ID:** Know your test user's UUID

## Test Environment Setup

### 1. Get Your User ID

```sql
SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';
```

**Save this UUID** - you'll use it throughout testing.

### 2. Check Existing Data

```sql
-- Count orders by platform
SELECT
    source_platform,
    COUNT(*) AS order_count,
    MIN(created_at::DATE) AS earliest_date,
    MAX(created_at::DATE) AS latest_date
FROM sales_orders
WHERE created_by = 'YOUR-USER-ID'
GROUP BY source_platform
ORDER BY order_count DESC;
```

**Expected:** Should see orders distributed across platforms and dates.

## Phase 1: Function Verification

### Test 1.1: Function Exists

```sql
\df get_sales_aggregates
\df get_sales_aggregates_tiktok_like
\df get_sales_story_aggregates
```

**Expected Output:**
```
Schema | Name                            | Result data type | Argument data types
-------+---------------------------------+------------------+--------------------
public | get_sales_aggregates            | TABLE(...)       | p_user_id uuid, ...
public | get_sales_aggregates_tiktok_like| TABLE(...)       | p_user_id uuid, ...
public | get_sales_story_aggregates      | TABLE(...)       | p_user_id uuid, ...
```

**✅ Pass Criteria:** All 3 functions exist

### Test 1.2: Indexes Exist

```sql
SELECT indexname FROM pg_indexes
WHERE tablename = 'sales_orders'
  AND indexname LIKE '%user%'
ORDER BY indexname;
```

**Expected Output:**
```
indexname
----------------------------------
idx_sales_orders_cancelled_time_user
idx_sales_orders_created_at_user
idx_sales_orders_created_time_user
idx_sales_orders_paid_time_user
idx_sales_orders_user_platform_dates
```

**✅ Pass Criteria:** All 5 indexes exist

## Phase 2: Basic Functionality Tests

### Test 2.1: Simple Aggregation (All Orders)

```sql
SELECT * FROM get_sales_aggregates(
    'YOUR-USER-ID'::UUID,
    '2026-01-01'::DATE,
    '2026-02-28'::DATE,
    'order',  -- date basis
    NULL,     -- all platforms
    NULL,     -- all statuses
    NULL      -- all payment statuses
);
```

**✅ Pass Criteria:**
- Returns single row with 12 columns
- `revenue_gross >= revenue_net` (gross includes cancels, net excludes)
- `orders_gross >= orders_net`
- `cancel_rate_revenue_pct` between 0-100
- `cancel_rate_orders_pct` between 0-100
- `aov_net = revenue_net / orders_net` (or 0 if orders_net = 0)
- `lines_total >= orders_distinct` (multi-SKU orders exist)

**Example Output:**
```
revenue_gross | revenue_net | cancelled_same_day_amount | orders_gross | orders_net | ...
-------------+-------------+--------------------------+--------------+------------+-----
150000.00    | 140000.00   | 10000.00                 | 120          | 110        | ...
```

### Test 2.2: Platform Filter (TikTok Only)

```sql
SELECT * FROM get_sales_aggregates(
    'YOUR-USER-ID'::UUID,
    '2026-01-01'::DATE,
    '2026-02-28'::DATE,
    'order',
    'tiktok_shop', -- TikTok only
    NULL,
    NULL
);
```

**✅ Pass Criteria:**
- `orders_distinct` should be <= Test 2.1 result
- Only TikTok orders counted

**Verify:**
```sql
-- Manual count for TikTok orders
SELECT COUNT(DISTINCT COALESCE(external_order_id, order_id)) AS tiktok_orders
FROM sales_orders
WHERE created_by = 'YOUR-USER-ID'
  AND source_platform = 'tiktok_shop'
  AND (COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok')::DATE >= '2026-01-01'
  AND (COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok')::DATE <= '2026-02-28';
```

**Should match** `orders_distinct` from RPC result.

### Test 2.3: Date Basis (Paid)

```sql
SELECT * FROM get_sales_aggregates(
    'YOUR-USER-ID'::UUID,
    '2026-01-01'::DATE,
    '2026-02-28'::DATE,
    'paid',  -- paid basis (only paid orders)
    NULL,
    NULL,
    'paid'   -- paid status
);
```

**✅ Pass Criteria:**
- Result should differ from Test 2.1 (fewer orders if unpaid orders exist)
- `orders_distinct` should be <= Test 2.1 result

**Verify:**
```sql
-- Manual count for paid orders
SELECT COUNT(DISTINCT COALESCE(external_order_id, order_id)) AS paid_orders
FROM sales_orders
WHERE created_by = 'YOUR-USER-ID'
  AND paid_time IS NOT NULL
  AND paid_time::DATE >= '2026-01-01'
  AND paid_time::DATE <= '2026-02-28';
```

**Should match** `orders_distinct` from RPC result.

### Test 2.4: Status Filter

```sql
SELECT * FROM get_sales_aggregates(
    'YOUR-USER-ID'::UUID,
    '2026-01-01'::DATE,
    '2026-02-28'::DATE,
    'order',
    NULL,
    ARRAY['ชำระเงินแล้ว', 'ที่จัดส่ง'], -- Specific statuses
    NULL
);
```

**✅ Pass Criteria:**
- `orders_distinct` should be <= Test 2.1 result
- Only orders with specified statuses counted

### Test 2.5: Empty Result Set

```sql
SELECT * FROM get_sales_aggregates(
    'YOUR-USER-ID'::UUID,
    '1970-01-01'::DATE,  -- Ancient date, no data
    '1970-01-02'::DATE,
    'order',
    NULL,
    NULL,
    NULL
);
```

**✅ Pass Criteria:**
- All metrics should be 0 (not NULL, not error)
- `revenue_gross = 0`
- `orders_gross = 0`

## Phase 3: Business Logic Tests

### Test 3.1: Same-Day Cancel Detection

```sql
-- Find orders with same-day cancellation
WITH order_dates AS (
    SELECT
        COALESCE(external_order_id, order_id) AS order_key,
        MAX(COALESCE(created_time, order_date)) AS created,
        MAX(cancelled_time) AS cancelled,
        MAX(total_amount) AS amount
    FROM sales_orders
    WHERE created_by = 'YOUR-USER-ID'
        AND cancelled_time IS NOT NULL
        AND COALESCE(created_time, order_date) IS NOT NULL
    GROUP BY order_key
)
SELECT
    COUNT(*) AS same_day_cancels,
    SUM(amount) AS same_day_cancel_revenue
FROM order_dates
WHERE (cancelled AT TIME ZONE 'Asia/Bangkok')::DATE = (created AT TIME ZONE 'Asia/Bangkok')::DATE;
```

**Compare with RPC:**
```sql
SELECT
    cancelled_same_day_orders,
    cancelled_same_day_amount
FROM get_sales_aggregates(
    'YOUR-USER-ID'::UUID,
    '2026-01-01'::DATE,
    '2026-02-28'::DATE,
    'order',
    NULL, NULL, NULL
);
```

**✅ Pass Criteria:** Both queries return same numbers.

### Test 3.2: Multi-SKU Order Handling

```sql
-- Find multi-SKU orders
WITH order_lines AS (
    SELECT
        COALESCE(external_order_id, order_id) AS order_key,
        COUNT(*) AS line_count,
        MAX(total_amount) AS order_amount,
        SUM(quantity) AS total_quantity
    FROM sales_orders
    WHERE created_by = 'YOUR-USER-ID'
        AND (COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok')::DATE >= '2026-01-01'
        AND (COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok')::DATE <= '2026-02-28'
    GROUP BY order_key
    HAVING COUNT(*) > 1
)
SELECT
    COUNT(*) AS multi_sku_orders,
    SUM(order_amount) AS revenue_from_multi_sku
FROM order_lines;
```

**✅ Pass Criteria:**
- RPC should use `MAX(total_amount)` per order (not SUM)
- Multi-SKU orders should not inflate revenue

### Test 3.3: Lines vs Orders Ratio

```sql
-- Manual calculation
WITH order_lines AS (
    SELECT
        COALESCE(external_order_id, order_id) AS order_key,
        COUNT(*) AS line_count
    FROM sales_orders
    WHERE created_by = 'YOUR-USER-ID'
        AND (COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok')::DATE >= '2026-01-01'
        AND (COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok')::DATE <= '2026-02-28'
    GROUP BY order_key
)
SELECT
    (SELECT COUNT(*) FROM order_lines) AS orders_distinct,
    (SELECT SUM(line_count) FROM order_lines) AS lines_total,
    ROUND((SELECT SUM(line_count)::NUMERIC FROM order_lines) / (SELECT COUNT(*)::NUMERIC FROM order_lines), 2) AS lines_per_order;
```

**Compare with RPC:**
```sql
SELECT
    orders_distinct,
    lines_total,
    ROUND(lines_total::NUMERIC / NULLIF(orders_distinct, 0), 2) AS lines_per_order
FROM get_sales_aggregates(
    'YOUR-USER-ID'::UUID,
    '2026-01-01'::DATE,
    '2026-02-28'::DATE,
    'order',
    NULL, NULL, NULL
);
```

**✅ Pass Criteria:** Both queries return same numbers.

## Phase 4: TikTok-Like Aggregates

### Test 4.1: Basic TikTok Aggregates

```sql
SELECT * FROM get_sales_aggregates_tiktok_like(
    'YOUR-USER-ID'::UUID,
    '2026-01-01'::DATE,
    '2026-02-28'::DATE,
    NULL,  -- all platforms
    NULL,  -- all statuses
    NULL   -- all payment statuses
);
```

**✅ Pass Criteria:**
- Returns 3 columns: `total_created_orders`, `cancelled_created_orders`, `cancel_rate`
- `total_created_orders >= cancelled_created_orders`
- `cancel_rate = (cancelled / total) * 100`
- `cancel_rate` between 0-100

**Verify:**
```sql
-- Manual calculation
WITH order_status AS (
    SELECT
        COALESCE(external_order_id, order_id) AS order_key,
        MAX(
            CASE
                WHEN LOWER(status_group) LIKE '%ยกเลิก%' THEN TRUE
                WHEN LOWER(platform_status) LIKE '%ยกเลิก%' THEN TRUE
                ELSE FALSE
            END
        ) AS is_cancelled
    FROM sales_orders
    WHERE created_by = 'YOUR-USER-ID'
        AND created_at IS NOT NULL
        AND created_at::DATE >= '2026-01-01'
        AND created_at::DATE <= '2026-02-28'
    GROUP BY order_key
)
SELECT
    COUNT(*) AS total_created_orders,
    SUM(CASE WHEN is_cancelled THEN 1 ELSE 0 END) AS cancelled_created_orders,
    ROUND((SUM(CASE WHEN is_cancelled THEN 1 ELSE 0 END)::NUMERIC / COUNT(*) * 100), 2) AS cancel_rate
FROM order_status;
```

**Should match** RPC result exactly.

## Phase 5: Story Aggregates

### Test 5.1: Basic Story Aggregates

```sql
SELECT * FROM get_sales_story_aggregates(
    'YOUR-USER-ID'::UUID,
    '2026-01-01'::DATE,
    '2026-02-28'::DATE,
    NULL,  -- all platforms
    NULL,  -- all statuses
    NULL   -- all payment statuses
);
```

**✅ Pass Criteria:**
- Returns 8 columns including `has_cancelled_at = FALSE` (fallback mode)
- `gross_revenue_created >= net_revenue_after_same_day_cancel`
- `total_created_orders >= net_orders_after_same_day_cancel`
- `cancel_rate_same_day = (same_day_cancel_orders / total_created_orders) * 100`

## Phase 6: Performance Tests

### Test 6.1: Query Execution Time

```sql
\timing on

SELECT * FROM get_sales_aggregates(
    'YOUR-USER-ID'::UUID,
    '2026-01-01'::DATE,
    '2026-12-31'::DATE,  -- Full year
    'order',
    NULL, NULL, NULL
);

\timing off
```

**✅ Pass Criteria:**
- Query completes in < 500ms for datasets up to 10k orders
- Query completes in < 1000ms for datasets up to 50k orders

### Test 6.2: Index Usage

```sql
EXPLAIN ANALYZE
SELECT * FROM get_sales_aggregates(
    'YOUR-USER-ID'::UUID,
    '2026-01-01'::DATE,
    '2026-02-28'::DATE,
    'order',
    NULL, NULL, NULL
);
```

**✅ Pass Criteria:**
- Query plan shows index usage (e.g., "Index Scan using idx_sales_orders_created_time_user")
- No sequential scans on large tables

## Phase 7: Edge Cases

### Test 7.1: NULL created_time (Fallback to order_date)

```sql
-- Check if any orders have NULL created_time
SELECT COUNT(*) AS null_created_time_count
FROM sales_orders
WHERE created_by = 'YOUR-USER-ID'
  AND created_time IS NULL
  AND order_date IS NOT NULL;
```

**If count > 0:**
```sql
-- RPC should handle fallback correctly
SELECT * FROM get_sales_aggregates(
    'YOUR-USER-ID'::UUID,
    '2026-01-01'::DATE,
    '2026-02-28'::DATE,
    'order',
    NULL, NULL, NULL
);
```

**✅ Pass Criteria:** No errors, NULL created_time rows use order_date fallback.

### Test 7.2: Single Date Range (Today Only)

```sql
SELECT * FROM get_sales_aggregates(
    'YOUR-USER-ID'::UUID,
    CURRENT_DATE,
    CURRENT_DATE,
    'order',
    NULL, NULL, NULL
);
```

**✅ Pass Criteria:** Returns today's aggregates (may be zero if no orders today).

### Test 7.3: Future Date Range

```sql
SELECT * FROM get_sales_aggregates(
    'YOUR-USER-ID'::UUID,
    '2099-01-01'::DATE,
    '2099-12-31'::DATE,
    'order',
    NULL, NULL, NULL
);
```

**✅ Pass Criteria:** All metrics should be 0 (no future orders).

## Phase 8: Comparison with Old Implementation

### Test 8.1: Side-by-Side Comparison

**Step 1:** Run OLD client-side implementation (before refactor)
```typescript
// In browser console or API test
const oldResult = await fetch('/api/sales/aggregates?startDate=2026-01-01&endDate=2026-02-28')
console.log('OLD:', await oldResult.json())
```

**Step 2:** Run NEW RPC-based implementation
```sql
SELECT * FROM get_sales_aggregates(
    'YOUR-USER-ID'::UUID,
    '2026-01-01'::DATE,
    '2026-02-28'::DATE,
    'order',
    NULL, NULL, NULL
);
```

**✅ Pass Criteria:** All metrics match EXACTLY (revenue, orders, units, etc.)

## Summary Checklist

After completing all tests, verify:

- [ ] All 3 functions exist
- [ ] All 5 indexes created
- [ ] Basic aggregation works (Test 2.1)
- [ ] Platform filter works (Test 2.2)
- [ ] Date basis works (Test 2.3)
- [ ] Status filter works (Test 2.4)
- [ ] Empty result set returns zeros (Test 2.5)
- [ ] Same-day cancel logic correct (Test 3.1)
- [ ] Multi-SKU orders handled correctly (Test 3.2)
- [ ] Lines vs orders ratio correct (Test 3.3)
- [ ] TikTok aggregates match manual calculation (Test 4.1)
- [ ] Story aggregates match manual calculation (Test 5.1)
- [ ] Performance < 500ms (Test 6.1)
- [ ] Indexes used by query planner (Test 6.2)
- [ ] Edge cases handled (Tests 7.1-7.3)
- [ ] Results match old implementation (Test 8.1)

## Troubleshooting

### Issue: Function not found
**Solution:**
```sql
-- Check if function exists
\df get_sales_aggregates
-- If not, re-run migration
\i migration-048-sales-aggregates.sql
```

### Issue: Results don't match old implementation
**Solution:**
```sql
-- Enable detailed logging
SET client_min_messages TO DEBUG;
-- Re-run function and check logs
SELECT * FROM get_sales_aggregates(...);
```

### Issue: Slow query (> 1 second)
**Solution:**
```sql
-- Check if indexes are used
EXPLAIN ANALYZE SELECT * FROM get_sales_aggregates(...);
-- Rebuild indexes if needed
REINDEX INDEX idx_sales_orders_created_time_user;
```

### Issue: NULL results instead of zeros
**Solution:**
```sql
-- Check COALESCE in function
-- Verify empty result set handling
SELECT * FROM get_sales_aggregates(...) WHERE FALSE;
-- Should still return single row with zeros
```

## Next Steps

After all tests pass:
1. Update client code: Replace functions in `actions.ts`
2. Deploy to staging environment
3. Run end-to-end UI tests
4. Monitor performance in staging
5. Deploy to production with monitoring

---

**Test Date:** _____________
**Tester:** _____________
**Result:** ☐ PASS ☐ FAIL
**Notes:** _____________________________________________
