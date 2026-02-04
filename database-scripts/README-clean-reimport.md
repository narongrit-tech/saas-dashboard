# Clean Re-import Guide - Fix Date Shift Bug

## ปัญหาที่พบ (Problem Found)
- TikTok export ใช้ Bangkok timezone อยู่แล้ว แต่โค้ดทำ timezone conversion ซ้ำ
- ทำให้ orders ที่สร้างเวลา 23:00+ น. เลื่อนไปอีก +1 วัน
- ตัวอย่าง: 16/01/2026 23:45:00 → เก็บเป็น 2026-01-17 (ผิด!)
- ส่งผลให้ Jan 16 มี 4 orders แทนที่จะเป็น 432 orders

## การแก้ไข (Fix Applied)
- แก้ไขไฟล์ `frontend/src/lib/sales-parser.ts`
- ปิดการทำ timezone conversion เพื่อเก็บวันที่ตามที่ TikTok export มา
- Test script ยืนยันว่าโค้ดใหม่ทำงานถูกต้อง ✅

## ขั้นตอนการลบและ import ใหม่ (Clean Re-import Steps)

### 1. Run SQL Script to Delete All Data
```bash
# เชื่อมต่อ Supabase และรัน script
psql <your-database-url>

# หรือใน Supabase Dashboard → SQL Editor
# Copy-paste และรัน: database-scripts/delete-all-sales-and-affiliate-data.sql
```

**ตรวจสอบ**: ดู counts ก่อนและหลังลบ - ควรเป็น 0 ทั้งหมด

### 2. Clear Browser Cache (CRITICAL!)

**Option A: Hard Refresh (แนะนำ)**
1. เปิด Chrome DevTools (F12)
2. คลิกขวาที่ปุ่ม Refresh
3. เลือก "Empty Cache and Hard Reload"

**Option B: Clear Cache Manually**
1. กด `Ctrl+Shift+Delete`
2. เลือก "Cached images and files"
3. Time range: "All time"
4. กด "Clear data"

**Option C: Incognito Mode**
- เปิด Incognito window ใหม่ (Ctrl+Shift+N)
- เข้า localhost:3000 ใน Incognito

### 3. Restart Dev Server (ถ้ายังไม่ได้ทำ)
```bash
cd frontend
npm run dev
```

รอให้ compile เสร็จ ต้องเห็น:
```
✓ Compiled /sales in XXXms
```

### 4. Re-import TikTok Sales Data

1. เข้า Sales page
2. คลิก "Import" button
3. **IMPORTANT**: อัปโหลดไฟล์ใหม่ (ไม่ใช่จากไฟล์ที่ cache ไว้!)
   - คลิก file picker ใหม่
   - เลือกไฟล์ YTD จาก folder อีกครั้ง
4. ตรวจสอบ preview:
   - ต้องเห็น "Found 2,121 line items from 1,767 orders" (ไม่ใช่ 1,756)
   - Date range: 2026-01-01 to 2026-01-30
5. กด "Confirm Import"

### 5. Re-import Affiliate Data

1. เข้า Sales page หรือ Affiliate section
2. คลิก "Import Affiliate"
3. อัปโหลดไฟล์ affiliate ใหม่ทั้งหมด
4. ยืนยันการ import

### 6. Verify Results

#### Check Total Orders
```sql
-- Should show ~1,767 unique orders (not 1,756)
SELECT COUNT(DISTINCT order_id) AS total_orders
FROM order_financials;
```

#### Check Jan 16 Specifically
```sql
-- Should show ~432 orders (not 4!)
SELECT
  COUNT(DISTINCT order_id) AS jan16_orders,
  SUM(order_amount) AS jan16_amount
FROM order_financials
WHERE DATE(created_time AT TIME ZONE 'Asia/Bangkok') = '2026-01-16';

-- Expected: ~432 orders, ~102,731 THB
```

#### Check Daily Breakdown
```sql
-- Should match TikTok daily totals
SELECT
  DATE(created_time AT TIME ZONE 'Asia/Bangkok') AS date_bkk,
  COUNT(DISTINCT order_id) AS orders,
  ROUND(SUM(order_amount), 2) AS revenue
FROM order_financials
WHERE DATE(created_time AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY date_bkk
ORDER BY date_bkk;
```

#### Check GMV View
```sql
-- GMV Created should show 1,767 orders for Jan 1-30
SELECT
  SUM(CASE WHEN metric_type = 'created' THEN unique_orders ELSE 0 END) AS gmv_created,
  SUM(CASE WHEN metric_type = 'fulfilled' THEN unique_orders ELSE 0 END) AS fulfilled
FROM sales_gmv_daily_summary
WHERE date_bkk BETWEEN '2026-01-01' AND '2026-01-30'
  AND created_by = '<your-user-id>';
```

### 7. Verify in UI

1. ไปที่ Sales page → GMV Cards
2. เลือกช่วงเวลา: Jan 1-30, 2026
3. ตรวจสอบ:
   - **GMV (Created)**: ควรเป็น ~1,767 orders
   - **Fulfilled**: ควรเป็น ~1,580 orders
   - **Revenue**: ควรเป็น ~422,483.77 THB

## ความแตกต่างที่คาดหวัง (Expected Changes)

### ก่อนแก้ไข (Before Fix)
- Total orders: 1,756 (missing 11)
- Jan 16: 4 orders (missing 428!)
- Jan 17: 453 orders (มากเกิน +428)
- Jan 23: 60 orders (missing 263)
- Jan 24: 306 orders (มากเกิน +263)

### หลังแก้ไข (After Fix)
- Total orders: 1,767 ✅
- Jan 16: 432 orders ✅
- Jan 17: 41 orders ✅
- Jan 23: 323 orders ✅
- Jan 24: 43 orders ✅

## Troubleshooting

### ถ้ายังได้ตัวเลขเดิม (If still showing old numbers)
1. ตรวจสอบว่า dev server compile ใหม่หรือยัง (ดูใน terminal)
2. Clear browser cache อีกครั้ง (Hard Reload)
3. ลองใน Incognito window
4. Query DB โดยตรงเพื่อยืนยัน (ใช้ SQL scripts ด้านบน)

### ถ้า import ไม่ผ่าน (If import fails)
1. ตรวจสอบว่าลบ import_batches แล้วหรือยัง (STEP 5 ของ SQL script)
2. ตรวจสอบว่า file format ถูกต้อง (OrderSKUList sheet)
3. ดู error message ใน console (F12)

### ถ้าตัวเลขยังไม่ตรง (If numbers still don't match)
1. Export daily breakdown จาก UI
2. เปรียบเทียบกับ TikTok export
3. ใช้ analysis script: `node frontend/analyze_sales_daily_breakdown.js`

## Files Changed
- ✅ `frontend/src/lib/sales-parser.ts` - Fixed timezone conversion bug
- ✅ `database-scripts/migration-051-fix-gmv-fulfilled-logic.sql` - Applied
- ✅ `frontend/src/components/sales/SalesImportDialog.tsx` - Added re-import checkbox
- ✅ Test script confirms code works correctly

## References
- Date shift analysis: `BUGFIX_IMPORT_COLUMN_MISMATCH.md`
- GMV logic fix: `docs/SUMMARY_GMV_STABILIZATION.md`
- Migration 051: Fixes GMV fulfilled counting logic
