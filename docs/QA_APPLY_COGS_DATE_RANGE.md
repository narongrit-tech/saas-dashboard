# QA Checklist: Apply COGS (Date Range)

**Feature:** Date Range Selector for Apply COGS with Pagination
**Date:** 2026-02-01
**Tester:** _______________

## Overview

**What Changed:**
- Apply COGS modal now accepts custom date range (Start Date → End Date)
- Default: first day of current month → today
- Quick presets: "This Month", "Last Month"
- Pagination support: processes ALL orders in range (no truncation)
- Batch processing: 1000 orders per page, up to 100k total

**Why:**
- Users need to run COGS for historical ranges beyond current month
- Large datasets (>1000 orders) require pagination to prevent query limits
- Flexibility to re-run COGS for specific periods

## Prerequisites

- [ ] User has admin role in user_roles table
- [ ] Sales orders exist with `shipped_at` timestamps
- [ ] Some orders have `seller_sku` and `quantity > 0`
- [ ] Some orders may already have COGS allocations (for idempotency tests)

## Test Cases

### TC-001: Date Range UI - Default Values ✅

**Scenario:** Open modal, check default date range

**Steps:**
1. Navigate to `/sales`
2. Click "Apply COGS" button
3. Observe date inputs

**Expected Results:**
- [ ] Start Date: First day of current month (e.g., 2026-02-01)
- [ ] End Date: Today's date (e.g., 2026-02-01)
- [ ] Both inputs populated automatically
- [ ] Date format: YYYY-MM-DD

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-002: Quick Preset - This Month ✅

**Scenario:** Use "This Month" preset button

**Steps:**
1. Open Apply COGS modal
2. Click "เดือนนี้" (This Month) button

**Expected Results:**
- [ ] Start Date updates to: 2026-02-01 (first day of current month)
- [ ] End Date updates to: 2026-02-01 (today)
- [ ] Both dates reflect Bangkok timezone

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-003: Quick Preset - Last Month ✅

**Scenario:** Use "Last Month" preset button

**Steps:**
1. Open Apply COGS modal
2. Click "เดือนที่แล้ว" (Last Month) button

**Expected Results:**
- [ ] Start Date updates to: 2026-01-01 (first day of last month)
- [ ] End Date updates to: 2026-01-31 (last day of last month)
- [ ] Dates calculated correctly for Bangkok timezone

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-004: Custom Date Range ✅

**Scenario:** User selects custom date range

**Steps:**
1. Open Apply COGS modal
2. Set Start Date: 2026-01-15
3. Set End Date: 2026-01-20

**Expected Results:**
- [ ] Inputs accept manual dates
- [ ] Date summary displays: "ช่วงวันที่: 2026-01-15 ถึง 2026-01-20"
- [ ] Apply button enabled

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-005: Validation - Start > End ❌

**Scenario:** Start date is after end date

**Steps:**
1. Set Start Date: 2026-01-31
2. Set End Date: 2026-01-15
3. Click "Apply COGS"

**Expected Results:**
- [ ] Error message: "วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด"
- [ ] No processing occurs
- [ ] Modal stays open

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-006: Validation - Empty Dates ❌

**Scenario:** User clears date inputs

**Steps:**
1. Clear Start Date input
2. Clear End Date input
3. Attempt to click "Apply COGS"

**Expected Results:**
- [ ] Apply button disabled OR
- [ ] Error message: "กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด"

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-007: Small Range (1 Day) - Happy Path ✅

**Scenario:** Apply COGS for single day with few orders

**Setup:**
```sql
-- Create 10 test orders for 2026-01-15
INSERT INTO sales_orders (order_id, seller_sku, quantity, shipped_at, status_group)
VALUES
  ('TEST001', 'NEWONN001', 1, '2026-01-15T10:00:00+07:00', 'จัดส่งสำเร็จ'),
  ('TEST002', 'NEWONN002', 2, '2026-01-15T11:00:00+07:00', 'จัดส่งสำเร็จ'),
  ...
```

**Steps:**
1. Set date range: 2026-01-15 to 2026-01-15
2. Click "Apply COGS"
3. Wait for processing

**Expected Results:**
- [ ] Processing completes successfully
- [ ] Result shows:
  - Total Orders: 10 (all shipped orders in range)
  - Eligible: 10 (not cancelled, has SKU, qty>0, not allocated)
  - Successful: 10
  - Skipped: 0
  - Failed: 0

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-008: Large Range (Full Month) ✅

**Scenario:** Apply COGS for entire month (possibly >1000 orders)

**Steps:**
1. Set date range: 2026-01-01 to 2026-01-31
2. Click "Apply COGS"
3. Monitor console logs for pagination

**Expected Results:**
- [ ] Console shows multiple pages fetched:
  - "Fetching orders page 1 (0-999)"
  - "Fetching orders page 2 (1000-1999)"
  - etc.
