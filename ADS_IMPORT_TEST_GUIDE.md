# TikTok Ads Import - Test Guide

## เป้าหมายของ Fix นี้

แก้ไข TikTok Ads Import ให้รองรับ:
1. ไฟล์ภาษาไทยจาก Ads Manager จริง
2. Semantic column mapping (ยืดหยุ่น ไม่ fix column name)
3. Auto-detect report type (Product/Live)
4. Preview ละเอียดก่อน import (แสดง detected columns, warnings)
5. Warn แต่ไม่ fail ถ้าขาด optional metrics (GMV, Orders)

---

## การเปลี่ยนแปลงหลัก

### 1. Parser ใหม่: Semantic Column Mapping

**ไฟล์:** `frontend/src/lib/parsers/tiktok-ads-parser.ts`

**Features:**
- รองรับ column names หลายภาษา (Thai, English, Vietnamese, Chinese, etc.)
- Smart sheet selection: เลือก sheet ที่มี numeric columns มากสุด
- Flexible validation: warn แต่ไม่ fail ถ้าขาด GMV/Orders
- Auto-detect report type: Product vs Live (จาก campaign names)

**Column Mapping:**
```
Date → วันที่, date, 日期, tarih, fecha
Campaign → แคมเปญ, campaign, kampanya, campaña, 活动
Cost/Spend → ค่าใช้จ่าย, ต้นทุน, cost, spend, 费用
GMV → รายได้, gmv, revenue, conversion value
Orders → คำสั่งซื้อ, order, conversion, purchase
ROAS → roas, roi, ผลตอบแทน
```

### 2. Updated Server Actions

**ไฟล์:** `frontend/src/app/(dashboard)/wallets/performance-ads-import-actions.ts`

- ใช้ parser ใหม่แทน hard-coded column detection
- Return warnings พร้อม preview
- Backward compatible กับ UI เดิม

### 3. Enhanced UI

**ไฟล์:** `frontend/src/components/wallets/PerformanceAdsImportDialog.tsx`

**เพิ่ม:**
- Warnings alert (แสดง warnings จาก parser)
- Detected columns display (ให้ user เห็นว่าระบบเลือก column ไหน)
- Report type auto-detection display

---

## Test Scenarios

### Test Case 1: ไฟล์ภาษาไทย (TikTok Ads Manager จริง)

**Mock File Structure (Excel):**
```
| วันที่       | แคมเปญ              | ค่าใช้จ่าย | รายได้   | คำสั่งซื้อ |
|-------------|---------------------|----------|----------|-----------|
| 2026-01-20  | Product A Campaign  | 5000     | 15000    | 50        |
| 2026-01-21  | Product A Campaign  | 4800     | 14400    | 48        |
```

**Expected:**
- ✅ Parse สำเร็จ
- ✅ Detected columns แสดง: "วันที่", "แคมเปญ", "ค่าใช้จ่าย", "รายได้", "คำสั่งซื้อ"
- ✅ ROAS คำนวณจาก GMV/Cost
- ✅ Report type: Product (ถ้า campaign ไม่มี "live")

### Test Case 2: ไฟล์ภาษาอังกฤษ (เดิม)

**Mock File Structure:**
```
| Date       | Campaign Name       | Cost  | GMV    | Orders |
|-----------|---------------------|-------|--------|--------|
| 2026-01-20 | Live Jan Campaign   | 8000  | 24000  | 100    |
| 2026-01-21 | Live Jan Campaign   | 7500  | 22500  | 95     |
```

**Expected:**
- ✅ Parse สำเร็จ
- ✅ Detected columns: "Date", "Campaign Name", "Cost", "GMV", "Orders"
- ✅ Report type: Live (auto-detect จาก "Live" ใน campaign name)

### Test Case 3: Mixed Language (Thai + English)

**Mock File Structure:**
```
| วันที่       | Campaign            | Spend | Revenue | Orders |
|-------------|---------------------|-------|---------|--------|
| 20/01/2026  | Product Campaign TH | 3000  | 9000    | 30     |
```

**Expected:**
- ✅ Parse สำเร็จ
- ✅ Detected columns: "วันที่", "Campaign", "Spend", "Revenue", "Orders"
- ✅ Date format auto-detect: DD/MM/YYYY

