# Database Migration Guidelines

## Overview
This document defines the rules and best practices for managing database migrations in this project.

## Migration Naming Convention

Migrations must follow this format:
```
migration-{NUMBER}-{description}.sql
```

- **NUMBER**: 3-digit zero-padded sequential number (e.g., 001, 002, 060)
- **description**: kebab-case description of what the migration does

**Examples:**
- ✅ `migration-060-add-user-preferences.sql`
- ✅ `migration-061-fix-inventory-rls.sql`
- ❌ `migration-60-add-feature.sql` (not zero-padded)
- ❌ `migration-062-Add_Feature.sql` (not kebab-case)

---

## Critical Rules

### 🚫 Rule 1: NEVER Rename or Modify Executed Migrations

**Once a migration has been executed on ANY environment (dev, staging, production), you MUST NOT:**
- ❌ Rename the file
- ❌ Change the migration number
- ❌ Modify the SQL content (except for comments/documentation)

**Why?**
- Breaks migration history and tracking
- Causes confusion in team collaboration
- Makes rollback/debugging impossible
- Creates mismatch between DB state and migration files

**If you need to fix a migration:**
- ✅ Create a NEW migration with the fix
- ✅ Use a descriptive name like `migration-{N}-fix-{original-issue}.sql`
- ✅ Reference the original migration number in comments

---

### 📋 Rule 2: Always Check for Duplicates Before Creating

**Before creating a new migration:**
```bash
npm run migration:check
```

This script will:
- ✅ Detect duplicate migration numbers
- ✅ Show the current maximum number
- ✅ Recommend the next available number to use
- ❌ Exit with error if duplicates exist (blocks CI/CD)

**Example output:**
```
✓ Scanning database-scripts/ for migrations...
✓ Found 65 migration files

⚠ Duplicate migration numbers detected:
  058: migration-058-ceo-commission.sql, migration-058-rename-bundle-sku-NEWOON003.sql

✗ Duplicates found! Do NOT create new migrations until this is resolved.

Latest migration number: 060
Next available number: 061

Recommendation: Use migration-060-{your-description}.sql
```

---

### 🔢 Rule 3: Use Sequential Numbers (No Skipping)

- Always use the next available number from `migration:check`
- Do not skip numbers or create gaps
- Do not reuse old numbers from deleted migrations

**Correct flow:**
1. Run `npm run migration:check` → shows next is 060
2. Create `migration-060-my-feature.sql`
3. Test locally
4. Commit and push
5. Execute on target environment

---

### 📦 Rule 4: One Logical Change Per Migration

Each migration should represent ONE logical database change:
- ✅ Add a new table
- ✅ Add/modify columns in ONE table
- ✅ Create indexes for ONE feature
- ✅ Add RLS policies for ONE table

**Split large changes into multiple migrations:**
- Instead of: `migration-060-big-refactor.sql` (10 tables changed)
- Do:
  - `migration-060-refactor-users-table.sql`
  - `migration-061-refactor-orders-table.sql`
  - `migration-062-refactor-add-indexes.sql`

**Benefits:**
- Easier to review
- Easier to rollback specific changes
- Clearer migration history

---

## Historical Duplicates

### Current State (as of 2026-02-19)

The following duplicate numbers exist in the codebase:
- **005**: wallets, wallets-seed
- **016**: bank-opening-balance, bank-opening-balance-v2
- **019**: cash-in-classification, global-import-dedupe
- **020**: bank-reconciliation-manual-match, import-batches-metadata
- **025**: bank-import-enhancements, sales-order-line-hash-full-unique-index
- **042**: profit-order-level-rollup, profit-order-rollup-view
- **058**: ceo-commission, rename-bundle-sku-NEWOON003

### Why Not Fix Them?

**These duplicates are historical and have been executed on production.**

According to **Rule 1**, we MUST NOT rename them because:
- It would break the migration history
- Both files in each duplicate pair have been executed
- Renaming would cause confusion about which file was actually run
- Team members have already referenced these filenames in docs/code

### Moving Forward

