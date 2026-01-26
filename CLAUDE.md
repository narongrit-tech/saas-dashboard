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
- Page: `frontend/src/app/(dashboard)/cashflow/page.tsx`
- API Actions: `frontend/src/app/(dashboard)/cashflow/cashflow-api-actions.ts`
- Legacy Actions: `frontend/src/app/(dashboard)/cashflow/actions.ts`
- TikTok Onhold Parser: `frontend/src/lib/importers/tiktok-onhold.ts`
- TikTok Income Parser: `frontend/src/lib/importers/tiktok-income.ts`
- Reconciliation: `frontend/src/lib/reconcile/settlement-reconcile.ts`
- Types: `frontend/src/types/cashflow-api.ts`
- Components:
  - `frontend/src/components/cashflow/ImportOnholdDialog.tsx`
  - `frontend/src/components/cashflow/ImportIncomeDialog.tsx`
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
- `/cashflow` - Date range filter (already existed)

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

**Business Logic:**
- Cash In = sum(settlement_amount) from settlement_transactions
- Cash Out = sum(expenses.amount) + sum(wallet_ledger TOP_UP amounts)
- Net Cashflow = Cash In - Cash Out
- Running Balance = cumulative net across date range

**CSV Export:**
- Filename format: `company-cashflow-YYYYMMDD-HHmmss.csv`
- Headers: Date, Cash In, Cash Out, Net Cashflow, Running Balance
- Server-side generation, respects date range filter

**See:** `MANUAL_QA_CHECKLIST_TASKS_ABCD.md` → Test A1, A2, A3

---

### P&L vs Cashflow Reconciliation (COMPLETE - Phase 7 Task B)

**Purpose:** Explain difference between Accrual P&L (performance) and Company Cashflow (liquidity)

**Key Characteristics:**
- ✅ Side-by-side comparison: Accrual P&L vs Company Cashflow
- ✅ Bridge items explain the gap
- ✅ Verification formula checks accuracy
- ✅ Date range filter (default: Last 7 days)
- ✅ CSV export with all sections
- ✅ Read-only report (no data modification)

**Location:**
- Page: `frontend/src/app/(dashboard)/reconciliation/page.tsx`
- Actions: `frontend/src/app/(dashboard)/reconciliation/actions.ts`
- Route: `/reconciliation`

**Bridge Items (Explain P&L vs Cashflow Gap):**
1. **Revenue not yet settled**: Accrual revenue - Actual cash in (sales recorded but not paid)
2. **Wallet top-ups**: Cash out but NOT expense (company → wallet transfer)
3. **Ad spend timing differences**: Placeholder (0) - data not yet available

**Verification Formula:**
```
Accrual Net Profit + Total Bridge = Cashflow Net
```
- Error < 0.01 → ✅ Verified
- Error ≥ 0.01 → ⚠️ Warning (missing bridge items)

**Key Functions:**
```typescript
export async function getReconciliationReport(
  startDate: Date,
  endDate: Date
): Promise<{ success: boolean; data?: ReconciliationReport; error?: string }>

export interface ReconciliationBridgeItem {
  label: string
  amount: number
  explanation: string
  dataAvailable: boolean
}
```

**CSV Export:**
- Filename format: `reconciliation-YYYYMMDD-HHmmss.csv`
- Sections: Accrual P&L, Company Cashflow, Bridge Items, Verification Error

**See:** `MANUAL_QA_CHECKLIST_TASKS_ABCD.md` → Test B1, B2, B3, B4

---

### Expenses Template + Audit Log (COMPLETE - Phase 7 Task C)

**Purpose:** Downloadable Excel template for expense import + audit trail for all expense changes

**Key Characteristics:**
- ✅ Download Template: .xlsx with 2 sheets (template + instructions)
- ✅ Import with preview/validation (reuses Phase 6 infrastructure)
- ✅ File hash deduplication
- ✅ Audit log table: tracks CREATE/UPDATE/DELETE operations
- ✅ Immutable audit logs (no UPDATE/DELETE policies)
- ✅ Future-proof for permission system

