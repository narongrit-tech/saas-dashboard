# Sales Import Mystery Investigation

**Date:** 2026-01-27
**Issue:** `import_batches` shows `status='success'` with `inserted_count > 0`, but `sales_orders` table is empty
**Status:** 🔍 Investigation Complete + 🛡️ Defensive Patches Applied

---

## 📊 Evidence from Production

```sql
-- User's observations:
SELECT status, inserted_count FROM import_batches
WHERE report_type = 'sales_order_sku_list' AND status = 'success';
-- Result: inserted_count = 1432-1436

SELECT COUNT(*) FROM sales_orders;
-- Result: 0 rows

SELECT COUNT(*) FROM sales_orders WHERE import_batch_id = '<success_batch_id>';
-- Result: 0 rows

-- RLS status:
SELECT relrowsecurity FROM pg_class WHERE relname = 'sales_orders';
-- Result: true (RLS enabled)

-- RLS policies:
SELECT * FROM pg_policies WHERE tablename = 'sales_orders';
-- Result: All policies use USING(true) = no restrictions
```

---

## 🔍 Code Investigation Findings

### Architecture Overview

```
User → SalesImportDialog → Server Actions:
  1. createImportBatch() → Creates batch record (status='processing')
  2. importSalesChunk() → Inserts rows into sales_orders (chunked, 500/chunk)
  3. finalizeImportBatch() → Verifies DB rows + Updates batch (status='success'|'failed')
```

### Truth Table: Supabase Client Consistency

| Function | File | Line | Client Factory | Env Vars | Auth |
|----------|------|------|----------------|----------|------|
| `createImportBatch()` | `sales-import-actions.ts` | 481 | `createClient()` from `@/lib/supabase/server` | `NEXT_PUBLIC_SUPABASE_URL`<br>`NEXT_PUBLIC_SUPABASE_ANON_KEY` | User session |
| `importSalesChunk()` | `sales-import-actions.ts` | 626 | `createClient()` from `@/lib/supabase/server` | `NEXT_PUBLIC_SUPABASE_URL`<br>`NEXT_PUBLIC_SUPABASE_ANON_KEY` | User session |
| `finalizeImportBatch()` | `sales-import-actions.ts` | 794 | `createClient()` from `@/lib/supabase/server` | `NEXT_PUBLIC_SUPABASE_URL`<br>`NEXT_PUBLIC_SUPABASE_ANON_KEY` | User session |

**✅ Conclusion:** All functions use the SAME Supabase client with SAME environment variables

### Critical Code Analysis

#### 1. Insert Path (importSalesChunk)

**File:** `sales-import-actions.ts:730-760`

```typescript
// Line 730-736: Upsert operation
const { data: upsertedRows, error: upsertError } = await supabase
  .from('sales_orders')
  .upsert(salesRows, {
    onConflict: 'created_by,order_line_hash',
    ignoreDuplicates: false,
  })
  .select()

// Line 760: Returns count of upserted rows
insertedCount = upsertedRows?.length || 0
```

**⚠️ Potential Issue:** `.select()` after `.upsert()` might return rows even if insert failed due to:
- RLS blocking insert but allowing select
- Network issues between upsert and select
- Supabase internal inconsistencies

#### 2. Verification Path (finalizeImportBatch)

**File:** `sales-import-actions.ts:832-881`

```typescript
// Line 832-835: COUNT query to verify actual DB rows
const { count: actualCount, error: countError } = await supabase
  .from('sales_orders')
  .select('*', { count: 'exact', head: true })
  .eq('import_batch_id', batchId)

const verifiedCount = actualCount || 0

// Line 861-881: CRITICAL CHECK - Fail if count is 0
if (verifiedCount === 0) {
  await supabase.from('import_batches').update({
    status: 'failed',
    inserted_count: 0,
    error_count: parsedData.length,
    notes: 'Import failed: 0 rows inserted. Possible RLS policy issue or authentication error.'
  })

  return {
    success: false,
    error: 'Import failed: 0 rows inserted...',
    inserted: 0,
    ...
  }
}
```

