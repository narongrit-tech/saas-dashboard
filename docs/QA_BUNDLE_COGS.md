# QA Checklist: Bundle COGS Auto-Explode

**Feature:** Auto-explode Bundle SKU for Inventory + COGS (FIFO)
**Date:** 2026-02-01
**Tester:** _______________

## ⚠️ IMPORTANT NOTES

**How Bundle COGS Works:**
1. When applying COGS for a bundle order, the system:
   - Detects that the SKU is a bundle (is_bundle = true)
   - Loads component SKUs from `inventory_bundle_components`
   - Allocates inventory for EACH component SKU (not the bundle SKU itself)
   - Creates separate COGS allocations for each component
   - Decreases `qty_remaining` in receipt layers for each component

2. Bundle SKU itself **NEVER** consumes inventory
   - Only component SKUs consume inventory
   - Bundle is a virtual grouping only

3. Stock requirements:
   - Each component must have sufficient stock
   - If ANY component lacks stock, the entire allocation fails

## Prerequisites

- [ ] Bundle SKU exists in inventory_items (e.g., `#0007`)
- [ ] Bundle has `is_bundle = true`
- [ ] Bundle components defined in `inventory_bundle_components`:
  ```sql
  SELECT * FROM inventory_bundle_components WHERE bundle_sku = '#0007';
  -- Expected:
  -- #0007 | NEWONN001 | 1
  -- #0007 | NEWONN002 | 1
  ```
- [ ] Component SKUs have receipt layers with stock:
  ```sql
  SELECT sku_internal, SUM(qty_remaining) as on_hand
  FROM inventory_receipt_layers
  WHERE sku_internal IN ('NEWONN001', 'NEWONN002')
    AND COALESCE(is_voided, false) = false
  GROUP BY sku_internal;
  -- Expected: both have on_hand > 0
  ```

## Test Cases

### TC-001: Bundle COGS Happy Path ✅

**Scenario:** Bundle order with sufficient component stock

**Setup:**
```sql
-- Ensure components have stock
-- NEWONN001: at least 10 units
-- NEWONN002: at least 10 units

-- Check current stock
SELECT sku_internal, SUM(qty_remaining) as on_hand
FROM inventory_receipt_layers
WHERE sku_internal IN ('NEWONN001', 'NEWONN002')
  AND COALESCE(is_voided, false) = false
GROUP BY sku_internal;
```

**Steps:**
1. Create sales order:
   - order_id: 'BUNDLE-TEST-001'
   - seller_sku: '#0007' (bundle)
   - quantity: 10
   - shipped_at: '2026-02-01T10:00:00+07:00'
   - status: 'Shipped' or equivalent

2. Navigate to `/inventory`
3. Click **Admin Actions** → **Apply COGS (MTD)**
4. Wait for completion

**Expected Results:**
- [ ] Success toast: "COGS applied for X orders"
- [ ] No errors in console
- [ ] Order BUNDLE-TEST-001 processed successfully

**Verify in DB:**
```sql
-- 1) Check allocations created for COMPONENTS (not bundle!)
SELECT order_id, sku_internal, qty, unit_cost_used, amount, layer_id
FROM inventory_cogs_allocations
WHERE order_id = 'BUNDLE-TEST-001'
  AND is_reversal = false
ORDER BY sku_internal;

-- Expected: 2 rows
-- BUNDLE-TEST-001 | NEWONN001 | 10 | XX.XX | XXX.XX | <layer_id>
-- BUNDLE-TEST-001 | NEWONN002 | 10 | XX.XX | XXX.XX | <layer_id>

-- 2) Check receipt layers qty_remaining decreased
SELECT sku_internal, id, qty_received, qty_remaining, unit_cost
FROM inventory_receipt_layers
WHERE sku_internal IN ('NEWONN001', 'NEWONN002')
  AND COALESCE(is_voided, false) = false
ORDER BY sku_internal, received_at;

-- Expected: qty_remaining decreased by 10 for each SKU

-- 3) Check total COGS
SELECT SUM(amount) as total_cogs
FROM inventory_cogs_allocations
WHERE order_id = 'BUNDLE-TEST-001'
  AND is_reversal = false;

-- Expected: Sum of both component costs
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-002: Bundle Component Insufficient Stock ❌

**Scenario:** One component has insufficient stock

**Setup:**
```sql
-- Ensure NEWONN002 has LESS than required stock
-- Example: Bundle qty = 10, but NEWONN002 only has 5 units available

UPDATE inventory_receipt_layers
SET qty_remaining = 5
WHERE sku_internal = 'NEWONN002'
  AND COALESCE(is_voided, false) = false;
