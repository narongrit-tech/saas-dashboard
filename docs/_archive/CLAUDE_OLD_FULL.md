# SaaS Dashboard (Multi-Channel E-Commerce) – Project Rules

# Language & Communication Rules

- Always respond in Thai.
- Use clear, concise, technical Thai.
- Do not switch to English unless explicitly asked.
- Code comments can be in English if clearer, but explanations must be in Thai.

## Goal (MVP)
Build internal dashboard (<=5 users) to track Daily P&L accurately.
Primary goal: Daily P&L ที่ใช้งานจริงและแม่นยำ เพื่ออุดรูรั่วรายได้

## Tech Stack (must follow)
- Next.js 14 (App Router), React 18, TypeScript
- Tailwind CSS, shadcn/ui, Recharts
- Supabase (Postgres + RLS), Supabase Auth + Google OAuth
- No localStorage/sessionStorage

## Critical Business Logic (must not be wrong)
### Daily P&L
Revenue (all channels)
- Advertising Cost (daily)
- COGS
= Profit/Loss

### CEO Commission Flow (TikTok)
- TikTok pays commission into CEO personal account
- CEO may use some personally
- Remaining transferred to company = Director's Loan (CEO -> Company)
System must separate:
1) Personal income
2) Director's Loan to company

## MVP Priority (do in this order)
1) Sales Orders: CRUD (view/add/edit/delete), filter/search, export
2) Expenses: CRUD + categories (Advertising/Operating/COGS), export
3) Dashboard: replace mock with real DB data (today + last 7 days)
Later: CSV import, inventory, payables, reports, tax, APIs

## Development Rules
- Do one feature at a time (no parallel big features)
- If needs major refactor: STOP and ask first
- Prefer server/db truth; keep client thin
- Always include edit + export for each table feature
- Keep UI simple, no fancy visualization beyond essentials


##
- Prefer direct, structured answers.
- Avoid verbose explanations.
- Focus on implementation details and next actions.

## Workspace Permissions

- You are allowed to create, modify, and delete files freely
  ONLY inside this project directory.
- Do not ask for confirmation before editing files within this workspace.
- Never access files outside this project.
- If a change would affect architecture or business logic,
  STOP and ask before proceeding.

---

# Current System State (Updated: 2026-01-25)

## ✅ Completed Features

### Sales Orders (COMPLETE - MVP Core Feature + UX v2)
- ✅ View: Paginated list with advanced filters
- ✅ Add: Manual order entry with validation
- ✅ Edit: Update existing orders with server-side validation
- ✅ Delete: Hard delete with confirmation dialog
- ✅ Export: CSV export respecting all filters (Asia/Bangkok timezone)
- ✅ **UX v2**: Platform status tracking, flexible pagination, URL params

**Location:**
- Page: `frontend/src/app/(dashboard)/sales/page.tsx`
- Actions: `frontend/src/app/(dashboard)/sales/actions.ts`
- Import: `frontend/src/app/(dashboard)/sales/sales-import-actions.ts`
- Parser: `frontend/src/lib/sales-parser.ts`
- Components:
  - `frontend/src/components/sales/AddOrderDialog.tsx`
  - `frontend/src/components/sales/EditOrderDialog.tsx`
  - `frontend/src/components/sales/SalesImportDialog.tsx`
  - `frontend/src/components/shared/DeleteConfirmDialog.tsx`
- Database: `database-scripts/migration-008-sales-ux-v2.sql`

**UX v2 Features (Phase 6B):**

**Platform Status Tracking:**
- `platform_status` - Raw status from platform (e.g., "To Ship", "Delivered", "Cancelled")
- `platform_substatus` - Platform-specific sub-status
- `payment_status` - Payment state: paid/unpaid/partial/refunded
- `paid_at` - Timestamp when payment received
- `shipped_at` - Timestamp when order shipped
- `delivered_at` - Timestamp when order delivered
- `source_platform` - Normalized platform: tiktok_shop/shopee/lazada
- `external_order_id` - Original platform order ID

