# Tiger Awareness Ads Import - Verification Checklist

**Created:** 2026-01-23
**Feature:** Monthly Awareness Ads (Tiger) Import → Wallet SPEND Only

---

## Purpose

This checklist verifies that Tiger Awareness Import:
1. Creates wallet SPEND entries correctly (monthly aggregation)
2. Does NOT affect Accrual P&L
3. Does NOT create ad_daily_performance records
4. Shows ONLY in Cashflow Summary
5. Validates templates correctly (blocks files with sales metrics)
6. Deduplicates files properly

---

## Pre-Import Verification

### ✅ UI Integration

- [ ] "Import Awareness Ads (Monthly)" button visible on Wallets page
- [ ] Button only visible for ADS wallet type
- [ ] Button NOT visible for SUBSCRIPTION or OTHER wallet types
- [ ] Clicking button opens TigerImportDialog

### ✅ File Upload UI

- [ ] File input accepts `.xlsx` only
- [ ] Upload button works
- [ ] Loading state shows "กำลังอ่านไฟล์..." during parse
- [ ] Preview shows after successful parse
- [ ] Error shows for invalid files

---

## Template Validation Tests

### Test 1: Valid Tiger Report (Should PASS)

**File:** `Tiger x CoolSmile-Campaign Report-(2024-12-01 to 2024-12-31).xlsx`

**Columns:**
- Campaign Name
- Cost
- Currency

**Expected:**
- ✅ Parse successful
- ✅ Preview shows:
  - Filename
  - Report date range (2024-12-01 to 2024-12-31)
  - Total spend
  - Currency
  - Campaign count
  - Row count
  - Posting date (2024-12-31)

**Verification Steps:**
- [ ] File accepted
- [ ] Preview displays correctly
- [ ] All preview fields populated
- [ ] Posting date = report end date

---

### Test 2: Invalid - Performance Report (Should REJECT)

**File:** `TikTok Ads Daily Report-Campaign Report-(2024-12-01 to 2024-12-31).xlsx`

**Columns:**
- Campaign Name
- Cost
- GMV
- Orders
- ROAS

**Expected:**
- ❌ Parse REJECTED
- Error: "ไฟล์นี้มี sales metrics (GMV/Orders/ROAS) ไม่ใช่ Awareness Report - กรุณาใช้ Performance Ads Import แทน"

**Verification Steps:**
- [ ] File rejected
- [ ] Error message displayed
- [ ] Cannot proceed to import
- [ ] Preview NOT shown

---

### Test 3: Invalid - Wrong Filename (Should REJECT)

**File:** `Some Random Report-(2024-12-01 to 2024-12-31).xlsx`

**Expected:**
- ❌ Parse REJECTED
- Error: "ชื่อไฟล์ไม่ถูกต้อง - ต้องมี Tiger หรือ Campaign Report ในชื่อไฟล์"

**Verification Steps:**
- [ ] File rejected
- [ ] Error message displayed
- [ ] Cannot proceed to import

---

### Test 4: Invalid - No Date Range (Should REJECT)

**File:** `Tiger x CoolSmile-Campaign Report.xlsx`

**Expected:**
- ❌ Parse REJECTED
- Error: "ไม่พบ date range ในชื่อไฟล์ - ต้องมี format: (YYYY-MM-DD to YYYY-MM-DD)"

**Verification Steps:**
- [ ] File rejected
- [ ] Error message displayed
- [ ] Cannot proceed to import

---

### Test 5: Invalid - Wrong File Extension (Should REJECT)

**File:** `Tiger x CoolSmile-Campaign Report-(2024-12-01 to 2024-12-31).csv`

**Expected:**
- ❌ Parse REJECTED
- Error: "ไฟล์ต้องเป็น .xlsx เท่านั้น (Excel format)"

**Verification Steps:**
- [ ] File rejected
- [ ] Error message displayed

---

## Import Process Tests

### Test 6: Successful Import

**Setup:**
- Use valid Tiger report
- Total spend: ฿50,000.00
- 10 campaigns
- Date range: 2024-12-01 to 2024-12-31

**Expected After Import:**
1. **import_batches table:**
   - New record created
   - `report_type = 'tiger_awareness_monthly'`
   - `marketplace = 'tiktok'`
   - `period = 'MONTHLY - 2024-12-01 to 2024-12-31'`
   - `file_hash = [SHA256 hash]`
   - `status = 'success'`
   - `inserted_count = 1`
   - `row_count = [number of rows]`

