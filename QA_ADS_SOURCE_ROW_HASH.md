# QA Checklist: TikTok Ads Import with source_row_hash Fix

**Date**: 2026-01-26
**Purpose**: Verify TikTok Ads import with source_row_hash prevents duplicate rows and ensures daily totals match file exports
**Root Cause**: campaign_id/video_id with NULL or 'N/A' caused rows to collide and UPDATE instead of INSERT → missing data

---

## Prerequisites

1. ✅ Migration 023 applied (source_row_hash column exists)
2. ✅ Importer code updated (hash calculated per row, upsert by hash)
3. ✅ UI rollback fixed (batch_id field name corrected)
4. ✅ Test files ready:
   - Small file: 13 rows, spend 80.83, orders 24, revenue 5497.80
   - Creative file (day 17): 87 rows with multiple video_id='N/A' cases

---

## Test Scenarios

### Scenario 1: Initial Import - Small File (13 rows)

**Purpose**: Verify basic import succeeds and totals match

**Steps**:
1. Go to `/wallets` page → Click "Import Ads" button
2. Upload test file (13 rows)
3. Select "Product Ads" type
4. Wait for preview modal

**Preview Verification**:
```
✅ Kept Rows: 13
✅ Total Spend: 80.83
✅ Total Orders: 24
✅ Total Revenue: 5497.80
✅ Date Range: (check matches file)
```

5. Click "Confirm Import"
6. Wait for success toast

**SQL Verification**:
```sql
-- 1. Get latest batch
SELECT id, status, row_count, inserted_count, updated_count, error_count, created_at
FROM import_batches
WHERE report_type = 'tiktok_ads_daily'
ORDER BY created_at DESC
LIMIT 1;
-- Expected: status='success', row_count=13, inserted_count=13, updated_count=0, error_count=0

-- 2. Verify all rows have hash (copy batch_id from query 1)
SELECT COUNT(*) as rows_with_hash
FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>'
    AND source_row_hash IS NOT NULL;
-- Expected: 13

-- 3. Verify no NULL hashes
SELECT COUNT(*) as null_hash_count
FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>'
    AND source_row_hash IS NULL;
-- Expected: 0

-- 4. Check daily totals
SELECT
    ad_date,
    COUNT(*) as row_count,
    ROUND(SUM(spend)::NUMERIC, 2) as total_spend,
    SUM(orders) as total_orders,
    ROUND(SUM(revenue)::NUMERIC, 2) as total_revenue
FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>'
GROUP BY ad_date
ORDER BY ad_date;
-- Expected: Sum across all dates = 80.83 / 24 / 5497.80
```

**UI Verification**:
- Go to `/ads` page
- Check totals card: `80.83 / 24 / 5497.80`
- Check table: 13 rows visible
- Check filters work (date range, campaign type)

**Expected Result**: ✅ Pass if all verifications match

---

### Scenario 2: Import Creative File - Day 17 (87 rows with N/A)

**Purpose**: Verify fix handles video_id='N/A' without collapsing rows

**Background**: This is the main bug case - previous version collapsed multiple rows with video_id='N/A' into 1 row

**Steps**:
1. Upload creative ads file (87 rows, day 17)
2. Select "Product Ads" type
3. Check preview totals (should match file export totals)
4. Confirm import

**Preview Verification**:
```
✅ Kept Rows: 87 (not less!)
✅ Total Spend: (match file export)
✅ Total Orders: (match file export)
✅ Total Revenue: (match file export)
```

**SQL Verification**:
```sql
-- 1. Check rows with video_id='N/A' or NULL (should be MULTIPLE rows, not 1)
SELECT
    video_id,
    campaign_id,
    COUNT(*) as row_count,
    ROUND(SUM(spend)::NUMERIC, 2) as total_spend,
    SUM(orders) as total_orders
FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>'
    AND (video_id = 'N/A' OR video_id IS NULL)
GROUP BY video_id, campaign_id
ORDER BY row_count DESC;
-- Expected: Multiple groups with row_count > 1 (not just 1 row total)

-- 2. Verify no duplicate hashes
SELECT source_row_hash, COUNT(*) as count
FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>'
GROUP BY source_row_hash
HAVING COUNT(*) > 1;
-- Expected: 0 rows (no duplicate hashes)

-- 3. Check if totals match file export (compare with Excel SUM)
SELECT
    COUNT(*) as total_rows,
    ROUND(SUM(spend)::NUMERIC, 2) as total_spend,
    SUM(orders) as total_orders,
    ROUND(SUM(revenue)::NUMERIC, 2) as total_revenue
FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>';
-- Expected: Match file export totals EXACTLY
```

