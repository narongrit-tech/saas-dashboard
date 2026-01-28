# Sales Order View - Manual Test Steps

**Purpose**: Verify that Order View correctly prevents revenue inflation from multi-SKU orders.
**Tester**: ________________
**Date**: ________________

---

## Pre-Test Setup

### Step 1: Run Database Migration
```bash
# Connect to Supabase SQL Editor and run:
# D:\Projects\saas-dashboard\database-scripts\migration-028-add-status-group.sql
```

**Expected**: Query successful, `status_group` column added

### Step 2: Prepare Test Data
You need at least ONE multi-SKU order to test. Use one of these options:

#### Option A: Import Real TikTok Data
1. Go to /sales
2. Click "Import"
3. Upload `OrderSKUList.xlsx` file (must have at least 1 order with 2+ SKUs)
4. Note the Order ID for testing

#### Option B: Create Test Order Manually
Since manual orders are single-line, use SQL:
```sql
-- Insert test multi-SKU order (2 lines)
INSERT INTO sales_orders (
  order_id,
  external_order_id,
  source_platform,
  product_name,
  quantity,
  unit_price,
  total_amount,
  order_date,
  status,
  platform_status,
  payment_status,
  paid_at,
  created_by
) VALUES
  -- Line 1
  ('TEST-001', '999TEST', 'tiktok_shop', 'Product A', 2, 100.00, 500.00, NOW(), 'completed', 'จัดส่งสำเร็จ', 'paid', NOW(), (SELECT id FROM auth.users LIMIT 1)),
  -- Line 2 (SAME order_id, SAME total_amount)
  ('TEST-001', '999TEST', 'tiktok_shop', 'Product B', 3, 100.00, 500.00, NOW(), 'completed', 'จัดส่งสำเร็จ', 'paid', NOW(), (SELECT id FROM auth.users LIMIT 1));
```

**Expected**: 2 rows inserted
**Test Order ID**: `999TEST`
**Order Amount**: 500 THB
**Total Units**: 2 + 3 = 5
**SKU Count**: 2

---

## Test Execution

### TEST 1: Line View (Baseline - Current Behavior)

**Purpose**: Confirm multi-SKU order shows 2 rows in Line View

1. Navigate to: http://localhost:3000/sales
2. Ensure "Line View" is selected (right button)
3. Filter by order ID: `999TEST` (or your test order)

**Expected Results**:
```
Row 1: Order ID=999TEST, Product=Product A, Qty=2, Amount=500.00
Row 2: Order ID=999TEST, Product=Product B, Qty=3, Amount=500.00
```

**✅ PASS / ❌ FAIL**: ___________

**Screenshot**: (optional) ___________

---

### TEST 2: Order View (New Feature - Aggregated)

**Purpose**: Verify Order View shows 1 row with correct aggregations

1. Stay on /sales page
2. Click "Order View" button (left button)
3. Filter by order ID: `999TEST`

**Expected Results**:
```
Columns visible:
- Order ID: 999TEST
- Platform: TikTok
- Status: จัดส่งสำเร็จ
- Payment: paid
- Total Units: 5 (NOT 2 or 3)
- Order Amount: ฿500.00 (NOT ฿1,000.00)
- Paid Date: (today)
- Shipped Date: (today or -)
- Actions: [Eye icon] (View button)
```

**Verify**:
- [ ] Only 1 row shown (NOT 2)
- [ ] Total Units = 5
- [ ] Order Amount = ฿500.00
- [ ] Has "View" button (eye icon)

**✅ PASS / ❌ FAIL**: ___________

**Screenshot**: (attach if fail) ___________

---

### TEST 3: Summary Cards (Order View)

**Purpose**: Verify summary metrics use order-level aggregation

1. Ensure Order View is selected
2. Clear all filters (show all orders)
3. Look at summary cards at top of page

**Expected Behavior**:
- Revenue card should NOT double-count multi-SKU orders
- Orders count should count DISTINCT order IDs
- Units should sum ALL quantities

**Test Calculation** (if only test order exists):
- Revenue: ฿500.00 (NOT ฿1,000)
- Orders: 1 (NOT 2)
- Units: 5 (2+3)
- AOV: ฿500 / 1 = ฿500

**Actual Results**:
- Revenue: ฿_________
- Orders: _________
- Units: _________
- AOV: ฿_________

**✅ PASS / ❌ FAIL**: ___________

---

### TEST 4: Order Detail Drawer

**Purpose**: Verify drawer shows line breakdown correctly

