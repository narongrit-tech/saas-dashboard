# QA Verification: Rollback + Upsert Fix

## Date: 2026-01-26
## Bugs Fixed:
1. **Rollback System**: Allow re-import after rollback (status constraint + RPC functions)
2. **Upsert Bug**: PostgREST PGRST100 error - .is() used incorrectly with campaign_id/video_id

---

## Migration 022 - Rollback Functions

### File: `database-scripts/migration-022-import-batch-rollback.sql`

**What it does:**
1. Adds 'rolled_back' status to import_batches constraint
2. Creates `rollback_import_batch(batch_id)` for user-auth (app usage)
3. Creates `rollback_import_batch_as_admin(batch_id, user_id)` for SQL Editor

**Key Features:**
- Cascade delete: ad_daily_performance + wallet_ledger rows removed
- Status update: batch marked as 'rolled_back' (not deleted)
- Ownership check: Users can only rollback their own batches
- Uses WITH...RETURNING pattern (no GET DIAGNOSTICS)

**Run Migration:**
```sql
-- In Supabase SQL Editor, paste entire migration-022 file and execute
-- Expected: 3 functions created, status constraint updated
```

**Verify Migration:**
```sql
-- 1. Check status constraint
SELECT
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname = 'import_batches_status_check';
-- Expected: CHECK definition includes 'rolled_back'

-- 2. Verify functions exist
SELECT
  proname AS function_name,
  pronargs AS arg_count
FROM pg_proc
WHERE proname IN ('rollback_import_batch', 'rollback_import_batch_as_admin')
ORDER BY proname;
-- Expected: 2 rows (1 arg, 2 args)
```

---

## Backend Fix - Upsert Logic

### File: `frontend/src/lib/importers/tiktok-ads-daily.ts`

**What changed:**
- Line 1160-1187: Replaced `.is('campaign_id', value)` with conditional logic
- Use `.eq('campaign_id', value)` when value exists
- Use `.is('campaign_id', null)` when value is empty/null
- Same logic for video_id

**Why this fixes the bug:**
- `.is()` only supports `null` or `boolean` filters
- Using `.is('campaign_id', '1854473926012001')` causes PostgREST PGRST100 error
- Correct filter: `.eq('campaign_id', '1854473926012001')` for string values

**Code Diff:**
```typescript
// BEFORE (WRONG):
.is('campaign_id', campaignId === '' ? null : campaignId)
.is('video_id', videoId === '' ? null : videoId)

// AFTER (CORRECT):
let query = supabase
  .from('ad_daily_performance')
  .select('id')
  .eq('marketplace', 'tiktok')
  .eq('ad_date', adDate)
  .eq('campaign_type', campaignType)
  .eq('campaign_name', campaignName)
  .eq('created_by', userId);

if (campaignId === '') {
  query = query.is('campaign_id', null);
} else {
  query = query.eq('campaign_id', campaignId);
}

if (videoId === '') {
  query = query.is('video_id', null);
} else {
  query = query.eq('video_id', videoId);
}

const { data: existing } = await query.maybeSingle();
```

---

## Duplicate Check Fix

### File: `frontend/src/app/api/import/tiktok/ads-daily/route.ts`

**What changed:**
- Line 102: Ignore batches with status in ('failed', 'rolled_back', 'deleted')
- Allows re-import after rollback

**Code:**
```typescript
.not('status', 'in', '("failed","rolled_back","deleted")')
```

---

## Test Scenario 1: Initial Import (13 rows)

### Test File: `test-tiktok-ads-thai-headers.xlsx`

**Expected Results:**

**1. Preview Step:**
```
Total Rows: 13
Kept Rows: 13
Skipped (all-zero): 0
Total Spend: 80.83
Total Orders: 24
Total Revenue: 5497.80
Avg ROI: 68.04
```

**2. Confirm Import:**
```
Success: true
Batch ID: <uuid>
Row Count: 13
Inserted Count: 13
Updated Count: 0
Error Count: 0
```

