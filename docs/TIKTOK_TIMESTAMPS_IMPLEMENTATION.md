# TikTok Business Timestamps Implementation

**Date:** 2026-01-28
**Status:** Code Complete - Pending Migration Execution

---

## Overview

Implemented order-level aggregation using TikTok business timestamps (created_time, paid_time, cancelled_time) to provide accurate revenue and order metrics that match TikTok Seller Center semantics.

---

## Key Changes

### 1. Database Migration (Pending Execution)

**File:** `database-scripts/migration-029-tiktok-business-timestamps.sql`

**What it does:**
- Extracts `created_time`, `paid_time`, `cancelled_time` from metadata JSON into direct columns
- Adds indexes for fast filtering by these timestamps
- Backfills existing data from metadata
- Provides fallback: uses `paid_at` for `paid_time` if missing

**Action Required:**
User needs to run this migration in Supabase dashboard or via psql:
```sql
-- Run: database-scripts/migration-029-tiktok-business-timestamps.sql
```

---

### 2. TypeScript Type Updates

**Files Modified:**
- `frontend/src/types/sales.ts`
- `frontend/src/types/sales-import.ts`

**Changes:**
- Added `created_time`, `paid_time`, `cancelled_time` to `SalesOrder` interface
- Added same fields to `GroupedSalesOrder` interface
- Created new `SalesAggregates` interface with TikTok semantics:
  ```typescript
  interface SalesAggregates {
    // Money Metrics
    revenue_gross: number            // All orders in date range
    revenue_net: number              // Gross minus same-day cancelled
    cancelled_same_day_amount: number
    cancel_rate_revenue_pct: number

    // Order Metrics
    orders_gross: number             // COUNT DISTINCT external_order_id
    orders_net: number               // Gross minus same-day cancelled
    cancelled_same_day_orders: number
    cancel_rate_orders_pct: number

    // Units & AOV
    total_units: number              // SUM(quantity) for net orders
    aov_net: number                  // revenue_net / orders_net

    // Import Completeness Verification
    orders_distinct: number          // Unique order count (should match lines_total / avg SKUs per order)
    lines_total: number              // Raw line count from sales_orders table
  }
  ```
- Marked old `SalesStoryAggregates` as deprecated

---

### 3. Aggregation Logic Rewrite

**File:** `frontend/src/app/(dashboard)/sales/actions.ts`

**Key Changes:**
- Renamed dateBasis values: `'order_date'` → `'order'`, `'paid_at'` → `'paid'`
- **Order-level aggregation**: Groups by `external_order_id`, uses `MAX(total_amount)` per order (prevents multi-SKU inflation)
- **Same-day cancel logic**: `DATE(cancelled_time) = DATE(created_time)` in Bangkok timezone
- **dateBasis filtering**:
  - `'order'` (default): Filters by `created_time` (when customer placed order)
  - `'paid'`: Filters by `paid_time` with `IS NOT NULL` check (only paid orders)
- **Import completeness**: Returns `orders_distinct` vs `lines_total` for verification

**Example Same-Day Cancel Check:**
```typescript
const isSameDayCancel = (createdTime: string | null, cancelledTime: string | null): boolean => {
  if (!createdTime || !cancelledTime) return false

  const createdBkk = new Date(createdTime).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  const cancelledBkk = new Date(cancelledTime).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })

  return createdBkk === cancelledBkk
}
```

---

### 4. Import Parser Updates

**Files Modified:**
- `frontend/src/lib/sales-parser.ts`
- `frontend/src/app/(dashboard)/sales/sales-import-actions.ts`

**Changes:**
- Parser now extracts and stores TikTok timestamps as **direct fields** (not just in metadata)
- Updated insert/upsert logic to include `created_time`, `paid_time`, `cancelled_time`
- Timestamps stored in both metadata (backward compat) and direct columns (query performance)

---

### 5. UI Updates

**Files Modified:**
- `frontend/src/app/(dashboard)/sales/page.tsx`
- `frontend/src/components/sales/SalesStoryPanel.tsx`

**Key Changes:**