- [ ] Total Orders matches actual shipped count
- [ ] No truncation (all orders processed)
- [ ] Processing completes within reasonable time (<30 seconds for 5000 orders)

**Time:** ___ seconds for ___ orders
**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-009: Pagination - Exact 1000 Orders ✅

**Scenario:** Test pagination boundary (exactly 1000 orders)

**Setup:**
- Ensure exactly 1000 shipped orders exist for 2026-01-20

**Steps:**
1. Set date range: 2026-01-20 to 2026-01-20
2. Apply COGS
3. Check console logs

**Expected Results:**
- [ ] Page 1 fetches 1000 orders
- [ ] Page 2 fetches 0 orders (stops pagination)
- [ ] Total: 1000 orders processed

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-010: Pagination - 1001 Orders ✅

**Scenario:** Test pagination crosses page boundary

**Setup:**
- Ensure 1001 shipped orders exist for 2026-01-21

**Steps:**
1. Set date range: 2026-01-21 to 2026-01-21
2. Apply COGS

**Expected Results:**
- [ ] Page 1: 1000 orders
- [ ] Page 2: 1 order
- [ ] Total: 1001 orders processed
- [ ] No orders missed

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-011: Idempotency - Already Allocated ✅

**Scenario:** Run Apply COGS twice for same range

**Steps:**
1. Set date range: 2026-01-10 to 2026-01-10
2. Apply COGS (first time)
3. Note "Successful" count
4. Apply COGS again (second time)

**Expected Results:**
- [ ] First run: All eligible orders get allocations
- [ ] Second run:
  - Total Orders: same count
  - Eligible: 0 (all already allocated)
  - Skipped: equals first run's "Successful"
  - Errors show: `reason: already_allocated`

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-012: Skip Cancelled Orders ✅

**Scenario:** Cancelled orders should be excluded

**Setup:**
```sql
UPDATE sales_orders
SET status_group = 'ยกเลิกแล้ว'
WHERE order_id = 'TEST001';
```

**Steps:**
1. Apply COGS for range containing TEST001

**Expected Results:**
- [ ] TEST001 NOT included in total count
- [ ] Only non-cancelled orders processed

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-013: Skip Missing SKU ✅

**Scenario:** Orders without seller_sku should be skipped

**Setup:**
```sql
UPDATE sales_orders
SET seller_sku = NULL
WHERE order_id = 'TEST002';
```

**Steps:**
1. Apply COGS for range

**Expected Results:**
- [ ] TEST002 counted in Total
- [ ] TEST002 skipped (not eligible)
- [ ] Error: `reason: missing_seller_sku`

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-014: Skip Invalid Quantity ✅

**Scenario:** Orders with qty <= 0 should be skipped

**Setup:**
```sql
UPDATE sales_orders
SET quantity = 0
WHERE order_id = 'TEST003';
```

**Steps:**
1. Apply COGS for range

**Expected Results:**
- [ ] TEST003 counted in Total
- [ ] TEST003 skipped
- [ ] Error: `reason: invalid_quantity_0`

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-015: Bundle Orders Auto-Explode ✅

**Scenario:** Bundle SKU orders consume component inventory

**Setup:**
- Order with seller_sku = '#0007' (bundle)
- Bundle components: NEWONN001 + NEWONN002
- Sufficient component stock

**Steps:**
1. Apply COGS for range containing bundle order

**Expected Results:**
- [ ] Bundle order processed successfully
- [ ] COGS allocations created for BOTH components:
  - NEWONN001: allocation created
  - NEWONN002: allocation created
- [ ] Component inventory consumed (qty_remaining decreased)

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-016: Insufficient Stock Handling ❌

**Scenario:** Order qty > available stock

**Setup:**
- Order: 100 units of NEWONN001
- Stock: only 50 units available

**Steps:**
1. Apply COGS

**Expected Results:**
- [ ] Order marked as Failed
- [ ] Error reason contains: "Insufficient stock"
- [ ] Qty needed/available shown in console

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-017: Result Summary Accuracy ✅

**Scenario:** Verify all counts add up correctly

**Setup:**
- 100 total shipped orders in range
- 10 already allocated
- 5 cancelled
- 3 missing SKU
- 2 invalid qty
- 80 eligible

**Steps:**
1. Apply COGS

**Expected Results:**
- [ ] Total: 90 (100 - 10 already - 5 cancelled + 5 cancelled already)
- [ ] Wait, recalculate:
  - Query fetches only non-cancelled: 95 orders
  - Total: 95
  - Already allocated: 10 → Skipped
  - Missing SKU: 3 → Skipped
  - Invalid qty: 2 → Skipped
  - Eligible: 95 - 10 - 3 - 2 = 80
  - Successful: 80 (assuming stock available)
