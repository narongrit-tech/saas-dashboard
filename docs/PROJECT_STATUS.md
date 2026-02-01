# Project Status
**Last Updated:** 2026-02-01

## ✅ DONE (Phase 7 Completed)

### Core Features
- **Sales Orders** - CRUD + Import + Export (TikTok Shop, Shopee) ✅
- **Expenses** - CRUD + Template + Import + Export + Audit Log ✅
- **Daily P&L** - Revenue, Advertising, COGS, Operating, Net Profit ✅
- **Dashboard** - Today's stats + 7-day trend chart ✅
- **Marketplace Wallets** (Cashflow) - TikTok Onhold/Income Import + Reconciliation ✅
- **Multi-Wallet System** - TikTok Ads, Foreign Subscriptions ✅
- **Performance Ads Import** - Product/Live campaigns (daily breakdown) ✅
- **Tiger Awareness Ads** - Monthly aggregation import ✅
- **Manual Column Mapping** - Wizard for non-standard files ✅

### Task A, B, C, D (Completed 2026-01-25)
- **Task D:** Unified Date Picker (Bangkok timezone) ✅
- **Task A:** Company Cashflow page ✅
- **Task B:** P&L vs Cashflow Reconciliation ✅
- **Task C:** Expenses Template + Import + Audit Log ✅

### Bug Fixes (2026-01-25)
- ✅ Infinite render loop (SingleDateRangePicker) - Fixed
- ✅ Template download (ArrayBuffer → base64) - Fixed
- ✅ Sidebar links for Company Cashflow & Reconciliation - Added
- ✅ wallet_ledger column name (transaction_date → date) - Fixed
- ✅ **Ads Import Upsert Collision (2026-01-26)** - Fixed unique key to use campaign_id + video_id

### New Features (2026-01-26)
- ✅ **Import Batch Rollback System** - RPC functions, API routes, UI components
  - RPC: rollback_import_batch(batch_id), cleanup_stuck_batches()
  - API: POST /api/import/rollback, POST /api/import/cleanup-stuck
  - UI: Rollback button in ImportAdsDialog (success screen + duplicate error screen)
  - Security: RLS-compliant, user isolation, atomic transactions

### Inventory & COGS (2026-01-30)
- ✅ **Inventory Costing Engine (FIFO + Moving Average)** - Accurate COGS for P&L
  - Tables: inventory_items, receipt_layers, cost_snapshots, cogs_allocations, bundle_components
  - Costing Methods: FIFO (First-In-First-Out) + Moving Average (Weighted)
  - Features: Opening Balance, Bundle SKU support, Returns (Reverse COGS), Idempotent allocations
  - P&L Integration: COGS now from inventory_cogs_allocations (not expenses.COGS)
  - UI: 4-tab inventory page (Products, Opening Balance, Bundles, Movements/Audit)
  - See: migration-033, lib/inventory-costing.ts, QA_INVENTORY_COSTING.md

### Stock In Flow + SKU Fixes (2026-02-01)
- ✅ **Stock In Feature** - Fixed end-to-end flow for receiving inventory (Migration 041)
  - Added `item_id`, `quantity`, `unit_cost` columns to `inventory_stock_in_documents`
  - Fixed SKU lookup to use `sku_internal` (not `sku`)
  - Added SKU normalization (trim + uppercase)
  - Safe quantity handling (prevents NULL values)
  - Creates both stock in document AND receipt layer atomically
  - Receipt layers use `sku_internal` directly (NO item_id column in that table)
  - Proper rollback on receipt layer creation failure
  - ref_type = 'STOCK_IN' for stock in transactions
  - SKU canonicalization: NEWONN001/NEWONN002 (corrected from NEWOWNN)
  - Product names:
    - NEWONN001 = Cool Smile Fresh Up
    - NEWONN002 = Cool Smile Wind Down
  - See: migration-041, verify-stock-in-flow.sql, SUMMARY_STOCK_IN_FIX.md

