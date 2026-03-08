# SaaS Dashboard — Current Progress Summary

> **Audit date:** 2026-03-08
> **Branch audited:** `feat/performance-dashboard-v2`
> **Audit basis:** Live repo code + migrations + navigation structure (not older summary docs)

---

## 1) Executive Summary

The SaaS Dashboard is a mature, internally-focused multi-channel e-commerce management system built on Next.js App Router + Supabase. As of this audit the codebase contains 36 dashboard routes, 100+ components, 77 applied migrations, and real server-action data flows for the vast majority of modules. The core workflows — Sales import, Expenses Draft→Paid, Inventory COGS allocation, Performance Dashboard v2, Wallets, Bank, and Reconciliation — are wired to live data and appear safe for internal deployment. Three notable gaps remain: the Payables module is a confirmed placeholder stub, the Settings Security sub-page (2FA/API keys) is likely UI-only without functional backend, and admin-role enforcement in UI relies on client-side `isAdmin` state without a dedicated server-side role middleware layer. With those three items either hidden or accepted as known limitations, the system is **ready for internal deployment with conditions**.

---

## 2) Current System Phase

**Phase:** POST-MVP / Stabilization / Pre-Deployment

**What this means in practice:**
- All core P&L, import, and reporting workflows are implemented with live data
- The system handles real TikTok + Shopee data through tested import pipelines
- Dedup, RLS, and Bangkok timezone logic are consistently applied
- The focus now is on final wiring verification, hiding incomplete modules, and confirming migrations are applied to the production database

**In scope now:**
- Internal deployment to production Supabase instance
- Team onboarding (≤5 users) with role assignment via Settings → Users
- Daily operational use of all COMPLETE and WORKING WITH LIMITATIONS modules

**Out of scope until after deployment:**
- Payables management
- Fully functional 2FA / API key security settings
- Lazada order import (SKU mappings support Lazada but no order import yet)
- Analytics Builder (permanently removed)
- Advanced notification settings, master data management

---

## 3) What the System Can Reliably Do Today

Evidence-based production-usable workflows:

- **Import TikTok sales orders** with full dedup (file-hash + order_line_hash), chunked upsert, batch rollback
- **Import Shopee orders, wallet transactions, balance reports, settlement income** — all with dedup
- **Import TikTok and Tiger Ads daily performance** with row-level dedup (source_row_hash)
- **Import bank statements** (CSV/Excel) with column auto-detection, overlap check, dedup
- **Record and track Expenses** in DRAFT→PAID workflow with attachment requirement and audit trail
- **Apply COGS allocation (MTD or per-batch)** using FIFO/Moving Average with bundle support
- **View Performance Dashboard v2** — 7-day Economic P&L with GMV/COGS/Revenue basis toggles and ROAS
- **View Cash P&L** — bank-based cash-in/out vs accrual reconciliation
- **Manage Wallets** — multi-wallet ledger (TikTok Ads, Shopee, Subscriptions, Foreign)
- **Track Bank transactions** with opening balance, daily summary, and manual cash-in classification
- **Run P&L vs Cashflow Reconciliation** — bridge report with CSV export
- **Run Bank Reconciliation** — manual match between bank transactions and internal records
- **Manage Users / Roles / Permissions** via Settings module (Owner/Admin/Operator/Viewer)
- **Track Returns** with marketplace_sku → sku_internal resolution and undo capability
- **Manage SKU Mappings** (TikTok/Shopee/Lazada → internal inventory items)
- **Track CEO Commissions** with bank source attribution
- **View Affiliates and Affiliate Reports** with order attribution
- **View Company Cashflow** in Bank View or Marketplace View with daily breakdown and export

---

## 4) Module Status Matrix

### Authentication / Access Control

| Field | Detail |
|-------|--------|
| **Status** | WORKING WITH LIMITATIONS |
| **What works** | Google OAuth via Supabase Auth; cookies-based session; all server actions receive auth context; `createClient` from supabase/server.ts used everywhere |
| **Limitations** | No dedicated role middleware enforcing page-level access; admin checks are client-side `isAdmin` state from `checkIsInventoryAdmin()` — no server-rendered 403 redirect for non-admin; Settings Users page relies on implicit Supabase Auth RLS |
| **Deploy impact** | Low risk for internal team (≤5 known users). Role-gating enforcement gap is acceptable internally but should be hardened before broader access |
| **Confidence** | High |

