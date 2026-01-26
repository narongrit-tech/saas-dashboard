# How to Apply Migration 024

**Status:** Migration committed but NOT yet applied to Supabase Cloud

---

## Step-by-Step Instructions

### 1. Open Supabase Dashboard
- URL: https://supabase.com/dashboard
- Login with your credentials
- Select your project: `saas-dashboard`

---

### 2. Navigate to SQL Editor
- Left sidebar → **SQL Editor**
- Click **+ New Query**

---

### 3. Copy and Execute Migration SQL

**File:** `database-scripts/migration-024-sales-order-line-hash.sql`

Copy the entire contents of the file and paste into the SQL Editor, then click **RUN**.

**What it does:**
1. Adds `order_line_hash TEXT` column to `sales_orders`
2. Creates unique index `idx_sales_orders_order_line_hash_unique ON (created_by, order_line_hash)`
3. Backfills hash for existing imported rows

**Expected output:**
```
ALTER TABLE
COMMENT
DROP INDEX
CREATE INDEX
UPDATE [N rows] -- where N = number of existing imported orders
```

---

### 4. Verify Migration Success

Run these verification queries in SQL Editor:

#### Query 1: Check Column Exists
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'sales_orders'
  AND column_name = 'order_line_hash';
```

**Expected:**
```
column_name       | data_type | is_nullable
order_line_hash   | text      | YES
```

---

#### Query 2: Check Unique Index Exists
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'sales_orders'
  AND indexname = 'idx_sales_orders_order_line_hash_unique';
```

**Expected:**
```
indexname                              | indexdef
idx_sales_orders_order_line_hash_unique | CREATE UNIQUE INDEX idx_sales_orders_order_line_hash_unique...
```

---

#### Query 3: Check Backfill Completed (All Imported Rows Have Hash)
```sql
SELECT
  source,
  COUNT(*) as total_rows,
  COUNT(order_line_hash) as rows_with_hash,
  COUNT(*) - COUNT(order_line_hash) as rows_without_hash
FROM public.sales_orders
WHERE source = 'imported'
GROUP BY source;
```

**Expected:**
```
source    | total_rows | rows_with_hash | rows_without_hash
imported  | 1234       | 1234           | 0  <-- Must be 0
```

If `rows_without_hash > 0`, run backfill manually:
```sql
UPDATE public.sales_orders
SET order_line_hash = encode(
  sha256(
    (created_by::text || '|' ||
     COALESCE(source_platform, marketplace, '') || '|' ||
     COALESCE(external_order_id, order_id, '') || '|' ||
     COALESCE(product_name, '') || '|' ||
     COALESCE(quantity, 0)::text || '|' ||
     COALESCE(total_amount, 0)::text
    )::bytea
  ),
  'hex'
)
WHERE order_line_hash IS NULL
  AND source = 'imported'
  AND product_name IS NOT NULL;
```

---

#### Query 4: Check for Duplicate Hashes (Should Return 0 Rows)
```sql
SELECT
  created_by,
  order_line_hash,
  COUNT(*) as duplicate_count
FROM public.sales_orders
WHERE order_line_hash IS NOT NULL
GROUP BY created_by, order_line_hash
HAVING COUNT(*) > 1;
```

**Expected:** `0 rows` (no duplicates)

If duplicates found, investigate:
```sql
SELECT
  order_id,
  product_name,
  quantity,
  total_amount,
  order_date,
  order_line_hash
FROM public.sales_orders
WHERE order_line_hash = '<duplicate_hash_value>'
ORDER BY created_at;
```

---

## 5. Test Import Functionality

After migration is applied, test the import feature:

### Test 1: Fresh Import
1. Go to `/sales` page
2. Click **Import** button
3. Upload a TikTok OrderSKUList .xlsx file
4. Verify:
   - ✅ Import succeeds
   - ✅ Rows appear in table
   - ✅ No errors in browser console

### Test 2: Re-Import Same File (Idempotency Test)
1. Upload the EXACT same file from Test 1
2. Verify:
   - ✅ Import succeeds (no error)
   - ✅ Row count UNCHANGED (no duplicates)
   - ✅ Message shows "Successfully imported/updated N rows (idempotent)"

**SQL Check:**
```sql
-- Count total sales orders (should NOT increase after re-import)
SELECT COUNT(*) FROM public.sales_orders WHERE created_by = auth.uid();
```

---

## Rollback (If Something Goes Wrong)

If migration causes issues:

```sql
-- Step 1: Drop unique index
DROP INDEX IF EXISTS public.idx_sales_orders_order_line_hash_unique;

-- Step 2: Drop column
ALTER TABLE public.sales_orders
DROP COLUMN IF EXISTS order_line_hash;
```

Then notify team to revert code changes.

---

## Troubleshooting

### Error: "duplicate key value violates unique constraint"

**Cause:** Existing duplicate rows prevent unique index creation

**Solution:**
1. Identify duplicates:
   ```sql
   SELECT
     created_by,
     encode(sha256((
       created_by::text || '|' ||
       COALESCE(source_platform, marketplace, '') || '|' ||
       COALESCE(external_order_id, order_id, '') || '|' ||
       COALESCE(product_name, '') || '|' ||
       COALESCE(quantity, 0)::text || '|' ||
       COALESCE(total_amount, 0)::text
     )::bytea), 'hex') as hash,
     COUNT(*) as count
   FROM public.sales_orders
   WHERE source = 'imported'
   GROUP BY 1, 2
   HAVING COUNT(*) > 1;
   ```

2. Delete duplicates (keep newest):
   ```sql
   DELETE FROM public.sales_orders
   WHERE id IN (
     SELECT id
     FROM (
       SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY created_by, order_line_hash
           ORDER BY created_at DESC
         ) as rn
       FROM public.sales_orders
       WHERE order_line_hash IS NOT NULL
     ) t
     WHERE rn > 1
   );
   ```

3. Re-run migration

---

### Error: "permission denied for table sales_orders"

**Cause:** SQL Editor using wrong role

**Solution:**
1. Check current role: `SELECT current_user;`
2. Switch to superuser: `SET ROLE postgres;`
3. Re-run migration

---

## Success Checklist

- [ ] Migration SQL executed successfully
- [ ] Column `order_line_hash` exists (Verification Query 1)
- [ ] Unique index exists (Verification Query 2)
- [ ] All imported rows have hash (Verification Query 3, 0 NULLs)
- [ ] No duplicate hashes (Verification Query 4, 0 rows)
- [ ] Test 1: Fresh import works
- [ ] Test 2: Re-import is idempotent (no duplicates)

**When all checked:** Migration is complete and system is operational ✅

---

## Related Documentation

- **Full Fix Guide:** `SALES_IMPORT_IDEMPOTENCY_FIX.md`
- **Migration SQL:** `database-scripts/migration-024-sales-order-line-hash.sql`
- **Business Rules:** `CLAUDE.md` → Sales & Expenses Import section