- ✅ Keep historical duplicates as-is (do not rename)
- ✅ Document them in this file (done above)
- ✅ Use `migration:check` script to prevent NEW duplicates
- ✅ Next migration should be **061** (after the highest number 060)

---

## Workflow: Creating a New Migration

### Step 1: Check Current State
```bash
npm run migration:check
```

Expected output (if no duplicates):
```
✓ No duplicate migration numbers found
Latest migration number: 059
Next available number: 060
```

### Step 2: Create Migration File
```bash
# In database-scripts/ directory
touch migration-060-your-feature-name.sql
```

### Step 3: Write Migration SQL

**Template:**
```sql
-- ============================================
-- Migration 060: Your Feature Name
-- Description: What this migration does
-- Date: YYYY-MM-DD
-- ============================================

BEGIN;

-- Your SQL changes here
CREATE TABLE IF NOT EXISTS ...;

-- Verification
DO $$
BEGIN
    -- Check if migration was successful
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'your_table') THEN
        RAISE NOTICE 'Migration 060 completed successfully!';
    ELSE
        RAISE EXCEPTION 'Migration 060 failed!';
    END IF;
END $$;

COMMIT;

-- ============================================
-- ROLLBACK (if needed)
-- ============================================
-- DROP TABLE IF EXISTS your_table CASCADE;
```

### Step 4: Test Locally

```bash
# Run on local Supabase
psql -d your_local_db -f database-scripts/migration-060-your-feature-name.sql

# Or via Supabase CLI
supabase db reset
```

### Step 5: Commit and Push

```bash
git add database-scripts/migration-060-your-feature-name.sql
git commit -m "feat(db): add migration 060 - your feature name"
git push
```

### Step 6: Execute on Target Environment

```bash
# Via Supabase dashboard SQL editor
# Or via psql connected to remote
psql -h db.your-project.supabase.co -U postgres -d postgres -f database-scripts/migration-060-your-feature-name.sql
```

---

## NPM Scripts Reference

### `npm run migration:check`
- **Purpose**: Detect duplicate migration numbers
- **Exit codes**:
  - `0`: No duplicates found (safe to create new migration)
  - `1`: Duplicates detected (do not create new migration)
- **Output**: Max number, next available number, duplicate list (if any)

### `npm run migration:next` *(optional)*
- **Purpose**: Print only the next available migration number
- **Output**: `060` (just the number, no formatting)
- **Use case**: Scripting, automation

---

## Pre-Commit Hook (Optional)

To enforce migration number uniqueness, add this to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
npm run migration:check
if [ $? -ne 0 ]; then
  echo "❌ Migration check failed! Fix duplicates before committing."
  exit 1
fi
```

---

## Troubleshooting

### Q: I accidentally created a duplicate number. What do I do?

**A:** If the migration has NOT been executed yet:
1. Rename the file to use the next available number
2. Update any references in commit messages/docs
3. Run `migration:check` to confirm

**A:** If the migration HAS been executed:
1. Do NOT rename it (breaks history)
2. Document it in this file under "Historical Duplicates"
3. Ensure future migrations use higher numbers

### Q: Can I delete old migrations?

**A:** NO, unless:
- The migration has never been executed on ANY environment
- You are 100% certain no one else has run it
- You have checked with the entire team

**In general:** Keep all migrations forever for audit trail.

### Q: What if I need to undo a migration?

**A:** Create a new migration with the rollback logic:
```sql
-- migration-070-rollback-user-table-changes.sql
-- This undoes migration-065-add-user-columns.sql

ALTER TABLE users DROP COLUMN IF EXISTS new_column;
```

---

## Summary

✅ **DO:**
- Run `npm run migration:check` before creating new migrations
- Use the next sequential number
- Keep migrations small and focused
- Write clear descriptions
- Test locally before committing
- Document complex changes in comments

❌ **DON'T:**
- Rename executed migrations
- Modify executed migrations
- Skip or reuse migration numbers
- Create duplicate numbers
- Combine unrelated changes in one migration
- Delete migrations that have been executed

---

**Last Updated:** 2026-02-19
**Current Latest Migration:** 060
**Next Available Number:** 061
