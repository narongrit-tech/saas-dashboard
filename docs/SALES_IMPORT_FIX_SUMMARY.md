# Sales Import UX Fix Summary

**Date:** 2026-01-27
**Goal:** Fix sales import result feedback และทำให้ Sales Orders page เห็นข้อมูลแน่นอน

---

## Changes Made

### 1. Database Migrations

#### Migration 026: Import Batches Date Tracking
**File:** `database-scripts/migration-026-import-batches-date-tracking.sql`

เพิ่มคอลัมน์ใน `import_batches` table:
- `date_min DATE` - วันที่เริ่มต้นของข้อมูลที่ import
- `date_max DATE` - วันที่สิ้นสุดของข้อมูลที่ import
- `date_basis_used TEXT` - ระบุว่าใช้ `order_date` หรือ `paid_at` เป็น basis

```sql
-- Run migration
psql -d your_database -f database-scripts/migration-026-import-batches-date-tracking.sql
```

#### Migration 027: Sales Orders Date Indexes
**File:** `database-scripts/migration-027-sales-orders-date-indexes.sql`

เพิ่ม indexes สำหรับ performance:
- `idx_sales_orders_order_date` - Index สำหรับ order_date filtering
- `idx_sales_orders_created_by_order_date` - Composite index (RLS-friendly)
- `idx_sales_orders_created_by_paid_at` - Composite index (RLS-friendly)

```sql
-- Run migration
psql -d your_database -f database-scripts/migration-027-sales-orders-date-indexes.sql
```

---

### 2. Backend Changes

#### Type Updates
**File:** `frontend/src/types/sales-import.ts`

ปรับ `SalesImportResult` interface:
```typescript
export interface SalesImportResult {
  success: boolean
  batchId?: string
  inserted: number
  updated: number        // NEW: จำนวน rows ที่ถูก update
  skipped: number
  errors: number
  error?: string
  dateBasisUsed?: 'order_date' | 'paid_at'  // NEW: ระบุ basis ที่ใช้
  dateRange?: {          // NEW: date range แบบ structured
    min: string
    max: string
  }
  summary?: {
    dateRange: string
    totalRevenue: number
    orderCount: number
  }
}
```

#### Server Actions
**File:** `frontend/src/app/(dashboard)/sales/sales-import-actions.ts`

ปรับ `finalizeImportBatch()`:
- คำนวณ date range จาก parsed data
- ตรวจสอบว่า row ส่วนใหญ่มี `paid_at` หรือไม่ → เลือก `dateBasisUsed`
- บันทึก `date_min`, `date_max`, `date_basis_used` ใน import_batches table
- Return ข้อมูลละเอียด: inserted, updated, dateBasisUsed, dateRange

---

### 3. Frontend Changes

#### Import Dialog
**File:** `frontend/src/components/sales/SalesImportDialog.tsx`

**Changes:**
1. เพิ่ม `useRouter()` และ `useToast()` hooks
2. เปลี่ยน result state จาก `{ success, message }` เป็น `SalesImportResult`
3. แสดง toast notification หลัง import (success/error)
4. ปรับ result step UI ให้แสดง:
   - Batch ID (8 ตัวอักษรแรก)
   - จำนวน: Inserted, Updated, Skipped
   - ช่วงวันที่ + Date Basis ที่ใช้
   - รายได้รวม + จำนวน Orders
5. เพิ่มปุ่ม "ดูรายการคำสั่งซื้อ" → navigate to `/sales?basis=X&startDate=Y&endDate=Z`

**Key Features:**
- Toast แจ้งเตือนทันทีหลัง import
- Result modal แสดงข้อมูลละเอียด พร้อมปุ่ม action
- Navigate ไป Sales page พร้อม pre-fill date basis และ date range

---

#### Sales Page
**File:** `frontend/src/app/(dashboard)/sales/page.tsx`

**Changes:**
1. เพิ่ม state: `dateBasis: 'order_date' | 'paid_at'` (default: `order_date`)
2. Parse `basis` จาก URL query params
3. เพิ่ม Date Basis Selector UI (Row 0 ของ Filters):
   - 2 ปุ่ม: "วันสั่งซื้อ (Order Date)" / "วันชำระเงิน (Paid Date)"
   - แสดง hint ว่าแต่ละ basis แสดงข้อมูลอะไร
