# Sales Audit Guide

เครื่องมือตรวจสอบคุณภาพและความถูกต้องของข้อมูล Sales Orders

## เข้าถึง Audit Page

```
/sales/audit
```

หรือจากหน้า Sales > ปุ่ม Audit (ถ้ามี)

---

## Audit Sections

### A) Top Multi-SKU Orders

**วัตถุประสงค์:** แสดงออเดอร์ที่มีหลาย SKU (มากที่สุด 50 อันดับ)

**Columns:**
- `Order ID` - External order ID จาก TikTok
- `SKU Lines` - จำนวน line items (SKUs) ในออเดอร์
- `Total Units` - จำนวนสินค้ารวม (SUM quantity)
- `Gross Amount` - ยอดเงินรวม (order_amount)
- `Created Time` - วันที่สั่งซื้อ
- `Paid Time` - วันที่ชำระเงิน

**การใช้งาน:**
- ตรวจสอบว่าออเดอร์ที่มีหลาย SKU มี order_amount ถูกต้องหรือไม่
- ตรวจสอบว่า Total Units = SUM(quantity across lines)
- เปรียบเทียบกับ TikTok Seller Center เพื่อ spot check

**SQL Equivalent:**
```sql
SELECT
  external_order_id,
  COUNT(*) as sku_lines,
  SUM(quantity) as total_units,
  MAX(total_amount) as gross_amount,
  MAX(created_time) as created_time,
  MAX(paid_time) as paid_time
FROM sales_orders
WHERE created_time >= '2024-01-01'
  AND created_time < '2024-02-01'
GROUP BY external_order_id
HAVING COUNT(*) > 1
ORDER BY sku_lines DESC
LIMIT 50;
```

---

### B) Potential Duplicate Lines

**วัตถุประสงค์:** หา line items ที่อาจซ้ำซ้อน (ในออเดอร์เดียวกัน SKU + variation เหมือนกัน แต่มีหลาย rows)

**Columns:**
- `Order ID` - External order ID
- `SKU ID` - Platform SKU ID
- `Variation` - Product variation (สี, ขนาด)
- `Duplicate Rows` - จำนวน rows ที่ซ้ำกัน
- `Latest Created At` - วันที่ import ล่าสุด

**การใช้งาน:**
- ถ้าเจอ duplicate rows > 1 → อาจเป็น:
  1. **ข้อมูลจริง** - ลูกค้าสั่ง SKU เดียวกันหลายครั้งในออเดอร์เดียว (ปกติ)
  2. **Import ผิดพลาด** - import ไฟล์ซ้ำหรือมีบัคในการ parse
  3. **Dedup ไม่ทำงาน** - `order_line_hash` unique constraint ไม่เวิร์ค

**การแก้ไข:**
- ตรวจสอบใน TikTok Seller Center ก่อน
- ถ้าข้อมูลซ้ำจริง: ลบ rows ที่เก่ากว่าออก (เก็บ latest_created_at)
- ถ้าข้อมูลถูกต้อง: ไม่ต้องทำอะไร

**SQL Equivalent:**
```sql
WITH line_groups AS (
  SELECT
    external_order_id,
    sku_id,
    metadata->>'variation' as variation,
    COUNT(*) as dup_rows,
    MAX(created_at) as latest_created_at
  FROM sales_orders
  GROUP BY external_order_id, sku_id, metadata->>'variation'
  HAVING COUNT(*) > 1
)
SELECT *
FROM line_groups
ORDER BY dup_rows DESC
LIMIT 100;
```

**Hard Delete Duplicate (ตัวอย่าง):**
```sql
-- ⚠️ ระวัง! ตรวจสอบให้แน่ใจก่อนรัน
WITH duplicates AS (
  SELECT
    id,
    external_order_id,
    sku_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY external_order_id, sku_id, metadata->>'variation'
      ORDER BY created_at DESC
    ) as rn
  FROM sales_orders
)
DELETE FROM sales_orders
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);
```

---

### C) Import Coverage

**วัตถุประสงค์:** ตรวจสอบความครบถ้วนของ TikTok Business Timestamps

**Metrics:**
- `Total Rows (Lines)` - จำนวน line items ทั้งหมด
- `Distinct Orders` - จำนวนออเดอร์ที่ไม่ซ้ำ
- `With Created Time` - จำนวน rows ที่มี `created_time` (ควรเป็น 100%)
- `With Paid Time` - จำนวน rows ที่มี `paid_time` (ขึ้นอยู่กับ COD/Online)
- `With Cancelled Time` - จำนวน rows ที่มี `cancelled_time`
- `WITHOUT Created Time` - จำนวน rows ที่ไม่มี `created_time` (**ควรเป็น 0**)

**สถานะที่ถูกต้อง:**
```
✅ Total Rows: 1,000
✅ Distinct Orders: 850
✅ With Created Time: 1,000 (100%)
✅ With Paid Time: 900 (90% - COD 10%)
✅ With Cancelled Time: 50 (5%)
✅ WITHOUT Created Time: 0 (0%) ✅
```

