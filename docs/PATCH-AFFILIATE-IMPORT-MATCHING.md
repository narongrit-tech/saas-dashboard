# Patch: Affiliate Import Order Matching Fix (v2)

**Date:** 2026-01-30
**Issue:** Affiliate import showed matched orders but inserted 0 rows into `order_attribution`
**Root Cause:** PostgREST `.or()` pattern with `.in()` filters was broken; order matching failed

---

## Problem Summary

### Symptoms
- UI preview showed matched orders and total commission
- Terminal log: `existingOrders: 0` while orders existed in `sales_orders`
- Database `order_attribution` table was empty after import
- Import was marked as "already imported" even with 0 rows inserted
- File could not be re-imported due to `import_batches` dedup check

### Root Cause
The affiliate import code in `affiliate-import-actions.ts` was:
1. Using broken PostgREST pattern: `.or('order_id.in.(...),external_order_id.in.(...)')`
   - This pattern doesn't work correctly with Supabase PostgREST
   - Results in 0 matches even when orders exist
2. Creating `import_batches` record before validating that rows would be inserted
3. Not rolling back the batch when `insertedCount === 0` or `matchedCount === 0`

---

## Solution

### Code Changes
**File:** `frontend/src/app/(dashboard)/reports/profit/affiliate-import-actions.ts`

#### 1. Fixed Order Matching Logic (Preview & Import)
**REPLACED broken `.or()` pattern with 2 separate queries:**

- Query 1: `.in('order_id', chunkIds)`
- Query 2: `.in('external_order_id', chunkIds)`
- Run both queries in parallel using `Promise.all()`
- Merge and deduplicate results
- Build mapping: `rawId (from file) => canonical order_id (from sales_orders)`
- Always store `order_attribution.order_id` using the canonical `order_id` value

**New Helper Functions:**
```typescript
// Dedupe rows by composite key
function uniqSalesOrders(rows: SalesOrderKeyRow[]): SalesOrderKeyRow[]

// Fetch orders using 2 queries, merge, and build mapping
async function fetchExistingOrdersByIds(
  supabase: any,
  userId: string,
  chunkIds: string[]
): Promise<{ existing: SalesOrderKeyRow[]; idToCanonical: Map<string, string> }>
```

**Mapping Logic:**
```typescript
// Run 2 parallel queries
const [byOrderId, byExternalId] = await Promise.all([
  supabase.from('sales_orders').select('order_id, external_order_id')
    .eq('created_by', userId).in('order_id', chunkIds),
  supabase.from('sales_orders').select('order_id, external_order_id')
    .eq('created_by', userId).in('external_order_id', chunkIds)
])

// Merge and dedupe
const merged = uniqSalesOrders([...byOrderId, ...byExternalId])

// Build mapping
for (const row of merged) {
  if (row.order_id) idToCanonical.set(row.order_id, row.order_id)
  if (row.external_order_id) idToCanonical.set(row.external_order_id, row.order_id)
}

// When building order_attribution rows:
const canonicalOrderId = idToCanonicalOrderId.get(rawOrderId)
if (canonicalOrderId) {
  attribution.order_id = canonicalOrderId // Always use canonical
}
```

#### 2. Added Rollback Logic
**Before upsert:**
- If `attributionsToUpsert.length === 0`, delete the `import_batches` record
- Return error: "No orders matched. Please import sales orders first."

**After upsert:**
- If `insertedCount === 0` (unexpected silent failure), delete the `import_batches` record
- Also delete any orphan `order_attribution` rows for that batch (safety)
- Return error with diagnostic message

#### 3. Added Dev Logging
- Sample raw order IDs from file (first 5)
- Sample mappings: `rawId => canonicalId` (first 5)
- Match counts: `matched`, `orphan`, `total`
- Canonical IDs being inserted (first 5)

All logs are behind `NODE_ENV === 'development'` check.

---

## QA & Verification

### SQL Queries

#### 1. Verify Order Matching for Known ID
```sql
-- Check if order exists in sales_orders (both columns)
SELECT
  order_id,
  external_order_id,
  product_name,
  marketplace,
  order_date
FROM sales_orders
WHERE order_id = '582067461139694786'
   OR external_order_id = '582067461139694786';
```

#### 2. Verify Inserted Attributions
```sql
-- Check if attribution was inserted for your user
SELECT
  oa.order_id,
  oa.attribution_type,
  oa.affiliate_channel_id,
  oa.commission_amt,
  oa.commission_amt_organic,
  oa.commission_amt_shop_ad,
  oa.commission_type,
  oa.source_report,
  oa.created_at
FROM order_attribution oa
WHERE oa.created_by = '<user_uuid>'
ORDER BY oa.created_at DESC
LIMIT 20;
```

#### 3. Count Attributions by User
```sql
-- Total attributions per user
SELECT
  created_by,
  COUNT(*) as attribution_count,
  SUM(commission_amt) as total_commission
FROM order_attribution
GROUP BY created_by;
```

#### 4. Check Import Batches
```sql
-- Recent affiliate import batches
SELECT
  id,
  file_name,
  status,
  inserted_count,
  skipped_count,
  notes,
  created_at
FROM import_batches
WHERE marketplace = 'affiliate'
  AND report_type = 'affiliate_sales_th'
ORDER BY created_at DESC
LIMIT 10;
```

#### 5. Verify Canonical Mapping
```sql
-- Find all orders where external_order_id differs from order_id
SELECT
  order_id,
  external_order_id,
  marketplace,
  order_date
FROM sales_orders
WHERE external_order_id IS NOT NULL
  AND external_order_id != order_id
LIMIT 20;
```

---

## Acceptance Criteria

