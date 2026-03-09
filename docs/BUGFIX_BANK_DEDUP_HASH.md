# Bug Fix: Bank Transaction Duplicate Rows + Hash Canonicalization

**Date:** 2026-03-09
**Severity:** High (wrong revenue totals in Dashboard)
**Status:** Resolved in production

---

## Symptoms Observed

1. Dashboard > Bank Inflows modal showed the same transaction twice — once with an unchecked checkbox (no classification) and once with a checked checkbox (with classification). Example affected rows: 2026-02-28 ฿10,000 / 2026-02-27 ฿60,000 / 2026-02-22 ฿50,000 etc.
2. `/bank` daily summary showed `2026-01-31` when the date filter was `2026-02-01 → 2026-02-28`.
3. Revenue classifications were silently destroyed when re-importing a bank statement in `replace_range` or `replace_all` mode.

---

## Root Causes

### Bug 1 — Hash format mismatch (primary duplicate cause)

`generateBankTxnHash` in TypeScript used `.toString()` for numeric amounts:

```ts
(withdrawal || 0).toString()  // 10000 → "10000"
```

PostgreSQL `NUMERIC(15,2)::TEXT` preserves 2 decimal places:

```sql
10000.00::TEXT  -- → "10000.00"
```

Same real-world transaction → two different SHA-256 hashes → both rows survived dedup. The partial unique index `WHERE txn_hash IS NOT NULL` only blocks rows with **matching** hashes, so cross-format duplicates were never caught.

### Bug 2 — txn_hash backfill not applied (amplifier)

`migration-018` added the `txn_hash` column and unique index, but the backfill `UPDATE` was commented out. Rows imported before migration-018 had `txn_hash IS NULL`. When the same transactions were re-imported after migration-018, new rows with non-NULL hashes were inserted alongside the old NULL-hash rows. The partial index (`WHERE txn_hash IS NOT NULL`) did not prevent this.

### Bug 3 — Bangkok timezone off-by-one in date queries

`getCashPositionFromDates` and `getBankDailySummary` used `format(date, 'yyyy-MM-dd')` from `date-fns`, which formats using the **server's local timezone**. On a UTC cloud server, Bangkok midnight (e.g., `2026-02-01T00:00:00+07:00`) equals `2026-01-31T17:00:00Z`. `format()` on UTC server → `"2026-01-31"` → wrong query boundary.

### Bug 4 — Classifications silently destroyed on replace

`bank_txn_classifications.bank_transaction_id` has `ON DELETE CASCADE` → `bank_transactions(id)`. `replace_range` / `replace_all` deletes rows and reinserts with new UUIDs. All revenue classifications for those rows were permanently lost with no warning.

---

## Fixes Applied

### Code changes

| File | Change |
|------|--------|
| `src/app/(dashboard)/bank/import-actions.ts` | `generateBankTxnHash`: `.toString()` → `.toFixed(2)` for withdrawal + deposit |
| `src/app/(dashboard)/bank/import-actions.ts` | Before replace delete: save classifications keyed by txn_hash; after reinsert: restore via upsert |
| `src/app/(dashboard)/bank/cash-position-actions.ts` | Add `formatBangkok` import; fix `getCashPositionFromDates` date formatting |
| `src/app/(dashboard)/bank/actions.ts` | Remove `format` from date-fns; replace all date-string conversions with `formatBangkok` |

### Migrations

| Migration | Description |
|-----------|-------------|
| `migration-078-bank-dedup-cleanup.sql` | Backfill NULL txn_hash rows; migrate classifications; remove hash-identical duplicates |
| `migration-079-bank-hash-canonicalize.sql` | Fix PG function (0 → 0.00); drop index; remove content-identical cross-format duplicates; force-recompute all hashes to canonical format; recreate index |
| `migration-080-bank-hash-final-state.sql` | Idempotent safety net: runs all cleanup logic conditionally, validates final state, raises on failure |

---

## Validation Queries

Run these after applying migrations. All must return 0.

```sql
-- 1. No NULL txn_hash
SELECT COUNT(*) AS null_hash_count
FROM public.bank_transactions
WHERE txn_hash IS NULL;

-- 2. No duplicate txn_hash per user/account
SELECT created_by, bank_account_id, txn_hash, COUNT(*) AS cnt
FROM public.bank_transactions
WHERE txn_hash IS NOT NULL
GROUP BY created_by, bank_account_id, txn_hash
HAVING COUNT(*) > 1;

-- 3. No content-duplicate rows (same business fields, different hash)
SELECT bank_account_id, txn_date, deposit, withdrawal, description, COUNT(*) AS cnt
FROM public.bank_transactions
GROUP BY bank_account_id, txn_date, deposit, withdrawal, description
HAVING COUNT(*) > 1;

-- 4. Verify canonical hash format (all should return 0 if format matches)
SELECT COUNT(*) AS non_canonical
FROM public.bank_transactions
WHERE txn_hash IS DISTINCT FROM generate_bank_txn_hash(
  bank_account_id, txn_date,
  COALESCE(withdrawal, 0.00),
  COALESCE(deposit, 0.00),
  description
);
```

---

## Import Behavior After Fix

| Mode | Idempotent? | Same file re-import | Classifications after re-import |
|------|-------------|---------------------|---------------------------------|
| `append` | ✅ Yes | Rejected at file-hash check | N/A (no deletion) |
| `replace_range` | ✅ Yes | Deletes date range, reinserts | **Preserved** via txn_hash remap |
| `replace_all` | ✅ Yes | Deletes all, reinserts | **Preserved** via txn_hash remap |

**Key invariant**: `txn_hash = SHA256(bank_account_id|txn_date|withdrawal_toFixed2|deposit_toFixed2|description)` — both TypeScript and PostgreSQL now produce identical values.

---

## Lessons

1. When adding a unique constraint / dedup index to a live table, **always backfill immediately** in the same migration. Do not comment out the backfill.
2. Hash inputs that involve numbers must be formatted to a canonical string before hashing. Specify the format explicitly in the function comment.
3. `date-fns` `format()` uses the runtime's local timezone. Always use `formatBangkok()` for any date string that goes into a DB query.
4. `ON DELETE CASCADE` FK constraints must be considered in any bulk-delete import path. Save and restore linked data explicitly.
