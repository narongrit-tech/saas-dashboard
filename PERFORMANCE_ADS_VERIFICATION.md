# Performance Ads Import - Verification Checklist

**Created:** 2026-01-23
**Feature:** Performance Ads Import (Product & Live)

---

## Purpose

This checklist verifies that Performance Ads Import:
1. Creates ad_daily_performance records correctly (daily breakdown)
2. Creates wallet_ledger SPEND entries (daily aggregated)
3. Affects Accrual P&L (Advertising Cost)
4. Shows in Ads performance analytics
5. Validates templates correctly (must have sales metrics)
6. Deduplicates files properly
7. Product and Live imports are fully independent

---

## Pre-Import Verification

### ✅ UI Integration

- [ ] "Import Performance Ads" button visible on Wallets page
- [ ] Button only visible for ADS wallet type
- [ ] Button NOT visible for SUBSCRIPTION or OTHER wallet types
- [ ] Clicking button opens PerformanceAdsImportDialog

### ✅ Campaign Type Selector

- [ ] Tabs show: "Product Ads (Daily)" and "Live Ads (Weekly)"
- [ ] Can switch between Product and Live tabs
- [ ] Switching tabs resets file selection
- [ ] Default tab is Product

---

## Template Validation Tests

### Test 1: Valid Product Performance Report (Should PASS)

**File:** `TikTok Product Ads Report - 2024-12-01 to 2024-12-31.xlsx`

**Columns:**
- Date
- Campaign Name
- Cost
- GMV
- Orders
- ROAS

**Expected:**
- ✅ Parse successful
- ✅ Preview shows:
  - Campaign type: Product (Daily)
  - Report date range
  - Total spend, GMV, orders
  - Avg ROAS
  - Days count
  - Row count

**Verification Steps:**
- [ ] File accepted
- [ ] Preview displays correctly
- [ ] All metrics calculated properly
- [ ] ROAS color-coded (green >= 1, red < 1)

---

### Test 2: Valid Live Performance Report (Should PASS)

**File:** `TikTok Live Ads Weekly Report - 2024-12-01 to 2024-12-07.xlsx`

**Columns:**
- Date
- Campaign Name
- Spend
- Revenue
- Conversions
- ROI

**Expected:**
- ✅ Parse successful
- ✅ Campaign type: Live (Weekly)
- ✅ Daily breakdown shown
- ✅ Preview shows aggregated metrics

**Verification Steps:**
- [ ] File accepted with Live tab selected
- [ ] Preview shows correct campaign type
- [ ] Multiple days processed correctly

---

### Test 3: Invalid - Awareness Report (Should REJECT)

**File:** `Tiger Awareness Report - No Sales Metrics.xlsx`

**Columns:**
- Campaign Name
- Cost
- Reach
- Impressions

**Expected:**
- ❌ Parse REJECTED
- Error: "ไฟล์นี้ไม่มี sales metrics (GMV/Orders/ROAS) - ถ้าเป็น Awareness Ads ให้ใช้ Tiger Import"

**Verification Steps:**
- [ ] File rejected
- [ ] Error message displayed
- [ ] Cannot proceed to import
- [ ] Suggests using Tiger Import

---

### Test 4: Invalid - Missing Required Columns (Should REJECT)

**File:** `Incomplete Report.xlsx`

**Columns:**
- Date
- Campaign
- Cost
(Missing: GMV, Orders)

**Expected:**
- ❌ Parse REJECTED
- Error: "Template ไม่ถูกต้อง - Performance Ads ต้องมี: Date, Campaign, Cost, GMV, Orders"

**Verification Steps:**
- [ ] File rejected
- [ ] Error message lists required columns

---

## Import Process Tests

### Test 5: Successful Product Ads Import (3 days, 5 campaigns)

**Setup:**
- Product Ads report
- Date range: 2024-12-01 to 2024-12-03 (3 days)
- 5 campaigns per day = 15 total rows
- Total spend: ฿10,000 (฿3,333.33 per day average)
- Total GMV: ฿30,000
- Total orders: 150

**Expected After Import:**

1. **import_batches table:**
   - New record created
   - `report_type = 'tiktok_ads_product'`
   - `marketplace = 'tiktok'`
   - `period = '2024-12-01 to 2024-12-03'`
   - `file_hash = [SHA256 hash]`
   - `status = 'success'`
   - `inserted_count = 15`
   - `row_count = 15`

2. **ad_daily_performance table:**
   - 15 new records (one per day per campaign)
   - Fields:
     - `marketplace = 'tiktok'`
     - `ad_date` (2024-12-01, 02, 03)
     - `campaign_type = 'product'`
     - `campaign_name` (5 different campaigns)
     - `spend, orders, revenue, roi` (from file)
     - `source = 'imported'`
     - `import_batch_id = [batch ID]`

