# Sales Audit QA Checklist

Quality Assurance checklist สำหรับ Sales Orders module (Lines vs Orders feature)

---

## Pre-Deployment Checklist

### 1. Database Migrations

- [ ] **Migration-024:** `order_line_hash` column exists
  ```sql
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'sales_orders'
    AND column_name = 'order_line_hash';
  -- Expected: 1 row
  ```

- [ ] **Migration-025:** Unique index exists (full, not partial)
  ```sql
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = 'sales_orders'
    AND indexdef LIKE '%order_line_hash%';
  -- Expected: sales_orders_unique_created_by_order_line_hash
  -- MUST NOT contain "WHERE" clause
  ```

- [ ] **Migration-029:** TikTok timestamps columns exist
  ```sql
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'sales_orders'
    AND column_name IN ('created_time', 'paid_time', 'cancelled_time');
  -- Expected: 3 rows
  ```

- [ ] **Backfill:** Existing rows have `created_time` populated
  ```sql
  SELECT
    COUNT(*) as total_rows,
    COUNT(created_time) as rows_with_created_time,
    COUNT(*) - COUNT(created_time) as rows_without_created_time
  FROM sales_orders
  WHERE source = 'imported';
  -- Expected: rows_without_created_time = 0 (or close to 0)
  ```

---

## UI Components

### A) Sales Summary Bar - Lines/Orders Card

- [ ] Card แสดงใน row ที่ 2 (ถัดจาก Units, AOV, Cancelled Amount)
- [ ] แสดงค่า:
  - [ ] **Lines:** จำนวน line items (total_lines)
  - [ ] **Orders:** จำนวนออเดอร์ที่ไม่ซ้ำ (total_orders)
  - [ ] **Ratio:** lines_per_order (2 ทศนิยม)
- [ ] Tooltip แสดง: "TikTok OrderSKUList 1 SKU = 1 บรรทัด..."
- [ ] ตัวเลข update ตาม filters (date range, platform, status, dateBasis)

**Test Scenario:**
```
1. ไปหน้า /sales
2. เลือก Date Range = เดือน Jan 2024
3. เลือก Platform = TikTok
4. Check Summary Bar:
   - Lines: 1,000 (ตัวเลขต้องมากกว่า Orders)
   - Orders: 850
   - Ratio: 1.18 (≈ 1,000 / 850)
5. เปลี่ยน Date Basis = Paid Date
   - ตัวเลขต้อง update
6. Filter Status = ยกเลิกคำสั่งซื้อ
   - ตัวเลขต้อง update
```

---

### B) Sales Audit Page

- [ ] เข้าถึงได้ที่ `/sales/audit`
- [ ] มี 3 sections:
  - [ ] Top Multi-SKU Orders (แสดง 50 rows)
  - [ ] Potential Duplicate Lines (แสดง 100 rows หรือ 0 ถ้าไม่มี)
  - [ ] Import Coverage (แสดง metrics)
- [ ] Filters ทำงาน:
  - [ ] Platform (All / TikTok / Shopee)
  - [ ] Date Basis (Order Date / Paid Date)
  - [ ] Date Range (Start / End)
- [ ] Loading states แสดงถูกต้อง (skeleton)
- [ ] Empty states แสดงถูกต้อง (ไม่พบข้อมูล)
- [ ] ปุ่ม "กลับ" กลับไปหน้า /sales

**Test Scenario:**
```
1. ไปหน้า /sales/audit
2. เลือก Date Range = ปัจจุบัน
3. Check Multi-SKU Orders:
   - แสดงออเดอร์ที่มี SKU Lines > 1
   - Sort ตาม SKU Lines descending
4. Check Duplicate Lines:
   - ถ้าไม่มี → แสดง "✅ ไม่พบ Duplicate Lines"
   - ถ้ามี → แสดง rows พร้อม dup_rows > 1
5. Check Import Coverage:
   - WITHOUT Created Time = 0 (หรือใกล้ 0)
```

---

### C) Export Functions

- [ ] หน้า Sales มีปุ่ม Export 2 ปุ่ม:
  - [ ] "Export Lines CSV" (line-level)
  - [ ] "Export Orders CSV" (order-level)
- [ ] Export Lines CSV:
  - [ ] จำนวน rows = จำนวน lines ตาม filter
  - [ ] Columns รวม: Order ID, SKU ID, Product Name, Quantity, Order Amount, Created Time, Paid Time, Cancelled Time, Payment Method
- [ ] Export Orders CSV:
  - [ ] จำนวน rows = จำนวน distinct orders ตาม filter
  - [ ] Columns: External Order ID, Created Time, Paid Time, Cancelled Time, Gross Amount, Total Units, SKU Lines, Payment Method, Cancel Same Day Flag
- [ ] ทั้ง 2 export รองรับ filters:
  - [ ] Platform
  - [ ] Status
  - [ ] Payment Status
  - [ ] Date Range
  - [ ] Date Basis
  - [ ] Search

