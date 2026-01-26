# ADS Delete & Rollback - QA Test Guide

## Purpose
Verify DELETE RLS policies work correctly for ads import cleanup and rollback functionality

---

## Pre-requisites

- ✅ Database migration-003, migration-005, migration-001 applied (DELETE policies exist)
- ✅ Supabase SQL Editor access
- ✅ User authenticated (auth.uid() returns valid UUID)
- ✅ Test ads import files ready (small file: 10-20 rows)

---

## Test 1: Verify DELETE Policies Exist

**Objective:** Confirm RLS DELETE policies are created for all 3 tables

**Steps:**
1. Open Supabase SQL Editor
2. Paste and run:
   ```sql
   SELECT
     tablename,
     policyname,
     cmd,
     qual
   FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('ad_daily_performance', 'wallet_ledger', 'import_batches')
     AND cmd = 'DELETE'
   ORDER BY tablename;
   ```

**Expected Result:**
```
tablename              | policyname                      | cmd    | qual
-----------------------|---------------------------------|--------|------------------------
ad_daily_performance   | ad_daily_perf_delete_policy     | DELETE | (created_by = auth.uid())
import_batches         | import_batches_delete_policy    | DELETE | (created_by = auth.uid())
wallet_ledger          | wallet_ledger_delete_policy     | DELETE | (created_by = auth.uid())
```

**Pass Criteria:**
- ✅ 3 rows returned
- ✅ All policies have `cmd = 'DELETE'`
- ✅ All policies have `qual` checking `created_by = auth.uid()`

---

## Test 2: Import Test Data

**Objective:** Create test import batch for cleanup testing

**Steps:**
1. Navigate to `/wallets` → ADS Wallet
2. Click "Import" button
3. Upload test file (small file, ~10-20 rows)
   - Example file: `TikTok_Ads_Product_Report_20260116-20260120.xlsx`
4. Select Campaign Type: **Product**
5. Click "ดู Preview"
6. Verify preview shows correct totals
7. Click "ยืนยันนำเข้า"
8. **IMPORTANT:** Note the `batch_id` from console logs:
   ```
   [CONFIRM] Batch created successfully { batchId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' }
   ```
9. Copy the `batchId` value

**Expected Result:**
- ✅ Import succeeds
- ✅ Success toast: "นำเข้าข้อมูลสำเร็จ"
- ✅ Console shows batch_id
- ✅ Data visible in `/ads` page

**Pass Criteria:**
- ✅ batch_id obtained
- ✅ No errors during import

---

## Test 3: Verify Data Exists Before Cleanup

**Objective:** Confirm test data is in database before attempting delete

**Steps:**
1. In Supabase SQL Editor, replace `<batch_id>` with actual UUID from Test 2
2. Run:
   ```sql
   SELECT 'ad_daily_performance' as table_name, COUNT(*) as row_count
   FROM ad_daily_performance
   WHERE import_batch_id = '<batch_id>' AND created_by = auth.uid()
   UNION ALL
   SELECT 'wallet_ledger', COUNT(*)
   FROM wallet_ledger
   WHERE import_batch_id = '<batch_id>' AND created_by = auth.uid()
   UNION ALL
   SELECT 'import_batches', COUNT(*)
   FROM import_batches
   WHERE id = '<batch_id>' AND created_by = auth.uid();
   ```

**Expected Result:**
```
table_name             | row_count
-----------------------|-----------
ad_daily_performance   | 150       (example, depends on file)
wallet_ledger          | 10        (example, one per day)
import_batches         | 1
```

**Pass Criteria:**
- ✅ ad_daily_performance: row_count > 0
- ✅ wallet_ledger: row_count > 0
- ✅ import_batches: row_count = 1

---

## Test 4: Execute Safe Rollback by batch_id

**Objective:** Test DELETE operations work correctly (not silent failures)

**Steps:**
1. Replace `<batch_id>` with actual UUID
2. Run DELETE statements in order:

```sql
-- Step 1: Delete wallet_ledger entries
DELETE FROM wallet_ledger
WHERE import_batch_id = '<batch_id>'
  AND created_by = auth.uid();

-- Check result: "DELETE N" where N > 0
-- If N = 0 → FAIL (silent failure, RLS issue)

-- Step 2: Delete ad_daily_performance rows
DELETE FROM ad_daily_performance
WHERE import_batch_id = '<batch_id>'
  AND created_by = auth.uid();

-- Check result: "DELETE N" where N > 0

-- Step 3: Delete import_batch
DELETE FROM import_batches
WHERE id = '<batch_id>'
  AND created_by = auth.uid();

-- Check result: "DELETE 1"
```

**Expected Result:**
- Each DELETE statement returns: `DELETE N` where N > 0
- No errors
- No silent failures (DELETE 0)

