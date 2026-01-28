# Sales Lines vs Orders Explainer

## ปัญหา: ทำไมจำนวน Rows ไม่เท่ากับจำนวน Orders?

**คำตอบสั้น:** TikTok OrderSKUList export แต่ละ SKU (สินค้า) เป็น 1 บรรทัด ดังนั้นออเดอร์ที่มีหลาย SKU จะมีหลายบรรทัด

## ตัวอย่าง

### ออเดอร์ 1: ซื้อ 1 SKU
```
Order ID: 123456789
- SKU 1: เสื้อยืด สีแดง x 2 = 200 บาท
```
**จำนวนแถวในฐานข้อมูล:** 1 แถว
**จำนวนออเดอร์:** 1 ออเดอร์
**Ratio:** 1.00

---

### ออเดอร์ 2: ซื้อ 3 SKU
```
Order ID: 987654321
- SKU 1: เสื้อยืด สีแดง x 1 = 100 บาท
- SKU 2: กางเกง สีดำ x 1 = 300 บาท
- SKU 3: หมวก สีฟ้า x 2 = 200 บาท
Total: 600 บาท
```
**จำนวนแถวในฐานข้อมูล:** 3 แถว
**จำนวนออเดอร์:** 1 ออเดอร์
**Ratio:** 3.00

---

## ทำไมถึงต้องเก็บแบบ Line-Level?

### เหตุผลหลัก
1. **ความถูกต้องของข้อมูล (Data Integrity)**
   - TikTok export ให้มาแบบ line-level → เราเก็บตามความเป็นจริง
   - ถ้า aggregate ก่อนเก็บ จะสูญเสียข้อมูล SKU-level (sku_id, variation, seller_sku)

2. **รองรับการวิเคราะห์แบบละเอียด (Granular Analytics)**
   - วิเคราะห์ว่า SKU ไหนขายดี
   - ตรวจสอบ variation (สี, ขนาด) แยกได้
   - ตรวจจับ duplicate lines (SKU ซ้ำในออเดอร์เดียวกัน)

3. **Import Idempotency**
   - ใช้ `order_line_hash` (unique per line) กัน import ซ้ำ
   - ถ้า aggregate เป็น order-level ก่อน จะกันซ้ำไม่ได้ในระดับ line

---

## การคำนวณที่ถูกต้อง

### ✅ สิ่งที่ถูกต้อง (Order-Level Aggregation)
```sql
-- Revenue (ใช้ MAX per order_id เพื่อหลีกเลี่ยง double-count)
SELECT
  external_order_id,
  MAX(total_amount) as order_amount, -- ใช้ MAX ไม่ใช่ SUM
  SUM(quantity) as total_units,
  COUNT(*) as sku_lines
FROM sales_orders
WHERE created_time >= '2024-01-01'
GROUP BY external_order_id;

-- Total Revenue (รวมทุกออเดอร์)
SELECT SUM(order_amount) as revenue_gross
FROM (
  SELECT external_order_id, MAX(total_amount) as order_amount
  FROM sales_orders
  WHERE created_time >= '2024-01-01'
  GROUP BY external_order_id
) orders;
```

### ❌ สิ่งที่ผิด (Double-Count)
```sql
-- ผิด: SUM(total_amount) จะนับซ้ำถ้าออเดอร์มีหลาย SKU
SELECT SUM(total_amount) as revenue_gross
FROM sales_orders
WHERE created_time >= '2024-01-01';
-- ❌ ผลลัพธ์จะสูงเกินความเป็นจริง!
```

---

## Metrics ที่ Dashboard แสดง

| Metric | คำอธิบาย | การคำนวณ |
|--------|----------|----------|
| **Lines (SKU Lines)** | จำนวนแถวทั้งหมดในตาราง | `COUNT(*)` |
| **Orders (Distinct)** | จำนวนออเดอร์ที่ไม่ซ้ำ | `COUNT(DISTINCT external_order_id)` |
| **Lines per Order** | อัตราส่วน Lines / Orders | `lines / orders` (2 ทศนิยม) |
| **Revenue Gross** | ยอดขายรวม (ก่อนหัก cancel) | `SUM(MAX(total_amount) per order)` |
| **Total Units** | จำนวนสินค้าทั้งหมด | `SUM(quantity)` |

---

## การตรวจสอบความถูกต้อง (Spot Check)

### 1. เปรียบเทียบกับ TikTok Seller Center
```sql
-- นับ rows vs distinct orders
SELECT
  COUNT(*) as lines_total,
  COUNT(DISTINCT external_order_id) as orders_distinct,
  ROUND(COUNT(*)::decimal / NULLIF(COUNT(DISTINCT external_order_id), 0), 2) as lines_per_order
FROM sales_orders
WHERE source_platform = 'tiktok_shop'
  AND created_time >= '2024-01-01'
  AND created_time < '2024-02-01';
```

**Expected:**
- `lines_per_order` ≈ 1.2 - 2.5 (ขึ้นอยู่กับสินค้า)
- ถ้า = 1.00 → ทุกออเดอร์มี 1 SKU (ปกติ)
- ถ้า > 3.00 → มีออเดอร์ multi-SKU เยอะ (ปกติ)

### 2. หาออเดอร์ที่มี Multi-SKU
```sql
-- Top 10 orders with most SKU lines
SELECT
  external_order_id,
  COUNT(*) as sku_lines,
  SUM(quantity) as total_units,
  MAX(total_amount) as gross_amount
FROM sales_orders
WHERE source_platform = 'tiktok_shop'
GROUP BY external_order_id
HAVING COUNT(*) > 1
ORDER BY sku_lines DESC
LIMIT 10;
```

---

## FAQs

### Q1: ทำไม Revenue ใน Dashboard ไม่เท่ากับ SUM(total_amount)?
**A:** เพราะเราใช้ order-level aggregation (MAX per order) เพื่อไม่ double-count ออเดอร์ที่มีหลาย SKU

### Q2: ถ้าต้องการดู SKU-level breakdown ต้องทำยังไง?
**A:** ใช้ **Line View** ในหน้า Sales (toggle ที่ด้านบน) หรือ Export Lines CSV

### Q3: ออเดอร์ที่มี 3 SKU แต่ total_amount เท่ากันทุก line ใช่ไหม?
**A:** ใช่ TikTok export ให้ total_amount (order-level) ซ้ำกันทุก line ใน order เดียวกัน

### Q4: ถ้าเจอ Duplicate Lines (SKU ซ้ำในออเดอร์เดียวกัน) ต้องทำยังไง?
**A:** ไปที่ **Sales > Audit** เพื่อตรวจสอบ Duplicate Lines และตัดสินใจว่าจะลบหรือไม่

---

## เครื่องมือที่เกี่ยวข้อง

1. **Sales Summary Bar** - แสดง Lines / Orders / Ratio
2. **Order View vs Line View** - Toggle ระหว่างมุมมองออเดอร์และ line
3. **Export Orders CSV** - Export order-level (1 row per order)
4. **Export Lines CSV** - Export line-level (raw data)
5. **Sales Audit Page** - ตรวจสอบ Multi-SKU Orders และ Duplicate Lines

---

## สรุป

**Lines ≠ Orders เป็นเรื่องปกติ** เพราะ TikTok OrderSKUList export แต่ละ SKU เป็น 1 บรรทัด
Dashboard คำนวณ Revenue และ Metrics ถูกต้องด้วย order-level aggregation (ไม่ double-count)
ใช้ Lines/Orders Ratio และ Sales Audit เพื่อตรวจสอบความถูกต้องของข้อมูล
