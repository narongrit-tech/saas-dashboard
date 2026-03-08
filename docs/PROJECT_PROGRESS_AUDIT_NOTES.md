# SaaS Dashboard — Audit Evidence Notes

> **Companion to:** `PROJECT_PROGRESS_CURRENT.md`
> **Audit date:** 2026-03-08 | **Branch:** feat/performance-dashboard-v2

---

## A. Route Inventory

### Dashboard Routes (36 pages)

| Route | File | force-dynamic | Real Queries | Notes |
|-------|------|--------------|--------------|-------|
| `/` | page.tsx | ✅ | `getPerformanceDashboard`, `getBankInflowRevenueTotal`, `getMarketplaceCashIn` | Performance Dashboard v2, homepage |
| `/reports/cash-pl` | page.tsx | ✅ | `getCashPL()` | Cash P&L report |
| `/sales` | page.tsx | ✅ | paginated sales_orders | TikTok + Shopee import |
| `/sales/audit` | page.tsx | ✅ | sales audit history | Order history view |
| `/sales/reconciliation` | page.tsx | ✅ | reconciliation queries | TikTok vs internal |
| `/affiliates` | page.tsx | ✅ | affiliate + attribution | Order attribution |
| `/reports/affiliate` | page.tsx | ✅ | `getAffiliateReport()` | Affiliate performance |
| `/finance/marketplaces` | page.tsx | ✅ | marketplace hub cards | Links to sub-routes |
| `/finance/marketplaces/[marketplace]` | page.tsx | ✅ | settlements, cashflow | tiktok-shop, shopee, lazada |
| `/finance/shopee` | page.tsx | — | redirects to /finance/marketplaces/shopee | Legacy alias |
| `/wallets` | page.tsx | ✅ | wallet_ledger queries | Multi-wallet |
| `/ceo-commission` | page.tsx | ✅ | `getCommissions()` | Commission list |
| `/company-cashflow` | page.tsx | ✅ | `getCompanyCashflow()` | Bank + Marketplace views |
| `/bank` | page.tsx | ✅ | bank_transactions, bank_accounts | Import + balance |
| `/bank-reconciliation` | page.tsx | ✅ | unmatched txns queries | Manual match UI |
| `/reconciliation` | page.tsx | ✅ | `getReconciliationReport()` | P&L vs Cashflow bridge |
| `/expenses` | page.tsx | ✅ | `listExpenses()` | DRAFT/PAID with attachments |
| `/returns` | page.tsx | ✅ | returns queries | Queue + Recent tabs |
| `/inventory` | page.tsx (client) | ✅ | `getInventorySummary()` | Products/Bundles/Movements |
| `/inventory/cogs-runs/[id]` | page.tsx | ✅ | `getCogsRun()` | COGS run detail |
| `/payables` | page.tsx | ❌ | **NONE — placeholder text** | STUB — must hide |
| `/sku-mappings` | page.tsx | ✅ | `getSkuMappings()` | Channel→SKU CRUD |
| `/settings` | page.tsx | ✅ | redirects to /settings/general | — |
| `/settings/general` | page.tsx | ✅ | `getAppSettings()` | App settings |
| `/settings/appearance` | page.tsx | ✅ | `getUserPreferences()` | Theme |
| `/settings/users` | page.tsx | ✅ | `listUsers()`, `getRoles()` | Needs SERVICE_ROLE_KEY |
| `/settings/roles` | page.tsx | ✅ | `getRoles()` | CRUD |
| `/settings/permissions` | page.tsx | ✅ | `getPermissions()` | Matrix editor |
| `/settings/finance-defaults` | page.tsx | ✅ | static rules | Read-only display |
| `/settings/security` | page.tsx | ✅ | UI shell only | **No backend for 2FA/API keys** |
| `/daily-pl` | page.tsx | ✅ | `getDailyPLForDate()` | Legacy, not in nav |