**UI Verification**:
- `/ads` page totals match file export
- Table shows 87 rows (not collapsed)
- Filter by video_id shows multiple rows

**Expected Result**: ✅ Pass if all 87 rows exist and totals match file export

---

### Scenario 3: Re-import Same File (Upsert Test)

**Purpose**: Verify re-import UPDATEs existing rows instead of failing or duplicating

**Steps**:
1. Re-upload SAME file (from Scenario 1 or 2)
2. Select same ads type
3. Check preview (should show same totals)
4. Confirm import

**SQL Verification**:
```sql
-- 1. Check latest batch shows UPDATED count (not inserted)
SELECT id, status, row_count, inserted_count, updated_count, error_count, created_at
FROM import_batches
WHERE report_type = 'tiktok_ads_daily'
ORDER BY created_at DESC
LIMIT 1;
-- Expected: updated_count > 0, inserted_count = 0 (or small if new rows)

-- 2. Verify no duplicate rows
SELECT COUNT(*) as total_ads
FROM ad_daily_performance
WHERE created_by = auth.uid()
    AND marketplace = 'tiktok';
-- Expected: Same count as first import (not doubled)

-- 3. Check no duplicate hashes across ALL imports
SELECT source_row_hash, COUNT(*) as count
FROM ad_daily_performance
WHERE created_by = auth.uid()
GROUP BY source_row_hash
HAVING COUNT(*) > 1;
-- Expected: 0 rows
```

**Expected Result**: ✅ Pass if UPDATEs work and no duplicates

---

### Scenario 4: Rollback via UI (Duplicate Import Dialog)

**Purpose**: Verify UI rollback button works (bug fix: batch_id field name)

**Steps**:
1. Import file (Scenario 1 file)
2. Try to import SAME file again → Should get "Duplicate Import" error
3. Error dialog should show:
   - "❌ นำเข้าซ้ำ" message
   - Batch ID in yellow box
   - "Rollback Previous Import" button
4. Click "Rollback Previous Import" button
5. Confirm in dialog
6. Wait for success toast

**SQL Verification**:
```sql
-- 1. Check batch status changed to 'rolled_back'
SELECT id, status, notes, updated_at
FROM import_batches
WHERE id = '<BATCH_ID>';
-- Expected: status='rolled_back', notes contains 'Rolled back at'

-- 2. Verify data deleted
SELECT COUNT(*) as remaining_ads
FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>';
-- Expected: 0

SELECT COUNT(*) as remaining_wallet
FROM wallet_ledger
WHERE import_batch_id = '<BATCH_ID>';
-- Expected: 0
```

**UI Verification**:
- Toast shows success message
- `/ads` page totals decrease
- Can now re-import the file (no duplicate error)

**Expected Result**: ✅ Pass if rollback completes and data deleted

---

### Scenario 5: Rollback via SQL then Re-import

**Purpose**: Verify SQL rollback function and re-import after rollback

**Steps**:
1. Import file (any file)
2. Get batch_id and user_id from SQL:
```sql
SELECT id, created_by FROM import_batches
WHERE report_type = 'tiktok_ads_daily'
ORDER BY created_at DESC LIMIT 1;
```
3. Run rollback in SQL Editor:
```sql
SELECT rollback_import_batch_as_admin(
    '<BATCH_ID>'::UUID,
    '<USER_ID>'::UUID
);
-- Expected: {"success": true, "wallet_deleted": X, "ads_deleted": Y, "batch_updated": true}
```
4. Verify data deleted (Scenario 4 SQL queries)
5. Re-import SAME file via UI
6. Should succeed (no duplicate error)

