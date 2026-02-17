# Test Plan: Returns Tracking Number Search

## Date
2026-02-17

## Fix Summary
Enable tracking number search in Returns page by populating `tracking_number` column during sales import.

## Pre-Deployment Verification

### 1. Database Schema Check
```bash
cd frontend
export $(cat .env.local | xargs)
npx tsx src/scripts/check-tracking.ts
```

**Expected Output:**
- Column `tracking_number` exists: YES
- Index `idx_sales_orders_tracking_number` exists: YES
- Orders with tracking_number: 1000+ (33%+)

### 2. Backfill Existing Data
```bash
cd frontend
export $(cat .env.local | xargs)
npx tsx src/scripts/backfill-tracking.ts
```

**Expected Output:**
- Backfilled: 1000+ orders
- Errors: 0
- Search test: PASS

### 3. Code Review Checklist
- [ ] `frontend/src/lib/sales-parser.ts` - tracking_number extracted from Excel
- [ ] `frontend/src/app/(dashboard)/sales/sales-import-actions.ts` - tracking_number included in upsert
- [ ] `frontend/src/types/sales-import.ts` - ParsedSalesRow includes tracking_number
- [ ] `frontend/src/app/(dashboard)/returns/actions.ts` - Search query unchanged (already correct)
- [ ] `frontend/src/app/(dashboard)/returns/page.tsx` - UI unchanged (already correct)

## Manual Test Cases

### Test 1: Import New Sales Orders
**Objective:** Verify new imports populate tracking_number column

**Steps:**
1. Navigate to `/sales/import`
2. Upload fresh TikTok OrderSKUList export file
3. Wait for import to complete
4. Check database:
   ```sql
   SELECT COUNT(*) as with_tracking
   FROM sales_orders
   WHERE import_batch_id = '<latest-batch-id>'
     AND tracking_number IS NOT NULL;
   ```

**Expected Result:**
- 70-90% of imported orders have `tracking_number` populated
- Some orders may not have tracking (not yet shipped)

**Pass Criteria:** At least 70% of orders have tracking_number

---

### Test 2: Search by Tracking Number (Exact)
**Objective:** Verify exact tracking number search works

**Steps:**
1. Get sample tracking number from database:
   ```sql
   SELECT tracking_number FROM sales_orders WHERE tracking_number IS NOT NULL LIMIT 1;
   ```
2. Navigate to `/returns`
3. Type/paste tracking number in search box
4. Press Enter

**Expected Result:**
- Order found immediately
- If 1 result: Drawer opens automatically
- If 2+ results: List of orders displayed
- Search completes in <500ms

**Pass Criteria:** Order is found and displayed

---

### Test 3: Search by Tracking Number (Barcode Scan Simulation)
**Objective:** Verify barcode scanner workflow

**Steps:**
1. Navigate to `/returns`
2. Verify search input is auto-focused (cursor in box)
3. Type tracking number + press Enter quickly (simulate scan)
4. Verify drawer opens automatically (if 1 result)
5. Close drawer
6. Verify focus returns to search input

**Expected Result:**
- Auto-focus works on page load
- Single result auto-opens drawer
- Focus returns after drawer closes (ready for next scan)

**Pass Criteria:** Workflow is smooth, no manual clicks needed

---

### Test 4: Search by External Order ID (Regression Test)
**Objective:** Ensure existing search functionality still works

**Steps:**
1. Get sample external_order_id:
   ```sql
   SELECT external_order_id FROM sales_orders LIMIT 1;
   ```
2. Navigate to `/returns`
3. Type external_order_id in search box
4. Press Enter

**Expected Result:**
- Order found (same as before fix)
- Drawer opens or list displayed

**Pass Criteria:** Existing functionality unchanged

---

### Test 5: Case Insensitivity
**Objective:** Verify search is case-insensitive

**Steps:**
1. Get tracking number: `790007398611`
2. Search using: `790007398611` (original)
3. Search using: `790007398611` (lowercase - actually same since numeric)
4. For alpha-numeric tracking, test with: `ABC123` vs `abc123`

**Expected Result:**
- Both searches find the same order
- ILIKE pattern matching works

**Pass Criteria:** Case does not matter

---

### Test 6: Partial Match
**Objective:** Verify partial tracking number search

**Steps:**
1. Get full tracking: `790007398611`
2. Search partial: `790007` (first 6 digits)

**Expected Result:**
- Order found (may find multiple if prefix matches multiple orders)

**Pass Criteria:** Partial match works

---

### Test 7: No Results
**Objective:** Verify error handling for non-existent tracking

**Steps:**
1. Search for: `INVALID99999999`

**Expected Result:**
- Error message: "ไม่พบ order ที่ค้นหา"
- No drawer opens
- No crash/blank screen

**Pass Criteria:** Graceful error handling

---

### Test 8: Multiple Results
**Objective:** Verify list display for multiple matches

**Steps:**
1. Find tracking prefix that matches multiple orders:
   ```sql
   SELECT tracking_number, COUNT(*)
   FROM sales_orders
   WHERE tracking_number LIKE '7900%'
   GROUP BY LEFT(tracking_number, 4)
   HAVING COUNT(*) > 1
   LIMIT 1;
   ```
2. Search using that prefix

**Expected Result:**
- List of matching orders displayed
- Each order card shows:
  - External Order ID
  - Tracking number badge
  - Platform and status
  - Shipped date
- Click any order → drawer opens

**Pass Criteria:** Multiple results handled correctly

---

### Test 9: Performance Test
**Objective:** Verify search is fast with indexes

**Steps:**
1. Open browser DevTools → Network tab
2. Search for tracking number
3. Check response time

**Expected Result:**
- API response time: <500ms
- Total page load: <1s
- No UI lag