**สถานะที่ผิดปกติ:**
```
❌ Total Rows: 1,000
❌ WITHOUT Created Time: 100 (10%) ⚠️
```

**การแก้ไข:**
- ถ้า `WITHOUT Created Time` > 0:
  1. ตรวจสอบว่า migration-029 ถูกรันหรือไม่
  2. Backfill `created_time` จาก `metadata->>'created_time'` หรือ `order_date`
  3. ถ้าเป็น manual entries (source='manual') → ปกติที่ไม่มี created_time

**SQL Equivalent:**
```sql
SELECT
  COUNT(*) as total_rows,
  COUNT(DISTINCT external_order_id) as distinct_orders,
  COUNT(created_time) as rows_with_created_time,
  COUNT(paid_time) as rows_with_paid_time,
  COUNT(cancelled_time) as rows_with_cancelled_time,
  COUNT(*) - COUNT(created_time) as rows_without_created_time
FROM sales_orders
WHERE source_platform = 'tiktok_shop';
```

---

## Filters

Audit Page รองรับ filters เดียวกับหน้า Sales:

1. **Platform** - All / TikTok / Shopee / Lazada
2. **Date Basis** - Order Date (created_time) / Paid Date (paid_time)
3. **Date Range** - Start Date / End Date

**หมายเหตุ:** Import Coverage **ไม่** filter ตาม date range (แสดงข้อมูลทั้งหมด)

---

## Use Cases

### 1. ตรวจสอบก่อน Month-End Close
```
1. ไป Sales > Audit
2. เลือก Date Range = เดือนที่ต้องการ close
3. ดู Import Coverage → WITHOUT Created Time ต้องเป็น 0
4. ดู Duplicate Lines → ถ้ามี dup_rows > 1 ให้ตรวจสอบและแก้ไข
5. ดู Multi-SKU Orders → spot check กับ TikTok Seller Center
```

### 2. Spot Check หลัง Import ไฟล์ใหม่
```
1. Import OrderSKUList ผ่าน Sales > Import
2. ไป Sales > Audit
3. เลือก Date Range = วันที่ import
4. ตรวจสอบว่า:
   - Import Coverage: WITH Created Time = 100%
   - Duplicate Lines: ไม่มี (หรือมีเหตุผลที่ชัดเจน)
   - Multi-SKU Orders: ตัวเลข match กับไฟล์ต้นทาง
```

### 3. ตรวจสอบ Revenue Mismatch
```
ถ้า Dashboard Revenue ไม่ match กับ TikTok Seller Center:

1. ไป Sales > Audit
2. ดู Import Coverage → ตรวจสอบว่า Distinct Orders match
3. ดู Multi-SKU Orders → ตรวจสอบว่า order_amount ถูกต้อง
4. Query revenue แบบ order-level:
   SELECT SUM(order_amount) FROM (
     SELECT MAX(total_amount) as order_amount
     FROM sales_orders
     GROUP BY external_order_id
   ) orders;
```

---

## เทคนิค Advanced

### ตรวจสอบ order_line_hash ว่าทำงานหรือไม่
```sql
-- หา rows ที่มี order_line_hash ซ้ำ (ไม่ควรมี)
SELECT
  order_line_hash,
  COUNT(*) as dup_count,
  array_agg(id) as row_ids
FROM sales_orders
WHERE order_line_hash IS NOT NULL
GROUP BY order_line_hash
HAVING COUNT(*) > 1;

-- Expected: 0 rows (ถ้ามี → unique constraint ไม่เวิร์ค)
```

### นับ Multi-SKU Ratio
```sql
-- สัดส่วนออเดอร์ที่มี 1 SKU vs หลาย SKU
WITH order_sku_counts AS (
  SELECT
    external_order_id,
    COUNT(*) as sku_lines
  FROM sales_orders
  WHERE source_platform = 'tiktok_shop'
  GROUP BY external_order_id
)
SELECT
  CASE
    WHEN sku_lines = 1 THEN 'Single SKU'
    WHEN sku_lines = 2 THEN '2 SKUs'
    WHEN sku_lines = 3 THEN '3 SKUs'
    WHEN sku_lines >= 4 THEN '4+ SKUs'
  END as sku_category,
  COUNT(*) as order_count,
  ROUND(COUNT(*)::decimal / SUM(COUNT(*)) OVER () * 100, 2) as pct
FROM order_sku_counts
GROUP BY sku_category
ORDER BY MIN(sku_lines);
```

---

## สรุป

Sales Audit Page ช่วยให้:
- ✅ ตรวจสอบ data quality ก่อน month-end
- ✅ หา duplicate lines และ multi-SKU orders
- ✅ ตรวจสอบ timestamp completeness (migration-029)
- ✅ Spot check กับ TikTok Seller Center

ใช้เป็นส่วนหนึ่งของ QA process ก่อน commit ตัวเลข P&L
