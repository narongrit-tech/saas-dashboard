# QA Report: Ads Import Daily (reportDate + adsType)

**Date:** 2026-01-26
**Feature:** Ads Import with Report Date + Ads Type selection
**Components:** BE Parser + API Routes + FE Dialog

---

## Test Environment

- **Backend:** `/api/import/tiktok/ads-daily` + `/api/import/tiktok/ads-daily/preview`
- **Frontend:** `ImportAdsDialog.tsx`
- **Database:** Supabase (Postgres)
- **User:** Current authenticated user

---

## Code Review Results ✅

### Backend Changes
- ✅ `tiktok-ads-daily.ts`: parseAdsExcel() accepts reportDate + adsType
- ✅ `tiktok-ads-daily.ts`: Date column optional (fallback to reportDate)
- ✅ `tiktok-ads-daily.ts`: Warning added for missing date column
- ✅ `preview/route.ts`: Validates reportDate (YYYY-MM-DD) + adsType (product/live)
- ✅ `route.ts`: Dedup logic checks fileHash + reportDate + adsType
- ✅ `route.ts`: Metadata stores reportDate + adsType
- ✅ `route.ts`: Creates wallet_ledger SPEND entries (daily aggregated)

### Frontend Changes
- ✅ `ImportAdsDialog.tsx`: Report Date picker (required)
- ✅ `ImportAdsDialog.tsx`: Ads Type dropdown (required)
- ✅ `ImportAdsDialog.tsx`: Auto-detection from filename (date + type)
- ✅ `ImportAdsDialog.tsx`: Auto-detected badges (🎯)
- ✅ `ImportAdsDialog.tsx`: Preview button disabled until date + type filled
- ✅ `ImportAdsDialog.tsx`: FormData includes reportDate + adsType
- ✅ `ImportAdsDialog.tsx`: Import Date + Ads Type display (blue cards)

### Business Rules Compliance
- ✅ ADS Wallet: SPEND = IMPORTED only (existing rule preserved)
- ✅ Daily aggregation (one wallet entry per day)
- ✅ Dedup key: fileHash + reportDate + adsType
- ✅ Timezone: Asia/Bangkok (existing logic)
- ✅ P&L impact: Ad Spend affects Accrual P&L

---

## Manual Test Cases

### Test 1: Auto-detection ✅ (READY TO TEST)

**Steps:**
1. Open Import Ads Dialog
2. Upload file: `ads-2026-01-20-product.xlsx`
3. Check UI:
   - Report Date = 2026-01-20 with badge "Auto-detected 🎯"
   - Ads Type = Product with badge "Auto-detected 🎯"
4. Click "ดู Preview"
5. Verify preview displays:
   - Blue card: Import Date = 20 Jan 2026
   - Blue card: Ads Type = Product (Creative)
   - Summary stats (spend, orders, ROI)
   - No warnings
6. Click "ยืนยันนำเข้า"
7. Wait for success message

**Expected Result:**
- Auto-detection works
- Preview shows correct metadata
- Import succeeds

**DB Verification:**
```sql
-- Check ad_daily_performance
SELECT ad_date, campaign_type, campaign_name, spend, revenue, orders
FROM ad_daily_performance
WHERE created_by = auth.uid()
  AND ad_date::text LIKE '2026-01-20%'
ORDER BY created_at DESC
LIMIT 5;

-- Check wallet_ledger
SELECT date, entry_type, direction, amount, source, note
FROM wallet_ledger
WHERE wallet_id = (SELECT id FROM wallets WHERE wallet_type = 'ADS' AND created_by = auth.uid() LIMIT 1)
  AND date::text LIKE '2026-01-20%'
ORDER BY created_at DESC
LIMIT 5;

-- Check import_batches
SELECT report_type, file_hash, metadata->>'reportDate' as report_date,
       metadata->>'adsType' as ads_type, status, row_count
FROM import_batches
WHERE created_by = auth.uid()
ORDER BY created_at DESC
LIMIT 3;
```

**Expected DB State:**
- `ad_daily_performance`: Rows with ad_date = 2026-01-20, campaign_type = 'product'
- `wallet_ledger`: SPEND entries with date = 2026-01-20, source = 'IMPORTED'
- `import_batches`: metadata contains `{"reportDate": "2026-01-20", "adsType": "product"}`

**Actual Result:** [TO BE FILLED BY TESTER]

---

### Test 2: Manual Selection (No Auto-detect) ✅ (READY TO TEST)

