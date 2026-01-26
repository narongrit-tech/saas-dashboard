# Clear TikTok Ads Daily Imported Data - Robust Version

**Purpose**: Remove all imported TikTok ads performance data (Product + Live) with automatic column detection

**Key Feature**: 🔍 **Auto-detects column names** to work across different schema variations

---

## Why Robust?

Production schemas may vary:
- `marketplace` vs `market_place` vs `channel` vs `platform`
- `source` vs `data_source` vs `origin`
- `campaign_type` vs `ads_type` vs `type`

This script **automatically detects** which columns exist and builds the correct queries.

---

## What it clears

### Tables affected:
1. **`ad_daily_performance`**
   - Auto-detects: marketplace-like column + source column + campaign_type column
   - WHERE: `{market_column} = 'tiktok' AND {campaign_type_column} IN ('product','live')`
   - Optional: `AND {source_column} = 'imported'` (if source column exists)

2. **`wallet_ledger`**
   - Strategy 1 (preferred): Use `import_batch_id` to find related rows
   - Strategy 2 (fallback): Use detected columns (marketplace + source + report_type)
   - Strategy 3 (safest): Skip deletion + show MANUAL CHECK notice

3. **`import_batches`**
   - WHERE: `report_type = 'tiktok_ads_daily'`
   - UPDATE: `status = 'rolled_back'` (soft delete for audit trail)
   - Note: Uses 'rolled_back' because constraint doesn't allow 'deleted'

---

## How to run

### Step 1: Open Supabase SQL Editor
1. Go to Supabase Dashboard
2. Click "SQL Editor" in left sidebar
3. **Important**: Ensure connected as **postgres** role (check top-right)

### Step 2: Load and execute
```sql
-- 1. Copy file contents
-- File: database-scripts/maintenance-clear-tiktok-ads-daily.sql

-- 2. Paste into SQL Editor

-- 3. Click "Run" button

-- 4. Review output in console
```

### Step 3: Review auto-detection
Script will show detected columns:
```
NOTICE: Detected columns: market=marketplace, source=source, campaign_type=campaign_type, date=ad_date
```

If columns not found, script will show error:
```
ERROR: Cannot find marketplace column in ad_daily_performance
```

### Step 4: Review preview
Script shows what will be deleted:
```
market   | campaign_type | rows | total_spend | total_orders | total_revenue
---------|---------------|------|-------------|--------------|---------------
tiktok   | product       | 87   | 80.83       | 24           | 5497.80
```

### Step 5: Verify deletion
Check verification results:
```
verification                              | count
------------------------------------------|-------
ad_daily_performance: remaining rows      | 0
wallet_ledger: remaining related rows     | 0
import_batches: status = rolled_back      | 1
```

**Expected**: All counts = 0 (except import_batches shows rolled_back count)

---

## Auto-detection logic

### For `ad_daily_performance`:

**Marketplace column** (required):
- Tries: `marketplace`, `market_place`, `channel`, `platform`
- Error if not found

**Source column** (optional):
- Tries: `source`, `data_source`, `origin`, `source_type`
- Skips if not found (deletes all rows, not just imported)

**Campaign type column** (required):
- Tries: `campaign_type`, `ads_type`, `ad_type`, `type`
- Error if not found

### For `wallet_ledger`:

**Strategy 1** - Use `import_batch_id`:
```sql
DELETE FROM wallet_ledger
WHERE import_batch_id IN (
    SELECT id FROM import_batches WHERE report_type = 'tiktok_ads_daily'
);
```

**Strategy 2** - Use detected columns:
- Tries: marketplace + source + report_type
- Falls back to partial match if some columns missing

**Strategy 3** - Cannot delete safely:
- Shows notice: "MANUAL CHECK REQUIRED"
- No deletion performed (safe mode)

---

## Expected results

### Console output:

```sql
-- STEP 0: Shows all columns in affected tables
table_name             | column_name        | data_type
-----------------------|--------------------|----------
ad_daily_performance   | marketplace        | text
ad_daily_performance   | source             | text
ad_daily_performance   | campaign_type      | text
...

-- STEP 1: Preview before deletion
market | campaign_type | rows | total_spend | total_orders | total_revenue
-------|---------------|------|-------------|--------------|---------------
tiktok | product       | 87   | 80.83       | 24           | 5497.80

NOTICE: Executing delete on ad_daily_performance...
NOTICE: ad_daily_performance deletion complete

-- STEP 2: Preview wallet deletion
rows | total_amount
-----|-------------
1    | 80.83

NOTICE: Executing delete on wallet_ledger (via import_batch_id)...
NOTICE: wallet_ledger deletion complete

-- STEP 3: Update import_batches
UPDATE 1

-- STEP 4: Verification
verification                              | count
------------------------------------------|-------
ad_daily_performance: remaining rows      | 0
wallet_ledger: remaining related rows     | 0

verification          | status       | batches
----------------------|--------------|--------
import_batches        | rolled_back  | 1
```

---

## Safety features

### 1. Auto-detection prevents hardcoded column errors
- Works across dev/staging/prod schema differences
- Shows clear error if required columns not found

### 2. Transaction-wrapped
```sql
BEGIN;
  -- all operations
COMMIT;
```
- Can change `COMMIT` to `ROLLBACK` if something wrong
- All-or-nothing execution

### 3. Preview before deletion
- Shows row counts and totals before deleting
- Gives chance to review impact

### 4. Multiple deletion strategies
- wallet_ledger tries 3 strategies (safest first)
- Won't delete if unsafe

### 5. Detailed notices
- `RAISE NOTICE` shows progress at each step
- Easy to debug if something fails

