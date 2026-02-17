# QA Checklist: COGS Coverage Checker

## FEATURE SUMMARY
COGS Coverage Checker (Allocation Completeness Audit) - read-only audit feature to verify all shipped orders have COGS allocations.

## FILES CHANGED
1. `frontend/src/app/(dashboard)/inventory/actions.ts` (+296 lines)
   - Added `getCOGSCoverageStats()` - calculate coverage metrics
   - Added `getMissingAllocations()` - get list of unallocated orders
   - Added `exportMissingAllocationsCSV()` - server-side CSV export
   - Added types: `COGSCoverageStats`, `MissingAllocation`

2. `frontend/src/components/inventory/MovementsTab.tsx` (+38 lines)
   - Added date range filter (startDate, endDate) with MTD default
   - Added "Coverage Check" tab (now default tab)
   - Integrated COGSCoveragePanel component

3. `frontend/src/components/inventory/COGSCoveragePanel.tsx` (new file, 11KB)
   - Displays coverage statistics in colored cards
   - Shows missing allocations table (sortable by shipped_at)
   - Implements CSV export button
   - Visual indicators (green/yellow/red) based on coverage %

## BACKEND LOGIC

### Expected Lines Query
```sql
SELECT order_id, seller_sku, quantity
FROM sales_orders
WHERE shipped_at BETWEEN ? AND ?
  AND shipped_at IS NOT NULL
  AND status_group != 'ยกเลิกแล้ว'
  AND created_by = auth.uid()
```

### Allocated Lines Query
```sql
SELECT order_id, sku_internal, SUM(qty) as allocated_qty
FROM inventory_cogs_allocations
WHERE is_reversal = false
  AND shipped_at BETWEEN ? AND ?
  AND created_by = auth.uid()
GROUP BY order_id, sku_internal
```

### Coverage Calculation
- `missing_lines = expected_lines - allocated_lines`
- `coverage_percent = (allocated_lines / expected_lines) * 100`
- `duplicate_count = COUNT of (order_id, sku) pairs with > 1 allocation`

## MANUAL TEST SCENARIOS

### Scenario 1: Perfect Coverage (100%)
**Setup:**
1. Go to Inventory > Movements > Coverage Check tab
2. Set date range where all shipped orders have COGS allocations

**Expected:**
- Coverage % = 100% (green indicator with checkmark)
- Missing Lines = 0
- Message: "ทุก order ถูก allocate แล้ว"
- Missing Allocations table is empty or hidden

**Test Commands:**
```sql
-- Check coverage manually
SELECT
  COUNT(*) as expected,
  (SELECT COUNT(DISTINCT order_id || '|' || sku_internal)
   FROM inventory_cogs_allocations
   WHERE is_reversal = false) as allocated
FROM sales_orders
WHERE shipped_at BETWEEN '2026-02-01' AND '2026-02-17'
  AND shipped_at IS NOT NULL
  AND status_group != 'ยกเลิกแล้ว';
```

---

### Scenario 2: Partial Coverage (90%)
**Setup:**
1. Find a date range where some orders are unallocated
2. Verify with SQL query first

**Expected:**
- Coverage % between 90-99% (yellow indicator with warning icon)
- Missing Lines > 0
- Message: "Coverage ใกล้สมบูรณ์แล้ว..."
- Missing Allocations table shows unallocated orders

**Verification:**
- Each row in Missing table should have:
  - order_id (clickable)
  - seller_sku
  - quantity
  - shipped_at (formatted Bangkok time)
  - status_group badge

---

### Scenario 3: Low Coverage (<90%)
**Setup:**
1. Set date range at beginning of month (before COGS run)
2. Or filter to specific range with many unallocated orders

**Expected:**
- Coverage % < 90% (red indicator with alert icon)
- Missing Lines > 0
- Message: "Coverage ต่ำ - มี orders ที่ยังไม่ได้ allocate จำนวนมาก"
- Missing Allocations table shows all unallocated orders

---