**Advanced Filters (URL Params):**
- Platform filter: tiktok_shop/shopee/all
- Status multi-select: pending/completed/cancelled (checkboxes)
- Payment status: paid/unpaid/all
- Date range: start/end (Bangkok timezone)
- Search: order_id/product_name/external_order_id
- URL format: `?platform=tiktok_shop&status=pending,completed&paymentStatus=paid&page=2&perPage=50`

**Pagination Controls:**
- Page size dropdown: 20/50/100 records per page
- Jump-to-page input: Navigate to specific page (1 to N)
- Prev/Next buttons: Sequential navigation
- URL persistence: `?page=N&perPage=M` (refresh-safe)

**Table Improvements:**
- 11 columns: Order ID, External Order ID, Platform, Product, Qty, Amount, Internal Status, Platform Status, Payment, Paid Date, Order Date, Actions
- Sticky header for long scrolls
- Ellipsis with hover tooltip for long text
- Right-align numeric columns
- Status badges: Internal (green/yellow/red), Platform (outline), Payment (blue)

**CSV Export (UX v2):**
- Filename format: `sales-orders-YYYYMMDD-HHmmss.csv`
- Headers: Order ID, External Order ID, Platform, Product Name, Quantity, Unit Price, Total Amount, Internal Status, Platform Status, Payment Status, Paid Date, Order Date, Created At
- Respects all UX v2 filters (platform, status multi-select, payment)

**Re-import UX (COMPLETE - 2026-01-26):**
- ✅ Smart duplicate file detection via SHA256 hash
- ✅ User-friendly prompt when duplicate file detected
- ✅ Shows filename + import timestamp in warning alert
- ✅ Two actions: Cancel (reset) or Re-import (update)
- ✅ Idempotent upsert (no duplicates, updates existing rows)
- ✅ Use cases: Status updates, incremental import, accidental re-upload
- ✅ Audit logging: `[RE-IMPORT]` in server console
- **Safety:** Default blocks duplicates, user must explicitly confirm
- **Database:** Uses `(created_by, order_line_hash)` unique index for idempotency
- **Location:**
  - Actions: `frontend/src/app/(dashboard)/sales/sales-import-actions.ts`
  - Dialog: `frontend/src/components/sales/SalesImportDialog.tsx`
  - Docs: `SALES_REIMPORT_UX.md`, `QA_SALES_REIMPORT_UX.md`
  - Migration: `database-scripts/migration-025-sales-order-line-hash-full-unique-index.sql`

**Daily Sales Summary Bar (NEW - 2026-01-26):**
- **Default Date Range:** Today (paid_at basis, not order_date)
- **Layout:** 2 large cards (Revenue, Orders) + 3 small cards (Units, AOV, Cancelled Amount)
- **Key Metrics:**
  - Revenue (Paid): Sum of total_amount (exclude cancelled), with "Net after cancel" subtext
  - Orders: Count of orders (exclude cancelled), with "Cancelled: N orders" subtext
  - Units (Qty): Sum of quantity (exclude cancelled)
  - AOV: Net Revenue / Orders (handles divide-by-zero)
  - Cancelled Amount: Sum of cancelled order amounts (red text)
- **Critical:** Summary uses SAME filters as table (no drift)
  - Date filter: paid_at column (only paid orders contribute to revenue)
  - Platform filter: source_platform
  - Status filter: platform_status (Thai values, multi-select)
  - Payment filter: payment_status
  - Search filter: order_id/product_name/external_order_id
- **Cancelled Orders Handling:** Detected by `platform_status.toLowerCase().includes('ยกเลิก')`
  - Excluded from main metrics (revenue, orders, units)
  - Shown separately in "Cancelled Amount" card and order subtext
- **Component:** `frontend/src/components/sales/SalesSummaryBar.tsx`
- **Server Action:** `getSalesAggregates()` in `frontend/src/app/(dashboard)/sales/actions.ts`
- **Loading State:** Skeleton cards during fetch
- **Zero Handling:** Returns zero metrics (not NaN) when no data

**Why paid_at Basis:**
- Revenue recognition: Only orders with payment received count toward revenue
- Cash flow accuracy: Matches when money actually entered business
- Prevents inflated revenue from unpaid orders
- Aligns with accounting standards (accrual basis with payment verification)

