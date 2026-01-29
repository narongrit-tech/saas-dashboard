# QA Test Plan: Inventory Costing Engine (FIFO + AVG)

## Prerequisites

1. Run migration: `psql -d your_db < database-scripts/migration-033-inventory-costing-engine.sql`
2. Start dev server: `cd frontend && npm run dev`
3. Login to the system
4. Navigate to `/inventory`

## Test Set A: FIFO Allocation

**Goal:** ตรวจสอบว่า FIFO allocate layers ตามลำดับเวลา (oldest first)

### Steps:
1. **Products Tab**: สร้าง SKU `TEST-FIFO-A` (is_bundle = false, base_cost = 10)
2. **Opening Balance Tab**:
   - Date: 2026-01-01, SKU: `TEST-FIFO-A`, Qty: 100, Unit Cost: 10
   - Date: 2026-01-05, SKU: `TEST-FIFO-A`, Qty: 50, Unit Cost: 15
3. **Verify Movements Tab > Receipt Layers**:
   - Should see 2 layers: (2026-01-01, 100 units @ 10) and (2026-01-05, 50 units @ 15)
4. **Manual COGS Test** (via browser console or API):
   ```javascript
   // Call applyCOGSForOrder action
   await applyCOGSForOrder({
     order_id: 'TEST-ORDER-FIFO-1',
     sku_internal: 'TEST-FIFO-A',
     qty: 120,
     shipped_at: '2026-01-10T10:00:00+07:00',
     method: 'FIFO'
   })
   ```
5. **Verify Movements Tab > COGS Allocations**:
   - Should see 2 allocations:
     - 100 units @ 10 = 1000 (layer 1)
     - 20 units @ 15 = 300 (layer 2)
   - Total COGS = 1300
6. **Verify Movements Tab > Receipt Layers**:
   - Layer 1: qty_remaining = 0 (fully consumed)
   - Layer 2: qty_remaining = 30 (50 - 20)

**Expected Result:** ✅ FIFO allocates oldest layers first

---

## Test Set B: Moving Average

**Goal:** ตรวจสอบว่า AVG คำนวณ weighted average ถูกต้อง

### Steps:
1. **Products Tab**: สร้าง SKU `TEST-AVG-B` (is_bundle = false, base_cost = 20)
2. **Opening Balance Tab**:
   - Date: 2026-01-01, SKU: `TEST-AVG-B`, Qty: 100, Unit Cost: 20
   - Date: 2026-01-05, SKU: `TEST-AVG-B`, Qty: 100, Unit Cost: 30
3. **Verify Expected AVG**:
   - Total Qty: 200
   - Total Value: (100 × 20) + (100 × 30) = 5000
   - Avg Unit Cost: 5000 / 200 = 25
4. **Manual COGS Test**:
   ```javascript
   await applyCOGSForOrder({
     order_id: 'TEST-ORDER-AVG-1',
     sku_internal: 'TEST-AVG-B',
     qty: 50,
     shipped_at: '2026-01-10T10:00:00+07:00',
     method: 'AVG'
   })
   ```
5. **Verify COGS Allocations**:
   - Should see 1 allocation: 50 units @ 25 = 1250
6. **Verify Cost Snapshots** (via SQL or admin tool):
   ```sql
   SELECT * FROM inventory_cost_snapshots
   WHERE sku_internal = 'TEST-AVG-B'
   ORDER BY as_of_date DESC LIMIT 1;
   ```
   - on_hand_qty: 150 (200 - 50)
   - on_hand_value: 3750 (5000 - 1250)
   - avg_unit_cost: 25 (unchanged, since we used the same avg)

**Expected Result:** ✅ AVG uses weighted average cost

---

## Test Set C: Bundle Expansion

**Goal:** ตรวจสอบว่า bundle ถูก expand เป็น components และตัด COGS แยกถูกต้อง

### Steps:
1. **Products Tab**:
   - สร้าง SKU `COMP-1` (is_bundle = false, base_cost = 10)
   - สร้าง SKU `COMP-2` (is_bundle = false, base_cost = 15)
   - สร้าง SKU `BUNDLE-C` (is_bundle = true, base_cost = 0)
2. **Opening Balance Tab**:
   - `COMP-1`: Qty 100, Cost 10, Date 2026-01-01
   - `COMP-2`: Qty 100, Cost 15, Date 2026-01-01
3. **Bundles Tab**:
   - Bundle SKU: `BUNDLE-C`
   - Components:
     - `COMP-1` qty 1
     - `COMP-2` qty 2
4. **Manual COGS Test**:
   ```javascript
   await applyCOGSForOrder({
     order_id: 'TEST-ORDER-BUNDLE-1',
     sku_internal: 'BUNDLE-C',
     qty: 10,
     shipped_at: '2026-01-10T10:00:00+07:00',
     method: 'FIFO'
   })
   ```
5. **Verify COGS Allocations**:
   - Should see 2 allocations (bundle expanded):
     - `COMP-1`: 10 units @ 10 = 100
     - `COMP-2`: 20 units @ 15 = 300
   - Total COGS = 400
6. **Verify Receipt Layers**:
   - `COMP-1`: qty_remaining = 90 (100 - 10)
   - `COMP-2`: qty_remaining = 80 (100 - 20)

**Expected Result:** ✅ Bundle expands to components, COGS allocated separately

---

## Test Set D: Returns (Reverse COGS)

**Goal:** ตรวจสอบว่า returns reverse COGS และคืน qty กลับ layer/snapshot

### Steps (FIFO):
1. **Use existing SKU `TEST-FIFO-A`** from Test A
2. **Manual Return Test**:
   ```javascript
   await applyReturnReversal({
     order_id: 'TEST-ORDER-FIFO-1',
     sku_internal: 'TEST-FIFO-A',
     return_qty: 20,
     return_date: '2026-01-15',
     method: 'FIFO'
   })
   ```
