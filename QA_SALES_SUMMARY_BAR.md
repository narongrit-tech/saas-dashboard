# QA Checklist - Sales Summary Bar (paid_at basis)

## Test Date: 2026-01-26
## Feature: Daily Sales Summary Bar on Sales Orders page

---

## Test 1: Default Load Shows Today

**Objective:** Verify default date range is Today (paid_at basis) and summary matches table

**Steps:**
1. Navigate to `/sales` page (fresh load, no URL params)
2. Check date range filter shows "Today" preset
3. Verify summary bar displays:
   - Revenue (Paid) card with net after cancel subtext
   - Orders card with cancelled orders subtext
   - Units (Qty), AOV, and Cancelled Amount cards
4. Manually count table rows and verify:
   - Order count matches "Orders" card
   - Sum of total_amount (excl cancelled) matches "Revenue (Paid)" card

**Expected:**
- Default date = Today (Bangkok timezone)
- Date filter based on paid_at column
- Summary metrics match visible table data
- No NaN or undefined values

**Result:** [ ] PASS / [ ] FAIL

**Notes:**
_______________________________________________________________________________

---

## Test 2: Preset Changes (Last 7 Days / MTD / Custom Range)

**Objective:** Verify summary and table update consistently when changing date presets

**Steps:**
1. Click "Last 7 Days" preset
2. Verify both summary and table update
3. Check summary metrics match new date range
4. Click "MTD" (Month to Date) preset
5. Verify again
6. Select custom date range (e.g., Jan 20-25)
7. Verify again

**Expected:**
- Both summary bar and table update instantly
- No drift between summary and table data
- Loading states show during fetch
- Metrics recalculate correctly

**Result:** [ ] PASS / [ ] FAIL

**Notes:**
_______________________________________________________________________________

---

## Test 3: Platform Filter (TikTok/Shopee/All)

**Objective:** Verify summary matches table when applying platform filter

**Steps:**
1. Set date range to "Last 7 Days"
2. Select "TikTok" platform filter
3. Verify summary shows only TikTok orders
4. Check table shows only TikTok rows
5. Switch to "Shopee" platform
6. Verify summary updates
7. Switch back to "All Platforms"

**Expected:**
- Summary filters by source_platform correctly
- Revenue/Orders/Units match filtered table
- Platform filter applies to both summary and table

**Result:** [ ] PASS / [ ] FAIL

**Notes:**
_______________________________________________________________________________

---

## Test 4: Status Filter (Multi-Select Checkboxes)

**Objective:** Verify summary respects platform_status multi-select filter

**Steps:**
1. Check "รอจัดส่ง" (pending) status only
2. Verify summary shows only pending orders
3. Check both "รอจัดส่ง" and "จัดส่งสำเร็จ" (delivered)
4. Verify summary includes both statuses
5. Uncheck all statuses
6. Verify summary shows all orders

**Expected:**
- Summary filters by platform_status (Thai values)
- Multi-select logic works correctly
- Empty selection = show all

**Result:** [ ] PASS / [ ] FAIL

**Notes:**
_______________________________________________________________________________

---

## Test 5: Payment Filter (Paid/Unpaid/All)

**Objective:** Verify summary respects payment_status filter

**Steps:**
1. Select "Paid" payment filter
2. Verify summary shows only paid orders
3. Select "Unpaid"
4. Verify summary shows only unpaid orders
5. Select "All"
6. Verify summary includes all payment statuses

**Expected:**
- Summary filters by payment_status
- Revenue metrics show correct amounts
- Payment filter applies to both summary and table

**Result:** [ ] PASS / [ ] FAIL

**Notes:**
_______________________________________________________________________________

---

## Test 6: Search by Order ID

**Objective:** Verify summary matches search results

**Steps:**
1. Enter order ID in search box (e.g., "MAN-20260126-001")
2. Wait for debounce (300ms)
3. Verify summary shows metrics for searched order only
4. Clear search
5. Verify summary returns to full dataset

**Expected:**
- Search filters by order_id, product_name, external_order_id
- Summary aggregates match search results
- Debounce prevents excessive queries

**Result:** [ ] PASS / [ ] FAIL

**Notes:**
_______________________________________________________________________________

---

## Test 7: Cancelled Orders Handling

**Objective:** Verify cancelled orders are excluded from main metrics but shown separately

**Steps:**
1. Find or create orders with platform_status containing "ยกเลิก"
2. Check summary bar:
   - Revenue (Paid): Should exclude cancelled orders
   - Orders: Should exclude cancelled orders
   - Units (Qty): Should exclude cancelled orders
   - Cancelled Amount: Should show sum of cancelled order amounts
   - Orders card subtext: Should show "Cancelled: N orders"

