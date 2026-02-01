# Fix: Affiliate Import UPSERT Error 42P10 (Production)

**Date**: 2026-02-01
**Issue**: Affiliate Import fails in production with PostgreSQL error 42P10
**Error Message**: "there is no unique or exclusion constraint matching the ON CONFLICT specification"

---

## Root Cause

The code uses `onConflict: 'created_by,order_id'` in the upsert operation, but the production database is missing the required unique index `idx_order_attribution_unique` on `(created_by, order_id)`.

**Possible reasons**:
1. Migration 036 (profit-reports.sql) was not run in production
2. The unique index was dropped or never created
3. Duplicate rows exist, preventing index creation

---

## Solution

### 1. **Run Migration** (Required in Production)

File: `database-scripts/migration-038-fix-order-attribution-upsert.sql`

**What it does**:
- Drops any old/misnamed indexes
- Creates/recreates `idx_order_attribution_unique` on `(created_by, order_id)`
- Includes verification queries

**Run in Supabase SQL Editor**:
```sql
-- See full migration in migration-038-fix-order-attribution-upsert.sql
CREATE UNIQUE INDEX idx_order_attribution_unique
ON public.order_attribution(created_by, order_id);
```

**Before running**: Check for duplicates (see query #3 in `verify-order-attribution-constraint.sql`)

---

### 2. **Code Changes** (Already Applied)

File: `frontend/src/app/(dashboard)/reports/profit/affiliate-import-actions.ts`

**Changes**:
- ✅ Added explicit `UPSERT_CONFLICT_COLUMNS` constant
- ✅ Added diagnostic logging for constraint info
- ✅ Enhanced error handling for error 42P10 (missing constraint)
- ✅ Added **comprehensive rollback**: Cleans up `order_attribution` rows on failure
- ✅ Added production debugging hints in console logs

**Key improvements**:
```typescript
// Before (line 1225)
onConflict: 'created_by,order_id'

// After (with diagnostics + rollback)
const UPSERT_CONFLICT_COLUMNS = 'created_by,order_id'
// + Error 42P10 detection
// + Rollback: Delete order_attribution rows on failure
// + Migration hint in logs
```

---

## Verification Steps

### Step 1: Check if Index Exists

File: `database-scripts/verify-order-attribution-constraint.sql` (Query #1)

```sql
SELECT
    i.indexname,
    i.tablename,
    pg_get_indexdef(idx.indexrelid) as definition,
    idx.indisunique as is_unique
FROM pg_indexes i
JOIN pg_class c ON c.relname = i.indexname
JOIN pg_index idx ON idx.indexrelid = c.oid
WHERE i.tablename = 'order_attribution'
  AND i.indexname = 'idx_order_attribution_unique';
```

**Expected result**: 1 row
**If 0 rows**: Index is missing → Run migration-038

---

### Step 2: Check for Duplicate Rows

File: `database-scripts/verify-order-attribution-constraint.sql` (Query #3)

```sql
SELECT
    created_by,
    order_id,
    COUNT(*) as duplicate_count
FROM order_attribution
GROUP BY created_by, order_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;
```

**Expected result**: 0 rows
**If duplicates exist**: Clean them up before running migration (see query #8)

---

### Step 3: After Import - Verify Success

File: `database-scripts/verify-order-attribution-constraint.sql` (Query #7)

```sql
SELECT
    COUNT(*) as total_rows,
    COUNT(DISTINCT order_id) as distinct_orders,
    SUM(commission_amt) as total_commission
FROM order_attribution
WHERE import_batch_id = '<batch_id>'::uuid;
```

**Replace `<batch_id>`** with the returned `batchId` from successful import.

**Expected**:
- `total_rows` > 0
- `total_rows` === `import_batches.inserted_count`
- `distinct_orders` === Preview matchedCount

---

## Action Plan for Production

### Phase 1: Diagnosis (5 min)

1. Run query #1 from `verify-order-attribution-constraint.sql`
2. Run query #3 to check for duplicates
3. Run query #4 to see recent failed imports

### Phase 2: Fix (10 min)

**If index is missing** (query #1 returns 0 rows):
1. Run `migration-038-fix-order-attribution-upsert.sql` in Supabase SQL Editor
2. Verify index creation with query #1 (should return 1 row)

**If duplicates exist** (query #3 returns rows):
1. Review duplicates to understand why they exist
2. Run cleanup query #8 (carefully - deletes data)
3. Then run migration-038

### Phase 3: Test Import (5 min)

1. Trigger a new Affiliate Import from UI
2. Check console logs for:
   - `[AffiliateImport Diagnostic] UPSERT configuration`
   - Should NOT see error 42P10
3. Verify import success:
   - Check UI: Import dialog shows success
   - Run query #7 to verify rows inserted

### Phase 4: Rollback Test (Optional)

1. Introduce a test error (e.g., invalid data)
2. Verify rollback cleans up:
   - `import_batches` status = 'failed'
   - `order_attribution` rows deleted (import_batch_id)

---

## Files Changed

### Database
- ✅ `database-scripts/migration-038-fix-order-attribution-upsert.sql` (NEW)
- ✅ `database-scripts/verify-order-attribution-constraint.sql` (NEW)

### TypeScript
- ✅ `frontend/src/app/(dashboard)/reports/profit/affiliate-import-actions.ts`
  - Lines 1200-1340: Enhanced UPSERT with diagnostics + rollback

### Documentation
- ✅ `docs/FIX-AFFILIATE-IMPORT-UPSERT-ERROR-42P10.md` (THIS FILE)

---

## Expected Outcomes

### Before Fix
- ❌ Affiliate Import fails with error 42P10
- ❌ `import_batches` created but status = 'failed'
- ❌ 0 rows inserted into `order_attribution`
- ❌ Console shows: "there is no unique or exclusion constraint matching..."

### After Fix
- ✅ Affiliate Import succeeds
- ✅ `import_batches` status = 'success'
- ✅ `order_attribution` rows inserted (count === matchedCount from Preview)
- ✅ Console shows: `[AffiliateImport Diagnostic] UPSERT configuration`
- ✅ On error: Full rollback cleans up partial data

---

## Business Logic Verification

**Constraint**: `(created_by, order_id)` UNIQUE
**Meaning**: One attribution row per user per order

**UPSERT behavior**:
- **New order**: INSERT new row
- **Existing order**: UPDATE commission values
- **Idempotent**: Re-importing same file updates existing rows

**This matches business logic**:
- ✅ One user can't have multiple attributions for same order
- ✅ Re-importing updates commission values (e.g., TikTok adjustments)
- ✅ Different users can attribute the same order_id (multi-tenant)

---

## Troubleshooting

### Error persists after running migration

**Check**:
1. Did migration run successfully? (query #1)
2. Are there still duplicates? (query #3)
3. Is RLS preventing index creation? (unlikely, but check)

**Solution**:
- Drop index manually: `DROP INDEX IF EXISTS idx_order_attribution_unique;`
- Clean duplicates (query #8)
- Recreate index: `CREATE UNIQUE INDEX ...`

### Import succeeds but insertedCount = 0

**Check**:
- RLS policies on `order_attribution` table
- User permissions in Supabase

**Solution**:
- Run query #5 to check actual vs expected counts
- Check Supabase logs for RLS violations

### Rollback doesn't clean up data

**Check**:
- Console logs for `[AffiliateImport Rollback]` messages
- Check if `import_batch_id` is set correctly

**Solution**:
- Manually clean up: `DELETE FROM order_attribution WHERE import_batch_id = '<batch_id>';`

---

## Monitoring

### Production Health Check

Run this query daily to monitor import health:

```sql
SELECT
    DATE(created_at) as import_date,
    status,
    COUNT(*) as import_count,
    SUM(inserted_count) as total_rows_inserted,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count
FROM import_batches
WHERE marketplace = 'affiliate'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at), status
ORDER BY import_date DESC, status;
```

**Alert if**:
- `failed_count` > 0
- `total_rows_inserted` = 0 for successful imports

---

## Related Issues

- Migration 036: Initial `order_attribution` table creation
- Migration 037: Commission split columns
- Migration 038: **This fix** - Ensure unique index exists

---

## Questions?

Contact: Dev Team
Slack: #saas-dashboard-dev

---

## Sign-off Checklist

- [ ] Migration 038 run in production
- [ ] Query #1 confirms index exists
- [ ] Query #3 confirms no duplicates
- [ ] Test import succeeds
- [ ] Query #7 confirms rows inserted
- [ ] Console logs show diagnostic info
- [ ] Rollback tested (optional)

---

**STATUS**: ✅ Fix Ready for Production Deployment
