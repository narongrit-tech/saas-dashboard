# Integration Test Steps - Ads Import Daily

**Date:** 2026-01-26
**Feature:** Report Date + Ads Type selection
**Tester:** [Your Name]

---

## Prerequisites

### 1. Test Environment Setup
- [ ] Development environment running (`npm run dev`)
- [ ] Supabase project accessible
- [ ] User authenticated (logged in)
- [ ] ADS wallet exists in database

### 2. Test Files Prepared
- [ ] File 1: `ads-2026-01-20-product.xlsx` (with Date column, product keywords)
- [ ] File 2: `random-name.xlsx` (with Date column, no keywords)
- [ ] File 3: `no-date-column.xlsx` (WITHOUT Date column)
- [ ] File 4: `test-ads.xlsx` (for deduplication tests)
- [ ] File 5: `live-ads-2026-01-22.xlsx` (live type)

### 3. Database Baseline
Run this query to capture baseline state:
```sql
SELECT COUNT(*) FROM import_batches WHERE created_by = auth.uid();
SELECT COUNT(*) FROM ad_daily_performance WHERE created_by = auth.uid();
SELECT COUNT(*) FROM wallet_ledger WHERE created_by = auth.uid();
```
Record counts:
- import_batches: ___
- ad_daily_performance: ___
- wallet_ledger: ___

---

## Test Sequence

### TEST 1: Auto-detection (Product)

**Objective:** Verify filename auto-detection for date and type

**Steps:**
1. Navigate to `/ads` (or wherever ImportAdsDialog is used)
2. Click "Import Ads" button
3. Upload file: `ads-2026-01-20-product.xlsx`
4. Observe UI changes

**Verify:**
- [ ] Report Date auto-fills to `2026-01-20`
- [ ] Badge shows "Auto-detected 🎯" next to Report Date
- [ ] Ads Type auto-selects `Product (Creative)`
- [ ] Badge shows "Auto-detected 🎯" next to Ads Type
- [ ] Preview button is ENABLED (not disabled)

5. Click "ดู Preview" button
6. Wait for preview to load

**Verify Preview UI:**
- [ ] Blue card shows: Import Date = `20 Jan 2026`
- [ ] Blue card shows: Ads Type = `Product (Creative)`
- [ ] Summary cards show: Total Spend, Total Orders, Avg ROI
- [ ] Sample rows table displays (5 rows)
- [ ] No error messages
- [ ] No warning about missing date column (file has Date column)

7. Click "ยืนยันนำเข้า" button
8. Wait for import to complete

**Verify Success:**
- [ ] Success message appears (green alert)
- [ ] Dialog closes after 2 seconds
- [ ] No errors in browser console

9. Run DB verification (Section 1 of verify script)

**DB Verification:**
```sql
-- Query 1: Check import_batches
SELECT file_name, report_type, metadata->>'reportDate', metadata->>'adsType', status, row_count
FROM import_batches
WHERE created_by = auth.uid()
ORDER BY created_at DESC
LIMIT 1;
```
Expected:
- file_name = `ads-2026-01-20-product.xlsx`
- metadata reportDate = `2026-01-20`
- metadata adsType = `product`
- status = `success`

```sql
-- Query 2: Check ad_daily_performance
SELECT ad_date, campaign_type, COUNT(*) as row_count
FROM ad_daily_performance
WHERE created_by = auth.uid()
  AND ad_date::text LIKE '2026-01-20%'
GROUP BY ad_date, campaign_type;
```
Expected:
- ad_date = `2026-01-20`
- campaign_type = `product`
- row_count = [number of rows in file]

```sql
-- Query 3: Check wallet_ledger
SELECT date, entry_type, direction, amount, source
FROM wallet_ledger
WHERE created_by = auth.uid()
  AND date::text LIKE '2026-01-20%'
  AND source = 'IMPORTED'
ORDER BY created_at DESC
LIMIT 1;
```
Expected:
- date = `2026-01-20`
- entry_type = `SPEND`
- direction = `OUT`
- amount = [sum of all spend from file for 2026-01-20]
- source = `IMPORTED`

**Result:** ✅ PASS / ❌ FAIL
**Notes:** ___

---

### TEST 2: Manual Selection (Live)

**Objective:** Verify manual selection without auto-detection

**Steps:**
1. Click "Import Ads" button
2. Upload file: `random-name.xlsx`
3. Observe UI