#### Sales Orders Page (page.tsx)
- Updated dateBasis buttons: `'order_date'` → `'order'`, `'paid_at'` → `'paid'`
- Updated Line View queries to use `created_time`/`paid_time` instead of `order_date`/`paid_at`
- Removed separate `getSalesStoryAggregates()` call (now uses main `getSalesAggregates()`)
- Simplified state management: single `aggregates` object for both Story Panel and Summary Bar

#### Sales Story Panel (SalesStoryPanel.tsx)
- Updated to use new `SalesAggregates` interface
- Removed fallback warning text (we now have real `cancelled_time` data)
- Changed metric names:
  - `net_revenue_after_same_day_cancel` → `revenue_net`
  - `gross_revenue_created` → `revenue_gross`
  - `cancel_rate_same_day` → `cancel_rate_revenue_pct` / `cancel_rate_orders_pct`
  - `same_day_cancel_orders` → `cancelled_same_day_orders`

**Visual Layout (60/40 Story Panel):**
```
┌─────────────────────────────────────┬─────────────────────────────┐
│ ยอดขาย (ตามวันที่สั่ง)              │ จำนวนออเดอร์ (ตามวันที่สั่ง) │
│                                     │                             │
│ ฿1,234,567.00 (Net, Big Green)     │ 1,234 (Net, Big Blue)       │
│ Revenue (Net) - ตัดยกเลิก           │ Orders (Net) - ตัดยกเลิก     │
│ Gross วันนี้: ฿1,300,000 (Purple)  │ Gross วันนี้: 1,300 (Purple) │
│ ─────────────────────────────────── │ ─────────────────────────── │
│ Revenue (Gross): ฿1,300,000         │ Orders (Gross): 1,300        │
│ ยกเลิก: 5.00% (฿65,433) (Red)      │ ยกเลิก: 5.00% (66) (Red)    │
└─────────────────────────────────────┴─────────────────────────────┘
```

---

## Business Logic

### Order-Level Aggregation (Critical)

**Problem:** TikTok OrderSKUList export has multiple rows per order (1 row per SKU). Summing `total_amount` across all rows inflates revenue.

**Solution:**
1. Group by `external_order_id`
2. Use `MAX(total_amount)` per order (amount is same across all lines of an order)
3. Sum `quantity` across lines for total units

**Example:**
```
Order A123 has 2 SKU lines:
  Line 1: SKU-001, qty=2, total_amount=1000
  Line 2: SKU-002, qty=1, total_amount=1000

WRONG (sum lines): 1000 + 1000 = 2000 ❌
CORRECT (order-level): MAX(1000, 1000) = 1000 ✅
Units: 2 + 1 = 3 ✅
```

### Same-Day Cancel Logic

**Definition:** Order is cancelled on the same calendar day (Bangkok timezone) as it was created.

**Check:** `DATE(cancelled_time) = DATE(created_time)`

**Rationale:** Matches TikTok Seller Center behavior. Orders cancelled on the same day are often buyer errors or instant cancellations, and should be excluded from net metrics.

### dateBasis Toggle

| dateBasis | Filters By | Use Case |
|-----------|------------|----------|
| `'order'` (default) | `created_time` | All orders created in date range (matches TikTok "Created" report) |
| `'paid'` | `paid_time` (with `IS NOT NULL`) | Only paid orders (cash flow view) |

---

## Verification Queries

After running migration, verify data extraction:

```sql
-- Check timestamp extraction coverage
SELECT
  source,
  COUNT(*) as total_rows,
  COUNT(created_time) as rows_with_created_time,
  COUNT(paid_time) as rows_with_paid_time,
  COUNT(cancelled_time) as rows_with_cancelled_time,
  ROUND(100.0 * COUNT(created_time) / COUNT(*), 2) as created_time_pct,
  ROUND(100.0 * COUNT(paid_time) / COUNT(*), 2) as paid_time_pct,
  ROUND(100.0 * COUNT(cancelled_time) / COUNT(*), 2) as cancelled_time_pct
FROM public.sales_orders
GROUP BY source
ORDER BY source;

-- Expected result for imported rows:
-- created_time_pct: ~100%
-- paid_time_pct: ~70-90% (depends on payment rate)
-- cancelled_time_pct: ~5-15% (depends on cancel rate)
```