**Template Download:**
- **Template Sheet**: Headers + example row
  - Columns: date, category, description, amount, payment_method, vendor, notes, reference_id
  - Example row: `2026-01-25, Advertising, Facebook Ads Campaign, 5000.00, Credit Card, Meta, Campaign Jan 2026, FB-2026-001`
- **Instructions Sheet**: Thai + English guidance
  - Required columns, Category values, Data validation rules, Usage notes

**Import Functionality:**
- Uses existing `ExpensesImportDialog` component (Phase 6)
- Parser: `frontend/src/lib/expenses-parser.ts` (client-side)
- Import: `frontend/src/app/(dashboard)/expenses/expenses-import-actions.ts` (server-side)
- Preview → Validate → Confirm → Insert
- File hash deduplication via `import_batches` table

**Audit Log System:**
- **Table**: `expense_audit_logs`
- **Fields**: expense_id, action (CREATE/UPDATE/DELETE), performed_by, performed_at, changes (JSONB), ip_address, user_agent, notes
- **Changes Structure**:
  - CREATE: `{ created: { category, amount, expense_date, description } }`
  - UPDATE: `{ before: {...}, after: {...} }`
  - DELETE: `{ deleted: { category, amount, expense_date, description } }`
- **RLS Policy**: Users can only view audit logs for their own expenses
- **Immutability**: No UPDATE or DELETE policies (append-only)

**Helper Function:**
```sql
CREATE OR REPLACE FUNCTION public.create_expense_audit_log(
  p_expense_id UUID,
  p_action VARCHAR(20),
  p_performed_by UUID,
  p_changes JSONB,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
```

**Location:**
- Template Actions: `frontend/src/app/(dashboard)/expenses/template-actions.ts`
- Import Parser: `frontend/src/lib/expenses-parser.ts` (Phase 6)
- Import Actions: `frontend/src/app/(dashboard)/expenses/expenses-import-actions.ts` (Phase 6)
- Expense Actions: `frontend/src/app/(dashboard)/expenses/actions.ts` (updated with audit logging)
- Import Dialog: `frontend/src/components/expenses/ExpensesImportDialog.tsx` (Phase 6)
- Database: `database-scripts/migration-013-expense-audit-logs.sql`

**Integration:**
- `/expenses` page has "Download Template" button (calls `downloadExpenseTemplate()`)
- `/expenses` page has "Import" button (opens `ExpensesImportDialog`)
- All CRUD operations (create/update/delete) automatically create audit logs

**CSV Export:**
- Filename format: `expense-template-YYYYMMDD.xlsx`
- Generated server-side using XLSX library
- Two sheets: template data + instructions

**See:** `MANUAL_QA_CHECKLIST_TASKS_ABCD.md` → Test C1-C7

---

### Bank Module (COMPLETE - Phase 8)

**Purpose:** Track company cash flow from bank statements (source of truth)

**Key Characteristics:**
- ✅ Bank account management (CRUD)
- ✅ Bank statement import (KBIZ, K PLUS, Generic formats)
- ✅ Auto-detect format with fallback to manual column mapping
- ✅ File hash deduplication (prevents duplicate imports)
- ✅ Daily summary with running balance
- ✅ Raw transactions table with search and pagination
- ✅ CSV export (Bangkok timezone)

**Location:**
- Page: `frontend/src/app/(dashboard)/bank/page.tsx`
- Actions: `frontend/src/app/(dashboard)/bank/actions.ts`
- Import Actions: `frontend/src/app/(dashboard)/bank/import-actions.ts`
- Parser: `frontend/src/lib/parsers/bank-statement-parser.ts`
- Types: `frontend/src/types/bank.ts`
- Components:
  - `frontend/src/components/bank/BankModuleClient.tsx`
  - `frontend/src/components/bank/BankAccountSelector.tsx`
  - `frontend/src/components/bank/AddBankAccountDialog.tsx`
  - `frontend/src/components/bank/ImportBankStatementDialog.tsx`
  - `frontend/src/components/bank/BankDailySummaryTable.tsx`
  - `frontend/src/components/bank/BankTransactionsTable.tsx`