1. Stay in Order View
2. Find order `999TEST`
3. Click "View" button (eye icon)
4. Wait for drawer to slide in from right

**Expected Drawer Content**:

**Order Summary Section**:
- Platform: TikTok (or tiktok_shop)
- Status: จัดส่งสำเร็จ
- Payment: paid (blue badge)
- Order Amount: ฿500.00
- Total Units: 5
- SKUs: 2 items
- Order Date: (today)
- Paid Date: (today)

**Line Items Table** (2 rows):
```
Product Name       | Qty | Unit Price  | Subtotal
-------------------|-----|-------------|----------
Product A          | 2   | ฿100.00     | ฿500.00
  SKU: (if any)    |     |             |
Product B          | 3   | ฿100.00     | ฿500.00
  SKU: (if any)    |     |             |
```

**Verify**:
- [ ] Drawer opens smoothly
- [ ] Order summary shows correct totals
- [ ] Line items table shows 2 rows
- [ ] Each line shows individual product name
- [ ] Quantities are 2 and 3 (NOT summed)
- [ ] Can close drawer (X button or click outside)

**✅ PASS / ❌ FAIL**: ___________

**Screenshot**: (drawer open) ___________

---

### TEST 5: View Toggle Persistence

**Purpose**: Verify filters persist when switching views

1. Set filters:
   - Platform: TikTok
   - Date range: Today
   - Search: (leave blank)
2. Ensure Order View shows filtered results
3. Click "Line View"
4. Check if filters still applied
5. Click "Order View" again

**Expected**:
- [ ] Filters remain active when switching to Line View
- [ ] Same order(s) shown in both views
- [ ] URL params persist (check browser address bar)
- [ ] No page reload occurs (smooth toggle)

**✅ PASS / ❌ FAIL**: ___________

---

### TEST 6: Pagination (Order View)

**Purpose**: Verify pagination counts DISTINCT orders, not lines

**Pre-Condition**: Need multiple orders (if only 1 test order, add more)

1. Ensure Order View is selected
2. Clear filters (show all orders)
3. Look at pagination at bottom of table

**If you have 25 orders (some multi-SKU) = 40 total lines**:
- Line View pagination: "แสดง 1 ถึง 20 จากทั้งหมด **40** รายการ"
- Order View pagination: "แสดง 1 ถึง 20 จากทั้งหมด **25** รายการ"

**Actual Results**:
- Order View total count: _________
- Line View total count: _________

**✅ PASS / ❌ FAIL**: ___________

---

### TEST 7: Date Basis Toggle

**Purpose**: Verify date filtering works with both order_date and paid_at

1. Set date range to "Today" (default)
2. Select "Order View"
3. Switch date basis: "วันชำระเงิน (Paid Date)"
4. Check results

**Expected**:
- Orders filtered by paid_at
- Summary cards update correctly
- Switching back to "วันสั่งซื้อ (Order Date)" shows different results (if orders have different dates)

**Verify**:
- [ ] Blue info box shows: "กรองวันที่ตาม: วันชำระเงิน (Paid Date)"
- [ ] Table updates when toggling
- [ ] Summary cards recalculate

**✅ PASS / ❌ FAIL**: ___________

---

### TEST 8: Search by Order ID

**Purpose**: Verify search works in both views

1. Order View: Search for `999TEST`
2. Check result (should show 1 row)
3. Line View: Search for `999TEST`
4. Check result (should show 2 rows)

**Expected**:
- [ ] Order View: 1 row (grouped order)
- [ ] Line View: 2 rows (both lines)
- [ ] Both show same order_id

**✅ PASS / ❌ FAIL**: ___________

---

### TEST 9: Export CSV (Order View)

**Purpose**: Verify export respects current view

1. Select Order View
2. Filter to show only test order (optional)
3. Click "Export CSV" button
4. Wait for download
5. Open CSV file in Excel/Numbers

**Expected CSV (Order View)**:
```csv
Order ID,External Order ID,Platform,Total Units,Order Amount,Paid Date,...
TEST-001,999TEST,tiktok_shop,5,500.00,2026-01-28,...
```

**Verify**:
- [ ] Only 1 row for order 999TEST
- [ ] Total Units = 5
- [ ] Order Amount = 500.00 (NOT 1000.00)

**Now test Line View export**:
1. Switch to "Line View"
2. Click "Export CSV" again
3. Open new CSV file

**Expected CSV (Line View)**:
```csv
Order ID,External Order ID,Product Name,Quantity,Total Amount,...
TEST-001,999TEST,Product A,2,500.00,...
TEST-001,999TEST,Product B,3,500.00,...
```