3. **wallet_ledger table:**
   - 3 new records (one per day)
   - Date: 2024-12-01, 2024-12-02, 2024-12-03
   - `entry_type = 'SPEND'`, `direction = 'OUT'`
   - `amount` = daily aggregated spend
   - `source = 'IMPORTED'`
   - `import_batch_id = [batch ID]`
   - `note = 'Product Ads Spend - YYYY-MM-DD'`

**Verification Steps:**
- [ ] Success message shows correct counts
- [ ] Dialog closes automatically
- [ ] Wallet ledger table refreshes
- [ ] 3 new SPEND entries visible (one per day)
- [ ] Query import_batches: Verify record
- [ ] Query ad_daily_performance: Verify 15 records
- [ ] Query wallet_ledger: Verify 3 entries with aggregated amounts

---

### Test 6: Successful Live Ads Import (7 days, 2 campaigns)

**Setup:**
- Live Ads report (weekly)
- Date range: 2024-12-01 to 2024-12-07 (7 days)
- 2 campaigns per day = 14 total rows
- Total spend: ฿50,000

**Expected:**
- 14 ad_daily_performance records (`campaign_type='live'`)
- 7 wallet_ledger entries (one per day)
- `report_type = 'tiktok_ads_live'`

**Verification Steps:**
- [ ] Import succeeds
- [ ] campaign_type field = 'live' in all records
- [ ] Report type correct in import_batches
- [ ] 7 daily wallet entries created

---

### Test 7: Duplicate File (Should REJECT)

**Setup:**
- Import same Product Ads report twice (same file content)

**Expected:**
- First import: ✅ Success
- Second import: ❌ Rejected
- Error: "ไฟล์นี้ถูก import ไปแล้ว - [filename] เมื่อ [timestamp]"

**Verification Steps:**
- [ ] First import succeeds
- [ ] Second import rejected
- [ ] Error message shows filename and timestamp
- [ ] NO duplicate ad_daily_performance records
- [ ] NO duplicate wallet entries
- [ ] NO duplicate import_batches record

---

### Test 8: ROAS Calculation (Missing in File)

**Setup:**
- Performance report without ROAS column
- Has: Spend and GMV

**Expected:**
- ✅ Import succeeds
- ROAS calculated automatically: GMV / Spend
- Preview shows calculated ROAS

**Verification Steps:**
- [ ] Import succeeds despite missing ROAS
- [ ] ad_daily_performance records have calculated ROI
- [ ] Preview displays calculated ROAS correctly

---

## Business Logic Verification

### Test 9: Accrual P&L INCLUDES Performance Spend

**Setup:**
- Import Product Ads with ฿5,000 spend on 2024-12-25

**Expected:**
- Daily P&L page for 2024-12-25:
  - "Advertising Cost" INCLUDES ฿5,000 from Performance Ads
  - Correctly aggregates from ad_daily_performance table

**Verification Steps:**
- [ ] Navigate to Daily P&L page
- [ ] Select date: 2024-12-25
- [ ] Verify "Advertising Cost" includes Performance Ads spend
- [ ] Breakdown shows ad spend correctly

---

### Test 10: Cashflow Summary INCLUDES Performance Spend

**Setup:**
- Same as Test 9

**Expected:**
- Cashflow page for date range including 2024-12-25:
  - "Cash Out" includes ฿5,000 from Performance Ads
  - Wallet ledger shows ฿5,000 SPEND entry

**Verification Steps:**
- [ ] Navigate to Cashflow page
- [ ] Verify "Cash Out" includes Performance Ads spend
- [ ] Wallet movement shows spend correctly

---

### Test 11: Ads Performance Analytics

**Setup:**
- Import Product Ads with daily breakdown

**Expected:**
- Can query ad_daily_performance for:
  - Daily ROI trends
  - Campaign comparison
  - Spend vs GMV analysis

**Verification Steps:**
- [ ] Navigate to Ads page (if exists) or query DB directly
- [ ] Verify daily performance records exist
- [ ] Can filter by date, campaign_type, campaign_name
- [ ] ROI calculations correct

---

### Test 12: Cannot Edit/Delete Imported Entries

**Setup:**
- Import Performance Ads successfully

**Expected:**
- Wallet ledger table shows IMPORTED entries
- Edit button DISABLED for imported entries
- Delete button DISABLED for imported entries

**Verification Steps:**
- [ ] Locate imported Performance Ads entries
- [ ] Edit button disabled
- [ ] Delete button disabled
- [ ] ad_daily_performance records immutable (no UI to edit)

---

### Test 13: Product and Live Independence

**Setup:**
- Import Product Ads for Dec 1-7
- Import Live Ads for Dec 1-7 (same dates, different campaigns)

**Expected:**
- Both imports succeed independently
- No conflicts or coupling
- Each has separate import_batches record
- wallet_ledger has entries from both (merged by date if overlapping)

**Verification Steps:**
- [ ] Both imports succeed
- [ ] 2 separate import_batches records
- [ ] ad_daily_performance has records from both (differentiated by campaign_type)
- [ ] wallet_ledger correctly aggregates spend per day