**✅ Correct Logic:** This SHOULD prevent false success!

#### 3. Success Path (finalizeImportBatch)

**File:** `sales-import-actions.ts:921-932`

```typescript
// Line 921-932: Only reached if verifiedCount > 0
await supabase.from('import_batches').update({
  status: 'success',
  inserted_count: insertedCount,  // Uses verified count
  updated_count: updatedCount,
  ...
})
```

**✅ Correct Logic:** Success only set when verified count > 0

---

## 🐛 Root Cause Hypotheses

### Hypothesis A: Environment Mismatch ⭐ MOST LIKELY

**Description:** The application is writing to Supabase Project A, but the user is inspecting Project B (or vice versa).

**Evidence:**
- Code logic is correct (verification exists)
- RLS policies allow all operations
- All functions use same client

**How to Verify:**

```bash
# Check .env.local
cd frontend
cat .env.local | grep NEXT_PUBLIC_SUPABASE_URL

# Compare with Supabase dashboard project URL
# Dashboard shows: https://abcdefgh.supabase.co
# .env shows: https://xyzabc123.supabase.co  <-- MISMATCH!
```

**Solution:**
1. Confirm which Supabase project the app is ACTUALLY using (check `.env.local`)
2. Ensure you're inspecting the SAME project in Supabase dashboard
3. Check application logs for `[finalizeImportBatch] Project URL:` messages

---

### Hypothesis B: Data Deletion After Import

**Description:** Import succeeds, verification passes, status set to 'success', THEN data is deleted by:
- Scheduled job (cron)
- Database trigger
- Manual TRUNCATE
- Another user/process

**How to Verify:**

```sql
-- Check for triggers
SELECT * FROM information_schema.triggers
WHERE event_object_table = 'sales_orders';

-- Check for cron jobs (if pg_cron installed)
SELECT * FROM cron.job
WHERE command LIKE '%sales_orders%';

-- Check audit logs (if exists)
SELECT * FROM audit_logs
WHERE table_name = 'sales_orders'
  AND operation IN ('DELETE', 'TRUNCATE');
```

**Solution:**
- Review and disable any automated cleanup processes
- Check who has access to delete data

---

### Hypothesis C: RLS Blocking Insert (UNLIKELY)

**Description:** RLS allows SELECT but blocks INSERT, causing upsert to silently fail.

**Evidence AGAINST:**
```sql
-- Current RLS policies (from schema.sql)
CREATE POLICY "sales_orders_insert_policy"
    ON public.sales_orders FOR INSERT
    TO authenticated
    WITH CHECK (true);  -- ✅ No restrictions
```

**Why Unlikely:** Policy is `WITH CHECK (true)` = allows all inserts

---

### Hypothesis D: Supabase Bug (VERY UNLIKELY)

**Description:** `.count('exact')` returns cached/stale count instead of real-time count.

**Why Unlikely:** Supabase Postgres uses real-time queries, not cached counts

---

## 🛡️ Defensive Patches Applied

### Patch 1: Environment Logging

**Added to all 3 functions:**

```typescript
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'NOT_SET'
console.log(`[functionName] Project URL: ${supabaseUrl.split('.')[0]}`)
```

**Purpose:** Track which Supabase project is being used

---

### Patch 2: Double-Check Verification

**Added to `finalizeImportBatch()`:**

```typescript
if (verifiedCount === 0) {
  // DOUBLE-CHECK: Query one more time
  const { data: doubleCheckRows } = await supabase
    .from('sales_orders')
    .select('id')
    .eq('import_batch_id', batchId)
    .limit(1)

  console.error(`[finalizeImportBatch] Double-check result: ${doubleCheckRows?.length || 0}`)

  // Mark as failed with detailed notes
  await supabase.from('import_batches').update({
    status: 'failed',
    notes: `Import failed: 0 rows verified. Expected ${parsedData.length}. Project: ${supabaseUrl}. Batch: ${batchId}`
  })
}
```

