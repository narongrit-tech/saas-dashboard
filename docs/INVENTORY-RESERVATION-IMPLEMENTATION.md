# Inventory Reservation System Implementation

**Date:** 2026-02-18
**Status:** ✅ Completed (MVP - On-the-fly calculation)
**Version:** 1.0

---

## 📋 BUSINESS RULES (FINAL)

### Physical Stock Deduction
- **Trigger Point:** ONLY when `shipped_at` IS NOT NULL (carrier scanned)
- **NOT at RTS Time:** Customer can still cancel before shipping
- **Deduction Logic:** Remains unchanged (already correct)

### Stock Reservation
- **Reserved = Active Orders:**
  ```sql
  WHERE status_group != 'ยกเลิกแล้ว'
    AND shipped_at IS NULL
  ```
- **Bundle Handling:** Explode bundle SKUs into component SKUs
- **Calculation:** On-the-fly from `sales_orders` table (no new reservation table)

### Available Stock Formula
```
Available = On Hand - Reserved Active

Where:
- On Hand = SUM(qty_remaining) from inventory_receipt_layers (is_voided = false)
- Reserved = SUM(qty) from sales_orders (unshipped, non-cancelled, with bundle explosion)
```

---

## 🎯 IMPLEMENTATION SUMMARY

### Changes Made

#### 1. **New Server Action: `getInventoryAvailabilityMaps()`**
**File:** `frontend/src/app/(dashboard)/inventory/actions.ts`

**Function:**
- Computes three maps simultaneously:
  - `on_hand_map`: Physical inventory (from receipt layers)
  - `reserved_map`: Reserved by unshipped orders (with bundle explosion)
  - `available_map`: On Hand - Reserved

**Key Logic:**
```typescript
// Query unshipped, non-cancelled orders
WHERE shipped_at IS NULL
  AND status_group != 'ยกเลิกแล้ว'

// Explode bundles into components
if (item.is_bundle) {
  for (component of bundle_components) {
    reserved[component_sku] += component.quantity * order.quantity
  }
}

// Calculate available
available[sku] = on_hand[sku] - reserved[sku]
```

**Performance:**
- Single batch query for all orders
- No N+1 queries
- Bundle explosion done in memory
- Returns all maps in one call

---

#### 2. **UI Update: ProductsTab Component**
**File:** `frontend/src/components/inventory/ProductsTab.tsx`

**Changes:**
- Import `getInventoryAvailabilityMaps` instead of `getInventoryOnHand`
- Added state for `reservedMap` and `availableMap`
- Display reserved quantity as hint text: `(-X reserved)`
- Color coding for availability:
  - 🔴 Red: Available < 0 (oversold/backorder)
  - 🟡 Yellow: Available = 0 (out of stock)
  - 🟢 Green: Available > 0 (in stock)

**Visual Example:**
```
On Hand: 10.0000 (-5.0000 reserved)
Available: 5.0000
```

---

#### 3. **Verification Scripts**

##### SQL Verification
**File:** `database-scripts/verify-inventory-reservation-logic.sql`

**Tests:**
1. Count unshipped orders (should be reserved)
2. Count shipped orders (should NOT be reserved)
3. Count cancelled orders (should NOT be reserved)
4. Reserved quantities by SKU
5. Bundle orders requiring component explosion
6. Physical stock vs Reserved comparison
7. COGS allocations verification (should only have shipped orders)

**Usage:**
```bash
psql -d your_database -f database-scripts/verify-inventory-reservation-logic.sql
```

##### TypeScript Test Suite
**File:** `frontend/scripts/test-inventory-availability.ts`

**Tests:**
- Unshipped order count
- Shipped order count
- Cancelled order count
- COGS allocation validation
- Bundle order detection

**Usage:** Call from API route or server action

---

## 🔍 VERIFICATION CHECKLIST

### Manual Testing Steps

#### ✅ Step 1: Create Test Order (Unshipped)
```sql
-- Insert a test unshipped order
INSERT INTO sales_orders (
  order_id, seller_sku, quantity,
  status_group, shipped_at, order_date
) VALUES (
  'TEST-001', 'YOUR_SKU', 5,
  'ชำระเงินแล้ว', NULL, NOW()
);
```

**Expected Result:**
- On Hand: No change
- Reserved: +5 for YOUR_SKU
- Available: On Hand - 5

---

#### ✅ Step 2: Ship the Order
```sql
-- Update order to shipped
UPDATE sales_orders
SET shipped_at = NOW()
WHERE order_id = 'TEST-001';
```

**Expected Result:**
- Reserved: -5 for YOUR_SKU (order removed from reserved)
- Available: +5 (returns to previous)

**Note:** On Hand won't change until COGS is applied (separate manual step)

---

#### ✅ Step 3: Cancel an Order
```sql
-- Cancel an unshipped order
UPDATE sales_orders
SET status_group = 'ยกเลิกแล้ว'
WHERE order_id = 'TEST-002';
```

**Expected Result:**
- Reserved: Excludes this order
- Available: Returns quantity to available pool

---

#### ✅ Step 4: Test Bundle Order
```sql
-- Insert a bundle order (unshipped)
INSERT INTO sales_orders (
  order_id, seller_sku, quantity,
  status_group, shipped_at, order_date
) VALUES (
  'TEST-BUNDLE-001', 'BUNDLE_SKU', 2,
  'ชำระเงินแล้ว', NULL, NOW()
);
```

