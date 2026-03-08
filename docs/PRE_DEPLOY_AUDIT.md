# PRE-PRODUCTION SYSTEM AUDIT
**SaaS Dashboard — Multi-Channel E-Commerce**
**Audit Date:** 2026-03-08
**Branch:** feat/performance-dashboard-v2
**Auditor:** Claude Code (evidence-based automated audit)

---

## 1. Executive Summary

The system is **conditionally deployable for internal use** with known limitations. Core financial workflows (Sales, Expenses, COGS, P&L, Wallets, Bank) are production-grade. Several modules are stubs or incomplete. A small number of security and data-integrity risks exist that must be addressed or accepted before deployment.

**Deployment Verdict:** ⚠️ CONDITIONAL — not blocking for internal team (≤5 users), but requires pre-deploy checklist below.

**Critical items that must be verified before deployment:**
1. Confirm migration-066 (RLS fix) was applied to the production database.
2. Confirm Settings module server actions have acceptable role-guard behavior for the team.
3. Remove or isolate `mock-data.ts` (dead file — risk of future misuse).
4. Accept that `/reports/profit` tabs are incomplete placeholders.
5. Accept that `/payables` is a stub (no functionality).

---

## 2. System Capability Today

### What is production-ready
| Module | Status |
|---|---|
| Performance Dashboard (/) | Production-ready |
| Sales Orders (TikTok + Shopee import, pagination, export) | Production-ready |
| Expenses (DRAFT/PAID workflow, attachments) | Production-ready |
| Marketplace Wallets (TikTok, Shopee import, ledger view) | Production-ready |
| Ads Performance (product/live/awareness) | Production-ready |
| Bank Statements (import, view, reconciliation) | Production-ready |
| Bank Reconciliation (auto + manual match) | Production-ready |
| Inventory / COGS (FIFO + Moving Avg, bundles, allocations) | Production-ready |
| SKU Mappings | Production-ready |
| Shopee Finance (balance + settlement import) | Production-ready |
| Notifications (bell, COGS run history) | Production-ready |
| Cash P&L (/reports/cash-pl) | Production-ready |
| Settings (general, users, roles, permissions) | Production-ready (with security caveat — see §7) |
| Daily P&L (/daily-pl — accessible but removed from nav) | Working |

### What is incomplete or a stub
| Module | Status | Notes |
|---|---|---|
| Payables (/payables) | PLACEHOLDER | 7-line stub with static text, no DB queries |
| Profit Reports (/reports/profit) | PARTIAL | Data fetched for 1 of 4 tabs; other 3 render "TODO: Render table" |
| Lazada Finance | PLACEHOLDER | `MarketplaceComingSoon` component, no data |
| Company Cashflow — Opening Balance | PARTIAL | Hardcoded to 0 (TODO in code) |

---

## 3. Module Status Matrix