- Database: `database-scripts/migration-014-bank-module.sql`

**Import Features:**
- **KBIZ Format**: Auto-detects Kasikorn Bank Excel statements
- **K PLUS Format**: Auto-detects K PLUS CSV statements (UTF-8)
- **Generic Format**: Detects standard column names (Date, Description, Withdrawal, Deposit)
- **Manual Mapping**: Fallback wizard if auto-detection fails
- **File Hash Deduplication**: SHA256 hash per bank account, prevents re-import

**Business Logic:**
- Opening balance computed from first transaction's running balance
- Formula: Opening = First Balance - First Deposit + First Withdrawal
- Daily aggregation: Cash In (deposits), Cash Out (withdrawals), Net, Running Balance
- Bangkok timezone for all dates

**CSV Export:**
- Filename format: `bank-{account_name}-YYYYMMDD-HHmmss.csv`
- Headers: Date, Description, Withdrawal, Deposit, Balance, Channel, Reference ID, Created At
- Server-side generation, respects date range filter

---

### Bank Reconciliation (COMPLETE - Phase 8)

**Purpose:** Match bank transactions with internal records (settlements, expenses, wallet top-ups)

**Key Characteristics:**
- ✅ Summary cards: Bank Net (truth), Internal Total, Matched, Unmatched, Gap
- ✅ Unmatched bank transactions list
- ✅ Unmatched internal records (3 tabs: Settlements, Expenses, Wallet Top-ups)
- ✅ Read-only display (v1) - manual matching UI planned for v2
- ✅ Date range filter

**Location:**
- Page: `frontend/src/app/(dashboard)/bank-reconciliation/page.tsx`
- Actions: `frontend/src/app/(dashboard)/reconciliation/bank-reconciliation-actions.ts`
- Components:
  - `frontend/src/components/reconciliation/BankReconciliationClient.tsx`
  - `frontend/src/components/reconciliation/ReconciliationSummaryCards.tsx`
  - `frontend/src/components/reconciliation/UnmatchedBankTransactionsTable.tsx`
  - `frontend/src/components/reconciliation/UnmatchedInternalRecordsTabs.tsx`
- Database: Bank reconciliations table (migration-014)

**Reconciliation Logic:**
- **Bank Net** = Bank Cash In - Bank Cash Out (source of truth)
- **Internal Total** = Settlements - Expenses - Wallet Top-ups
- **Gap** = Bank Net - Internal Total (should be near 0 if fully reconciled)
- **Matched Count** = Number of reconciled transactions
- **Unmatched** = Transactions/records without matches

**Auto-Match Engine (v1):**
- Placeholder implementation (returns 0 matches)
- Future: Exact match (amount + date), Near match (amount + date +/-1 day), Keyword match (description contains keywords)

---

### Expenses Subcategory (COMPLETE - Phase 8)

**Purpose:** Add optional subcategory field for detailed expense tracking without affecting P&L formula

**Key Characteristics:**
- ✅ Nullable subcategory field added to expenses table
- ✅ Add/Edit dialogs updated with subcategory input
- ✅ Subcategory included in CSV export
- ✅ Audit logs track subcategory changes
- ✅ **P&L formula unchanged** (still uses main category only)

**Location:**
- Database: `database-scripts/migration-015-expenses-subcategory.sql`
- Actions: `frontend/src/app/(dashboard)/expenses/actions.ts` (updated)
- Types: `frontend/src/types/expenses.ts` (updated)
- Dialogs:
  - `frontend/src/components/expenses/AddExpenseDialog.tsx` (updated)
  - `frontend/src/components/expenses/EditExpenseDialog.tsx` (updated)