2. **wallet_ledger table:**
   - Exactly 1 new record
   - `wallet_id = [TikTok Ads Wallet ID]`
   - `date = '2024-12-31'` (end date)
   - `entry_type = 'SPEND'`
   - `direction = 'OUT'`
   - `amount = 50000.00`
   - `source = 'IMPORTED'`
   - `import_batch_id = [batch ID from step 1]`
   - `reference_id = [filename]`
   - `note` contains: "Monthly Awareness Spend (Tiger) - 2024-12"

3. **ad_daily_performance table:**
   - NO new records (awareness ≠ performance)

**Verification Steps:**
- [ ] Success message shows: "Import สำเร็จ - 10 campaigns, ยอดรวม 50,000.00 THB"
- [ ] Dialog closes automatically after 2 seconds
- [ ] Wallet ledger table refreshes
- [ ] New SPEND entry visible with IMPORTED badge
- [ ] Balance summary updates (Total OUT increases by ฿50,000)
- [ ] Query import_batches: Verify record exists
- [ ] Query wallet_ledger: Verify 1 record with correct fields
- [ ] Query ad_daily_performance: Verify NO new records

---

### Test 7: Duplicate File (Should REJECT)

**Setup:**
- Import same Tiger report twice (same file content)

**Expected:**
- First import: ✅ Success
- Second import: ❌ Rejected
- Error: "ไฟล์นี้ถูก import ไปแล้ว - [filename] เมื่อ [timestamp]"

**Verification Steps:**
- [ ] First import succeeds
- [ ] Second import rejected
- [ ] Error message shows filename and timestamp of first import
- [ ] NO duplicate wallet_ledger entry created
- [ ] NO duplicate import_batches record created

---

### Test 8: Import to Non-ADS Wallet (Should REJECT)

**Setup:**
- Try to import Tiger report to SUBSCRIPTION wallet

**Expected:**
- ❌ Import REJECTED
- Error: "Tiger import ต้องใช้กับ ADS Wallet เท่านั้น"

**Verification Steps:**
- [ ] Import blocked
- [ ] Error message displayed
- [ ] NO wallet_ledger entry created

---

## Business Logic Verification

### Test 9: Accrual P&L Does NOT Include Tiger Spend

**Setup:**
- Import Tiger report with ฿50,000 spend on 2024-12-31

**Expected:**
- Daily P&L page for 2024-12-31:
  - Advertising Cost should NOT include ฿50,000 from Tiger
  - Only performance ad spend from ad_daily_performance should show

**Verification Steps:**
- [ ] Navigate to Daily P&L page
- [ ] Select date: 2024-12-31
- [ ] Verify "Advertising Cost" does NOT include Tiger spend
- [ ] Tiger spend NOT visible in P&L breakdown

---

### Test 10: Cashflow Summary INCLUDES Tiger Spend

**Setup:**
- Same as Test 9

**Expected:**
- Cashflow page for date range including 2024-12-31:
  - "Cash Out" should include ฿50,000 from Tiger
  - Wallet movement should show ฿50,000 spend
  - Running balance should decrease by ฿50,000

**Verification Steps:**
- [ ] Navigate to Cashflow page
- [ ] Select date range including 2024-12-31
- [ ] Verify "Cash Out" includes Tiger spend
- [ ] Verify running balance decreased correctly
- [ ] Tiger spend visible as wallet movement

---

### Test 11: Cannot Edit Imported Tiger Entry

**Setup:**
- Import Tiger report successfully

**Expected:**
- Wallet ledger table shows IMPORTED entry
- Edit button DISABLED
- Delete button DISABLED
- Tooltip/note: "ไม่สามารถแก้ไข/ลบรายการที่ import มาได้"

**Verification Steps:**
- [ ] Locate imported Tiger entry in wallet ledger table
- [ ] Edit button disabled
- [ ] Delete button disabled
- [ ] Clicking disabled buttons shows no action

---

### Test 12: CSV Export Includes Tiger Entry

**Setup:**
- Import Tiger report
- Export wallet ledger to CSV