**3. Verify Database (ad_daily_performance):**
```sql
-- Get batch ID from UI or import_batches table
SELECT
  ad_date,
  campaign_name,
  campaign_id,
  video_id,
  spend,
  orders,
  revenue,
  roi
FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>'
ORDER BY ad_date, campaign_name;
-- Expected: 13 rows
```

**4. Verify Database (wallet_ledger):**
```sql
SELECT
  date,
  entry_type,
  direction,
  amount,
  note
FROM wallet_ledger
WHERE import_batch_id = '<BATCH_ID>'
ORDER BY date;
-- Expected: 1 row (daily aggregated spend: 80.83)
```

**5. Verify UI (/ads page):**
```
Total Spend: 80.83
Total Orders: 24
Total Revenue: 5497.80
Row Count: 13
```

---

## Test Scenario 2: Rollback

### Using SQL Editor (Admin Function)

**Step 1: Get Batch ID and User ID**
```sql
SELECT
  id AS batch_id,
  created_by AS user_id,
  status,
  row_count,
  inserted_count,
  file_name,
  created_at
FROM import_batches
WHERE report_type = 'tiktok_ads_daily'
ORDER BY created_at DESC
LIMIT 1;
-- Copy batch_id and user_id
```

**Step 2: Call Rollback Function**
```sql
SELECT rollback_import_batch_as_admin(
  '<BATCH_ID>'::UUID,
  '<USER_ID>'::UUID
);
```

**Expected Result:**
```json
{
  "success": true,
  "wallet_deleted": 1,
  "ads_deleted": 13,
  "batch_updated": true
}
```

**Step 3: Verify Batch Status**
```sql
SELECT
  id,
  status,
  notes,
  updated_at
FROM import_batches
WHERE id = '<BATCH_ID>';
-- Expected: status = 'rolled_back', notes contains rollback timestamp
```

**Step 4: Verify Data Deleted**
```sql
-- Check ad_daily_performance
SELECT COUNT(*) AS remaining_ads
FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>';
-- Expected: 0 rows

-- Check wallet_ledger
SELECT COUNT(*) AS remaining_wallet
FROM wallet_ledger
WHERE import_batch_id = '<BATCH_ID>';
-- Expected: 0 rows
```

**Step 5: Verify UI (/ads page)**
```
Total Spend: 0.00
Total Orders: 0
Total Revenue: 0.00
Row Count: 0
```

---

## Test Scenario 3: Re-import Same File

**Prerequisites:**
- Batch has been rolled back (status = 'rolled_back')

**Step 1: Upload Same File Again**
- Use same `test-tiktok-ads-thai-headers.xlsx`
- Same report date
- Same ads type (product or live)

**Expected Result:**
- Preview step succeeds (no duplicate error)
- Confirm import succeeds
- New batch created (different batch_id)
- 13 rows inserted again

**Verify:**
```sql
-- Count batches with same file_hash
SELECT
  id,
  status,
  file_name,
  row_count,
  created_at
FROM import_batches
WHERE file_hash = (
  SELECT file_hash FROM import_batches
  WHERE report_type = 'tiktok_ads_daily'
  ORDER BY created_at DESC
  LIMIT 1
)
ORDER BY created_at DESC;
-- Expected: 2 batches (1 rolled_back, 1 success)
```

**Verify UI:**
```
Total Spend: 80.83
Total Orders: 24
Total Revenue: 5497.80
Row Count: 13
```

---

## Test Scenario 4: Upsert Logic (UPDATE existing rows)

**Purpose:** Verify campaign_id/video_id filters work correctly

**Step 1: Import File First Time**
- Expected: 13 rows inserted

**Step 2: Import Same File Again (WITHOUT rollback)**
- Expected: Duplicate file error (file_hash check)

**Step 3: Rollback First Import**
- Expected: 13 rows deleted

**Step 4: Modify File Slightly (to bypass file_hash check)**
- Add 1 new row with different campaign
- Change spend value in row 1
- Save as new file