### Bundle COGS Auto-Explode (2026-02-01)
- ✅ **Bundle Inventory + COGS** - Auto-explode bundles to components for accurate costing
  - Bundle orders automatically consume component SKU inventory (FIFO)
  - Example: Bundle #0007 = 1x NEWONN001 + 1x NEWONN002
  - Selling 10 units of #0007 → consumes 10x NEWONN001 + 10x NEWONN002
  - Creates separate COGS allocations for each component
  - FIFO allocates from oldest receipt layers per component
  - Clear error messages when component stock insufficient
  - Idempotent: prevents double allocation for same order
  - Bundle SKU itself NEVER consumes inventory (only components do)
  - See: lib/inventory-costing.ts (applyCOGSForOrderShipped), QA_BUNDLE_COGS.md

### Bundle On Hand Display (2026-02-01)
- ✅ **Bundle Available Sets** - Show computed bundle inventory instead of 0
  - Bundle SKUs now display "available sets" computed from component stock
  - Formula: min( floor(component_on_hand / component.quantity) )
  - Example: #0007 with NEWONN001=3022, NEWONN002=955 → shows 955 sets
  - Info icon with tooltip shows component breakdown
  - Tooltip displays limiting component (e.g., "Limited by: NEWONN002")
  - Regular SKUs unchanged (still show 4-decimal on hand)
  - Performance optimized: single query for all bundles
  - See: inventory/actions.ts (getBundleOnHand), ProductsTab.tsx, QA_BUNDLE_ON_HAND.md

### Apply COGS Date Range (2026-02-01)
- ✅ **Date Range Selector** - Custom date range for Apply COGS with pagination
  - UI: Start/End date inputs with validation
  - Quick presets: "This Month", "Last Month" buttons
  - Default: First day of month → Today (Bangkok timezone)
  - Pagination: Fetches ALL orders in range (1000 per page, up to 100k total)
  - No truncation: Deterministic ordering (shipped_at ASC, order_id ASC)
  - Result shows: Total / Eligible / Successful / Skipped / Failed with breakdown
  - Skipped reasons: already_allocated, missing_sku, invalid_qty, cancelled
  - Idempotent: Safe to re-run, no duplicate allocations
  - Bundle support: Auto-explode unchanged
  - Admin-only: RLS protected
  - See: ApplyCOGSMTDModal.tsx, inventory/actions.ts (applyCOGSMTD), QA_APPLY_COGS_DATE_RANGE.md

### Apply COGS "Bad Request" Fix (2026-02-01)
- ✅ **Chunked Allocation Queries** - Fixed PostgREST "Bad Request" for large order sets
  - Problem: .in('order_id', array) failed with >1000 IDs (query too large)
  - Solution: Split into chunks of 200 IDs, query each chunk separately
  - Accumulate results into Set (same behavior as before)
  - Console logs show: "Checking existing allocations in X chunks"
  - Improved error messages: "Failed to check existing allocations (chunk X/Y)"
  - Performance: ~1-3 seconds overhead for 2000-5000 orders
  - Idempotency preserved: no duplicate allocations
  - Now works for 1731, 5000+ orders (tested up to 100k)
  - See: BUGFIX_APPLY_COGS_BAD_REQUEST.md

### Ads Performance Race Condition Fix (2026-02-01)
- ✅ **Request Guard + Optimistic Tab State** - Fixed Summary/Table mismatch
  - Problem: Race condition when switching tabs/dates rapidly (stale response overwrites new state)
  - Problem: Tab state lag (URL async update after user click)
  - Solution: Request sequence guard (useRef counter, discard stale responses)
  - Solution: Optimistic local state for tab (immediate update, sync with URL)
  - Added noStore() to server actions (prevent Next.js cache)
  - Console logs: "Discarding stale request X" when race detected
  - Files: page.tsx (request guard + local state), actions.ts (noStore)
  - Minimal diff: ~30 lines changed
  - See: BUGFIX_ADS_RACE_CONDITION.md

