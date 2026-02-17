# Returns v1 Implementation Guide

## Overview
This document describes the Returns v1 system implementation with barcode search support.

## Files Created/Modified

### Database
- **File:** `database-scripts/migration-055-returns-v1.sql`
- **Changes:**
  - Added `tracking_number` column to `sales_orders` table
  - Added `status_group` column to `sales_orders` table (if not exists)
  - Created `inventory_returns` table with RLS policies
  - Created indexes for search performance:
    - `idx_sales_orders_tracking_number` (created_by, tracking_number)
    - `idx_sales_orders_search_external_order_id` (created_by, external_order_id)
    - `idx_inventory_returns_order_id`, `idx_inventory_returns_created_by`
    - `idx_inventory_returns_order_sku` (for qty_returned aggregation)

### Types
- **File:** `frontend/src/types/returns.ts`
- **Exports:**
  - `ReturnType`: 'RETURN_RECEIVED' | 'REFUND_ONLY' | 'CANCEL_BEFORE_SHIP'
  - `RETURN_TYPE_LABELS`: Thai labels for each return type
  - `OrderSearchResult`: Search result with line items
  - `OrderLineItem`: Individual SKU line with qty_returned
  - `ReturnSubmitPayload`: Submission payload interface
  - `InventoryReturn`: Return record interface

### Server Actions
- **File:** `frontend/src/app/(dashboard)/returns/actions.ts`
- **Functions:**
  - `searchOrdersForReturn(query)`: Search by external_order_id or tracking_number
    - Returns orders grouped by order_id with line items
    - Aggregates qty_returned from inventory_returns table
    - RLS enforced (created_by = auth.uid())
  - `submitReturn(payload)`: Submit return transaction
    - Validates ownership, qty available, return type vs order status
    - Inserts records into inventory_returns table
    - **TODO:** Integrate with inventory costing engine for:
      - RETURN_RECEIVED: Create inventory movement + COGS reversal
      - CANCEL_BEFORE_SHIP: Reverse COGS allocation if exists

### Frontend Pages
- **File:** `frontend/src/app/(dashboard)/returns/page.tsx`
- **Features:**
  - Large search input (h-14) with auto-focus
  - Enter key triggers search
  - Clear button (X icon)
  - Auto-open drawer if 1 result found
  - Display multiple results as cards if 2+ results
  - Refocuses search input after drawer closes

### Frontend Components
- **File:** `frontend/src/components/returns/ReturnDrawer.tsx`
- **Features:**
  - Sheet/Drawer UI with order details
  - Table of line items with:
    - SKU, Qty Sold, Qty Returned, Qty to Return (input)
    - Return Type selector (per line item)
  - Note textarea (optional)
  - Validation before submit:
    - At least 1 item with qty > 0
    - Qty to return ≤ available qty
  - Loading states during submission

### Sidebar
- **File:** `frontend/src/components/dashboard/sidebar.tsx`
- **Changes:**
  - Added "Returns" menu item in Operations group (between Expenses and Inventory)
  - Icon: ArrowLeftCircle

## Database Schema