**Business Rule (CRITICAL):**
- Main category still required: Advertising, COGS, Operating
- Subcategory is optional (nullable, free text)
- **Daily P&L formula UNCHANGED**: Revenue - Advertising - COGS - Operating
- Subcategory used for detailed reporting only, NOT for P&L calculation

**Usage Examples:**
- Advertising → Subcategory: "Facebook Ads", "Google Ads", "TikTok Ads"
- Operating → Subcategory: "Office Rent", "Utilities", "Salaries"
- COGS → Subcategory: "Product A", "Product B", "Packaging"

**CSV Export:**
- Added "Subcategory" column after "Category"
- Empty for expenses without subcategory

**See:** `EXPENSES_PAGE_SUBCATEGORY_TODO.md` for main page UI updates (filter + table column)

---

## 🚀 Future Enhancements (Not in Current MVP)

### Phase 7 - Advanced Features

### Phase 4 - Advanced Features
3. **Inventory Management**
   - Product master data
   - Stock tracking
   - Low stock alerts

4. **Payables/Receivables Tracking**
   - Supplier payment tracking
   - Customer payment status
   - Aging reports

5. **Tax Calculation & Reports**
   - VAT calculation
   - Withholding tax
   - Monthly/Quarterly reports

6. **CEO Commission Flow (TikTok)**
   - Personal income tracking
   - Director's Loan tracking
   - Separation of personal vs company funds

### Safe Extension Principles
- Current features are well-isolated
- Server actions pattern is established
- Business rules are documented
- No refactoring required for extensions
- All core CRUD + Export operations complete

---

## ⚠️ Critical Files - DO NOT MODIFY CASUALLY

These files contain critical business logic. Changes require careful review:

### Business Logic Files (⚠️ BUSINESS-CRITICAL)
1. **`frontend/src/lib/daily-pl.ts`** ⭐ CORE
   - Daily P&L formula implementation
   - Net Profit = Revenue - Advertising - COGS - Operating
   - Used by Daily P&L page (main business metric)
   - DO NOT CHANGE without approval

2. **`frontend/src/lib/cashflow.ts`** ⭐ CORE
   - Cashflow calculation (actual money in/out)
   - Cash In = Completed sales ONLY
   - Different from P&L (no pending sales)
   - DO NOT CHANGE without approval

3. **`frontend/src/app/(dashboard)/actions.ts`**
   - Dashboard stats calculation
   - Revenue/Expenses aggregation
   - Contains NaN safety guards
   - ⚠️ Timezone issue documented (see Known Issues)

4. **`frontend/src/app/(dashboard)/sales/actions.ts`**
   - Server-side total_amount calculation
   - Cancelled orders → total_amount = 0 rule
   - Auto order_id generation
   - Audit trail: source='manual', created_by

5. **`frontend/src/app/(dashboard)/expenses/actions.ts`**
   - Category validation (3 types only)
   - Expense creation logic
   - Audit trail: source='manual', created_by

6. **`frontend/src/app/(dashboard)/wallets/actions.ts`** ⭐ CORE
   - **STRICT validation of wallet business rules**
   - ADS wallet: SPEND must be IMPORTED only (blocks manual)
   - Validation: entry_type + direction + source combinations
   - Prevents editing/deleting IMPORTED entries
   - DO NOT MODIFY without understanding business rules

7. **`frontend/src/app/(dashboard)/wallets/performance-ads-import-actions.ts`** ⭐ CORE
   - **Performance Ads import logic (Product/Live)**
   - Daily breakdown (ad_daily_performance + wallet_ledger)
   - Template validation (must have sales metrics)
   - File deduplication (SHA256 hash)
   - Creates performance records + wallet SPEND (affects P&L)
   - DO NOT MODIFY without understanding P&L impact

