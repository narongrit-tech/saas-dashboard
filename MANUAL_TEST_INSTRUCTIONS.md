# Manual Test Instructions - Ads Import Bug Fix

## 🎯 เป้าหมาย
ทดสอบว่า Ads Import รองรับ TikTok Thai headers และแสดง debug details เมื่อ parse fail

---

## 📋 Pre-requisites

1. ✅ Dev server running: `npm run dev`
2. ✅ Test files created:
   - `test-tiktok-ads-thai-headers.xlsx` (valid file)
   - `test-invalid-headers.xlsx` (invalid file)
3. ✅ Login credentials ready
4. ✅ ADS Wallet exists in system

---

## 🧪 Test Case 1: Valid TikTok Thai Headers (SUCCESS PATH)

### Goal
ทดสอบว่า parser รู้จัก TikTok Thai headers และ import สำเร็จ

### Steps

1. **Open browser** → `http://localhost:3000`

2. **Login** with test account

3. **Navigate** to Wallets page
   - Click "Wallets" in sidebar

4. **Select ADS Wallet**
   - Should see wallet cards
   - Select "TikTok Ads" wallet

5. **Open Import Dialog**
   - Click "Import Performance Ads" button
   - Dialog opens with 2 tabs: Product Ads / Live Ads

6. **Select Campaign Type**
   - Tab: "Product Ads (Daily)"

7. **Upload Test File**
   - Click file input or Upload button
   - Select: `test-tiktok-ads-thai-headers.xlsx`
   - Wait for parsing (should take < 2 seconds)

8. **Verify Preview Display**

   ✅ **Expected Preview Section:**
   ```
   Preview - กรุณาตรวจสอบข้อมูลก่อน Confirm

   ชื่อไฟล์: test-tiktok-ads-thai-headers.xlsx
   Campaign Type: Product (Daily)
   Report Date Range: 2026-01-20 to 2026-01-24
   จำนวนวัน: 5 วัน

   Total Spend: 24,200.00 THB (red, bold)
   Total GMV: 60,000.00 THB (green, bold)
   Total Orders: 215
   Avg ROAS: 2.48x (green, bold)
   ```

   ✅ **Expected Blue Info Box:**
   ```
   การ Import จะสร้าง:
   - 5 ad_daily_performance records (daily breakdown)
   - 5 wallet SPEND entries (one per day)
   - เข้า Accrual P&L (Advertising Cost)
   ```

   ✅ **Expected Detected Columns Section:**
   ```
   Columns ที่ตรวจพบ (Auto-detected):

   Date: วันเริ่มต้น (green checkmark)
   Campaign: ชื่อแคมเปญ (green checkmark)
   Cost/Spend: ต้นทุน (green checkmark)
   GMV: รายได้ขั้นต้น (green checkmark)
   Orders: ยอดการซื้อ (green checkmark)
   ROAS: ℹ️ Calculated

   Report Type (Auto-detected): product
   ```

9. **Click "Confirm Import"**
   - Loading state: "กำลัง Import..."
   - Wait for completion (should take < 5 seconds)

10. **Verify Success Message**
    ```
    ✅ Import สำเร็จ - 5 วัน, 5 records, ROAS: 2.48
    ```
    - Dialog auto-closes after 2.5 seconds

11. **Verify Data in UI**
    - Wallet page reloads
    - Check wallet balance updated (should decrease by 24,200 THB)

12. **Verify Database Records (Optional)**

    **Check import_batches:**
    ```sql
    SELECT * FROM import_batches
    WHERE report_type = 'tiktok_ads_product'
    ORDER BY created_at DESC
    LIMIT 1;
    ```
    Expected:
    - status = 'success'
    - row_count = 5
    - inserted_count = 5

    **Check ad_daily_performance:**
    ```sql
    SELECT ad_date, campaign_name, spend, revenue, orders, roi
    FROM ad_daily_performance
    WHERE marketplace = 'tiktok'
      AND campaign_type = 'product'
    ORDER BY ad_date DESC
    LIMIT 5;
    ```
    Expected: 5 records (2026-01-20 to 2026-01-24)

    **Check wallet_ledger:**
    ```sql
    SELECT date, entry_type, direction, amount, source, note
    FROM wallet_ledger
    WHERE wallet_id = (SELECT id FROM wallets WHERE wallet_type = 'ADS')
      AND source = 'IMPORTED'
    ORDER BY date DESC
    LIMIT 5;
    ```
    Expected:
    - 5 SPEND entries
    - direction = 'OUT'
    - amounts: 5000, 4500, 3200, 6000, 5500

### ✅ Pass Criteria
- Preview displays correct totals
- Detected columns show all 5 required fields (green)
- Import success message appears
- Dialog auto-closes
- Database records created

---

## 🧪 Test Case 2: Invalid Headers (DEBUG DISPLAY PATH)

### Goal
ทดสอบว่า debug details แสดงเมื่อ parser ไม่เจอ required columns

### Steps

1. **Reopen Import Dialog**
   - Navigate to Wallets → ADS Wallet
   - Click "Import Performance Ads"

2. **Upload Invalid File**
   - Select: `test-invalid-headers.xlsx`
   - Wait for parsing

