# How to Rollback or Purge Import Batches

## Overview

This guide explains how to safely rollback or purge TikTok Ads Daily import batches when needed.

**Use Cases:**
- Accidentally imported wrong file
- Import contained incorrect data
- Testing/QA needs to re-import same file
- Need to clean up stuck "processing" batches

---

## Decision Tree: Rollback vs Purge

### ✅ Rollback (Soft Delete)
**Use when:** You want to keep the import record for audit/history purposes

**What it does:**
- Deletes all `ad_daily_performance` rows
- Deletes all `wallet_ledger` entries (SPEND)
- Marks batch status as `rolled_back`
- Keeps batch record with metadata intact
- Allows re-import of same file later

**When to use:**
- Normal cleanup of test imports
- Accidental import that needs correction
- Want to preserve audit trail
- May need to reference original file_name later

### 🔥 Purge (Hard Delete)
**Use when:** You want to completely remove all traces of the import

**What it does:**
- Deletes all `ad_daily_performance` rows
- Deletes all `wallet_ledger` entries
- **Hard deletes** the batch record itself
- Removes file_hash from system
- No audit trail left

**When to use:**
- Test data that should never have existed
- Sensitive data that must be removed completely
- Cleaning up duplicate/corrupted batches permanently
- Developer testing environments

---

## Method 1: Using SQL Editor (Admin)

### Step 1: Find the Batch ID

```sql
-- List recent imports for a user
SELECT
  id,
  report_type,
  status,
  file_name,
  row_count,
  created_at,
  notes
FROM import_batches
WHERE created_by = '<USER_ID>'
  AND report_type = 'tiktok_ads_daily'
ORDER BY created_at DESC
LIMIT 20;
```

### Step 2A: Rollback (Soft Delete)

```sql
-- Rollback a specific batch
SELECT rollback_import_batch_as_admin(
  '<BATCH_ID>'::UUID,
  '<USER_ID>'::UUID
);

-- Example:
SELECT rollback_import_batch_as_admin(
  'aeee2247-3f46-49d6-94aa-feafb1b6ca91'::UUID,
  '2c4e254d-c779-4f8a-af93-603dc26e6af0'::UUID
);

-- Expected result:
{
  "success": true,
  "wallet_deleted": 1,
  "ads_deleted": 13,
  "batch_updated": true
}
```

### Step 2B: Purge (Hard Delete)

```sql
-- Purge a specific batch (PERMANENT!)
SELECT purge_import_batch_as_admin(
  '<BATCH_ID>'::UUID,
  '<USER_ID>'::UUID
);

-- Example:
SELECT purge_import_batch_as_admin(
  'aeee2247-3f46-49d6-94aa-feafb1b6ca91'::UUID,
  '2c4e254d-c779-4f8a-af93-603dc26e6af0'::UUID
);

-- Expected result:
{
  "success": true,
  "wallet_deleted": 1,
  "ads_deleted": 13,
  "batch_deleted": true
}
```

### Step 3: Verify Cleanup

```sql
-- Check batch status after rollback
SELECT id, status, notes
FROM import_batches
WHERE id = '<BATCH_ID>';

-- Check ad_daily_performance rows deleted
SELECT COUNT(*)
FROM ad_daily_performance
WHERE import_batch_id = '<BATCH_ID>';

-- Check wallet_ledger entries deleted
SELECT COUNT(*)
FROM wallet_ledger
WHERE import_batch_id = '<BATCH_ID>';
```

---

## Method 2: Using App API (Future Implementation)

**Note:** This functionality is planned but not yet implemented in the UI.

### Planned UI Features:

1. **Import History Page** (`/ads/import-history`)
   - List all import batches with status
   - Filter by date, status, report_type
   - Show row counts and file names

2. **Rollback Button**
   - Visible on import success dialog
   - Shows batch_id for reference
   - Confirmation dialog before rollback
   - Calls `rollback_import_batch(batch_id)` RPC

3. **Admin Panel** (`/admin/imports`)
   - View all users' imports (admin only)
   - Bulk rollback/purge operations
   - Cleanup stuck "processing" batches

### API Endpoint (Planned):

```typescript
// POST /api/import/tiktok/ads-daily/rollback
// Body: { batchId: string }
// Calls: rollback_import_batch(batchId) via Supabase RPC
```

---

## Security & Permissions

### RLS Policies

**User-level rollback:**
- Function: `rollback_import_batch(batch_id)`
- Auth: Uses `auth.uid()` automatically
- Permissions: Can only rollback own imports
- Granted to: `authenticated` role

**Admin-level operations:**
- Functions: `rollback_import_batch_as_admin(batch_id, user_id)`, `purge_import_batch_as_admin(batch_id, user_id)`
- Auth: Requires explicit `user_id` parameter
- Permissions: Can rollback/purge any user's imports
- Granted to: `postgres` role (SQL editor only)

### Safety Checks

All functions verify:
1. Batch exists
2. Batch belongs to specified user
3. User has permission to perform operation

