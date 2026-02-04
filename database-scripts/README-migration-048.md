# Migration 048: Sales Aggregates RPC Functions

## Overview
This migration creates PostgreSQL RPC (Remote Procedure Call) functions to perform sales aggregation directly in the database, eliminating the need to fetch thousands of rows and compute aggregates client-side.

## Problem Statement

### Before (Client-Side Aggregation)
```typescript
// BAD: Fetch all rows with pagination (potentially 10k+ rows)
let rawLines: any[] = []
while (hasMore) {
  const { data } = await baseQuery.range(from, from + 999)
  rawLines = rawLines.concat(data)
  from += 1000
}

// Client-side grouping and calculation
for (const line of rawLines) {
  // Complex business logic...
  revenueGross += line.total_amount
  // ...
}
```

**Issues:**
- Network overhead: Transferring thousands of rows
- Memory overhead: Loading all data in Node.js
- CPU overhead: Client-side loops and calculations
- Pagination complexity: Multiple round-trips to database
- Inconsistent results: Race conditions with concurrent requests

### After (DB-Level Aggregation)
```typescript
// GOOD: Single RPC call returns aggregates
const { data } = await supabase.rpc('get_sales_aggregates', {
  p_user_id: user.id,
  p_start_date: '2026-02-01',
  p_end_date: '2026-02-04',
  p_date_basis: 'order',
  p_source_platform: 'tiktok_shop',
  p_status: ['ชำระเงินแล้ว', 'ที่จัดส่ง'],
  p_payment_status: 'paid'
})

// Result: { revenue_gross: 150000, revenue_net: 140000, ... }
```

**Benefits:**
- Single round-trip to database
- Minimal network transfer (only aggregates)
- Efficient DB-level calculation with indexes
- Atomic and consistent results

## Functions Created

### 1. `get_sales_aggregates`
**Purpose:** Main sales aggregation with complex business logic

**Parameters:**
- `p_user_id` (UUID): User ID for RLS enforcement
- `p_start_date` (DATE): Start date (Bangkok timezone)
- `p_end_date` (DATE): End date (Bangkok timezone)
- `p_date_basis` (TEXT): 'order' or 'paid' date basis
- `p_source_platform` (TEXT): Platform filter (e.g., 'tiktok_shop', 'shopee', 'all')
- `p_status` (TEXT[]): Status filter array (e.g., ['ชำระเงินแล้ว', 'ที่จัดส่ง'])
- `p_payment_status` (TEXT): Payment status filter (e.g., 'paid', 'unpaid', 'all')

**Returns:**
```sql
revenue_gross           NUMERIC  -- Total revenue before cancellations
revenue_net             NUMERIC  -- Revenue after same-day cancellations
cancelled_same_day_amount NUMERIC  -- Revenue from same-day cancelled orders
cancel_rate_revenue_pct NUMERIC  -- Cancel rate by revenue (0-100%)
orders_gross            BIGINT   -- Total orders count
orders_net              BIGINT   -- Orders after same-day cancellations
cancelled_same_day_orders BIGINT   -- Count of same-day cancelled orders
cancel_rate_orders_pct  NUMERIC  -- Cancel rate by orders (0-100%)
total_units             BIGINT   -- Total units sold (net, excluding cancelled)
aov_net                 NUMERIC  -- Average Order Value (net)
orders_distinct         BIGINT   -- Distinct order count
lines_total             BIGINT   -- Total line items count
```

**Business Logic:**
- **Order-level grouping:** Groups by `COALESCE(external_order_id, order_id)` to prevent multi-SKU revenue inflation
- **Date basis handling:**
  - `'order'`: Uses `COALESCE(created_time, order_date)` in Bangkok timezone
  - `'paid'`: Uses `paid_time` with NOT NULL check
- **Same-day cancel detection:** Compares `DATE(cancelled_time)` = `DATE(created_time)` in Bangkok timezone
- **Net calculations:** Excludes same-day cancelled orders from net metrics
- **Fallback logic:** Handles legacy data where `created_time` is NULL (uses `order_date`)

