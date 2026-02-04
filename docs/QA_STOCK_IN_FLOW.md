# QA Checklist: Stock In Flow + SKU Canonicalization

**Feature:** Inventory Stock In
**Date:** 2026-02-01
**Migration:** 041 (updated from 040)
**Tester:** _______________

## ⚠️ IMPORTANT NOTE

**Receipt layers use sku_internal directly (NO item_id column)**

The `inventory_receipt_layers` table schema:
- ✅ Uses `sku_internal` (varchar) as the SKU reference
- ❌ Does NOT have `item_id` column
- ✅ Uses `ref_type = 'STOCK_IN'` for stock in transactions
- ✅ Uses `ref_id` to link to `inventory_stock_in_documents.id`

The `inventory_stock_in_documents` table schema:
- ✅ Has `item_id` (uuid) referencing `inventory_items.id`
- ✅ Has `quantity` (decimal) - must NOT be NULL
- ✅ Has `unit_cost` (decimal) - must NOT be NULL

## Prerequisites

- [ ] Migration 040 applied successfully
- [ ] Code deployed (actions.ts updated)
- [ ] At least one inventory item exists (NEWONN001 or NEWONN002)

## Test Cases

### TC-001: Stock In Happy Path ✅

**Steps:**
1. Navigate to `/inventory`
2. Click **Products** tab
3. Find SKU `NEWONN001`
4. Click **Stock In** button
5. Fill form:
   - Received At: `2026-02-01`
   - Quantity: `10`
   - Unit Cost: `50.00`
   - Reference: `QA-TEST-001`
   - Supplier: `Test Supplier Co.`
   - Note: `QA testing Stock In flow`
6. Click **Save**

**Expected:**
- [ ] Success toast appears
- [ ] Modal closes automatically
- [ ] No console errors
- [ ] Page refreshes (revalidation)

**Verify in DB:**
```sql
-- Check stock in document
SELECT id, item_id, quantity, unit_cost, reference, supplier, note
FROM inventory_stock_in_documents
WHERE reference = 'QA-TEST-001'
ORDER BY created_at DESC LIMIT 1;

-- Expected: item_id IS NOT NULL, quantity = 10, unit_cost = 50.00

-- Check receipt layer (uses sku_internal, NOT item_id!)
SELECT id, sku_internal, qty_received, qty_remaining, unit_cost, ref_type, ref_id
FROM inventory_receipt_layers
WHERE ref_type = 'STOCK_IN'
  AND sku_internal = 'NEWONN001'
ORDER BY received_at DESC LIMIT 1;

-- Expected: qty_received = 10, qty_remaining = 10, unit_cost = 50.00, ref_type = 'STOCK_IN'

-- Check on-hand (ALL layers for this SKU)
SELECT
  sku_internal,
  ref_type,
  qty_received,
  qty_remaining,
  unit_cost,
  received_at
FROM inventory_receipt_layers
WHERE sku_internal = 'NEWONN001'
  AND COALESCE(is_voided, false) = false
ORDER BY received_at;

-- Expected: Show OPENING_BALANCE + STOCK_IN layers

-- Check total on-hand
SELECT sku_internal, SUM(qty_remaining) as total_on_hand
FROM inventory_receipt_layers
WHERE sku_internal = 'NEWONN001'
  AND COALESCE(is_voided, false) = false
GROUP BY sku_internal;

-- Expected: total_on_hand = 10 + previous stock (e.g., 22 + 10 = 32 if opening balance was 22)
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-002: SKU Normalization (Lowercase + Spaces) ✅

**Steps:**
1. Stock In modal for `NEWONN001`
2. In form, manually type SKU as: ` newonn001 ` (lowercase + leading/trailing spaces)
3. Fill other fields
4. Click Save

**Expected:**
- [ ] Success (SKU normalized to `NEWONN001`)
- [ ] Receipt layer created with `sku_internal = 'NEWONN001'`

**Verify in DB:**
```sql
SELECT sku_internal FROM inventory_receipt_layers
WHERE ref_id = (SELECT id FROM inventory_stock_in_documents ORDER BY created_at DESC LIMIT 1)
LIMIT 1;

-- Expected: NEWONN001 (uppercase, trimmed)
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-003: Error - SKU Not Found ❌

**Steps:**
1. Stock In modal
2. Try to Stock In for SKU: `INVALID999`
3. Fill form and Save

