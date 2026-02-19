# Ads Date Fix - Manual Test Guide

## สรุปการแก้ไข

### ไฟล์ที่แก้
1. **frontend/src/app/(dashboard)/ads/actions.ts**
   - แก้ `getAdsSummary()`: เปลี่ยนจาก `toISOString().split('T')[0]` เป็น `format(date, 'yyyy-MM-dd')`
   - แก้ `getAdsPerformance()`: เปลี่ยนจาก `toISOString().split('T')[0]` เป็น `format(date, 'yyyy-MM-dd')`
   - เพิ่ม import: `import { format } from 'date-fns';`

2. **frontend/src/app/(dashboard)/ads/page.tsx**
   - เปลี่ยนจาก `DateRangeFilter` เป็น `SingleDateRangePicker` (consistent with Phase 7)
   - แก้ import และ type
   - แก้ console.log ให้ใช้ `format()` แทน `toISOString()`
   - เพิ่ม presets ภาษาไทย: วันนี้, 7 วันล่าสุด, 30 วันล่าสุด

## Root Cause ที่แก้ไปแล้ว

### ปัญหา 1: Timezone Drift (UTC Conversion)
**Before:**
```typescript
const startDateStr = startDate.toISOString().split('T')[0];
// ถ้า startDate = 2026-01-18 00:00:00 Bangkok (UTC+7)
// toISOString() จะแปลงเป็น 2026-01-17T17:00:00.000Z
// split('T')[0] ได้ "2026-01-17" ❌ ผิดวัน!
```

**After:**
```typescript
const startDateStr = format(startDate, 'yyyy-MM-dd');
// format() ใช้ local date โดยตรง ไม่แปลง UTC
// ได้ "2026-01-18" ✅ ถูกต้อง!
```

### ปัญหา 2: Summary และ Performance ใช้ Date Range ไม่เหมือนกัน
**Fixed:** ตอนนี้ทั้ง `getAdsSummary()` และ `getAdsPerformance()` ใช้ `format()` เหมือนกัน → date range consistent

### ปัญหา 3: Date Picker ไม่เหมือนหน้าอื่น
**Fixed:** เปลี่ยนเป็น `SingleDateRangePicker` (เดียวกับ sales/expenses/finance/marketplace-wallets)

---

## Manual Test Steps

### Prerequisite
ต้องมี ads data ใน database อย่างน้อย 2-3 วันเพื่อทดสอบ (เช่น วันที่ 16, 17 มกราคม 2026)

### Test Case 1: เลือกวันเดียว (Single Day) - วันที่ 16/01/2026
**Steps:**
1. เปิดหน้า `/ads`
2. คลิกที่ date picker → เลือก 16 มกราคม 2026 ถึง 16 มกราคม 2026 (วันเดียว)
3. ดูค่า Summary Cards:
   - Total Spend
   - Total Revenue
   - Total Orders
   - Blended ROI
4. ดูตาราง Performance → count จำนวน rows

**Expected (ตาม user):**
- Summary rows count = 13
- Total Spend = ฿80.83
- Total Revenue = ฿5,497.80
- Total Orders = 24
- ตารางแสดง **เฉพาะวันที่ 16 เท่านั้น** (13 rows)
- ไม่มีข้อมูลวันที่ 15 หรือ 17 ปนมา

**How to Verify:**
- เปิด browser console → ดู log `[ADS_SUMMARY] Query params:` และ `[ADS_PERFORMANCE] Query params:`
- ต้องเห็น `startDate: "2026-01-16", endDate: "2026-01-16"` ✅
- ห้ามเห็น `startDate: "2026-01-15"` ❌

---

### Test Case 2: เลือกวันเดียว (Single Day) - วันที่ 17/01/2026
**Steps:**
1. คลิกที่ date picker → เลือก 17 มกราคม 2026 ถึง 17 มกราคม 2026
2. ดูค่า Summary Cards และตาราง

**Expected (ตาม user):**
- Total Spend = ฿634.43
- Total Revenue = ฿7,348.23
- Total Orders = 36
- ตารางแสดง **เฉพาะวันที่ 17 เท่านั้น**

**How to Verify:**
- Console log ต้องเห็น `startDate: "2026-01-17", endDate: "2026-01-17"` ✅

---

### Test Case 3: เลือกช่วงวัน (Date Range) - 16-17 มกราคม 2026
**Steps:**
1. คลิกที่ date picker → เลือก 16 มกราคม 2026 ถึง 17 มกราคม 2026
2. ดูค่า Summary Cards และ row count

**Expected (ตาม user):**
- Total Spend = ฿715.26 (80.83 + 634.43)
- Total Revenue = ฿12,846.03 (5497.80 + 7348.23)
- Total Orders = 60 (24 + 36)
- ตารางรวม **100 rows** (13 rows วันที่ 16 + 87 rows วันที่ 17)

**How to Verify:**
- Console log ต้องเห็น `startDate: "2026-01-16", endDate: "2026-01-17"` ✅
- Summary totals ต้องเท่ากับผลรวมของ Test Case 1 + Test Case 2

---

### Test Case 4: เลือกวันที่ไม่มีข้อมูล (Empty Data) - วันที่ 18/01/2026
**Steps:**
1. คลิกที่ date picker → เลือก 18 มกราคม 2026 (สมมติว่าไม่มี import วันนี้)
2. ดูค่า Summary Cards และตาราง