### Profit Reports Rebuild Auth Fix (2026-02-01)
- ✅ **Explicit User ID Passing** - Fixed "Rebuild Summaries" auth.uid() NULL issue
  - Problem: auth.uid() can be NULL in PostgreSQL RPC context → rebuild finds no data
  - Root cause: JWT claim not reliably propagated in RPC execution environment
  - Solution: Pass explicit p_user_id parameter (already implemented, added logging)
  - Removed unnecessary await on createClient() (not async)
  - Added explicit authError handling with clear error messages
  - Added comprehensive debug logging: userId, email, date range, RPC errors
  - Console logs: "[Rebuild] Starting rebuild", "[Rebuild] Success", "[Rebuild] RPC error"
  - Pattern documented: Always use explicit user_id parameters in RPC, never rely on auth.uid()
  - Files: rebuild-actions.ts (logging + error handling)
  - See: FIX_PROFIT_REBUILD_AUTH.md

### Profit Reports Order-Level Rollup (2026-02-01)
- ✅ **Order-Level GMV Aggregation + Platform Normalization** - Fixed GMV inflation & ads join
  - Problem: TikTok OrderSKUList creates multiple rows per order_id (SKU-level duplicates)
  - Problem: SUM(total_amount) across SKU rows inflated GMV (double/triple counting)
  - Problem: Platform mismatch: "TikTok Shop" ≠ "tiktok" prevented ads join
  - Solution: Created view `sales_orders_order_rollup` (1 row per order, MAX(total_amount))
  - Solution: Platform normalization: "TikTok Shop" → "tiktok", "Shopee" → "shopee"
  - Updated rebuild_profit_summaries() to use rollup view for platform_net_profit_daily
  - Product profit still SKU-level (correct for product breakdown)
  - Source split uses order-level rollup (correct for GMV/orders count)
  - Ads join now works: ads.marketplace = s.platform_key
  - Files: migration-042 (view + RPC update), QA_PROFIT_REPORTS.md
  - See: migration-042-profit-order-rollup-view.sql

---

## 🚧 IN PROGRESS

None (all pending tasks are in TODO)

---

## 📋 TODO (Future Enhancements)

### Phase 8 - UI/UX Improvements
- [ ] Audit Log UI - หน้าแสดงประวัติการแก้ไข expense
- [ ] Import History UI - หน้าแสดงประวัติการ import ทั้งหมด
- [ ] Dark mode support
- [ ] Mobile responsive optimization
- [ ] Keyboard shortcuts

### Phase 9 - Advanced Features
- [ ] CEO Commission Flow (TikTok) - Personal income vs Director's Loan tracking
- [ ] Inventory Advanced Features - Reorder points, low stock alerts, multi-warehouse
- [ ] Payables/Receivables - Supplier payment tracking, aging reports
- [ ] Tax Calculation - VAT, Withholding tax, Monthly/Quarterly reports
- [ ] Permission System - Role-based access control (uses existing audit logs)
- [ ] Ad Timing Differences Data - Bridge item for reconciliation

### Performance Optimization (If Needed)
- [ ] Redis caching for company cashflow (if users > 50)
- [ ] Pre-aggregated table for reconciliation (if queries slow)
- [ ] Database query optimization
- [ ] Image optimization & CDN

### Infrastructure
- [ ] CI/CD pipeline setup
- [ ] Automated testing (E2E with Playwright)
- [ ] Database backup strategy
- [ ] Monitoring & alerting (Sentry, LogRocket)

---

## 🔴 KNOWN ISSUES & LIMITATIONS

### Bridge Items - Ad Timing Differences
- **Status:** Placeholder (data not available)
- **Impact:** Reconciliation verification may show warning if ad timing differs
- **Workaround:** Import Tiger Ads correctly, ensure dates match
- **Fix:** Need data source for ad spend timing differences