**SQL Verification**:
```sql
-- Check 2 batches exist: old (rolled_back) and new (success)
SELECT id, status, row_count, created_at
FROM import_batches
WHERE report_type = 'tiktok_ads_daily'
ORDER BY created_at DESC
LIMIT 2;
-- Expected: Row 1 = success, Row 2 = rolled_back
```

**Expected Result**: ✅ Pass if re-import succeeds after rollback

---

### Scenario 6: Edge Case - NULL campaign_id/video_id

**Purpose**: Verify rows with NULL IDs get unique hash based on spend/orders/revenue

**Test Data**: Create Excel with 3 rows:
- Same date, campaign_name, campaign_id='', video_id=''
- Row 1: spend=10.00, orders=1, revenue=100.00
- Row 2: spend=20.00, orders=2, revenue=200.00
- Row 3: spend=30.00, orders=3, revenue=300.00

**SQL Verification** (after import):
```sql
-- 1. Verify 3 separate rows (not collapsed to 1)
SELECT
    campaign_name,
    campaign_id,
    video_id,
    spend,
    orders,
    revenue,
    LEFT(source_row_hash, 8) as hash_prefix
FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>'
    AND campaign_id IS NULL
    AND video_id IS NULL
ORDER BY spend;
-- Expected: 3 rows with different spend/orders/revenue/hash

-- 2. Verify totals = SUM of all 3 rows
SELECT
    ROUND(SUM(spend)::NUMERIC, 2) as total_spend,
    SUM(orders) as total_orders,
    ROUND(SUM(revenue)::NUMERIC, 2) as total_revenue
FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>';
-- Expected: 60.00 / 6 / 600.00
```

**Expected Result**: ✅ Pass if all 3 rows exist with different hashes

---

## Summary Checklist

### Database Migration (Run First!)
- [ ] Migration 023 SQL executed in Supabase SQL Editor
- [ ] source_row_hash column exists (run verification query 1)
- [ ] Old unique index dropped (run verification query 2)
- [ ] New unique index created (run verification query 3)
- [ ] Backfill completed - 0 NULL hashes (run verification query 4)

### Import Logic
- [ ] Scenario 1: 13-row file imports correctly (totals match)
- [ ] Scenario 2: 87-row creative file imports correctly (no collapse)
- [ ] Scenario 3: Re-import UPDATEs existing rows (no duplicates)
- [ ] Scenario 4: UI rollback button works (batch_id fix)
- [ ] Scenario 5: SQL rollback + re-import works
- [ ] Scenario 6: NULL IDs create separate rows (unique hashes)

### UI/UX
- [ ] `/ads` page totals correct
- [ ] Table shows all rows (not collapsed)
- [ ] Import success toast appears
- [ ] Rollback success toast appears
- [ ] No console errors
- [ ] No browser crashes

### Performance
- [ ] Import < 10 seconds for 87 rows
- [ ] Rollback < 2 seconds
- [ ] Page load < 3 seconds

---

## Test Results Template

| Scenario | Status | Row Count | Totals Match? | Notes |
|----------|--------|-----------|---------------|-------|
| 1. Small Import (13) | ⬜ Pass / ❌ Fail | __ / 13 | ✅ / ❌ | |
| 2. Creative Day 17 (87) | ⬜ Pass / ❌ Fail | __ / 87 | ✅ / ❌ | |
| 3. Re-import (Upsert) | ⬜ Pass / ❌ Fail | N/A | ✅ / ❌ | |
| 4. UI Rollback | ⬜ Pass / ❌ Fail | N/A | ✅ / ❌ | |
| 5. SQL Rollback | ⬜ Pass / ❌ Fail | N/A | ✅ / ❌ | |
| 6. NULL IDs (3) | ⬜ Pass / ❌ Fail | __ / 3 | ✅ / ❌ | |

**Overall Result**: ⬜ Pass / ❌ Fail

**Tester**: _______________
**Date**: _______________
**Environment**: Dev / Staging / Production

**Critical Bugs Found**:
-

**Non-Critical Issues**:
-

---

## Troubleshooting Guide