8. **`frontend/src/app/(dashboard)/wallets/tiger-import-actions.ts`** ⭐ CORE
   - **Tiger Awareness Ads import logic**
   - Monthly aggregation (1 wallet entry per file)
   - Template validation (blocks files with sales metrics)
   - File deduplication (SHA256 hash)
   - Creates wallet SPEND ONLY (no P&L impact)
   - DO NOT MODIFY without understanding business separation

9. **`frontend/src/lib/wallet-balance.ts`** ⭐ CORE
   - Wallet balance calculation (opening, in, out, closing)
   - Breakdown by entry type (top-up, spend, refund, adjustment)
   - Used for wallet summary cards
   - DO NOT CHANGE without approval

10. **`frontend/src/app/(dashboard)/wallets/manual-mapping-actions.ts`** ⭐ NEW
    - Manual column mapping wizard server actions
    - Preset CRUD (load/save user presets)
    - Custom parsing with column mapping
    - Business rules validation (Tiger vs Product/Live)
    - Reuses existing import logic (no duplication)
    - DO NOT MODIFY without understanding preset system

11. **`frontend/src/lib/importers/tiktok-onhold.ts`** ⭐ CORE
    - **TikTok Onhold (Forecast) parser with timezone handling**
    - Manual worksheet range scanning (bypasses !ref truncation)
    - Handles "Delivered + N days" format with fallback chain
    - Always returns Date (never null) - TARGET: 0% NULL estimated_settle_time
    - In-file deduplication by txn_id
    - Bulk upsert: 3 queries (not 1400+)
    - DO NOT MODIFY without understanding Excel parsing edge cases

12. **`frontend/src/lib/importers/tiktok-income.ts`** ⭐ CORE
    - **TikTok Income (Actual) parser**
    - Settlement transactions import
    - Links to reconciliation logic
    - Bulk upsert optimization
    - DO NOT MODIFY without understanding reconciliation flow

13. **`frontend/src/lib/reconcile/settlement-reconcile.ts`** ⭐ CORE
    - **Bulk reconciliation engine (3 queries, not 401)**
    - Matches settlement with unsettled by txn_id
    - In-memory Map lookup for fast matching
    - Marks matched forecast as 'settled'
    - Critical for cashflow accuracy
    - DO NOT MODIFY without understanding performance implications

14. **`frontend/src/app/(dashboard)/cashflow/cashflow-api-actions.ts`** ⭐ CORE
    - **Cashflow API actions using pre-aggregated table**
    - Queries `cashflow_daily_summary` ONLY (no raw table joins)
    - Daily summary with pagination
    - Transaction fetching (lazy loaded)
    - DO NOT MODIFY without understanding performance requirements

15. **`frontend/src/app/(dashboard)/company-cashflow/actions.ts`** ⭐ NEW (Phase 7)
    - **Company cashflow calculations (Task A)**
    - Cash In: settlement_transactions
    - Cash Out: expenses + wallet_ledger TOP_UP
    - Daily aggregation with running balance
    - CSV export with Bangkok timezone
    - DO NOT MODIFY without understanding liquidity vs accrual difference

16. **`frontend/src/app/(dashboard)/reconciliation/actions.ts`** ⭐ NEW (Phase 7)
    - **P&L vs Cashflow reconciliation logic (Task B)**
    - Bridge items calculation (revenue not settled, wallet top-ups, ad timing)
    - Verification formula: Accrual Net + Bridge = Cashflow Net
    - Integrates daily-pl.ts and company-cashflow actions
    - DO NOT MODIFY without understanding bridge items concept

17. **`frontend/src/app/(dashboard)/expenses/template-actions.ts`** ⭐ NEW (Phase 7)
    - **Expense template download and import (Task C)**
    - Generates .xlsx template with 2 sheets (template + instructions)
    - Import validation (category, amount, date format)
    - File hash deduplication via import_batches
    - Note: Import UI uses Phase 6 infrastructure (expenses-import-actions.ts)
    - DO NOT MODIFY without understanding template structure