### Test Case 4: Missing Optional Columns (GMV, Orders)

**Mock File Structure:**
```
| วันที่       | แคมเปญ              | ค่าใช้จ่าย |
|-------------|---------------------|----------|
| 2026-01-20  | Awareness Campaign  | 10000    |
```

**Expected:**
- ✅ Parse สำเร็จ (ไม่ fail)
- ⚠️ Warnings:
  - "ไม่พบ GMV/Revenue - จะใช้ค่า 0"
  - "ไม่พบ Orders - จะใช้ค่า 0"
  - "ไฟล์นี้ไม่มี sales metrics - ควรใช้ Tiger Import แทน"
- ✅ Preview แสดง Total GMV = 0, Total Orders = 0

### Test Case 5: Multi-sheet Excel (ซ่อนข้อมูลใน sheet อื่น)

**Mock File Structure:**
```
Sheet1: Overview (empty)
Sheet2: Campaign Data (มีข้อมูล)
Sheet3: Settings (meta)
```

**Expected:**
- ✅ Parse สำเร็จ
- ✅ เลือก Sheet2 อัตโนมัติ (มี numeric columns มากสุด)
- ℹ️ Sheet selection logic: เลือก sheet ที่มี numeric data มากที่สุด

### Test Case 6: Invalid File (ไม่มี required columns)

**Mock File Structure:**
```
| Name    | Value |
|---------|-------|
| Test    | 123   |
```

**Expected:**
- ❌ Parse ล้มเหลว
- ❌ Error: "ไม่พบ columns ที่จำเป็น: Date, Campaign, Cost"
- ℹ️ แสดง columns ที่มีในไฟล์: "Name, Value"

---

## Manual Test Steps

### Setup:
1. Build frontend:
   ```bash
   cd frontend
   npm run build
   npm run dev
   ```

2. เข้าหน้า Wallets: `http://localhost:3000/wallets`

3. เลือก ADS Wallet → คลิก "Import" button

### Test Steps:

#### Step 1: ทดสอบภาษาไทย
1. สร้างไฟล์ Excel ตาม Test Case 1 (column เป็นภาษาไทย)
2. Upload ใน Performance Ads Import Dialog
3. เลือก Campaign Type: Product
4. ตรวจสอบ Preview:
   - ✅ Total Spend ถูกต้อง
   - ✅ ROAS คำนวณถูก
   - ✅ Detected Columns แสดงชื่อภาษาไทย
5. Confirm Import
6. ตรวจสอบ Wallet Ledger: มี SPEND entries ตามวัน
7. ตรวจสอบ ad_daily_performance table (ใน Supabase)

#### Step 2: ทดสอบ Warning (ขาด GMV/Orders)
1. สร้างไฟล์ตาม Test Case 4 (มีแค่ Date, Campaign, Cost)
2. Upload
3. ตรวจสอบ:
   - ⚠️ Warnings alert แสดงสีเหลือง
   - ⚠️ ข้อความ: "ไม่พบ GMV/Revenue", "ควรใช้ Tiger Import แทน"
   - ✅ ยังสามารถ Confirm Import ได้ (ไม่ block)
   - ✅ Preview แสดง GMV = 0, Orders = 0

#### Step 3: ทดสอบ Auto-detect Report Type
1. สร้างไฟล์ที่ campaign name มี "Live" หรือ "Livestream"
2. Upload
3. ตรวจสอบ:
   - ℹ️ Report Type (Auto-detected): Live
   - ✅ Import ได้ปกติ

#### Step 4: ทดสอบ Multi-sheet
1. สร้าง Excel 3 sheets (sheet1 ว่าง, sheet2 มีข้อมูล, sheet3 meta)
2. Upload
3. ตรวจสอบ:
   - ✅ Parse สำเร็จ (เลือก sheet2)
   - ✅ Preview แสดงข้อมูลจาก sheet2

#### Step 5: ทดสอบ Invalid File
1. สร้างไฟล์ที่ไม่มี Date, Campaign, Cost columns
2. Upload
3. ตรวจสอบ:
   - ❌ Error alert สีแดง
   - ❌ ข้อความ: "ไม่พบ columns ที่จำเป็น: ..."
   - ❌ Confirm Import button disabled
   - ✅ "Try Manual Mapping" button แสดง (fallback)