**Verify:**
- [ ] Report Date is EMPTY (no auto-detection)
- [ ] No badge next to Report Date
- [ ] Ads Type defaults to `Product (Creative)`
- [ ] No badge next to Ads Type (or shows if file has keywords)
- [ ] Preview button is DISABLED

4. Manually select Report Date: `15 Jan 2026` (2026-01-15)
5. Change Ads Type to: `Live`

**Verify:**
- [ ] Preview button becomes ENABLED
- [ ] No auto-detected badges (manual selection)

6. Click "ดู Preview"
7. Wait for preview

**Verify Preview:**
- [ ] Blue card: Import Date = `15 Jan 2026`
- [ ] Blue card: Ads Type = `Live`
- [ ] Summary shows correct data

8. Click "ยืนยันนำเข้า"
9. Wait for success

**DB Verification:**
```sql
SELECT file_name, metadata->>'reportDate', metadata->>'adsType', status
FROM import_batches
WHERE created_by = auth.uid()
ORDER BY created_at DESC
LIMIT 1;
```
Expected:
- metadata reportDate = `2026-01-15`
- metadata adsType = `live`

```sql
SELECT campaign_type, COUNT(*)
FROM ad_daily_performance
WHERE created_by = auth.uid()
  AND campaign_type = 'live'
GROUP BY campaign_type;
```
Expected:
- campaign_type = `live`
- COUNT > 0

**Result:** ✅ PASS / ❌ FAIL
**Notes:** ___

---

### TEST 3: No Date Column Warning ⚠️

**Objective:** Verify warning when file has no Date column

**Steps:**
1. Click "Import Ads"
2. Select Report Date: `20 Jan 2026`
3. Upload file: `no-date-column.xlsx` (file WITHOUT Date column)
4. Click "ดู Preview"

**Verify Preview:**
- [ ] Warning appears: "⚠️ ไฟล์ไม่มี Date column - ใช้ Report Date สำหรับทุก row"
- [ ] Preview still shows (not blocked)
- [ ] Blue card: Import Date = `20 Jan 2026`
- [ ] Sample rows show same date for all rows

5. Click "ยืนยันนำเข้า"
6. Wait for success

**DB Verification:**
```sql
-- All rows should have same ad_date (reportDate)
SELECT ad_date, COUNT(*) as row_count
FROM ad_daily_performance
WHERE created_by = auth.uid()
  AND created_at > NOW() - INTERVAL '5 minutes'
GROUP BY ad_date
ORDER BY ad_date DESC;
```
Expected:
- Single group: ad_date = `2026-01-20`, row_count = [all rows]
- NOT multiple dates (would indicate file date was used instead)

**Result:** ✅ PASS / ❌ FAIL
**Notes:** ___

---

### TEST 4: Deduplication (4 Scenarios)

**Objective:** Verify dedup logic (fileHash + reportDate + adsType)

#### Scenario 4A: Same file + same date + same type → BLOCKED

**Steps:**
1. Click "Import Ads"
2. Select Report Date: `20 Jan 2026`
3. Select Ads Type: `Product`
4. Upload file: `test-ads.xlsx`
5. Preview and Import → Should succeed

**Verify:**
- [ ] Import successful

6. Immediately try again:
7. Select Report Date: `20 Jan 2026` (SAME)
8. Select Ads Type: `Product` (SAME)
9. Upload file: `test-ads.xlsx` (SAME)
10. Click Preview or Import

**Verify:**
- [ ] Error message appears
- [ ] Error contains: "ไฟล์นี้ถูก import แล้ว" or "Duplicate file"
- [ ] Error mentions date `2026-01-20` and type `product`
- [ ] Import is BLOCKED

**Result:** ✅ PASS / ❌ FAIL

---

#### Scenario 4B: Same file + different date + same type → ALLOWED

**Steps:**
1. Click "Import Ads"
2. Select Report Date: `21 Jan 2026` (DIFFERENT DATE)
3. Select Ads Type: `Product` (same)
4. Upload file: `test-ads.xlsx` (same file)
5. Click Preview and Import

**Verify:**
- [ ] No error message
- [ ] Import successful
- [ ] New batch created in DB

**DB Verification:**
```sql
SELECT file_hash, metadata->>'reportDate', COUNT(*)
FROM import_batches
WHERE created_by = auth.uid()
  AND file_name = 'test-ads.xlsx'
GROUP BY file_hash, metadata->>'reportDate';
```
Expected: 2 rows (2026-01-20 and 2026-01-21)