Returns error if:
- Batch not found
- Access denied (wrong user_id)
- Batch already rolled_back/deleted

---

## Common Scenarios

### Scenario 1: Fix Stuck "Processing" Batch

**Problem:** Import failed mid-process, batch stuck in "processing" status

**Solution:**
1. Check batch exists and is stuck:
   ```sql
   SELECT id, status, created_at,
          EXTRACT(EPOCH FROM (NOW() - created_at))/60 as minutes_stuck
   FROM import_batches
   WHERE status = 'processing'
     AND created_by = '<USER_ID>'
   ORDER BY created_at DESC;
   ```

2. Rollback the stuck batch:
   ```sql
   SELECT rollback_import_batch_as_admin('<BATCH_ID>'::UUID, '<USER_ID>'::UUID);
   ```

3. Re-import the file via UI

---

### Scenario 2: Re-import After Rollback

**Problem:** Need to test same file multiple times

**Solution:**
1. Rollback previous import (keeps audit trail):
   ```sql
   SELECT rollback_import_batch_as_admin('<BATCH_ID>'::UUID, '<USER_ID>'::UUID);
   ```

2. Re-import via UI → should succeed (duplicate check ignores rolled_back status)

---

### Scenario 3: Clean Up Test Data Completely

**Problem:** Multiple test imports polluting database

**Solution:**
1. List all test imports:
   ```sql
   SELECT id, file_name, status, created_at
   FROM import_batches
   WHERE created_by = '<USER_ID>'
     AND report_type = 'tiktok_ads_daily'
     AND file_name LIKE '%test%'
   ORDER BY created_at DESC;
   ```

2. Purge each batch permanently:
   ```sql
   SELECT purge_import_batch_as_admin('<BATCH_ID>'::UUID, '<USER_ID>'::UUID);
   ```

---

### Scenario 4: Wrong File Imported

**Problem:** User uploaded Product Ads file but selected "Live" type

**Solution:**
1. Immediately rollback the import:
   ```sql
   SELECT rollback_import_batch_as_admin('<BATCH_ID>'::UUID, '<USER_ID>'::UUID);
   ```

2. Re-import with correct settings

---

## Verification After Rollback/Purge

### Check Data Deleted:

```sql
-- No rows in ad_daily_performance
SELECT COUNT(*) FROM ad_daily_performance WHERE import_batch_id = '<BATCH_ID>';
-- Expected: 0

-- No rows in wallet_ledger
SELECT COUNT(*) FROM wallet_ledger WHERE import_batch_id = '<BATCH_ID>';
-- Expected: 0
```

### Check Batch Status (After Rollback):

```sql
SELECT status, notes FROM import_batches WHERE id = '<BATCH_ID>';
-- Expected: status = 'rolled_back', notes contains rollback timestamp
```

### Check Batch Deleted (After Purge):

```sql
SELECT COUNT(*) FROM import_batches WHERE id = '<BATCH_ID>';
-- Expected: 0 (batch completely deleted)
```

---

## Troubleshooting

### Error: "Batch not found or access denied"

**Cause:** Wrong batch_id or user_id, or batch belongs to different user

**Fix:** Verify batch exists and belongs to correct user:
```sql
SELECT id, created_by FROM import_batches WHERE id = '<BATCH_ID>';
```

---

### Error: Function does not exist

**Cause:** Migration 022 not run yet

**Fix:** Run migration:
```bash
# In Supabase SQL Editor
# Run: database-scripts/migration-022-import-batch-rollback.sql
```

---

### Error: Status constraint violation

**Cause:** Old status constraint doesn't allow 'rolled_back'

**Fix:** Run migration 022 which updates constraint:
```sql
ALTER TABLE import_batches
ADD CONSTRAINT import_batches_status_valid
CHECK (status IN ('processing', 'success', 'failed', 'rolled_back', 'deleted'));
```

---

## Best Practices

1. **Always rollback first** (unless you need hard delete)
2. **Verify data deleted** before re-import
3. **Check stuck batches** regularly (> 5 minutes in "processing")
4. **Use purge sparingly** (loses audit trail)
5. **Test rollback in dev** before using in production
6. **Document batch_id** before purge (for audit)
7. **Check wallet balance** after rollback (should reflect deleted SPEND entries)

---

## Future Enhancements

1. **UI Rollback Button** on import success dialog
2. **Import History Page** with batch management
3. **Auto-cleanup** of old rolled_back batches (90 days)
4. **Bulk operations** for multiple batches
5. **Rollback preview** showing what will be deleted
6. **Audit log** for all rollback/purge operations
7. **Email notification** when rollback performed

---

## Related Documentation

- `BUSINESS_RULES_AUDIT.md` - Business logic verification
- `PERFORMANCE_ADS_VERIFICATION.md` - Import testing guide
- `database-scripts/verify-ads-import-comprehensive.sql` - Verification queries
- `database-scripts/migration-022-import-batch-rollback.sql` - Rollback functions source
