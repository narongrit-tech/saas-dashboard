# Import & Deduplication Rules

## Global Import Guarantees
- Every import must be **idempotent**.
- Use `import_batches` to track file hash, row counts, and status.
- Block duplicate imports when `file_hash + report_type` matches.
- Use **in-file dedup** for transaction-level imports (e.g., TikTok cashflow).

## Cashflow Imports (TikTok)
### Onhold (Forecast)
- Source table: `unsettled_transactions`.
- Required columns: Transaction ID, Amount, Expected Settlement Time.
- **Handles**: "Delivered + N days" fallback chain; must always return a date.
- **In-file dedup** by `txn_id`.
- Bulk upsert (avoid N+1).

### Income (Actual)
- Source table: `settlement_transactions`.
- Required columns: Transaction ID, Settlement Amount, Settled Time.
- Auto-reconcile with forecast data by `txn_id`.
- Bulk upsert + bulk reconciliation.

### Daily Summary
- `cashflow_daily_summary` is the **only** source for the primary cashflow view.
- Rebuild via `rebuild_cashflow_daily_summary()`.

## Performance Ads Import (Product / Live)
- File format: `.xlsx` only.
- **Must include sales metrics** (GMV/Orders/ROAS); otherwise block import.
- Daily breakdown: **one row per day per campaign**.
- Creates:
  - `ad_daily_performance` rows (analytics).
  - `wallet_ledger` SPEND entries (daily aggregated).
- Independent report types: `tiktok_ads_product` and `tiktok_ads_live`.

## Tiger Awareness Ads Import
- File format: `.xlsx` only.
- Filename must contain `Tiger` or `Campaign Report`.
- Must **NOT** include sales metrics (GMV/Orders/ROAS/etc).
- Monthly aggregation: **one wallet entry per file**.
- Posts to wallet on report **end date** (Bangkok timezone).

## Manual Column Mapping Wizard
- 4-step wizard: Report Type → Column Mapping → Preview → Confirm.
- Presets saved per user + filename pattern.
- Validation is **server-side**:
  - Tiger = no sales metrics.
  - Product/Live = must have sales metrics.
- Uses same import paths as auto-import (no duplication).

## Sales Import
### TikTok Shop (.xlsx OrderSKUList)
- Row 1 = header, Row 2 = description (skip), Row 3+ = data.
- Status normalization:
  - delivered/completed → `completed`.
  - cancel/return → `cancelled`.
- **Line-level** import: each SKU row inserted separately.
- Revenue uses **SKU Subtotal After Discount** to prevent double-counting.
- Extended TikTok metadata stored in JSONB.

### Manual Mapping (Shopee / Generic)
- Uses the manual mapping wizard flow when auto-parse fails.

## Expenses Import
- Standard template: Date, Category, Amount, Description.
- Categories must be `Advertising`, `COGS`, or `Operating`.
- Supports `.xlsx` and `.csv`.

## Expense Template Download
- Template has two sheets (template + instructions).
- File generation is server-side for correctness.

## Bank Statement Import
- Formats: KBIZ Excel, K PLUS CSV (UTF-8), Generic columns.
- Manual mapping fallback if auto-detection fails.
- File hash deduplication is **per bank account**.

### Import Modes
| Mode | Behavior | Re-import same file |
|------|----------|---------------------|
| `append` | Inserts new rows only. No deletion. | **Rejected** — file_hash check blocks if status=completed |
| `replace_range` | Deletes all rows for this account in the file's date range, then reinserts. | Deletes and reinserts (no rejection) |
| `replace_all` | Deletes ALL rows for this account, then reinserts. | Deletes and reinserts (no rejection) |

### Row-level Dedup (txn_hash)
- Every imported row gets a `txn_hash` = SHA256 of `bank_account_id|txn_date|withdrawal|deposit|description`.
- **Amount format**: amounts are formatted as fixed-2-decimal strings (`10000.00` not `10000`) — TypeScript uses `.toFixed(2)` and PostgreSQL uses `NUMERIC::TEXT` which preserves scale.
- A partial unique index `(created_by, bank_account_id, txn_hash) WHERE txn_hash IS NOT NULL` prevents row-level duplicates.
- `append` mode: insert is idempotent — duplicate `txn_hash` rows are silently skipped (error code 23505 fallback).
- `replace_range` / `replace_all`: delete before insert makes dedup moot, but hash is still stored for future append protection.

### Revenue Classifications (`bank_txn_classifications`)
- `bank_txn_classifications.bank_transaction_id` has `ON DELETE CASCADE`.
- Replace modes delete `bank_transactions` rows, which cascades to classifications.
- **Mitigation**: before deletion, the server action saves all classifications keyed by `txn_hash`, then restores them to the new row IDs after reinsertion. Classifications survive re-import in replace modes as long as the transaction content (hash) is unchanged.
- If transaction content changes (description, amount), the classification cannot be auto-matched and is lost (expected behavior).

### Validation Queries
```sql
-- Confirm no NULL hashes
SELECT COUNT(*) FROM bank_transactions WHERE txn_hash IS NULL;

-- Confirm no content duplicates
SELECT bank_account_id, txn_date, deposit, withdrawal, description, COUNT(*)
FROM bank_transactions
GROUP BY bank_account_id, txn_date, deposit, withdrawal, description
HAVING COUNT(*) > 1;

-- Confirm no txn_hash duplicates
SELECT created_by, bank_account_id, txn_hash, COUNT(*)
FROM bank_transactions WHERE txn_hash IS NOT NULL
GROUP BY created_by, bank_account_id, txn_hash HAVING COUNT(*) > 1;
```

## Import Batch Rollback (Operational)
- RPCs exist to rollback or clean up stuck batches.
- Prefer rollback tooling over manual row deletion.
- Reference: `docs/PROJECT_STATUS.md` and rollback guides in root docs.