```

**Steps:**
1. Create sales order:
   - order_id: 'BUNDLE-TEST-002'
   - seller_sku: '#0007'
   - quantity: 10 (requires 10 of each component)
   - shipped_at: '2026-02-01T11:00:00+07:00'

2. Apply COGS (MTD)

**Expected Results:**
- [ ] Apply COGS fails for this order
- [ ] Error in modal/summary includes component SKU name
- [ ] Error message like: "Insufficient stock for component SKU NEWONN002"
- [ ] NO allocations created

**Verify in DB:**
```sql
-- Should have NO allocations for this order
SELECT COUNT(*) as allocation_count
FROM inventory_cogs_allocations
WHERE order_id = 'BUNDLE-TEST-002';

-- Expected: 0

-- Check that qty_remaining was NOT changed
SELECT sku_internal, SUM(qty_remaining) as on_hand
FROM inventory_receipt_layers
WHERE sku_internal IN ('NEWONN001', 'NEWONN002')
  AND COALESCE(is_voided, false) = false
GROUP BY sku_internal;

-- Expected: Same as before (no decrease)
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-003: Bundle Without Components ❌

**Scenario:** Bundle has no components defined

**Setup:**
```sql
-- Delete components for test bundle
DELETE FROM inventory_bundle_components WHERE bundle_sku = '#0007';

-- Verify empty
SELECT COUNT(*) FROM inventory_bundle_components WHERE bundle_sku = '#0007';
-- Expected: 0
```

**Steps:**
1. Create sales order with bundle_sku = '#0007'
2. Apply COGS (MTD)

**Expected Results:**
- [ ] Apply COGS fails
- [ ] Error: "Bundle #0007 has no components defined"
- [ ] NO allocations created

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-004: Idempotency - Prevent Double Allocation ✅

**Scenario:** Applying COGS twice for same bundle order

**Steps:**
1. Create sales order:
   - order_id: 'BUNDLE-TEST-004'
   - seller_sku: '#0007'
   - quantity: 5

2. Apply COGS (MTD) → Should succeed
3. Apply COGS (MTD) again → Should skip (idempotent)

**Expected Results:**
- [ ] First run: Allocations created
- [ ] Second run: Skipped with message "COGS already allocated"
- [ ] Only 2 allocations exist (one per component, not doubled)

**Verify in DB:**
```sql
SELECT sku_internal, COUNT(*) as allocation_count, SUM(qty) as total_qty
FROM inventory_cogs_allocations
WHERE order_id = 'BUNDLE-TEST-004'
  AND is_reversal = false
GROUP BY sku_internal;

-- Expected:
-- NEWONN001 | 1 | 5
-- NEWONN002 | 1 | 5
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-005: Multi-Bundle Orders (Batch) ✅

**Scenario:** Multiple bundle orders in same batch

**Steps:**
1. Create 3 sales orders:
   - BUNDLE-TEST-005A: '#0007' qty=2
   - BUNDLE-TEST-005B: '#0007' qty=3
   - BUNDLE-TEST-005C: '#0007' qty=1

2. Apply COGS (MTD)

**Expected Results:**
- [ ] All 3 orders processed successfully
- [ ] 6 allocations created total (2 per order)

**Verify in DB:**
```sql
-- Check all orders
SELECT order_id, sku_internal, SUM(qty) as total_qty
FROM inventory_cogs_allocations
WHERE order_id IN ('BUNDLE-TEST-005A', 'BUNDLE-TEST-005B', 'BUNDLE-TEST-005C')
  AND is_reversal = false
GROUP BY order_id, sku_internal
ORDER BY order_id, sku_internal;

-- Expected:
-- BUNDLE-TEST-005A | NEWONN001 | 2
-- BUNDLE-TEST-005A | NEWONN002 | 2
-- BUNDLE-TEST-005B | NEWONN001 | 3
-- BUNDLE-TEST-005B | NEWONN002 | 3
-- BUNDLE-TEST-005C | NEWONN001 | 1
-- BUNDLE-TEST-005C | NEWONN002 | 1

-- Check total component consumption
SELECT sku_internal, SUM(qty) as total_consumed
FROM inventory_cogs_allocations
WHERE order_id IN ('BUNDLE-TEST-005A', 'BUNDLE-TEST-005B', 'BUNDLE-TEST-005C')
  AND is_reversal = false
GROUP BY sku_internal;

-- Expected:
-- NEWONN001 | 6 (2+3+1)
-- NEWONN002 | 6 (2+3+1)
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-006: FIFO Layer Ordering ✅

**Scenario:** Components consumed from oldest layers first

**Setup:**
```sql
-- Create multiple layers for NEWONN001 with different dates and costs
INSERT INTO inventory_receipt_layers (sku_internal, received_at, qty_received, qty_remaining, unit_cost, ref_type)
VALUES
  ('NEWONN001', '2026-01-01T00:00:00+07:00', 10, 10, 40.00, 'STOCK_IN'),
  ('NEWONN001', '2026-01-15T00:00:00+07:00', 10, 10, 45.00, 'STOCK_IN'),
  ('NEWONN001', '2026-02-01T00:00:00+07:00', 10, 10, 50.00, 'STOCK_IN');
```