### API Routes (10 endpoints)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/bank/columns` | POST | Detect bank CSV column layout |
| `/api/bank/preview` | POST | Preview parsed bank statement |
| `/api/bank/import` | POST | Execute bank statement import |
| `/api/bank/overlap` | POST | Check date overlap before import |
| `/api/import/tiktok/ads-daily/preview` | POST | Preview TikTok ads CSV |
| `/api/import/tiktok/ads-daily` | POST | Import TikTok ads daily |
| `/api/import/tiktok/income` | POST | Import TikTok marketplace income |
| `/api/import/tiktok/onhold` | POST | Import TikTok onhold funds |
| `/api/import/rollback` | POST | Rollback import batch by batch_id |
| `/api/import/cleanup-stuck` | POST | Clear stale PROCESSING batches |

---

## B. Feature Evidence Notes

### Mock Data Isolation (CONFIRMED SAFE)
- File `frontend/src/lib/mock-data.ts` exists
- Contains: `dashboardStats`, `salesTrendData` (7 rows), `recentOrders` (5 rows), `recentExpenses` (3 rows), `inventoryItems` (3 rows)
- **Zero imports in production code** — confirmed via grep across `app/(dashboard)/` and `components/`
- File is vestigial dead code only

### Bangkok Timezone (CONFIRMED CONSISTENT)
- `frontend/src/lib/bangkok-time.ts` — `getBangkokNow()`, `formatBangkokDate()`
- All DateRangePicker presets use `getBangkokNow()`
- All DB inserts append `+07:00` to datetime strings before insert
- Exports format dates with Bangkok timezone

### Import Dedup (CONFIRMED WORKING)
- File-level: SHA-256 hash of file content stored in `import_batches.file_hash`
- Row-level:
  - Sales: `order_line_hash` (created_by + order_line_hash UNIQUE)
  - Ads: `source_row_hash` (migration-023, migration-076)
  - Bank: `txn_hash` (migration-018)
  - Shopee wallet: `txn_hash`
  - Shopee settlements: UNIQUE constraint NULLS NOT DISTINCT (PostgreSQL 15+)
- Rollback: `/api/import/rollback` deletes batch rows and resets batch status

### COGS Architecture (CONFIRMED WORKING, NOT ATOMIC)
- Engine in `frontend/src/lib/inventory-costing.ts`
- `applyCOGSMTD` → `createCogsRun` → loop per order → `completeCogsRunSuccess/Failed` → `createNotificationForRun`
- `applyCOGSForBatch(importBatchId)` — fast-path for specific import batch
- Chunk queries: `.in('id', chunk)` size 200 to avoid PostgREST URL limit
- COGS order_id: stored as VARCHAR text = sales_orders.id (UUID)
- **NO DB TRANSACTION wrapping** — partial failure possible (mitigation: idempotent re-run)

### Admin Guards Evidence
- `MovementsTab.tsx` line ~93: `checkIsInventoryAdmin()` called on mount; `isAdmin` state gates "Apply COGS" and "Fix Missing SKU" buttons
- `SalesPageClient.tsx` line ~1320: `{isAdmin && <ResetTikTokDialog />}` conditional render
- Server-side: `reset_tiktok_ordersku_list()` RPC has its own RLS policy
- **Gap:** No Next.js middleware or server component check — if `isAdmin` state is wrong, UI gates fail silently

### Settings Module Evidence
- Migration-077: Creates `app_settings`, `user_preferences`, `roles`, `permissions`, `role_permissions`, `user_role_assignments`, `settings_audit_logs`
- SQL function: `seed_default_roles_for_user(UUID)` seeds 4 system roles
- `service.ts` Supabase client used for `listUsers()` (requires `SUPABASE_SERVICE_ROLE_KEY`)
- All 7 settings pages exist with real data flow
- **Exception:** `SecurityClient.tsx` renders 2FA toggle and API key form — no server action backing these fields confirmed

---

## C. Code-vs-Doc Discrepancy Table

