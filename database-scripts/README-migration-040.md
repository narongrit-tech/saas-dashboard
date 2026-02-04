# Migration 040: Fix Stock In Flow + SKU Canonicalization

**Date:** 2026-02-01
**Status:** Ready to apply
**Priority:** High (blocks Stock In feature)

## Problem Statement

### Root Causes

1. **Missing `item_id` column**: `inventory_stock_in_documents` table was missing `item_id` column
   - Error: "null value in column 'item_id' violates not-null constraint"
   - Code was trying to insert without item_id

2. **SKU Canonicalization Issue**: Wrong SKU prefix used
   - Code/logs: `NEWOWNN001`, `NEWOWNN002` (with extra 'W')
   - Correct: `NEWONN001`, `NEWONN002`
   - Product names:
     - NEWONN001 = Cool Smile Fresh Up
     - NEWONN002 = Cool Smile Wind Down

3. **No SKU Normalization**: Incoming SKUs weren't normalized (trim + uppercase)

4. **Incomplete Transaction**: Stock In only created document, not receipt layer

## Solution

### Files Modified

1. **`migration-040-fix-stock-in-item-id.sql`** (new)
   - Adds `item_id` column to `inventory_stock_in_documents`
   - Backfills existing rows by resolving from receipt layers
   - Adds index for performance

2. **`frontend/src/app/(dashboard)/inventory/actions.ts`**
   - Added SKU normalization: `sku.trim().toUpperCase()`
   - Resolve `item_id` from `inventory_items` table
   - Insert `item_id` into `inventory_stock_in_documents`
   - Create receipt layer in same transaction
   - Better error messages

3. **`fix-sku-canonicalization-NEWONN.sql`** (helper script)
   - SQL script to fix NEWOWNN -> NEWONN typos
   - Updates all tables: inventory_items, receipt_layers, sales_orders, etc.

### Changes Summary

#### Before (Broken):
```typescript
// ❌ No SKU normalization
// ❌ No item_id lookup
// ❌ No item_id in insert
await supabase.from('inventory_stock_in_documents').insert({
  received_at,
  reference,
  supplier,
  note,
  created_by: user.id,
})
```

#### After (Fixed):
```typescript
// ✅ Normalize SKU
const normalizedSku = params.sku_internal.trim().toUpperCase()

// ✅ Resolve item_id
const { data: item } = await supabase
  .from('inventory_items')
  .select('id, sku_internal, is_bundle')
  .eq('sku_internal', normalizedSku)
  .single()

if (!item) {
  return { error: `Inventory item not found: ${normalizedSku}` }
}

// ✅ Insert with item_id
await supabase.from('inventory_stock_in_documents').insert({
  item_id: item.id,  // ✅ Now included!
  received_at,
  reference,
  supplier,
  note,
  created_by: user.id,
})

// ✅ Create receipt layer
await supabase.from('inventory_receipt_layers').insert({
  sku_internal: normalizedSku,
  received_at,
  qty_received: qty,
  qty_remaining: qty,
  unit_cost,
  ref_type: 'PURCHASE',
  ref_id: doc_id,
})
```

## How to Apply

### Step 1: Apply Migration 040

#### Option A: Supabase Dashboard (Recommended)
```bash
1. Open Supabase Dashboard → SQL Editor
2. Copy contents of migration-040-fix-stock-in-item-id.sql
3. Paste and Run
4. ✅ Check output for "Added item_id column" message
```

#### Option B: psql
```bash
cd database-scripts
psql "$DATABASE_URL" -f migration-040-fix-stock-in-item-id.sql
```

### Step 2: Fix SKU Typos (if needed)

**IMPORTANT: Only run this if you have NEWOWNN SKUs in your database!**

Check first:
```sql
SELECT sku_internal FROM inventory_items WHERE sku_internal LIKE 'NEWOWNN%';
```

If results show NEWOWNN001/002, then run:
```bash
# BACKUP FIRST!
psql "$DATABASE_URL" -f fix-sku-canonicalization-NEWONN.sql
```

### Step 3: Deploy Code Changes

```bash
cd frontend
git pull  # Get updated actions.ts
npm run build
# Deploy to production
```

## Testing Checklist

### 1️⃣ Database Schema
```sql
-- Check item_id column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'inventory_stock_in_documents'
  AND column_name = 'item_id';

-- Expected: data_type = 'uuid', is_nullable = 'YES'
```

### 2️⃣ Stock In Flow (End-to-End)

**Prerequisites:**
- At least one inventory item exists (e.g., NEWONN001)
- Check: `SELECT * FROM inventory_items WHERE sku_internal = 'NEWONN001';`

**Test Steps:**
1. Open Inventory page (`/inventory`)
2. Go to **Products** tab
3. Find SKU `NEWONN001`
4. Click **Stock In** button
5. Fill form:
   - Received At: today
   - Quantity: 10
   - Unit Cost: 50.00
   - Reference: TEST-001
   - Supplier: Test Supplier
6. Click **Save**

**Expected Results:**
- ✅ Success toast appears
- ✅ Modal closes
- ✅ No console errors

