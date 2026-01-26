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