### Expenses (COMPLETE - MVP Core Feature)
- ✅ View: Paginated list with filters (category, date range, search)
- ✅ Add: Manual expense entry with category validation
- ✅ Edit: Update existing expenses with server-side validation
- ✅ Delete: Hard delete with confirmation dialog
- ✅ Export: CSV export respecting all filters (Asia/Bangkok timezone)

**Location:**
- Page: `frontend/src/app/(dashboard)/expenses/page.tsx`
- Actions: `frontend/src/app/(dashboard)/expenses/actions.ts`
- Components:
  - `frontend/src/components/expenses/AddExpenseDialog.tsx`
  - `frontend/src/components/expenses/EditExpenseDialog.tsx`
  - `frontend/src/components/shared/DeleteConfirmDialog.tsx`

**CSV Export:**
- Filename format: `expenses-YYYYMMDD-HHmmss.csv`
- Headers: Expense Date, Category, Amount, Description, Notes, Created At
- Server-side generation, respects filters (category, date range, search)

### Dashboard (Complete)
- ✅ Total Sales Today (excludes cancelled)
- ✅ Total Expenses Today (all categories)
- ✅ Net Profit Today
- ✅ 7-Day Trend Chart (sales & expenses)
- ⚠️ Cash on Hand (still mock data)

**Location:**
- Page: `frontend/src/app/(dashboard)/page.tsx`
- Actions: `frontend/src/app/(dashboard)/actions.ts`

### Daily P&L (COMPLETE - MVP Core Feature)
- ✅ Server-side calculation utilities
- ✅ Daily P&L Page with date selector
- ✅ Shows: Revenue, Advertising Cost, COGS, Operating Expenses, Net Profit
- ✅ Profit/Loss highlighted (green/red)
- ✅ Breakdown table
- ✅ Thai formatting

**Location:**
- Utilities: `frontend/src/lib/daily-pl.ts`
- Page: `frontend/src/app/(dashboard)/daily-pl/page.tsx`
- Actions: `frontend/src/app/(dashboard)/daily-pl/actions.ts`

**Business Logic:**
- Revenue = Sales (completed + pending, excludes cancelled)
- Advertising Cost = Expenses where category = 'Advertising'
- COGS = Expenses where category = 'COGS'
- Operating = Expenses where category = 'Operating'
- Net Profit = Revenue - Advertising - COGS - Operating

### Cashflow View (COMPLETE - MVP Core Feature + Phase 2B Optimization)
- ✅ TikTok Onhold (Forecast) + Income (Actual) Import
- ✅ Daily forecast vs actual reconciliation
- ✅ UX v3: Daily Summary First (< 300ms page load)
- ✅ Timezone-aware bucketing (Asia/Bangkok)
- ✅ Pre-aggregated daily summary table
- ✅ Bulk reconciliation (3 queries, not 401)
- ✅ 0% NULL estimated_settle_time

**Location:**
- Page: `frontend/src/app/(dashboard)/finance/marketplace-wallets/page.tsx`
- API Actions: `frontend/src/app/(dashboard)/finance/marketplace-wallets/finance/marketplace-wallets-api-actions.ts`
- Legacy Actions: `frontend/src/app/(dashboard)/finance/marketplace-wallets/actions.ts`
- TikTok Onhold Parser: `frontend/src/lib/importers/tiktok-onhold.ts`
- TikTok Income Parser: `frontend/src/lib/importers/tiktok-income.ts`
- Reconciliation: `frontend/src/lib/reconcile/settlement-reconcile.ts`
- Types: `frontend/src/types/finance/marketplace-wallets-api.ts`
- Components:
  - `frontend/src/components/finance/marketplace-wallets/ImportOnholdDialog.tsx`
  - `frontend/src/components/finance/marketplace-wallets/ImportIncomeDialog.tsx`
  - `frontend/src/components/shared/SingleDateRangePicker.tsx`
- Database:
  - Migration: `database-scripts/migration-010-cashflow-performance.sql`
  - Verification: `database-scripts/verify-cashflow-timezone-fix.sql`

**Business Logic:**
- **Forecast**: unsettled_transactions (TikTok Onhold import)
- **Actual**: settlement_transactions (TikTok Income import)
- **Daily Summary**: Pre-aggregated in `cashflow_daily_summary` table
- **Reconciliation**: Match txn_id between forecast and actual, mark as 'settled'