### Scenario 4: Duplicate Detection
**Setup:**
1. Manually create duplicate allocation in DB (testing only):
```sql
-- Find an existing allocation
SELECT * FROM inventory_cogs_allocations LIMIT 1;

-- Insert duplicate (change id)
INSERT INTO inventory_cogs_allocations
(order_id, sku_internal, shipped_at, method, qty, unit_cost_used, amount, is_reversal, created_by)
SELECT order_id, sku_internal, shipped_at, method, qty, unit_cost_used, amount, is_reversal, created_by
FROM inventory_cogs_allocations
WHERE id = '<existing_id>';
```

**Expected:**
- Duplicate count > 0
- Warning message: "ตรวจพบ X รายการที่มี allocations ซ้ำซ้อน"
- Duplicate stat card shows count in red

**Cleanup:**
```sql
-- Remove test duplicate
DELETE FROM inventory_cogs_allocations
WHERE id = '<duplicate_id>';
```

---

### Scenario 5: Date Filter Integration
**Test Steps:**
1. Set date range to MTD (default)
2. Note the coverage %
3. Change to last month (full month)
4. Verify stats update automatically
5. Change to custom range (e.g., Feb 1-7)
6. Verify stats recalculate

**Expected:**
- Stats update when date changes (no page refresh needed)
- Stats cards show correct counts for selected range
- Missing table updates with new date range

---

### Scenario 6: CSV Export
**Test Steps:**
1. Set date range with missing allocations
2. Click "Export CSV" button
3. Verify download starts
4. Open CSV file

**Expected:**
- Button shows "กำลัง Export..." during export
- CSV downloads with filename: `missing-cogs-allocations-YYYY-MM-DD-to-YYYY-MM-DD.csv`
- CSV columns: `order_id, sku, qty, shipped_at, order_status`
- CSV data matches table display
- All rows are properly quoted

**Sample CSV:**
```csv
order_id,sku,qty,shipped_at,order_status
"TT123456","SKU-A","2","2026-02-15T10:30:00+07:00","ที่จัดส่ง"
"TT123457","SKU-B","1","2026-02-15T11:00:00+07:00","ที่จัดส่ง"
```

---

### Scenario 7: RLS Verification
**Test Steps:**
1. Login as User A
2. Check coverage stats (note numbers)
3. Logout, login as User B
4. Check coverage stats

**Expected:**
- User A sees only their own data
- User B sees only their own data
- Counts are different (unless they have identical data)
- No cross-user data leakage

---

### Scenario 8: Visual Indicators
**Test Coverage Thresholds:**

| Coverage % | Card Color | Icon | Message |
|------------|-----------|------|---------|
| 100% | Green | CheckCircle | ทุก order ถูก allocate แล้ว |
| 90-99% | Yellow | AlertCircle | Coverage ใกล้สมบูรณ์แล้ว |
| <90% | Red | AlertCircle | Coverage ต่ำ |

**Verify:**
- Coverage card background matches threshold
- Icon matches threshold
- Text color matches threshold
- Message matches threshold

---

### Scenario 9: Empty State
**Test Steps:**
1. Set date range where NO orders were shipped
2. Verify display

**Expected:**
- Expected Lines = 0
- Allocated Lines = 0
- Missing Lines = 0
- Coverage % = 100% (by default when no orders)
- No missing allocations table displayed

---

### Scenario 10: Performance with Large Dataset
**Test Steps:**
1. Set date range to full month with many orders (>1000)
2. Measure load time
3. Check if pagination/limits work

**Expected:**
- Query completes in <5 seconds
- Stats are accurate
- Missing table shows all results (consider pagination if >500 rows)
- No timeout errors

---

## EDGE CASES

### Edge Case 1: seller_sku vs sku_internal mismatch
**Issue:** sales_orders uses `seller_sku`, allocations use `sku_internal`

**Verification:**
```sql
-- Check if there are mismatches
SELECT DISTINCT so.seller_sku, ca.sku_internal
FROM sales_orders so
JOIN inventory_cogs_allocations ca ON so.order_id = ca.order_id
WHERE so.seller_sku != ca.sku_internal;
```