**Expected (ตาม user):**
- Total Spend = ฿0.00
- Total Revenue = ฿0.00
- Total Orders = 0
- Blended ROI = 0.00x
- ตาราง**ว่างเปล่า** (แสดงข้อความ "ไม่พบข้อมูลโฆษณาในช่วงเวลาที่เลือก")

**Critical Check:**
- **ห้ามแสดงข้อมูลวันที่ 17** ❌ (ห้ามมี fallback ไปวันก่อน)
- Console log ต้องเห็น `startDate: "2026-01-18", endDate: "2026-01-18"` ✅

---

### Test Case 5: UI/UX Consistency with Other Pages
**Steps:**
1. เปิดหน้า `/sales` → ดู date picker UI
2. เปิดหน้า `/expenses` → ดู date picker UI
3. เปิดหน้า `/ads` → ดู date picker UI

**Expected:**
- Date picker ใน `/ads` ต้องมีหน้าตาและการทำงานเหมือนหน้าอื่นทุกประการ:
  - ✅ มี preset buttons: วันนี้, 7 วันล่าสุด, 30 วันล่าสุด
  - ✅ มี main picker button แสดง "DD MMM YYYY – DD MMM YYYY"
  - ✅ คลิกแล้วเปิด calendar 2 เดือน (range mode)
  - ✅ เลือกวันเดียวได้ (startDate = endDate)
  - ✅ ไม่ต้อง "apply" แยก (auto-apply)

---

## SQL Verification Query

หากต้องการตรวจสอบข้อมูลจริงใน database ก่อน test:

```sql
-- ดูจำนวน rows ต่อวัน
SELECT
  ad_date,
  COUNT(*) as row_count,
  SUM(spend) as total_spend,
  SUM(revenue) as total_revenue,
  SUM(orders) as total_orders
FROM ad_daily_performance
WHERE ad_date BETWEEN '2026-01-16' AND '2026-01-17'
GROUP BY ad_date
ORDER BY ad_date;

-- ตรวจสอบวันที่ 16 ตรงกับ expected หรือไม่
SELECT
  COUNT(*) as expected_13_rows,
  SUM(spend) as expected_80_83,
  SUM(revenue) as expected_5497_80,
  SUM(orders) as expected_24
FROM ad_daily_performance
WHERE ad_date = '2026-01-16';

-- ตรวจสอบวันที่ 17 ตรงกับ expected หรือไม่
SELECT
  COUNT(*) as expected_87_rows,
  SUM(spend) as expected_634_43,
  SUM(revenue) as expected_7348_23,
  SUM(orders) as expected_36
FROM ad_daily_performance
WHERE ad_date = '2026-01-17';
```

---

## Regression Test: ตรวจสอบหน้าอื่นไม่เสีย

### Pages to Check:
- `/sales` - date range filter ต้องยังใช้งานได้ปกติ
- `/expenses` - date range filter ต้องยังใช้งานได้ปกติ
- `/finance/marketplace-wallets` - date range filter ต้องยังใช้งานได้ปกติ
- `/company-cashflow` - date range filter ต้องยังใช้งานได้ปกติ
- `/reconciliation` - date range filter ต้องยังใช้งานได้ปกติ

**Expected:** ไม่มีหน้าใดเสีย เพราะแก้เฉพาะหน้า `/ads` เท่านั้น

---

## Technical Details

### Query Logic (Inclusive Range)
```typescript
// Both getAdsSummary and getAdsPerformance use:
.gte('ad_date', startDateStr)  // >= startDate (inclusive)
.lte('ad_date', endDateStr)    // <= endDate (inclusive)
```

### Date Format Examples
| Input (Date picker)      | format() Output | Query Result        |
|--------------------------|-----------------|---------------------|
| 16/01/2026 – 16/01/2026  | 2026-01-16      | ad_date = 2026-01-16 only |
| 16/01/2026 – 17/01/2026  | 2026-01-16, 2026-01-17 | ad_date IN (16, 17) |
| 18/01/2026 – 18/01/2026  | 2026-01-18      | ad_date = 2026-01-18 (may be empty) |

---

## Known Limitations

1. **Date picker default**: ตอนนี้ default เป็น "Last 7 Days" (เหมือนหน้าอื่น)
   - ถ้าต้องการเปลี่ยนเป็น "30 วันล่าสุด" → ไปแก้ใน `page.tsx` preset order

2. **Timezone**: ใช้ local browser timezone (อาจไม่ใช่ Bangkok timezone ถ้า user อยู่ต่างประเทศ)
   - แต่ตาม Phase 7 specification ทุกหน้าใช้ local timezone เหมือนกัน

---

## Rollback Plan (หากพบปัญหา)

```bash
git revert a0497dc
```

หรือแก้กลับด้วยมือ:
1. `actions.ts` → เปลี่ยน `format(date, 'yyyy-MM-dd')` กลับเป็น `toISOString().split('T')[0]`
2. `page.tsx` → เปลี่ยน `SingleDateRangePicker` กลับเป็น `DateRangeFilter`

---

## Contact

หากพบปัญหาหรือผลทดสอบไม่ตรงตาม expected → รายงานผลพร้อม:
1. Screenshot ของ Summary Cards
2. Screenshot ของตาราง (แสดงวันที่)
3. Browser console log ที่มี `[ADS_SUMMARY]` และ `[ADS_PERFORMANCE]`
4. SQL query result จาก verification query ด้านบน