**UX v3 Features (Phase 2B - Performance First):**

**Primary View - Daily Summary (Always Loaded):**
- Data source: `cashflow_daily_summary` table ONLY (no raw table joins)
- Columns: Date, Forecast, Actual, Gap, Status
- Status badges: actual_over (green), pending (yellow), actual_only (blue), forecast_only (gray)
- Pagination: 14 rows per page, sorted by date ASC
- Load time: < 300ms (local)

**Secondary View - Raw Transactions (Lazy Loaded):**
- Tabs: Forecast / Actual / Overdue / Exceptions
- Data fetched ONLY when tab clicked (no initial load)
- Server-side pagination: 50 rows per page

**Date Range Picker:**
- Single button: "DD MMM YYYY – DD MMM YYYY"
- Opens 2-month calendar in one popover
- Presets: Today, Last 7 Days, Last 30 Days, MTD, Last Month
- Auto-apply on range selection
- Debounced: 300ms delay before query

**Performance Optimizations:**
1. **Pre-aggregated Table**: `cashflow_daily_summary`
   - Daily forecast_sum, actual_sum, gap_sum, status counts
   - Rebuilt via `rebuild_cashflow_daily_summary()` function
   - Indexed: (created_by, date)

2. **Timezone-Aware Bucketing**:
   - Uses `(settled_time AT TIME ZONE 'Asia/Bangkok')::date`
   - Fixes: UTC 17:00 on 2026-01-24 → Thai date 2026-01-25 (correct)
   - Applied to both forecast and actual data

3. **Bulk Reconciliation**:
   - Before: N+1 queries (401 queries for 200 rows, 196 seconds)
   - After: 3 queries (< 3 seconds, 65x faster)
   - Fetch all → match in-memory → bulk update

4. **TikTok Onhold Parser Fix**:
   - Handles "Delivered + N days" format
   - Fallback chain: Direct date → "Delivered + N" → order_created + 7 → today + 7
   - Always returns Date (never null)
   - Target achieved: 0% NULL estimated_settle_time

**Import Features:**
- **Onhold Import**: TikTok forecast data (xlsx)
  - Columns: Transaction ID, Amount, Expected Settlement Time
  - Handles "Delivered + N days" strings
  - Manual worksheet range scanning (bypass !ref truncation)
  - In-file deduplication by txn_id
  - Bulk upsert: 3 queries (not 1400+)

- **Income Import**: TikTok actual settlement data (xlsx)
  - Columns: Transaction ID, Settlement Amount, Settled Time
  - Auto-reconciliation with forecast data
  - Marks matched forecast as 'settled'
  - Bulk operations: 3 queries for reconciliation
  - Import time: < 3 seconds (was 196 seconds)

**Database Schema:**
- `unsettled_transactions`: Forecast data (txn_id, estimated_settle_time, status)
- `settlement_transactions`: Actual data (txn_id, settled_time, settlement_amount)
- `cashflow_daily_summary`: Pre-aggregated daily data (date, forecast_sum, actual_sum, gap_sum, status counts)
- `import_batches`: Import tracking with file_hash deduplication

**Indexes:**
- `idx_settlement_transactions_user_marketplace_time`: Composite index for date range queries
- `idx_unsettled_transactions_user_marketplace_time`: Composite index for forecast queries
- `idx_cashflow_daily_summary_user_date`: Fast daily summary lookup

### Multi-Wallet System (COMPLETE - Phase 3)
- ✅ 2 wallets: TikTok Ads, Foreign Subscriptions
- ✅ Future-proof design (scalable to more wallets)
- ✅ Wallet ledger with CRUD operations
- ✅ Balance calculation (opening, in, out, closing)
- ✅ CSV export with filters
- ✅ **STRICT business rules enforcement**
- ✅ **Tiger Awareness Ads Import (Monthly aggregation)**