4. ปรับ `fetchOrders()` query:
   - ใช้ `dateBasis` เป็น field สำหรับ date filter และ order by
   - `order_date` → แสดงทุกออเดอร์ตามวันที่สั่ง
   - `paid_at` → แสดงเฉพาะออเดอร์ที่ชำระเงินแล้ว
5. ปรับ Empty State:
   - ถ้า `dateBasis=paid_at` และไม่มีข้อมูล → แสดง hint พร้อมปุ่มสลับไป `order_date`
6. Update URL ให้ include `basis` parameter

**Key Features:**
- User เลือก date basis ได้ตามความต้องการ
- Default = `order_date` (เห็นทุกออเดอร์)
- Hint แนะนำถ้า paid_at ว่าง
- Query performance ดีขึ้นด้วย indexes ใหม่

---

## Manual Test Checklist

### 1. Import Flow Test
- [ ] Upload file .xlsx (TikTok OrderSKUList)
- [ ] Preview แสดง summary + sample rows ถูกต้อง
- [ ] Click "Confirm Import"
- [ ] แสดง toast notification (success/error)
- [ ] Modal แสดง result step พร้อมข้อมูล:
  - [ ] Batch ID
  - [ ] Inserted + Updated + Skipped counts
  - [ ] Date Range + Date Basis
  - [ ] รายได้รวม + จำนวน Orders
- [ ] Click "ดูรายการคำสั่งซื้อ"
- [ ] Navigate ไป `/sales?basis=order_date&startDate=X&endDate=Y`

### 2. Sales Page Test
- [ ] Sales page load ด้วย default `basis=order_date`
- [ ] แสดง rows >0 (ถ้ามี order_date ในช่วงนั้น)
- [ ] Summary bar แสดงตัวเลขถูกต้อง
- [ ] Toggle ไป "วันชำระเงิน (Paid Date)"
  - [ ] Query filter เปลี่ยนเป็น `paid_at`
  - [ ] ถ้า paid_at=null → แสดง empty state + hint
  - [ ] Click hint → สลับกลับไป `order_date`
- [ ] Date Range picker ทำงานถูกต้อง
- [ ] Pagination ทำงานถูกต้อง

### 3. Date Basis Switching Test
- [ ] เริ่มต้น: `basis=order_date` → เห็น rows
- [ ] สลับไป `basis=paid_at`:
  - [ ] ถ้า paid_at มีค่า → เห็น rows
  - [ ] ถ้า paid_at=null → empty state + hint
- [ ] สลับกลับ `basis=order_date` → เห็น rows

### 4. Import + View Flow Test
- [ ] Import file ใหม่
- [ ] Result modal แสดง date_basis_used = `order_date` (ถ้า paid_at ส่วนใหญ่ null)
- [ ] Click "ดูรายการคำสั่งซื้อ"
- [ ] Sales page load ด้วย `basis=order_date&startDate=X&endDate=Y`
- [ ] เห็น rows ที่เพิ่ง import แน่นอน (>0 rows)

---

## SQL Verify Queries

### 1. ตรวจสอบ import_batches ล่าสุด
```sql
SELECT
  id,
  file_name,
  status,
  inserted_count,
  updated_count,
  date_min,
  date_max,
  date_basis_used,
  created_at
FROM import_batches
ORDER BY created_at DESC
LIMIT 5;
```

### 2. ตรวจสอบ sales_orders counts
```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE paid_at IS NOT NULL) AS paid_at_not_null,
  COUNT(*) FILTER (WHERE order_date IS NOT NULL) AS order_date_not_null
FROM sales_orders;
```

### 3. ตรวจสอบ created_by distribution
```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE created_by = auth.uid()) AS created_by_me,
  COUNT(*) FILTER (WHERE created_by IS NULL) AS created_by_null
FROM sales_orders;
```

### 4. ตรวจสอบ date range filter (order_date basis)
```sql
SELECT COUNT(*)
FROM sales_orders
WHERE order_date >= '2026-01-01'::date
  AND order_date < '2026-02-01'::date;
```