---

## Regression Tests

ตรวจสอบว่าการแก้ไขไม่พัง features เดิม:

### 1. Tiger Awareness Import (ต้องแยกออกจาก Performance)
- ✅ Tiger Import dialog ยังใช้งานได้
- ✅ Tiger files ไม่ควร import ผ่าน Performance Ads dialog
- ✅ Error message ชัด: "ถ้าเป็น Awareness Ads ให้ใช้ Tiger Import"

### 2. Manual Mapping Wizard
- ✅ ถ้า auto-parse ล้ม → แสดง "Try Manual Mapping" button
- ✅ Wizard ยังทำงานได้ปกติ
- ✅ Preset loading ยังทำงานได้

### 3. Business Rules
- ✅ ADS wallet: SPEND entries เป็น IMPORTED source
- ✅ File hash deduplication ทำงาน (ห้าม import ซ้ำ)
- ✅ Wallet ledger: daily aggregation ถูกต้อง
- ✅ ad_daily_performance: daily breakdown ถูกต้อง
- ✅ Timezone: Asia/Bangkok

---

## Success Criteria

- [x] รองรับไฟล์ภาษาไทย (column names)
- [x] รองรับไฟล์ mixed language
- [x] Auto-select best sheet
- [x] Warn แต่ไม่ fail ถ้าขาด GMV/Orders
- [x] Auto-detect report type (Product/Live)
- [x] แสดง detected columns ใน preview
- [x] แสดง warnings ใน UI
- [x] Business rules ไม่พัง (wallet, deduplication)
- [x] Backward compatible กับไฟล์เดิม
- [x] Manual mapping fallback ยังทำงานได้

---

## Rollback Plan

ถ้าพบ bug critical:

1. Revert commits:
   ```bash
   git revert HEAD~3..HEAD
   ```

2. Files to revert:
   - `frontend/src/lib/parsers/tiktok-ads-parser.ts` (ลบ)
   - `frontend/src/app/(dashboard)/wallets/performance-ads-import-actions.ts` (คืนค่า)
   - `frontend/src/components/wallets/PerformanceAdsImportDialog.tsx` (คืนค่า)

3. Re-test กับไฟล์เดิม

---

## คำแนะนำสำหรับ QA Team

1. **เตรียมไฟล์ทดสอบ:**
   - Export TikTok Ads จริงจาก Ads Manager (ภาษาไทย)
   - Export TikTok Ads จริงจาก Ads Manager (ภาษาอังกฤษ)
   - สร้าง mock files ตาม test cases ข้างบน

2. **ทดสอบแบบ Real-world:**
   - ใช้ไฟล์จริงจากลูกค้า (ถ้ามี)
   - ทดสอบ edge cases: date formats แปลก, currency symbols, large files

3. **ตรวจสอบ DB:**
   - ใช้ Supabase dashboard ตรวจสอบ:
     - `ad_daily_performance` table (daily breakdown ถูกไหม?)
     - `wallet_ledger` table (aggregation ถูกไหม?)
     - `import_batches` table (file_hash unique ไหม?)

4. **Performance Test:**
   - ทดสอบไฟล์ขนาดใหญ่ (500+ rows)
   - ตรวจสอบ import time (ควร < 5 วินาที)

---

## Known Limitations

1. **Auto-detect Report Type:**
   - อาศัย heuristic (campaign name มี "live" → Live type)
   - ถ้า detect ผิด → user เลือก campaign type ด้วยตนเอง (UI ยังมี tabs)

2. **Column Mapping:**
   - Token-based matching → อาจพลาดถ้า column name แปลกมาก
   - Fallback: Manual Mapping Wizard

3. **Sheet Selection:**
   - เลือก sheet ที่มี numeric columns มากสุด
   - ถ้าทุก sheet มี numeric columns เท่ากัน → เลือก sheet แรก

---

## Next Steps (Future Enhancements)

1. **Machine Learning Column Detection:**
   - ใช้ ML model detect column types จาก data patterns
   - รองรับ column names ที่แปลกมากๆ

