# Sales Order View / Line View QA Checklist

## Pre-Test Setup
- [ ] Run migration-028-add-status-group.sql in Supabase
- [ ] Import a TikTok OrderSKUList file with at least 1 multi-SKU order (same Order ID, 2+ products)
- [ ] Verify test order exists in database

## Test Case 1: Order View Default Display
**Goal**: Verify Order View shows 1 row per order_id with correct aggregations

### Steps:
1. Navigate to /sales page
2. Verify "Order View" toggle is selected by default
3. Find the multi-SKU test order

### Expected Results:
- [ ] Table shows exactly 1 row for the multi-SKU order
- [ ] "Total Units" column shows SUM of all line quantities
- [ ] "Order Amount" shows correct order-level amount (NOT multiplied)
- [ ] "SKU Count" or product preview shows multiple items (e.g., "Product A, Product B...")
- [ ] Actions column includes "View" button (eye icon)

## Test Case 2: Summary Cards (Order View)
**Goal**: Verify summary metrics use order-level aggregation

### Pre-Condition:
- Multi-SKU order: Order ID "12345" with 2 SKUs (qty=2, qty=3), order_amount=500 THB

### Steps:
1. Ensure Order View is selected
2. Filter to show only test order
3. Check summary cards

### Expected Results:
- [ ] **Revenue**: Shows 500 THB (NOT 1000 THB)
- [ ] **Orders**: Shows 1 order (NOT 2)
- [ ] **Units**: Shows 5 units (2+3)
- [ ] **AOV**: Shows 500 THB (500/1)

## Test Case 3: Line View Toggle
**Goal**: Verify Line View shows raw SKU-level data

### Steps:
1. Click "Line View" toggle
2. Find the same multi-SKU order

### Expected Results:
- [ ] Table shows 2 rows for order "12345" (1 per SKU)
- [ ] Each row shows individual product_name
- [ ] Each row shows individual quantity (2 and 3)
- [ ] "Edit" and "Delete" actions available (line-level)
- [ ] NO "View" action in Line View

## Test Case 4: Order Detail Drawer
**Goal**: Verify drawer shows line breakdown correctly

### Steps:
1. Switch to Order View
2. Click "View" (eye icon) on multi-SKU order
3. Wait for drawer to open

### Expected Results:
- [ ] Drawer title shows "Order Detail"
- [ ] Order summary section displays:
  - Platform name
  - Status badge
  - Payment status
  - Order Amount (500 THB)
  - Total Units (5)
  - SKUs (2 items)
  - Order Date, Paid Date, Shipped Date, Delivered Date
- [ ] Line Items table shows 2 rows:
  - Product Name for each SKU
  - Quantity (2 and 3)
  - Unit Price
  - Subtotal (line-level amounts)
- [ ] Drawer can be closed

## Test Case 5: Filters Work in Both Views
**Goal**: Verify platform, status, payment filters apply correctly

### Steps:
1. Apply platform filter (e.g., "TikTok")
2. Switch between Order View and Line View

### Expected Results:
- [ ] Filter persists when switching views
- [ ] Order View shows filtered grouped orders
- [ ] Line View shows filtered lines
- [ ] Summary cards reflect filtered data

## Test Case 6: Search Works in Both Views
**Goal**: Verify search by order_id, external_order_id, product_name

### Steps:
1. Search for order ID "12345"
2. Check Order View results
3. Switch to Line View
4. Check Line View results

### Expected Results:
- [ ] Order View shows 1 grouped row
- [ ] Line View shows 2 lines matching order ID
- [ ] Search by product name works in both views

## Test Case 7: Date Basis Toggle
**Goal**: Verify date filtering works with both order_date and paid_at

### Steps:
1. Select "Order View"
2. Switch date basis to "Paid Date"
3. Set date range to include test order's paid_at
4. Check summary cards

### Expected Results:
- [ ] Orders filtered by paid_at date
- [ ] Summary cards show correct aggregated metrics
- [ ] Switching to "Order Date" basis updates results

## Test Case 8: Pagination (Order View)
**Goal**: Verify pagination counts DISTINCT orders

### Pre-Condition:
- Database has 25 orders (some multi-SKU = 40 total lines)

### Steps:
1. Set page size to 20
2. Verify pagination controls

### Expected Results (Order View):
- [ ] Total count shows 25 orders (NOT 40)
- [ ] Page 1 shows 20 orders
- [ ] Page 2 shows 5 orders

### Expected Results (Line View):
- [ ] Total count shows 40 lines
- [ ] Page 1 shows 20 lines
- [ ] Page 2 shows 20 lines

## Test Case 9: CSV Export
**Goal**: Verify export respects current view

### Steps:
1. Select Order View
2. Apply filter (e.g., platform = TikTok)
3. Click "Export CSV"
4. Open downloaded file

### Expected Results (Order View Export):
- [ ] CSV has 1 row per order_id
- [ ] Columns include: order_id, total_units, order_amount, sku_count
- [ ] Multi-SKU order shows aggregated data

### Steps (Line View):
1. Switch to Line View
2. Click "Export CSV"
3. Open downloaded file

### Expected Results (Line View Export):
- [ ] CSV has 1 row per SKU line
- [ ] Columns include: order_id, product_name, quantity, unit_price, total_amount
- [ ] Multi-SKU order shows multiple rows

## Test Case 10: Refund Badge (Future Enhancement)
**Status**: Optional / Not Implemented Yet

If TikTok data includes refund fields:
- [ ] Order View shows refund badge (none/partial/full)
- [ ] Badge derived from line-level refund_amount or return_qty

## Regression Tests

### Test Case R1: Manual Order Creation
- [ ] Add manual order via "Add Order" button
- [ ] Verify it appears in both views
- [ ] Manual orders have order_id starting with "MAN-"

### Test Case R2: Order Edit (Line View Only)
- [ ] Switch to Line View
- [ ] Edit a line item
- [ ] Verify changes reflected in Order View after refresh

### Test Case R3: Order Delete (Line View Only)
- [ ] Switch to Line View
- [ ] Delete a line item
- [ ] If last line of order deleted, verify order disappears from Order View

## Known Limitations

1. **Order View Actions**: Edit/Delete disabled in Order View (must use Line View or Drawer)
2. **Aggregation Assumption**: Assumes `total_amount` is identical across lines for same order_id
3. **Refund Tracking**: Not yet implemented (requires TikTok refund data parsing)

## Acceptance Criteria

All tests must pass:
- [x] Order View default display
- [x] Aggregation prevents multi-SKU inflation
- [x] Summary cards accurate
- [x] Line View toggle works
- [x] Order Detail Drawer functional
- [x] Filters work in both views
- [x] Pagination accurate
- [x] Export respects view

## Risk Areas

1. **Performance**: Grouping logic runs client-side (may be slow with 1000+ orders)
   - **Mitigation**: Consider moving aggregation to Postgres query or Edge Function
2. **Data Inconsistency**: If `total_amount` varies across lines for same order_id
   - **Mitigation**: Use MAX() and log warning if mismatch detected
3. **Search in Order View**: Search by product_name requires joining all lines
   - **Mitigation**: Current implementation fetches all lines then groups (acceptable for MVP)

## Performance Benchmarks

- [ ] Order View load time < 2s with 100 orders
- [ ] Line View load time < 2s with 500 lines
- [ ] Drawer open time < 500ms
- [ ] CSV export time < 5s with 500 orders

## Sign-Off

- [ ] Developer tested all cases
- [ ] Product owner verified UX
- [ ] Ready for production

**Tested By**: _____________
**Date**: _____________
**Notes**: _____________