**Expected:**
- Cancelled detection: platform_status.toLowerCase().includes('ยกเลิก')
- Main metrics (revenue, orders, units) exclude cancelled
- Cancelled metrics shown separately
- Net after cancel = Revenue - Cancelled Amount

**Result:** [ ] PASS / [ ] FAIL

**Notes:**
_______________________________________________________________________________

---

## Test 8: AOV Calculation

**Objective:** Verify Average Order Value formula is correct

**Steps:**
1. Note values from summary:
   - Net Revenue (from "Revenue (Paid)" > "Net after cancel")
   - Orders (exclude cancelled)
   - AOV
2. Calculate manually: AOV = Net Revenue / Orders
3. Verify calculated AOV matches displayed AOV

**Edge Cases:**
- Zero orders: AOV should be 0 (not NaN or Infinity)
- Single order: AOV should equal net revenue

**Expected:**
- Formula: aov_net = net_after_cancel / orders_excl_cancel
- Divide by zero handled (returns 0)
- Rounded to 2 decimal places

**Result:** [ ] PASS / [ ] FAIL

**Notes:**
_______________________________________________________________________________

---

## Integration Test: CSV Export Verification

**Objective:** Manual verification that summary matches exported CSV totals

**Steps:**
1. Set filters: Today, All Platforms, All Statuses, Paid only
2. Note summary metrics:
   - Revenue (Paid): _______________
   - Orders: _______________
   - Units: _______________
3. Click "Export CSV"
4. Open CSV in Excel
5. Sum columns:
   - Total Amount (excl cancelled rows): _______________
   - Count rows (excl cancelled): _______________
   - Sum Quantity (excl cancelled): _______________
6. Compare with summary metrics

**Expected:**
- CSV export uses SAME filters as summary and table
- Manual Excel calculations match summary exactly
- Date basis: paid_at (not order_date)

**Result:** [ ] PASS / [ ] FAIL

**Notes:**
_______________________________________________________________________________

---

## Performance Test

**Objective:** Verify page loads quickly with summary bar

**Steps:**
1. Clear browser cache
2. Navigate to `/sales` (first load)
3. Measure time to interactive (all cards rendered)
4. Change filters (platform, status, date range)
5. Measure update time

**Expected:**
- Initial load: < 3 seconds
- Filter changes: < 1 second
- No UI blocking or freezing
- Skeleton loading states shown

**Result:** [ ] PASS / [ ] FAIL

**Notes:**
_______________________________________________________________________________

---

## Edge Cases

### Test 9A: No Data (Empty Result)
**Steps:**
1. Set date range to future date (e.g., 2030-01-01)
2. Verify summary shows zero metrics (not error)

**Expected:**
- All metrics = 0
- No NaN or undefined
- Table shows "ไม่พบข้อมูล"

**Result:** [ ] PASS / [ ] FAIL

---

### Test 9B: Large Dataset (Performance)
**Steps:**
1. Import 1000+ orders (via CSV import)
2. Set date range to include all orders
3. Verify summary calculates correctly

**Expected:**
- No timeout or memory errors
- Aggregates correct for large dataset
- Page responsive

**Result:** [ ] PASS / [ ] FAIL

---

### Test 9C: Missing paid_at Field
**Steps:**
1. Create manual order without paid_at date
2. Verify order does NOT appear in Today's summary (paid_at basis)
3. Order should appear when date filter is cleared

**Expected:**
- Orders without paid_at excluded from date-based queries
- No errors or null reference exceptions

**Result:** [ ] PASS / [ ] FAIL

---

## Regression Tests

### Test 10: Existing Features Still Work
**Objective:** Verify no breaking changes to existing functionality

**Checklist:**
- [ ] Add Order dialog still works
- [ ] Edit Order dialog still works
- [ ] Delete Order dialog still works
- [ ] Import CSV still works
- [ ] Export CSV still works
- [ ] Pagination still works
- [ ] Page size selector (20/50/100) still works
- [ ] Jump to page input still works

**Result:** [ ] PASS / [ ] FAIL

---

## Summary of Findings

**Total Tests:** 10
**Passed:** ___
**Failed:** ___

**Critical Issues:**
_______________________________________________________________________________

**Minor Issues:**
_______________________________________________________________________________

**Recommendations:**
_______________________________________________________________________________

---

## Sign-off

**Tested By:** _______________________
**Date:** _______________________
**Approved:** [ ] YES / [ ] NO (requires fixes)