**Expected:**
- CSV file includes Tiger import entry
- Fields:
  - Date: 2024-12-31
  - Entry Type: SPEND
  - Direction: OUT
  - Amount: 50000.00
  - Source: IMPORTED
  - Reference ID: [filename]
  - Note: "Monthly Awareness Spend (Tiger) - 2024-12"

**Verification Steps:**
- [ ] Export CSV from Wallets page
- [ ] Open CSV file
- [ ] Verify Tiger entry exists
- [ ] Verify all fields correct

---

### Test 13: Multiple Tiger Imports (Different Months)

**Setup:**
- Import Tiger report for Dec 2024: ฿50,000
- Import Tiger report for Jan 2025: ฿60,000

**Expected:**
- 2 separate wallet_ledger entries
- Entry 1: date=2024-12-31, amount=50000
- Entry 2: date=2025-01-31, amount=60000
- Both entries visible in wallet ledger table

**Verification Steps:**
- [ ] Both imports succeed
- [ ] 2 entries visible in wallet ledger
- [ ] Dates correct (end dates of respective months)
- [ ] Amounts correct
- [ ] Both have IMPORTED badge

---

## Edge Cases & Error Handling

### Test 14: Empty Excel File (Should REJECT)

**File:** Valid Tiger filename, but empty worksheet

**Expected:**
- ❌ Parse REJECTED
- Error: "ไฟล์ว่างเปล่า ไม่มีข้อมูล"

**Verification Steps:**
- [ ] File rejected
- [ ] Error message displayed

---

### Test 15: Invalid Cost Values (Should SKIP)

**File:** Valid Tiger report, but some rows have:
- Cost = 0
- Cost = null
- Cost = "N/A"

**Expected:**
- ✅ Parse successful
- Invalid rows SKIPPED
- Only valid rows counted in campaign count
- Total spend = sum of valid rows only

**Verification Steps:**
- [ ] Parse succeeds
- [ ] Preview shows correct campaign count (valid rows only)
- [ ] Preview shows correct total spend (valid rows only)
- [ ] Import succeeds with correct amount

---

### Test 16: Large File (Stress Test)

**File:** Tiger report with 500+ campaigns

**Expected:**
- ✅ Parse successful (may take a few seconds)
- Monthly aggregation works correctly
- Single wallet entry created with total spend

**Verification Steps:**
- [ ] Parse completes without timeout
- [ ] Preview shows correct campaign count (500+)
- [ ] Import succeeds
- [ ] Single wallet entry created with correct total

---

## Security & RLS Verification

### Test 17: User Ownership (RLS)

**Setup:**
- User A imports Tiger report
- User B logs in

**Expected:**
- User B cannot see User A's import_batches record
- User B cannot see User A's wallet_ledger entry
- RLS enforced correctly

**Verification Steps:**
- [ ] User A import succeeds
- [ ] User B logs in
- [ ] User B queries import_batches: No result for User A's import
- [ ] User B queries wallet_ledger: No result for User A's entry

---

## Summary: All Tests Passed?

- [ ] All UI integration tests passed
- [ ] All template validation tests passed
- [ ] All import process tests passed
- [ ] All business logic tests passed
- [ ] All edge case tests passed
- [ ] All security/RLS tests passed

---

## Known Limitations

1. **No Daily Breakdown:**
   - Tiger imports are monthly only
   - Cannot view daily spend breakdown
   - This is by design (awareness ≠ performance)

2. **Manual Entry Still Required for Non-Tiger Awareness:**
   - If awareness campaign NOT from Tiger, must use manual entry
   - Or implement separate import for other awareness platforms

3. **Currency Conversion:**
   - System stores whatever currency in file
   - No automatic conversion to THB
   - User must ensure consistency

---

## If Test Fails

**For Template Validation Failures:**
- Check `tiger-import-actions.ts` → `parseTigerReportFile()`
- Verify column detection logic
- Check commerce keywords list

**For Import Failures:**
- Check `tiger-import-actions.ts` → `importTigerReportToWallet()`
- Verify wallet_type check
- Check import_batch creation
- Check wallet_ledger insertion

**For Business Logic Failures:**
- Check P&L calculation in `daily-pl.ts`
- Ensure it queries ad_daily_performance ONLY
- Check Cashflow calculation in `cashflow.ts`
- Ensure it includes wallet_ledger SPEND entries

---

**Last Updated:** 2026-01-23
**Version:** 1.0 (Tiger Import Initial Release)