3. **Verify Error Alert**

   ✅ **Expected Red Error Box:**
   ```
   ⚠️ ไม่พบ columns ที่จำเป็น: Date (วันที่), Campaign (แคมเปญ), Cost/Spend (ค่าใช้จ่าย)

   Columns ที่มีในไฟล์: Wrong Header 1, Wrong Header 2, Wrong Header 3, Wrong Header 4, Wrong Header 5
   ```

4. **Verify "Try Manual Mapping" Button**
   - Button should be visible on the right side
   - Text: "Try Manual Mapping" with wand icon

5. **Click "🔍 Debug Details" Collapsible**
   - Should see: "🔍 Debug Details (คลิกเพื่อดูรายละเอียด)"
   - Click to expand

6. **Verify Debug Details Display**

   ✅ **Expected Debug Section (Expanded):**
   ```
   Sheet ที่เลือก: Sheet1

   Headers ที่พบในไฟล์:
   [Scrollable white box with border]
   Wrong Header 1, Wrong Header 2, Wrong Header 3, Wrong Header 4, Wrong Header 5

   Mapping Result:
   • Date: ❌ Not found (RED)
   • Campaign: ❌ Not found (RED)
   • Cost/Spend: ❌ Not found (RED)
   • GMV: ⚠️ Not found (YELLOW)
   • Orders: ⚠️ Not found (YELLOW)
   • ROAS: ℹ️ Will calculate (GRAY)

   Missing Required:
   [Red text]
   Date (วันที่), Campaign (แคมเปญ), Cost/Spend (ค่าใช้จ่าย)
   ```

7. **Test Manual Mapping Fallback**
   - Click "Try Manual Mapping" button
   - Manual Mapping Wizard should open
   - (Don't complete the wizard - just verify it opens)

### ✅ Pass Criteria
- Error message displays clearly
- "Try Manual Mapping" button visible
- Debug details collapsible works
- Debug section shows:
  - Selected sheet name
  - All headers found in file
  - Mapping result with color codes (red/yellow/gray)
  - Missing required fields list
- Manual mapping wizard opens on click

---

## 🧪 Test Case 3: Regression Test (ENGLISH HEADERS)

### Goal
ทดสอบว่า English headers ยังทำงานได้ (backward compatibility)

### Steps

1. **Create English test file (manual or use script):**
   ```javascript
   const data = [
     { Date: '2026-01-20', Campaign: 'Test', Cost: 1000, Revenue: 2500, Orders: 10 }
   ]
   // Save as test-english-headers.xlsx
   ```

2. **Upload English file**
   - Same flow as Test Case 1
   - Upload: `test-english-headers.xlsx`

3. **Verify Preview Success**
   - Should see preview with correct data
   - Detected columns:
     - Date: Date ✅
     - Campaign: Campaign ✅
     - Cost: Cost ✅
     - GMV: Revenue ✅
     - Orders: Orders ✅

4. **Import should succeed**

### ✅ Pass Criteria
- English headers still recognized
- Preview displays correctly
- Import succeeds

---

## 🛑 Blocking Issues (Stop Testing)

If any of these occur, STOP and report:

1. **Parser crashes** (white screen, console error)
2. **Import creates duplicate records** (check database)
3. **Business rules violated**:
   - Can create manual SPEND entries for ADS Wallet (should be blocked)
   - Imported entries can be edited/deleted (should be blocked)
4. **Timezone wrong** (dates shifted by 1 day)
5. **Tiger Import affected** (awareness ads should use different workflow)

---

## 📸 Screenshots Needed

Capture screenshots for:

1. ✅ **Test Case 1 - Preview Success**
   - Full preview section with detected columns

2. ✅ **Test Case 1 - Success Message**
   - Green success alert

3. ✅ **Test Case 2 - Error with Debug Collapsed**
   - Red error box with "Try Manual Mapping" button

4. ✅ **Test Case 2 - Debug Expanded**
   - Full debug details section with color-coded mapping

5. ⚠️ **Any unexpected errors or bugs**

---

## ✅ Sign-off Checklist

After completing all test cases:

- [ ] Test Case 1: Valid TikTok Thai Headers → SUCCESS
- [ ] Test Case 2: Invalid Headers → DEBUG DISPLAY CORRECT
- [ ] Test Case 3: English Headers → STILL WORKS
- [ ] No blocking issues encountered
- [ ] Screenshots captured
- [ ] Database records verified (optional but recommended)

---

## 🚀 Ready for Commit

Once all tests pass:

1. Clean up test files (optional):
   ```bash
   rm test-*.xlsx
   rm test-parser-synonyms.js
   rm create-*.js
   ```

2. Stage changes:
   ```bash
   git add frontend/src/lib/parsers/tiktok-ads-parser.ts
   git add frontend/src/app/(dashboard)/wallets/performance-ads-import-actions.ts
   git add frontend/src/components/wallets/PerformanceAdsImportDialog.tsx
   ```

3. Commit with message from `ADS_IMPORT_BUG_FIX_VERIFICATION.md`

4. Push to remote:
   ```bash
   git push origin main
   ```

---

## 📞 Contact

If issues found:
- Check console for errors
- Check Supabase logs
- Review `ADS_IMPORT_BUG_FIX_VERIFICATION.md` for technical details