| Route | File | Code Quality | Data Source | Status |
|---|---|---|---|---|
| `/` | page.tsx + actions.ts | Complete | DB: sales_orders, inventory_cogs_allocations, wallet_ledger, ad_daily_performance, expenses | ✅ COMPLETE |
| `/sales` | page.tsx + actions.ts | Complete | DB: sales_orders | ✅ COMPLETE |
| `/expenses` | page.tsx + actions.ts | Complete | DB: expenses, expense_attachments | ✅ COMPLETE |
| `/wallets` | page.tsx + actions.ts | Complete | DB: wallet_ledger, wallets | ✅ COMPLETE |
| `/ads` | page.tsx (delegates) | Complete | DB: ad_daily_performance | ✅ COMPLETE |
| `/overview/performance` | page.tsx | Complete | DB: ad_daily_performance | ✅ COMPLETE |
| `/bank` | page.tsx (delegates) | Complete | DB: bank_transactions | ✅ COMPLETE |
| `/bank-reconciliation` | page.tsx | Complete | DB: bank_transactions + recon tables | ✅ COMPLETE |
| `/inventory` | page.tsx + actions.ts | Complete (4 tabs) | DB: inventory_items, receipt_layers, cogs_allocations | ✅ COMPLETE |
| `/sku-mappings` | page.tsx | Complete | DB: inventory_sku_mappings | ✅ COMPLETE |
| `/finance/shopee` | redirect → /finance/marketplaces/shopee | Redirect | — | ✅ COMPLETE |
| `/finance/marketplaces` | page.tsx | Complete | Static links to sub-routes | ✅ COMPLETE |
| `/finance/marketplaces/[marketplace]` | page.tsx | TikTok + Shopee complete; Lazada = stub | DB for TikTok/Shopee | ⚠️ PARTIAL (Lazada) |
| `/reports/cash-pl` | page.tsx + actions.ts | Complete | DB: bank_transactions, wallet_ledger | ✅ COMPLETE |
| `/reports/affiliate` | page.tsx | Functional | DB: affiliate tables | ✅ COMPLETE |
| `/ceo-commission` | page.tsx + actions.ts | Functional | DB: ceo_transactions | ✅ COMPLETE |
| `/settings` | redirect → /settings/general | — | — | ✅ COMPLETE |
| `/settings/general` | page.tsx | Complete | DB: app_settings | ✅ COMPLETE |
| `/settings/users` | page.tsx | Complete (requires SERVICE_ROLE_KEY) | DB: auth.users, user_role_assignments | ✅ COMPLETE |
| `/settings/roles` | page.tsx | Complete | DB: roles | ✅ COMPLETE |
| `/settings/permissions` | page.tsx | Complete | DB: permissions, role_permissions | ✅ COMPLETE |
| `/payables` | page.tsx | Static text only | None | ❌ STUB |
| `/daily-pl` | page.tsx | Complete but removed from nav | DB: daily_pl logic | ✅ WORKING (hidden) |
| `/reports/profit` | page.tsx | 1/4 tabs functional; 3/4 are "TODO" placeholders | DB (partial) | ⚠️ PARTIAL |

---

## 4. Financial Logic Audit

### 4.1 P&L Formula (as implemented)

```
Net Profit = GMV - AdSpend - COGS - OperatingExpenses - TaxExpenses
```

**GMV sources:**
- Default (`gmvBasis=created`): `fetchGMVByCreatedTime()` — paginated 1000/page, strict `created_time` bucketing, per-order dedup, order_amount consistency check
- Paid basis (`gmvBasis=paid`): `fetchGMVByDayPaid()` — same logic but buckets by `paid_time`, excludes orders where `paid_time IS NULL`

**Ad Spend sources (blended):**
- Product campaigns: `ad_daily_performance WHERE campaign_type = 'product'`
- Live campaigns: `ad_daily_performance WHERE campaign_type = 'live'`
- Awareness campaigns: `wallet_ledger WHERE entry_type='SPEND' AND direction='OUT' AND note ILIKE '%Awareness Spend%'`

**COGS sources:**
- Shipped mode (default): `inventory_cogs_allocations.amount` filtered by `shipped_at` — matches when goods physically shipped
- Created mode (`cogsBasis=created`): rebuckets COGS allocations to order `created_time` via `sales_orders` join (chunk size 200)

**Expenses:**
- Operating: `expenses WHERE category = 'Operating'` (with optional COGS expense picker override)
- Tax: `expenses WHERE category = 'Tax'` (with optional expense picker override)

### 4.2 Financial Logic Risks