---

### Test 14: Partial Data Import (Real-World Frequency)

**Setup:**
- Import Product Ads for Dec 1-3 only (not complete week)
- Later import Product Ads for Dec 8-10 (gap in dates)

**Expected:**
- Both imports succeed
- No completeness enforcement
- System accepts gaps in data
- Each import independent

**Verification Steps:**
- [ ] First import succeeds (Dec 1-3)
- [ ] Second import succeeds (Dec 8-10)
- [ ] No errors about missing dates (Dec 4-7)
- [ ] Both sets of data coexist

---

## Edge Cases & Error Handling

### Test 15: Empty Excel File (Should REJECT)

**File:** Valid Performance filename, but empty worksheet

**Expected:**
- ❌ Parse REJECTED
- Error: "ไฟล์ว่างเปล่า ไม่มีข้อมูล"

**Verification Steps:**
- [ ] File rejected
- [ ] Error message displayed

---

### Test 16: Invalid Date Format (Should SKIP)

**File:** Performance report with:
- Some rows: valid dates
- Some rows: invalid dates ("N/A", blank, malformed)

**Expected:**
- ✅ Parse succeeds
- Invalid date rows SKIPPED
- Only valid rows processed
- Preview shows correct count

**Verification Steps:**
- [ ] Parse succeeds
- [ ] Invalid rows skipped silently
- [ ] Preview shows only valid row count
- [ ] Import creates records for valid rows only

---

### Test 17: Multiple Campaigns Same Day

**Setup:**
- Performance report with 10 campaigns on same day (2024-12-15)
- Each has different spend

**Expected:**
- 10 ad_daily_performance records created (one per campaign)
- 1 wallet_ledger entry created (aggregated spend for 2024-12-15)

**Verification Steps:**
- [ ] 10 ad_daily_performance records created
- [ ] All have ad_date = '2024-12-15'
- [ ] Each has unique campaign_name
- [ ] 1 wallet_ledger entry with sum of all 10 spends

---

### Test 18: Large File (Stress Test)

**File:** Performance report with 1000+ rows (30 days x 40 campaigns)

**Expected:**
- ✅ Parse succeeds (may take a few seconds)
- All valid rows processed
- Preview shows correct totals
- Import completes successfully

**Verification Steps:**
- [ ] Parse completes without timeout
- [ ] Preview shows correct row count (1000+)
- [ ] Import succeeds
- [ ] All records created in database
- [ ] No timeout or memory errors

---

## CSV Export Verification

### Test 19: Export Includes Imported Performance Entries

**Setup:**
- Import Performance Ads
- Export wallet ledger to CSV

**Expected:**
- CSV includes Performance Ads SPEND entries
- Fields correct:
  - Date, Entry Type (SPEND), Direction (OUT)
  - Amount (daily aggregated)
  - Source (IMPORTED)
  - Reference ID (filename)
  - Note ("Product Ads Spend - YYYY-MM-DD")

**Verification Steps:**
- [ ] Export CSV from Wallets page
- [ ] Open CSV file
- [ ] Verify Performance Ads entries exist
- [ ] All fields correct

---

## Summary: All Tests Passed?

- [ ] All UI integration tests passed
- [ ] All template validation tests passed
- [ ] All import process tests passed
- [ ] All business logic tests passed
- [ ] All independence tests passed
- [ ] All edge case tests passed
- [ ] All export tests passed

---

## Known Limitations

1. **No Auto Date Range Detection:**
   - System doesn't enforce continuous date ranges
   - Accepts partial imports (by design)

2. **Manual Campaign Type Selection:**
   - User must choose Product or Live
   - No auto-detection from file content

3. **Same Day Aggregation:**
   - Multiple imports for same day will create separate wallet entries
   - Not auto-merged (intentional - audit trail)

4. **No Campaign-Level Deduplication:**
   - File-level dedup only (by hash)
   - Can accidentally import same campaign data if in different file

---

## If Test Fails

**For Template Validation Failures:**
- Check `performance-ads-import-actions.ts` → `parsePerformanceAdsFile()`
- Verify column detection logic
- Check required columns list

**For Import Failures:**
- Check `performance-ads-import-actions.ts` → `importPerformanceAdsToSystem()`
- Verify ad_daily_performance insertion (upsert logic)
- Check wallet_ledger daily aggregation
- Verify import_batch creation

**For Business Logic Failures:**
- Check P&L calculation in `daily-pl.ts`
- Ensure it queries ad_daily_performance table
- Check campaign_type filter if needed
- Verify wallet_ledger entries included in cashflow

**For Independence Failures:**
- Verify no coupling between Product/Live imports
- Check import_batches report_type values
- Ensure no completeness validation

---

**Last Updated:** 2026-01-23
**Version:** 1.0 (Performance Ads Import Initial Release)