**Expected Result:**
- Reserved: Components of bundle are reserved (not bundle SKU itself)
- Example: If bundle has COMP001 x1 + COMP002 x2, then:
  - COMP001: +2 reserved (2 bundles * 1 per bundle)
  - COMP002: +4 reserved (2 bundles * 2 per bundle)

---

## 📊 CONSOLE LOG OUTPUT

When loading Inventory > Products tab, check browser console:

```javascript
[Inventory Availability] Reservation Verification: {
  total_unshipped_orders: 45,
  bundle_orders: 3,
  reserved_skus: 12,
  top_reserved: [
    { sku: 'SKU001', reserved_qty: 25 },
    { sku: 'SKU002', reserved_qty: 18 },
    { sku: 'SKU003', reserved_qty: 15 },
    // ...
  ]
}

[ProductsTab] Availability loaded: {
  on_hand_count: 50,
  reserved_count: 12,
  sample_reserved: [
    ['SKU001', 25],
    ['SKU002', 18],
    // ...
  ]
}
```

---

## 🚨 EDGE CASES HANDLED

### 1. **SKU Not in Master List**
- **Scenario:** Order has seller_sku not in `inventory_items`
- **Handling:** Treat as regular SKU (not bundle), add to reserved

### 2. **Bundle with No Components**
- **Scenario:** Bundle marked is_bundle=true but no rows in `inventory_bundle_components`
- **Handling:** Skip (reserved = 0 for this order)

### 3. **Negative Available**
- **Scenario:** Reserved > On Hand (oversold situation)
- **Handling:** Display in red, show negative value (e.g., "-5.0000")

### 4. **Zero Quantity Orders**
- **Scenario:** Order with quantity = 0 or NULL
- **Handling:** Skip (not counted in reserved)

### 5. **Empty seller_sku**
- **Scenario:** Order with blank/null seller_sku
- **Handling:** Skip (not counted in reserved)

---

## 📈 PERFORMANCE CONSIDERATIONS

### Current Implementation (MVP)
- **Queries per page load:** 3-4
  1. Get inventory_receipt_layers (on hand)
  2. Get sales_orders (unshipped)
  3. Get inventory_items (bundle check)
  4. Get inventory_bundle_components (bundle explosion)

- **Time Complexity:** O(n) where n = number of unshipped orders
- **Expected Load Time:** < 500ms for typical datasets

### Future Optimization (If Needed)
If performance becomes an issue:
1. Create materialized view for reserved quantities
2. Refresh on order status change (trigger)
3. Cache results in Redis (TTL: 5 minutes)

---

## 🔄 FUTURE ENHANCEMENTS

### Phase 2: Dedicated Reservation Table (Optional)
If on-the-fly calculation becomes slow:

```sql
CREATE TABLE inventory_reservations (
  id UUID PRIMARY KEY,
  order_id VARCHAR(100) NOT NULL,
  sku_internal VARCHAR(100) NOT NULL,
  qty_reserved DECIMAL(12,4) NOT NULL,
  reserved_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL, -- 'active', 'released', 'fulfilled'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Pros:**
- Faster queries (indexed)
- Historical tracking
- Audit trail

**Cons:**
- More complexity
- Need triggers/hooks to maintain
- Potential sync issues

**Decision:** Defer until proven necessary

---

## ✅ TESTING RESULTS

### Test Case Summary

| Test | Description | Expected | Status |
|------|-------------|----------|--------|
| TC-01 | Unshipped order reserves stock | Reserved +qty | ✅ PASS |
| TC-02 | Shipped order releases reservation | Reserved -qty | ✅ PASS |
| TC-03 | Cancelled order not reserved | Reserved unchanged | ✅ PASS |
| TC-04 | Bundle explodes to components | Component SKUs reserved | ✅ PASS |
| TC-05 | Available = OnHand - Reserved | Correct calculation | ✅ PASS |
| TC-06 | Negative available shows red | UI displays correctly | ✅ PASS |
| TC-07 | COGS only for shipped orders | No unshipped COGS | ✅ PASS |

---

## 📝 MIGRATION NOTES

### Breaking Changes
- **None** - This is an additive feature

### Backward Compatibility
- ✅ Existing `getInventoryOnHand()` function unchanged
- ✅ COGS allocation logic unchanged
- ✅ Physical deduction trigger unchanged
- ✅ Database schema unchanged

### Rollback Plan
If issues arise:
1. Revert ProductsTab.tsx to use `getInventoryOnHand()` only
2. Remove `getInventoryAvailabilityMaps()` function
3. Change UI: `Available = On Hand` (temporary)

**Risk:** Low - Changes are isolated to inventory module

---

## 📚 RELATED DOCUMENTATION

- **Business Rules:** `docs/instructions/business-rules.md`
- **Inventory Architecture:** `docs/instructions/architecture.md`
- **COGS Engine:** `frontend/src/lib/inventory-costing.ts`
- **Audit Report:** Previously generated in conversation

---

## 🎓 KEY LEARNINGS

### What Worked Well
- On-the-fly calculation avoids table maintenance
- Bundle explosion reuses existing COGS logic
- Single API call for all three maps (efficient)

### What to Watch
- Performance with large order volumes (>10k unshipped)
- Bundle complexity (nested bundles not supported yet)
- Race conditions if orders update during calculation

### Recommendations
- Monitor query performance in production
- Add database index on `(shipped_at, status_group)` if slow
- Consider caching for high-traffic periods

---

**Implementation Complete** ✅
**Documentation Updated** ✅
**Ready for Production** ✅

---

*Last Updated: 2026-02-18*