**Expected:**
- [ ] Error message: `Inventory item not found: INVALID999`
- [ ] No database inserts
- [ ] Modal stays open

**Verify in DB:**
```sql
-- Should NOT create any rows
SELECT COUNT(*) FROM inventory_stock_in_documents
WHERE created_at > NOW() - INTERVAL '1 minute';

-- Expected: 0
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-004: Error - Bundle SKU Validation ❌

**Prerequisites:**
- Create a bundle SKU first:
  ```sql
  INSERT INTO inventory_items (sku_internal, product_name, base_cost_per_unit, is_bundle)
  VALUES ('BUNDLE-TEST', 'Test Bundle', 0, true);
  ```

**Steps:**
1. Stock In modal for `BUNDLE-TEST`
2. Fill form and Save

**Expected:**
- [ ] Error: `ไม่สามารถ Stock In สำหรับ Bundle SKU ได้`
- [ ] No database inserts

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-005: Error - Invalid Quantity ❌

**Steps:**
1. Stock In modal for `NEWONN001`
2. Enter Quantity: `0` (or negative)
3. Fill other fields and Save

**Expected:**
- [ ] Error: `Quantity ต้องมากกว่า 0`

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-006: Error - Invalid Unit Cost ❌

**Steps:**
1. Stock In modal for `NEWONN001`
2. Enter Unit Cost: `-10`
3. Fill other fields and Save

**Expected:**
- [ ] Error: `Unit cost ต้องไม่ติดลบ`

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-007: Error - Missing Reference ❌

**Steps:**
1. Stock In modal for `NEWONN001`
2. Leave Reference field empty
3. Fill other fields and Save

**Expected:**
- [ ] Error: `Reference จำเป็นต้องระบุ`

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-008: COGS Allocation Integration ✅

**Prerequisites:**
- Stock In completed (TC-001)
- Create a sales order for NEWONN001 (qty: 5, shipped_at: today)

**Steps:**
1. Navigate to `/inventory`
2. Click **Admin Actions** section
3. Click **Apply COGS (MTD)** button
4. Wait for success message

**Expected:**
- [ ] Success toast: `COGS applied for X orders`
- [ ] No errors in console
- [ ] No "No layers available" error

**Verify in DB:**
```sql
-- Check COGS allocation created
SELECT order_id, sku_internal, quantity, unit_cost, amount, layer_id
FROM inventory_cogs_allocations
WHERE sku_internal = 'NEWONN001'
  AND is_reversal = false
ORDER BY shipped_at DESC LIMIT 5;

-- Expected: 1 row with qty=5, unit_cost=50.00, amount=250.00

-- Check remaining inventory
SELECT sku_internal, SUM(qty_remaining) as on_hand
FROM inventory_receipt_layers
WHERE sku_internal = 'NEWONN001'
  AND is_voided = false
GROUP BY sku_internal;

-- Expected: on_hand = 5 (10 - 5 sold)
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-009: Multiple Stock Ins (Same SKU) ✅

**Steps:**
1. Stock In `NEWONN001`: qty=10, cost=50, ref=QA-001
2. Stock In `NEWONN001`: qty=20, cost=55, ref=QA-002
3. Stock In `NEWONN001`: qty=15, cost=52, ref=QA-003

**Expected:**
- [ ] All 3 Stock Ins succeed
- [ ] 3 separate stock in documents created
- [ ] 3 separate receipt layers created
- [ ] Total on-hand = 45

**Verify in DB:**
```sql
-- Check documents
SELECT reference, created_at
FROM inventory_stock_in_documents
WHERE reference IN ('QA-001', 'QA-002', 'QA-003')
ORDER BY created_at;

-- Expected: 3 rows

-- Check layers
SELECT ref_id, qty_received, unit_cost, received_at
FROM inventory_receipt_layers
WHERE sku_internal = 'NEWONN001'
  AND ref_type = 'PURCHASE'
ORDER BY received_at DESC LIMIT 3;

-- Expected: 3 rows (10@50, 20@55, 15@52)

-- Check total on-hand
SELECT SUM(qty_remaining) as total_on_hand
FROM inventory_receipt_layers
WHERE sku_internal = 'NEWONN001'
  AND is_voided = false;

-- Expected: 45
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-010: SKU Canonicalization Verification ✅

**Prerequisites:**
- Run `fix-sku-canonicalization-NEWONN.sql` script

**Steps:**
1. Check database for old SKU format

```sql
-- Should return 0 rows
SELECT COUNT(*) as old_sku_count
FROM inventory_items
WHERE sku_internal LIKE 'NEWOWNN%';

