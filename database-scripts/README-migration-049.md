# Migration 049: Fix GMV View for NULL order_amount

## Problem
- GMV summary cards showing ฿0.00 on Sales Orders page
- `order_financials.order_amount` is NULL for all records
- View `sales_gmv_daily_summary` returns 0 for GMV despite having order counts
- Root cause: View uses `order_financials.order_amount` which is NULL

## Solution
Update `sales_gmv_daily_summary` view to fallback to `sales_orders.total_amount` when `order_financials.order_amount` is NULL:

```sql
-- Before (returns NULL → 0)
SELECT order_amount FROM order_financials

-- After (returns actual amount)
SELECT COALESCE(of.order_amount, so.total_amount, 0)
FROM order_financials of
LEFT JOIN sales_orders so ON of.order_id = so.order_id
```

## Changes
1. Add LEFT JOIN to `sales_orders` in `of_created` and `of_fulfilled` CTEs
2. Use `COALESCE(of.order_amount, so.total_amount, 0)` to get amount
3. Preserve existing logic for `so_created` and `so_fulfilled` (fallback cases)

## Apply Migration

### 1. Backup (Optional)
```sql
-- Save current view definition
SELECT definition FROM pg_views WHERE viewname = 'sales_gmv_daily_summary';
```

### 2. Apply
```bash
psql "YOUR_DATABASE_URL" -f migration-049-fix-gmv-view.sql
```

Or in Supabase SQL Editor:
1. Open SQL Editor
2. Paste contents of `migration-049-fix-gmv-view.sql`
3. Run

### 3. Verify
```sql
-- Should show GMV values (not 0)
SELECT * FROM sales_gmv_daily_summary
WHERE date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
ORDER BY date_bkk
LIMIT 10;

-- Expected result:
-- gmv_created should be > 0 (e.g., 1000-5000)
-- orders_created should match before (4, 3, 4, etc.)
```

## Rollback
If needed, restore the original view:
```sql
DROP VIEW IF EXISTS public.sales_gmv_daily_summary;
-- Then paste the original view definition from backup
```

## Testing Checklist
- [ ] View recreated successfully (no errors)
- [ ] GMV values are > 0 (not all zeros)
- [ ] Order counts remain unchanged
- [ ] Sales Orders page shows correct amounts in summary cards
- [ ] Leakage calculations work correctly

## Expected Impact
- **Frontend:** GMV cards will show correct amounts immediately
- **Performance:** Negligible impact (JOIN is on indexed columns)
- **Data:** No data changes, only view logic updated

## Related Files
- Migration: `migration-049-fix-gmv-view.sql`
- Original view: Created in earlier migration (date TBD)
- Frontend component: `frontend/src/app/(dashboard)/sales/SalesPageClient.tsx`
- Backend action: `frontend/src/app/(dashboard)/sales/actions.ts` (getSalesGMVSummary)