- [ ] Eligible + Skipped = Total - Cancelled
- [ ] Successful + Failed ≤ Eligible

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-018: Bangkok Timezone Correctness ✅

**Scenario:** Verify dates use Bangkok timezone

**Setup:**
- Current Bangkok time: 2026-02-01 01:00:00+07:00 (after midnight UTC)
- UTC time: 2026-01-31 18:00:00

**Steps:**
1. Open modal at this time
2. Check default "End Date"

**Expected Results:**
- [ ] End Date shows: 2026-02-01 (Bangkok date)
- [ ] NOT 2026-01-31 (UTC date)

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-019: Performance - 5000 Orders ⚡

**Scenario:** Measure performance for large batch

**Setup:**
- 5000 shipped orders in January

**Steps:**
1. Set range: 2026-01-01 to 2026-01-31
2. Start timer
3. Apply COGS
4. Stop timer when modal shows result

**Expected Results:**
- [ ] Completes within 60 seconds
- [ ] All 5000 orders processed
- [ ] Console shows ~5 pages fetched
- [ ] UI remains responsive

**Time:** ___ seconds
**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-020: Error Handling - Database Timeout ❌

**Scenario:** Simulate database connection issue

**Steps:**
1. (Manually cause DB timeout if possible)
2. Apply COGS

**Expected Results:**
- [ ] Error message displayed
- [ ] Modal stays open
- [ ] User can retry
- [ ] No partial COGS created

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-021: Error List Display ✅

**Scenario:** Verify error details shown in modal

**Setup:**
- Mix of skipped/failed orders

**Steps:**
1. Apply COGS
2. Scroll to "Errors/Skipped Details" section

**Expected Results:**
- [ ] Section shows count: "Errors/Skipped Details (X)"
- [ ] Each error shows:
  - Order ID (e.g., TEST001)
  - Reason badge (e.g., "already_allocated")
- [ ] Scrollable if many errors
- [ ] Max height: 200px with overflow

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-022: Admin-Only Access 🔒

**Scenario:** Non-admin users cannot access

**Setup:**
- Login as user WITHOUT admin role

**Steps:**
1. Navigate to /sales
2. Look for "Apply COGS" button

**Expected Results:**
- [ ] Button NOT visible OR
- [ ] Button visible but clicking returns error:
  - "ไม่มีสิทธิ์เข้าถึงฟังก์ชันนี้ (Admin only)"

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-023: Date Range Display in Modal Header ✅

**Scenario:** Verify selected range shown in modal

**Steps:**
1. Set range: 2026-01-10 to 2026-01-20
2. Observe modal content

**Expected Results:**
- [ ] Text shows: "ช่วงวันที่: 2026-01-10 ถึง 2026-01-20"
- [ ] Updates when preset buttons clicked

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-024: Modal Close Behavior ✅

**Scenario:** Modal state resets on close

**Steps:**
1. Set custom date range
2. Click "Apply COGS"
3. Close modal
4. Reopen modal

**Expected Results:**
- [ ] Date range resets to defaults (This Month)
- [ ] Result cleared
- [ ] Error cleared
- [ ] Fresh state

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-025: Loading State ✅

**Scenario:** UI shows loading during processing

**Steps:**
1. Apply COGS for large range
2. Observe UI while processing

**Expected Results:**
- [ ] "Apply COGS" button shows spinner icon
- [ ] Button text: "กำลังประมวลผล..."
- [ ] Button disabled during processing
- [ ] Date inputs disabled
- [ ] Preset buttons disabled

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

## Edge Cases

### EC-001: Zero Orders in Range ✅

**Scenario:** No shipped orders in selected range

**Steps:**
1. Set range with no orders (e.g., 2025-12-01 to 2025-12-01)
2. Apply COGS

**Expected Results:**
- [ ] Success message
- [ ] Total: 0
- [ ] Message: "ไม่มี orders ที่ shipped ในช่วง 2025-12-01 ถึง 2025-12-01"

**Result:** PASS / FAIL

---

### EC-002: Far Future Date ✅

**Scenario:** End date in future

**Steps:**
1. Set range: 2026-02-01 to 2026-12-31
2. Apply COGS

**Expected Results:**
- [ ] Works correctly
- [ ] Only processes orders shipped up to current date
- [ ] No errors

**Result:** PASS / FAIL

---

### EC-003: Very Old Date Range ✅

**Scenario:** Historical range (e.g., 2020)

**Steps:**
1. Set range: 2020-01-01 to 2020-12-31

**Expected Results:**
- [ ] Fetches old orders if they exist
- [ ] OR returns 0 orders if none exist
- [ ] No errors

**Result:** PASS / FAIL

---

### EC-004: Same Start/End Date ✅

**Scenario:** Single day range

**Steps:**
1. Set Start = End = 2026-01-15