-- Expected: 0

-- Should return 2 rows (or at least 1)
SELECT sku_internal, product_name
FROM inventory_items
WHERE sku_internal IN ('NEWONN001', 'NEWONN002')
ORDER BY sku_internal;

-- Expected:
-- NEWONN001 | Cool Smile Fresh Up
-- NEWONN002 | Cool Smile Wind Down
```

**Expected:**
- [ ] No NEWOWNN SKUs exist
- [ ] NEWONN001 and NEWONN002 exist
- [ ] Product names match

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-011: Receipt Layer Foreign Key Integrity ✅

**Steps:**
1. Stock In for `NEWONN001` (qty=5, cost=40, ref=FK-TEST)
2. Get doc_id from inventory_stock_in_documents
3. Query receipt layer

```sql
-- Get doc_id
SELECT id as doc_id FROM inventory_stock_in_documents
WHERE reference = 'FK-TEST' LIMIT 1;

-- Check receipt layer references correct doc_id
SELECT ref_type, ref_id, sku_internal
FROM inventory_receipt_layers
WHERE ref_id = '<doc_id from above>';

-- Expected: 1 row with ref_type='PURCHASE', ref_id=doc_id, sku_internal='NEWONN001'
```

**Expected:**
- [ ] Receipt layer correctly references stock in document
- [ ] ref_type = 'PURCHASE'
- [ ] ref_id = doc_id

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-012: Rollback Transaction (Receipt Layer Fails) ✅

**Steps:**
1. Simulate receipt layer failure by:
   - Temporarily breaking FK constraint (drop inventory_items row)
   - OR modify code to force error
2. Attempt Stock In

**Expected:**
- [ ] Error message shown
- [ ] Stock in document NOT created (rolled back)
- [ ] No orphan documents in database

**Verify in DB:**
```sql
-- Should not have any orphan documents
SELECT d.id, d.reference, l.id as layer_id
FROM inventory_stock_in_documents d
LEFT JOIN inventory_receipt_layers l ON l.ref_id = d.id AND l.ref_type = 'PURCHASE'
WHERE l.id IS NULL;

-- Expected: 0 rows (all documents have corresponding layers)
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

## Regression Tests

### RT-001: Opening Balance Still Works ✅

**Steps:**
1. Navigate to `/inventory`
2. Click **Opening Balance** tab
3. Add opening balance for `NEWONN002`: qty=100, cost=45, date=2026-01-01

**Expected:**
- [ ] Success
- [ ] Receipt layer created with ref_type='OPENING_BALANCE'

**Result:** PASS / FAIL

---

### RT-002: COGS Allocation (Existing Functionality) ✅

**Steps:**
1. Ensure receipt layers exist for a SKU
2. Create sales order for that SKU
3. Run Apply COGS (MTD)

**Expected:**
- [ ] COGS allocated successfully
- [ ] qty_remaining reduced in receipt layers

**Result:** PASS / FAIL

---

### RT-003: Bundles Still Work ✅

**Steps:**
1. Create/Edit bundle recipe
2. Verify bundle components saved

**Expected:**
- [ ] Bundle recipe functionality unchanged

**Result:** PASS / FAIL

---

## Performance Tests

### PT-001: Stock In Response Time ⚡

**Steps:**
1. Measure time from "Save" click to success toast
2. Repeat 5 times

**Expected:**
- [ ] < 2 seconds average

**Results:**
- Trial 1: ___ ms
- Trial 2: ___ ms
- Trial 3: ___ ms
- Trial 4: ___ ms
- Trial 5: ___ ms
- Average: ___ ms

**Result:** PASS / FAIL

---

## Summary

**Total Test Cases:** 15
**Passed:** ___
**Failed:** ___
**Blocked:** ___

**Critical Issues Found:**
- _______________________________________________
- _______________________________________________

**Minor Issues Found:**
- _______________________________________________
- _______________________________________________

**Sign-off:**
- [ ] All critical test cases passed
- [ ] No critical bugs found
- [ ] Ready for production

**Tester Signature:** _______________ **Date:** _______________
**Reviewer Signature:** _______________ **Date:** _______________
