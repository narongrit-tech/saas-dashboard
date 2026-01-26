# Sales Import Idempotency Fix

**Date:** 2026-01-26
**Issue:** Sales Orders import fails due to missing `order_line_hash` column

---

## Problem

Import failed at chunk 1/3 with error:
```
Could not find the 'order_line_hash' column of 'sales_orders' in the schema cache
```

Code was attempting to insert `order_line_hash` (lines 604, 877 in `sales-import-actions.ts`), but the database column didn't exist.

---

## Solution

### 1. Database Changes (Migration 024)

**File:** `database-scripts/migration-024-sales-order-line-hash.sql`

**Changes:**
- Added column: `sales_orders.order_line_hash TEXT`
- Added unique index: `idx_sales_orders_order_line_hash_unique ON (created_by, order_line_hash)`
- Backfilled existing imported rows with computed hash

**Hash Formula:**
```
SHA256(created_by|source_platform|external_order_id|product_name|quantity|total_amount)
```

**Purpose:**
- Deterministic deduplication key per user per order line
- Prevents duplicate imports of the same SKU line item
- Enables idempotent re-imports (safe to import same file multiple times)

---

### 2. Backend Changes (Import Logic)

**File:** `frontend/src/app/(dashboard)/sales/sales-import-actions.ts`

**Before (Broken):**
```typescript
// Used .insert() with duplicate detection fallback
// Manual one-by-one insert if conflict detected
```

**After (Fixed):**
```typescript
// Use .upsert() with conflict resolution
const { data, error } = await supabase
  .from('sales_orders')
  .upsert(salesRows, {
    onConflict: 'created_by,order_line_hash',
    ignoreDuplicates: false, // Update existing rows
  })
  .select()
```

**Safe Field Updates on Conflict:**
- `status` (internal status: completed/pending/cancelled)
- `payment_status` (paid/unpaid/refunded)
- `paid_at`, `shipped_at`, `delivered_at` (fulfillment timestamps)
- `platform_status`, `platform_substatus` (raw platform status)

**Fields NOT Updated (Immutable):**
- `order_id`, `external_order_id` (identifiers)
- `product_name`, `quantity`, `unit_price`, `total_amount` (line item data)
- `order_date` (date for P&L bucket)
- `created_by`, `import_batch_id` (audit trail)

---

## Migration Instructions

### Apply to Supabase Cloud

1. Open Supabase Dashboard → SQL Editor
2. Copy contents of `database-scripts/migration-024-sales-order-line-hash.sql`
3. Execute SQL
4. Verify:
   ```sql
   -- Check column exists
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_name = 'sales_orders'
     AND column_name = 'order_line_hash';

   -- Check unique index exists
   SELECT indexname, indexdef
   FROM pg_indexes
   WHERE tablename = 'sales_orders'
     AND indexname = 'idx_sales_orders_order_line_hash_unique';

   -- Check NULL count for imported rows (should be 0 after backfill)
   SELECT
     source,
     COUNT(*) as total_rows,
     COUNT(order_line_hash) as rows_with_hash,
     COUNT(*) - COUNT(order_line_hash) as rows_without_hash
   FROM public.sales_orders
   WHERE source = 'imported'
   GROUP BY source;
   ```

---

## Testing Checklist

### Manual Tests

#### Test 1: First Import (Baseline)
1. Prepare test file: TikTok OrderSKUList .xlsx with 10-20 rows
2. Import file via UI
3. Record:
   - Total rows imported: `____`
   - Revenue (completed orders only): `____`
   - Import batch ID: `____`

**Expected:**
- ✅ Import succeeds
- ✅ All rows inserted with `order_line_hash` populated
- ✅ No errors in console

**Verification SQL:**
```sql
SELECT
  order_id,
  product_name,
  quantity,
  total_amount,
  status,
  order_line_hash
FROM public.sales_orders
WHERE import_batch_id = '<batch_id_from_test1>'
ORDER BY order_date, product_name
LIMIT 10;
```

---

#### Test 2: Re-Import Same File (Idempotency)
1. Import the EXACT same file from Test 1
2. Record:
   - Total rows processed: `____`
   - New inserts: `____` (should be 0)
   - Updated rows: `____` (should match Test 1 count)

