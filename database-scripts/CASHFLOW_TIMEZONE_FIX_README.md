# Cashflow Timezone Fix - Rebuild Instructions

## ปัญหาที่แก้ (Bug Fixed)

**อาการ:** ใน Cashflow page เลือกวันที่ 25 ม.ค. 2569 แต่ตาราง "Daily Cash In Summary" แสดงวันที่ 24 ม.ค. 2569

**สาเหตุ:** API filter date ใช้ UTC date แทน Bangkok date → เลื่อมวัน 1 วัน

**การแก้ไข:**
- ✅ แก้ `cashflow-api-actions.ts` ให้ใช้ `formatBangkok()` เมื่อ filter date
- ✅ แก้ `page.tsx` formatDate() ให้ parse date string เป็น local date
- ✅ Database function (`rebuild_cashflow_daily_summary`) ถูกต้องอยู่แล้ว (ใช้ AT TIME ZONE 'Asia/Bangkok')

## ขั้นตอนการ Rebuild ข้อมูลเดิม

หลังจาก deploy code ใหม่แล้ว ต้อง **rebuild summary ของเดือนที่มีข้อมูล** เพื่อให้วันที่ถูกต้อง

### Step 1: เปิด Supabase SQL Editor

ไปที่ [Supabase Dashboard](https://supabase.com/dashboard) → เลือก project → SQL Editor

### Step 2: หา User UUID

```sql
SELECT id, email FROM auth.users;
```

Copy UUID ของ user ที่ต้องการ rebuild (ปกติจะมี 1 user)

### Step 3: Rebuild Summary สำหรับเดือน มกราคม 2026

```sql
-- แทนที่ YOUR_USER_UUID ด้วย UUID จาก Step 2
SELECT rebuild_cashflow_daily_summary(
  'YOUR_USER_UUID'::UUID,
  '2026-01-01'::date,
  '2026-01-31'::date
);
```

**ผลลัพธ์ที่คาดหวัง:**
```
rebuild_cashflow_daily_summary
-------------------------------
15
```
(จำนวนแถวที่ rebuild ขึ้นอยู่กับข้อมูลที่มี)

### Step 4: Rebuild เดือนอื่นๆ (ถ้ามี)

ถ้ามีข้อมูลในเดือนอื่น ให้เปลี่ยน date range:

```sql
-- กุมภาพันธ์ 2026
SELECT rebuild_cashflow_daily_summary(
  'YOUR_USER_UUID'::UUID,
  '2026-02-01'::date,
  '2026-02-28'::date
);

-- ธันวาคม 2025
SELECT rebuild_cashflow_daily_summary(
  'YOUR_USER_UUID'::UUID,
  '2025-12-01'::date,
  '2025-12-31'::date
);
```

### Step 5: ตรวจสอบผลลัพธ์

กลับไปหน้า Cashflow ใน dashboard:
1. เลือกวันที่ 25 ม.ค. 2569
2. ตรวจสอบ "Daily Cash In Summary" ต้องแสดงวันที่ **25 ม.ค. 2569** (ไม่ใช่ 24)
3. ตรวจยอดเงินว่าถูกต้อง

## วิธีตรวจสอบว่า Fix ถูกต้อง (Debug Queries)

### Query 1: ตรวจวัน TH vs UTC

```sql
SELECT
  settled_time,
  settled_time::date AS utc_date,
  (settled_time AT TIME ZONE 'Asia/Bangkok')::date AS th_date,
  settlement_amount
FROM settlement_transactions
WHERE marketplace='tiktok' AND created_by=auth.uid()
ORDER BY settled_time DESC
LIMIT 20;
```

**Expected:**
- `settled_time = '2026-01-24 17:00:00+00'` → `th_date = '2026-01-25'` ✅
- รายการที่เข้าเวลา 17:00 UTC (00:00 BKK ของวันถัดไป) ต้องไปอยู่วัน TH ที่ถูกต้อง

### Query 2: ตรวจ Summary Table

```sql
SELECT date, forecast_sum, forecast_count, actual_sum, actual_count
FROM cashflow_daily_summary
WHERE created_by=auth.uid()
  AND date BETWEEN '2026-01-01' AND '2026-01-31'
ORDER BY date;
```

**Expected:**
- วันที่ใน summary ต้องตรงกับ TH date (ไม่ใช่ UTC date)
- รายการที่ settled_time = '2026-01-24 17:00+00' ต้องอยู่ใน `date='2026-01-25'`

### Query 3: เปรียบเทียบ Raw vs Summary

```sql
WITH raw_actual AS (
  SELECT
    (settled_time AT TIME ZONE 'Asia/Bangkok')::date AS th_date,
    SUM(settlement_amount) AS total_amount,
    COUNT(*) AS total_count
  FROM settlement_transactions
  WHERE created_by=auth.uid()
    AND (settled_time AT TIME ZONE 'Asia/Bangkok')::date = '2026-01-25'
  GROUP BY (settled_time AT TIME ZONE 'Asia/Bangkok')::date
),
summary_actual AS (
  SELECT
    date,
    actual_sum,
    actual_count
  FROM cashflow_daily_summary
  WHERE created_by=auth.uid()
    AND date = '2026-01-25'
)
SELECT
  raw_actual.th_date,
  raw_actual.total_amount AS raw_total,
  summary_actual.actual_sum AS summary_total,
  raw_actual.total_count AS raw_count,
  summary_actual.actual_count AS summary_count,
  CASE
    WHEN raw_actual.total_amount = summary_actual.actual_sum THEN '✅ Match'
    ELSE '❌ Mismatch'
  END AS status
FROM raw_actual
FULL OUTER JOIN summary_actual ON raw_actual.th_date = summary_actual.date;
```

**Expected:** `status = '✅ Match'` (ยอดต้องตรงกันทุกวัน)

## สาเหตุของ Bug (Technical Details)

### ก่อนแก้ไข ❌

1. **Client sends Date:**
   - User เลือก: 25 ม.ค. 2569 00:00 BKK
   - JavaScript Date: `new Date('2026-01-25T00:00:00+07:00')` = `2026-01-24T17:00:00Z` (UTC)

2. **Old API code:**
   ```typescript
   .gte('date', startDate.toISOString().split('T')[0])
   // = .gte('date', '2026-01-24') ❌ ผิด!
   ```

3. **Database query:**
   - Filter: `date >= '2026-01-24'`
   - แต่ summary.date = TH date = '2026-01-25'
   - ผลลัพธ์: ไม่เจอข้อมูล หรือเจอข้อมูลวันที่ 24 แทน

### หลังแก้ไข ✅

1. **Client sends Date:**
   - Same: `new Date('2026-01-25T00:00:00+07:00')`

2. **New API code:**
   ```typescript
   import { formatBangkok } from '@/lib/bangkok-time';
   .gte('date', formatBangkok(startDate, 'yyyy-MM-dd'))
   // = .gte('date', '2026-01-25') ✅ ถูกต้อง!
   ```

3. **Database query:**
   - Filter: `date >= '2026-01-25'`
   - Summary.date = '2026-01-25'
   - ผลลัพธ์: เจอข้อมูลวันที่ถูกต้อง ✅

## ไฟล์ที่แก้ไข

1. ✅ `frontend/src/app/(dashboard)/finance/marketplace-wallets/finance/marketplace-wallets-api-actions.ts`
   - เพิ่ม `import { formatBangkok }`
   - แทนที่ `.toISOString().split('T')[0]` ด้วย `formatBangkok(date, 'yyyy-MM-dd')`

2. ✅ `frontend/src/app/(dashboard)/finance/marketplace-wallets/page.tsx`
   - แก้ `formatDate()` ให้ parse date string เป็น local date

3. ✅ `database-scripts/migration-012-cashflow-timezone-summary-fix.sql`
   - Documentation + verification queries

4. ✅ `database-scripts/CASHFLOW_TIMEZONE_FIX_README.md` (ไฟล์นี้)
   - Rebuild instructions + debug queries

## หมายเหตุ

- **Database function ไม่ต้องแก้** เพราะใช้ `AT TIME ZONE 'Asia/Bangkok'` ถูกต้องอยู่แล้ว (migration-010)
- **Rebuild จำเป็น** เพราะข้อมูลเก่าถูก aggregate ด้วย API เก่า (ใช้ UTC date)
- **Import ใหม่ไม่ต้อง rebuild** เพราะจะใช้ API ใหม่โดยอัตโนมัติ

## คำสั่งสำหรับ Developer

```bash
# 1. Deploy code ใหม่
git pull origin main
npm run build
pm2 restart dashboard

# 2. Rebuild summary ใน Supabase SQL Editor (ตาม Step 1-4 ข้างบน)

# 3. Test
# - ไปหน้า Cashflow
# - เลือกวันที่ 25 ม.ค. 2569
# - ตรวจสอบตารางต้องแสดงวันที่ 25 (ไม่ใช่ 24)
```

---

**วันที่แก้:** 2026-01-25
**Migration:** 012-cashflow-timezone-summary-fix
**Issue:** Date shift by 1 day in cashflow summary (UTC vs Bangkok)