18. **`frontend/src/app/(dashboard)/expenses/actions.ts`** (UPDATED Phase 7)
    - Category validation (3 types only)
    - Expense creation logic
    - **NEW:** Audit trail logging for CREATE/UPDATE/DELETE
    - Calls create_expense_audit_log RPC function
    - DO NOT MODIFY without understanding audit requirements

### Database Schema Files
- Supabase migrations (especially `migration-005-wallets.sql`, `migration-006-column-mappings.sql`, `migration-010-cashflow-performance.sql`, `migration-013-expense-audit-logs.sql`)
- RLS policies (wallet access control, preset access control, cashflow summary access, expense audit logs access)
- Database functions: `rebuild_cashflow_daily_summary(user_id, start_date, end_date)`, `create_expense_audit_log(...)`

### What CAN be modified safely:
- UI components (pages, dialogs, cards)
- Styling (Tailwind classes)
- Filter/search logic (UI level)
- New features that don't touch existing calculations

---

## ⚠️ Known Issues & Technical Debt

### 🟢 RESOLVED - Timezone Handling
**Status:** ✅ FIXED (Phase 2B - 2026-01-23)
- Implemented `frontend/src/lib/bangkok-time.ts` utility
- All date operations now use Asia/Bangkok timezone consistently
- Export filenames include Bangkok timezone timestamp
- No more timezone-related bugs

**Solution:**
- Centralized timezone utilities using `date-fns-tz`
- All new code uses `getBangkokNow()`, `formatBangkok()`, etc.
- Export actions properly handle date filtering with Bangkok timezone

---

### 🟡 MEDIUM PRIORITY - CEO Commission Flow
**Issue:**
- TikTok commission tracking not implemented
- Cannot separate Personal Income vs Director's Loan

**Impact:**
- Cannot track true company revenue from TikTok
- Director's loan balance unknown

**Status:**
- Not in MVP scope
- Defer to Phase 6+

---

### 🟢 RESOLVED - Cashflow Performance
**Status:** ✅ FIXED (Phase 2B - 2026-01-25)
- Pre-aggregated daily summary table (`cashflow_daily_summary`)
- Bulk reconciliation (3 queries instead of 401)
- Timezone-aware composite indexes
- Page load: < 300ms (was slow on large datasets)
- Import reconciliation: < 3s (was 196s)

**Solution:**
- Created `cashflow_daily_summary` table with `rebuild_cashflow_daily_summary()` function
- Optimized reconciliation: fetch all → match in-memory → bulk update
- Added composite indexes: `idx_settlement_transactions_user_marketplace_time`, `idx_unsettled_transactions_user_marketplace_time`
- Lazy loading: transactions fetch only on tab click

---

### 🟢 RESOLVED - TikTok Import Issues
**Status:** ✅ FIXED (Phase 2B - 2026-01-25)
- estimated_settle_time NULL: 37.2% → 0%
- Worksheet truncation: Manual range scanning bypasses !ref limit
- Income import slow: 196s → < 3s (bulk reconciliation)
- Timezone bucketing: UTC 17:00 → correct Thai date

**Solution:**
- TikTok Onhold parser: Always returns Date (fallback chain with "Delivered + N days" handling)
- Bulk upsert: 3 queries instead of 1400+
- In-file deduplication by txn_id
- Timezone-aware date casting: `AT TIME ZONE 'Asia/Bangkok'`

---

### 🟢 LOW PRIORITY - Caching Layer
**Issue:**
- No Redis or in-memory caching
- All queries hit database directly

**Impact:**
- Acceptable for current scale (< 5 users)
- Pre-aggregated tables serve as implicit cache

**Status:**
- Not needed for MVP
- Add Redis cache if user base grows beyond 50 users