2. **Report Type Training:**
   - ให้ user label report type → save เป็น preset
   - Auto-apply ถ้าเจอ filename/column pattern เดิม

3. **Multi-file Batch Import:**
   - Import หลายไฟล์พร้อมกัน (Product + Live)
   - Daily auto-import from email attachments

4. **Advanced Preview:**
   - Chart แสดง daily trend
   - Anomaly detection (spend spike, ROAS drop)

---

## Contact

หากพบปัญหา:
- Create GitHub Issue
- Tag: `bug`, `ads-import`, `parser`
- แนบ: ไฟล์ทดสอบ (ลบข้อมูลส่วนตัวก่อน), screenshot error

---
---

# PERFORMANCE FIX: Skip All-Zero Rows (2026-01-26)

## เป้าหมายของ Fix นี้

แก้ปัญหา Confirm ช้า (freeze UI) เมื่อ import ไฟล์ขนาดใหญ่ (100k+ rows) ที่มีแถว all-zero เยอะ

**Changes:**
1. Filter all-zero rows ก่อน insert (spend=0 AND orders=0 AND revenue=0)
2. Batch insert (<=1000 rows/batch) to avoid timeout
3. Preview แสดง counts ที่แม่นยำ (Total/Kept/Skipped)
4. UI Toggle สำหรับ skip all-zero (default: ON)
5. Business rules ไม่เปลี่ยน (ads spend, dedup, date logic ยังเหมือนเดิม)

---

## Test Scenarios - Performance Fix

### Test 1: Basic Filter (skipZeroRows=ON)

**Objective:** Verify all-zero rows are filtered correctly

**Steps:**
1. Upload file with mixed data (some zero rows, some non-zero)
2. Verify checkbox "ข้ามแถวที่เป็น 0 ทั้งหมด" is **checked** (default)
3. Click "ดู Preview"
4. **Expected Preview:**
   - แถวทั้งหมดในไฟล์ = 100 (example)
   - แถวที่จะนำเข้า = 60 (example, non-zero rows)
   - แถวที่ข้าม (all-zero) = 40
   - Totals (Spend/Orders/Revenue) calculated from 60 rows ONLY
   - Blue info box: "✓ กรองแถว all-zero แล้ว..."
5. Click "ยืนยันนำเข้า"
6. **Expected Result:**
   - Import completes successfully
   - Success message: "นำเข้าสำเร็จ 60 แถว"
7. Verify DB:
   ```sql
   SELECT COUNT(*) FROM ad_daily_performance WHERE import_batch_id = $batchId;
   -- Expected: 60 (not 100)
   ```

**Pass Criteria:**
- ✅ Preview counts correct (Total/Kept/Skipped)
- ✅ DB row count = Kept rows (not Total rows)
- ✅ All-zero rows NOT in DB

---

### Test 2: Toggle OFF (skipZeroRows=OFF)

**Objective:** Verify filter can be disabled

**Steps:**
1. Upload same file from Test 1
2. **Uncheck** checkbox "ข้ามแถวที่เป็น 0 ทั้งหมด"
3. Click "ดู Preview"
4. **Expected Preview:**
   - แถวทั้งหมดในไฟล์ = 100
   - แถวที่จะนำเข้า = 100
   - แถวที่ข้าม (all-zero) = 0
   - Totals include ALL rows (even zeros)
   - No blue info box (filter not applied)
5. Click "ยืนยันนำเข้า"
6. **Expected Result:**
   - Import completes successfully
   - Success message: "นำเข้าสำเร็จ 100 แถว"
7. Verify DB:
   ```sql
   SELECT COUNT(*) FROM ad_daily_performance WHERE import_batch_id = $batchId;
   -- Expected: 100 (all rows imported)
   ```

**Pass Criteria:**
- ✅ Toggle works (filter disabled)
- ✅ All rows imported (including all-zero)
- ✅ DB row count = Total rows

---

### Test 3: Large File Performance

**Objective:** Verify batch insert works (no timeout/freeze)

**Steps:**
1. Upload large file (100k+ rows, majority all-zero)
2. skipZeroRows = ON (default)
3. Click "ดู Preview"
4. **Expected Preview:**
   - แถวทั้งหมดในไฟล์ = 100000
   - แถวที่จะนำเข้า = ~5000 (example, depends on data)
   - แถวที่ข้าม (all-zero) = ~95000
   - Preview loads fast (< 5s)
