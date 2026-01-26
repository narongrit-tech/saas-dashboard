# Ads Import Fix - Manual QA Checklist

ตามคำสั่ง AGENT D - เอกสารนี้แนะนำขั้นตอนการทดสอบ manual สำหรับ ads import fix ที่เพิ่ม campaign_id และ video_id columns

---

## เป้าหมายของ Fix

แก้ไข bug ที่ import ads แล้วได้แค่ 1 row aggregated แทนที่จะได้ 13 rows แยก (daily breakdown)

**Root Cause:**
- Upsert logic ใช้ unique constraint `(marketplace, ad_date, campaign_type, campaign_name, created_by)`
- ถ้า campaign_name ซ้ำกัน → UPDATE row เดิม → ข้อมูล overwrite กัน
- Fix: เพิ่ม campaign_id, video_id เพื่อแยก campaigns ที่ชื่อซ้ำกัน

**Changes:**
1. Add columns: `campaign_id TEXT`, `video_id TEXT` to `ad_daily_performance`
2. Update unique constraint เป็น: `(marketplace, ad_date, campaign_type, campaign_id, video_id, created_by)`
3. Parser รองรับ map columns: "Campaign ID", "Video ID" (ทุกภาษา)
4. Upsert logic ส่ง campaign_id, video_id ไปใน INSERT/UPDATE statements

---

## Prerequisites

**Test File:**
- File name: มีชื่อที่บอก date = 2026-01-16 (เช่น `ads-2026-01-16.xlsx`)
- Report type: Product Ads
- Expected data:
  - 13 rows (ไม่ใช่ 1 row)
  - Total Spend = 80.83
  - Total Orders = 24
  - Total Revenue = 5497.80

**Cleanup Script:**
- Location: `scripts/sql/cleanup_ads_import_2026-01-16.sql`
- Purpose: ลบ import เก่าทั้งหมดสำหรับ 2026-01-16

**Migration Script:**
- Location: `database-scripts/migration-021-ads-add-campaign-ids.sql`
- Purpose: เพิ่ม campaign_id, video_id columns + update unique constraint

**Verify Script:**
- Location: `scripts/sql/verify_ads_2026-01-16.sql`
- Purpose: ตรวจสอบว่า import ถูกต้อง (13 rows, totals match)

---

## Manual Test Steps

### Step 1: Cleanup Existing Data (5 min)

1. เปิด Supabase SQL Editor
2. Run preview queries จาก `scripts/sql/cleanup_ads_import_2026-01-16.sql` (STEP 1-3)
3. Verify output: เห็น batch IDs และ rows ที่จะลบ
4. Uncomment และ run DELETE commands (STEP 4-6)
5. Run verify cleanup (STEP 8) → Expected: 0 rows remaining

**Success:** ✅ All queries return 0 rows

---

### Step 2: Run Migration (2 min)

1. เปิด Supabase SQL Editor
2. Run `database-scripts/migration-021-ads-add-campaign-ids.sql` ทั้งหมด
3. Verify columns exist:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'ad_daily_performance'
  AND column_name IN ('campaign_id', 'video_id');
```

**Success:** ✅ 2 columns exist (campaign_id, video_id)

---

### Step 3: Restart Dev Server (1 min)

```bash
cd frontend
rm -rf .next
npm run dev
```

**Success:** ✅ Server starts, `/ads` page loads

---

### Step 4: Import Test File (5 min)

1. ไปที่ `http://localhost:3000/ads`
2. คลิก **Import** → Upload file
3. Set: Report Date = 2026-01-16, Ads Type = Product
4. คลิก **Preview**
5. **Verify Preview:**
   - แถวที่จะนำเข้า: **13** (NOT 1)
   - Total Spend: **80.83**
   - Total Orders: **24**
   - Total Revenue: **5497.80**
6. คลิก **ยืนยันนำเข้า**
7. **Verify Success:** "นำเข้าสำเร็จ 13 แถว"

**Success:** ✅ Preview shows 13 rows, import completes without errors

---

### Step 5: Verify Database (3 min)

Run `scripts/sql/verify_ads_2026-01-16.sql` ทั้งหมด

**Critical Checks:**
- TEST 1: Row count = **13**
- TEST 2: Totals: spend=80.83, orders=24, revenue=5497.80
- TEST 4: campaign_id populated (0 NULL rows)
- TEST 7: Wallet ledger has 1 entry with amount=80.83