**Test Scenario:**
```
1. ไปหน้า /sales
2. Filter Date Range = Jan 2024, Platform = TikTok
3. Click "Export Lines CSV"
   - Download ไฟล์ sales-orders-YYYYMMDD-HHMMSS.csv
   - เปิดไฟล์ → นับ rows (ไม่นับ header)
   - Expected: match กับ Lines count ใน Summary Bar
4. Click "Export Orders CSV"
   - Download ไฟล์ sales-orders-grouped-YYYYMMDD-HHMMSS.csv
   - เปิดไฟล์ → นับ rows
   - Expected: match กับ Orders count ใน Summary Bar
5. Check columns:
   - Orders CSV ต้องมี: Created Time, Paid Time, Cancelled Time, Cancel Same Day Flag
```

---

## Backend Logic

### A) getSalesAggregates() ไม่ Double-Count

- [ ] Query ใช้ order-level aggregation (MAX per order_id)
- [ ] Revenue metrics ถูกต้อง:
  ```sql
  -- Manual spot check
  WITH order_totals AS (
    SELECT
      external_order_id,
      MAX(total_amount) as order_amount
    FROM sales_orders
    WHERE created_time >= '2024-01-01'
      AND created_time < '2024-02-01'
    GROUP BY external_order_id
  )
  SELECT SUM(order_amount) as revenue_gross
  FROM order_totals;
  -- Compare กับ Dashboard → ต้อง match
  ```

- [ ] Lines vs Orders metrics ถูกต้อง:
  ```sql
  -- Manual spot check
  SELECT
    COUNT(*) as lines_total,
    COUNT(DISTINCT external_order_id) as orders_distinct,
    ROUND(COUNT(*)::decimal / NULLIF(COUNT(DISTINCT external_order_id), 0), 2) as lines_per_order
  FROM sales_orders
  WHERE created_time >= '2024-01-01'
    AND created_time < '2024-02-01';
  -- Compare กับ Dashboard → ต้อง match
  ```

**Test Scenario:**
```
1. Query revenue แบบ order-level (SQL above)
2. Compare กับ Dashboard Revenue Gross
3. Expected: ≈ same (ความแตกต่าง < 1%)
4. ถ้าไม่ match:
   - Check ว่า Dashboard ใช้ MAX หรือ SUM
   - Check date range filter
```

---

### B) Import Deduplication

- [ ] Import ไฟล์เดิมซ้ำ → BLOCKED
  ```
  1. Import OrderSKUList_Jan.xlsx (1,000 lines)
  2. Import OrderSKUList_Jan.xlsx อีกครั้ง (ไฟล์เดิม)
  3. Expected: แสดง dialog "ไฟล์นี้ถูก import ไปแล้ว"
  ```

- [ ] Import ไฟล์ที่ overlap → Skipped duplicates
  ```
  1. Import OrderSKUList_Jan01-15.xlsx (500 lines)
  2. Import OrderSKUList_Jan10-31.xlsx (600 lines, overlap 100)
  3. Expected:
     - Round 1: inserted 500, skipped 0
     - Round 2: inserted 500, skipped 100
     - Toast: "นำเข้า 500 รายการ (ข้าม 100 duplicates)"
  ```

- [ ] order_line_hash unique constraint ทำงาน
  ```sql
  -- Check for duplicate order_line_hash (should be 0)
  SELECT
    order_line_hash,
    COUNT(*) as dup_count
  FROM sales_orders
  WHERE order_line_hash IS NOT NULL
  GROUP BY order_line_hash
  HAVING COUNT(*) > 1;
  -- Expected: 0 rows
  ```

**Test Scenario:**
```
1. เตรียมไฟล์ test.xlsx (100 lines)
2. Import ครั้งที่ 1
   - Expected: inserted 100, skipped 0
3. Import ครั้งที่ 2 (ไฟล์เดิม)
   - Expected: BLOCKED with duplicate dialog
4. Click "Replace and Re-import"
   - Expected: deleted 100, inserted 100 (ใหม่)
5. Query duplicates:
   - Expected: 0 duplicate order_line_hash
```

---

## Regression Tests

### 1. Summary Bar ไม่เพี้ยน

- [ ] เลือก Date Range ที่มี multi-SKU orders
- [ ] Check:
  - [ ] Revenue ไม่ inflate (ไม่ double-count)
  - [ ] Orders count = COUNT(DISTINCT external_order_id)
  - [ ] Lines count = COUNT(*) > Orders count

### 2. Order View ไม่ซ้ำ

- [ ] สลับเป็น Order View
- [ ] Check:
  - [ ] จำนวน rows ใน table = Orders count (ไม่ใช่ Lines count)
  - [ ] แต่ละ row แสดง SKU Count, Total Units ถูกต้อง

### 3. Pagination ทำงาน

- [ ] ใน Order View: Page 1 → Page 2 → ไม่มี rows ซ้ำ
- [ ] ใน Line View: Page 1 → Page 2 → ไม่มี rows ซ้ำ

### 4. Filters ทำงานร่วมกัน

- [ ] Date Range + Platform + Status + Payment + Search
- [ ] Summary Bar, Table, Export ต้อง sync กัน

---