5. Click "ยืนยันนำเข้า"
6. **Expected Result:**
   - Import completes in < 30s (was several minutes before)
   - No UI freeze/hang
   - Success message: "นำเข้าสำเร็จ 5000 แถว"
7. Check server logs:
   ```
   [CONFIRM] Parsed 100000 rows (kept: 5000, skipped: 95000)
   [CONFIRM] Step 5: Inserting ad performance rows... { rowCount: 5000 }
   [CONFIRM] Step 7: Import completed successfully
   ```

**Pass Criteria:**
- ✅ Import time < 30s (significant improvement)
- ✅ No UI freeze
- ✅ Logs show correct counts

---

### Test 4: Preview Totals = DB Totals

**Objective:** Verify accuracy (preview matches DB)

**Steps:**
1. Upload file, skipZeroRows = ON
2. Preview shows:
   - Total Spend = 50000.00
   - Total Revenue = 150000.00
   - Total Orders = 1000
3. Click "ยืนยันนำเข้า"
4. After import, query DB:
   ```sql
   SELECT
     SUM(spend) as total_spend,
     SUM(revenue) as total_revenue,
     SUM(orders) as total_orders
   FROM ad_daily_performance
   WHERE import_batch_id = $batchId;
   ```
5. **Expected:**
   - total_spend = 50000.00
   - total_revenue = 150000.00
   - total_orders = 1000

**Pass Criteria:**
- ✅ All 3 totals match exactly (< 0.01 difference)
- ✅ No rounding errors

---

### Test 5: Wallet Spend = Preview Spend

**Objective:** Verify wallet entries match preview

**Steps:**
1. Upload file, skipZeroRows = ON
2. Preview shows: Total Spend = 50000.00
3. Click "ยืนยันนำเข้า"
4. After import, query wallet:
   ```sql
   SELECT SUM(amount)
   FROM wallet_ledger
   WHERE import_batch_id = $batchId
   AND entry_type = 'SPEND';
   ```
5. **Expected:** Result = 50000.00

**Pass Criteria:**
- ✅ Wallet spend matches preview exactly
- ✅ Daily aggregation correct (one entry per day)

---

### Test 6: Deduplication Still Works

**Objective:** Verify file hash check still blocks duplicates

**Steps:**
1. Import file A, skipZeroRows = ON → **Success**
2. Import file A again, skipZeroRows = ON → **DUPLICATE_IMPORT error**
3. Import file A again, skipZeroRows = OFF → **DUPLICATE_IMPORT error**