**Success:** ✅ All 10 tests pass

---

### Step 6: Check UI (2 min)

1. กลับไปที่ `/ads` page
2. Filter: Date range ครอบคลุม 2026-01-16
3. **Verify:**
   - Summary cards: Totals match DB
   - Table: Shows **13 rows** (NOT 1 aggregated row)
   - Each row has distinct campaign data

**Success:** ✅ UI shows 13 rows, totals match

---

### Step 7: Check Logs (1 min)

1. Browser Console (F12): ❌ No red errors
2. Server logs: ✅ Look for `[UPSERT_DEBUG]` with campaign_id populated

**Success:** ✅ No errors, logs show campaign_id values

---

## Success Criteria Summary

- ✅ 13 rows imported (NOT 1 aggregated)
- ✅ Totals: spend=80.83, orders=24, revenue=5497.80
- ✅ campaign_id populated (NOT NULL)
- ✅ UI table shows 13 separate rows
- ✅ No console/server errors

---

## Rollback Plan

**If migration fails:**
```sql
ALTER TABLE ad_daily_performance
  DROP COLUMN IF EXISTS campaign_id,
  DROP COLUMN IF EXISTS video_id;
```

**If import fails:**
1. Run cleanup script
2. Check server logs
3. Report with error details

---

## Test Completion Checklist

- [ ] Step 1: Cleanup completed (0 rows)
- [ ] Step 2: Migration successful
- [ ] Step 3: Dev server restarted
- [ ] Step 4: Import successful (13 rows)
- [ ] Step 5: Verify script passed all tests
- [ ] Step 6: UI shows 13 rows
- [ ] Step 7: No errors
- [ ] Logs show campaign_id populated

**If ALL checked:** ✅ TEST PASSED

---

**Estimated Total Time:** ~20 minutes

---

## Additional Tests: RLS Isolation & Edge Cases

### Test 8: RLS Isolation (5 min)

**Purpose:** Verify users cannot see or manipulate each other's import data

**Test Case 1: User cannot see other users' imports**
```sql
-- As User A (logged in via app)
SELECT COUNT(*) FROM ad_daily_performance WHERE created_by != auth.uid();
-- Expected: 0 (RLS blocks other users' data)
```

**Test Case 2: User cannot rollback other users' imports**
```sql
-- Attempt to rollback another user's batch (should fail)
SELECT rollback_import_batch('<OTHER_USER_BATCH_ID>'::UUID);
-- Expected: {"success": false, "error": "Batch not found or access denied"}
```

**Test Case 3: Admin functions require explicit user_id**
```sql
-- Admin function without matching user_id (should fail)
SELECT rollback_import_batch_as_admin(
  '<BATCH_ID>'::UUID,
  '<WRONG_USER_ID>'::UUID
);
-- Expected: {"success": false, "error": "Batch not found or does not belong to specified user"}
```

**Success:** ✅ All RLS policies enforced, cross-user access blocked

---

### Test 9: Rollback System (10 min)

**Test Case 1: Rollback removes data but keeps batch**
```sql
-- Before rollback
SELECT COUNT(*) FROM ad_daily_performance WHERE import_batch_id = '<BATCH_ID>';
-- Expected: 13 rows

-- Execute rollback
SELECT rollback_import_batch_as_admin('<BATCH_ID>'::UUID, '<USER_ID>'::UUID);
-- Expected: {"success": true, "wallet_deleted": 1, "ads_deleted": 13, "batch_updated": true}

-- After rollback: Check data deleted
SELECT COUNT(*) FROM ad_daily_performance WHERE import_batch_id = '<BATCH_ID>';
-- Expected: 0 rows

-- After rollback: Check batch status
SELECT status, notes FROM import_batches WHERE id = '<BATCH_ID>';
-- Expected: status = 'rolled_back', notes contains "Rolled back at"
```

**Test Case 2: Re-import after rollback succeeds**
```sql
-- Check duplicate prevention ignores rolled_back status
SELECT status FROM import_batches
WHERE file_hash = '<HASH>'
  AND report_type = 'tiktok_ads_daily'
  AND status NOT IN ('failed', 'rolled_back', 'deleted');
-- Expected: 0 rows (allows re-import)
```