## SQL Spot Checks

### Check 1: No Double-Count Revenue
```sql
-- ผิด: SUM total_amount (double-count)
SELECT SUM(total_amount) as wrong_revenue
FROM sales_orders
WHERE created_time >= '2024-01-01'
  AND created_time < '2024-02-01';

-- ถูก: MAX per order (order-level)
SELECT SUM(order_amount) as correct_revenue
FROM (
  SELECT external_order_id, MAX(total_amount) as order_amount
  FROM sales_orders
  WHERE created_time >= '2024-01-01'
    AND created_time < '2024-02-01'
  GROUP BY external_order_id
) orders;

-- Compare: wrong_revenue vs correct_revenue
-- ถ้า wrong > correct → มี multi-SKU orders (ปกติ)
```

### Check 2: Lines vs Orders Ratio
```sql
SELECT
  COUNT(*) as lines_total,
  COUNT(DISTINCT external_order_id) as orders_distinct,
  ROUND(COUNT(*)::decimal / NULLIF(COUNT(DISTINCT external_order_id), 0), 2) as ratio
FROM sales_orders
WHERE created_time >= CURRENT_DATE - INTERVAL '30 days';

-- Expected ratio: 1.2 - 2.5 (ขึ้นอยู่กับ business)
-- ถ้า ratio = 1.00 ทุกวัน → ไม่มีออเดอร์ multi-SKU (ตรวจสอบ)
-- ถ้า ratio > 5.00 → มี multi-SKU เยะมาก (ปกติ)
```

### Check 3: Import Dedup Effectiveness
```sql
-- Count batches with same file_hash
SELECT
  file_hash,
  COUNT(*) as batch_count,
  SUM(inserted_count) as total_inserted,
  SUM(skipped_count) as total_skipped
FROM import_batches
WHERE marketplace = 'tiktok_shop'
  AND status = 'success'
GROUP BY file_hash
HAVING COUNT(*) > 1;

-- ถ้า batch_count > 1:
--   - Check ว่า batch ที่ 2+ มี skipped_count > 0 (ถูก block ได้บ้าง)
--   - หรือ status = 'replaced' (user replace)
```

---

## Performance Checks

- [ ] **Sales Page Load Time:** < 2 seconds (with 10,000 rows)
- [ ] **Audit Page Load Time:** < 3 seconds (with 10,000 rows)
- [ ] **Export Lines CSV:** < 10 seconds (with 10,000 rows)
- [ ] **Export Orders CSV:** < 10 seconds (with 10,000 rows)
- [ ] **Import 1,000 lines:** < 30 seconds

---

## Edge Cases

### Case 1: ออเดอร์ที่มี 10+ SKU
```
Test:
1. สร้าง mock order ที่มี 15 SKU lines
2. Import เข้าระบบ
3. Check:
   - Summary Bar: Lines = 15, Orders = 1, Ratio = 15.00
   - Order View: แสดง 1 row (ไม่ใช่ 15)
   - Export Orders CSV: 1 row (ไม่ใช่ 15)
   - Revenue: ไม่ double-count
```

### Case 2: Null created_time (legacy data)
```
Test:
1. Insert manual row ที่ไม่มี created_time
2. Query getSalesAggregates
3. Expected:
   - ใช้ order_date เป็น fallback
   - ไม่ crash
   - Metrics รวม row นี้ด้วย
```

### Case 3: Import 0 rows (empty file)
```
Test:
1. Import ไฟล์ที่มี header อย่างเดียว (0 data rows)
2. Expected:
   - แสดง error: "ไม่มีข้อมูลที่จะ import"
   - ไม่สร้าง import_batch
```

---

## Final Checklist

- [ ] **Build ผ่าน:** `cd frontend && npm run build`
- [ ] **No TypeScript errors**
- [ ] **No console errors** ในหน้า /sales และ /sales/audit
- [ ] **Docs ครบ:**
  - [ ] SALES_LINES_VS_ORDERS_EXPLAINER.md
  - [ ] SALES_AUDIT_GUIDE.md
  - [ ] IMPORT_DEDUP_GUARD.md
  - [ ] SALES_AUDIT_QA.md (this file)
- [ ] **Git commit message ชัดเจน:**
  ```
  feat(sales): add Lines/Orders metrics, Audit view, and import dedup guard

  - Add Lines/Orders card to Summary Bar (total_lines, total_orders, lines_per_order)
  - Create /sales/audit page with Multi-SKU Orders, Duplicate Lines, Import Coverage
  - Add 2 export buttons: Export Lines CSV and Export Orders CSV (with order-level columns)
  - Improve import dedup: track skipped_duplicates and show in toast
  - Add docs: SALES_LINES_VS_ORDERS_EXPLAINER, SALES_AUDIT_GUIDE, IMPORT_DEDUP_GUARD
  - Add QA checklist: SALES_AUDIT_QA.md

  Closes #[issue-number]
  ```

---

## Sign-Off

**QA Engineer:** ____________________ Date: ____________

**Product Owner:** ____________________ Date: ____________

**Tech Lead:** ____________________ Date: ____________