**Verify in Database:**
```sql
-- Check stock in document created
SELECT * FROM inventory_stock_in_documents
WHERE reference = 'TEST-001'
ORDER BY created_at DESC LIMIT 1;

-- Should have: item_id IS NOT NULL

-- Check receipt layer created
SELECT * FROM inventory_receipt_layers
WHERE ref_type = 'PURCHASE'
  AND sku_internal = 'NEWONN001'
ORDER BY received_at DESC LIMIT 1;

-- Should have: qty_received = 10, qty_remaining = 10, unit_cost = 50.00

-- Check on-hand quantity
SELECT sku_internal, SUM(qty_remaining) as on_hand
FROM inventory_receipt_layers
WHERE sku_internal = 'NEWONN001'
  AND is_voided = false
GROUP BY sku_internal;

-- Should show: on_hand = 10 (plus any previous stock)
```

### 3️⃣ SKU Normalization

Test that SKU normalization works:

```typescript
// Try creating stock in with lowercase SKU
createStockInForSku({
  sku_internal: ' newonn001 ',  // lowercase + spaces
  ...
})

// Expected: Should find NEWONN001 (normalized to uppercase + trimmed)
```

### 4️⃣ COGS Allocation (Integration Test)

After Stock In, test COGS allocation:

1. Create a sales order for NEWONN001 (qty: 5)
2. Click **Apply COGS (MTD)** button
3. Check allocations:

```sql
SELECT * FROM inventory_cogs_allocations
WHERE sku_internal = 'NEWONN001'
ORDER BY shipped_at DESC LIMIT 5;

-- Should show allocation with:
-- - qty = 5
-- - unit_cost = 50.00 (from receipt layer)
-- - amount = 250.00
```

4. Check remaining inventory:

```sql
SELECT sku_internal, SUM(qty_remaining) as on_hand
FROM inventory_receipt_layers
WHERE sku_internal = 'NEWONN001'
  AND is_voided = false
GROUP BY sku_internal;

-- Should show: on_hand = 5 (10 - 5 sold)
```

## Error Messages

### Before Fix:
```
❌ null value in column "item_id" of relation "inventory_stock_in_documents" violates not-null constraint
❌ SKU NEWOWNN001 ไม่พบในระบบ (wrong SKU)
```

### After Fix:
```
✅ Stock In สำเร็จ! (success)
✅ Inventory item not found: NEWONN001 (clear message if SKU doesn't exist)
```

## Rollback

### Rollback Migration 040
```sql
-- Remove item_id column (if needed)
ALTER TABLE inventory_stock_in_documents DROP COLUMN IF EXISTS item_id;
```

### Rollback SKU Changes
See rollback section in `fix-sku-canonicalization-NEWONN.sql`

## Impact

- ✅ **Zero downtime** - adds nullable column
- ✅ **Safe** - backfills existing data
- ✅ **Backward compatible** - item_id is optional in schema
- ⚠️ **Code requires deployment** - server actions.ts must be deployed

## Common Issues

### Issue 1: "Inventory item not found: NEWONN001"

**Cause:** SKU doesn't exist in inventory_items table

**Solution:**
```sql
-- Create the inventory item first
INSERT INTO inventory_items (sku_internal, product_name, base_cost_per_unit, is_bundle)
VALUES ('NEWONN001', 'Cool Smile Fresh Up', 50.00, false);
```

### Issue 2: Stock In succeeds but COGS fails with "No layers available"

**Cause:** Receipt layer wasn't created

**Solution:** Check migration 040 was applied and code was deployed

```sql
-- Check if receipt layer exists
SELECT * FROM inventory_receipt_layers
WHERE sku_internal = 'NEWONN001'
  AND ref_type = 'PURCHASE';

-- If missing, contact support
```

### Issue 3: ON CONFLICT error on sku_internal

**Cause:** Foreign key constraint failure (SKU doesn't exist)

**Solution:** Always create inventory_items entry before Stock In

## Documentation Updates

Updated in CLAUDE.md or PROJECT_STATUS.md:
- ✅ Fixed Stock In flow end-to-end
- ✅ Added item_id to stock_in_documents
- ✅ Fixed SKU normalization (trim + uppercase)
- ✅ Fixed receipt layer creation
- ✅ SKU canonicalization: NEWONN001/002 (not NEWOWNN)

## Related Migrations

- Migration 033: Inventory Costing Engine (created receipt_layers)
- Migration 035: Stock In Documents (created stock_in_documents table)

## Author Notes

The `item_id` column is crucial for:
1. Enforcing referential integrity
2. Handling SKU renames gracefully
3. Joining stock in documents to inventory items efficiently

The SKU normalization ensures consistency across:
- User input (modal forms)
- CSV imports
- API calls
- Database storage

## Questions?

If Stock In still fails:
1. Check Supabase logs for RLS policy errors
2. Verify user has permission to insert inventory_stock_in_documents
3. Check if inventory_items table has the SKU
4. Verify receipt_layers foreign key constraint allows the SKU

Run: `SELECT * FROM inventory_items WHERE sku_internal = 'NEWONN001';`

Should return 1 row with product_name = 'Cool Smile Fresh Up'