### inventory_returns Table
```sql
CREATE TABLE inventory_returns (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  order_id UUID REFERENCES sales_orders(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  return_type TEXT CHECK (return_type IN ('RETURN_RECEIVED', 'REFUND_ONLY', 'CANCEL_BEFORE_SHIP')),
  note TEXT,
  returned_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### sales_orders New Columns
- `tracking_number TEXT`: Shipping tracking number
- `status_group TEXT`: Order status group (if not exists)

## UX Flow

### Barcode Scanner Flow (Primary)
1. User scans barcode → input receives order ID/tracking + Enter
2. Search triggers automatically
3. If 1 result: drawer opens immediately
4. User enters qty to return for each line
5. User selects return type (default: RETURN_RECEIVED)
6. User clicks "Confirm Return"
7. Success toast displayed
8. Drawer closes
9. **Focus returns to search input immediately** (ready for next scan)

### Manual Entry Flow
1. User types order ID or tracking number
2. User presses Enter or clicks Search button
3. Results displayed (1 or multiple)
4. If multiple: user clicks desired order
5. Drawer opens
6. (Same as barcode flow from step 4)

## Return Types

### RETURN_RECEIVED
- **Thai:** "รับของคืนจริง (คืน stock + COGS)"
- **Logic:**
  - Insert into inventory_returns
  - **TODO:** Create inventory movement (type: RETURN_IN)
  - **TODO:** Create COGS reversal in inventory_cogs_allocations (is_reversal=true, negative qty)

### REFUND_ONLY
- **Thai:** "คืนเงินอย่างเดียว (ไม่มีสินค้าคืน)"
- **Logic:**
  - Insert into inventory_returns
  - No inventory movement
  - No COGS reversal

### CANCEL_BEFORE_SHIP
- **Thai:** "ยกเลิกก่อนส่ง"
- **Logic:**
  - Insert into inventory_returns
  - **TODO:** Check if COGS allocation exists → create reversal if yes
  - Validation: Cannot use if order already shipped (shipped_at IS NOT NULL)

## Validation Rules

### Server-Side Validation
1. **Ownership:** User can only return own orders (RLS: created_by = auth.uid())
2. **Qty Available:** `qty_to_return ≤ (qty_sold - qty_already_returned)`
3. **Return Type vs Status:**
   - CANCEL_BEFORE_SHIP: Order must NOT be shipped (shipped_at IS NULL)
4. **Positive Qty:** qty must be > 0
5. **At Least One Item:** At least 1 line item must have qty > 0

### Client-Side Validation
- Input field max = available qty
- Submit button disabled if no items selected
- Toast error messages for validation failures

## TODO: Integration with Inventory Costing Engine

### RETURN_RECEIVED Type
When return_type = 'RETURN_RECEIVED', need to:

1. **Create Inventory Movement:**
```sql
INSERT INTO inventory_movements
(sku, type, qty, reference_type, reference_id, created_by)
VALUES (?, 'RETURN_IN', ?, 'return', ?, auth.uid())
```

2. **Find Original COGS Allocation:**
```sql
SELECT * FROM inventory_cogs_allocations
WHERE order_id = ? AND sku_internal = ? AND is_reversal = false
ORDER BY created_at DESC
LIMIT 1
```

3. **Create COGS Reversal:**
```sql
INSERT INTO inventory_cogs_allocations
(order_id, sku_internal, shipped_at, method, qty, unit_cost_used, amount, is_reversal, created_by)
VALUES (
  ?,
  ?,
  NOW(),
  {original_method},
  -{qty_returned}, -- NEGATIVE qty
  {original_unit_cost},
  -{total_cost}, -- NEGATIVE amount
  true, -- is_reversal = true
  auth.uid()
)
```

4. **Update Receipt Layers (FIFO only):**
If method = 'FIFO', need to restore qty_remaining in inventory_receipt_layers:
```sql
UPDATE inventory_receipt_layers
SET qty_remaining = qty_remaining + ?
WHERE id = {original_layer_id}
```

### CANCEL_BEFORE_SHIP Type
Similar to RETURN_RECEIVED, but only if COGS allocation exists:
```sql
SELECT COUNT(*) FROM inventory_cogs_allocations
WHERE order_id = ? AND sku_internal = ? AND is_reversal = false
```
If exists → create reversal (same logic as RETURN_RECEIVED)

### Integration Point
The integration should be added in:
- **File:** `frontend/src/app/(dashboard)/returns/actions.ts`
- **Function:** `submitReturn(payload)`
- **Location:** After successful insert into inventory_returns, before revalidatePath

## Manual Test Steps

### Test 1: Search by Order ID
1. Navigate to /returns
2. Type external_order_id in search box
3. Press Enter
4. Verify: Order found and displayed

### Test 2: Search by Tracking Number
1. Navigate to /returns
2. Type tracking_number in search box
3. Press Enter
4. Verify: Order found and displayed

### Test 3: Barcode Scan Simulation
1. Navigate to /returns
2. Type order ID + press Enter (simulate barcode scanner)
3. Verify: Drawer opens automatically if 1 result
4. Verify: Input is auto-focused on page load

### Test 4: Submit RETURN_RECEIVED
1. Search for shipped order
2. Open drawer
3. Enter qty=1 for a line item
4. Select return_type=RETURN_RECEIVED
5. Click "Confirm Return"
6. Verify: Success toast displayed
7. Verify: Record inserted into inventory_returns
8. **TODO:** Verify: Stock increased by 1
9. **TODO:** Verify: COGS reversal created in inventory_cogs_allocations

### Test 5: Submit REFUND_ONLY
1. Search for order
2. Enter qty=1, return_type=REFUND_ONLY
3. Submit
4. Verify: Return recorded
5. Verify: No stock change
6. Verify: No COGS reversal

### Test 6: Submit CANCEL_BEFORE_SHIP
1. Search for order NOT shipped (shipped_at IS NULL)
2. Enter qty=1, return_type=CANCEL_BEFORE_SHIP
3. Submit
4. Verify: Return recorded
5. **TODO:** Verify: COGS allocation reversed if exists

### Test 7: Partial Return
1. Search for order with qty=5
2. Return qty=2
3. Search same order again
4. Verify: qty_returned shows 2, available shows 3
5. Return qty=3 more
6. Verify: qty_returned shows 5, available shows 0

### Test 8: Over-Return Prevention
1. Search for order with qty=3, already returned=2
2. Try to return qty=2 (total would be 4 > 3)
3. Verify: Validation error displayed

### Test 9: Multiple Line Items
1. Search for order with 3 SKUs
2. Return only 2 SKUs (leave 3rd as qty=0)
3. Verify: Only 2 SKUs recorded in inventory_returns

### Test 10: Focus Management
1. Open /returns page
2. Verify: Search input auto-focused
3. Search and open drawer
4. Close drawer
5. Verify: Focus returns to search input
6. Submit return
7. Verify: Focus returns to search input (ready for next scan)

### Test 11: RLS Enforcement
1. User A creates order
2. User B tries to search order (different created_by)
3. Verify: Order not found (RLS filters by created_by)

## Risks & Considerations

### Risk 1: Inventory Costing Integration Not Complete
- **Impact:** RETURN_RECEIVED and CANCEL_BEFORE_SHIP types do not reverse inventory/COGS
- **Mitigation:** Returns are tracked in inventory_returns table. COGS reversal can be implemented later.
- **Status:** MVP functional, but incomplete

### Risk 2: No Transaction Support
- **Impact:** If COGS reversal fails after inventory_returns insert, data becomes inconsistent
- **Mitigation:** Use Supabase Edge Functions or stored procedures for atomic operations
- **Status:** Acceptable for MVP (low volume, manual reconciliation possible)

### Risk 3: Multiple Returns for Same Line
- **Impact:** User can submit multiple returns for same line item until qty_returned = qty_sold
- **Mitigation:** Validation checks qty_returned on every submit
- **Status:** Working as designed

### Risk 4: Barcode Scanner Compatibility
- **Impact:** Different scanners may behave differently (some add prefix/suffix)
- **Mitigation:** Search uses ILIKE pattern matching (flexible)
- **Status:** Should work with most scanners

### Risk 5: Performance with Large Order Volume
- **Impact:** Search may be slow if millions of orders
- **Mitigation:** Indexes on created_by + external_order_id/tracking_number, LIMIT 50
- **Status:** Acceptable for small team (<5 users)

## Future Enhancements

1. **Complete COGS Reversal:**
   - Implement inventory movement creation
   - Implement COGS allocation reversal
   - Handle FIFO layer restoration

2. **Return History View:**
   - List all returns with filters
   - Export returns to CSV/Excel

3. **Order Status Update:**
   - Update sales_orders.status to 'returned' if fully returned
   - Track partial return status

4. **Return Reasons:**
   - Add predefined return reason dropdown
   - Analytics on return reasons

5. **Return Approval Workflow:**
   - Add approval step for high-value returns
   - Email notifications

6. **Inventory Location:**
   - Track where returned items are placed (warehouse, quarantine, etc.)

7. **Refund Tracking:**
   - Link returns to refund transactions
   - Track refund status (pending, completed)

8. **Bulk Return:**
   - Select multiple orders for batch return processing

## Bangkok Timezone Handling
- All timestamps use `TIMESTAMPTZ DEFAULT NOW()`
- Server-side operations use Supabase's NOW() (UTC stored, Bangkok displayed)
- Frontend displays dates with Bangkok timezone formatting

## Security
- RLS enforced on all tables (created_by = auth.uid())
- Server actions validate ownership before mutations
- No client-side data manipulation

## Performance
- Indexes on search columns: external_order_id, tracking_number
- Composite indexes for multi-column filters
- LIMIT 50 on search results

## Conclusion
Returns v1 MVP is functional for tracking returns and validating qty. COGS reversal integration is the next phase.