**Verify**:
- [ ] 2 rows for order 999TEST
- [ ] Each row shows individual product
- [ ] Quantities are 2 and 3

**✅ PASS / ❌ FAIL**: ___________

---

### TEST 10: Performance Check

**Purpose**: Verify page loads in acceptable time

1. Clear browser cache
2. Navigate to /sales (Order View)
3. Measure load time (use browser DevTools Network tab)

**Acceptable Performance**:
- [ ] Initial page load: < 3 seconds
- [ ] Order View data fetch: < 2 seconds
- [ ] Switching to Line View: < 2 seconds
- [ ] Drawer open: < 500ms

**Actual Load Times**:
- Page load: _________ ms
- Order View fetch: _________ ms
- View toggle: _________ ms
- Drawer open: _________ ms

**✅ PASS / ❌ FAIL**: ___________

---

## Edge Cases & Error Handling

### Edge Case 1: Empty State
1. Set filters that return no results
2. Check Order View and Line View

**Expected**:
- [ ] "ไม่พบข้อมูล" message shown
- [ ] No errors in console

**✅ PASS / ❌ FAIL**: ___________

### Edge Case 2: Single-SKU Order
1. Find a manual order (starts with "MAN-") or single-SKU imported order
2. View in Order View

**Expected**:
- [ ] Shows 1 row (same as Line View)
- [ ] Total Units = quantity of single SKU
- [ ] SKU count = 1

**✅ PASS / ❌ FAIL**: ___________

### Edge Case 3: Cancelled Order
1. Find or create a cancelled order
2. Check summary cards

**Expected**:
- [ ] Excluded from "Revenue (Paid)" metric
- [ ] Included in "Cancelled Orders" count
- [ ] Shows in table with cancelled status badge

**✅ PASS / ❌ FAIL**: ___________

---

## Regression Tests

### Regression 1: Add Manual Order
1. Click "Add Order" button
2. Fill form, submit
3. Check Order View and Line View

**Expected**:
- [ ] New order appears in both views
- [ ] Summary cards update correctly

**✅ PASS / ❌ FAIL**: ___________

### Regression 2: Edit Order (Line View)
1. Switch to Line View
2. Click "Edit" on a line
3. Change quantity, save
4. Check Order View

**Expected**:
- [ ] Total Units updated in Order View
- [ ] Summary cards recalculated

**✅ PASS / ❌ FAIL**: ___________

### Regression 3: Delete Order (Line View)
1. Switch to Line View
2. Delete one line of multi-SKU order
3. Check Order View

**Expected**:
- [ ] Order still appears (if other lines exist)
- [ ] Total Units decremented
- [ ] If last line deleted, order disappears from Order View

**✅ PASS / ❌ FAIL**: ___________

---

## Known Issues & Workarounds

| Issue | Severity | Workaround | Status |
|-------|----------|------------|--------|
| Edit/Delete disabled in Order View | EXPECTED | Use Line View for editing | N/A |
| Slow with 500+ orders | LOW | Add pagination, limit results | Monitor |
| Search by product in Order View fetches all lines | LOW | Acceptable for MVP | Monitor |

---

## Test Summary

**Total Tests**: 13
**Passed**: _____ / 13
**Failed**: _____ / 13
**Blocked**: _____ / 13

**Critical Bugs Found**: _____
- Bug 1: _______________________________
- Bug 2: _______________________________

**Ready for Production**: [ ] YES / [ ] NO

**Tester Signature**: _______________
**Date**: _______________

**Reviewer Signature**: _______________
**Date**: _______________

---

## Appendix: Console Checks

Open browser DevTools Console (F12) and verify:

1. No TypeScript errors:
```
// Should see:
✓ Compiled successfully
```

2. No Supabase RLS errors:
```
// Should NOT see:
❌ row-level security policy
❌ permission denied
```

3. Correct API calls:
```
// Order View should call:
✓ getSalesOrdersGrouped
✓ getSalesAggregates (with dateBasis)

// Line View should call:
✓ Supabase query to sales_orders
✓ getSalesAggregates (with dateBasis)
```

4. Performance logs (optional):
```javascript
// Check console for:
[Sales Pagination Debug] Query params: { view: 'order', ... }
[getSalesOrdersGrouped] Grouped 100 lines into 75 orders
```

---

## Cleanup

After testing, you may want to remove test data:

```sql
-- Delete test order
DELETE FROM sales_orders
WHERE external_order_id = '999TEST';
```

**⚠️ WARNING**: Only run in test environment, never in production!