**Expected:**
- 2nd import: Error "นำเข้าซ้ำ" with original timestamp
- 3rd import: Same error (skipZeroRows state doesn't affect dedup)

**Pass Criteria:**
- ✅ 2nd import blocked
- ✅ 3rd import blocked (toggle state irrelevant for dedup)
- ✅ Error message clear

---

### Test 7: Mixed Data Edge Cases

**Objective:** Verify filter logic edge cases

**Test Data:**
| Row | Spend | Orders | Revenue | Expected |
|-----|-------|--------|---------|----------|
| A   | 0     | 10     | 500     | **KEEP** (has conversion) |
| B   | 100   | 0      | 0       | **KEEP** (has spend) |
| C   | 0     | 0      | 0       | **SKIP** (all-zero) |
| D   | null  | null   | null    | **SKIP** (treat null as 0) |

**Steps:**
1. Create file with these 4 rows
2. Upload, skipZeroRows = ON
3. Click "ดู Preview"
4. **Expected:**
   - แถวทั้งหมดในไฟล์ = 4
   - แถวที่จะนำเข้า = 2 (A + B)
   - แถวที่ข้าม (all-zero) = 2 (C + D)

**Pass Criteria:**
- ✅ Only rows A and B imported
- ✅ Rows C and D skipped

---

## Success Criteria Summary - Performance Fix

### Performance
- ✅ Import time < 30s for realistic file (5k kept rows)
- ✅ No UI freeze/hang during import
- ✅ Preview loads fast (< 5s)

### Accuracy
- ✅ Preview totals = DB totals (100% match)
- ✅ Wallet spend = Preview totalSpend (100% match)
- ✅ Filter logic correct (all edge cases pass)

### UX
- ✅ Toggle visible and functional
- ✅ Counts displayed clearly (Total/Kept/Skipped)
- ✅ Blue info box when filter applied
- ✅ Error messages clear and actionable

### Business Rules
- ✅ Ads spend = sum of kept rows
- ✅ Dedup still works (file_hash check)
- ✅ Wallet entries correct (daily aggregated)
- ✅ Date logic unchanged (reportDate fallback)

---

## Known Issues - Performance Fix

1. **Batch Size:** Fixed at 1000 rows/batch (not configurable via UI)
2. **Rollback:** Partial data kept on failure (manual cleanup required)
3. **Progress Bar:** No chunk-by-chunk progress indicator (shows "กำลังนำเข้า..." only)
4. **Memory:** Very large files (1M+ rows) may still cause memory issues (even after filtering)

---
---

# Cleanup & Rollback

## เป้าหมาย

ระบบ DELETE RLS policies มีอยู่แล้วใน database สำหรับ 3 ตาราง:
- `ad_daily_performance` (ads data)
- `wallet_ledger` (wallet entries)
- `import_batches` (import tracking)

คู่มือนี้แนะนำวิธีการ **cleanup ข้อมูลที่ import ผิดพลาดหรือต้องการทดสอบใหม่**

---

## ⚠️ สำคัญ: RLS Policies มีอยู่แล้ว

**DELETE policies ถูกสร้างตั้งแต่:**
- `migration-003-ad-daily-performance.sql` → line 111-115
- `migration-005-wallets.sql` → line 174-178
- `migration-001-import-batches.sql` → line 98-103

**ดังนั้น:**
- ✅ ไม่ต้องรัน migration ใหม่
- ✅ DELETE operations ใช้งานได้ทันที (สำหรับ authenticated users)
- ✅ RLS enforcement: ลบได้เฉพาะ rows ของตัวเอง (`created_by = auth.uid()`)

---

## วิธีที่ 1: Safe Rollback by import_batch_id (แนะนำ)

ใช้ `import_batch_id` เพื่อลบข้อมูลจาก import ครั้งใดครั้งหนึ่งอย่างปลอดภัย

### ขั้นตอน:

**1. หา batch_id จาก import ล่าสุด**

```sql
-- In Supabase SQL Editor (authenticated as user)
SELECT
  id as batch_id,
  report_type,
  row_count,
  file_name,
  metadata->>'reportDate' as report_date,
  created_at
FROM import_batches
WHERE created_by = auth.uid()
  AND report_type LIKE 'tiktok_ads%'
ORDER BY created_at DESC
LIMIT 5;
```

**Expected:**
- เห็น list import ล่าสุด 5 ครั้ง
- Copy `batch_id` (UUID) ของ import ที่ต้องการลบ

**2. ตรวจสอบว่ามีข้อมูลอะไรบ้างก่อนลบ (DRY RUN)**

```sql
-- Replace <batch_id> with actual UUID
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

**Expected:**
- แสดงจำนวน rows ที่จะถูกลบในแต่ละตาราง
- ตัวอย่าง:
  ```
  ad_daily_performance | 150
  wallet_ledger        | 10
  import_batches       | 1
  ```

**3. Execute Rollback (ลบข้อมูล - 3 คำสั่ง)**

```sql
-- ⚠️ CAUTION: This will permanently delete data!
-- Replace <batch_id> with actual UUID

-- Step 1: Delete wallet_ledger entries
DELETE FROM wallet_ledger
WHERE import_batch_id = '<batch_id>'
  AND created_by = auth.uid();

-- Step 2: Delete ad_daily_performance rows
DELETE FROM ad_daily_performance
WHERE import_batch_id = '<batch_id>'
  AND created_by = auth.uid();

-- Step 3: Delete import_batch
DELETE FROM import_batches
WHERE id = '<batch_id>'
  AND created_by = auth.uid();
```

**Expected:**
- แต่ละคำสั่ง return row count > 0
- ไม่มี silent failures (ถ้า return 0 → มี RLS issue)

**4. Verify Cleanup (ตรวจสอบว่าลบหมดแล้ว)**

```sql
-- Replace <batch_id> with actual UUID
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

**Expected:**
- ทั้ง 3 ตารางต้อง return `0` rows
- ถ้าไม่เป็น 0 → มี RLS enforcement issues หรือ constraint issues

**5. Re-import (ถ้าต้องการ)**

หลังจาก cleanup เรียบร้อย:
1. กลับไปหน้า `/wallets` → ADS Wallet → Import
2. Upload ไฟล์เดิมอีกครั้ง
3. Verify totals ใน preview ตรงกับที่คาดหวัง
4. Confirm import
5. ตรวจสอบที่หน้า `/ads` ว่าข้อมูลถูกต้อง

---

## วิธีที่ 2: Cleanup by ad_date (ความเสี่ยงสูงกว่า)

⚠️ **WARNING:** วิธีนี้จะลบ ALL imports สำหรับวันที่นั้น (ไม่ใช่แค่ 1 batch)

ใช้เมื่อ:
- ต้องการลบข้อมูลทั้งหมดสำหรับวันที่นั้น
- Import ผิดพลาดหลายครั้งในวันเดียวกัน

### ขั้นตอน:

**1. ตรวจสอบข้อมูลก่อนลบ**

```sql
-- Replace '2026-01-16' with actual date
SELECT COUNT(*) as ads_count
FROM ad_daily_performance
WHERE ad_date = '2026-01-16'
  AND created_by = auth.uid();

SELECT COUNT(*) as wallet_count
FROM wallet_ledger
WHERE date = '2026-01-16'
  AND source = 'IMPORTED'
  AND created_by = auth.uid();
```

**Expected:**
- แสดงจำนวน rows ที่จะถูกลบ
- **คำเตือน:** อาจมีข้อมูลจาก multiple imports ในวันเดียวกัน

**2. Execute Cleanup (ถ้ายืนยัน)**

```sql
-- ⚠️ CAUTION: Deletes ALL imports for this date!
-- Replace '2026-01-16' with actual date

-- Delete ad_daily_performance
DELETE FROM ad_daily_performance
WHERE ad_date = '2026-01-16'
  AND created_by = auth.uid();

-- Delete wallet_ledger
DELETE FROM wallet_ledger
WHERE date = '2026-01-16'
  AND source = 'IMPORTED'
  AND created_by = auth.uid();

-- Note: import_batches remain (they may reference multiple dates)
```

**3. Verify Cleanup**

```sql
-- Replace '2026-01-16' with actual date
SELECT COUNT(*) as remaining_rows
FROM ad_daily_performance
WHERE ad_date = '2026-01-16';
```

**Expected:** 0 rows

---

## วิธีที่ 3: Delete Specific Rows (Manual)

ใช้เมื่อต้องการลบเฉพาะ rows บางอัน (edge cases)

### ตัวอย่าง: ลบ campaign เฉพาะ

```sql
-- Delete specific campaign
DELETE FROM ad_daily_performance
WHERE campaign_name = 'Test Campaign'
  AND created_by = auth.uid();
```

### ตัวอย่าง: ลบ date range

```sql
-- Delete date range (e.g., Jan 16-20)
DELETE FROM ad_daily_performance
WHERE ad_date BETWEEN '2026-01-16' AND '2026-01-20'
  AND created_by = auth.uid();
```

---

## Troubleshooting

### ปัญหา: DELETE returns 0 rows (silent failure)

**Causes:**
1. **RLS blocking delete** (most common):
   - Verify policies exist: `SELECT * FROM pg_policies WHERE tablename = 'ad_daily_performance' AND cmd = 'DELETE';`
   - Check user authenticated: `SELECT auth.uid();` (should return UUID, not null)

2. **No rows match WHERE clause**:
   - Verify rows exist: `SELECT COUNT(*) FROM ad_daily_performance WHERE import_batch_id = '<batch_id>';`
   - Check `created_by`: `SELECT created_by FROM ad_daily_performance WHERE import_batch_id = '<batch_id>' LIMIT 1;`

3. **Foreign key constraints blocking delete**:
   - Check constraints: `\d+ ad_daily_performance` (in psql)
   - Note: `wallet_ledger` references `import_batches` → must delete `wallet_ledger` first

**Fix:**
- Run verification script: `database-scripts/verify-ads-delete-policy.sql`
- Check section 5 (RLS enforcement test)

### ปัญหา: "update or delete on table violates foreign key constraint"

**Cause:**
- Trying to delete `import_batches` before deleting `ad_daily_performance` and `wallet_ledger`

**Fix:**
- DELETE in correct order (see "Safe Rollback" above):
  1. `wallet_ledger` (child)
  2. `ad_daily_performance` (child)
  3. `import_batches` (parent)

### ปัญหา: ลบข้อมูลผิด batch

**Prevention:**
- Always verify `batch_id` ก่อนลบ:
  ```sql
  SELECT file_name, report_type, created_at
  FROM import_batches
  WHERE id = '<batch_id>';
  ```
- Use DRY RUN (SELECT COUNT) ก่อน DELETE เสมอ

**Recovery:**
- ถ้าลบผิด → ต้อง re-import ไฟล์เดิม (ไม่มี undo)

---

## Testing DELETE Policies

ใช้ verification script เพื่อทดสอบว่า DELETE policies ทำงานถูกต้อง:

**File:** `database-scripts/verify-ads-delete-policy.sql`

**Run in Supabase SQL Editor:**
1. Section 1: Check policies exist (expect 3 rows)
2. Section 2a: Find test batch_id (copy UUID)
3. Section 2b-2d: Test visibility (SELECT should see rows)
4. Section 3: Safe rollback template (uncomment and run)
5. Section 4: Verify cleanup (expect 0 rows)
6. Section 5: Security test (cross-user deletes blocked)

**Expected Results:**
- ✅ All policies exist
- ✅ SELECT returns rows (no RLS block for SELECT)
- ✅ DELETE returns row count > 0 (not silent failure)
- ✅ Cross-user DELETE blocked (RLS enforcement)

---

## Best Practices

1. **Always use import_batch_id** (safest, most precise)
2. **DRY RUN first** (SELECT COUNT before DELETE)
3. **Verify cleanup** (SELECT COUNT after DELETE → expect 0)
4. **Test with small batch** (1-2 rows) before large cleanup
5. **Document cleanup** (note which batch_id and why)
6. **Backup before bulk delete** (if production data)

---

## Scripts Reference

### Quick Cleanup Script Template

```sql
-- ============================================
-- Quick Rollback Template
-- Replace <batch_id> with actual UUID
-- ============================================

-- Step 1: Verify (DRY RUN)
SELECT 'ad_daily_performance' as table_name, COUNT(*) as row_count
FROM ad_daily_performance WHERE import_batch_id = '<batch_id>' AND created_by = auth.uid()
UNION ALL
SELECT 'wallet_ledger', COUNT(*) FROM wallet_ledger WHERE import_batch_id = '<batch_id>' AND created_by = auth.uid()
UNION ALL
SELECT 'import_batches', COUNT(*) FROM import_batches WHERE id = '<batch_id>' AND created_by = auth.uid();

-- Step 2: Execute (uncomment after verification)
/*
DELETE FROM wallet_ledger WHERE import_batch_id = '<batch_id>' AND created_by = auth.uid();
DELETE FROM ad_daily_performance WHERE import_batch_id = '<batch_id>' AND created_by = auth.uid();
DELETE FROM import_batches WHERE id = '<batch_id>' AND created_by = auth.uid();
*/

-- Step 3: Verify Cleanup
SELECT 'ad_daily_performance' as table_name, COUNT(*) as remaining_rows
FROM ad_daily_performance WHERE import_batch_id = '<batch_id>'
UNION ALL
SELECT 'wallet_ledger', COUNT(*) FROM wallet_ledger WHERE import_batch_id = '<batch_id>'
UNION ALL
SELECT 'import_batches', COUNT(*) FROM import_batches WHERE id = '<batch_id>';
```

---

## Success Criteria

- ✅ DELETE policies exist for 3 tables
- ✅ DELETE operations return row count (not 0)
- ✅ Rollback by import_batch_id works
- ✅ Cleanup verification passes (0 rows remaining)
- ✅ RLS enforcement tested (cross-user deletes blocked)
- ✅ Re-import after cleanup works