**Result:** ✅ PASS / ❌ FAIL

---

#### Scenario 4C: Same file + same date + different type → ALLOWED

**Steps:**
1. Click "Import Ads"
2. Select Report Date: `20 Jan 2026` (SAME as 4A)
3. Select Ads Type: `Live` (DIFFERENT TYPE)
4. Upload file: `test-ads.xlsx` (same file)
5. Click Preview and Import

**Verify:**
- [ ] No error message
- [ ] Import successful
- [ ] New batch created in DB

**DB Verification:**
```sql
SELECT metadata->>'reportDate', metadata->>'adsType', COUNT(*)
FROM import_batches
WHERE created_by = auth.uid()
  AND file_name = 'test-ads.xlsx'
  AND metadata->>'reportDate' = '2026-01-20'
GROUP BY metadata->>'reportDate', metadata->>'adsType';
```
Expected: 2 rows (product and live for 2026-01-20)

**Result:** ✅ PASS / ❌ FAIL

---

#### Scenario 4D: Verify all 3 imports in DB

**DB Verification:**
```sql
SELECT
  file_name,
  LEFT(file_hash, 12) as hash_prefix,
  metadata->>'reportDate' as report_date,
  metadata->>'adsType' as ads_type,
  status,
  created_at
FROM import_batches
WHERE created_by = auth.uid()
  AND file_name = 'test-ads.xlsx'
ORDER BY created_at;
```

Expected output:
| file_name | hash_prefix | report_date | ads_type | status | created_at |
|-----------|-------------|-------------|----------|--------|------------|
| test-ads.xlsx | abc123... | 2026-01-20 | product | success | ... |
| test-ads.xlsx | abc123... | 2026-01-21 | product | success | ... |
| test-ads.xlsx | abc123... | 2026-01-20 | live | success | ... |

- [ ] 3 rows returned
- [ ] Same file_hash prefix
- [ ] Different (reportDate, adsType) combinations
- [ ] All status = success

**Result:** ✅ PASS / ❌ FAIL
**Notes:** ___

---

### TEST 5: Backward Compatibility

**Objective:** Verify file WITH Date column uses file date (not reportDate)

**Steps:**
1. Create/use file with Date column containing dates: 2026-01-10, 2026-01-11, 2026-01-12
2. Click "Import Ads"
3. Select Report Date: `25 Jan 2026` (DIFFERENT from file dates)
4. Upload file
5. Click Preview

**Verify:**
- [ ] NO warning about missing date column
- [ ] Sample rows show file dates (2026-01-10, 2026-01-11, 2026-01-12)
- [ ] NOT all rows showing 2026-01-25

6. Click Import
7. Wait for success

**DB Verification:**
```sql
SELECT DISTINCT ad_date
FROM ad_daily_performance
WHERE created_by = auth.uid()
  AND created_at > NOW() - INTERVAL '5 minutes'
ORDER BY ad_date;
```

Expected:
- Multiple dates: 2026-01-10, 2026-01-11, 2026-01-12
- NOT 2026-01-25 (reportDate should be ignored)

```sql
SELECT date, COUNT(*)
FROM wallet_ledger
WHERE created_by = auth.uid()
  AND created_at > NOW() - INTERVAL '5 minutes'
GROUP BY date
ORDER BY date;
```

Expected:
- Multiple wallet entries (one per file date)
- NOT single entry for 2026-01-25

**Result:** ✅ PASS / ❌ FAIL
**Notes:** ___

---

## Regression Tests

### REG-1: Tiger Import Still Works

**Steps:**
1. Navigate to Wallets page
2. Select ADS wallet
3. Click "Import" button
4. Select "Tiger" tab (if separate dialog) OR use Tiger import dialog
5. Upload Tiger awareness file
6. Complete import

**Verify:**
- [ ] Tiger import dialog/tab works
- [ ] No errors related to reportDate/adsType (should not be required for Tiger)
- [ ] Import succeeds
- [ ] Creates wallet entry only (no ad_daily_performance)

**Result:** ✅ PASS / ❌ FAIL
**Notes:** ___

---

### REG-2: Manual Mapping Wizard Still Works

**Steps:**
1. Click "Import Ads"
2. Upload file with non-standard column names (trigger parse error)
3. Wait for error message
4. Click "Try Manual Mapping" button

