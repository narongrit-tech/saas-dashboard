# Migration 025: Fix order_line_hash Unique Index

## Problem Statement

Migration 024 created a **partial unique index** with a WHERE clause:

```sql
CREATE UNIQUE INDEX idx_sales_orders_order_line_hash_unique
ON public.sales_orders(created_by, order_line_hash)
WHERE order_line_hash IS NOT NULL;
```

This **does not work** with Supabase's `upsert()` ON CONFLICT clause:

```typescript
.upsert(salesRows, {
  onConflict: 'created_by,order_line_hash',
  ignoreDuplicates: false,
})
```

### Why It Fails

PostgreSQL's `ON CONFLICT` requires referencing a unique constraint or index **without a WHERE clause**. Partial indexes (those with WHERE) cannot be used for conflict resolution.

**Error symptom:**
- Import appears to succeed
- But duplicate rows are created on re-import (no upsert happening)

## Solution

Migration 025 drops all partial indexes and creates a **full unique index** without WHERE clause:

```sql
CREATE UNIQUE INDEX sales_orders_unique_created_by_order_line_hash
ON public.sales_orders(created_by, order_line_hash);
```

This allows:
1. **NULL values** for `order_line_hash` (manual entries remain unaffected)
2. **Duplicate detection** for imported rows (order_line_hash NOT NULL)
3. **Upsert ON CONFLICT** to work correctly

## Migration Steps

### 1. Pre-Migration Check

Run verification script to identify duplicates:

```bash
psql -f database-scripts/verify-migration-025.sql
```

**Important:** If TEST 2 shows duplicates, you must clean them up before running migration 025 (see cleanup script in verification file).

### 2. Run Migration

Apply migration 025 via Supabase SQL Editor:

1. Open file `database-scripts/migration-025-sales-order-line-hash-full-unique-index.sql`
2. Copy all SQL contents
3. Paste into Supabase SQL Editor
4. Click "Run" to execute

**Note:** Supabase SQL Editor does not support psql meta-commands like `\i`. You must manually copy/paste the SQL.

### 3. Post-Migration Verification

Run verification script again:

```bash
psql -f database-scripts/verify-migration-025.sql
```

**Expected results:**
- TEST 1: Only one index exists (`sales_orders_unique_created_by_order_line_hash`) with NO WHERE clause
- TEST 2: 0 duplicate rows
- TEST 3: Rows with `source='imported'` should have 0% NULL order_line_hash (manual entries can have NULL)

### 4. QA Testing

Test import idempotency:

1. **First import**: Import a TikTok OrderSKUList file
   - Note the row count (e.g., 100 rows inserted)
2. **Second import**: Import the **same file** again
   - Row count should remain 100 (no new rows, upsert updates existing)
3. **Third import**: Import a **newer export** with status changes
   - Row count remains 100
   - Statuses should be updated (e.g., pending → completed)
   - No duplicate rows

## Impact

### Before Migration 025
- ❌ Duplicate imports create duplicate rows
- ❌ Upsert silently fails (falls back to insert)
- ❌ Status updates don't work on re-import

### After Migration 025
- ✅ Duplicate imports are idempotent (no new rows)
- ✅ Upsert works correctly (ON CONFLICT triggers)
- ✅ Status updates work on re-import

## Rollback Plan

If migration 025 causes issues, rollback to partial index:

```sql
-- Drop full unique index
DROP INDEX IF EXISTS public.sales_orders_unique_created_by_order_line_hash;

-- Restore partial index (migration-024 style)
CREATE UNIQUE INDEX idx_sales_orders_order_line_hash_unique
ON public.sales_orders(created_by, order_line_hash)
WHERE order_line_hash IS NOT NULL;
```

**Note:** This will break upsert functionality again. Only rollback if critical production issues arise.

## Files Changed

1. **New:** `database-scripts/migration-025-sales-order-line-hash-full-unique-index.sql`
2. **New:** `database-scripts/verify-migration-025.sql`
3. **New:** `MIGRATION_025_NOTES.md` (this file)
4. **No changes:** `frontend/src/app/(dashboard)/sales/sales-import-actions.ts` (already correct)

## Related Migrations

- **Migration 024:** Added `order_line_hash` column and partial unique index (now superseded)
- **Migration 007:** Added `source` and `import_batch_id` columns to sales_orders
- **Migration 008:** Added UX v2 fields (platform_status, payment_status, etc.)

## Testing Checklist

- [ ] Pre-migration: Run `verify-migration-025.sql` TEST 2 (check for duplicates)
- [ ] Pre-migration: Clean up duplicates if found (use cleanup script)
- [ ] Migration: Apply `migration-025-sales-order-line-hash-full-unique-index.sql`
- [ ] Post-migration: Run `verify-migration-025.sql` (all tests pass)
- [ ] QA: Import file once → success (record row count)
- [ ] QA: Import same file twice → row count unchanged (idempotent)
- [ ] QA: Import newer file with status changes → statuses update, no duplicates
- [ ] Production: Monitor import logs for 24 hours after deployment

## Production Deployment

### Timing
- **Best time:** Off-peak hours (low user activity)
- **Estimated duration:** Depends on table size
  - Small tables (< 10,000 rows): ~1-5 seconds
  - Medium tables (10k-100k rows): ~5-30 seconds
  - Large tables (> 100k rows): ~30+ seconds

### Table Locking Behavior

**IMPORTANT:** This migration uses `CREATE UNIQUE INDEX` **without CONCURRENTLY**.

**What happens:**
- PostgreSQL acquires a **SHARE lock** on `sales_orders` table during index creation
- **Reads are allowed** (SELECT queries work normally)
- **Writes are blocked** (INSERT/UPDATE/DELETE operations will wait until index creation completes)

**Impact:**
- Existing users viewing sales orders: ✅ No interruption
- Imports or manual order creation during migration: ⏳ Will wait for index to finish

**Zero-downtime alternative:**
If you need to avoid write locks (e.g., 24/7 operations), modify migration to use:
```sql
CREATE UNIQUE INDEX CONCURRENTLY sales_orders_unique_created_by_order_line_hash
ON public.sales_orders(created_by, order_line_hash);
```
**Trade-off:** CONCURRENTLY takes longer but allows writes during index creation. However, it cannot be run inside a transaction block and does not support `IF NOT EXISTS`.

### Monitoring
After deployment, watch for:
- Import failure rate (should be 0%)
- Duplicate row creation (should be 0)
- Import duration (should be unchanged)

### Rollback Trigger
Rollback if:
- Import failure rate > 5% (check error logs)
- User reports duplicate orders appearing
- Performance degradation (query > 2x slower)

## Notes

- This migration is **idempotent** (safe to run multiple times)
- No data is modified (only index structure changes)
- No backfill required (migration 024 already populated order_line_hash)
- RLS policies are unaffected