### 2. `get_sales_aggregates_tiktok_like`
**Purpose:** TikTok Seller Center style aggregates for comparison

**Parameters:**
- `p_user_id` (UUID): User ID for RLS enforcement
- `p_start_date` (DATE): Start date
- `p_end_date` (DATE): End date
- `p_source_platform` (TEXT): Platform filter
- `p_status` (TEXT[]): Status filter array
- `p_payment_status` (TEXT): Payment status filter

**Returns:**
```sql
total_created_orders      BIGINT   -- Orders created in date range
cancelled_created_orders  BIGINT   -- Cancelled orders in date range
cancel_rate               NUMERIC  -- Cancel rate (0-100%)
```

**Business Logic:**
- Always uses `created_at` for date filtering (matches TikTok semantics)
- Detects cancelled status from `status_group` or `platform_status` containing 'ยกเลิก'
- For reference/comparison only (not used for business P&L)

### 3. `get_sales_story_aggregates`
**Purpose:** Sales Story aggregates (60/40 Story Panel)

**Parameters:**
- `p_user_id` (UUID): User ID for RLS enforcement
- `p_start_date` (DATE): Start date
- `p_end_date` (DATE): End date
- `p_source_platform` (TEXT): Platform filter
- `p_status` (TEXT[]): Status filter array
- `p_payment_status` (TEXT): Payment status filter

**Returns:**
```sql
gross_revenue_created              NUMERIC  -- Total revenue created
total_created_orders               BIGINT   -- Total orders created
same_day_cancel_orders             BIGINT   -- Same-day cancelled orders
same_day_cancel_revenue            NUMERIC  -- Revenue from same-day cancels
net_revenue_after_same_day_cancel  NUMERIC  -- Net revenue
net_orders_after_same_day_cancel   BIGINT   -- Net orders
cancel_rate_same_day               NUMERIC  -- Cancel rate (0-100%)
has_cancelled_at                   BOOLEAN  -- FALSE (fallback mode)
```

**Business Logic:**
- Always uses `created_at` for date filtering (Story semantics)
- FALLBACK MODE: Since no `cancelled_at` field exists, treats all cancelled orders as "same-day cancel"
- Cannot verify actual cancel timing (limitation of current schema)

## Performance Optimizations

### Indexes Created
```sql
-- Index for created_time filtering (order basis)
idx_sales_orders_created_time_user ON sales_orders(created_by, created_time)

-- Index for paid_time filtering (paid basis)
idx_sales_orders_paid_time_user ON sales_orders(created_by, paid_time)

-- Index for created_at filtering (TikTok/Story basis)
idx_sales_orders_created_at_user ON sales_orders(created_by, created_at)

-- Index for cancelled_time (same-day cancel checks)
idx_sales_orders_cancelled_time_user ON sales_orders(created_by, cancelled_time)

-- Composite index for platform filtering
idx_sales_orders_user_platform_dates ON sales_orders(created_by, source_platform, created_time, paid_time, created_at)
```

### Query Optimization Techniques
1. **CTE (Common Table Expressions):** Break down complex queries into readable steps
2. **Order-level grouping:** Use `MAX()` aggregation to prevent SKU-line duplication
3. **Conditional aggregation:** Use `CASE WHEN` inside `SUM()` for efficient filtering
4. **Filtered indexes:** Only index rows with NOT NULL timestamps
5. **SECURITY DEFINER:** Functions run with definer privileges, allowing efficient RLS bypass (still filtered by `p_user_id`)

## Migration Steps

### 1. Apply Migration
```bash
cd database-scripts
psql $DATABASE_URL -f migration-048-sales-aggregates.sql
```

### 2. Verify Functions Exist
```sql
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE 'get_sales_%';
```

