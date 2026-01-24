# Apply Database Migrations to Supabase

## Problem
Import fails with error: "Could not find the 'import_batch_id' column of 'sales_orders' in the schema cache"

## Root Cause
Migration files exist but haven't been applied to the Supabase database yet.

## Required Migrations (in order)

### 1. Migration 001: import_batches table
**File:** `database-scripts/migration-001-import-batches.sql`
**Purpose:** Create table to track file imports (deduplication + audit trail)

### 2. Migration 007: Add import support to sales_orders/expenses
**File:** `database-scripts/migration-007-import-sales-expenses.sql`
**Purpose:**
- Add `source` column (manual vs imported)
- Add `import_batch_id` FK to import_batches
- Add `metadata` JSONB for TikTok rich data

## How to Apply (Supabase Dashboard)

### Step 1: Open Supabase SQL Editor
1. Go to https://supabase.com/dashboard
2. Select your project
3. Click **SQL Editor** (left sidebar)
4. Click **New query**

### Step 2: Apply Migration 001 (import_batches)
1. Copy content from `database-scripts/migration-001-import-batches.sql`
2. Paste into SQL editor
3. Click **Run** (or Ctrl+Enter)
4. ✅ Expected: "Success. No rows returned"

### Step 3: Apply Migration 007 (import support)
1. Copy content from `database-scripts/migration-007-import-sales-expenses.sql`
2. Paste into SQL editor
3. Click **Run** (or Ctrl+Enter)
4. ✅ Expected: "Success. No rows returned"

### Step 4: Verify Schema
Run this query to verify columns were added:
```sql
-- Check sales_orders columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'sales_orders'
  AND column_name IN ('source', 'import_batch_id', 'metadata')
ORDER BY column_name;

-- Check expenses columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'expenses'
  AND column_name IN ('source', 'import_batch_id')
ORDER BY column_name;

-- Check import_batches table exists
SELECT table_name
FROM information_schema.tables
WHERE table_name = 'import_batches';
```

✅ Expected output:
```
sales_orders:
  - source (character varying, YES)
  - import_batch_id (uuid, YES)
  - metadata (jsonb, YES)

expenses:
  - source (character varying, YES)
  - import_batch_id (uuid, YES)

import_batches:
  - import_batches (found)
```

### Step 5: Restart Dev Server
After applying migrations, restart the frontend dev server:
```bash
# Stop current dev server (Ctrl+C)
cd frontend
npm run dev
```

This forces Next.js to reload the Supabase schema cache.

## Troubleshooting

### Error: "relation import_batches does not exist"
→ Apply Migration 001 first (import_batches table)

### Error: "column already exists"
→ Migration already applied, safe to ignore

### Error: "permission denied"
→ Check Supabase role has CREATE/ALTER permissions

### Import still fails after migration
→ Restart dev server (schema cache needs refresh)

## Verify Import Works

After applying migrations + restart:

1. Go to http://localhost:3000/sales
2. Click "Import" button
3. Select TikTok .xlsx file
4. Preview should show rows
5. Click "Confirm Import"
6. ✅ Expected: "Import สำเร็จ: X รายการ"

If still error, check:
- Did migrations run successfully? (check SQL editor output)
- Did you restart dev server?
- Check browser console for errors
- Check Supabase logs (Logs → Postgres Logs)

## Migration Files Location

All migrations are in: `database-scripts/`

Required for import:
- ✅ migration-001-import-batches.sql
- ✅ migration-007-import-sales-expenses.sql

Optional (already applied or not needed yet):
- migration-002-unsettled-transactions.sql
- migration-003-ad-daily-performance.sql
- migration-004-settlement-transactions.sql
- migration-005-wallets.sql
- migration-006-column-mappings.sql