**Steps:**
1. Open Import Ads Dialog
2. Upload file: `random-name.xlsx`
3. Check UI:
   - Report Date = empty (no badge)
   - Ads Type = Product (default, no badge)
4. Manually select Report Date = 2026-01-15
5. Change Ads Type = Live
6. Click "ดู Preview"
7. Verify blue cards show:
   - Import Date = 15 Jan 2026
   - Ads Type = Live
8. Click "ยืนยันนำเข้า"

**Expected Result:**
- Manual selection works
- Preview shows manual values
- Import succeeds with live type

**DB Verification:**
```sql
-- Check campaign_type = 'live'
SELECT ad_date, campaign_type, campaign_name, spend
FROM ad_daily_performance
WHERE created_by = auth.uid()
  AND campaign_type = 'live'
  AND ad_date::text LIKE '2026-01-15%'
ORDER BY created_at DESC
LIMIT 5;
```

**Expected:** campaign_type = 'live', ad_date from file (not 2026-01-15 unless file has no date column)

**Actual Result:** [TO BE FILLED BY TESTER]

---

### Test 3: No Date Column Warning ⚠️ (CRITICAL)

**Prerequisites:**
- Create test file without Date column (only Campaign, Cost, GMV, Orders)

**Steps:**
1. Open Import Ads Dialog
2. Select Report Date = 2026-01-20
3. Upload file without Date column
4. Click "ดู Preview"
5. Check for warning:
   - "⚠️ ไฟล์ไม่มี Date column - ใช้ Report Date สำหรับทุก row"
6. Verify preview shows reportDate in all rows
7. Click "ยืนยันนำเข้า"

**Expected Result:**
- Warning displayed
- All rows use reportDate = 2026-01-20

**DB Verification:**
```sql
-- All rows should have same ad_date
SELECT ad_date, COUNT(*) as row_count
FROM ad_daily_performance
WHERE created_by = auth.uid()
  AND ad_date::text LIKE '2026-01-20%'
GROUP BY ad_date
ORDER BY ad_date DESC
LIMIT 5;
```

**Expected:** Single group with ad_date = 2026-01-20, row_count = [file row count]

**Actual Result:** [TO BE FILLED BY TESTER]

---

### Test 4: Deduplication (4 Scenarios) 🔒 (CRITICAL)

**Scenario 4.1: Same file + same date + same type → BLOCKED**

**Steps:**
1. Import file `test-ads.xlsx`, reportDate = 2026-01-20, adsType = product
2. Wait for success
3. Import SAME file again with SAME reportDate + adsType
4. Verify error message:
   - "ไฟล์นี้ถูก import แล้วสำหรับวันที่ 2026-01-20 (product)"

**Expected:** Import blocked, error shown

**Scenario 4.2: Same file + different date + same type → ALLOWED**

**Steps:**
1. Import file `test-ads.xlsx`, reportDate = 2026-01-21, adsType = product
2. Verify success

**Expected:** Import allowed (different date)

**Scenario 4.3: Same file + same date + different type → ALLOWED**

**Steps:**
1. Import file `test-ads.xlsx`, reportDate = 2026-01-20, adsType = live
2. Verify success

**Expected:** Import allowed (different type)

**Scenario 4.4: Verify all 3 imports in DB**

**DB Verification:**
```sql
-- Should see 3 separate import_batches
SELECT file_name, file_hash, metadata->>'reportDate' as report_date,
       metadata->>'adsType' as ads_type, status, created_at
FROM import_batches
WHERE created_by = auth.uid()
  AND file_name = 'test-ads.xlsx'
ORDER BY created_at DESC
LIMIT 5;
```

**Expected:** 3 rows with different (reportDate, adsType) combinations

**Actual Result:** [TO BE FILLED BY TESTER]

---

### Test 5: Backward Compatibility (File with Date column) ✅

**Steps:**
1. Upload file WITH Date column (e.g., dates 2026-01-10 to 2026-01-15)
2. Select Report Date = 2026-01-20 (different from file dates)
3. Click Preview
4. Verify:
   - NO warning about missing date column
   - Sample rows show file dates (2026-01-10, 2026-01-11, etc.)
5. Click Import

**Expected Result:**
- File dates used (NOT reportDate)
- Multiple wallet entries (one per file date)

**DB Verification:**
```sql
-- Should see multiple dates from file
SELECT DISTINCT ad_date
FROM ad_daily_performance
WHERE created_by = auth.uid()
  AND created_at > NOW() - INTERVAL '5 minutes'
ORDER BY ad_date;
```

