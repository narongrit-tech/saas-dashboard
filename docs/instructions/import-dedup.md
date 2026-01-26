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

## Import Batch Rollback (Operational)
- RPCs exist to rollback or clean up stuck batches.
- Prefer rollback tooling over manual row deletion.
- Reference: `docs/PROJECT_STATUS.md` and rollback guides in root docs.