```sql
-- Check order-level vs line-level counts
WITH order_level AS (
  SELECT
    COUNT(DISTINCT external_order_id) as distinct_orders,
    SUM(total_amount) as inflated_revenue -- WRONG: sums across lines
  FROM sales_orders
  WHERE created_time >= '2026-01-01'
    AND created_time < '2026-02-01'
),
correct_order_level AS (
  SELECT
    COUNT(*) as distinct_orders,
    SUM(order_amount) as correct_revenue -- CORRECT: 1 row per order_id
  FROM (
    SELECT
      external_order_id,
      MAX(total_amount) as order_amount
    FROM sales_orders
    WHERE created_time >= '2026-01-01'
      AND created_time < '2026-02-01'
    GROUP BY external_order_id
  ) grouped
)
SELECT
  o.distinct_orders,
  o.inflated_revenue,
  c.correct_revenue,
  o.inflated_revenue - c.correct_revenue as revenue_inflation,
  ROUND(100.0 * (o.inflated_revenue - c.correct_revenue) / c.correct_revenue, 2) as inflation_pct
FROM order_level o, correct_order_level c;

-- If inflation_pct > 0: Multi-SKU orders exist, aggregation is critical
-- If inflation_pct = 0: All orders are single-SKU (aggregation still correct)
```

---

## Testing Checklist

### Before Deployment
- [ ] Run migration-029 in Supabase
- [ ] Verify timestamp extraction (see SQL above)
- [ ] Check that new imports populate `created_time`, `paid_time`, `cancelled_time`
- [ ] Verify same-day cancel logic with test data

### UI Testing
- [ ] Date basis toggle works (`วันสั่งซื้อ` vs `วันชำระเงิน`)
- [ ] Story Panel shows correct Net/Gross/Cancel% metrics
- [ ] Cancel percentages match: revenue cancel % ≈ orders cancel %
- [ ] AOV calculation: revenue_net / orders_net (no divide-by-zero)
- [ ] Import completeness warning shows if orders_distinct ≠ expected

### Data Validation
- [ ] Compare with TikTok Seller Center "Created" report
- [ ] Revenue Net + Cancelled Amount = Revenue Gross
- [ ] Orders Net + Cancelled Orders = Orders Gross
- [ ] Cancel rates match TikTok Seller Center (within 0.5%)

---

## Breaking Changes

1. **dateBasis parameter changed:**
   - Old: `'order_date' | 'paid_at'`
   - New: `'order' | 'paid'`

2. **SalesAggregates interface changed:**
   - Old: `revenue_paid_excl_cancel`, `cancelled_amount`, `orders_excl_cancel`, etc.
   - New: `revenue_net`, `revenue_gross`, `orders_net`, `orders_gross`, etc.

3. **getSalesStoryAggregates() removed:**
   - Use `getSalesAggregates()` instead (includes all metrics)

---

## Files Changed

### Database
- `database-scripts/migration-029-tiktok-business-timestamps.sql` (NEW)

### Types
- `frontend/src/types/sales.ts` (MODIFIED)
- `frontend/src/types/sales-import.ts` (MODIFIED)

### Backend Actions
- `frontend/src/app/(dashboard)/sales/actions.ts` (MODIFIED)
- `frontend/src/app/(dashboard)/sales/sales-import-actions.ts` (MODIFIED)

### Parsers
- `frontend/src/lib/sales-parser.ts` (MODIFIED)

### UI Components
- `frontend/src/app/(dashboard)/sales/page.tsx` (MODIFIED)
- `frontend/src/components/sales/SalesStoryPanel.tsx` (MODIFIED)

---

## Next Steps

1. **User Action Required:**
   ```bash
   # Run migration in Supabase dashboard or via psql
   psql -h <supabase-host> -U postgres -d postgres -f database-scripts/migration-029-tiktok-business-timestamps.sql
   ```

2. **Test with Real Data:**
   - Import a TikTok OrderSKUList file
   - Verify timestamps are populated
   - Compare metrics with TikTok Seller Center

3. **Monitor Performance:**
   - Check query speeds with new indexes on created_time/paid_time
   - Verify order-level aggregation performance with large datasets

---

## Support

If issues arise:
1. Check migration was executed successfully
2. Verify timestamps in metadata were extracted to columns
3. Check browser console for errors in aggregation calls
4. Compare SQL verification queries with expected results

---

**Implementation Complete.** Ready for migration execution and testing.