---

### RLS / Role Enforcement

| Field | Detail |
|-------|--------|
| **Status** | WORKING WITH LIMITATIONS |
| **What works** | All 77 migrations include RLS; migration-066 fixed critical USING(true) on 6 core tables; `created_by = auth.uid()` enforced on all user data tables; service-role client isolated to settings/users actions only |
| **Limitations** | UI-level role guards (isAdmin) are client-side state; no middleware or server component redirects based on role; Settings module roles/permissions exist in DB but not yet enforced against dashboard routes |
| **Deploy impact** | Medium — team must set up roles correctly via Settings → Users on first login. No unauthorized data leak risk (RLS blocks DB), but UI shows admin tools to any logged-in user |
| **Confidence** | High |

---

### Dashboard Overview (Performance Dashboard v2)

| Field | Detail |
|-------|--------|
| **Status** | COMPLETE |
| **What works** | 7-day Economic P&L (GMV - AdSpend - COGS - Operating); ROAS calculation; Profit Bridge; basis toggles (GMV/CashIn/Bank for revenue, Shipped/Created for COGS); Ads breakdown (Product/Live/Awareness); DateRangePicker with Bangkok timezone presets; BankRevenueCard with per-transaction classification; `force-dynamic` |
| **Limitations** | Performance on full-month queries may be slow (no pagination on COGS chunk queries); hasRevenue=false hides GMV/ROAS in ads section (amber banner shown) |
| **Deploy impact** | None — ready |
| **Confidence** | High |

---

### Sales Orders

| Field | Detail |
|-------|--------|
| **Status** | COMPLETE |
| **What works** | TikTok + Shopee import with full dedup; paginated list view; order detail drawer; manual add/edit; GMV cards (created/paid basis); returns trigger from order detail; affiliate attribution badge; ResetTikTok (admin-guarded) |
| **Limitations** | ResetTikTok dialog only has client-side isAdmin guard (no server middleware); Lazada orders not yet importable (only SKU mappings) |
| **Deploy impact** | Minor — reset tool visible to all logged-in users if isAdmin check fails, but RPC enforces at DB |
| **Confidence** | High |

---

### Expenses

| Field | Detail |
|-------|--------|
| **Status** | COMPLETE |
| **What works** | DRAFT→PAID workflow; attachment upload (Storage, 10MB, jpg/png/webp/pdf); vendor field; paid_date + paid_confirmed_by audit; locked fields on PAID rows; status filter; cash-basis export checkbox; CSV import with template; bulk confirm/delete |
| **Limitations** | Import via CSV creates DRAFT by default (intentional, but team must remember to confirm each paid); client-side has no pre-upload size check (Storage policy enforces 10MB server-side) |
| **Deploy impact** | None — ready |
| **Confidence** | High |

---

### Daily P&L (Legacy)

| Field | Detail |
|-------|--------|
| **Status** | WORKING WITH LIMITATIONS |
| **What works** | Real server queries via `getDailyPLForDate()`; Revenue/AdSpend/COGS/Operating/Tax/Net breakdown per date |
| **Limitations** | Removed from sidebar navigation — accessible only via direct URL `/daily-pl`; superseded by Performance Dashboard v2; not maintained going forward |
| **Deploy impact** | Low — page still works but team should use Performance Dashboard instead |
| **Confidence** | Medium (not recently tested since nav removal) |

---

### Marketplace Wallet / Cashflow

| Field | Detail |
|-------|--------|
| **Status** | COMPLETE |
| **What works** | Multi-wallet ledger (TikTok Ads, Shopee, Subscriptions, Foreign, Tiger); import wizards for TikTok/Shopee/Tiger with column mapping; wallet balance tracking; SPEND/TOP_UP/OUT entry types correctly separated from expenses |
| **Limitations** | Wallet top-ups are explicitly NOT treated as expenses (correct business rule enforced in code) |
| **Deploy impact** | None — ready |
| **Confidence** | High |

---

### Company Cashflow