3. **Verify COGS Allocations**:
   - Should see 1 reversal allocation:
     - qty: -20, unit_cost: 10, amount: -200, is_reversal: true
4. **Verify Receipt Layers**:
   - Layer 1: qty_remaining = 20 (0 + 20 returned)
5. **Verify Daily P&L**:
   - 2026-01-10: COGS = 1300 (sale)
   - 2026-01-15: COGS = -200 (return, reduces COGS)

### Steps (AVG):
1. **Use existing SKU `TEST-AVG-B`** from Test B
2. **Manual Return Test**:
   ```javascript
   await applyReturnReversal({
     order_id: 'TEST-ORDER-AVG-1',
     sku_internal: 'TEST-AVG-B',
     return_qty: 10,
     return_date: '2026-01-15',
     method: 'AVG'
   })
   ```
3. **Verify COGS Allocations**:
   - Should see 1 reversal: qty: -10, unit_cost: 25, amount: -250, is_reversal: true
4. **Verify Cost Snapshots**:
   - on_hand_qty: 160 (150 + 10 returned)
   - on_hand_value: 4000 (3750 + 250)
   - avg_unit_cost: 25 (4000 / 160)

**Expected Result:** ✅ Returns reverse COGS and restore qty

---

## Test Set E: Idempotency

**Goal:** ตรวจสอบว่า applyCOGSForOrderShipped ป้องกัน duplicate allocations

### Steps:
1. **Use existing order `TEST-ORDER-FIFO-1`**
2. **Try to apply COGS again**:
   ```javascript
   await applyCOGSForOrder({
     order_id: 'TEST-ORDER-FIFO-1',
     sku_internal: 'TEST-FIFO-A',
     qty: 120,
     shipped_at: '2026-01-10T10:00:00+07:00',
     method: 'FIFO'
   })
   ```
3. **Verify COGS Allocations**:
   - Should still have the same 2 allocations (no duplicates)
4. **Verify Receipt Layers**:
   - qty_remaining should be unchanged (not reduced again)

**Expected Result:** ✅ Idempotent: no duplicate allocations

---

## Test Set F: P&L Integration

**Goal:** ตรวจสอบว่า Daily P&L ดึง COGS จาก inventory_cogs_allocations

### Steps:
1. **Create a real sales order** (via Sales module):
   - Order ID: `REAL-ORDER-001`
   - SKU: `TEST-FIFO-A`
   - Qty: 10
   - Order Date: 2026-01-20
   - Status: shipped
   - shipped_at: 2026-01-20T10:00:00+07:00
2. **Apply COGS** (manually for now, will be automated later):
   ```javascript
   await applyCOGSForOrder({
     order_id: 'REAL-ORDER-001',
     sku_internal: 'TEST-FIFO-A',
     qty: 10,
     shipped_at: '2026-01-20T10:00:00+07:00',
     method: 'FIFO'
   })
   ```
3. **Navigate to Daily P&L page**
4. **Select date: 2026-01-20**
5. **Verify P&L data**:
   - Revenue: (from sales order)
   - COGS: should show amount from COGS allocation (e.g., 100 if using layer 1)
   - Net Profit: Revenue - Advertising - COGS - Operating

**Expected Result:** ✅ P&L displays COGS from inventory allocations

---

## Test Set G: Build & TypeScript

**Goal:** ตรวจสอบว่าไม่มี TypeScript errors

### Steps:
```bash
cd frontend
npm run build
```

**Expected Result:** ✅ Build successful, no TypeScript errors

---

## Manual SQL Verification Queries

Use these queries to verify data directly:

```sql
-- Check inventory items
SELECT * FROM inventory_items ORDER BY sku_internal;

-- Check receipt layers (FIFO)
SELECT sku_internal, received_at, qty_received, qty_remaining, unit_cost, ref_type
FROM inventory_receipt_layers
ORDER BY sku_internal, received_at;

-- Check cost snapshots (AVG)
SELECT sku_internal, as_of_date, on_hand_qty, on_hand_value, avg_unit_cost
FROM inventory_cost_snapshots
ORDER BY sku_internal, as_of_date DESC;

-- Check COGS allocations
SELECT order_id, sku_internal, shipped_at, method, qty, unit_cost_used, amount, is_reversal
FROM inventory_cogs_allocations
ORDER BY shipped_at DESC;

-- Check bundle components
SELECT bc.bundle_sku, bc.component_sku, bc.quantity, i.product_name
FROM inventory_bundle_components bc
JOIN inventory_items i ON i.sku_internal = bc.component_sku
ORDER BY bc.bundle_sku;

-- Check daily COGS for P&L
SELECT DATE(shipped_at AT TIME ZONE 'Asia/Bangkok') as date,
       SUM(amount) as total_cogs
FROM inventory_cogs_allocations
GROUP BY DATE(shipped_at AT TIME ZONE 'Asia/Bangkok')
ORDER BY date DESC;
```

---

## Summary Checklist

- [ ] Test A: FIFO allocation ✅
- [ ] Test B: Moving Average ✅
- [ ] Test C: Bundle expansion ✅
- [ ] Test D: Returns (FIFO & AVG) ✅
- [ ] Test E: Idempotency ✅
- [ ] Test F: P&L integration ✅
- [ ] Test G: Build successful ✅

---

## Notes

- Tests A-E can be run via browser console by importing the server actions
- For production, COGS should be triggered automatically when orders are marked as shipped
- Current implementation requires manual COGS application (via admin actions)
- Future enhancement: Add background job or trigger to auto-apply COGS on order status change