**Step 5: Import Modified File**
- Expected: 12 updated + 1 inserted = 13 upserts

**Verify:**
```sql
-- Check import_batches
SELECT
  id,
  row_count,
  inserted_count,
  updated_count,
  error_count,
  notes
FROM import_batches
WHERE report_type = 'tiktok_ads_daily'
ORDER BY created_at DESC
LIMIT 1;
-- Expected: inserted_count + updated_count = 13, error_count = 0
```

---

## Test Scenario 5: Edge Case - NULL campaign_id/video_id

**Purpose:** Verify .is(null) filter works for empty campaign_id/video_id

**Test Data:**
Create test file with:
- Row 1: campaign_id = '123', video_id = '456'
- Row 2: campaign_id = '', video_id = ''
- Row 3: campaign_id = '123', video_id = ''
- Row 4: campaign_id = '', video_id = '456'

**Expected:**
- All 4 rows insert successfully (no duplicate error)
- Unique constraint: marketplace + ad_date + campaign_type + COALESCE(campaign_id,'') + COALESCE(video_id,'') + created_by

**Verify:**
```sql
SELECT
  ad_date,
  campaign_id,
  video_id,
  spend
FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>'
ORDER BY campaign_id NULLS LAST, video_id NULLS LAST;
-- Expected: 4 rows with correct NULL/value handling
```

---

## Acceptance Criteria

### ✅ Migration 022
- [ ] Status constraint allows 'rolled_back'
- [ ] rollback_import_batch function exists
- [ ] rollback_import_batch_as_admin function exists
- [ ] Functions use WITH...RETURNING (no GET DIAGNOSTICS)

### ✅ Backend Upsert Fix
- [ ] Upsert uses .eq() for non-null campaign_id/video_id
- [ ] Upsert uses .is(null) for null campaign_id/video_id
- [ ] No PGRST100 error on import

### ✅ Duplicate Check Fix
- [ ] Duplicate check ignores rolled_back batches
- [ ] Re-import after rollback succeeds

### ✅ Import Flow
- [ ] Preview: 13 rows, totals correct
- [ ] Confirm: 13 inserted, 0 errors
- [ ] UI: totals match (80.83 / 24 / 5497.80)

### ✅ Rollback Flow
- [ ] Rollback deletes ad_daily_performance rows (13)
- [ ] Rollback deletes wallet_ledger rows (1)
- [ ] Batch status = 'rolled_back'
- [ ] UI: totals reset to 0

### ✅ Re-import Flow
- [ ] Same file import after rollback succeeds
- [ ] New batch created (different batch_id)
- [ ] 13 rows inserted again
- [ ] UI: totals restored (80.83 / 24 / 5497.80)

---

## Performance Checks

### Import Speed
- 13 rows: < 3 seconds (total import time)
- Upsert: < 200ms per row

### Rollback Speed
- 13 ad rows + 1 wallet row: < 1 second

### Database Queries
- Upsert: 1 SELECT + 1 INSERT/UPDATE per row
- Rollback: 2 DELETE + 1 UPDATE (batch)

---

## Error Handling Tests

### 1. Rollback Non-Existent Batch
```sql
SELECT rollback_import_batch_as_admin(
  '00000000-0000-0000-0000-000000000000'::UUID,
  '<USER_ID>'::UUID
);
```
**Expected:**
```json
{
  "success": false,
  "error": "Batch not found or does not belong to specified user"
}
```

### 2. Rollback Other User's Batch
```sql
SELECT rollback_import_batch_as_admin(
  '<BATCH_ID>'::UUID,
  '00000000-0000-0000-0000-000000000000'::UUID
);
```
**Expected:**
```json
{
  "success": false,
  "error": "Batch not found or does not belong to specified user"
}
```

### 3. Import Duplicate File (no rollback)
- Upload same file twice without rollback
- Expected: Duplicate file error with existing batch timestamp

---