| Risk | Severity | Detail |
|---|---|---|
| **GMV excludes orders with `created_time = NULL`** | MEDIUM | `fetchGMVByCreatedTime` filters `.not('created_time', 'is', null)`. Older Shopee orders without `created_time` are silently excluded from default GMV view. Impact: understated GMV for historical periods. |
| **COGS (shipped mode) has no pagination** | MEDIUM | Single query fetch of all `inventory_cogs_allocations` in date range. Large date ranges may hit PostgREST memory limits and silently return partial data. |
| **Expenses capped at 9,999 rows per query** | LOW | `buildExpensesByDay` uses `.range(0, 9999)`. Silent truncation if team has more than 10,000 expense rows in a single date range. Very unlikely for ≤5 users. |
| **Company Cashflow opening_balance hardcoded to 0** | LOW | `company-cashflow/actions.ts` has `opening_balance: number // TODO`. Closing balance is always `net_cashflow`, not true closing balance. |
| **COGS allocation has no DB transaction** | MEDIUM | If `applyCOGSForBatch` or `applyCOGSMTD` fails mid-run, partial allocations remain. No automatic rollback. Requires manual cleanup. |
| **Ad Spend source inconsistency** | LOW | MEMORY.md states "wallet_ledger NOT ad_daily_performance" for ad spend, but the main P&L uses `ad_daily_performance` for product/live. This is a documentation error, not a code error. Code is correct. |
| **ROAS formula uses blended GMV / blended AdSpend** | LOW | If awareness spend wallet ledger has no entries, awareness = 0 silently. ROAS denominator may appear inflated. No UI warning for this case. |

### 4.3 Confirmed Correct
- Top-up entries are NOT counted as expenses (wallet_ledger TOP_UP entries are excluded from the P&L expense calculation)
- Ad wallet top-up is NOT counted as ad spend (only SPEND/OUT entries counted)
- Cash P&L and Accrual P&L are separate views (no mixing)
- Bangkok timezone (+07:00) is applied on all datetime inserts

---

## 5. Import Pipeline Audit

### 5.1 Summary Table

| Pipeline | File-Level Dedup | Row-Level Dedup | Batch Tracking | Rollback | Status |
|---|---|---|---|---|---|
| TikTok Sales | SHA256 `file_hash` on `import_batches` | `order_line_hash` (SHA256), `onConflict: 'created_by,order_line_hash'` | ✅ Full (create→chunk→finalize) | ✅ `/api/import/rollback` | ✅ SAFE |
| Shopee Orders | SHA256 `file_hash` | Same `order_line_hash` via shared `importSalesChunk` | ✅ Full | ✅ | ✅ SAFE |
| Shopee Wallet | SHA256 `file_hash` | `txn_hash` on `shopee_wallet_transactions` | ✅ Full | ❌ No rollback | ⚠️ No rollback |
| TikTok Ads (Performance) | SHA256 `file_hash` | `source_row_hash` on `ad_daily_performance` | ✅ Full | ✅ `/api/import/rollback` | ✅ SAFE |
| Awareness Ads (Tiger) | SHA256 `file_hash` | Row-level hash on `wallet_ledger` | ✅ Full | ❌ No rollback | ⚠️ No rollback |
| Bank Statement | SHA256 `file_hash` | NO row-level hash — delete + re-insert strategy | ✅ Full | ❌ No rollback | ⚠️ SEE BELOW |
| Shopee Finance (Balance) | SHA256 `file_hash` | UNIQUE constraint `NULLS NOT DISTINCT` (PG15+) | ✅ Full | ❌ No rollback | ✅ SAFE |
| Shopee Finance (Settlement) | SHA256 `file_hash` | Same UNIQUE constraint | ✅ Full | ❌ No rollback | ✅ SAFE |

### 5.2 Bank Import Risk
The bank import uses delete + re-insert for `replace_range` and `replace_all` modes (not upsert). This:
- Deletes existing `bank_transactions` rows in the target range
- `bank_txn_classifications` has `ON DELETE CASCADE` — so classifications (revenue tagging) are permanently deleted when bank transactions are replaced
- A user who re-imports a bank statement will lose their revenue classification assignments silently

**Recommendation:** Warn user in UI before replace_range/replace_all import that classifications will be deleted.

---

## 6. Database Schema Audit

### 6.1 Tables Present (confirmed)