**Location:**
- Page: `frontend/src/app/(dashboard)/wallets/page.tsx`
- Actions: `frontend/src/app/(dashboard)/wallets/actions.ts`
- Performance Ads Import Actions: `frontend/src/app/(dashboard)/wallets/performance-ads-import-actions.ts`
- Tiger Import Actions: `frontend/src/app/(dashboard)/wallets/tiger-import-actions.ts`
- Balance Utility: `frontend/src/lib/wallet-balance.ts`
- Types: `frontend/src/types/wallets.ts`
- Components:
  - `frontend/src/components/wallets/AddLedgerDialog.tsx`
  - `frontend/src/components/wallets/EditLedgerDialog.tsx`
  - `frontend/src/components/wallets/PerformanceAdsImportDialog.tsx`
  - `frontend/src/components/wallets/TigerImportDialog.tsx`
- Database:
  - Migration: `database-scripts/migration-005-wallets.sql`
  - Seed: `database-scripts/migration-005-wallets-seed.sql`

**⚠️ CRITICAL Business Rules (Server-Side Enforced):**

1. **ADS Wallet - SPEND Source Lock** 🔒
   - Ad Spend MUST come from Ads Report ONLY (`source=IMPORTED`)
   - Manual SPEND creation is BLOCKED
   - Error: "❌ ห้ามสร้าง SPEND แบบ Manual สำหรับ ADS Wallet"

2. **Top-up is NOT an Expense**
   - Wallet top-up is a cash transfer, NOT a P&L expense
   - Only actual Ad Spend (from report) affects P&L
   - Prevents double-counting

3. **SUBSCRIPTION Wallet Rules**
   - Manual SPEND entries ALLOWED (for SaaS subscriptions)
   - Monthly recurring charges tracked manually

4. **Immutable IMPORTED Entries**
   - Cannot edit or delete `source=IMPORTED` entries
   - Must update source file and re-import

5. **Entry Type + Direction Validation**
   - TOP_UP → must be IN
   - SPEND → must be OUT
   - REFUND → must be IN
   - ADJUSTMENT → can be IN or OUT

**Two Views Concept:**
- **Accrual P&L** (Performance): Revenue - Ad Spend (from report) - COGS - Operating
- **Cashflow Summary** (Liquidity): Cash In/Out + Wallet movements

**See:** `WALLET_BUSINESS_RULES.md` for detailed explanation

**CSV Export:**
- Filename format: `wallet-{name}-YYYYMMDD-HHmmss.csv`
- Headers: Date, Entry Type, Direction, Amount, Source, Reference ID, Note, Created At
- Respects filters (wallet, date range, entry_type, source)

---

### Performance Ads Import - Product & Live (COMPLETE - Phase 4)

**Purpose:** Import performance ads with sales metrics (Product/Live campaigns)

**Key Characteristics:**
- ✅ Daily breakdown (one record per day per campaign)
- ✅ Creates ad_daily_performance records (analytics)
- ✅ Creates wallet_ledger SPEND entries (daily aggregated)
- ✅ Template validation (must HAVE sales metrics)
- ✅ File deduplication (SHA256 hash)
- ✅ Affects Accrual P&L (Advertising Cost)
- ✅ Independent imports (Product & Live fully decoupled)

**Campaign Types:**
- **Product Ads** (Daily): Creative/Product campaigns - typically imported daily
- **Live Ads** (Weekly): Livestream campaigns - typically imported weekly

**Import Requirements:**
- File format: `.xlsx` only
- Required columns: Date, Campaign, Cost/Spend, GMV, Orders
- Optional: ROAS/ROI (will calculate if missing)
- Must HAVE sales metrics (GMV/Orders/ROAS) - blocks awareness-only files

**Business Logic:**
- Parse daily data (one row = one day + one campaign)
- Create ad_daily_performance records (daily breakdown)
- Aggregate spend per day for wallet entries
- Create import_batch with type `tiktok_ads_product` or `tiktok_ads_live`
- Independent imports - no coupling or completeness enforcement

**Database Writes:**
1. `ad_daily_performance` - one per day per campaign
   - Fields: ad_date, campaign_type, campaign_name, spend, orders, revenue, roi
   - Used for: Daily ROI tracking, performance analytics
2. `wallet_ledger` - one per day (aggregated spend)
   - Fields: entry_type=SPEND, direction=OUT, amount=[daily total]
   - Used for: Cashflow tracking