Expected output:
```
routine_name                      | routine_type
----------------------------------+-------------
get_sales_aggregates              | FUNCTION
get_sales_aggregates_tiktok_like  | FUNCTION
get_sales_story_aggregates        | FUNCTION
```

### 3. Test Functions
See `verify-migration-048.sql` for comprehensive test cases.

### 4. Update Client Code
Update `frontend/src/app/(dashboard)/sales/actions.ts` to use RPC functions.

## Rollback Plan

```sql
-- Drop functions
DROP FUNCTION IF EXISTS public.get_sales_aggregates(UUID, DATE, DATE, TEXT, TEXT, TEXT[], TEXT);
DROP FUNCTION IF EXISTS public.get_sales_aggregates_tiktok_like(UUID, DATE, DATE, TEXT, TEXT[], TEXT);
DROP FUNCTION IF EXISTS public.get_sales_story_aggregates(UUID, DATE, DATE, TEXT, TEXT[], TEXT);

-- Drop indexes (optional, won't break anything)
DROP INDEX IF EXISTS public.idx_sales_orders_created_time_user;
DROP INDEX IF EXISTS public.idx_sales_orders_paid_time_user;
DROP INDEX IF EXISTS public.idx_sales_orders_created_at_user;
DROP INDEX IF EXISTS public.idx_sales_orders_cancelled_time_user;
DROP INDEX IF EXISTS public.idx_sales_orders_user_platform_dates;
```

## Testing Checklist

- [ ] Apply migration to staging database
- [ ] Run verification script (`verify-migration-048.sql`)
- [ ] Test with different date ranges (single day, week, month)
- [ ] Test with different platforms (TikTok, Shopee, all)
- [ ] Test with different status filters
- [ ] Test with different payment statuses
- [ ] Test both date basis options (order, paid)
- [ ] Compare results with current client-side calculation (should match exactly)
- [ ] Verify performance improvement (check query execution time)
- [ ] Test with empty result sets (no orders in range)
- [ ] Test with large datasets (10k+ orders)
- [ ] Update client code and test end-to-end

## Expected Performance Gains

### Before (Client-Side)
- **Query time:** 500-1000ms per pagination batch × N batches
- **Network transfer:** 50-100MB for 10k orders
- **Total time:** 5-10 seconds for large datasets
- **Memory usage:** 100-200MB Node.js heap

### After (DB-Level)
- **Query time:** 200-500ms (single query)
- **Network transfer:** <1KB (only aggregates)
- **Total time:** <1 second
- **Memory usage:** <1MB Node.js heap

**Expected improvement:** 10-20x faster for large datasets

## Notes

1. **Bangkok Timezone:** All date filtering and same-day cancel checks use `Asia/Bangkok` timezone
2. **RLS Enforcement:** Functions use `SECURITY DEFINER` but still filter by `p_user_id` for security
3. **Fallback Logic:** Handles legacy data where `created_time` is NULL (uses `order_date`)
4. **Order-Level Grouping:** Groups by `COALESCE(external_order_id, order_id)` to prevent multi-SKU inflation
5. **Same-Day Cancel:** Compares `DATE(cancelled_time)` = `DATE(created_time)` in Bangkok timezone
6. **Story Aggregates Limitation:** Cannot verify actual cancel timing (no `cancelled_at` field in schema)

## Related Files

- Migration: `migration-048-sales-aggregates.sql`
- Verification: `verify-migration-048.sql`
- Documentation: `README-migration-048.md` (this file)
- Refactored Code: `frontend/src/app/(dashboard)/sales/actions.ts`
- Summary Doc: `docs/REFACTOR_SALES_DB_AGGREGATES.md`

## References

- Previous migration: `migration-047-ads-summary-aggregate.sql` (ads pattern)
- Sales UX v2: `migration-008-sales-ux-v2.sql`
- TikTok timestamps: `migration-029-tiktok-business-timestamps.sql`
- Order financials: `migration-044-order-financials.sql`
