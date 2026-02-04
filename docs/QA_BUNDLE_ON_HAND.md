# QA Checklist: Bundle On Hand (Available Sets)

**Feature:** Show Bundle On Hand computed from component inventory
**Date:** 2026-02-01
**Tester:** _______________

## Overview

**What Changed:**
- Bundle SKUs now display "available sets" instead of 0
- Calculated as: `min( floor(component_on_hand / component.quantity) )`
- Hover tooltip shows component breakdown and limiting SKU

**Why:**
- Better UX: users can see how many bundle sets they can fulfill
- Accurate inventory visibility for bundles

## Prerequisites

- [ ] Bundle SKU exists (e.g., `#0007`)
- [ ] Bundle has `is_bundle = true` in inventory_items
- [ ] Components defined in inventory_bundle_components:
  ```sql
  SELECT * FROM inventory_bundle_components WHERE bundle_sku = '#0007';
  -- Expected:
  -- #0007 | NEWONN001 | 1
  -- #0007 | NEWONN002 | 1
  ```
- [ ] Component SKUs have receipt layers with stock

## Test Cases

### TC-001: Bundle On Hand Happy Path ✅

**Scenario:** Bundle with sufficient component stock

**Setup:**
```sql
-- Bundle: #0007 = 1x NEWONN001 + 1x NEWONN002
-- Stock:
--   NEWONN001: 3022 units
--   NEWONN002: 955 units

SELECT sku_internal, SUM(qty_remaining) as on_hand
FROM inventory_receipt_layers
WHERE sku_internal IN ('NEWONN001', 'NEWONN002')
  AND COALESCE(is_voided, false) = false
GROUP BY sku_internal;
```

**Steps:**
1. Navigate to `/inventory`
2. Click **Products** tab
3. Find bundle SKU `#0007` in table

**Expected Results:**
- [ ] On Hand column shows: `955` (integer, no decimals)
- [ ] Small info icon (ℹ️) visible next to number
- [ ] Hover over info icon shows tooltip with:
  - "Computed from components:"
  - NEWONN001: 3022 / 1 = 3022 sets
  - NEWONN002: 955 / 1 = 955 sets
  - "Limited by: NEWONN002"

**Calculation:**
```
NEWONN001: floor(3022 / 1) = 3022 sets
NEWONN002: floor(955 / 1) = 955 sets
min(3022, 955) = 955 ✅
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-002: Bundle Component Zero Stock ❌

**Scenario:** One component has zero stock

**Setup:**
```sql
-- Set NEWONN002 to zero
UPDATE inventory_receipt_layers
SET qty_remaining = 0
WHERE sku_internal = 'NEWONN002';
```

**Steps:**
1. Refresh inventory page
2. Check bundle `#0007` On Hand

**Expected Results:**
- [ ] On Hand shows: `0`
- [ ] Tooltip shows NEWONN002: 0 / 1 = 0 sets
- [ ] "Limited by: NEWONN002"

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-003: Bundle Without Components ❌

**Scenario:** Bundle has no components defined

**Setup:**
```sql
-- Create bundle without components
INSERT INTO inventory_items (sku_internal, product_name, is_bundle, base_cost_per_unit)
VALUES ('BUNDLE-EMPTY', 'Empty Bundle', true, 0);

-- Verify no components
SELECT COUNT(*) FROM inventory_bundle_components WHERE bundle_sku = 'BUNDLE-EMPTY';
-- Expected: 0
```

**Steps:**
1. Check BUNDLE-EMPTY in Products table

**Expected Results:**
- [ ] On Hand shows: `-` (dash, grayed out)
- [ ] Tooltip shows: "No components defined"

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-004: Fractional Component Quantity ✅

**Scenario:** Bundle component quantity is 0.5

**Setup:**
```sql
-- Create bundle with fractional component
INSERT INTO inventory_items (sku_internal, product_name, is_bundle, base_cost_per_unit)
VALUES ('BUNDLE-FRAC', 'Fractional Bundle', true, 0);

INSERT INTO inventory_bundle_components (bundle_sku, component_sku, quantity)
VALUES ('BUNDLE-FRAC', 'NEWONN001', 0.5);

-- NEWONN001 has 100 units
```

**Steps:**
1. Check BUNDLE-FRAC On Hand

**Expected Results:**
- [ ] On Hand shows: `200` (floor(100 / 0.5))
- [ ] Tooltip shows: NEWONN001: 100 / 0.5 = 200 sets

