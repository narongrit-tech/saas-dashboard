# Bank Reconciliation Hotfix - Manual Steps

## Problem
Error: `null value in column "entity_type" violates not-null constraint`

## Root Cause
- Migration-020 added new columns (`matched_type`, `matched_record_id`, `created_by`, `created_at`, `metadata`)
- Old columns (`entity_type`, `entity_id`, `matched_amount`, `matched_by`, `matched_at`) still exist and are NOT NULL
- Code inserts only new columns → constraint violation

## Solution: Make Old Columns Nullable

### Step 1: Apply Hotfix SQL (Supabase Dashboard)

Navigate to Supabase → SQL Editor → New Query

Copy and paste the following SQL:

```sql
-- HOTFIX: Make old bank_reconciliations columns NULLABLE
-- Purpose: Fix "null value in column entity_type violates not-null constraint" error

ALTER TABLE public.bank_reconciliations
  ALTER COLUMN entity_type DROP NOT NULL,
  ALTER COLUMN entity_id DROP NOT NULL,
  ALTER COLUMN matched_amount DROP NOT NULL,
  ALTER COLUMN matched_by DROP NOT NULL,
  ALTER COLUMN matched_at DROP NOT NULL;

-- Verify changes
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'bank_reconciliations'
  AND table_schema = 'public'
ORDER BY ordinal_position;
```

Click **Run** and verify:
- `entity_type`, `entity_id`, `matched_amount`, `matched_by`, `matched_at` → `is_nullable = YES`

### Step 2: Verify Schema

Expected results after running SQL:

| column_name         | data_type | is_nullable | column_default |
|---------------------|-----------|-------------|----------------|
| id                  | uuid      | NO          | gen_random_uuid() |
| bank_transaction_id | uuid      | NO          | -              |
| entity_type         | varchar   | **YES**     | -              |
| entity_id           | uuid      | **YES**     | -              |
| matched_amount      | numeric   | **YES**     | -              |
| matched_by          | uuid      | **YES**     | -              |
| matched_at          | timestamptz | **YES**   | -              |
| notes               | text      | YES         | -              |
| matched_type        | varchar   | NO          | -              |
| matched_record_id   | uuid      | YES         | -              |
| created_by          | uuid      | NO          | -              |
| created_at          | timestamptz | NO        | now()          |
| metadata            | jsonb     | YES         | -              |

### Step 3: Test Wallet Top-up Creation

1. Navigate to **Bank** page
2. Click "View Unmatched" button
3. Find an unmatched bank transaction (withdrawal)
4. Click **Actions** → **Create Wallet Top-up**
5. Fill in:
   - Wallet: TikTok Ads
   - Amount: (auto-filled from transaction)
   - Notes: "Test hotfix - wallet topup"
6. Click **Create**

**Expected Result:** ✅ Success message, no constraint violation error

### Step 4: Verify Reconciliation Created

Run verification query in Supabase SQL Editor:

```sql
-- Check latest reconciliation record
SELECT
  id,
  bank_transaction_id,
  matched_type,
  matched_record_id,
  created_by,
  created_at,
  notes,
  -- Old columns (should be NULL for new records)
  entity_type,
  entity_id,
  matched_amount,
  matched_by,
  matched_at
FROM public.bank_reconciliations
ORDER BY created_at DESC
LIMIT 5;
```

**Expected for new records:**
- `matched_type` = 'wallet_topup' (NOT NULL)
- `matched_record_id` = UUID (wallet_ledger.id)
- `created_by` = user UUID (NOT NULL)
- `created_at` = timestamp (NOT NULL)
- `entity_type`, `entity_id`, `matched_amount`, `matched_by`, `matched_at` = **NULL**

### Step 5: Test All Match Types

Test each reconciliation type:

1. **Create Expense** from bank transaction
   - Expected: `matched_type='expense'`, `matched_record_id=expense.id`

2. **Create Wallet Spend** (non-ADS wallet only)
   - Expected: `matched_type='wallet_spend'`, `matched_record_id=wallet_ledger.id`

3. **Match to Settlement**
   - Expected: `matched_type='settlement'`, `matched_record_id=settlement_transactions.id`

4. **Create Adjustment**
   - Expected: `matched_type='adjustment'`, `matched_record_id=NULL`

5. **Ignore Transaction**
   - Expected: `matched_type='ignore'`, `matched_record_id=NULL`

### Step 6: Regression Test (Old Records)

Verify old records still readable:

```sql
-- Check old reconciliation records (if any exist)
SELECT
  id,
  entity_type,
  entity_id,
  matched_amount,
  matched_by,
  matched_at,
  matched_type,
  matched_record_id,
  created_by,
  created_at
FROM public.bank_reconciliations
WHERE matched_type IS NOT NULL AND entity_type IS NOT NULL
ORDER BY created_at ASC
LIMIT 5;
```

**Expected:** Old records have both old and new columns populated (backfilled data)

## Done When
- ✅ Hotfix SQL applied successfully
- ✅ Schema verified (old columns nullable)
- ✅ Wallet Top-up creates reconciliation without error
- ✅ All 6 match types work correctly
- ✅ Old records still readable

## Rollback (If Needed)
If you need to rollback (make columns NOT NULL again):

```sql
-- WARNING: Only run if no new records exist with NULL old columns
ALTER TABLE public.bank_reconciliations
  ALTER COLUMN entity_type SET NOT NULL,
  ALTER COLUMN entity_id SET NOT NULL,
  ALTER COLUMN matched_amount SET NOT NULL,
  ALTER COLUMN matched_by SET NOT NULL,
  ALTER COLUMN matched_at SET NOT NULL;
```

**⚠️ Do NOT rollback if new reconciliations already created after hotfix**

## Files Changed
- `database-scripts/migration-020-bank-reconciliation-manual-match.sql` (updated with DROP NOT NULL)
- `database-scripts/hotfix-020-make-old-columns-nullable.sql` (new standalone hotfix)
- `BANK_RECONCILIATION_HOTFIX_STEPS.md` (this file)

## Related Documentation
- Migration-020: `database-scripts/migration-020-bank-reconciliation-manual-match.sql`
- Manual Match Actions: `frontend/src/app/(dashboard)/reconciliation/manual-match-actions.ts`
- Business Logic: Old columns kept for backward compatibility, not required for new inserts