**Pass Criteria:** Search is fast enough for real-time scanning

---

### Test 10: Mobile/Tablet
**Objective:** Verify responsive design on small screens

**Steps:**
1. Open `/returns` on mobile device or browser mobile mode
2. Search for tracking number
3. Verify drawer opens correctly

**Expected Result:**
- Search input is large enough for scanning (h-14)
- Drawer slides in from right
- Order details readable on small screen
- Return form usable on mobile

**Pass Criteria:** Fully functional on mobile

---

## Automated Tests (Future)

### Unit Tests
```typescript
// frontend/src/lib/sales-parser.test.ts
describe('parseTikTokFile', () => {
  it('should extract tracking_number from Tracking ID column', () => {
    // Test parser extracts tracking_number field
  })
})

// frontend/src/app/(dashboard)/returns/actions.test.ts
describe('searchOrdersForReturn', () => {
  it('should find order by tracking_number', () => {
    // Test search query includes tracking_number
  })
})
```

### Integration Tests
```typescript
// cypress/e2e/returns-search.cy.ts
describe('Returns Search', () => {
  it('should search by tracking number and open drawer', () => {
    cy.visit('/returns')
    cy.get('input').type('790007398611{enter}')
    cy.get('[data-testid=return-drawer]').should('be.visible')
  })
})
```

## Database Verification Queries

### Check tracking_number population rate
```sql
SELECT
  source_platform,
  COUNT(*) as total_orders,
  COUNT(tracking_number) as with_tracking,
  ROUND(COUNT(tracking_number)::numeric / COUNT(*)::numeric * 100, 2) as percent
FROM sales_orders
GROUP BY source_platform
ORDER BY total_orders DESC;
```

**Expected:**
- tiktok_shop: 70-90% with tracking
- Other platforms: Lower (if not supported)

### Check index usage
```sql
EXPLAIN ANALYZE
SELECT id, external_order_id, tracking_number
FROM sales_orders
WHERE created_by = 'USER_ID'
  AND tracking_number ILIKE '%790007%'
LIMIT 10;
```

**Expected:**
- Uses `idx_sales_orders_tracking_number` index
- Execution time: <50ms

### Check recent imports
```sql
SELECT
  import_batch_id,
  COUNT(*) as total_rows,
  COUNT(tracking_number) as with_tracking,
  ROUND(COUNT(tracking_number)::numeric / COUNT(*)::numeric * 100, 2) as percent
FROM sales_orders
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY import_batch_id
ORDER BY MAX(created_at) DESC;
```

**Expected:**
- Recent imports (after fix): 70%+ with tracking
- Old imports (before backfill): 0% or 33% (if backfilled)

## Rollback Plan

If issues are discovered after deployment:

### Option 1: Code Rollback
```bash
git revert <commit-hash>
npm run build
# Restart server
```

**Impact:** New imports will not populate tracking_number, but search will still work for existing data

### Option 2: Disable Returns Page
```typescript
// frontend/src/app/(dashboard)/returns/page.tsx
export default function ReturnsPage() {
  return <div>Returns page temporarily disabled for maintenance</div>
}
```

**Impact:** Returns workflow blocked, but no data corruption

### Option 3: Revert Backfill
```sql
-- Only if backfill caused issues (unlikely)
UPDATE sales_orders
SET tracking_number = NULL
WHERE tracking_number IS NOT NULL
  AND import_batch_id NOT IN (
    SELECT id FROM import_batches WHERE created_at > '2026-02-17'
  );
```

**Impact:** Returns to pre-backfill state, search will not work until re-backfilled

## Post-Deployment Monitoring

### Metrics to Track
1. **Returns search success rate**
   - Queries with results / Total queries
   - Target: >80%

2. **Returns search performance**
   - Average query time
   - Target: <500ms

3. **Tracking number population rate**
   - Orders with tracking / Total orders (last 7 days)
   - Target: >70%

4. **Returns page error rate**
   - Server errors / Total requests
   - Target: <1%

### Monitoring Queries
```sql
-- Run daily for first week after deployment
SELECT
  DATE(order_date) as date,
  COUNT(*) as orders_imported,
  COUNT(tracking_number) as with_tracking,
  ROUND(COUNT(tracking_number)::numeric / COUNT(*)::numeric * 100, 2) as percent
FROM sales_orders
WHERE order_date >= CURRENT_DATE - 7
GROUP BY DATE(order_date)
ORDER BY date DESC;
```

## Sign-Off

### Developer Sign-Off
- [ ] Code changes tested locally
- [ ] All manual test cases passed
- [ ] Performance verified (<500ms search)
- [ ] No breaking changes to existing functionality

### QA Sign-Off
- [ ] All test cases in test plan executed
- [ ] Edge cases verified (no results, multiple results, etc.)
- [ ] Mobile/tablet tested
- [ ] Performance benchmarks met

### Product Sign-Off
- [ ] User workflow tested end-to-end
- [ ] Barcode scanner simulation passed
- [ ] Returns processing workflow functional

## Deployment Checklist

- [x] Code changes committed
- [x] Database migration verified (migration-055 already applied)
- [x] Backfill script tested
- [ ] Run backfill on production (see backfill-tracking.ts)
- [ ] Build frontend: `npm run build`
- [ ] Deploy to production
- [ ] Verify tracking_number population in production DB
- [ ] Test Returns search with real tracking number
- [ ] Monitor error logs for 24 hours
- [ ] Mark task as complete in project tracking

## Notes
- Migration-055 already created the schema (tracking_number column and indexes)
- This fix only adds the data pipeline to populate the column
- Backfill is optional but recommended for existing orders
- Future imports will automatically populate tracking_number