**Expected:** Dates from file (e.g., 2026-01-10, 2026-01-11, ..., 2026-01-15)

**Actual Result:** [TO BE FILLED BY TESTER]

---

## Regression Tests

### Regression 1: Tiger Import Still Works ✅

**Steps:**
1. Go to Wallets page → Select ADS Wallet
2. Click "Import" → Select Tiger tab
3. Upload Tiger awareness file
4. Verify import succeeds

**Expected:** Tiger import unaffected

**Actual Result:** [TO BE FILLED BY TESTER]

---

### Regression 2: Manual Mapping Wizard Still Works ✅

**Steps:**
1. Open Import Ads Dialog
2. Upload file with non-standard columns
3. Wait for preview error
4. Click "Try Manual Mapping" button
5. Verify wizard opens and works

**Expected:** Manual mapping wizard unaffected

**Actual Result:** [TO BE FILLED BY TESTER]

---

### Regression 3: Performance Ads Import (Old Dialog) ✅

**Steps:**
1. Go to Wallets page → Select ADS Wallet → Import
2. Use Performance Ads Import Dialog (PerformanceAdsImportDialog.tsx)
3. Upload product/live file
4. Verify import succeeds

**Expected:** Performance Ads dialog unaffected

**Actual Result:** [TO BE FILLED BY TESTER]

---

## DB Verification Queries (Master List)

### Query 1: Recent Imports
```sql
SELECT
  ib.file_name,
  ib.report_type,
  ib.metadata->>'reportDate' as report_date,
  ib.metadata->>'adsType' as ads_type,
  ib.status,
  ib.row_count,
  ib.inserted_count,
  ib.created_at
FROM import_batches ib
WHERE ib.created_by = auth.uid()
  AND ib.report_type IN ('tiktok_ads_product', 'tiktok_ads_live', 'tiktok_ads_daily')
ORDER BY ib.created_at DESC
LIMIT 10;
```

### Query 2: Ad Performance Records
```sql
SELECT
  adp.ad_date,
  adp.campaign_type,
  adp.campaign_name,
  adp.spend,
  adp.revenue,
  adp.orders,
  adp.roi,
  adp.source,
  adp.created_at
FROM ad_daily_performance adp
WHERE adp.created_by = auth.uid()
ORDER BY adp.created_at DESC
LIMIT 20;
```

### Query 3: Wallet Ledger Entries
```sql
SELECT
  wl.date,
  wl.entry_type,
  wl.direction,
  wl.amount,
  wl.source,
  wl.note,
  wl.created_at,
  w.name as wallet_name
FROM wallet_ledger wl
JOIN wallets w ON wl.wallet_id = w.id
WHERE wl.created_by = auth.uid()
  AND w.wallet_type = 'ADS'
ORDER BY wl.created_at DESC
LIMIT 20;
```

### Query 4: Daily Aggregation Check
```sql
-- Verify one wallet entry per day (aggregated)
SELECT
  wl.date,
  COUNT(*) as entry_count,
  SUM(wl.amount) as total_amount
FROM wallet_ledger wl
JOIN wallets w ON wl.wallet_id = w.id
WHERE wl.created_by = auth.uid()
  AND w.wallet_type = 'ADS'
  AND wl.source = 'IMPORTED'
  AND wl.created_at > NOW() - INTERVAL '1 hour'
GROUP BY wl.date
ORDER BY wl.date DESC;
```

**Expected:** Each date has multiple entries (one per import), but each import creates one entry per unique date

### Query 5: Deduplication Verification
```sql
-- Check for duplicates (should be none)
SELECT
  file_hash,
  metadata->>'reportDate' as report_date,
  metadata->>'adsType' as ads_type,
  COUNT(*) as duplicate_count
FROM import_batches
WHERE created_by = auth.uid()
  AND status = 'success'
GROUP BY file_hash, metadata->>'reportDate', metadata->>'adsType'
HAVING COUNT(*) > 1;
```

**Expected:** Empty result (no duplicates)

---

## Performance Tests

### Performance 1: Large File Import
- **File size:** 1000+ rows
- **Expected time:** < 60 seconds
- **Memory:** No crashes

**Actual Result:** [TO BE FILLED BY TESTER]

---

### Performance 2: Multiple Imports
- **Scenario:** 5 imports in sequence
- **Expected:** All succeed, no deadlocks

**Actual Result:** [TO BE FILLED BY TESTER]

---

## Edge Cases