**Expected:**
- ✅ Import succeeds (no error)
- ✅ Row count in `sales_orders` UNCHANGED (no duplicates)
- ✅ Existing rows updated (status, payment timestamps if changed)
- ✅ No duplicate entries

**Verification SQL:**
```sql
-- Check total row count (should match Test 1)
SELECT COUNT(*) as total_orders
FROM public.sales_orders
WHERE created_by = auth.uid();

-- Check for duplicates (should return 0 rows)
SELECT
  created_by,
  order_line_hash,
  COUNT(*) as duplicate_count
FROM public.sales_orders
WHERE order_line_hash IS NOT NULL
GROUP BY created_by, order_line_hash
HAVING COUNT(*) > 1;
```

---

#### Test 3: Import Modified File (Partial Update)
1. Take original file from Test 1
2. Modify 3-5 rows:
   - Change `Order Status` (e.g., "รอจัดส่ง" → "จัดส่งแล้ว")
   - Add `Shipped Time` timestamp
   - Add `Delivered Time` timestamp
3. Import modified file

**Expected:**
- ✅ Import succeeds
- ✅ Modified rows: status updated to `completed`, `shipped_at` and `delivered_at` populated
- ✅ Unmodified rows: unchanged
- ✅ No duplicates

**Verification SQL:**
```sql
-- Check updated rows (compare before/after status)
SELECT
  order_id,
  product_name,
  status,
  platform_status,
  paid_at,
  shipped_at,
  delivered_at
FROM public.sales_orders
WHERE import_batch_id IN ('<batch_id_test1>', '<batch_id_test3>')
  AND shipped_at IS NOT NULL
ORDER BY order_date;
```

---

## Acceptance Criteria

- [x] Migration script created (`migration-024-sales-order-line-hash.sql`)
- [x] Backend code updated to use upsert with conflict resolution
- [ ] Migration applied to Supabase Cloud
- [ ] Test 1: First import succeeds
- [ ] Test 2: Re-import is idempotent (no duplicates)
- [ ] Test 3: Partial updates work correctly

---

## Rollback Plan (If Needed)

If migration causes issues:

```sql
-- Drop unique index
DROP INDEX IF EXISTS public.idx_sales_orders_order_line_hash_unique;

-- Drop column
ALTER TABLE public.sales_orders
DROP COLUMN IF EXISTS order_line_hash;
```

Then revert code changes:
```bash
git revert HEAD
```

---

## Technical Notes

### Why Upsert Instead of Insert + Duplicate Check?

**Old Approach (Broken):**
- Bulk insert → if conflict → insert one-by-one → count skipped
- Performance: O(n²) on conflicts (re-insert individual rows)
- Reliability: Doesn't handle partial updates (must delete + re-insert)

**New Approach (Fixed):**
- Upsert with conflict target → PostgreSQL handles deduplication atomically
- Performance: O(n) always (single operation)
- Reliability: Safe field updates on conflict (no delete needed)

### Why Not Use File Hash Only?

File hash deduplication (`import_batches.file_hash`) blocks entire file re-import.
Line-level hash (`order_line_hash`) supports:
- **Partial updates**: Import file with modified rows → only changed lines update
- **Cross-file deduplication**: Same SKU in different exports → no duplicates
- **Status tracking**: Re-import completed orders → update fulfillment timestamps

---

## Related Files

**Database:**
- `database-scripts/migration-024-sales-order-line-hash.sql` (NEW)
- `database-scripts/migration-007-import-sales-expenses.sql` (original schema)
- `database-scripts/migration-008-sales-ux-v2.sql` (UX v2 fields)

**Backend:**
- `frontend/src/app/(dashboard)/sales/sales-import-actions.ts` (MODIFIED)
- `frontend/src/types/sales-import.ts` (types)

**Business Rules:**
- `CLAUDE.md` → Sales & Expenses Import section
- `BUSINESS_RULES_AUDIT.md` → Revenue calculation rules

---

## Git Commits

1. `feat(db): add order_line_hash column for idempotent sales import`
   - Migration 024: Add column + unique index + backfill

2. `fix(sales): use upsert for idempotent import with safe field updates`
   - Replace insert with upsert
   - Handle conflicts with safe field update logic
   - Remove skippedCount variable (not applicable to upsert)