| Field | Detail |
|-------|--------|
| **Status** | COMPLETE |
| **What works** | `getCompanyCashflow()` server action; Bank View (bank_transactions) vs Marketplace View (expenses + wallet top-ups); summary cards (Cash In/Out/Net); daily breakdown table; CSV export; Bangkok timezone |
| **Limitations** | Two views may show different totals (intentional — Bank is ground truth vs Marketplace is accrual view); no UI explanation of the difference |
| **Deploy impact** | Low |
| **Confidence** | High |

---

### Wallets / Wallet Transactions

| Field | Detail |
|-------|--------|
| **Status** | COMPLETE |
| **What works** | Multi-wallet system with ledger; manual add/edit ledger entries; import for TikTok/Shopee/Tiger formats with wizard (column mapping step); import history; dedup by txn_hash |
| **Limitations** | Tiger import is monthly aggregate only (not daily); Shopee wallet import is wallet-level (not order-level settlements — that's Shopee Finance) |
| **Deploy impact** | None — ready |
| **Confidence** | High |

---

### P&L Reconciliation

| Field | Detail |
|-------|--------|
| **Status** | WORKING WITH LIMITATIONS |
| **What works** | `getReconciliationReport()` computes Accrual P&L, Company Cashflow, and bridge items; verification formula: Accrual Net + Bridge = Cashflow Net; date range picker; CSV export |
| **Limitations** | Bridge item logic may not capture all edge cases (CEO commissions, director loans not consistently classified); no validation that bridge items sum exactly to difference |
| **Deploy impact** | Medium — useful diagnostic but not for formal accounting sign-off without verifying bridge completeness |
| **Confidence** | Medium |

---

### Ads Import

| Field | Detail |
|-------|--------|
| **Status** | COMPLETE |
| **What works** | TikTok Product Ads + Live Ads daily import with dedup (source_row_hash); Tiger Awareness Ads monthly aggregate import; `ad_daily_performance` table for revenue attribution; `wallet_ledger` ADS entries used for spend (not ad_daily_performance) |
| **Limitations** | Ads revenue attribution (hasRevenue) is optional — if ad_daily_performance has no revenue rows, GMV/ROAS columns hidden from Ads Breakdown |
| **Deploy impact** | Low |
| **Confidence** | High |

---

### Ads Performance / Ads Dashboard

| Field | Detail |
|-------|--------|
| **Status** | WORKING WITH LIMITATIONS |
| **What works** | AdsBreakdownSection on Performance Dashboard shows spend + revenue per ad type; ROAS displayed; Product Ads vs Live Ads split by wallet note pattern |
| **Limitations** | No dedicated Ads Dashboard page; all ads visibility embedded in Performance Dashboard; no historical ads trend beyond date range picker; no campaign-level drill-down |
| **Deploy impact** | Low for internal use |
| **Confidence** | High |

---

### Bank Import / Bank Statement Processing

| Field | Detail |
|-------|--------|
| **Status** | COMPLETE |
| **What works** | CSV/Excel import with auto column-detect (`/api/bank/columns`); preview step; overlap detection; full import; opening balance; daily summary; dedup by txn_hash |
| **Limitations** | Column auto-detect covers common Thai bank CSV formats; unusual formats may require manual column mapping (not yet implemented) |
| **Deploy impact** | Low |
| **Confidence** | High |

---

### Bank Reconciliation

| Field | Detail |
|-------|--------|
| **Status** | WORKING WITH LIMITATIONS |
| **What works** | `BankReconciliationClient` shows unmatched bank transactions and unmatched internal records (sales, expenses, other); `ManualMatchDialog` for creating matches; match summary cards |
| **Limitations** | Manual matching only — no auto-match algorithm; no amount tolerance validation (can match any two records regardless of amount difference); match audit trail not surfaced in UI |
| **Deploy impact** | Medium — usable but team must exercise judgment when matching |
| **Confidence** | Medium |

---

### Inventory

| Field | Detail |
|-------|--------|
| **Status** | COMPLETE |
| **What works** | Products tab (item list + on-hand stock); Opening Balance tab; Bundles tab; Movements tab (COGS run history + Apply COGS MTD); StockIn dialog; Renamesku modal; notification bell for COGS run completion |
| **Limitations** | COGS allocation not wrapped in DB transaction (partial allocation risk on failure); no user warning when COGS unit_cost = 0 |
| **Deploy impact** | Medium — partial allocation risk is real but mitigated by idempotent re-run |
| **Confidence** | High |

---

### COGS Allocation

| Field | Detail |
|-------|--------|
| **Status** | COMPLETE |
| **What works** | FIFO and Moving Average cost methods; bundle auto-explode; MTD apply + batch apply; run history with notification; FixMissingSkuDialog for bulk SKU assignment; deterministic ordering; chunked queries (200/chunk) |
| **Limitations** | Not atomic (no DB transaction); unit_cost=0 allocated silently; COGS created-date mode uses wider ±30d window (correct but not obvious) |
| **Deploy impact** | Medium (non-atomic) — low probability of partial failure in practice |
| **Confidence** | High |

---

### Profit Summary / Profit Reports

| Field | Detail |
|-------|--------|
| **Status** | WORKING WITH LIMITATIONS |
| **What works** | Performance Dashboard v2 is the primary profit view; `profit_order_rollup_view` exists in DB; Cash P&L page (`/reports/cash-pl`) shows bank-based cash position |
| **Limitations** | No dedicated per-order profit report page in UI; `profit_reports` table exists but not exposed via route; profit_order_rollup_view not reachable without custom query |
| **Deploy impact** | Low — Performance Dashboard covers operational visibility well |
| **Confidence** | Medium |

---

### Payables

| Field | Detail |
|-------|--------|
| **Status** | PLACEHOLDER / NOT IMPLEMENTED |
| **What works** | Route `/payables` exists and is in sidebar nav; page renders |
| **Limitations** | Page body is literal placeholder text: "Accounts payable management will be implemented here." — no queries, no data, no forms |
| **Deploy impact** | HIGH — must be hidden from nav or replaced with "Coming Soon" before deployment |
| **Confidence** | High (confirmed stub) |

---

### Tax / VAT Records

| Field | Detail |
|-------|--------|
| **Status** | PARTIAL |
| **What works** | `tax_records` table exists; `expense_tax_subcategory_canonical` (migration-074) adds tax subcategory to expenses; RLS applied |
| **Limitations** | No dedicated Tax/VAT module page or route; tax data embedded in expenses subcategory system only; no VAT calculation, no tax period tracking, no tax report |
| **Deploy impact** | Low if team does not expect a tax module |
| **Confidence** | High |

---

### CEO Transactions / Commission / Director's Loan

| Field | Detail |
|-------|--------|
| **Status** | WORKING WITH LIMITATIONS |
| **What works** | `/ceo-commission` page with `AddCommissionDialog`; `ImportFromBankDialog` to pull from bank transactions; commission source configuration; DIRECTOR_LOAN wallet type tracked in wallet_ledger (TOP_UP, not expense) |
| **Limitations** | Director's Loan not explicitly surfaced as a separate ledger view; commission reports limited to list view; no CEO dashboard or summary |
| **Deploy impact** | Low for internal use |
| **Confidence** | Medium |

---

### Import History / Audit Log / Batch Tracking

| Field | Detail |
|-------|--------|
| **Status** | WORKING WITH LIMITATIONS |
| **What works** | `import_batches` table tracks every import (file_hash, status, timestamps, report_type); batch rollback via `/api/import/rollback`; cleanup stuck batches via `/api/import/cleanup-stuck`; COGS run history in `cogs_allocation_runs`; `settings_audit_logs`; `expense_audit_logs` |
| **Limitations** | No unified import history UI page in navigation; batch history accessible within each import dialog result step only; no admin dashboard showing all batches |
| **Deploy impact** | Low for team use; all batch data queryable via Supabase Studio |
| **Confidence** | High |

---

### Settings Module

| Field | Detail |
|-------|--------|
| **Status** | COMPLETE (with noted limitation on Security sub-page) |
| **What works** | General (app_settings), Appearance (theme), Users (listUsers + role assignment), Roles (CRUD Owner/Admin/Operator/Viewer), Permissions (matrix editor), Finance Defaults (read-only rules); all writes go to `settings_audit_logs` |
| **Limitations** | Security sub-page (2FA, API keys) is UI shell only — actual 2FA/API key backend not implemented; Finance Defaults is explicitly read-only; Permissions matrix not enforced on dashboard routes |
| **Deploy impact** | Medium — Security page should be clearly marked "Coming Soon" or hidden |
| **Confidence** | High |

---

### Admin / Reset / Repair / Backfill Utilities

| Field | Detail |
|-------|--------|
| **Status** | WORKING WITH LIMITATIONS |
| **What works** | ResetTikTok (isAdmin + RPC guard); COGS backfill (`backfillMissingReturnStock`); FixMissingSkuDialog (admin-only in MovementsTab); import cleanup; import rollback |
| **Limitations** | `checkIsInventoryAdmin()` is client-side; no server middleware preventing non-admin from directly calling admin server actions |
| **Deploy impact** | Low for internal trusted team; not hardened for adversarial access |
| **Confidence** | Medium |

---

## 5) Database & Backend Reality Check

### Schema Maturity
77 migrations applied sequentially with no skipped numbers. Schema is mature and covers all major domains.

### Key Tables Actually In Use

| Table | Purpose | Status |
|-------|---------|--------|
| `sales_orders` | Core sales with order_line_hash dedup | Active |
| `expenses` | DRAFT/PAID lifecycle with attachments | Active |
| `expense_attachments` | Storage metadata for expense receipts | Active |
| `import_batches` | Import dedup + status tracking | Active |
| `wallet_ledger` | Multi-wallet transaction ledger | Active |
| `wallets` | Wallet definitions (ADS, DIRECTOR_LOAN, etc.) | Active |
| `bank_accounts` | Bank account definitions | Active |
| `bank_transactions` | Raw bank statement data | Active |
| `bank_reconciliation_manual_match` | Manual bank↔internal matching | Active |
| `bank_txn_classifications` | Classify deposits as revenue | Active |
| `ad_daily_performance` | TikTok/Tiger ads daily metrics | Active |
| `inventory_items` | Product/SKU master | Active |
| `inventory_receipt_layers` | FIFO cost layers | Active |
| `inventory_cogs_allocations` | Per-order COGS allocation | Active |
| `inventory_bundle_components` | Bundle explode rules | Active |
| `inventory_cost_snapshots` | Moving average snapshots | Active |
| `cogs_allocation_runs` | COGS run history | Active |
| `inventory_returns` | Returns with marketplace_sku tracking | Active |
| `inventory_sku_mappings` | Channel→internal SKU mapping | Active |
| `shopee_wallet_transactions` | Shopee wallet import | Active |
| `shopee_order_settlements` | Shopee settlement income | Active |
| `affiliates` | Affiliate definitions | Active |
| `affiliate_orders` | Affiliate attribution | Active |
| `ceo_transactions` | CEO commission records | Active |
| `notifications` | Notification inbox (COGS runs) | Active |
| `app_settings` | Application settings | Active (migration-077) |
| `roles` / `permissions` / `role_permissions` / `user_role_assignments` | Settings RBAC | Active (migration-077) |
| `settings_audit_logs` | Settings change audit | Active (migration-077) |
| `tax_records` | Tax tracking | Exists, not exposed in UI |
| `payables` | Accounts payable | Exists, UI is placeholder |

### Important Functions / Batch Flows

- `seed_default_roles_for_user(UUID)` — Seeds Owner/Admin/Operator/Viewer roles for new user
- `reset_tiktok_ordersku_list()` — RPC for admin order nuke (RLS-enforced)
- `allocate_cogs_rpc()` — Hardened COGS allocation RPC (migration-067/068)
- `profit_order_rollup_view` — DB view for per-order P&L (migration-042/043)
- Import batch flow: `createBatch → importChunk (500 rows/chunk loop) → finalizeBatch`
- COGS flow: `createCogsRun → applyCOGSMTD → completeCogsRunSuccess/Failed → createNotificationForRun`

### RLS / Ownership Consistency

- **Pattern:** `created_by = auth.uid()` on all user data tables
- **Enforced at:** DB level — cannot be bypassed by client code
- **Critical fix:** migration-066 patched 6 tables that had `USING(true)`
- **Service role:** Used only in settings/users actions (requires `SUPABASE_SERVICE_ROLE_KEY`)
- **Legacy table risk:** `user_roles` (migration-032) coexists with new `user_role_assignments` (migration-077) — admin checks must use correct table

### Migration Risk

- migration-077 (Settings Module) is the latest, added 2026-03-08 on current branch
- **Must confirm migration-077 is applied to production DB before deploying Settings module**
- No automated rollback scripts for most migrations — rollback requires manual SQL

---

## 6) Locked Business Rules (Do Not Reinterpret)

- **Daily P&L = GMV − Advertising Cost − COGS − Operating Expenses** (no exceptions)
- **Wallet top-ups are NOT expenses** — tracked in wallet_ledger, never in expenses table
- **Ad spend source = wallet_ledger (ADS wallet, SPEND/OUT entries)** — NOT ad_daily_performance.spend
- **Bangkok timezone (+07:00) is canonical** for all date storage, display, and export
- **COGS order_id in inventory_cogs_allocations = sales_orders.id (UUID as VARCHAR text)** — not order_number
- **Director's Loan = wallet TOP_UP, not expense** — never reclassify
- **Import idempotency = file_hash (file-level) + row-level hash** — both must pass for insert
- **Accrual P&L and Cash P&L are separate views** — never mix their totals
- **THB is default currency** — no multi-currency logic implemented
- **No localStorage / sessionStorage** — all state from server/DB

---

## 7) Docs vs Code Discrepancies

| Area | Docs Claim | Code Reality | Final Judgment |
|------|-----------|--------------|----------------|
| `docs/PROJECT_STATUS.md` | Last updated 2026-02-01 | Settings (2026-03-08), Perf Dashboard v2 (2026-03-02), Bank Revenue (2026-03-05) missing | **Docs outdated** — superseded by this document |
| Analytics Builder | Removed per MEMORY.md | All files deleted, commit 49b855c confirmed | **Consistent** |
| Payables module | "Phase 9, not started" | Confirmed stub placeholder in page.tsx | **Consistent** |
| Daily P&L | "removed from nav" | Page exists at /daily-pl, absent from sidebar.tsx | **Consistent** |
| Settings Security page | "P1 complete" (MEMORY) | UI exists (SecurityClient.tsx), 2FA/API key backend absent | **Partially misleading** — UI exists, backend does not |
| Shopee Finance sidebar | "added to Money group → /finance/shopee" (MEMORY) | Sidebar shows "Marketplace Finance" → /finance/marketplaces; /finance/shopee redirects there | **Memory slightly outdated** — route consolidated |
| RLS fix | "CRITICAL: Fixed 6 tables (migration-066)" | migration-066 confirmed | **Consistent** |
| COGS not atomic | Known gap per MEMORY | No BEGIN/COMMIT wrapping confirmed in code | **Consistent** |
| Permissions enforcement | Not documented as a gap | Permissions matrix in DB/UI but NOT enforced on routes | **Undocumented gap** |
| mock-data.ts | No claim | File exists, zero imports in production code | **Dead code, not a risk** |

---

## 8) Known Issues / Risks Before Deploy

### HIGH

1. **Payables module is a stub** — `/payables` in sidebar nav leads to placeholder text. Will confuse users on first deployment.
2. **Settings → Security sub-page is UI-only** — 2FA and API key sections have no backend implementation. Presenting as functional is misleading.
3. **Migration-077 must be applied to production DB** — Settings module pages will error on load if this migration is missing.
4. **Permissions matrix not enforced on routes** — Roles/Permissions defined in DB and Settings UI, but no middleware gate prevents a Viewer from accessing admin pages. Acceptable internally but must be documented.

### MEDIUM

5. **COGS allocation is not atomic** — `applyCOGSMTD` does not use a DB transaction. Partial failure leaves inconsistent state. Mitigation: COGS is idempotent so re-run clears it.
6. **isAdmin guard is client-side** — admin UI hidden via `isAdmin` state; admin server actions can technically be called directly by any authenticated user.
7. **SUPABASE_SERVICE_ROLE_KEY required for Settings → Users** — if env var missing in production, the Users page will throw.
8. **Shopee import channel logic defaults to 'tiktok'** — for non-Shopee returns, channel defaults to 'tiktok' with no user warning. Can silently mismatch SKU resolution.
9. **COGS unit_cost=0 no warning** — if a product has no cost layers, COGS allocates 0 silently. No alert to user.
10. **user_roles legacy table coexists with user_role_assignments** — admin checks must use correct table or will silently fail.

### LOW

11. **CSV formula injection not prevented** — exported CSVs could contain injected formulas if data contains `=` prefix. Excel/Sheets risk only.
12. **mock-data.ts dead code** — file exists at `frontend/src/lib/mock-data.ts` but never imported in production paths. Confusing for future developers.
13. **Daily P&L accessible via URL** — `/daily-pl` works but is not in nav. Team may land there and see different numbers vs Performance Dashboard.
14. **Reconciliation bridge completeness** — bridge items may not capture all timing differences. Do not use for formal accounting sign-off.
15. **ad_import_staging table** — `ad_import_staging` (migration-074) exists as a temp table; verify it doesn't accumulate stale rows over time.

---

## 9) Deploy Readiness Assessment

**Is it ready for internal deployment now?**
Yes, with the specific conditions below.

**What is safe to deploy now:**
- Performance Dashboard v2 (homepage)
- Sales Orders (TikTok + Shopee import, full workflow)
- Expenses (Draft→Paid with attachments)
- Wallets + Wallet imports
- Bank + Bank imports + Bank Reconciliation
- Inventory + COGS allocation
- Returns + SKU Mappings
- CEO Commissions
- Affiliates + Reports
- Company Cashflow + Cash P&L
- P&L Reconciliation
- Settings (General, Appearance, Users, Roles, Permissions, Finance Defaults)
- Marketplace Finance (TikTok, Shopee — Balance + Settlement)

**What must be verified first:**
1. Confirm migration-077 (and all prior) applied to production Supabase
2. Confirm `SUPABASE_SERVICE_ROLE_KEY` env var is set in production
3. Confirm `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set
4. Run `npm run build` in `frontend/` to confirm zero TypeScript/lint errors
5. Verify `seed_default_roles_for_user()` SQL function exists in production DB

**What should be postponed until after deployment:**
1. Payables module — hide from sidebar or show "Coming Soon"
2. Settings → Security sub-page — hide or clearly mark as coming soon
3. Lazada order import
4. Full permissions enforcement on routes (role middleware)
5. COGS transaction atomicity fix
6. CSV formula injection prevention

---

## 10) Immediate Next Actions

Ordered by deployment dependency:

1. **[BLOCKING] Apply migration-077 to production DB** and verify all 77 migrations applied in order
2. **[BLOCKING] Verify all required env vars** are set in production: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_*` variants
3. **[HIGH] Hide Payables from sidebar** — change `/payables` to "Coming Soon" or remove from nav until implemented
4. **[HIGH] Hide Settings → Security** or add a "Coming Soon" banner inside the page to prevent user confusion
5. **[HIGH] Run `npm run build`** in `frontend/` and fix any TypeScript errors before deploy
6. **[MEDIUM] Seed default roles** — run `seed_default_roles_for_user(admin_user_uuid)` for first admin so they can assign roles via Settings → Users
7. **[MEDIUM] Verify `checkIsInventoryAdmin()`** reads from `user_role_assignments` (not legacy `user_roles`) in production schema
8. **[MEDIUM] Test first-login flow** — confirm Google OAuth redirect, session cookie, and RLS context all work correctly in production environment
9. **[LOW] Delete `frontend/src/lib/mock-data.ts`** — dead code, not used anywhere; remove to avoid future confusion
10. **[LOW] Update `docs/PROJECT_STATUS.md`** to reflect current state (this document supersedes it)

---

## 11) Final Verdict

### READY WITH CONDITIONS

**Reasoning:**

The SaaS Dashboard has a mature, production-grade implementation across its core workflows. Real data flows, proper dedup, RLS enforcement, Bangkok timezone consistency, and server-action architecture are consistently applied. The Performance Dashboard v2, Sales, Expenses, Inventory/COGS, Bank, Wallets, and Settings modules are genuinely usable.

The conditions that must be met before deploying are not code changes — they are operational steps (migration verification, env var setup, role seeding) and two cosmetic UI changes (hiding the Payables stub and Settings Security placeholder). None of these require significant development work.

The system is appropriate for its stated purpose: internal use by a small trusted team (≤5 users) for daily business visibility. It is not hardened for adversarial multi-tenant SaaS, but that is not the requirement.

**Deploy when:**
- Migration-077 confirmed applied to production
- All env vars confirmed
- Payables and Security pages hidden/marked coming soon
- First-admin role seeded
- `npm run build` passes

---

*Document generated by repo audit — 2026-03-08*
*Branch: feat/performance-dashboard-v2 | Migrations: 001–077 | Routes: 36 dashboard + 10 API*
