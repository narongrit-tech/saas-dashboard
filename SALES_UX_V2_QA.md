# Sales Orders UX v2 - QA Checklist

## Purpose
Manual QA checklist for verifying Sales Orders UX v2 features (platform status tracking, filters, pagination).

## Prerequisites
1. Apply Migration 008: `database-scripts/migration-008-sales-ux-v2.sql` in Supabase SQL Editor
2. Restart frontend dev server: `cd frontend && npm run dev`
3. Have a TikTok OrderSKUList .xlsx file ready for testing

---

## Test 1: Database Migration

### Steps:
1. Open Supabase SQL Editor
2. Copy content from `database-scripts/migration-008-sales-ux-v2.sql`
3. Paste and run in SQL Editor
4. Expected: "Success. No rows returned"

### Verification Query:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'sales_orders'
  AND column_name IN (
    'source_platform', 'external_order_id', 'platform_status', 'platform_substatus',
    'payment_status', 'paid_at', 'shipped_at', 'delivered_at', 'seller_sku', 'sku_id'
  )
ORDER BY column_name;
```

**✅ Expected:**
- 10 rows returned
- All columns exist with correct types
- All nullable (YES)

**📋 Result:** ________

---

## Test 2: TikTok Import with UX v2 Fields

### Steps:
1. Go to http://localhost:3000/sales
2. Click "Import" button
3. Select TikTok OrderSKUList .xlsx file
4. Wait for preview to load
5. Check preview summary

### Verification:
- ✅ Total Rows shows > 0 (e.g., 1366)
- ✅ Total Revenue shows amount
- ✅ Errors count = 0
- ✅ Sample rows displayed (first 5)

6. Click "Confirm Import"
7. Wait for import completion

### Verification:
- ✅ Success message: "Import สำเร็จ: X รายการ"
- ✅ Redirected to sales list page
- ✅ New orders visible in table

### Database Check:
```sql
SELECT
  id,
  order_id,
  external_order_id,
  source_platform,
  platform_status,
  payment_status,
  paid_at,
  shipped_at,
  delivered_at
FROM sales_orders
WHERE source = 'imported'
  AND import_batch_id = (
    SELECT id FROM import_batches
    WHERE marketplace = 'tiktok_shop'
    ORDER BY created_at DESC
    LIMIT 1
  )