**Pass Criteria:**
- ✅ wallet_ledger: DELETE count > 0
- ✅ ad_daily_performance: DELETE count > 0
- ✅ import_batches: DELETE count = 1
- ✅ No RLS errors

---

## Test 5: Verify Cleanup Complete

**Objective:** Confirm all data deleted (no orphaned rows)

**Steps:**
1. Replace `<batch_id>` with actual UUID
2. Run:
   ```sql
   SELECT 'ad_daily_performance' as table_name, COUNT(*) as remaining_rows
   FROM ad_daily_performance
   WHERE import_batch_id = '<batch_id>'
   UNION ALL
   SELECT 'wallet_ledger', COUNT(*)
   FROM wallet_ledger
   WHERE import_batch_id = '<batch_id>'
   UNION ALL
   SELECT 'import_batches', COUNT(*)
   FROM import_batches
   WHERE id = '<batch_id>';
   ```

**Expected Result:**
```
table_name             | remaining_rows
-----------------------|---------------
ad_daily_performance   | 0
wallet_ledger          | 0
import_batches         | 0
```

**Pass Criteria:**
- ✅ All counts = 0
- ✅ No orphaned data

---

## Test 6: Re-import After Cleanup

**Objective:** Verify re-import works after cleanup (file hash check allows)

**Steps:**
1. Navigate to `/wallets` → ADS Wallet → Import
2. Upload **same file** from Test 2
3. Select Campaign Type: Product
4. Click "ดู Preview"
5. Verify preview shows same totals as Test 2
6. Click "ยืนยันนำเข้า"
7. Verify success

**Expected Result:**
- ✅ Import succeeds (no "duplicate import" error)
- ✅ Success toast
- ✅ New batch_id created (different from Test 2)
- ✅ Data visible in `/ads` page

**Pass Criteria:**
- ✅ No duplicate import error
- ✅ Import completes successfully
- ✅ Totals match preview

---

## Test 7: RLS Security Test (Cross-User Delete)

**Objective:** Verify RLS blocks cross-user deletes

**Steps:**
1. Find another user's row (if exists):
   ```sql
   SELECT id, created_by
   FROM ad_daily_performance
   WHERE created_by != auth.uid()
   LIMIT 1;
   ```

2. Attempt to delete other user's row:
   ```sql
   DELETE FROM ad_daily_performance
   WHERE created_by != auth.uid()
   LIMIT 1;
   ```

**Expected Result:**
- DELETE returns: `DELETE 0` (no rows deleted)
- OR RLS error: "permission denied for table ad_daily_performance"

**Pass Criteria:**
- ✅ 0 rows deleted (RLS blocks)
- ✅ OR explicit RLS error
- ✅ Cannot delete other users' data

---

## Test 8: Cleanup by Date (Alternative Method)

**Objective:** Verify date-based cleanup works (less safe method)

**Setup:**
1. Import new test file with known date (e.g., 2026-01-16)
2. Note the ad_date used

**Steps:**
1. Check rows before delete:
   ```sql
   SELECT COUNT(*) as ads_count
   FROM ad_daily_performance
   WHERE ad_date = '2026-01-16'
     AND created_by = auth.uid();
   ```

2. Delete by date:
   ```sql
   DELETE FROM ad_daily_performance
   WHERE ad_date = '2026-01-16'
     AND created_by = auth.uid();

   DELETE FROM wallet_ledger
   WHERE date = '2026-01-16'
     AND source = 'IMPORTED'
     AND created_by = auth.uid();
   ```

3. Verify cleanup:
   ```sql
   SELECT COUNT(*) as remaining_rows
   FROM ad_daily_performance
   WHERE ad_date = '2026-01-16';
   ```

**Expected Result:**
- Before: ads_count > 0
- After delete: DELETE count > 0
- After cleanup: remaining_rows = 0

**Pass Criteria:**
- ✅ Date-based DELETE works
- ✅ All rows for that date removed
- ⚠️ Warning: This deletes ALL imports for that date (not just one batch)

---

## Test 9: Foreign Key Constraint Test

**Objective:** Verify delete order matters (parent-child relationship)

**Steps:**
1. Import new test batch (get batch_id)
2. Attempt to delete parent BEFORE children (wrong order):
   ```sql
   -- ❌ This should fail or return DELETE 0
   DELETE FROM import_batches
   WHERE id = '<batch_id>'
     AND created_by = auth.uid();
   ```

3. Expected error:
   ```
   ERROR: update or delete on table "import_batches" violates foreign key constraint
   ```
   OR silent failure (DELETE 0) due to FK protection

4. Correct order (delete children first):
   ```sql
   -- ✅ Delete children first
   DELETE FROM wallet_ledger WHERE import_batch_id = '<batch_id>' AND created_by = auth.uid();
   DELETE FROM ad_daily_performance WHERE import_batch_id = '<batch_id>' AND created_by = auth.uid();

   -- ✅ Then delete parent
   DELETE FROM import_batches WHERE id = '<batch_id>' AND created_by = auth.uid();
   ```