### ❌ Totals don't match file export
**Symptoms**: Preview or DB totals < file export totals

**Diagnosis**:
```sql
-- Check for duplicate hashes (should be 0)
SELECT source_row_hash, COUNT(*) as count
FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>'
GROUP BY source_row_hash
HAVING COUNT(*) > 1;

-- Check for NULL hashes (should be 0)
SELECT COUNT(*) FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>' AND source_row_hash IS NULL;

-- Check row count vs file
SELECT COUNT(*) FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>';
```

**Fix**:
1. If NULL hashes exist → Check makeSourceRowHash() function
2. If row count < file rows → Check upsert query (should use source_row_hash)
3. If duplicate hashes → Check hash normalization (toFixed(2), toLowerCase)

---

### ❌ Rollback button shows "batch_id required" error
**Symptoms**: Click "Rollback Previous Import" → Error toast

**Diagnosis**:
- Check browser console for error
- Error message: "batch_id is required and must be a valid UUID"

**Fix**:
- Verify ImportAdsDialog.tsx line 280 uses `batch_id` (not `batchId`)
- Verify rollback endpoint receives correct field name

---

### ❌ Re-import blocked (duplicate error)
**Symptoms**: Upload same file → "Duplicate Import" error even after rollback

**Diagnosis**:
```sql
-- Check batch status
SELECT id, status FROM import_batches
WHERE file_hash = '<FILE_HASH>' AND report_type = 'tiktok_ads_daily'
ORDER BY created_at DESC;
```

**Fix**:
- If status='success' → Rollback first
- If status='rolled_back' → Check route.ts:102 ignores rolled_back
- If status='failed' → Safe to delete batch and re-import

---

### ❌ Unique constraint violation error
**Symptoms**: Import fails with "duplicate key value violates unique constraint"

**Diagnosis**:
- Check if migration 023 ran successfully
- Check if old index still exists

**Fix**:
```sql
-- Drop old index if exists
DROP INDEX IF EXISTS ad_daily_perf_unique_with_ids;

-- Verify new index exists
SELECT indexname FROM pg_indexes
WHERE tablename = 'ad_daily_performance'
    AND indexname = 'ad_daily_perf_unique_with_hash';
```

---

## SQL Quick Reference

```sql
-- Get current user ID
SELECT auth.uid() as user_id;

-- Get latest 3 batches
SELECT id, status, row_count, inserted_count, updated_count, error_count, created_at
FROM import_batches
WHERE report_type = 'tiktok_ads_daily'
ORDER BY created_at DESC
LIMIT 3;

-- Rollback batch (SQL Editor)
SELECT rollback_import_batch_as_admin(
    '<BATCH_ID>'::UUID,
    '<USER_ID>'::UUID
);

-- Daily totals by date
SELECT
    ad_date,
    COUNT(*) as rows,
    ROUND(SUM(spend)::NUMERIC, 2) as spend,
    SUM(orders) as orders,
    ROUND(SUM(revenue)::NUMERIC, 2) as revenue
FROM ad_daily_performance
WHERE marketplace = 'tiktok'
    AND created_by = auth.uid()
GROUP BY ad_date
ORDER BY ad_date DESC
LIMIT 30;

-- Check for duplicate hashes
SELECT source_row_hash, COUNT(*) as count
FROM ad_daily_performance
WHERE created_by = auth.uid()
GROUP BY source_row_hash
HAVING COUNT(*) > 1;

-- Check video_id='N/A' rows (should be multiple)
SELECT
    video_id,
    COUNT(*) as row_count,
    ROUND(SUM(spend)::NUMERIC, 2) as total_spend
FROM ad_daily_performance
WHERE created_by = auth.uid()
    AND video_id = 'N/A'
GROUP BY video_id;

-- Verify all rows have hash
SELECT
    COUNT(*) as total_rows,
    COUNT(source_row_hash) as rows_with_hash,
    COUNT(*) - COUNT(source_row_hash) as null_hash_count
FROM ad_daily_performance
WHERE created_by = auth.uid();
-- Expected: null_hash_count = 0
```

---

**END OF QA CHECKLIST**