**Core schema.sql tables:** `sales_orders`, `expenses`, `inventory` (legacy), `payables`, `tax_records`, `ceo_transactions`, `wallets`, `wallet_ledger`, `settlement_transactions`

**Migration-added tables (relevant):**
- `import_batches` — import tracking
- `ad_daily_performance` — daily ads metrics
- `bank_transactions`, `bank_accounts` — bank data
- `inventory_items`, `inventory_receipt_layers`, `inventory_cogs_allocations`, `inventory_bundle_components`, `inventory_cost_snapshots` — FIFO/AVG costing engine
- `inventory_returns`, `inventory_sku_mappings` — returns + SKU mapping
- `shopee_wallet_transactions`, `shopee_order_settlements` — Shopee finance
- `cogs_allocation_runs`, `notifications` — COGS run history + bell inbox
- `expense_attachments` — expense receipts
- `bank_txn_classifications` — bank revenue tagging
- `app_settings`, `user_preferences`, `roles`, `permissions`, `role_permissions`, `user_role_assignments`, `settings_audit_logs` — Settings module

### 6.2 RLS Status

| Table Group | RLS Status | Notes |
|---|---|---|
| Core tables (schema.sql) | ⚠️ REQUIRES VERIFICATION | Had `USING(true)` in original schema; fixed in migration-066. Must confirm migration-066 applied. |
| New tables (migrations 062–077) | ✅ Correct from creation | All use `created_by = auth.uid()` |
| `bank_statement_import_batches` | ⚠️ Check column name | Uses `imported_by` not `created_by` — verify RLS policy references correct column |
| `user_roles` (legacy, migration-032) | ❓ Unknown | Legacy table; verify RLS policies exist |
| `inventory` (legacy, schema.sql) | ⚠️ REQUIRES VERIFICATION | Same as core tables above — fixed in migration-066 |

### 6.3 Legacy / Duplicate Patterns

| Issue | Detail |
|---|---|
| Two permission systems | `user_roles` (legacy, migration-032) used in `/sales/page.tsx` for admin check. `user_role_assignments` (new, migration-077) used in Settings. These are NOT synced. An admin-role user in the new system may not have admin access to sales module features. |
| Two inventory table families | `inventory` (schema.sql, original) vs `inventory_items` (migration-033, FIFO system). The FIFO/AVG costing engine uses `inventory_items`. Confirm old `inventory` table is not relied on for production COGS. |

---

## 7. Security Audit

### 7.1 Authentication
- ✅ `middleware.ts` protects all routes; unauthenticated users are redirected to `/login`
- ✅ `(dashboard)/layout.tsx` has secondary server-side auth check
- ✅ All API routes (`/api/bank/import`, `/api/import/*`) verify user via `supabase.auth.getUser()`
- ✅ No unauthenticated API endpoints found

### 7.2 Authorization (Role Enforcement)

| Action | Auth Check | Role Check | Risk |
|---|---|---|---|
| `createRole` | ✅ | ❌ None | Any authenticated user can create roles |
| `updateRole` / `deleteRole` | ✅ | ❌ None | Any user can delete any role |
| `assignRoleToUser` / `removeRoleFromUser` | ✅ | ❌ None | Any user can assign themselves Owner role |
| `grantPermission` / `revokePermission` | ✅ | ❌ None | Any user can grant themselves any permission |
| `backfillMissingReturnStock` | ✅ | ✅ isAdmin check (legacy user_roles) | OK but uses legacy system |
| `createServiceClient()` (listUsers) | ✅ | ✅ Requires SERVICE_ROLE_KEY | Correct |

**Risk assessment:** For an internal team of ≤5 trusted users this is LOW risk in practice. For a multi-tenant or semi-public deployment this would be CRITICAL. Document the gap and accept if deploying to known trusted users only.

### 7.3 Data Isolation