3. `import_batches` - one per file import
   - Tracks: file_hash, row_count, inserted_count, status

**Location:**
- Import Actions: `frontend/src/app/(dashboard)/wallets/performance-ads-import-actions.ts`
- UI Component: `frontend/src/components/wallets/PerformanceAdsImportDialog.tsx`
- Integrated in: Wallets page (Import button visible for ADS wallet only)

**See:** `WALLET_BUSINESS_RULES.md` → "Performance Ads (Product/Live) - Daily Sales Tracking" section

---

### Tiger Awareness Ads Import (COMPLETE - Phase 3+)

**Purpose:** Import monthly awareness/reach/video view campaigns (Tiger) as wallet SPEND ONLY

**Key Characteristics:**
- ✅ Monthly aggregation (1 entry per file)
- ✅ Wallet SPEND entry ONLY (no ad_daily_performance)
- ✅ Template validation (must NOT have sales metrics)
- ✅ File deduplication (SHA256 hash)
- ✅ Shows in Cashflow Summary ONLY
- ✅ Does NOT affect Accrual P&L

**Import Requirements:**
- File format: `.xlsx` only
- Filename must contain: "Tiger" OR "Campaign Report"
- Date range format: `(YYYY-MM-DD to YYYY-MM-DD)` in filename
- Required columns: Campaign, Cost
- Must NOT have: GMV, Orders, ROAS, Conversion Value, CPA

**Business Logic:**
- Aggregate total Cost across all campaigns in file
- Post to wallet on report END DATE (Bangkok timezone)
- Create import_batch record with type `tiger_awareness_monthly`
- Create single wallet_ledger entry:
  - `entry_type=SPEND`, `direction=OUT`, `source=IMPORTED`
  - Note: "Monthly Awareness Spend (Tiger) - YYYY-MM"

**Location:**
- Import Actions: `frontend/src/app/(dashboard)/wallets/tiger-import-actions.ts`
- UI Component: `frontend/src/components/wallets/TigerImportDialog.tsx`
- Integrated in: Wallets page (Import button visible for ADS wallet only)

**See:** `WALLET_BUSINESS_RULES.md` → "Awareness Ads (Tiger) - Monthly Cash Treatment" section

---

### Manual Column Mapping Wizard (COMPLETE - Phase 5)

**Purpose:** Fallback wizard for manual column mapping when auto-parse fails or file has non-standard columns

**Key Characteristics:**
- ✅ 4-step wizard: Report Type → Column Mapping → Preview → Confirm
- ✅ Preset system (save/load column mappings per user + filename pattern)
- ✅ Supports all report types (Product/Live/Tiger)
- ✅ Server-side validation of business rules
- ✅ Tiger date range picker (manual input when filename has no date range)
- ✅ Preview with warnings/errors before import
- ✅ Reuses existing import logic (no code duplication)

**User Flow:**
1. Upload file → Auto-parse fails → Click "Try Manual Mapping" button
2. **Step 1**: Select report type (Product/Live/Tiger)
3. **Step 2**: Map Excel columns to system fields
   - Dropdown for each required field
   - Load preset if available (matched by filename pattern)
   - Tiger: Add date range picker (start/end date)
4. **Step 3**: Preview parsed data (server-validated)
   - Shows: date range, total spend, sample rows (first 5)
   - Warnings/Errors displayed
   - Blocks proceed if validation fails
5. **Step 4**: Confirm import
   - Checkbox: "Save this mapping as preset" (default: checked)
   - Final summary before import

**Preset System:**
- Automatic matching: Exact → Fuzzy → Prefix (3-tier)
- Stores: `filename_pattern`, `report_type`, `column_mapping` (JSON)
- Tracks: `use_count`, `last_used_at`
- RLS: User can only see own presets
- Future imports with similar filenames → auto-apply preset

**Business Rules Enforcement:**
- **Tiger**: Must NOT have orders/revenue/roi data (server blocks)
- **Product/Live**: MUST have orders/revenue data (server blocks)
- **Date validation**: Product/Live require date column, Tiger requires manual date range
- **Duplicate file hash check**: Same as auto-import
- All validation server-side only (no complex client logic)

**Database:**
- New table: `user_column_mappings` (presets storage)
- Migration: `database-scripts/migration-006-column-mappings.sql`