**Expected Results:**
- [ ] Valid (start <= end)
- [ ] Processes orders from that single day

**Result:** PASS / FAIL

---

### EC-005: Leap Year Handling ✅

**Scenario:** Date range includes Feb 29 (leap year)

**Steps:**
1. (If applicable) Set range: 2024-02-28 to 2024-03-01

**Expected Results:**
- [ ] Correctly handles Feb 29, 2024
- [ ] All orders in range processed

**Result:** PASS / FAIL

---

## Regression Tests

### RT-001: Existing Functionality Unchanged ✅

**Steps:**
1. Test all other inventory features:
   - Stock In
   - Opening Balance
   - Bundles
   - Movements

**Expected Results:**
- [ ] All features work as before
- [ ] No regressions introduced

**Result:** PASS / FAIL

---

### RT-002: Sales Page Unaffected ✅

**Steps:**
1. Test sales order CRUD
2. Import/Export
3. Filtering

**Expected Results:**
- [ ] All sales features work normally
- [ ] Apply COGS button integrated smoothly

**Result:** PASS / FAIL

---

## SQL Verification Queries

### Verify Total Orders Count

```sql
-- Count shipped orders in range (matches UI "Total")
SELECT COUNT(*) as total_shipped
FROM sales_orders
WHERE shipped_at IS NOT NULL
  AND status_group != 'ยกเลิกแล้ว'
  AND shipped_at >= '2026-01-01T00:00:00+07:00'
  AND shipped_at <= '2026-01-31T23:59:59+07:00';
```

### Verify Eligible Count

```sql
-- Count eligible orders (not allocated, has SKU, qty>0)
SELECT COUNT(*) as eligible
FROM sales_orders o
WHERE shipped_at IS NOT NULL
  AND status_group != 'ยกเลิกแล้ว'
  AND shipped_at >= '2026-01-01T00:00:00+07:00'
  AND shipped_at <= '2026-01-31T23:59:59+07:00'
  AND seller_sku IS NOT NULL
  AND seller_sku != ''
  AND quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM inventory_cogs_allocations a
    WHERE a.order_id = o.order_id
      AND a.is_reversal = false
  );
```

### Verify Allocations Created

```sql
-- Check COGS allocations for date range
SELECT
  DATE(allocated_at) as date,
  COUNT(*) as allocations,
  SUM(quantity_allocated) as total_qty,
  SUM(cost_allocated) as total_cost
FROM inventory_cogs_allocations
WHERE allocated_at >= '2026-01-01'
  AND allocated_at <= '2026-01-31'
  AND is_reversal = false
GROUP BY DATE(allocated_at)
ORDER BY date;
```

---

## Summary

**Total Test Cases:** 25 + 5 Edge Cases + 2 Regression = 32
**Passed:** ___
**Failed:** ___
**Blocked:** ___

**Critical Issues Found:**
- _______________________________________________
- _______________________________________________

**Minor Issues Found:**
- _______________________________________________
- _______________________________________________

**Performance Metrics:**
- Small range (1 day, 10 orders): ___ seconds
- Medium range (1 week, 500 orders): ___ seconds
- Large range (1 month, 5000 orders): ___ seconds

**Sign-off:**
- [ ] All critical test cases passed
- [ ] Date range selector works correctly
- [ ] Pagination prevents truncation (tested >1000 orders)
- [ ] Idempotency verified (no duplicate allocations)
- [ ] Bundle auto-explode still works
- [ ] Performance acceptable for large ranges
- [ ] Ready for production

**Tester Signature:** _______________ **Date:** _______________
**Reviewer Signature:** _______________ **Date:** _______________

---

## Appendix: Known Behaviors

### Pagination Logic
- Page size: 1000 orders
- Max pages: 100 (100,000 orders total)
- Ordering: shipped_at ASC, order_id ASC (deterministic)

### Date Range Defaults
- Start: First day of current month (Bangkok timezone)
- End: Today (Bangkok timezone)

### Skipped Reasons
- `already_allocated`: Order already has COGS allocation
- `missing_seller_sku`: seller_sku is NULL or empty
- `invalid_quantity_X`: quantity is NULL, 0, or negative
- `missing_shipped_at`: shipped_at is NULL (should not happen due to query filter)
- Custom errors from inventory costing (e.g., "Insufficient stock for SKU XXX")

### FIFO Allocation
- Uses existing `applyCOGSForOrderShippedCore` function
- Supports regular SKUs and bundle SKUs
- Idempotent: checks for existing allocations before creating

---

## Migration Impact

**Database Changes:** NONE (uses existing schema)
**Breaking Changes:** NONE (backward compatible - old MTD behavior preserved if no params)
**Dependencies:** Requires existing inventory costing system (migration-033+)

---

**Document Version:** 1.0
**Last Updated:** 2026-02-01
**Author:** Development Team