| Risk | Status |
|---|---|
| RLS `USING(true)` on core tables | ⚠️ FIXED in migration-066 — must verify applied |
| CSV formula injection in exports | ❌ Known gap (acknowledged in MEMORY.md) — no sanitization of cell content |
| File size limits on imports | ❌ Known gap — no server-side file size validation on CSV/Excel imports |
| Reconciliation amount validation | ❌ Known gap |

### 7.4 Service Role Key
- Used only in `settings/actions.ts → listUsers()`
- Correctly throws error if env var missing
- Not used elsewhere — correctly scoped

---

## 8. Mock Data & Dead Code Audit

### 8.1 Mock Data File
`frontend/src/lib/mock-data.ts` contains:
- `dashboardStats` — fake P&L numbers
- `generateSalesTrend()` using `Math.random()` — fake daily sales data
- `recentOrders`, `recentExpenses` — fake order/expense arrays
- `inventoryItems` — fake inventory data

**Finding:** This file is NOT imported by any active production page. Only `formatCurrency` / `formatCurrencyShort` helpers are imported from `sales/actions.ts`. The fake data arrays are dead code.

**Risk:** Dead code with financial-looking fake data. If a future developer adds an import, fake data could appear in production. **Recommend deleting the fake data arrays or the entire file.**

### 8.2 Placeholder / TODO Findings

| Location | Pattern | Impact |
|---|---|---|
| `/reports/profit/page.tsx:562,592,618` | `<div>Data loaded (TODO: Render table)</div>` | Users see broken UI on 3 of 4 profit report tabs |
| `company-cashflow/actions.ts:30` | `opening_balance: 0 // TODO` | Company Cashflow closing balance is always wrong |
| `finance/marketplaces/[marketplace]` Lazada tab | `MarketplaceComingSoon` component | Lazada sidebar link leads to dead-end stub |
| `affiliates/actions.ts:262` | `// TODO: Optimize with proper SQL join` | Performance note only — not data risk |

### 8.3 Confirmed Safe
- `sales-parser.ts:75` — `Math.random() < 0.002` is a sampling gate for console.log only
- `PerformanceAdsImportDialog.tsx:129` — `Math.random().toString(36)` generates UI job tracking IDs only

---

## 9. Deployment Risk Checklist

### 9.1 Hard Blockers (must fix or confirm before deploying)

- [ ] **Verify migration-066 was applied to production.** Run the verify script at `database-scripts/verify/verify-rls-policies.sql` Query 3 — expected result: 0 rows with `USING(true)` on critical tables.
- [ ] **Confirm environment variables are set:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### 9.2 Known Issues to Accept Before Deploy

- [ ] **Settings role management is not self-protected** — any authenticated user can modify roles/permissions. Acceptable for small trusted teams.
- [ ] **`/reports/profit` shows "TODO: Render table"** on 3 tabs. Remove or hide the page from navigation if not ready.
- [ ] **`/payables` is a stub** — shows only static text.
- [ ] **Bank re-import deletes `bank_txn_classifications`** — warn users in UI.
- [ ] **Company Cashflow opening balance is always 0.**
- [ ] **`legacy user_roles` vs `user_role_assignments` mismatch** — admin check in sales page uses legacy table. New role assignments have no effect on sales module admin features.

### 9.3 Low Priority / Post-Deploy

- [ ] Remove or clean up `frontend/src/lib/mock-data.ts` fake data arrays
- [ ] Add pagination to COGS shipped-mode query
- [ ] Remove stale root-level `.md` files (80+ files cluttering repo root)
- [ ] Add file size limits to import endpoints
- [ ] Add CSV formula injection sanitization to export functions
- [ ] Update `PROJECT_STATUS.md` (last updated 2026-02-01, missing 5+ weeks of features)
- [ ] Investigate `@supabase/auth-helpers-nextjs` (deprecated) coexisting with `@supabase/ssr`
- [ ] `xlsx` package (SheetJS Community Edition) has known security disclosures — consider ExcelJS for production

