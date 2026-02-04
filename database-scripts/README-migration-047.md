# Migration 047: Ads Summary Aggregate Function

## Purpose
Optimize ads summary calculation by replacing client-side pagination + reduce with PostgreSQL aggregate function.

## Problem Fixed
- **Before**: `getAdsSummary` fetched ALL rows with pagination loop, then summed on client with `.reduce()`
- **Issue**: Slow performance, inefficient memory usage, wrong architecture pattern
- **After**: Uses PostgreSQL `get_ads_summary` RPC function for server-side aggregation

## Changes

### Database
- Created `public.get_ads_summary(p_user_id, p_start_date, p_end_date, p_campaign_type)` RPC function
- Aggregates spend, revenue, orders efficiently using PostgreSQL SUM()
- Returns single row with totals
- Security: SECURITY DEFINER with RLS enforced via `created_by` filter

### Application Code
- **File**: `frontend/src/app/(dashboard)/ads/actions.ts`
- `getAdsSummary`: Now calls RPC function instead of pagination loop
- Removed all debug console.log statements
- Added guard comment: "Do not compute totals from rows (pagination-safe)"
- `getAdsPerformance`: Cleaned up debug logs, kept pagination for table rows

## Apply Migration

```bash
# Connect to your Supabase database
psql "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"

# Run migration
\i database-scripts/migration-047-ads-summary-aggregate.sql
```

## Verify

```sql
-- Test the RPC function
SELECT * FROM public.get_ads_summary(
    'your-user-uuid'::UUID,
    '2026-01-01'::DATE,
    '2026-02-04'::DATE,
    NULL -- or 'product' or 'live'
);

-- Should return:
-- total_spend | total_revenue | total_orders
-- 100000.00   | 250000.00     | 1500
```

## Manual Test Steps

1. **Apply database migration**
   ```bash
   psql "postgresql://..." -f database-scripts/migration-047-ads-summary-aggregate.sql
   ```

2. **Test in UI**
   - Navigate to `/ads` page
   - Select date range (try large date range with many records)
   - Switch campaign type filter (All / Product / Live)
   - Verify summary cards show correct totals
   - Check browser console - should have NO debug logs

3. **Verify performance**
   - Before: Multiple queries + client-side reduce (slow)
   - After: Single RPC call with PostgreSQL aggregate (fast)

4. **Test edge cases**
   - Empty date range (should return zeros)
   - Campaign type filter (should respect filter)
   - Large dataset (>1000 rows, should be fast)

## Rollback

If needed, revert to old implementation:

```typescript
// In getAdsSummary, replace RPC call with old pagination loop
// (Not recommended - keep RPC approach for performance)
```

## Architecture Pattern

This migration establishes the correct pattern for aggregate calculations:

✅ **Correct**: Use PostgreSQL aggregates via RPC for summary totals
❌ **Wrong**: Fetch all rows with pagination, sum on client

Apply this pattern to other aggregate calculations in the codebase.

## Related Files
- `database-scripts/migration-047-ads-summary-aggregate.sql`
- `frontend/src/app/(dashboard)/ads/actions.ts`
- `database-scripts/migration-003-ad-daily-performance.sql` (table schema)