| # | Area | Document Says | Code Shows | Status |
|---|------|--------------|------------|--------|
| 1 | PROJECT_STATUS.md date | Last updated 2026-02-01 | Branch has 3+ major features after that date | OUTDATED DOC |
| 2 | Settings Security | MEMORY: "P1 complete" | UI shell, no backend for 2FA/API keys | MISLEADING |
| 3 | Shopee Finance sidebar | MEMORY: "Shopee Finance → /finance/shopee" | Sidebar shows "Marketplace Finance" → /finance/marketplaces | OUTDATED MEMORY |
| 4 | Payables | PROJECT_STATUS: "Phase 9, not started" | Confirmed stub in page.tsx | CONSISTENT |
| 5 | Analytics Builder | MEMORY: removed 2026-03-03 | All files deleted, confirmed | CONSISTENT |
| 6 | Daily P&L nav removal | MEMORY: removed from nav | Absent from sidebar.tsx | CONSISTENT |
| 7 | Permissions enforcement | Not documented | Matrix in DB/UI but no route guards | UNDOCUMENTED GAP |
| 8 | user_roles vs user_role_assignments | MEMORY: legacy kept as-is | Both coexist in schema | CONSISTENT (but risk) |
| 9 | COGS not atomic | MEMORY known gap | Confirmed in code | CONSISTENT |
| 10 | RLS fix migration-066 | MEMORY: 6 tables fixed | migration-066 confirmed | CONSISTENT |

---

## D. Risky Files / Components List

### Critical Business Logic (Do Not Modify Without Review)
- `frontend/src/lib/inventory-costing.ts` — COGS engine (FIFO/MA)
- `frontend/src/lib/sales-metrics.ts` — GMV calculation (`fetchGMVByDay`, `fetchGMVByDayPaid`)
- `frontend/src/lib/daily-pl.ts` — P&L formula
- `frontend/src/app/(dashboard)/actions.ts` — Performance Dashboard server actions
- `frontend/src/app/(dashboard)/reports/cash-pl/actions.ts` — Cash P&L server actions
- `frontend/src/app/(dashboard)/inventory/cogs-run-actions.ts` — COGS run lifecycle
- `frontend/src/lib/cashflow.ts` — Cashflow position calculation

### High-Risk Server Actions (Admin-Only, No Middleware)
- `reset_tiktok_ordersku_list` RPC call — nukes all TikTok sales orders
- `backfillMissingReturnStock` — admin-only backfill
- `importSalesChunk` — bulk upsert (no re-import guard beyond dedup)

### Components Showing Potentially Confusing UX
- `frontend/src/app/(dashboard)/payables/page.tsx` — **MUST BE HIDDEN BEFORE DEPLOY**
- `frontend/src/components/settings/SecurityClient.tsx` — UI-only, should show coming-soon banner
- `frontend/src/lib/mock-data.ts` — Dead code, should be deleted

### Fragile Parsers (Format-Dependent)
- `frontend/src/lib/importers/shopee-balance-parser.ts` — skips ~16 preamble rows; fragile to format changes
- `frontend/src/lib/importers/shopee-settlement-parser.ts` — uses substr for "(฿)" suffix matching
- `frontend/src/lib/parsers/bank-statement-parser.ts` — Thai bank CSV format assumptions

---

## E. Environment Variables Required for Production

| Variable | Required By | Notes |
|----------|------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | All client components | Must be public URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All client components | Anon (public) key |
| `SUPABASE_URL` | Server actions | Same URL, server-side |
| `SUPABASE_ANON_KEY` | Server actions | Same anon key, server-side |
| `SUPABASE_SERVICE_ROLE_KEY` | `service.ts` (Settings → Users) | **CRITICAL — missing = Users page crashes** |

---

## F. Migration Inventory Summary

| Range | Area | Count |
|-------|------|-------|
| 001–007 | Core tables (import_batches, wallets, sales_orders, expenses) | 7 |
| 008–013 | Sales UX, expense audit | 6 |
| 014–022 | Bank module, import enhancements | 9 |
| 023–031 | Sales dedup, TikTok timestamps | 9 |
| 032–038 | User roles, inventory costing, profit, affiliates | 7 |
| 039–051 | Inventory fixes, COGS fixes, GMV fixes | 13 |
| 052–059 | Affiliates, payables, returns, CEO commission | 8 |
| 060–068 | COGS runs, Shopee, notifications, RLS fix, allocate RPC | 9 |
| 069–077 | Returns dedup, SKU mappings, expenses workflow, ads, settings | 9 |
| **Total** | | **77** |

**Latest migration:** migration-077-settings-module.sql (2026-03-08)
**Production risk:** migration-077 must be verified as applied before Settings module used

---

*Audit notes companion document — 2026-03-08*
