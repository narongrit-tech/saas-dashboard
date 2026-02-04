# Migration 050: Populate order_financials.order_amount (Proper Fix)

## Overview
This migration implements the **permanent solution** to the NULL `order_amount` problem in `order_financials` table.

## Problem Statement
- All records in `order_financials` have `order_amount = NULL`
- GMV summary view required JOIN with `sales_orders` (performance impact)
- New records inserted without `order_amount` causing recurring issues

## Solution (Option A: Backfill + Trigger)

### 1. **Auto-Population Function**
Creates `auto_populate_order_amount()` function that:
- Looks up matching record in `sales_orders`
- Uses `COALESCE(order_amount, total_amount)` to get amount
- Populates `order_financials.order_amount`
- Logs warning if no match found (doesn't fail)

### 2. **Trigger**
Creates `trg_populate_order_amount` trigger that:
- Fires BEFORE INSERT OR UPDATE
- Only fires when `order_amount IS NULL`
- Calls auto-population function
- Ensures all new records have `order_amount` populated

### 3. **Backfill Existing Data**
One-time update of all existing NULL values:
- Updates ~1,756 records (based on current data)
- Copies from `sales_orders.total_amount`
- Reports progress and results

### 4. **Performance Indexes**
Creates indexes on lookup columns:
- `sales_orders(order_id, created_by)`
- `order_financials(order_id, created_by)`

## Benefits

### Immediate Benefits
- ✅ All existing NULL values populated
- ✅ GMV view can remove JOIN (better performance)
- ✅ Data integrity improved

### Long-term Benefits
- ✅ **Automatic:** New records auto-populated
- ✅ **Performance:** No more runtime JOINs needed
- ✅ **Maintainable:** Single source of truth for amounts
- ✅ **Consistent:** Same logic applied to all records

## Apply Migration

### Prerequisites
- Migration 049 already applied (GMV view fix)
- Backup recommended (optional for views/functions)

### Apply
```bash
cd database-scripts
psql "YOUR_DATABASE_URL" -f migration-050-populate-order-amount.sql
```

Or in Supabase SQL Editor:
1. Copy contents of `migration-050-populate-order-amount.sql`
2. Paste into SQL Editor
3. Run (watch for NOTICE/WARNING messages)

### Expected Output
```
NOTICE:  Found 1756 records with NULL order_amount
NOTICE:  Successfully updated 1756 records
NOTICE:  All records successfully populated!
```

## Verification

### 1. Check Backfill Results
```sql
SELECT
  COUNT(*) as total_records,
  COUNT(order_amount) as has_amount,
  COUNT(*) - COUNT(order_amount) as still_null,
  SUM(order_amount) as total_amount
FROM order_financials;

-- Expected:
-- total_records: 1756
-- has_amount: 1756
-- still_null: 0
-- total_amount: ~411,745.87
```

### 2. Verify Trigger Installed
```sql
-- Check function exists
SELECT proname FROM pg_proc WHERE proname = 'auto_populate_order_amount';

-- Check trigger exists
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgname = 'trg_populate_order_amount';
```

### 3. Test Trigger (Optional)
```sql
-- Insert a test record without order_amount
-- Trigger should auto-populate it

-- Find an order not in order_financials yet
SELECT order_id, created_by, total_amount
FROM sales_orders
WHERE order_id NOT IN (SELECT order_id FROM order_financials)
LIMIT 1;

-- Insert (replace with actual values)
INSERT INTO order_financials (order_id, created_by, created_time)
VALUES ('TEST_ORDER_ID', 'USER_ID', NOW());

-- Check if order_amount was populated
SELECT order_id, order_amount FROM order_financials
WHERE order_id = 'TEST_ORDER_ID';
-- Expected: order_amount should NOT be NULL

-- Clean up test
DELETE FROM order_financials WHERE order_id = 'TEST_ORDER_ID';
```

### 4. Verify GMV View Still Works
```sql
SELECT * FROM sales_gmv_daily_summary
WHERE date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
ORDER BY date_bkk
LIMIT 10;

-- Should show correct GMV values (same as before)
```

## Optional: Update GMV View to Remove JOIN

After verifying this migration works, you can **optionally** simplify the GMV view to remove the JOIN since all `order_amount` values are now populated:

```sql
-- See migration-051-simplify-gmv-view.sql (optional follow-up)
```

## How It Works

### Data Flow
```
New Record Insert/Update
  ↓
Trigger Fires (if order_amount IS NULL)
  ↓
Function Looks Up sales_orders
  ↓
Copies order_amount/total_amount
  ↓
Record Saved with Populated Value
```

### Edge Cases Handled
1. **No matching sales_order:** Logs warning, allows insert (NULL preserved)
2. **Already has order_amount:** Trigger skips (no change)
3. **Multiple matches:** Uses LIMIT 1 (first match)
4. **Both amounts NULL in sales_orders:** Logs warning, preserves NULL

## Rollback

If needed (NOT recommended after data is populated):

```sql
-- 1. Drop trigger
DROP TRIGGER IF EXISTS trg_populate_order_amount ON public.order_financials;

-- 2. Drop function
DROP FUNCTION IF EXISTS public.auto_populate_order_amount();

-- 3. Optional: Reset data to NULL (DESTRUCTIVE!)
-- UPDATE order_financials SET order_amount = NULL;
```

## Testing Checklist

- [ ] Migration runs without errors
- [ ] NOTICE messages show successful updates
- [ ] Verification query shows 0 NULL values
- [ ] Trigger function exists
- [ ] Trigger exists and is enabled
- [ ] Test insert works (trigger populates)
- [ ] GMV view still returns correct values
- [ ] Sales Orders page shows correct amounts

## Performance Impact

### During Migration
- **Duration:** ~2-5 seconds for 1,756 records
- **Locking:** Brief table lock during UPDATE
- **Impact:** Minimal (can run during business hours)

### After Migration
- **Insert/Update:** +5-10ms per record (trigger overhead)
- **Query Performance:** IMPROVED (no more JOINs needed)
- **Storage:** No change (data was there, just NULL before)

## Related Migrations

- Migration 044: `order_financials` table creation
- Migration 049: GMV view JOIN workaround (temporary fix)
- Migration 051: (Optional) Simplify GMV view to remove JOIN

## Related Files

- Migration: `migration-050-populate-order-amount.sql`
- README: `README-migration-050.md`
- Previous fix: `migration-049-fix-gmv-view.sql`
- Table: `order_financials` (created in migration 044)
- View: `sales_gmv_daily_summary`

## Notes

- This is the **proper permanent fix** for the NULL order_amount issue
- Migration 049 (JOIN workaround) can remain as safety fallback
- Future: Consider creating migration 051 to simplify GMV view
- Trigger adds minimal overhead (~5-10ms per INSERT)
- All existing data will be populated immediately