---

## 📝 Documentation Files

Read these for context before making changes:

1. **`BUSINESS_RULES_AUDIT.md`**
   - Business logic verification
   - Implementation details
   - Risk assessment
   - Created: Phase 3 (Autonomous Session 1)

2. **`QA_CHECKLIST.md`**
   - QA results for baseline features
   - Regression risk assessment
   - Security check
   - Created: Phase 4 (Autonomous Session 1)

3. **`MVP_QA_VALIDATION.md`** ⭐ NEW
   - Full MVP validation checklist
   - Manual test scenarios for P&L & Cashflow
   - Edge cases and safety verification
   - Created: Phase E (MVP Completion)

4. **`WALLET_BUSINESS_RULES.md`** ⭐ CRITICAL
   - **WHY 2 views: Accrual P&L vs Cashflow Summary**
   - **ADS Wallet rules: Top-up ≠ Expense, Spend = Report ONLY**
   - Common mistakes prevented by system
   - Validation matrix for all wallet types
   - Created: Phase 3 (Multi-Wallet Foundation)

5. **`WALLET_VERIFICATION.md`**
   - Manual test checklist for wallet system
   - Business rules verification
   - Edge cases and error scenarios
   - Created: Phase 3 (Multi-Wallet Foundation)

6. **`PERFORMANCE_ADS_VERIFICATION.md`** ⭐ NEW
   - Manual test checklist for Performance Ads import
   - Validation tests (Product/Live templates)
   - Daily breakdown verification
   - P&L impact tests
   - Created: Phase 4 (Performance Ads Import)

7. **`~/.claude/plans/staged-stirring-mist.md`** ⭐ NEW
   - Full implementation plan for Manual Column Mapping Wizard
   - Architecture decisions and trade-offs
   - Component hierarchy and data flow
   - Database schema design
   - Validation checkpoints and business rules matrix
   - Edge case handling strategies
   - Created: Phase 5 (Manual Mapping Wizard)

8. **`database-scripts/verify-cashflow-timezone-fix.sql`** ⭐ NEW
   - SQL verification script for cashflow timezone fixes
   - Checks: NULL estimated_settle_time count (must be 0%)
   - Verifies: Timezone bucketing (UTC 17:00 → Thai date correct)
   - Tests: Daily summary has correct dates
   - Performance: Index usage verification
   - Created: Phase 2B (Cashflow Performance Optimization)

9. **`MANUAL_QA_CHECKLIST_TASKS_ABCD.md`** ⭐ NEW
   - Comprehensive manual QA checklist for Tasks A, B, C, D
   - Test scenarios for all 4 tasks (60+ test cases)
   - Integration tests (cross-feature validation)
   - Security & data integrity tests
   - Performance benchmarks
   - Regression tests
   - Edge cases & error handling
   - Acceptance criteria verification
   - Created: Phase 7 (Tasks A, B, C, D Completion)

10. **`CLAUDE.md`** (this file)
    - Project rules and guidelines
    - Current system state
    - Extension guide
    - Updated: 2026-01-25 (Phase 7: Tasks A, B, C, D - Company Cashflow + Reconciliation + Expenses Template + Unified Date Picker)

---

## 🎯 What to Do When Stuck

### Before Making Changes:
1. Check if it affects business logic (see Critical Files above)
2. Review BUSINESS_RULES_AUDIT.md for context
3. If timezone-related → acknowledge Known Issues
4. If requires new dependencies → ask first

### When Adding Features:
1. Follow existing patterns (see completed features)
2. Server-side calculations only
3. Add both client + server validation
4. Include NaN safety guards
5. Test with empty data (should return 0)
6. Update this file when done

### Emergency Contacts:
- Business rules questions → See BUSINESS_RULES_AUDIT.md
- QA/Testing → See QA_CHECKLIST.md
- Architecture questions → STOP and ask