**Location:**
- Server Actions: `frontend/src/app/(dashboard)/wallets/manual-mapping-actions.ts`
- Types: `frontend/src/types/manual-mapping.ts`
- Preset Matching: `frontend/src/lib/preset-matching.ts`
- Main Wizard: `frontend/src/components/wallets/ManualMappingWizard.tsx`
- Wizard Steps:
  - `frontend/src/components/wallets/wizard/WizardProgress.tsx`
  - `frontend/src/components/wallets/wizard/Step1ReportType.tsx`
  - `frontend/src/components/wallets/wizard/Step2ColumnMapper.tsx`
  - `frontend/src/components/wallets/wizard/Step3Preview.tsx`
  - `frontend/src/components/wallets/wizard/Step4Confirm.tsx`
- Integration:
  - Modified: `PerformanceAdsImportDialog.tsx` (added "Try Manual Mapping" button)
  - Modified: `TigerImportDialog.tsx` (added "Try Manual Mapping" button)

**Import Execution:**
- Reuses existing logic from `performance-ads-import-actions.ts` / `tiger-import-actions.ts`
- Same database writes: `ad_daily_performance`, `wallet_ledger`, `import_batches`
- Same business rules: Tiger → wallet only, Product/Live → performance + wallet
- File hash check prevents duplicates

**Edge Cases Handled:**
- ✅ No headers in Excel file → Error with clear message
- ✅ Duplicate column names → Shows as "Column Name (Column 3)"
- ✅ User changes report type after mapping → Reset all mappings
- ✅ Preset exists but user modifies → Can override freely
- ✅ Tiger without date column → Manual date range picker

**When to Use:**
- Auto-parse fails (template detection error)
- Non-standard column names
- Custom report formats
- Missing or renamed columns

**See:** Plan document at `~/.claude/plans/staged-stirring-mist.md` for full implementation details

---

### Sales & Expenses Import (COMPLETE - Phase 6)

**Purpose:** End-to-end CSV/Excel import for Sales Orders and Expenses with preview, validation, and deduplication

**Key Characteristics:**
- ✅ Sales Import: TikTok Shop (OrderSKUList .xlsx) + Shopee/generic via manual mapping
- ✅ Expenses Import: Standard template (.xlsx/.csv) + manual mapping fallback
- ✅ SHA256 file deduplication (prevents duplicate imports)
- ✅ Preview with validation errors before import
- ✅ Line-level storage for TikTok (avoid double-counting order totals)
- ✅ Bangkok timezone consistency
- ✅ Reuses existing import infrastructure (import_batches, manual mapping wizard)

**Sales Import - TikTok Shop (UX v2 Enhanced):**
- Format: OrderSKUList sheet in .xlsx
- Auto-detects: Row 1 = header, Row 2 = description (skip), Row 3+ = data
- Date format: DD/MM/YYYY HH:MM:SS → Bangkok timezone
- Revenue calculation: SKU Subtotal After Discount (line-level, not order-level)
- Status normalization: delivered/completed → completed, cancel/return → cancelled
- **UX v2 Mapping:**
  - `Order Status` → `platform_status`
  - `Order Substatus` → `platform_substatus`
  - `Paid Time` → `paid_at`, `payment_status=paid`
  - `Shipped Time` → `shipped_at`
  - `Delivered Time` → `delivered_at`
  - `Order ID` → `external_order_id`
  - `Seller SKU` → `seller_sku`
  - `SKU ID` → `sku_id`
  - Derive: `payment_status=paid` if `paid_at` exists, else `unpaid`
  - Source: `source_platform=tiktok_shop`
- Metadata: Extended TikTok data (tracking, logistics) stored in JSONB

**Expenses Import - Standard Template:**
- Format: .xlsx or .csv with headers: Date, Category, Amount, Description
- Category validation: Must be Advertising, COGS, or Operating
- Date format: Multiple formats supported → Bangkok timezone (YYYY-MM-DD)
- Breakdown by category in preview

**Database Schema (Migration 007):**
- `sales_orders.source` (manual | imported)
- `sales_orders.import_batch_id` → links to import_batches
- `sales_orders.metadata` (JSONB) → TikTok rich data
- `expenses.source` (manual | imported)
- `expenses.import_batch_id` → links to import_batches