**Verify:**
- [ ] Manual Mapping Wizard opens
- [ ] Can select report type (Product/Live)
- [ ] Can map columns manually
- [ ] Can preview and import via wizard
- [ ] No conflicts with reportDate/adsType

**Result:** ✅ PASS / ❌ FAIL
**Notes:** ___

---

### REG-3: Performance Ads Dialog (Old)

**Steps:**
1. Go to Wallets page → ADS wallet → Import button
2. Use Performance Ads Import Dialog (if separate from ImportAdsDialog)
3. Upload product or live file
4. Complete import

**Verify:**
- [ ] Old dialog still works (if it exists separately)
- [ ] No conflicts with new ImportAdsDialog
- [ ] Import succeeds

**Note:** If PerformanceAdsImportDialog.tsx is NOT used by main app, mark as N/A

**Result:** ✅ PASS / ❌ FAIL / N/A
**Notes:** ___

---

## Edge Cases

### EDGE-1: Future Date Validation

**Steps:**
1. Open Import Ads dialog
2. Try to select a future date (e.g., 2026-12-31)

**Verify:**
- [ ] Calendar disables future dates
- [ ] Cannot select date > today (Bangkok timezone)

**Result:** ✅ PASS / ❌ FAIL
**Notes:** ___

---

### EDGE-2: Missing Report Date

**Steps:**
1. Open Import Ads dialog
2. Upload file
3. Do NOT select Report Date
4. Try to click Preview

**Verify:**
- [ ] Preview button is DISABLED
- [ ] Cannot proceed without Report Date

**Result:** ✅ PASS / ❌ FAIL
**Notes:** ___

---

### EDGE-3: Empty File

**Steps:**
1. Upload Excel file with headers but no data rows
2. Select Report Date
3. Click Preview

**Verify:**
- [ ] Error message appears
- [ ] No crash
- [ ] Clear error message (e.g., "ไม่มีข้อมูลในไฟล์")

**Result:** ✅ PASS / ❌ FAIL
**Notes:** ___

---

## Performance Tests

### PERF-1: Large File (1000+ rows)

**Steps:**
1. Upload file with 1000+ rows
2. Select Report Date
3. Click Preview
4. Measure time to preview
5. Click Import
6. Measure time to complete import

**Verify:**
- [ ] Preview loads in < 10 seconds
- [ ] Import completes in < 60 seconds
- [ ] No browser freezing
- [ ] No timeout errors

**Timings:**
- Preview time: ___ seconds
- Import time: ___ seconds

**Result:** ✅ PASS / ❌ FAIL
**Notes:** ___

---

## Security Tests

### SEC-1: RLS Verification

**Query:**
```sql
-- Try to see other users' imports (should return 0)
SELECT COUNT(*)
FROM import_batches
WHERE created_by != auth.uid();
```

**Verify:**
- [ ] Query returns 0 (cannot see other users' data)

**Result:** ✅ PASS / ❌ FAIL
**Notes:** ___

---

### SEC-2: File Type Validation

**Steps:**
1. Try uploading .txt file
2. Try uploading .exe file
3. Try uploading .pdf file

**Verify:**
- [ ] All rejected with error message
- [ ] Only .xlsx/.xls accepted

**Result:** ✅ PASS / ❌ FAIL
**Notes:** ___

---

## Final Summary

### Test Results

| Category | Total | Pass | Fail | N/A |
|----------|-------|------|------|-----|
| Functional | 5 | ___ | ___ | ___ |
| Regression | 3 | ___ | ___ | ___ |
| Edge Cases | 3 | ___ | ___ | ___ |
| Performance | 1 | ___ | ___ | ___ |
| Security | 2 | ___ | ___ | ___ |
| **TOTAL** | **14** | **___** | **___** | **___** |

### Critical Issues Found
1. [None yet - fill during testing]
2.
3.

### Known Limitations
1. Auto-detection only works for specific filename patterns
2. Date column fallback requires reportDate parameter
3. [Add more if found]

### Production Readiness
- [ ] All critical tests passed
- [ ] No blocking issues found
- [ ] DB verification queries all passed
- [ ] Performance acceptable
- [ ] Security tests passed

**Production Ready:** ✅ YES / ❌ NO / ⚠️ WITH CAVEATS

**Sign-off:**
- Tester: _______________
- Date: _______________
- Notes: _______________

---

**END OF INTEGRATION TEST**