## SQL Verification Snippets

### Quick Status Check
```sql
-- Check recent import batches
SELECT
  id,
  report_type,
  status,
  row_count,
  inserted_count,
  updated_count,
  error_count,
  file_name,
  created_at,
  LEFT(notes, 100) AS notes_preview
FROM import_batches
WHERE report_type = 'tiktok_ads_daily'
ORDER BY created_at DESC
LIMIT 10;
```

### Count Records by Batch
```sql
-- Ad performance records
SELECT
  import_batch_id,
  COUNT(*) AS ad_count,
  SUM(spend) AS total_spend,
  SUM(orders) AS total_orders,
  SUM(revenue) AS total_revenue
FROM ad_daily_performance
WHERE import_batch_id IN (
  SELECT id FROM import_batches
  WHERE report_type = 'tiktok_ads_daily'
  ORDER BY created_at DESC
  LIMIT 5
)
GROUP BY import_batch_id
ORDER BY import_batch_id;

-- Wallet ledger records
SELECT
  import_batch_id,
  COUNT(*) AS wallet_count,
  SUM(amount) AS total_wallet_spend
FROM wallet_ledger
WHERE import_batch_id IN (
  SELECT id FROM import_batches
  WHERE report_type = 'tiktok_ads_daily'
  ORDER BY created_at DESC
  LIMIT 5
)
GROUP BY import_batch_id
ORDER BY import_batch_id;
```

### Cleanup Test Data (if needed)
```sql
-- WARNING: Only use in development/test environment

-- Delete test batches (admin only)
SELECT purge_import_batch_as_admin(
  '<BATCH_ID>'::UUID,
  '<USER_ID>'::UUID
);

-- Or manual cleanup (if purge function not available)
DELETE FROM wallet_ledger WHERE import_batch_id = '<BATCH_ID>';
DELETE FROM ad_daily_performance WHERE import_batch_id = '<BATCH_ID>';
DELETE FROM import_batches WHERE id = '<BATCH_ID>';
```

---

## Summary

### Files Changed:
1. `database-scripts/migration-022-import-batch-rollback.sql` - New
2. `frontend/src/lib/importers/tiktok-ads-daily.ts` - Modified (upsert logic)
3. `frontend/src/app/api/import/tiktok/ads-daily/route.ts` - Modified (duplicate check)

### What Fixed:
1. **Rollback System**: Can now rollback and re-import same file
2. **Upsert Bug**: PostgREST PGRST100 error fixed (.is() → .eq() + .is(null))
3. **Duplicate Check**: Ignores rolled_back batches

### Manual Test Steps:
1. Run migration 022 in SQL Editor
2. Import test file (13 rows)
3. Verify totals in UI (80.83 / 24 / 5497.80)
4. Rollback via SQL Editor
5. Verify UI shows 0 totals
6. Re-import same file
7. Verify totals restored

### Risks:
- Migration 022 is backward compatible (additive only)
- Existing imports unaffected
- Rollback is user-scoped (RLS safe)
- File hash deduplication logic unchanged

---

## Next Steps (Future Enhancements)

1. **UI Rollback Button**: Add "Rollback" action in import history UI
2. **Batch Details Page**: Show ad_daily_performance + wallet_ledger records per batch
3. **Dry Run Mode**: Preview rollback impact before executing
4. **Audit Log**: Track rollback history (who rolled back, when, why)
5. **Bulk Rollback**: Rollback multiple batches at once (admin only)

---

## Sign-Off Checklist

- [ ] Migration 022 executed successfully in production
- [ ] All 5 test scenarios passed
- [ ] Performance benchmarks met (< 3s import, < 1s rollback)
- [ ] Error handling tests passed
- [ ] Documentation updated
- [ ] User guide created (if needed)
- [ ] Monitoring alerts configured (optional)

---

**Test Date:** 2026-01-26
**Tester:** _________________
**Result:** ☐ PASS  ☐ FAIL
**Notes:**

---