### Audit Log UI
- **Status:** No UI to view audit logs
- **Current:** Must query database directly
- **Impact:** Low (QA can query, end users don't need it for MVP)
- **Fix:** Create `/expenses/[id]/audit-log` page in Phase 8

### Import Batch History UI
- **Status:** No UI to view import history
- **Current:** Must query `import_batches` table directly
- **Impact:** Low (can see in database)
- **Fix:** Create `/imports` page in Phase 8

---

## ⚠️ CRITICAL FILES - DO NOT MODIFY CASUALLY

See `CLAUDE.md` for full list. Key files:
- `frontend/src/lib/daily-pl.ts` - P&L calculation
- `frontend/src/lib/wallet-balance.ts` - Wallet balance calculation
- `frontend/src/lib/reconcile/settlement-reconcile.ts` - Bulk reconciliation
- `frontend/src/app/(dashboard)/company-cashflow/actions.ts` - Company cashflow
- `frontend/src/app/(dashboard)/reconciliation/actions.ts` - Reconciliation logic
- `frontend/src/app/(dashboard)/expenses/actions.ts` - Expense CRUD + Audit
- All `/wallets/*-actions.ts` files - Wallet business rules

---

## 📊 METRICS

### Code Quality
- Build: ✅ Passing
- TypeScript: ✅ No errors
- ESLint: ⚠️ Warnings only (backup files ignored)

### Performance
- Page load: < 2 seconds (local)
- API responses: < 1 second (local)
- Cashflow page: < 300ms (pre-aggregated table)
- Import reconciliation: < 3 seconds (was 196s, 65x faster)

### Test Coverage
- Manual QA: ✅ All core features tested
- Automated tests: ❌ Not implemented (Phase 9)
- Regression tests: ✅ Manual checklist exists

---

## 📝 DOCUMENTATION

### User-Facing Docs
- [ ] User manual (not started)
- [ ] FAQ (not started)
- [ ] Video tutorials (not started)

### Developer Docs
- ✅ `CLAUDE.md` - Project rules & system state
- ✅ `BUSINESS_RULES_AUDIT.md` - Business logic verification
- ✅ `WALLET_BUSINESS_RULES.md` - Critical wallet rules
- ✅ `MVP_QA_VALIDATION.md` - Full MVP validation checklist
- ✅ `MANUAL_QA_CHECKLIST_TASKS_ABCD.md` - Tasks A-D QA checklist
- ✅ `BUGFIX_INFINITE_LOOP.md` - Infinite render loop fix
- ✅ `TASK_COMPLETION_SUMMARY.md` - Tasks A-D summary
- ✅ Subagent system (`docs/agents/*.md`) - Agent roles & templates

---

## 🎯 NEXT ACTIONS

### Immediate (Priority 1)
1. **Manual QA** - Test all features end-to-end
   - Download template → Fill data → Import → Check audit logs
   - Company Cashflow → Export CSV
   - Reconciliation → Verify bridge items
   - All date pickers → Bangkok timezone correct

2. **Data Migration** (if applicable)
   - Verify production database has all migrations applied
   - Test imports with real data files

### Short-Term (Priority 2)
1. **UI Polish**
   - Review all pages for consistency
   - Fix any visual bugs
   - Improve loading states

2. **Documentation**
   - Create user manual (Thai + English)
   - Document import file formats
   - FAQ for common issues

### Long-Term (Priority 3)
1. **Phase 8** - Audit Log UI + Import History UI
2. **Phase 9** - Advanced features (Inventory, Tax, Permissions)
3. **Automated Testing** - E2E tests with Playwright

---

## 🐛 BUG REPORT TEMPLATE

Use `docs/agents/templates/BUG.md`:
```
OBSERVED:
EXPECTED:
CONTEXT:
DONE WHEN:
```

## ✨ FEATURE REQUEST TEMPLATE

Use `docs/agents/templates/FEATURE.md`:
```
FEATURE:
WHY:
SCOPE:
CONSTRAINT:
DONE WHEN:
```

---

## 📞 SUPPORT & CONTACTS

### Internal Team
- **Project Lead:** [TBD]
- **Developer:** Claude Code (Anthropic CLI)
- **QA:** [TBD]

### External
- **Supabase Support:** https://supabase.com/support
- **Next.js Docs:** https://nextjs.org/docs
- **GitHub Issues:** https://github.com/[your-repo]/issues

---

**Document Version:** 1.0
**Created:** 2026-01-25
**Maintained By:** Development Team