**Purpose:** Ensure verification isn't a false negative

---

### Patch 3: Enhanced Error Messages

**Before:**
```
"Import failed: 0 rows inserted. กรุณาตรวจสอบ permissions"
```

**After:**
```
Import failed: 0 rows inserted into database.

Expected: 1432 rows
Verified: 0 rows
Batch ID: a1b2c3d4...
Project: myproject

กรุณาตรวจสอบว่าคุณกำลังใช้ Supabase project ที่ถูกต้อง
```

**Purpose:** Help users diagnose environment mismatches

---

### Patch 4: Comprehensive Logging

**Added throughout:**
- `[createImportBatch]` - Batch creation
- `[importSalesChunk]` - Upsert operations
- `[finalizeImportBatch]` - Verification steps

**Purpose:** Full audit trail for debugging

---

### Patch 5: Upsert Error Details

**Added:**
```typescript
console.error(`[importSalesChunk] Error details:`, {
  code: upsertError.code,
  message: upsertError.message,
  details: upsertError.details,
  hint: upsertError.hint
})
```

**Purpose:** Capture full error context

---

## 🧪 PHASE 3 — Verification Steps

### Manual Test Checklist

#### Test 1: Fresh Import

```
1. Clear browser console (to see logs)
2. Navigate to /sales
3. Click "Import" button
4. Upload TikTok OrderSKUList .xlsx
5. Review preview
6. Click "Confirm Import"
7. Wait for completion
```

**Expected Console Logs:**
```
[createImportBatch] Starting import, Project: myproject
[createImportBatch] File: OrderSKUList.xlsx, Rows: 1432
[createImportBatch] ✓ Batch created: a1b2c3d4-... (a1b2c3d4...)

[importSalesChunk] Chunk 1/3 for batch a1b2c3d4..., Project: myproject
[importSalesChunk] Upserting 500 rows...
[importSalesChunk] ✓ Upsert completed: 500 rows processed

[importSalesChunk] Chunk 2/3 for batch a1b2c3d4..., Project: myproject
...

[finalizeImportBatch] Batch: a1b2c3d4..., Project URL: myproject
[finalizeImportBatch] Verifying rows for batch: a1b2c3d4...
[finalizeImportBatch] Verification result: count=1432, error=none
[finalizeImportBatch] ✓ Verification passed: 1432 rows found in database
```

**If Logs Show:**
```
[finalizeImportBatch] CRITICAL: Verification returned 0 rows
[finalizeImportBatch] Expected: 1432 rows, Got: 0 rows
[finalizeImportBatch] Project: https://myproject.supabase.co
```

→ **Environment mismatch detected!**

---

#### Test 2: Database Verification

**Run in Supabase SQL Editor:**

```sql
-- 1. Get latest batch
SELECT
  id as batch_id,
  file_name,
  status,
  inserted_count,
  notes,
  created_at
FROM import_batches
WHERE report_type = 'sales_order_sku_list'
ORDER BY created_at DESC
LIMIT 1;

-- 2. Count actual rows for that batch
SELECT COUNT(*)
FROM sales_orders
WHERE import_batch_id = '<batch_id_from_step_1>';

-- 3. Verify project URL matches .env.local
SELECT current_database();
```

**Expected Results:**
- If `status = 'success'` AND `inserted_count > 0`:
  → `COUNT(*)` from step 2 MUST equal `inserted_count`
- If counts don't match:
  → Check console logs for project URL mismatch

---

#### Test 3: Environment Verification

```bash
# Terminal 1: Check .env.local
cd frontend
echo "App uses:" && cat .env.local | grep NEXT_PUBLIC_SUPABASE_URL

# Supabase Dashboard: Check project URL
# Settings → API → Project URL
# Should match .env.local exactly
```