**Flow:**
1. Upload file → Auto-parse (TikTok/Standard template detection)
2. Preview: Summary stats + sample rows + errors/warnings
3. Confirm → Execute import with file hash check
4. Result: Inserted count + summary (revenue/amount)
5. Fallback: If auto-parse fails → Manual mapping wizard

**Location:**
- Sales Import Actions: `frontend/src/app/(dashboard)/sales/sales-import-actions.ts`
- Expenses Import Actions: `frontend/src/app/(dashboard)/expenses/expenses-import-actions.ts`
- Sales Import Dialog: `frontend/src/components/sales/SalesImportDialog.tsx`
- Expenses Import Dialog: `frontend/src/components/expenses/ExpensesImportDialog.tsx`
- Types: `frontend/src/types/sales-import.ts`, `frontend/src/types/expenses-import.ts`
- Migration: `database-scripts/migration-007-import-sales-expenses.sql`
- Integration: Import button added to `/sales` and `/expenses` pages

**Business Rules:**
- TikTok Row 2 skipped (description row, not data)
- Line-level import: Each SKU = separate row (avoid order total double-count)
- Status filter: Only completed orders count toward revenue
- File hash deduplication: Same file cannot be imported twice (same report_type)
- Metadata isolation: TikTok-specific fields in JSONB, not polluting main schema

**Deduplication:**
- SHA256 hash of entire file buffer
- Stored in `import_batches.file_hash` (indexed)
- Checked before import → blocks if hash + report_type match
- Shows original import timestamp if duplicate detected

---

### Unified Date Picker (COMPLETE - Phase 7 Task D)

**Purpose:** Consistent Bangkok timezone date selection across all pages

**Key Characteristics:**
- ✅ Two reusable components: SingleDateRangePicker, SingleDatePicker
- ✅ Bangkok timezone (Asia/Bangkok) everywhere
- ✅ Presets: Today, Last 7 Days, Last 30 Days, MTD, Last Month
- ✅ No breaking changes to existing functionality

**Components:**
- `frontend/src/components/shared/SingleDateRangePicker.tsx` - Range picker (start/end date)
- `frontend/src/components/shared/SingleDatePicker.tsx` - Single date picker

**Integrated Pages:**
- `/sales` - Date range filter
- `/expenses` - Date range filter
- `/daily-pl` - Single date selector
- `/company-cashflow` - Date range filter
- `/reconciliation` - Date range filter
- `/finance/marketplace-wallets` - Date range filter (already existed)

**Bangkok Timezone Utilities:**
- `frontend/src/lib/bangkok-time.ts` - Central timezone handling
- Functions: `getBangkokNow()`, `formatBangkok()`, `startOfDayBangkok()`, `endOfDayBangkok()`

**See:** `MANUAL_QA_CHECKLIST_TASKS_ABCD.md` → Test D1, D2

---

### Company Cashflow (COMPLETE - Phase 7 Task A)

**Purpose:** Track actual cash in/out for company (liquidity view, not accrual P&L)

**Key Characteristics:**
- ✅ Summary cards: Total Cash In, Total Cash Out, Net Cashflow
- ✅ Daily breakdown table with running balance
- ✅ Date range filter (default: Last 7 days)
- ✅ CSV export with Bangkok timezone
- ✅ Page loads < 5 seconds

**Data Sources:**
- **Cash In**: `settlement_transactions` (marketplace settlements)
- **Cash Out**: `expenses` table + `wallet_ledger` (TOP_UP entries)

**Location:**
- Page: `frontend/src/app/(dashboard)/company-cashflow/page.tsx`
- Actions: `frontend/src/app/(dashboard)/company-cashflow/actions.ts`
- Route: `/company-cashflow`

**Key Functions:**
```typescript
export async function getCompanyCashflow(
  startDate: Date,
  endDate: Date
): Promise<{ success: boolean; data?: CompanyCashflowSummary; error?: string }>

export async function exportCompanyCashflow(
  startDate: Date,
  endDate: Date
): Promise<{ success: boolean; csv?: string; filename?: string; error?: string }>
```