**Steps:**
1. Create bundle order requiring 15 units of NEWONN001
2. Apply COGS (FIFO)

**Expected Results:**
- [ ] First layer (2026-01-01, cost 40.00) fully consumed: qty_remaining = 0
- [ ] Second layer (2026-01-15, cost 45.00) partially consumed: qty_remaining = 5
- [ ] Third layer (2026-02-01, cost 50.00) untouched: qty_remaining = 10

**Verify in DB:**
```sql
SELECT received_at, unit_cost, qty_received, qty_remaining
FROM inventory_receipt_layers
WHERE sku_internal = 'NEWONN001'
  AND COALESCE(is_voided, false) = false
ORDER BY received_at;

-- Expected consumption pattern (oldest first):
-- 2026-01-01 | 40.00 | 10 | 0  (fully consumed)
-- 2026-01-15 | 45.00 | 10 | 5  (5 consumed)
-- 2026-02-01 | 50.00 | 10 | 10 (untouched)
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-007: Bundle + Regular SKU Mix ✅

**Scenario:** Some orders are bundles, some are regular SKUs

**Steps:**
1. Create orders:
   - Order A: seller_sku = '#0007' (bundle), qty = 2
   - Order B: seller_sku = 'NEWONN001' (regular), qty = 5
   - Order C: seller_sku = '#0007' (bundle), qty = 1

2. Apply COGS (MTD)

**Expected Results:**
- [ ] All orders processed
- [ ] Order A: 2 allocations (components)
- [ ] Order B: 1 allocation (regular SKU)
- [ ] Order C: 2 allocations (components)

**Verify in DB:**
```sql
SELECT order_id, sku_internal, qty
FROM inventory_cogs_allocations
WHERE order_id IN ('ORDER-A', 'ORDER-B', 'ORDER-C')
  AND is_reversal = false
ORDER BY order_id, sku_internal;

-- Expected pattern:
-- ORDER-A | NEWONN001 | 2
-- ORDER-A | NEWONN002 | 2
-- ORDER-B | NEWONN001 | 5
-- ORDER-C | NEWONN001 | 1
-- ORDER-C | NEWONN002 | 1
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

## Regression Tests

### RT-001: Regular (Non-Bundle) SKU Still Works ✅

**Steps:**
1. Create order with regular SKU (NEWONN001)
2. Apply COGS

**Expected:**
- [ ] Works exactly as before
- [ ] No bundle logic triggered
- [ ] Direct allocation to NEWONN001

**Result:** PASS / FAIL

---

### RT-002: Opening Balance Unchanged ✅

**Steps:**
1. Add opening balance for new SKU
2. Verify receipt layer created

**Expected:**
- [ ] Opening balance functionality unchanged
- [ ] ref_type = 'OPENING_BALANCE'

**Result:** PASS / FAIL

---

### RT-003: Stock In Unchanged ✅

**Steps:**
1. Stock In for component SKU
2. Verify document + layer created

**Expected:**
- [ ] Stock In functionality unchanged
- [ ] ref_type = 'STOCK_IN'

**Result:** PASS / FAIL

---

## Edge Cases

### EC-001: Bundle with Fractional Component Quantity

**Scenario:** Bundle component quantity is 0.5 (half unit)

**Setup:**
```sql
UPDATE inventory_bundle_components
SET quantity = 0.5
WHERE bundle_sku = '#0007' AND component_sku = 'NEWONN002';
```

**Steps:**
1. Create bundle order qty = 10
2. Apply COGS

**Expected:**
- [ ] NEWONN001: allocate 10 units (1 * 10)
- [ ] NEWONN002: allocate 5 units (0.5 * 10)

**Result:** PASS / FAIL

---

### EC-002: Component Voided Layer Skipped

**Scenario:** Component has voided layer (should be skipped)

**Setup:**
```sql
UPDATE inventory_receipt_layers
SET is_voided = true
WHERE sku_internal = 'NEWONN001'
  AND received_at = '2026-01-01T00:00:00+07:00';
```

**Steps:**
1. Apply COGS for bundle

**Expected:**
- [ ] Voided layer NOT used
- [ ] Only non-voided layers consumed

**Result:** PASS / FAIL

---

## Performance Tests

### PT-001: Large Bundle Order ⚡

**Steps:**
1. Create bundle order qty = 1000
2. Measure Apply COGS execution time

**Expected:**
- [ ] Completes within 5 seconds
- [ ] No timeout errors

**Time:** ___ seconds
**Result:** PASS / FAIL

---

## Summary

**Total Test Cases:** 13
**Passed:** ___
**Failed:** ___
**Blocked:** ___

**Critical Issues Found:**
- _______________________________________________
- _______________________________________________

**Sign-off:**
- [ ] All critical test cases passed
- [ ] Bundle COGS works correctly
- [ ] No regression in regular SKU COGS
- [ ] Ready for production

**Tester Signature:** _______________ **Date:** _______________
**Reviewer Signature:** _______________ **Date:** _______________