**Expected:** No mismatches (SKU canonicalization should handle this)

---

### Edge Case 2: Multi-SKU Orders
**Note:** sales_orders table has 1 row per SKU (not per order)

**Verification:**
```sql
-- Check if order_id appears multiple times
SELECT order_id, COUNT(*) as sku_count
FROM sales_orders
WHERE shipped_at IS NOT NULL
GROUP BY order_id
HAVING COUNT(*) > 1;
```

**Expected:** Coverage checker handles this correctly (counts by order_id + sku pair)

---

### Edge Case 3: Returns (is_reversal = true)
**Test:** Verify returns are excluded from coverage check

**Query:**
```sql
SELECT * FROM inventory_cogs_allocations
WHERE is_reversal = true
LIMIT 5;
```

**Expected:**
- Returns (is_reversal=true) are NOT counted in allocated_lines
- Only sale allocations (is_reversal=false) are counted

---

## REGRESSION CHECKS

1. Verify existing COGS Allocations tab still works
2. Verify Receipt Layers tab still works
3. Verify Apply COGS (MTD) modal still works
4. Verify other inventory features (Products, Opening Balance, Bundles) still work

---

## BROWSER COMPATIBILITY
Test in:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Mobile Safari (iOS)
- Chrome Mobile (Android)

---

## ACCESSIBILITY
- [ ] Keyboard navigation works (Tab through date inputs, table rows)
- [ ] Screen reader announces stats properly
- [ ] Color indicators have text fallbacks (not color-only)
- [ ] Export button has proper aria-label

---

## SECURITY
- [x] RLS enforced (all queries filter by created_by)
- [x] No SQL injection (using parameterized queries)
- [x] CSV export is server-side (no client-side data manipulation)
- [x] No sensitive data exposed in logs

---

## PERFORMANCE BENCHMARKS

### Target Performance:
- Load time: < 3 seconds (for typical MTD range)
- Export time: < 5 seconds (for <1000 rows)
- Date filter change: < 2 seconds

### Optimization Notes:
- Queries use indexed columns (shipped_at, order_id, created_by)
- No N+1 queries (single query per stat)
- Minimal client-side processing

---

## COMMIT CHECKLIST
- [ ] All test scenarios pass
- [ ] No console errors
- [ ] No TypeScript errors
- [ ] Lint passes
- [ ] Build succeeds
- [ ] RLS verified
- [ ] CSV export works
- [ ] Visual indicators correct
- [ ] Date filter integration works

---

## COMMIT MESSAGE
```
feat(inventory): add COGS coverage checker

GOAL:
รู้ให้ชัดว่า COGS allocate ครบทุกรายการขายที่ควรตัดสต็อกแล้วหรือยัง

IMPLEMENTATION:
- Add Coverage Check tab in Inventory > Movements
- Display coverage stats: expected, allocated, missing, coverage %, duplicates
- Visual indicators: green (100%), yellow (90-99%), red (<90%)
- Missing allocations table with sortable columns
- Server-side CSV export
- Date range filter (defaults to MTD)
- RLS enforced on all queries

TECHNICAL:
- Backend: getCOGSCoverageStats(), getMissingAllocations(), exportMissingAllocationsCSV()
- Frontend: COGSCoveragePanel component with stats cards and table
- Query: expected (sales_orders) vs allocated (inventory_cogs_allocations)
- Uses is_reversal=false to exclude returns from coverage

FILES:
- frontend/src/app/(dashboard)/inventory/actions.ts (+296)
- frontend/src/components/inventory/MovementsTab.tsx (+38)
- frontend/src/components/inventory/COGSCoveragePanel.tsx (new)

DONE WHEN:
✅ Coverage panel shows correct stats
✅ Coverage = 100% when all orders allocated
✅ Missing table shows unallocated orders
✅ Export CSV works (server-side)
✅ Duplicate detection works
✅ Visual indicators correct
✅ RLS verified
✅ Date filter integration works
```