**Calculation:**
```
floor(100 / 0.5) = floor(200) = 200 ✅
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-005: Multiple Components Different Ratios ✅

**Scenario:** Bundle with 3 components, different quantities

**Setup:**
```sql
-- Bundle: KIT-001 = 2x A + 1x B + 3x C
INSERT INTO inventory_items (sku_internal, product_name, is_bundle, base_cost_per_unit)
VALUES ('KIT-001', 'Starter Kit', true, 0);

INSERT INTO inventory_bundle_components (bundle_sku, component_sku, quantity)
VALUES
  ('KIT-001', 'COMP-A', 2),
  ('KIT-001', 'COMP-B', 1),
  ('KIT-001', 'COMP-C', 3);

-- Stock:
-- COMP-A: 100 units → 50 sets
-- COMP-B: 200 units → 200 sets
-- COMP-C: 90 units → 30 sets
```

**Steps:**
1. Check KIT-001 On Hand

**Expected Results:**
- [ ] On Hand shows: `30`
- [ ] Tooltip breakdown:
  - COMP-A: 100 / 2 = 50 sets
  - COMP-B: 200 / 1 = 200 sets
  - COMP-C: 90 / 3 = 30 sets
  - "Limited by: COMP-C"

**Calculation:**
```
min(50, 200, 30) = 30 ✅
```

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-006: Regular SKU Unchanged ✅

**Scenario:** Non-bundle SKU shows normal on hand

**Steps:**
1. Check regular SKU (e.g., NEWONN001)

**Expected Results:**
- [ ] On Hand shows: normal value with 4 decimals (e.g., `3022.0000`)
- [ ] NO info icon
- [ ] NO tooltip
- [ ] Same behavior as before

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-007: Bundle After Stock In Component ✅

**Scenario:** Stock In component → bundle sets increase

**Setup:**
```sql
-- Initial: #0007 has 955 sets (limited by NEWONN002)
```

**Steps:**
1. Stock In NEWONN002: 1000 units @ 45.00
2. Refresh inventory page
3. Check bundle #0007 On Hand

**Expected Results:**
- [ ] On Hand increases to: `1955` (955 + 1000)
- [ ] Tooltip updates:
  - NEWONN002: 1955 / 1 = 1955 sets
  - Limited by still NEWONN002 (if NEWONN001 > 1955)

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-008: Bundle After COGS Allocation ✅

**Scenario:** Sell bundle → component stock decreases → sets decrease

**Setup:**
```sql
-- Sell 100 units of #0007
-- This consumes:
--   NEWONN001: 100 units
--   NEWONN002: 100 units
```

**Steps:**
1. Apply COGS for bundle order (100 units)
2. Refresh inventory page
3. Check bundle #0007 On Hand

**Expected Results:**
- [ ] On Hand decreases to: `855` (955 - 100)
- [ ] Tooltip shows updated component on-hand

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-009: Performance - Many Bundles ⚡

**Scenario:** Multiple bundles on page

**Setup:**
- 10+ bundle SKUs defined
- Each bundle has 2-3 components

**Steps:**
1. Load Products tab
2. Measure page load time

**Expected Results:**
- [ ] Page loads within 2 seconds
- [ ] Only 1-2 database queries (not N+1)
- [ ] All bundles show correct on hand

**Time:** ___ seconds
**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-010: Tooltip Interaction ✅

**Scenario:** Tooltip shows/hides correctly

**Steps:**
1. Hover over info icon next to bundle On Hand
2. Wait 0.5 seconds
3. Move mouse away

**Expected Results:**
- [ ] Tooltip appears on hover
- [ ] Tooltip shows component breakdown
- [ ] Tooltip dismisses when mouse leaves
- [ ] Tooltip doesn't block other UI elements

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-011: Mixed Bundle + Regular SKUs ✅

**Scenario:** Table with both bundle and regular SKUs

**Steps:**
1. View Products table with mix of:
   - Regular SKUs (NEWONN001, NEWONN002)
   - Bundle SKUs (#0007, KIT-001)

**Expected Results:**
- [ ] Regular SKUs: 4-decimal on hand, no icon
- [ ] Bundle SKUs: integer on hand, info icon
- [ ] Tooltip only on bundles
- [ ] Table sorts correctly

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

### TC-012: Component Missing (Deleted) ❌

**Scenario:** Component SKU deleted from inventory_items

**Setup:**
```sql
-- Delete component SKU (but leave in bundle_components)
DELETE FROM inventory_items WHERE sku_internal = 'NEWONN001';
-- Note: This might fail due to FK constraints
-- If so, just void all layers for NEWONN001 instead
```

**Steps:**
1. Check bundle #0007 On Hand

**Expected Results:**
- [ ] On Hand shows: `0` (missing component treated as 0)
- [ ] OR shows: `-` with error message
- [ ] No JavaScript errors in console

**Result:** PASS / FAIL
**Notes:** _______________________________________________

---

## Edge Cases

### EC-001: Component Quantity Zero

**Setup:**
```sql
UPDATE inventory_bundle_components
SET quantity = 0
WHERE bundle_sku = '#0007' AND component_sku = 'NEWONN001';
```

**Expected:**
- [ ] Calculation handles division by zero
- [ ] On Hand shows: `0` or `-`
- [ ] No errors

**Result:** PASS / FAIL

---

### EC-002: Negative Component Quantity

**Setup:**
```sql
UPDATE inventory_bundle_components
SET quantity = -1
WHERE bundle_sku = '#0007' AND component_sku = 'NEWONN001';
```

**Expected:**
- [ ] Handles gracefully
- [ ] Shows 0 or reasonable value

**Result:** PASS / FAIL

---

### EC-003: Very Large Numbers

**Setup:**
```sql
-- Component has 1,000,000 units
UPDATE inventory_receipt_layers
SET qty_remaining = 1000000
WHERE sku_internal = 'NEWONN001';
```

**Expected:**
- [ ] On Hand displays: `955` (still limited by NEWONN002)
- [ ] Tooltip shows: 1000000 / 1 = 1000000 sets
- [ ] No number formatting issues

**Result:** PASS / FAIL

---

## Regression Tests

### RT-001: Stock In Still Works ✅

**Steps:**
1. Stock In component SKU
2. Verify receipt layer created
3. Bundle On Hand updates

**Expected:**
- [ ] Stock In functionality unchanged
- [ ] Bundle automatically reflects new stock

**Result:** PASS / FAIL

---

### RT-002: COGS Allocation Unchanged ✅

**Steps:**
1. Apply COGS for bundle order
2. Verify component allocations created

**Expected:**
- [ ] COGS logic unchanged
- [ ] Bundle On Hand reflects consumed stock

**Result:** PASS / FAIL

---

### RT-003: Edit/Delete SKU Unchanged ✅

**Steps:**
1. Edit bundle SKU details
2. Delete bundle SKU

**Expected:**
- [ ] Edit works
- [ ] Delete works
- [ ] No regressions

**Result:** PASS / FAIL

---

## Visual Regression

### VR-001: Table Layout

**Expected:**
- [ ] On Hand column aligned right
- [ ] Info icon doesn't break alignment
- [ ] Tooltip positioned correctly
- [ ] Mobile responsive (if applicable)

**Result:** PASS / FAIL

---

### VR-002: Tooltip Styling

**Expected:**
- [ ] Tooltip background: dark
- [ ] Tooltip text: readable
- [ ] Component breakdown: aligned
- [ ] "Limited by" text: orange/warning color

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
- [ ] Bundle On Hand displays correctly
- [ ] Regular SKUs unchanged
- [ ] Performance acceptable
- [ ] Ready for production

**Tester Signature:** _______________ **Date:** _______________
**Reviewer Signature:** _______________ **Date:** _______________

---

## Appendix: SQL Queries for Manual Verification

### Check Bundle On Hand Calculation

```sql
-- For bundle #0007
WITH component_stock AS (
  SELECT
    bc.component_sku,
    bc.quantity as required_per_set,
    COALESCE(SUM(rl.qty_remaining), 0) as on_hand
  FROM inventory_bundle_components bc
  LEFT JOIN inventory_receipt_layers rl
    ON rl.sku_internal = bc.component_sku
    AND COALESCE(rl.is_voided, false) = false
  WHERE bc.bundle_sku = '#0007'
  GROUP BY bc.component_sku, bc.quantity
)
SELECT
  component_sku,
  required_per_set,
  on_hand,
  FLOOR(on_hand / required_per_set) as possible_sets
FROM component_stock
ORDER BY possible_sets ASC;

-- Expected output shows limiting component
```

### Verify Component Stock

```sql
SELECT
  sku_internal,
  SUM(qty_remaining) as total_on_hand
FROM inventory_receipt_layers
WHERE sku_internal IN ('NEWONN001', 'NEWONN002')
  AND COALESCE(is_voided, false) = false
GROUP BY sku_internal;
```

### Check Bundle Components

```sql
SELECT
  bundle_sku,
  component_sku,
  quantity as required_per_set
FROM inventory_bundle_components
WHERE bundle_sku = '#0007';
```