LIMIT 5;
```

**✅ Expected:**
- `source_platform` = 'tiktok_shop'
- `external_order_id` populated (TikTok Order ID)
- `platform_status` populated (e.g., "To Ship", "Delivered")
- `payment_status` = 'paid' or 'unpaid'
- `paid_at` populated if paid
- `shipped_at` populated if shipped
- `delivered_at` populated if delivered

**📋 Result:** ________

---

## Test 3: Filter - Platform

### Steps:
1. Go to http://localhost:3000/sales
2. Open "Platform" dropdown
3. Select "TikTok"
4. Wait for data to reload

### Verification:
- ✅ URL updated: `?platform=tiktok_shop`
- ✅ Table shows only TikTok orders
- ✅ Platform column shows "TikTok"
- ✅ Record count updated

5. Select "All Platforms"

### Verification:
- ✅ URL updated: `?` (no platform param)
- ✅ Table shows all orders (TikTok + manual)

**📋 Result:** ________

---

## Test 4: Filter - Status Multi-Select

### Steps:
1. Go to http://localhost:3000/sales
2. Check "Pending" checkbox ONLY
3. Wait for data to reload

### Verification:
- ✅ URL updated: `?status=pending`
- ✅ Table shows only pending orders
- ✅ Internal Status column shows only "Pending" badges (yellow)

4. Check "Completed" checkbox (both checked now)
5. Wait for data to reload

### Verification:
- ✅ URL updated: `?status=pending,completed`
- ✅ Table shows pending + completed orders
- ✅ No cancelled orders visible

6. Uncheck all status checkboxes

### Verification:
- ✅ URL updated: no status param
- ✅ Table shows all statuses

**📋 Result:** ________

---

## Test 5: Filter - Payment Status

### Steps:
1. Go to http://localhost:3000/sales
2. Open "Payment" dropdown
3. Select "Paid"
4. Wait for data to reload

### Verification:
- ✅ URL updated: `?paymentStatus=paid`
- ✅ Table shows only paid orders
- ✅ Payment column shows "Paid" badges (blue)
- ✅ Paid Date column populated

5. Select "Unpaid"

### Verification:
- ✅ URL updated: `?paymentStatus=unpaid`
- ✅ Table shows only unpaid orders
- ✅ Payment column shows "Unpaid" badges (outline)
- ✅ Paid Date column shows "-"

**📋 Result:** ________

---

## Test 6: Filter - Date Range

### Steps:
1. Go to http://localhost:3000/sales
2. Set "Start Date" to 2025-01-01
3. Wait for data to reload

### Verification:
- ✅ URL updated: `?startDate=2025-01-01`
- ✅ Table shows only orders >= 2025-01-01
- ✅ Order Date column verifies date filter

4. Set "End Date" to 2025-01-31

### Verification:
- ✅ URL updated: `?startDate=2025-01-01&endDate=2025-01-31`
- ✅ Table shows only orders within January 2025
- ✅ Record count updated

**📋 Result:** ________

---

## Test 7: Filter - Search

### Steps:
1. Go to http://localhost:3000/sales
2. Enter partial TikTok Order ID in search box (e.g., "57769")
3. Wait for data to reload

### Verification:
- ✅ URL updated: `?search=57769`
- ✅ Table shows matching orders
- ✅ External Order ID column shows matched IDs

4. Clear search and enter product name (e.g., "สมุด")

### Verification:
- ✅ URL updated: `?search=สมุด`
- ✅ Table shows matching products
- ✅ Product Name column shows matched text

**📋 Result:** ________

---

## Test 8: Pagination - Page Size

### Steps:
1. Go to http://localhost:3000/sales
2. Check current pagination: "แสดง 1 ถึง 20 จากทั้งหมด X รายการ"
3. Open "Show" dropdown
4. Select "50"
5. Wait for data to reload

### Verification:
- ✅ URL updated: `?perPage=50`
- ✅ Pagination text: "แสดง 1 ถึง 50 จากทั้งหมด X รายการ"
- ✅ Table shows 50 rows (if available)
- ✅ Page number reset to 1

6. Select "100"

### Verification:
- ✅ URL updated: `?perPage=100`
- ✅ Pagination text: "แสดง 1 ถึง 100 จากทั้งหมด X รายการ"
- ✅ Table shows 100 rows (if available)

**📋 Result:** ________

---

## Test 9: Pagination - Jump to Page

### Steps:
1. Go to http://localhost:3000/sales
2. Note total pages (e.g., "Page: 1 / 68")
3. Type "10" in the Page input box
4. Press Enter or click outside

### Verification:
- ✅ URL updated: `?page=10&perPage=20`
- ✅ Pagination text: "แสดง 181 ถึง 200 จากทั้งหมด X รายการ"
- ✅ Page input shows "10"
- ✅ Table shows page 10 data

5. Try invalid page (e.g., "999")

### Verification:
- ✅ Page number does NOT change (stays at 10)
- ✅ No error shown (silently ignored)

**📋 Result:** ________

---

## Test 10: Pagination - Prev/Next

### Steps:
1. Go to http://localhost:3000/sales (page 1)
2. Click "Next" button
3. Wait for data to reload

### Verification:
- ✅ URL updated: `?page=2`
- ✅ Pagination text: "แสดง 21 ถึง 40 จากทั้งหมด X รายการ"
- ✅ Page input shows "2"

4. Click "Previous" button

### Verification:
- ✅ URL updated: `?page=1`
- ✅ Pagination text: "แสดง 1 ถึง 20 จากทั้งหมด X รายการ"
- ✅ Previous button disabled (on page 1)

**📋 Result:** ________

---

## Test 11: Table UI - New Columns

### Steps:
1. Go to http://localhost:3000/sales
2. Scroll table horizontally (if needed)
3. Verify all columns visible

### Verification:
- ✅ 11 columns: Order ID, External Order ID, Platform, Product Name, Qty, Amount, Status, Platform Status, Payment, Paid Date, Order Date, Actions
- ✅ Sticky header (scrolls but header stays)
- ✅ Long product names truncated with ellipsis
- ✅ Hover over product name shows full text (tooltip)
- ✅ Numeric columns right-aligned (Qty, Amount)
- ✅ Status badges:
  - Internal Status: Green (completed), Yellow (pending), Red (cancelled)
  - Platform Status: Outline badge with text
  - Payment: Blue (paid), Outline (unpaid)

**📋 Result:** ________

---

## Test 12: Export CSV with UX v2

### Steps:
1. Go to http://localhost:3000/sales
2. Apply filters:
   - Platform: TikTok
   - Status: Pending, Completed
   - Payment: Paid
3. Click "Export CSV" button
4. Wait for download

### Verification:
- ✅ File downloaded: `sales-orders-YYYYMMDD-HHmmss.csv`
- ✅ Open file in Excel/Google Sheets
- ✅ Headers: Order ID, External Order ID, Platform, Product Name, Quantity, Unit Price, Total Amount, Internal Status, Platform Status, Payment Status, Paid Date, Order Date, Created At
- ✅ Data respects filters:
  - Only TikTok orders
  - Only pending + completed
  - Only paid orders
- ✅ External Order ID populated (TikTok Order IDs)
- ✅ Platform shows "tiktok_shop"
- ✅ Platform Status populated
- ✅ Payment Status shows "paid"
- ✅ Paid Date populated

**📋 Result:** ________

---

## Test 13: URL Params Persistence

### Steps:
1. Go to http://localhost:3000/sales
2. Apply multiple filters:
   - Platform: TikTok
   - Status: Pending (checked)
   - Payment: Paid
   - Search: "notebook"
   - Page: 3
   - Page Size: 50
3. Copy URL from browser address bar
4. Open new browser tab/window
5. Paste URL and navigate

### Verification:
- ✅ All filters restored:
  - Platform dropdown shows "TikTok"
  - Pending checkbox checked
  - Payment dropdown shows "Paid"
  - Search box shows "notebook"
  - Page shows 3
  - Page size shows 50
- ✅ Table data matches filters
- ✅ No localStorage/sessionStorage used (check DevTools → Application → Storage)

**📋 Result:** ________

---

## Test 14: Refresh Persistence

### Steps:
1. Go to http://localhost:3000/sales
2. Apply filters: Platform=TikTok, Status=Pending, Page=5, PageSize=50
3. Press F5 (browser refresh)

### Verification:
- ✅ URL params preserved after refresh
- ✅ Filters restored correctly
- ✅ Table data reloaded with same filters
- ✅ Page and page size maintained

**📋 Result:** ________

---

## Test 15: Combined Filter + Pagination

### Steps:
1. Go to http://localhost:3000/sales
2. Apply: Platform=TikTok, Payment=Paid, PageSize=100, Page=2
3. Check URL: `?platform=tiktok_shop&paymentStatus=paid&perPage=100&page=2`

### Verification:
- ✅ Shows records 101-200 of paid TikTok orders
- ✅ Pagination text correct: "แสดง 101 ถึง 200 จากทั้งหมด X รายการ"
- ✅ All filters active simultaneously

4. Change filter (e.g., Platform to Shopee)

### Verification:
- ✅ Page resets to 1
- ✅ URL: `?platform=shopee&paymentStatus=paid&perPage=100`
- ✅ Data reloads with new filter

**📋 Result:** ________

---

## Test 16: Deduplication Check

### Steps:
1. Go to http://localhost:3000/sales
2. Click "Import" button
3. Select the SAME TikTok file used in Test 2
4. Click "Confirm Import"

### Verification:
- ✅ Error shown: "ไฟล์นี้ถูก import สำเร็จไปแล้ว - ..."
- ✅ No duplicate rows created
- ✅ import_batches table shows only 1 success batch for this file hash

**📋 Result:** ________

---

## Summary

### Test Results:
- ✅ Migration Applied: ________
- ✅ Import Populates UX v2 Fields: ________
- ✅ Platform Filter Works: ________
- ✅ Status Multi-Select Works: ________
- ✅ Payment Filter Works: ________
- ✅ Date Range Filter Works: ________
- ✅ Search Works: ________
- ✅ Page Size Selector Works: ________
- ✅ Jump-to-Page Works: ________
- ✅ Prev/Next Works: ________
- ✅ Table UI Correct: ________
- ✅ Export CSV Correct: ________
- ✅ URL Persistence Works: ________
- ✅ Refresh Persistence Works: ________
- ✅ Combined Filters Work: ________
- ✅ Deduplication Works: ________

### Overall Status: ________

### Notes/Issues:
-
-

---

**Completed By:** ________
**Date:** 2026-01-__
**Approved By:** ________
