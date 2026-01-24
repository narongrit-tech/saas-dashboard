# Import Batch Success Tracking Fix

## Problem Fixed

Import would show "already imported" but actually inserted 0 rows.

**Root Causes:**
1. Dedup check didn't filter by status → blocked re-import even for failed batches
2. No post-insert verification → batch marked success even with 0 rows
3. RLS policies could silently block inserts without error

## Solution Applied

### A) Fixed Dedup Logic
**Before:**
```typescript
.eq('file_hash', fileHash)
.eq('marketplace', 'tiktok_shop')
.single()
```

**After:**
```typescript
.eq('file_hash', fileHash)
.eq('marketplace', 'tiktok_shop')
.eq('status', 'success')      // ✅ Only block successful imports
.gt('inserted_count', 0)       // ✅ Must have actually inserted rows
.single()
```

### B) Added Post-Insert Verification
```typescript
// After insert, count actual rows in database
const { count: actualCount } = await supabase
  .from('sales_orders')
  .select('*', { count: 'exact', head: true })
  .eq('import_batch_id', batch.id)

const verifiedCount = actualCount || 0

// If 0 rows → mark as failed
if (verifiedCount === 0) {
  await supabase.from('import_batches').update({
    status: 'failed',
    inserted_count: 0,
    error_count: parsedData.length,
    notes: 'Import failed: 0 rows inserted. Possible RLS policy issue.'
  })
  return { success: false, error: '...' }
}
```

### C) Added Error Message to Batch
Now all batch updates include `notes` field:
- Success: `"Successfully imported {count} rows"`
- Failed: `"Insert failed: {error message}"` or `"0 rows inserted. Possible RLS policy issue"`

## Files Changed
1. `frontend/src/app/(dashboard)/sales/sales-import-actions.ts`
   - Fixed dedup check (line 436-450)
   - Added post-insert verification (line 535-555)
   - Added notes to batch updates (line 521, 548, 563)

2. `frontend/src/app/(dashboard)/expenses/expenses-import-actions.ts`
   - Same fixes as sales

3. `database-scripts/verify-import-batches.sql`
   - SQL queries to verify batch status and actual row counts

## How to Test

### Test 1: Normal Import (Success)
1. Import a TikTok .xlsx file
2. **Expected:**
   - ✅ Import success message: "Import สำเร็จ: X รายการ"
   - ✅ Batch status = 'success'
   - ✅ inserted_count > 0
   - ✅ Rows visible in sales_orders table

### Test 2: Dedup (Block Re-Import)
1. Import the same file again
2. **Expected:**
   - ❌ Error: "ไฟล์นี้ถูก import สำเร็จไปแล้ว - ..."
   - ✅ No new batch created
   - ✅ No duplicate rows

### Test 3: Failed Import Can Retry
1. Simulate failure (e.g., manually edit RLS policy to block inserts temporarily)
2. Import file
3. **Expected:**
   - ❌ Error: "Import failed: 0 rows inserted..."
   - ✅ Batch status = 'failed'
   - ✅ inserted_count = 0
   - ✅ notes contains error message

4. Fix the issue (restore RLS policy)
5. Import same file again
6. **Expected:**
   - ✅ Import allowed (not blocked by dedup)
   - ✅ Import succeeds this time

### Test 4: Verify Batch vs Actual Rows
Run this query in Supabase SQL Editor:
```sql
SELECT
  ib.id,
  ib.file_name,
  ib.status,
  ib.inserted_count AS claimed,
  COUNT(so.id) AS actual,
  CASE
    WHEN ib.inserted_count = COUNT(so.id) THEN '✅ MATCH'
    ELSE '❌ MISMATCH'
  END AS verification
FROM import_batches ib
LEFT JOIN sales_orders so ON so.import_batch_id = ib.id
WHERE ib.marketplace = 'tiktok_shop'
GROUP BY ib.id, ib.file_name, ib.status, ib.inserted_count
ORDER BY ib.created_at DESC;
```

**Expected:** All rows show '✅ MATCH'

## Verification Queries

See `database-scripts/verify-import-batches.sql` for SQL queries to:
- List all import batches with status
- Find failed imports (0 rows inserted)
- Verify batch count matches actual rows
- Clean up failed batches (optional)

## RLS Policy Check

If you encounter "0 rows inserted" error, verify RLS policies:

```sql
-- Check sales_orders insert policy
SELECT * FROM pg_policies
WHERE tablename = 'sales_orders' AND cmd = 'INSERT';

-- Check expenses insert policy
SELECT * FROM pg_policies
WHERE tablename = 'expenses' AND cmd = 'INSERT';
```

**Expected policy:**
```sql
CREATE POLICY "sales_orders_insert_policy"
ON sales_orders FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());
```

## Migration Not Required

No database migration needed - all fixes are in application code only.
Existing `import_batches` table schema already has all required columns:
- `status` (processing|success|failed)
- `notes` (text, for error messages)
- `inserted_count`, `error_count`

## Commit

```bash
git add -A
git commit -m "fix: import batch success tracking and dedup for sales/expenses

- Dedup only blocks successful imports (status=success, inserted_count>0)
- Post-insert verification counts actual rows in DB
- Mark batch failed if 0 rows inserted (catches RLS blocks)
- Store error messages in batch.notes
- Allow retry of failed imports

Fixes issue where import showed 'already imported' but 0 rows actually inserted.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