**Pass Criteria:**
- ✅ Wrong order: Error or DELETE 0 (FK protection)
- ✅ Correct order: All deletes succeed

---

## Test 10: Verification Script

**Objective:** Run full verification script end-to-end

**Steps:**
1. Open file: `database-scripts/verify-ads-delete-policy.sql`
2. In Supabase SQL Editor, run section by section:
   - Section 1: Check policies exist (expect 3 rows)
   - Section 2a: Find test batch_id
   - Section 2b-2d: Uncomment and replace `<batch_id>`, test SELECT visibility
   - Section 3: Safe rollback template (uncomment, replace `<batch_id>`, execute)
   - Section 3 (Step 3): Verify cleanup (expect 0 rows)
   - Section 5: Security test (cross-user delete blocked)

**Expected Result:**
- All sections pass
- No errors
- Cleanup verified

**Pass Criteria:**
- ✅ All 3 policies found
- ✅ SELECT returns rows (visibility OK)
- ✅ DELETE returns counts > 0 (not silent)
- ✅ Cleanup verified (0 rows remaining)
- ✅ Cross-user delete blocked

---

## Troubleshooting

### Issue: DELETE returns 0 rows (silent failure)

**Debug Steps:**
1. Check user authenticated:
   ```sql
   SELECT auth.uid(); -- Must return UUID, not null
   ```

2. Verify rows exist and match created_by:
   ```sql
   SELECT id, created_by FROM ad_daily_performance WHERE import_batch_id = '<batch_id>' LIMIT 5;
   ```

3. Check DELETE policy exists:
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'ad_daily_performance' AND cmd = 'DELETE';
   ```

**Solution:**
- If policy missing → Run migration-003 again
- If created_by mismatch → Using wrong user/batch_id
- If auth.uid() null → Re-authenticate in Supabase

### Issue: "permission denied" error

**Cause:** RLS policy not allowing DELETE

**Solution:**
- Verify policy exists: `SELECT * FROM pg_policies ...`
- Check authenticated: `SELECT auth.uid();`
- Ensure RLS enabled: `ALTER TABLE ad_daily_performance ENABLE ROW LEVEL SECURITY;`

### Issue: "violates foreign key constraint"

**Cause:** Trying to delete parent before children

**Solution:**
- Delete in correct order:
  1. wallet_ledger (child)
  2. ad_daily_performance (child)
  3. import_batches (parent)

---

## Success Criteria Summary

- ✅ All 3 DELETE policies exist and verified
- ✅ DELETE operations return row counts (no silent failures)
- ✅ Rollback by batch_id works end-to-end
- ✅ Cleanup verification passes (0 rows remaining)
- ✅ Re-import after cleanup works (no duplicate error)
- ✅ RLS security enforced (cross-user deletes blocked)
- ✅ Foreign key order tested (parent-child relationship)
- ✅ Date-based cleanup works (alternative method)
- ✅ Verification script passes all sections
- ✅ No errors or silent failures in any test

---

## Test Data Cleanup

After all tests complete:

```sql
-- Find all test batches from today
SELECT
  id as batch_id,
  report_type,
  row_count,
  file_name,
  created_at
FROM import_batches
WHERE created_by = auth.uid()
  AND created_at::date = CURRENT_DATE
ORDER BY created_at DESC;

-- For each test batch, run rollback (replace <batch_id>):
/*
DELETE FROM wallet_ledger WHERE import_batch_id = '<batch_id>' AND created_by = auth.uid();
DELETE FROM ad_daily_performance WHERE import_batch_id = '<batch_id>' AND created_by = auth.uid();
DELETE FROM import_batches WHERE id = '<batch_id>' AND created_by = auth.uid();
*/
```

---

## Estimated Test Time

- Test 1: 2 min
- Test 2: 3 min
- Test 3: 2 min
- Test 4: 5 min
- Test 5: 2 min
- Test 6: 3 min
- Test 7: 3 min
- Test 8: 5 min
- Test 9: 3 min
- Test 10: 10 min

**Total:** ~40 minutes

---

## Contact

If any test fails:
- Check `database-scripts/verify-ads-delete-policy.sql` for reference queries
- Review `ADS_IMPORT_TEST_GUIDE.md` → "Cleanup & Rollback" section
- Verify migrations applied: 001, 003, 005

---

## QA Sign-off

- [ ] All 10 tests passed
- [ ] No silent failures detected
- [ ] RLS enforcement verified
- [ ] Verification script passed
- [ ] Test data cleaned up

**Tested By:** _________________
**Date:** _________________
**Supabase Project:** _________________