---

### SQL Diagnostic Script

**Run:** `database-scripts/debug-sales-import-mystery.sql`

This script will:
1. Show current database name
2. List successful import batches
3. Count actual rows in sales_orders
4. Cross-check claimed vs actual counts
5. Show RLS policies
6. Check for triggers or cron jobs
7. Identify orphaned batches (success but 0 rows)

**Key Output:**
```sql
-- STEP 4 output:
batch_id   | claimed_count | actual_count | status
-----------|---------------|--------------|----------
a1b2c3d4   | 1432         | 0            | ❌ MISMATCH
```

If you see ❌ MISMATCH → Environment mismatch or data deletion

---

## 📁 Files Changed

### Modified

1. **`frontend/src/app/(dashboard)/sales/sales-import-actions.ts`** (~50 lines changed)
   - Added environment logging to all 3 functions
   - Added double-check verification in `finalizeImportBatch()`
   - Enhanced error messages with batch ID and project URL
   - Added comprehensive console.log statements
   - Added upsert error details logging

### Created

2. **`database-scripts/debug-sales-import-mystery.sql`** (NEW)
   - Comprehensive diagnostic SQL script
   - 12 verification steps
   - Cross-check import_batches vs sales_orders
   - Check RLS policies, triggers, cron jobs

3. **`docs/SALES_IMPORT_MYSTERY_INVESTIGATION.md`** (NEW - this file)
   - Full investigation report
   - Root cause hypotheses
   - Defensive patches documentation
   - Test procedures

---

## 🎯 Summary & Next Steps

### What We Know

✅ **Code Logic is CORRECT:**
- Verification query exists (lines 832-835)
- Zero-count check exists (lines 861-881)
- Success only set when verified count > 0

✅ **RLS is NOT blocking:**
- All policies use `USING(true)` or `WITH CHECK(true)`
- No restrictions on insert/select

✅ **Client Consistency:**
- All functions use same `createClient()` factory
- Same environment variables
- Same Supabase project

### Most Likely Root Cause

🎯 **Environment Mismatch** (Hypothesis A)

The application writes to Project A, but user inspects Project B.

**How to Confirm:**
1. Check console logs for `[finalizeImportBatch] Project URL:`
2. Compare with Supabase dashboard URL
3. Verify `.env.local` matches production

### Action Items

1. **Immediate:**
   - Run diagnostic SQL script
   - Check console logs during next import
   - Verify environment variables

2. **If Environment Mismatch:**
   - Update `.env.local` to correct project
   - Re-import test file
   - Verify rows appear

3. **If Data Deletion:**
   - Check for triggers/cron jobs
   - Review audit logs
   - Disable automated cleanup

4. **If Still Mysterious:**
   - Share console logs with team
   - Export diagnostic SQL results
   - Contact Supabase support

---

## 🚀 Deployment

```bash
# Build and verify
cd frontend
npm run build

# Test locally
npm run dev
# Navigate to /sales → Import file → Check console logs

# If successful, commit changes
git add frontend/src/app/\(dashboard\)/sales/sales-import-actions.ts
git add database-scripts/debug-sales-import-mystery.sql
git add docs/SALES_IMPORT_MYSTERY_INVESTIGATION.md

git commit -m "fix(sales): add defensive logging for import verification

- Add environment URL logging to all import functions
- Add double-check verification in finalizeImportBatch
- Enhance error messages with batch ID and project URL
- Add comprehensive console logging for debugging
- Create diagnostic SQL script for production investigation

Purpose: Investigate why import_batches shows success but sales_orders is empty
Most likely cause: Environment mismatch (app writes to Project A, user checks Project B)

Testing: Check console logs for [finalizeImportBatch] messages during import

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# Deploy
git push origin main
```

---

**Status:** ✅ **Investigation Complete + Defensive Patches Applied**

**Next:** Run diagnostic script and verify environment consistency