### Edge 1: Future Date Validation
**Steps:**
1. Select Report Date = 2026-12-31 (future)
2. Verify calendar disables future dates

**Expected:** Cannot select future dates

**Actual Result:** [TO BE FILLED BY TESTER]

---

### Edge 2: Invalid Date Format
**Steps:**
1. Manually edit FormData (developer tools)
2. Send reportDate = "invalid"
3. Verify API returns 400 error

**Expected:** API rejects invalid format

**Actual Result:** [TO BE FILLED BY TESTER]

---

### Edge 3: Missing Required Params
**Steps:**
1. Upload file without selecting Report Date
2. Click Preview

**Expected:** Button disabled OR error shown

**Actual Result:** [TO BE FILLED BY TESTER]

---

## Security Tests

### Security 1: RLS Verification
**Query:**
```sql
-- Other users should NOT see my imports
SELECT COUNT(*)
FROM import_batches
WHERE created_by != auth.uid();
```

**Expected:** 0 rows (RLS working)

**Actual Result:** [TO BE FILLED BY TESTER]

---

### Security 2: File Upload Validation
**Steps:**
1. Try uploading .txt file
2. Try uploading .exe file

**Expected:** Both rejected (only .xlsx/.xls allowed)

**Actual Result:** [TO BE FILLED BY TESTER]

---

## Summary

### Test Results Matrix

| Test ID | Test Name | Status | Notes |
|---------|-----------|--------|-------|
| T1 | Auto-detection | ⏳ PENDING | |
| T2 | Manual Selection | ⏳ PENDING | |
| T3 | No Date Column Warning | ⏳ PENDING | Critical |
| T4.1 | Dedup: Same file+date+type | ⏳ PENDING | Critical |
| T4.2 | Dedup: Different date | ⏳ PENDING | |
| T4.3 | Dedup: Different type | ⏳ PENDING | |
| T5 | Backward Compatibility | ⏳ PENDING | |
| R1 | Regression: Tiger Import | ⏳ PENDING | |
| R2 | Regression: Manual Mapping | ⏳ PENDING | |
| R3 | Regression: Performance Ads | ⏳ PENDING | |
| P1 | Performance: Large File | ⏳ PENDING | |
| E1 | Edge: Future Date | ⏳ PENDING | |
| E2 | Edge: Invalid Format | ⏳ PENDING | |
| S1 | Security: RLS | ⏳ PENDING | |
| S2 | Security: File Type | ⏳ PENDING | |

### Overall Status
- **Total Tests:** 15
- **Passed:** 0
- **Failed:** 0
- **Pending:** 15
- **Blocked:** 0

### Critical Issues Found
- None yet (pending manual tests)

### Known Limitations
- Auto-detection only works for specific filename patterns
- Date column fallback requires reportDate to be provided

### Recommendations
1. **Before Production:**
   - Complete all manual tests with real files
   - Verify DB state after each test
   - Test with edge cases (empty files, malformed data)
   - Load test with 10+ concurrent imports

2. **Documentation:**
   - Update user guide with reportDate requirement
   - Add screenshots of auto-detection badges
   - Document dedup behavior

3. **Future Enhancements:**
   - Add reportDate to preview summary
   - Show dedup warning before upload (check hash in real-time)
   - Support date ranges (start/end date)

---

## Sign-off

**Tested by:** [QA Agent - Automated]
**Date:** 2026-01-26
**Status:** ⏳ READY FOR MANUAL TESTING

**Production Ready:** ❓ PENDING MANUAL TESTS

---

## Appendix: Test Files Required

### File 1: `ads-2026-01-20-product.xlsx`
- **Columns:** Date, Campaign, Cost, GMV, Orders
- **Rows:** 5-10 rows
- **Date range:** 2026-01-20 (single day)

### File 2: `random-name.xlsx`
- **Columns:** Date, Campaign, Cost, GMV, Orders
- **Rows:** 5-10 rows
- **Date range:** 2026-01-10 to 2026-01-15

### File 3: `no-date-column.xlsx`
- **Columns:** Campaign, Cost, GMV, Orders (NO DATE)
- **Rows:** 5 rows

### File 4: `test-ads.xlsx`
- **Columns:** Date, Campaign, Cost, GMV, Orders
- **Rows:** 3 rows
- **Purpose:** For deduplication tests

### File 5: `large-file.xlsx`
- **Columns:** Date, Campaign, Cost, GMV, Orders
- **Rows:** 1000+ rows
- **Purpose:** Performance testing

---

**END OF REPORT**