---

## Troubleshooting

### ❌ Error: "Cannot find marketplace column"

**Cause**: Table doesn't have any of: `marketplace`, `market_place`, `channel`, `platform`

**Fix**:
1. Check actual column name:
```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'ad_daily_performance'
    AND table_schema = 'public';
```

2. Add your column name to detection list in script:
```sql
-- Line 44: Add your column name
AND c.column_name IN ('marketplace', 'market_place', 'channel', 'platform', 'YOUR_COLUMN')
```

---

### ⚠️ Notice: "wallet_ledger: MANUAL CHECK REQUIRED"

**Cause**: Cannot safely auto-detect wallet deletion criteria

**Manual deletion**:
```sql
-- 1. Check wallet_ledger structure
SELECT * FROM wallet_ledger LIMIT 5;

-- 2. Find rows related to TikTok ads imports
SELECT * FROM wallet_ledger
WHERE source = 'IMPORTED'
    -- Add more filters based on your schema

-- 3. Delete manually if safe
DELETE FROM wallet_ledger
WHERE source = 'IMPORTED'
    AND created_at > '2026-01-01'  -- Adjust date range
    -- Add more safety filters
```

---

### ❌ Error: "permission denied"

**Cause**: Not running as postgres role

**Fix**: Ensure SQL Editor connected as postgres (check top-right corner)

---

### ⚠️ Remaining rows > 0 after deletion

**Cause**: RLS policies may block deletion

**Fix**:
```sql
-- Temporarily disable RLS (as postgres)
ALTER TABLE ad_daily_performance DISABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_ledger DISABLE ROW LEVEL SECURITY;

-- Re-run cleanup script

-- Re-enable RLS after cleanup
ALTER TABLE ad_daily_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
```

---

## Rollback instructions

If you need to undo the cleanup:

1. **Before COMMIT runs**: Change last line in script
```sql
ROLLBACK;  -- Instead of COMMIT
```

2. **After COMMIT runs**: Cannot undo (changes are permanent)
- Data is deleted permanently
- Only import_batches records remain (marked as deleted)

---

## Alternative: Single import rollback

If you only want to rollback ONE specific import:

```sql
-- Use the rollback RPC function
SELECT rollback_import_batch_as_admin(
    '<BATCH_ID>'::UUID,
    '<USER_ID>'::UUID
);
```

**See**: `database-scripts/migration-022-import-batch-rollback.sql`

---

## Performance

- **Detection time**: < 1 second (reads information_schema)
- **Deletion time**: < 5 seconds for 1,000 rows
- **Transaction size**: Safe for up to 10,000 rows
- **Locks**: Brief exclusive lock during DELETE operations

**Recommendation**: Run during off-peak hours if deleting > 5,000 rows

---

## Post-cleanup checklist

### Database verification:
- [ ] STEP 0 output shows correct column names
- [ ] STEP 1 preview shows expected row counts
- [ ] STEP 2 preview shows expected wallet rows
- [ ] STEP 4 verification shows 0 remaining rows
- [ ] No ERROR messages in output
- [ ] All NOTICE messages show "complete"

### UI verification:
- [ ] `/ads` page → 0 TikTok rows
- [ ] `/ads` page → Totals show 0.00 / 0 / 0.00
- [ ] `/wallets` page → ADS wallet balance decreased
- [ ] Import new file → Succeeds (no "duplicate import" error)

### Monitoring (24 hours):
- [ ] No errors in Supabase logs
- [ ] New imports succeed
- [ ] Daily totals match file exports
- [ ] No missing data reports from users

---

## When to use this script

### ✅ Safe to run:
- Need to re-import all TikTok ads from scratch
- Testing import fixes (Migration 023)
- Cleaning up test/dev environments
- After schema changes (new columns added)

### ⚠️ Use with caution:
- Production environment (review preview carefully)
- During business hours (brief locks on tables)
- If data not backed up elsewhere

### ❌ Do not run:
- If you only need to rollback ONE import (use RPC function instead)
- If source data lost (cannot re-import after cleanup)
- During active import operations (check import_batches status first)

---

## Pre-cleanup checklist

Before running script:

```sql
-- 1. Check for active imports (should be 0)
SELECT COUNT(*) FROM import_batches
WHERE status = 'processing';
-- Expected: 0

-- 2. Count rows to be deleted
SELECT COUNT(*) FROM ad_daily_performance
WHERE marketplace = 'tiktok';
-- Note this number

-- 3. Check wallet impact
SELECT COUNT(*), SUM(amount)
FROM wallet_ledger
WHERE import_batch_id IN (
    SELECT id FROM import_batches WHERE report_type = 'tiktok_ads_daily'
);
-- Note total amount (wallet balance will decrease by this)

-- 4. List batches to be marked rolled_back
SELECT id, created_at, row_count
FROM import_batches
WHERE report_type = 'tiktok_ads_daily'
    AND status NOT IN ('rolled_back', 'deleted');
-- Review list
```

---

## Support

### Documentation:
- Migration 023: `database-scripts/migration-023-ad-daily-source-row-hash.sql`
- Rollback functions: `database-scripts/migration-022-import-batch-rollback.sql`
- Deployment guide: `DEPLOY_MIGRATION_023.md`

### Troubleshooting:
- Check Supabase logs for errors
- Review console output for NOTICE messages
- Compare before/after row counts
- Verify UI shows expected changes

---

**Last Updated**: 2026-01-26
**Script Version**: 2.0 (Robust with auto-detection)
**Safe to run**: Yes (transaction-wrapped with preview)
**Breaking changes**: None (additive column detection)