✅ **Criterion 1:** Import file containing order ID `582067461139694786` (as either `order_id` or `external_order_id`) results in:
   - `matchedCount > 0` in preview
   - Rows inserted into `public.order_attribution`

✅ **Criterion 2:** If file produces 0 insertable rows:
   - UI does NOT show "already imported" on retry
   - `import_batches` record is deleted (does not block re-import)

✅ **Criterion 3:** No references to non-existent columns:
   - Code does NOT reference `platform_order_id` or any other non-existent column
   - Only uses `order_id` and `external_order_id`

---

## Regression Tests (Manual Checklist)

### Test Case A: Known Order ID (582067461139694786)
**Goal:** Verify that an order with ID `582067461139694786` (in either column) gets matched and inserted

**Steps:**
1. Verify order exists in sales_orders:
   ```sql
   SELECT order_id, external_order_id, product_name, marketplace
   FROM sales_orders
   WHERE order_id = '582067461139694786'
      OR external_order_id = '582067461139694786';
   ```
2. Import affiliate file containing order ID `582067461139694786`
3. Check preview shows `matchedCount >= 1`
4. Confirm import success
5. Verify insertion:
   ```sql
   SELECT order_id, commission_amt, affiliate_channel_id, created_at
   FROM order_attribution
   WHERE order_id = (
     SELECT order_id FROM sales_orders
     WHERE order_id = '582067461139694786'
        OR external_order_id = '582067461139694786'
   )
   ORDER BY created_at DESC
   LIMIT 1;
   ```

**Expected:**
- `matchedCount = 1` in preview
- Import succeeds with `insertedCount >= 1`
- Row exists in `order_attribution` with canonical `order_id`

### Test Case B: Non-Existing Order IDs
**Goal:** Verify that import with non-matching orders does NOT create orphan batch record

**Steps:**
1. Import affiliate file with fake order IDs (e.g., `FAKE-ORDER-123`)
2. Check preview shows `matchedCount = 0`, `orphanCount > 0`
3. Attempt import
4. Verify error message: "No orders matched. Please import sales orders first."
5. Check no orphan batch:
   ```sql
   SELECT id, file_name, status, inserted_count
   FROM import_batches
   WHERE marketplace = 'affiliate'
     AND inserted_count = 0
   ORDER BY created_at DESC
   LIMIT 5;
   ```
6. Verify user can retry the same file (not blocked by dedup)

**Expected:**
- Preview: `matchedCount = 0`, `orphanCount = N`
- Import fails with clear error
- No `import_batches` record created
- File can be re-imported without "already imported" error

---

## Testing Checklist (Detailed)

### Test Case 1: Order ID in `order_id` Column
1. Ensure order exists: `SELECT * FROM sales_orders WHERE order_id = 'X123'`
2. Import affiliate file with order ID `X123`
3. Verify: `matchedCount = 1` in preview
4. Confirm: Row inserted in `order_attribution` with `order_id = 'X123'`

### Test Case 2: Order ID in `external_order_id` Column
1. Ensure order exists: `SELECT * FROM sales_orders WHERE external_order_id = 'Y456'`
2. Import affiliate file with order ID `Y456`
3. Verify: `matchedCount = 1` in preview
4. Confirm: Row inserted in `order_attribution` with `order_id = <canonical_id>`

### Test Case 3: Mixed Column Matching
1. Import file with multiple order IDs, some in `order_id`, some in `external_order_id`
2. Verify: All matched orders are counted correctly
3. Confirm: All matched attributions use canonical `order_id`

### Test Case 4: No Matched Orders
1. Import affiliate file with order IDs that don't exist in `sales_orders`
2. Verify: Error message shown in UI
3. Verify: No `import_batches` record created
4. Verify: Can retry the same file (not blocked by dedup)

### Test Case 5: Retry After Fix
1. If a file was previously "stuck" as imported with 0 rows:
   - Manually delete the bad `import_batches` record: `DELETE FROM import_batches WHERE id = 'xxx'`
2. Re-import the same file
3. Verify: Rows are inserted successfully

---

## Database Schema Reference

### `sales_orders` Columns (Relevant)
- `order_id` (VARCHAR(100)) - Primary identifier used for joins and references
- `external_order_id` (TEXT) - Original platform order ID (e.g., TikTok Order ID)
- Added in: `migration-008-sales-ux-v2.sql`

### `order_attribution` Columns (Relevant)
- `order_id` (VARCHAR) - Foreign key reference to `sales_orders.order_id`
- `attribution_type` (TEXT) - 'internal_affiliate', 'external_affiliate', 'paid_ads', 'organic'
- `affiliate_channel_id` (TEXT)
- `commission_amt` (NUMERIC)
- `commission_amt_organic` (NUMERIC)
- `commission_amt_shop_ad` (NUMERIC)
- `commission_type` (TEXT) - 'organic', 'shop_ad', 'mixed', 'none'
- `import_batch_id` (UUID) - References `import_batches.id`
- `created_by` (UUID) - User who imported

### Unique Constraint
`(created_by, order_id)` - Prevents duplicate attributions per user per order

---

## Notes

- The fix ensures backward compatibility: existing imports are unaffected
- Canonical `order_id` is always used for `order_attribution.order_id` to ensure joins work correctly
- The rollback logic prevents orphan `import_batches` records that block re-imports
- Dev logs help diagnose future issues without exposing sensitive data in production

---

## Related Files
- Code: `frontend/src/app/(dashboard)/reports/profit/affiliate-import-actions.ts`
- Types: `frontend/src/types/profit-reports.ts`
- Migration: `database-scripts/migration-008-sales-ux-v2.sql`