### 5. ตรวจสอบ date range filter (paid_at basis)
```sql
SELECT COUNT(*)
FROM sales_orders
WHERE paid_at >= '2026-01-01'::date
  AND paid_at < '2026-02-01'::date;
```

### 6. ตรวจสอบ index usage (EXPLAIN ANALYZE)
```sql
EXPLAIN ANALYZE
SELECT *
FROM sales_orders
WHERE order_date >= '2026-01-01'::date
  AND order_date < '2026-02-01'::date
ORDER BY order_date DESC
LIMIT 20;

-- Should use idx_sales_orders_order_date
```

---

## Git Commands

```bash
# Stage changes
git add database-scripts/migration-026-import-batches-date-tracking.sql
git add database-scripts/migration-027-sales-orders-date-indexes.sql
git add frontend/src/types/sales-import.ts
git add frontend/src/app/\(dashboard\)/sales/sales-import-actions.ts
git add frontend/src/components/sales/SalesImportDialog.tsx
git add frontend/src/app/\(dashboard\)/sales/page.tsx
git add docs/SALES_IMPORT_FIX_SUMMARY.md

# Commit
git commit -m "feat(sales): enhance import UX and add date basis selector

- Add date tracking to import_batches (date_min, date_max, date_basis_used)
- Enhance import result feedback with detailed counts and date range
- Add toast notifications for import success/error
- Add 'Go to Sales Orders' button in import result modal
- Add Date Basis selector to Sales page (order_date/paid_at)
- Update query logic to filter by selected date basis
- Add empty state hint when paid_at is null
- Add indexes for order_date filtering performance

Fixes import result visibility and ensures users can see imported data immediately.
"

# Push (if ready)
# git push origin main
```

---

## Known Issues & Notes

### created_by Issue
- Code นี้ใช้ `createClient()` จาก `@/lib/supabase/server` ซึ่งใช้ user context (ไม่ใช่ service role)
- ถ้า user ยังเจอ `created_by_me=0` หลัง import → อาจเป็นปัญหาจาก:
  1. User login ไม่ถูกต้อง (token หมดอายุ)
  2. RLS policy ยังใช้ `USING(true)` ทำให้ user เห็นข้อมูลคนอื่น
  3. Data เก่าที่ถูก import ด้วย service role ก่อนหน้านี้

**Solution:**
- ตรวจสอบ RLS policy ว่า sales_orders ใช้ `USING(created_by = auth.uid())` หรือไม่
- ถ้าต้องการ multi-user isolation → ปรับ RLS policy
- ถ้าเป็น single-user system → RLS policy ปัจจุบัน (`USING(true)`) ก็ OK

### Date Basis Detection Logic
- System จะเลือก `dateBasisUsed` โดยดูว่า >50% ของ rows มี `paid_at` หรือไม่:
  - ถ้ามี → ใช้ `paid_at` เป็น basis
  - ถ้าไม่มี → ใช้ `order_date` เป็น basis
- Logic นี้ทำงานได้ดีกับ TikTok OrderSKUList ที่ส่วนใหญ่ไม่มี Paid Date

### Performance
- Indexes ใหม่จะช่วย performance เมื่อ filter by date
- RLS policies อาจต้องใช้ composite indexes (`created_by + date field`) สำหรับ multi-user

---

## Summary

**Before:**
- Import modal ปิดเงียบหลัง confirm
- User ไม่รู้ว่า import สำเร็จไหม
- Sales page ใช้ `paid_at` เท่านั้น → ไม่เห็นข้อมูลถ้า paid_at=null

**After:**
- Import modal แสดง result ละเอียด + toast notification
- ปุ่ม "ดูรายการคำสั่งซื้อ" พาไปหน้า sales พร้อม pre-fill date range
- Sales page มี Date Basis selector (order_date/paid_at)
- Empty state hint ถ้า paid_at ว่าง
- User เห็นข้อมูลแน่นอนหลัง import

**Migration Required:**
- ✅ Run migration-026 (import_batches date tracking)
- ✅ Run migration-027 (sales_orders indexes)

**Testing Required:**
- ✅ Manual test checklist (above)
- ✅ SQL verify queries
- ✅ Performance check (EXPLAIN ANALYZE)

---

**Status:** ✅ Ready for Testing & Deployment