**Test Case 3: Purge completely removes batch**
```sql
-- Execute purge
SELECT purge_import_batch_as_admin('<BATCH_ID>'::UUID, '<USER_ID>'::UUID);
-- Expected: {"success": true, "wallet_deleted": 0, "ads_deleted": 0, "batch_deleted": true}

-- Verify batch deleted
SELECT COUNT(*) FROM import_batches WHERE id = '<BATCH_ID>';
-- Expected: 0 (batch completely removed)
```

**Success:** ✅ Rollback removes data, keeps audit trail; Purge removes everything

---

### Test 10: Edge Cases (15 min)

**Edge Case 1: Campaign with NULL campaign_id/video_id**
- Import file with campaigns missing ID columns
- Expected: Rows stored with NULL campaign_id/video_id, no collapse
- Verify: Use campaign_name in unique key to prevent collision

**Edge Case 2: Duplicate file hash detection**
```sql
-- Import same file twice (without rollback)
-- Expected: Error "นำเข้าซ้ำ - ไฟล์นี้ถูก import แล้วเมื่อ [timestamp]"
```

**Edge Case 3: Special characters in campaign names**
- Import campaigns with Thai, emoji, or special chars in names
- Expected: Full text preserved (no truncation), no SQL injection
- Verify: `SELECT campaign_name, LENGTH(campaign_name) FROM ad_daily_performance`

**Edge Case 4: Empty/whitespace campaign_id/video_id**
```typescript
// Parser logic: empty string → NULL conversion
campaign_id: campaignId === '' ? null : campaignId
```
- Import file with empty cells in ID columns
- Expected: NULL stored (not empty string), COALESCE in unique check works

**Edge Case 5: Stuck processing batch cleanup**
```sql
-- Find stuck batches (> 5 minutes in processing)
SELECT id, status, created_at,
       EXTRACT(EPOCH FROM (NOW() - created_at))/60 as minutes_stuck
FROM import_batches
WHERE status = 'processing'
  AND EXTRACT(EPOCH FROM (NOW() - created_at))/60 > 5;

-- Rollback stuck batch
SELECT rollback_import_batch_as_admin('<STUCK_BATCH_ID>'::UUID, '<USER_ID>'::UUID);
```

**Edge Case 6: Concurrent imports (same file, same user)**
- Scenario: User clicks import twice quickly
- Expected: First succeeds, second blocked by file_hash duplicate check
- Verify: Only 1 batch created, no data duplication

**Edge Case 7: Campaign name exactly at VARCHAR(500) limit**
- Import campaign with very long name (500 chars)
- Expected: Full text stored (no truncation), unique key works correctly
- Verify: `LENGTH(campaign_name) = 500`

**Success:** ✅ All edge cases handled gracefully, no data corruption

---

## Performance Benchmarks

**Import Performance:**
- 13 rows: < 3 seconds
- 100 rows: < 10 seconds
- 1000 rows: < 30 seconds

**Rollback Performance:**
- 13 rows: < 2 seconds
- 100 rows: < 5 seconds
- 1000 rows: < 15 seconds

**Database Query Performance:**
- Duplicate check: < 100ms (indexed on file_hash)
- Unique key check: < 50ms (composite index on ad_daily_performance)
- Wallet aggregation: < 200ms (daily totals)

---

## Regression Tests

After completing all tests, verify NO regressions in existing features:

1. ✅ Product Ads import still works
2. ✅ Live Ads import still works
3. ✅ Tiger Awareness import unaffected
4. ✅ Wallet ledger balances correct
5. ✅ /ads page filters work
6. ✅ CSV export includes new columns
7. ✅ Daily P&L calculations unaffected
8. ✅ Cashflow summary unaffected

---

## Final Verification: Comprehensive SQL Script

Run: `database-scripts/verify-ads-import-comprehensive.sql`

**10 Verification Sections:**
1. Row count = 13
2. campaign_id/video_id populated
3. Totals match expected values
4. No duplicate rows
5. Campaign names not truncated
6. Wallet ledger consistency
7. Import batch metadata correct
8. No stuck processing batches
9. RLS isolation verified
10. Summary report (all metrics PASS)

**Expected Result:** All 10 sections return ✓ PASS

---

## Documentation References

- **HOW_TO_PURGE_IMPORT.md** - Rollback vs Purge decision tree
- **ROLLBACK_IMPLEMENTATION_SUMMARY.md** - Technical implementation details
- **migration-022-import-batch-rollback.sql** - Database functions source
- **verify-ads-import-comprehensive.sql** - Full verification script

---

**Total Test Time (Including RLS + Edge Cases):** ~50 minutes
