# Migration 039: Fix rebuild_profit_summaries() Duplicate Key Error

**Date:** 2026-02-01
**Status:** Ready to apply
**Priority:** High (blocks Rebuild Summaries feature)

## Problem Statement

### Root Cause
The `rebuild_profit_summaries()` function was failing with PostgreSQL error 23505 (duplicate key violation) when inserting into `product_profit_daily` table.

**Why it happened:**
- The `product_revenue` CTE grouped by BOTH `product_id` AND `product_name`
- When the same `product_id` had multiple different `product_name` values in `sales_orders`, it created multiple rows
- These multiple rows violated the UNIQUE constraint: `(created_by, date, platform, product_id)`

### Example Scenario
```sql
-- Suppose sales_orders has:
-- order_id=1, seller_sku='SKU123', product_name='Widget A'
-- order_id=2, seller_sku='SKU123', product_name='Widget A (updated)'

-- OLD query would create:
-- Row 1: (date, platform, 'SKU123', 'Widget A', ...)
-- Row 2: (date, platform, 'SKU123', 'Widget A (updated)', ...)
-- ❌ CONFLICT on (created_by, date, platform, 'SKU123')

-- NEW query creates:
-- Row 1: (date, platform, 'SKU123', 'Widget A (updated)', ...)  -- MAX picks one
-- ✅ No conflict!
```

## Solution

### Changes Made

1. **Fixed product_revenue CTE**
   - Removed `s.product_name` from `GROUP BY`
   - Changed to `MAX(s.product_name) as product_name`
   - Now properly groups only by `(date, source_platform, product_id)`

2. **Added ON CONFLICT Upsert (Idempotency)**
   - All 3 summary tables now support re-running without errors:
     - `platform_net_profit_daily`
     - `product_profit_daily`
     - `source_split_daily`
   - Function can be called multiple times safely

### Files Modified
- ✅ `migration-039-fix-rebuild-profit-summaries-duplicates.sql` (new)
- ✅ `apply-migration-039.sh` (helper script)
- ✅ `verify-migration-039.sql` (verification queries)

## How to Apply

### Prerequisites
- Database connection configured in `DATABASE_URL` environment variable
- Backup recommended (though function uses `CREATE OR REPLACE`, very safe)

### Steps

#### Method 1: Using Shell Script (Recommended)
```bash
cd database-scripts
export DATABASE_URL='postgresql://user:pass@host:port/dbname'
chmod +x apply-migration-039.sh
./apply-migration-039.sh
```

#### Method 2: Direct psql
```bash
cd database-scripts
psql "$DATABASE_URL" -f migration-039-fix-rebuild-profit-summaries-duplicates.sql
```

#### Method 3: Supabase Dashboard
1. Go to SQL Editor
2. Copy contents of `migration-039-fix-rebuild-profit-summaries-duplicates.sql`
3. Paste and run

## Verification

### 1. Run Verification Queries
```bash
psql "$DATABASE_URL" -f verify-migration-039.sql
```

**Expected results:**
- ✅ `has_fix = TRUE` (function updated)
- ✅ 0 rows in duplicate check
- ✅ Row counts > 0 after rebuild

### 2. Test in UI
1. Open Profit Reports page: `/reports/profit`
2. Select a date range (e.g., last 30 days)
3. Click **"Rebuild Summaries"** button
4. ✅ Should show: "Rebuild Complete (N rows affected)"
5. ✅ D1-D table should populate with data
6. Click **"Rebuild Summaries"** again
7. ✅ Should succeed again (idempotent)

### 3. Verify Data
```sql
-- Check row counts
SELECT COUNT(*) FROM platform_net_profit_daily;
SELECT COUNT(*) FROM product_profit_daily;
SELECT COUNT(*) FROM source_split_daily;

-- Should all be > 0 after rebuild
```

## Testing Checklist

- [ ] Migration applied successfully (no errors)
- [ ] Verification query shows `has_fix = TRUE`
- [ ] No duplicate key violations found
- [ ] UI: "Rebuild Summaries" button works
- [ ] UI: Toast shows success message
- [ ] UI: D1-D table shows data rows
- [ ] Rebuild can be run multiple times without error
- [ ] Product profit data looks correct (spot check)

## Rollback

**Not needed.** This migration uses `CREATE OR REPLACE FUNCTION`, which safely updates the function. If you need to revert:

```sql
-- Re-run migration-036-profit-reports.sql to restore original version
\i migration-036-profit-reports.sql
```

## Impact

- ✅ **Zero downtime** - uses `CREATE OR REPLACE`
- ✅ **Safe** - only affects function definition, not data
- ✅ **Backward compatible** - function signature unchanged
- ✅ **Idempotent** - can be applied multiple times

## Related Issues

- Blocks: Profit Reports "Rebuild Summaries" feature
- Relates to: Migration 036 (original profit reports implementation)
- Relates to: Migration 037 (affiliate UX enhancements)
- Relates to: Migration 038 (order attribution upsert fix)

## Author Notes

This fix ensures that:
1. Product names are normalized (uses MAX to pick one)
2. The function is truly idempotent
3. Users can rebuild summaries as many times as needed
4. Data integrity is maintained via ON CONFLICT clauses

The choice of `MAX(product_name)` is intentional - it picks the lexicographically last name, which often corresponds to the most recent/updated version if product names are being corrected over time.

## Questions?

If rebuild still fails after applying this migration, check:
1. Are there NULL product_ids? (should use seller_sku or product_name as fallback)
2. Are there constraint violations on other columns?
3. Check PostgreSQL logs for the actual error message

Run: `SELECT * FROM pg_stat_activity WHERE state = 'active';` during rebuild to see query execution.