### 9.4 No CI/CD Pipeline
There is no automated test suite, no GitHub Actions workflow, no Dockerfile, and no deployment configuration. All deployments are manual. Risk: regressions go undetected until production. Acceptable for internal tool with small team.

---

## 10. Docs vs Code Discrepancy Report

| Feature | Documentation Claims | Code Reality | Judgment |
|---|---|---|---|
| Ad Spend source for P&L | MEMORY.md: "wallet_ledger NOT ad_daily_performance" | Main P&L uses `ad_daily_performance` for product/live; `wallet_ledger` for Awareness only | MEMORY.md is **incorrect** — code is correct, doc needs update |
| Cash on Hand card | `docs/instructions/architecture.md`: "Cash on Hand (still mock data)" | No Cash on Hand card exists — replaced by Performance Dashboard with real DB | Doc is **stale** (pre-Performance Dashboard v2) |
| Settings security | MEMORY.md: "16 actions, all write to settings_audit_logs" | Audit logging confirmed; BUT no role guard on mutation actions | Doc is **incomplete** — omits security gap |
| CEO Commission | PROJECT_STATUS.md Phase 9: "TODO: CEO Commission Flow" | `/ceo-commission/` exists with full page.tsx + actions.ts | Doc is **stale** — feature exists |
| Payables | PROJECT_STATUS.md Phase 9: "TODO: Payables/Receivables" | `/payables/page.tsx` is a 7-line stub | Doc is **consistent** |
| Analytics Builder | MEMORY.md: "REMOVED 2026-03-03" | Not present in codebase | Consistent ✅ |
| Opening Balance | `business-rules.md`: documented as part of cashflow | Code: hardcoded 0 with TODO comment | Doc describes desired state; **code is incomplete** |
| PROJECT_STATUS.md last update | "Last Updated: 2026-02-01" | Settings module (migration-077, 2026-03-08), Bank Revenue Classification (migration-075), Performance Dashboard v2 all added after that date | **Significantly outdated** — missing 5+ weeks of major features |
| Daily P&L removed from nav | PROJECT_STATUS.md states removed | Confirmed: sidebar.tsx has no `/daily-pl` entry, but page.tsx still exists | Consistent ✅ |
| COGS no DB transaction | MEMORY.md acknowledges this | Confirmed in code — no `BEGIN/COMMIT` wrapping COGS allocation loop | Consistent ✅ (known risk) |

---

## 11. Appendix: Evidence References

| Claim | Evidence File |
|---|---|
| P&L formula | `frontend/src/app/(dashboard)/actions.ts` → `getPerformanceDashboard()` |
| Ad spend source | `frontend/src/app/(dashboard)/actions.ts` → `getAdsBreakdown()` |
| GMV null exclusion | `frontend/src/lib/sales-metrics.ts` → `fetchGMVByCreatedTime()` |
| COGS no transaction | `frontend/src/app/(dashboard)/inventory/cogs-run-actions.ts` |
| Mock data file | `frontend/src/lib/mock-data.ts` |
| Settings no role guard | `frontend/src/app/(dashboard)/settings/actions.ts` |
| Bank cascade delete risk | `database-scripts/migration-075-bank-revenue-classification.sql` → `ON DELETE CASCADE` |
| RLS critical fix | `database-scripts/migration-066-fix-rls-policies.sql` |
| Expenses 9999 cap | `frontend/src/app/(dashboard)/actions.ts` → `buildExpensesByDay()` |
| Payables stub | `frontend/src/app/(dashboard)/payables/page.tsx` |
| Opening balance TODO | `frontend/src/app/(dashboard)/company-cashflow/actions.ts` |
| Profit page TODO | `frontend/src/app/(dashboard)/reports/profit/page.tsx:562,592,618` |

---

*This audit was generated via automated codebase inspection. All findings are evidence-based. Claims marked ✅ were verified against actual source files. Claims marked ⚠️ require human verification against the live database.*
