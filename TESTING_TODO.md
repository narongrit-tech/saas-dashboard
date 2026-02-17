# Testing TODO List

> สร้างวันที่: 2026-02-17
> สถานะ: รอทดสอบทั้งหมด

---

## 🔧 Pre-Testing Setup

### 1. Database Migration
```bash
# เชื่อมต่อ Supabase DB แล้ว run migration:
psql <your-supabase-connection> -f database-scripts/migration-019-cash-in-classification.sql

# ตรวจสอบว่า columns ถูกสร้างแล้ว:
SELECT cash_in_type, cash_in_ref_type, cash_in_ref_id, classified_at, classified_by
FROM bank_transactions
LIMIT 5;
```

### 2. Start Dev Server
```bash
cd frontend
npm run dev
# เปิด browser: http://localhost:3000
```

---

## ✅ Feature 1: Expenses Bulk Select + Delete

**Files Changed:**
- `frontend/src/app/(dashboard)/expenses/actions.ts` (NEW functions)
- `frontend/src/app/(dashboard)/expenses/page.tsx` (UPDATED)
- `frontend/src/components/expenses/BulkDeleteConfirmDialog.tsx` (NEW)

**Commit:** `a6f85de - feat(expenses): bulk select + delete selected`

### Test Cases:

#### 1.1 Basic Selection & Delete
- [ ] Go to `/expenses`
- [ ] Select 2-3 rows using checkboxes
- [ ] Verify bulk actions bar appears showing count
- [ ] Click "Delete Selected"
- [ ] Verify dialog shows correct count and sum
- [ ] Type "DELETE 3" (matching count)
- [ ] Click "Confirm"
- [ ] Verify rows deleted and table refreshed
- [ ] Verify summary cards updated

#### 1.2 Select All on Page
- [ ] Click header checkbox
- [ ] Verify all visible rows selected
- [ ] Verify selection banner appears: "Selected X on this page. Select all Y matching rows"
- [ ] Verify bulk actions bar shows count

#### 1.3 Select All Matching (Filtered Mode)
- [ ] Set filters (e.g., category=COGS, date range=last 7 days)
- [ ] Click header checkbox
- [ ] Click "Select all Y matching rows" in banner
- [ ] Verify bulk actions bar shows "Selected all matching"
- [ ] Click "Delete Selected"
- [ ] Verify dialog shows total matching count
- [ ] Confirm deletion
- [ ] Verify ALL matching filtered rows deleted (not just current page)

#### 1.4 Pagination Behavior
- [ ] Select rows on page 1
- [ ] Navigate to page 2
- [ ] Verify selection banner/actions bar still shows
- [ ] Navigate back to page 1
- [ ] Verify checkboxes still checked

#### 1.5 Clear Selection
- [ ] Select some rows
- [ ] Click "Clear Selection" in bulk actions bar
- [ ] Verify all checkboxes unchecked
- [ ] Verify banner/actions bar hidden

#### 1.6 Cancel Confirmation
- [ ] Select rows, click Delete Selected
- [ ] In dialog, click "Cancel"
- [ ] Verify dialog closes
- [ ] Verify rows still selected
- [ ] Verify no deletion occurred

#### 1.7 RLS Verification
- [ ] Login as User A
- [ ] Create 3 test expenses
- [ ] Logout → Login as User B
- [ ] Go to Expenses
- [ ] Verify cannot see User A's expenses (RLS blocks at query level)

#### 1.8 Audit Logs Verification
- [ ] Delete 3 expenses via bulk delete
- [ ] Check database:
  ```sql
  SELECT * FROM expense_audit_logs
  WHERE action='delete'
  ORDER BY performed_at DESC
  LIMIT 3;
  ```
- [ ] Verify 3 audit log entries created with old_value snapshots

---

## ✅ Feature 2: Bank Cash In Classification

**Files Changed:**
- `database-scripts/migration-019-cash-in-classification.sql` (NEW)
- `frontend/src/app/(dashboard)/bank/cash-in-actions.ts` (NEW)
- `frontend/src/types/bank.ts` (UPDATED)
- `frontend/src/components/bank/CashInClassification.tsx` (NEW)
- `frontend/src/components/bank/CashInTypeDialog.tsx` (NEW)
- `frontend/src/components/bank/BankModuleClient.tsx` (UPDATED tabs)

**Commit:** `f14bd35 - feat(bank): add cash-in classification system`

### Test Cases:

#### 2.1 Access Cash In Classification Tab
- [ ] Go to `/bank`
- [ ] Verify "Cash In Classification" tab exists
- [ ] Click tab → verify table loads
- [ ] Verify shows only transactions with amount > 0
- [ ] Verify default filter: unclassified only

#### 2.2 Filters
- [ ] Test date range filter
- [ ] Test bank account dropdown filter
- [ ] Test search by description
- [ ] Toggle "แสดงรายการที่จัดประเภทแล้ว" → verify classified rows appear
- [ ] Verify pagination works with filters

#### 2.3 Basic Classification (By IDs)
- [ ] Select 2-3 unclassified transactions
- [ ] Click "กำหนดประเภท"
- [ ] Select type: "DIRECTOR_LOAN"
- [ ] Click "Apply"
- [ ] Verify confirmation modal appears
- [ ] Type "APPLY 3" (matching count)
- [ ] Confirm
- [ ] Verify rows disappear from unclassified list
- [ ] Toggle "แสดงรายการที่จัดประเภทแล้ว"
- [ ] Verify rows show with classification badge

#### 2.4 Select All Filtered Classification
- [ ] Apply date range filter (e.g., last 30 days)
- [ ] Select all on page
- [ ] Click "เลือกทั้งหมด X รายการที่ตรงเงื่อนไข"
- [ ] Set type: "SALES_SETTLEMENT"
- [ ] Type "APPLY X" (matching total)
- [ ] Confirm
- [ ] Verify all matching rows classified

#### 2.5 Note Validation
- [ ] Select transactions
- [ ] Set type "OTHER"
- [ ] Leave note empty → verify cannot submit
- [ ] Add note → verify can submit
- [ ] Confirm → verify classification applied with note

#### 2.6 Clear Classification
- [ ] Toggle "แสดงรายการที่จัดประเภทแล้ว"
- [ ] Select some classified rows
- [ ] Click "ล้างการจัดประเภท"
- [ ] Confirm
- [ ] Verify classification removed (rows back to unclassified)

#### 2.7 All Cash In Types
Test classification with each type:
- [ ] SALES_SETTLEMENT
- [ ] SALES_PAYOUT_ADJUSTMENT
- [ ] DIRECTOR_LOAN
- [ ] CAPITAL_INJECTION
- [ ] LOAN_PROCEEDS
- [ ] REFUND_IN
- [ ] VENDOR_REFUND
- [ ] TAX_REFUND
- [ ] INTERNAL_TRANSFER_IN
- [ ] WALLET_WITHDRAWAL
- [ ] REBATE_CASHBACK
- [ ] OTHER_INCOME (requires note)
- [ ] REVERSAL_CORRECTION_IN
- [ ] OTHER (requires note)

#### 2.8 RLS Verification
- [ ] Login as User A → classify some transactions
- [ ] Logout → Login as User B
- [ ] Go to Cash In Classification
- [ ] Verify cannot see User A's transactions

#### 2.9 Integration: Company Cashflow
- [ ] Classify some bank inflows
- [ ] Go to `/company-cashflow`
- [ ] Verify info note appears about classification
- [ ] (Future) Verify cash_in_type shown in breakdown

#### 2.10 Integration: Reconciliation
- [ ] Go to `/bank-reconciliation`
- [ ] Verify bank inflow rows
- [ ] (Future) Verify cash_in_type column/tooltip shown

---

## ✅ Feature 3: Sidebar Menu Restructure

**Files Changed:**
- `frontend/src/components/dashboard/sidebar.tsx` (COMPLETE REWRITE)

**Commit:** `ea06c8e - feat(nav): restructure sidebar with grouped dropdown menu`

### Test Cases:

#### 3.1 Default State
- [ ] Login → verify sidebar shows 5 groups:
  - 📊 Overview
  - 💰 Sales
  - 💳 Money
  - 📦 Operations
  - ⚙️ Settings
- [ ] Verify Overview, Sales, Money expanded by default
- [ ] Verify Operations, Settings collapsed by default

#### 3.2 Manual Toggle
- [ ] Click "Operations" header → verify expands
- [ ] Click "Operations" header again → verify collapses
- [ ] Verify chevron icon rotates (down = expanded, right = collapsed)

#### 3.3 Active Highlighting - Overview Group
- [ ] Go to `/` (Dashboard)
- [ ] Verify "Overview" group header highlighted
- [ ] Verify "Dashboard" link highlighted
- [ ] Go to `/daily-pl`
- [ ] Verify "Daily P&L" link highlighted

#### 3.4 Active Highlighting - Sales Group
- [ ] Go to `/sales`
- [ ] Verify "Sales" group highlighted
- [ ] Verify "Sales Orders" link highlighted
- [ ] Go to `/sales/affiliate`
- [ ] Verify "Affiliates" link highlighted
- [ ] Go to `/reports/affiliate`
- [ ] Verify "Affiliate Report" link highlighted

#### 3.5 Active Highlighting - Money Group
- [ ] Go to `/wallets`
- [ ] Verify "Money" group highlighted
- [ ] Verify "Marketplace Wallets" link highlighted
- [ ] Go to `/company-cashflow`
- [ ] Verify "Company Cashflow" link highlighted
- [ ] Go to `/bank`
- [ ] Verify "Bank" link highlighted
- [ ] Go to `/bank-reconciliation`
- [ ] Verify "Bank Reconciliation" link highlighted
- [ ] Go to `/reconciliation`
- [ ] Verify "P&L Reconciliation" link highlighted

#### 3.6 Active Highlighting - Operations Group
- [ ] Go to `/expenses`
- [ ] Verify "Operations" group auto-expands
- [ ] Verify "Operations" group highlighted
- [ ] Verify "Expenses" link highlighted
- [ ] Go to `/inventory`
- [ ] Verify "Inventory" link highlighted
- [ ] Go to `/payables`
- [ ] Verify "Payables" link highlighted

#### 3.7 Active Highlighting - Settings Group
- [ ] Go to `/settings`
- [ ] Verify "Settings" group auto-expands
- [ ] Verify "Settings" group highlighted
- [ ] Verify "Settings" link highlighted

#### 3.8 Navigation
- [ ] Click through all menu items
- [ ] Verify correct pages load
- [ ] Verify active highlights update correctly
- [ ] Verify no broken links

#### 3.9 No localStorage Usage
- [ ] Expand/collapse groups manually
- [ ] Refresh browser (F5)
- [ ] Verify groups reset to default state (no persistence)
- [ ] Check browser DevTools → Application → Local Storage
- [ ] Verify no sidebar state saved

---

## ✅ Feature 4: Import Cash In Classification Template

**Files Changed:**
- `frontend/src/app/(dashboard)/bank/cash-in-actions.ts` (UPDATED +601 lines)
- `frontend/src/components/bank/ImportCashInDialog.tsx` (NEW)
- `frontend/src/components/bank/CashInClassification.tsx` (UPDATED +60 lines)
- `frontend/src/types/bank.ts` (UPDATED +56 lines)

**Commit:** `4e4aa8f - feat(bank): import cash-in classification template`

### Test Cases:

#### 4.1 Download Template
- [ ] Go to Bank → Cash In Classification tab
- [ ] Click "Download Template" button
- [ ] Verify XLSX file downloads
- [ ] Open file → verify has 2 sheets:
  - "Template" sheet with headers + 2 sample rows
  - "Instructions" sheet with detailed guide
- [ ] Verify columns: bank_account, txn_datetime, amount, description, cash_in_type, bank_txn_id, note

#### 4.2 Prepare Test Import File
Create test CSV/XLSX with 10 rows:
- [ ] Row 1: Valid match (bank_txn_id present, unclassified) → expect MATCHED
- [ ] Row 2: Valid match (composite key, unclassified) → expect MATCHED
- [ ] Row 3: Valid match (composite key, unclassified) → expect MATCHED
- [ ] Row 4: Unmatched (wrong description) → expect UNMATCHED
- [ ] Row 5: Unmatched (wrong amount) → expect UNMATCHED
- [ ] Row 6: Invalid (cash_in_type = "INVALID_TYPE") → expect INVALID
- [ ] Row 7: Invalid (amount = 0) → expect INVALID
- [ ] Row 8: Invalid (amount = -100) → expect INVALID
- [ ] Row 9: Conflict (already classified, same type) → expect MATCHED (idempotent)
- [ ] Row 10: Conflict (already classified, different type) → expect CONFLICT

#### 4.3 Import Preview - Status Display
- [ ] Click "Import Classification" button
- [ ] Upload prepared test file
- [ ] Verify preview table shows all 10 rows
- [ ] Verify status icons:
  - Row 1-3: ✅ MATCHED (green)
  - Row 4-5: ❌ UNMATCHED (red) with reason
  - Row 6-8: ⚠️ INVALID (orange) with reason
  - Row 9: ✅ MATCHED (green, idempotent)
  - Row 10: 🔄 CONFLICT (yellow) with current vs new type

#### 4.4 Import Preview - Summary Stats
- [ ] Verify summary panel shows:
  - Total: 10
  - Matched: 4 (rows 1-3, 9)
  - Unmatched: 2 (rows 4-5)
  - Invalid: 3 (rows 6-8)
  - Conflicts: 1 (row 10)

#### 4.5 Import Preview - Details
- [ ] For UNMATCHED rows: verify reason shown (e.g., "No matching transaction found")
- [ ] For INVALID rows: verify specific error (e.g., "Invalid cash_in_type: INVALID_TYPE")
- [ ] For CONFLICT rows: verify shows current type vs new type

#### 4.6 Apply Import
- [ ] Verify "Confirm Import" button enabled (has matched rows)
- [ ] Click "Confirm Import"
- [ ] Verify loading state
- [ ] Verify success message: "4 transactions classified"
- [ ] Verify dialog closes
- [ ] Verify table refreshes
- [ ] Toggle "แสดงรายการที่จัดประเภทแล้ว"
- [ ] Verify Row 1-3, 9 now show classification badges

#### 4.7 Re-import (Idempotency)
- [ ] Import same file again
- [ ] Verify preview:
  - Row 1-3, 9: 🔄 CONFLICT (already classified, same type)
  - Others: same status as before
- [ ] Verify summary: 0 matched (all become conflicts)
- [ ] Verify "Confirm Import" button disabled (no matched rows)

#### 4.8 Note Validation
Create file with OTHER/OTHER_INCOME types:
- [ ] Row A: cash_in_type=OTHER, note empty → expect INVALID
- [ ] Row B: cash_in_type=OTHER_INCOME, note empty → expect INVALID
- [ ] Row C: cash_in_type=OTHER, note="Test note" → expect MATCHED
- [ ] Row D: cash_in_type=OTHER_INCOME, note="Test note" → expect MATCHED
- [ ] Import → verify preview shows correct validation
- [ ] Apply → verify classifications applied with notes

#### 4.9 Bank Account Validation
- [ ] Create file with non-existent bank_account
- [ ] Import → verify rows show UNMATCHED (no matching account)

#### 4.10 Amount Validation
- [ ] Create file with amount = 0 → expect INVALID
- [ ] Create file with amount = -100 → expect INVALID
- [ ] Create file with amount > 0 → expect MATCHED (if other conditions met)

#### 4.11 Datetime Format Validation
- [ ] Create file with txn_datetime = "2026-02-15 14:30:00" → expect MATCHED
- [ ] Create file with txn_datetime = "2026-02-15" (no time) → expect UNMATCHED or INVALID
- [ ] Create file with txn_datetime = "15/02/2026" (wrong format) → expect INVALID

#### 4.12 RLS Verification
- [ ] Login as User A
- [ ] Create test transactions
- [ ] Export transactions with bank_txn_id
- [ ] Logout → Login as User B
- [ ] Import User A's file
- [ ] Verify all rows show UNMATCHED (cannot see other user's data)

#### 4.13 CSV Format
- [ ] Test import with CSV file (not XLSX)
- [ ] Verify preview works
- [ ] Verify apply works

#### 4.14 XLSX Format
- [ ] Test import with XLSX file
- [ ] Verify preview works
- [ ] Verify apply works

#### 4.15 Missing Columns Validation
- [ ] Create file missing required column (e.g., no cash_in_type)
- [ ] Import → verify error message about missing column
- [ ] Verify preview not shown

#### 4.16 Extra Columns
- [ ] Create file with extra columns (e.g., "extra_col")
- [ ] Import → verify extra columns ignored
- [ ] Verify preview works normally

#### 4.17 Large File Performance
- [ ] Create file with 100+ rows
- [ ] Import → verify preview loads within reasonable time (<5s)
- [ ] Apply → verify bulk update completes within reasonable time (<10s)

#### 4.18 Empty File
- [ ] Upload empty CSV (headers only)
- [ ] Verify error message: "No data rows found"

#### 4.19 Matching by bank_txn_id (Primary)
- [ ] Create file with correct bank_txn_id → expect MATCHED
- [ ] Create file with wrong bank_txn_id → expect UNMATCHED

#### 4.20 Matching by Composite Key (Fallback)
- [ ] Create file WITHOUT bank_txn_id column
- [ ] Ensure bank_account + txn_datetime + amount + description match exactly
- [ ] Import → expect MATCHED (fallback matching works)

#### 4.21 Ambiguous Composite Match
- [ ] Create 2 transactions with same: bank_account, txn_datetime, amount, description
- [ ] Create import file matching both (without bank_txn_id)
- [ ] Import → verify row shows UNMATCHED (ambiguous)

---

## ✅ Feature 5: COGS Coverage Checker (Allocation Completeness Audit)

**Files Changed:**
- `frontend/src/app/(dashboard)/inventory/actions.ts` (UPDATED +296 lines)
- `frontend/src/components/inventory/COGSCoveragePanel.tsx` (NEW)
- `frontend/src/components/inventory/MovementsTab.tsx` (UPDATED +38 lines)
- `QA_COGS_COVERAGE_CHECKER.md` (NEW)

**Commit:** `343f000 - feat(inventory): add COGS coverage checker`

### Test Cases:

#### 5.1 Access Coverage Check Tab
- [ ] Go to `/inventory`
- [ ] Click "Movements" tab
- [ ] Verify "Coverage Check" tab exists and is default
- [ ] Verify date range filter shows (Start Date, End Date)
- [ ] Verify default date range is MTD (first day of month to today)

#### 5.2 Stats Cards Display
- [ ] Verify 7 stats cards shown:
  - Expected Lines (blue)
  - Allocated Lines (green)
  - Missing Lines (orange)
  - Coverage % (dynamic color)
  - Expected Qty (gray)
  - Allocated Qty (gray)
  - Duplicates (red if >0, gray if 0)
- [ ] Verify each card has icon, label, and value

#### 5.3 Coverage: 100% (Perfect Coverage)
Create scenario with all orders allocated:
- [ ] Set date range with known complete coverage
- [ ] Verify Coverage % = 100%
- [ ] Verify card shows green background
- [ ] Verify CheckCircle icon shown
- [ ] Verify message: "ทุก order ถูก allocate แล้ว"
- [ ] Verify Missing Lines = 0
- [ ] Verify missing allocations table hidden or shows "No missing allocations"

#### 5.4 Coverage: 90-99% (Near Complete)
Create scenario with 90-99% coverage:
- [ ] Set date range with 1-10% missing allocations
- [ ] Verify Coverage % between 90-99%
- [ ] Verify card shows yellow background
- [ ] Verify AlertCircle icon shown
- [ ] Verify message: "Coverage ใกล้สมบูรณ์แล้ว"
- [ ] Verify Missing Lines > 0
- [ ] Verify missing allocations table shown with correct rows

#### 5.5 Coverage: <90% (Low Coverage)
Create scenario with <90% coverage:
- [ ] Set date range with >10% missing allocations
- [ ] Verify Coverage % < 90%
- [ ] Verify card shows red background
- [ ] Verify AlertCircle icon shown
- [ ] Verify message: "Coverage ต่ำ - มี orders ที่ยังไม่ได้ allocate จำนวนมาก"
- [ ] Verify Missing Lines shows significant number
- [ ] Verify missing allocations table shows all missing rows

#### 5.6 Date Filter - Change Start Date
- [ ] Note initial stats values
- [ ] Change start date to earlier date (e.g., Feb 1, 2026)
- [ ] Verify stats update automatically (no manual refresh needed)
- [ ] Verify Coverage % recalculated
- [ ] Verify missing table updates (if applicable)

#### 5.7 Date Filter - Change End Date
- [ ] Note initial stats values
- [ ] Change end date to later date
- [ ] Verify stats update automatically
- [ ] Verify Coverage % recalculated
- [ ] Verify missing table updates

#### 5.8 Date Filter - Custom Range
- [ ] Set custom date range: Feb 1-7, 2026
- [ ] Verify stats show only orders in that range
- [ ] Change to: Feb 8-14, 2026
- [ ] Verify stats update to new range
- [ ] Verify missing table filters correctly

#### 5.9 Missing Allocations Table - Display
When missing allocations exist:
- [ ] Verify table has columns:
  - Order ID (link to order detail)
  - SKU
  - Qty
  - Shipped At (Bangkok time format)
  - Status
- [ ] Verify rows show correct data
- [ ] Verify shipped_at formatted as "YYYY-MM-DD HH:mm"

#### 5.10 Missing Allocations Table - Sorting
- [ ] Verify default sort: shipped_at DESC (newest first)
- [ ] Click "Shipped At" column header → verify sort toggles
- [ ] Click "Order ID" column header → verify sort by order_id
- [ ] Click "SKU" column header → verify sort by sku

#### 5.11 Missing Allocations Table - Empty State
When coverage = 100%:
- [ ] Verify table shows empty state message
- [ ] Verify message: "No missing allocations" or table hidden

#### 5.12 Missing Allocations Table - Scroll
When many missing rows (>20):
- [ ] Verify table has max height with scroll
- [ ] Scroll through list → verify smooth scrolling
- [ ] Verify all rows render correctly

#### 5.13 Export CSV - Basic
With missing allocations present:
- [ ] Click "Export CSV" button
- [ ] Verify button shows loading state: "กำลัง Export..."
- [ ] Verify CSV file downloads
- [ ] Verify filename format: `missing-cogs-allocations-YYYY-MM-DD-to-YYYY-MM-DD.csv`
- [ ] Open CSV → verify columns: order_id, sku, qty, shipped_at, order_status
- [ ] Verify data matches table

#### 5.14 Export CSV - Date Range Reflection
- [ ] Set date range: Feb 1-7, 2026
- [ ] Export CSV
- [ ] Verify filename includes correct dates: `missing-cogs-allocations-2026-02-01-to-2026-02-07.csv`
- [ ] Verify CSV data only includes orders in that range

#### 5.15 Export CSV - Empty Result
When coverage = 100%:
- [ ] Try to export CSV
- [ ] Verify button disabled OR downloads empty CSV with headers only
- [ ] If downloads, verify CSV has header row but no data rows

#### 5.16 Duplicate Detection - Zero Duplicates
Create scenario with no duplicate allocations:
- [ ] Verify Duplicates card shows 0
- [ ] Verify card has gray background (not red)
- [ ] Verify no warning message about duplicates

#### 5.17 Duplicate Detection - Has Duplicates
Create scenario with duplicate allocations (same order_id + sku with >1 sale allocation):
- [ ] Verify Duplicates card shows count > 0
- [ ] Verify card has red background
- [ ] Verify warning message shown (if implemented)
- [ ] Note: Duplicate details table not in scope (future enhancement)

#### 5.18 Expected vs Allocated Quantities
- [ ] Verify Expected Qty = sum of all order line quantities
- [ ] Verify Allocated Qty = sum of all allocation quantities
- [ ] If coverage < 100%: verify Expected Qty > Allocated Qty
- [ ] If coverage = 100%: verify Expected Qty = Allocated Qty

#### 5.19 Multi-SKU Orders
Create order with multiple SKUs:
- [ ] Create order: Order #123 with SKU-A (qty=2), SKU-B (qty=3)
- [ ] Ship order
- [ ] Allocate only SKU-A
- [ ] Go to Coverage Check
- [ ] Verify Expected Lines counts both SKUs (2 lines)
- [ ] Verify Allocated Lines counts only SKU-A (1 line)
- [ ] Verify Missing Lines = 1
- [ ] Verify missing table shows: Order #123, SKU-B, qty=3

#### 5.20 Cancelled Orders Exclusion
- [ ] Create order and ship it
- [ ] Cancel order (status_group = 'ยกเลิกแล้ว')
- [ ] Go to Coverage Check with date range including that order
- [ ] Verify cancelled order NOT included in Expected Lines
- [ ] Verify Coverage % calculation excludes cancelled orders

#### 5.21 Returns/Reversals Exclusion
- [ ] Create order, ship, allocate COGS
- [ ] Create return (is_reversal = true allocation)
- [ ] Go to Coverage Check
- [ ] Verify return allocation NOT counted in Allocated Lines
- [ ] Verify only forward allocations (is_reversal = false) counted

#### 5.22 RLS Verification - Multi-User
- [ ] Login as User A
- [ ] Create and ship 10 orders
- [ ] Allocate COGS for 5 orders
- [ ] Note Coverage = 50%
- [ ] Logout → Login as User B
- [ ] Go to Coverage Check with same date range
- [ ] Verify stats show ONLY User B's data (not User A's)
- [ ] Verify cannot see User A's missing allocations

#### 5.23 Performance - Small Dataset (<100 orders)
- [ ] Set date range with ~50-100 orders
- [ ] Go to Coverage Check tab
- [ ] Verify stats load within 2 seconds
- [ ] Verify missing table renders within 2 seconds

#### 5.24 Performance - Medium Dataset (100-500 orders)
- [ ] Set date range with ~200-500 orders
- [ ] Go to Coverage Check tab
- [ ] Verify stats load within 5 seconds
- [ ] Verify missing table renders within 5 seconds

#### 5.25 Performance - Large Dataset (>500 orders)
⚠️ May need optimization if slow:
- [ ] Set date range with >500 orders
- [ ] Go to Coverage Check tab
- [ ] Verify stats load within 10 seconds
- [ ] Verify missing table renders (may need pagination)
- [ ] Note: If >5000 orders, performance issues expected

#### 5.26 Refresh on Date Change
- [ ] Set initial date range
- [ ] Note stats values
- [ ] Change date range
- [ ] Verify stats automatically recalculate (no page refresh needed)
- [ ] Verify loading state shown during recalculation
- [ ] Verify smooth transition (no flicker)

#### 5.27 Link to Order Detail
- [ ] Go to missing allocations table
- [ ] Click Order ID link
- [ ] Verify navigates to order detail page: `/sales?orderId={order_id}` or similar
- [ ] Verify order detail page loads correctly
- [ ] Go back → verify Coverage Check tab preserves state

#### 5.28 Edge Case - No Orders in Date Range
- [ ] Set date range with no shipped orders (e.g., future date)
- [ ] Verify Expected Lines = 0
- [ ] Verify Allocated Lines = 0
- [ ] Verify Coverage % = N/A or 100% or 0%
- [ ] Verify missing table empty
- [ ] Verify no error shown

#### 5.29 Edge Case - All Orders Cancelled
- [ ] Set date range where all orders are cancelled
- [ ] Verify Expected Lines = 0 (cancelled excluded)
- [ ] Verify Allocated Lines = 0
- [ ] Verify Coverage % = N/A or 100%
- [ ] Verify missing table empty

#### 5.30 Edge Case - Allocated but No Expected (orphan allocations)
Rare case: allocations exist but no corresponding orders:
- [ ] Create allocation manually (if possible) without order
- [ ] Go to Coverage Check
- [ ] Verify Allocated Lines > Expected Lines (over-allocation)
- [ ] Verify Coverage % may show >100% or error
- [ ] Note: This should not happen in normal flow

#### 5.31 Integration - After Running COGS Calculation
- [ ] Go to Coverage Check → note missing count
- [ ] Run COGS calculation for missing orders (separate feature)
- [ ] Return to Coverage Check → click refresh or change date slightly
- [ ] Verify Missing Lines decreased
- [ ] Verify Coverage % increased
- [ ] Verify allocated orders removed from missing table

#### 5.32 Integration - Inventory Movements Page
- [ ] Verify Coverage Check tab coexists with other tabs:
  - Receipt Layers
  - COGS Allocations (existing)
- [ ] Click between tabs → verify each loads correctly
- [ ] Verify date filter persists across tabs (if shared)

#### 5.33 Visual Regression - Mobile/Responsive
- [ ] Resize browser to mobile width (~375px)
- [ ] Verify stats cards stack vertically
- [ ] Verify table scrolls horizontally if needed
- [ ] Verify Export CSV button accessible
- [ ] Verify date filters usable on small screen

#### 5.34 Accessibility - Keyboard Navigation
- [ ] Tab through coverage page elements
- [ ] Verify focus indicators visible
- [ ] Verify can change dates with keyboard
- [ ] Verify can trigger Export CSV with Enter/Space
- [ ] Verify table rows keyboard accessible

#### 5.35 Error Handling - Server Error
- [ ] Simulate server error (e.g., disconnect DB)
- [ ] Go to Coverage Check
- [ ] Verify graceful error message shown
- [ ] Verify no crash/blank screen
- [ ] Verify can retry after fixing issue

#### 5.36 Error Handling - Network Timeout
- [ ] Simulate slow network (Chrome DevTools throttling)
- [ ] Go to Coverage Check
- [ ] Verify loading state shown during fetch
- [ ] If timeout: verify error message
- [ ] Verify can retry

---

## ✅ Feature 6: Returns v1 with Barcode Search

**Files Changed:**
- `database-scripts/migration-055-returns-v1.sql` (NEW)
- `frontend/src/types/returns.ts` (NEW)
- `frontend/src/app/(dashboard)/returns/actions.ts` (NEW)
- `frontend/src/app/(dashboard)/returns/page.tsx` (NEW)
- `frontend/src/components/returns/ReturnDrawer.tsx` (NEW)
- `frontend/src/components/dashboard/sidebar.tsx` (UPDATED - added Returns menu)
- `docs/RETURNS_V1_IMPLEMENTATION.md` (NEW)

**Commit:** `??? - feat(returns): add returns system with barcode search`

**⚠️ Note:** MVP version - COGS reversal and stock movement NOT implemented yet (Phase 2)

### Test Cases:

#### 6.1 Access Returns Page
- [ ] Go to Sidebar → Operations group
- [ ] Verify "Returns" menu item exists (between Expenses and Inventory)
- [ ] Click "Returns"
- [ ] Verify navigates to `/returns`
- [ ] Verify page loads with large search input

#### 6.2 Search Input - Auto Focus
- [ ] Load `/returns` page
- [ ] Verify cursor automatically in search input (no click needed)
- [ ] Type something → clear → verify focus stays in input
- [ ] Refresh page → verify auto-focus again

#### 6.3 Search by Order ID
- [ ] Get external_order_id from database:
  ```sql
  SELECT external_order_id FROM sales_orders LIMIT 1;
  ```
- [ ] Type order ID in search
- [ ] Press Enter
- [ ] Verify search triggers
- [ ] If 1 result: verify drawer opens automatically
- [ ] If 0 results: verify message "ไม่พบ order ที่ค้นหา"

#### 6.4 Search by Tracking Number
- [ ] Get tracking_number from database:
  ```sql
  SELECT tracking_number FROM sales_orders WHERE tracking_number IS NOT NULL LIMIT 1;
  ```
- [ ] Type tracking number in search
- [ ] Press Enter
- [ ] Verify order found
- [ ] Verify drawer opens (if 1 result)

#### 6.5 Barcode Scanner Simulation
- [ ] Go to `/returns`
- [ ] Verify cursor in search input
- [ ] Quickly paste order ID + press Enter (simulate barcode scan)
- [ ] Verify search triggers immediately
- [ ] Verify drawer opens (if 1 result)

#### 6.6 Multiple Results Display
Create scenario with 2+ orders matching search:
- [ ] Search query that matches multiple orders
- [ ] Verify list of order cards displayed
- [ ] Each card shows: order ID, tracking, status, shipped date
- [ ] Click one card
- [ ] Verify drawer opens with that order's details

#### 6.7 Return Drawer - Display
When drawer opens:
- [ ] Verify shows order header:
  - Order ID
  - Tracking Number
  - Status
  - Shipped At
- [ ] Verify shows line items table with columns:
  - SKU
  - Qty Sold
  - Qty Returned (already)
  - Qty to Return (input)
  - Return Type (dropdown)
- [ ] Verify Note textarea (optional)
- [ ] Verify Cancel and Confirm buttons

#### 6.8 Return Type - RETURN_RECEIVED
- [ ] Search order
- [ ] Open drawer
- [ ] Enter qty=1 for a line item
- [ ] Select return type: "รับของคืนจริง (คืน stock + COGS)"
- [ ] Click "Confirm Return"
- [ ] Verify success toast
- [ ] Verify drawer closes
- [ ] Check database:
  ```sql
  SELECT * FROM inventory_returns WHERE return_type='RETURN_RECEIVED' ORDER BY created_at DESC LIMIT 1;
  ```
- [ ] Verify record created
- [ ] **Phase 2 TODO:** Verify stock increased
- [ ] **Phase 2 TODO:** Verify COGS reversed

#### 6.9 Return Type - REFUND_ONLY
- [ ] Search order
- [ ] Enter qty=1
- [ ] Select return type: "คืนเงินอย่างเดียว (ไม่มีสินค้าคืน)"
- [ ] Confirm
- [ ] Verify success toast
- [ ] Check database: verify return_type='REFUND_ONLY'
- [ ] Verify NO inventory movement created
- [ ] Verify NO COGS reversal

#### 6.10 Return Type - CANCEL_BEFORE_SHIP
- [ ] Find unshipped order (shipped_at IS NULL)
- [ ] Search order
- [ ] Enter qty=1
- [ ] Select return type: "ยกเลิกก่อนส่ง"
- [ ] Confirm
- [ ] Verify success toast
- [ ] Check database: verify return_type='CANCEL_BEFORE_SHIP'
- [ ] **Phase 2 TODO:** Verify COGS allocation reversed if exists

#### 6.11 Partial Return
- [ ] Search order with qty=5
- [ ] Return qty=2 with RETURN_RECEIVED
- [ ] Confirm
- [ ] Search same order again
- [ ] Verify drawer shows:
  - Qty Sold: 5
  - Qty Returned: 2
  - Available to return: 3
- [ ] Return qty=3 more
- [ ] Verify total returned = 5

#### 6.12 Validation - Qty Must Be Positive
- [ ] Open return drawer
- [ ] Enter qty=0
- [ ] Try to confirm
- [ ] Verify validation error: "Qty must be > 0"
- [ ] Cannot submit

#### 6.13 Validation - Over-Return Prevention
- [ ] Search order with qty=3
- [ ] Already returned qty=2
- [ ] Try to return qty=2 more (total would be 4 > 3)
- [ ] Verify validation error
- [ ] Cannot submit

#### 6.14 Validation - At Least One Line Item
- [ ] Open drawer with multiple line items
- [ ] Leave all qty=0
- [ ] Try to confirm
- [ ] Verify validation error: "Must select at least one item to return"
- [ ] Cannot submit

#### 6.15 Validation - Return Type Required
- [ ] Enter qty=1
- [ ] Leave return type unselected (if possible)
- [ ] Try to confirm
- [ ] Verify validation error: "Return type required"
- [ ] Cannot submit

#### 6.16 Multi-Line Return
- [ ] Search order with 3 different SKUs
- [ ] Return:
  - SKU-A: qty=1, RETURN_RECEIVED
  - SKU-B: qty=2, REFUND_ONLY
  - SKU-C: qty=0 (skip)
- [ ] Confirm
- [ ] Verify 2 records created in inventory_returns
- [ ] Verify SKU-C not returned

#### 6.17 Note Field
- [ ] Open drawer
- [ ] Enter qty=1
- [ ] Select return type
- [ ] Type note: "สินค้าชำรุด"
- [ ] Confirm
- [ ] Check database: verify note saved correctly

#### 6.18 Focus Management - After Submit
- [ ] Submit return successfully
- [ ] Drawer closes
- [ ] Verify focus returns to search input immediately
- [ ] Ready for next scan (no click needed)

#### 6.19 Focus Management - After Cancel
- [ ] Open drawer
- [ ] Click "Cancel" button
- [ ] Drawer closes
- [ ] Verify focus returns to search input

#### 6.20 Clear Search Button
- [ ] Type something in search
- [ ] Verify "X" clear button appears
- [ ] Click clear button
- [ ] Verify input cleared
- [ ] Verify focus stays in input

#### 6.21 Enter Key Submit
- [ ] Type order ID
- [ ] Press Enter (no click Search button)
- [ ] Verify search triggers

#### 6.22 Loading State - Search
- [ ] Type query
- [ ] Press Enter
- [ ] Verify loading indicator shown
- [ ] Wait for results
- [ ] Verify loading disappears

#### 6.23 Loading State - Submit Return
- [ ] Open drawer
- [ ] Enter return details
- [ ] Click "Confirm Return"
- [ ] Verify button shows loading state
- [ ] Wait for response
- [ ] Verify loading disappears

#### 6.24 RLS - Cannot Return Others' Orders
- [ ] Login as User A
- [ ] Create order A1
- [ ] Logout → Login as User B
- [ ] Search order A1 by order ID
- [ ] Verify order NOT found (RLS blocks)
- [ ] Verify message: "ไม่พบ order ที่ค้นหา"

#### 6.25 Empty Search
- [ ] Press Enter with empty search input
- [ ] Verify appropriate message or no action
- [ ] No error thrown

#### 6.26 Special Characters in Search
- [ ] Search with special characters: `!@#$%^&*()`
- [ ] Verify no crash
- [ ] Verify "ไม่พบ order" message

#### 6.27 Very Long Search Query
- [ ] Type very long string (>100 chars)
- [ ] Press Enter
- [ ] Verify no crash
- [ ] Verify handles gracefully

#### 6.28 Already Fully Returned Order
- [ ] Order with qty=5
- [ ] Return all 5 units across multiple returns
- [ ] Search order again
- [ ] Open drawer
- [ ] Verify qty_returned=5
- [ ] Verify available=0
- [ ] Try to return more → verify validation prevents

#### 6.29 Shipped vs Unshipped Orders
- [ ] Search unshipped order (shipped_at IS NULL)
- [ ] Verify can select CANCEL_BEFORE_SHIP
- [ ] Verify cannot select RETURN_RECEIVED (if validation exists)
- [ ] Search shipped order (shipped_at IS NOT NULL)
- [ ] Verify can select RETURN_RECEIVED

#### 6.30 Search Performance
- [ ] Search by order ID
- [ ] Measure response time
- [ ] Verify completes within 500ms (with indexes)

---

## ✅ Feature 7: Returns Tracking Search Bugfix

**Files Changed:**
- `frontend/src/lib/sales-parser.ts` (+3 lines)
- `frontend/src/app/(dashboard)/sales/sales-import-actions.ts` (+6 lines)
- `frontend/src/types/sales-import.ts` (+3 lines)
- `database-scripts/migration-056-fix-tracking-search.sql` (NEW - verification)
- `database-scripts/backfill-tracking-numbers.sql` (NEW)
- `docs/BUGFIX_RETURNS_TRACKING_SEARCH.md` (NEW)
- Supporting scripts: check-tracking.ts, backfill-tracking.ts, test-returns-search.ts

**Commit:** `fix(returns): enable tracking number search`

**Issue:** Tracking numbers not searchable (were stored in metadata only, not in tracking_number column)

**Fix:** Updated import logic to populate tracking_number column from "Tracking ID" field in import files

**Backfill:** 1,000 existing orders backfilled from metadata (33.4% coverage)

### Test Cases:

#### 7.1 Verify Backfill Complete
- [ ] Check database:
  ```sql
  SELECT COUNT(*) as total,
         COUNT(tracking_number) as with_tracking,
         ROUND(COUNT(tracking_number)::numeric / COUNT(*)::numeric * 100, 2) as percent
  FROM sales_orders;
  ```
- [ ] Verify ~33% or more have tracking_number
- [ ] Note: Older orders may not have tracking (expected)

#### 7.2 Search by Tracking - Exact Match
- [ ] Get tracking from DB: `SELECT tracking_number FROM sales_orders WHERE tracking_number IS NOT NULL LIMIT 1;`
- [ ] Copy tracking number (e.g., `791729249802`)
- [ ] Go to `/returns`
- [ ] Paste tracking number
- [ ] Press Enter
- [ ] **Expected:** Order found, drawer opens
- [ ] **Verify:** This is the PRIMARY test for the bugfix

#### 7.3 Search by Tracking - Case Insensitive
- [ ] Get tracking number
- [ ] Search in lowercase: `791729249802`
- [ ] Verify order found
- [ ] Search in uppercase: `791729249802` (if has letters)
- [ ] Verify order found (same result)

#### 7.4 Search by Tracking - Partial Match
- [ ] Get tracking: `791729249802`
- [ ] Search partial: `791729`
- [ ] Verify order found (ILIKE fallback)

#### 7.5 Search by Order ID Still Works (Regression)
- [ ] Get external_order_id from DB
- [ ] Search by order ID
- [ ] **Expected:** Order found (same as before bugfix)
- [ ] **Verify:** Bugfix didn't break existing functionality

#### 7.6 Import New Order with Tracking
- [ ] Prepare Excel/CSV with "Tracking ID" column
- [ ] Import file with 1 order
- [ ] Verify import succeeds
- [ ] Check database:
  ```sql
  SELECT tracking_number FROM sales_orders ORDER BY created_at DESC LIMIT 1;
  ```
- [ ] Verify tracking_number populated (not null)
- [ ] Search by that tracking in Returns page
- [ ] Verify order found

#### 7.7 Import Order WITHOUT Tracking
- [ ] Import file without "Tracking ID" column OR with empty value
- [ ] Verify import succeeds
- [ ] Check database: verify tracking_number IS NULL
- [ ] No error during import

#### 7.8 Backfill Script Idempotency
- [ ] Run backfill script again:
  ```bash
  npx tsx src/scripts/backfill-tracking.ts
  ```
- [ ] Verify no errors
- [ ] Verify count stays same (doesn't duplicate)
- [ ] Check database: verify tracking_number values unchanged

#### 7.9 Performance - Tracking Search
- [ ] Search by tracking number
- [ ] Measure response time
- [ ] **Expected:** <500ms (index on created_by, tracking_number)
- [ ] Verify no performance degradation

#### 7.10 Metadata Fallback (Backfill Logic)
Orders without tracking_number column but with metadata.tracking_id:
- [ ] Find such order in DB:
  ```sql
  SELECT id, tracking_number, metadata FROM sales_orders
  WHERE tracking_number IS NULL AND metadata->>'tracking_id' IS NOT NULL LIMIT 1;
  ```
- [ ] Run backfill script
- [ ] Verify tracking_number now populated from metadata
- [ ] Search by tracking → verify found

---

## 🔍 Cross-Feature Integration Tests

### INT-1: Expenses + Audit Logs
- [ ] Bulk delete expenses → verify audit logs created
- [ ] Query audit logs → verify old_value snapshots complete

### INT-2: Bank Classification + Company Cashflow
- [ ] Classify bank inflows with various types
- [ ] Go to Company Cashflow
- [ ] Verify inflows show classification info
- [ ] (Future) Verify can filter by cash_in_type

### INT-3: Bank Import + Classification
- [ ] Import classification template
- [ ] Verify classifications applied
- [ ] Go to Bank main tab → verify classified transactions show badges
- [ ] Go to Company Cashflow → verify integrated

### INT-4: Sidebar + All Pages
- [ ] Navigate through all pages using sidebar
- [ ] Verify active highlighting works everywhere
- [ ] Verify groups auto-expand correctly

### INT-5: COGS Coverage + Inventory Movements
- [ ] Run COGS calculation for some orders
- [ ] Go to Coverage Check → verify coverage increases
- [ ] Go to COGS Allocations tab → verify allocations listed
- [ ] Go back to Coverage Check → verify consistent data

### INT-6: COGS Coverage + Sales Orders
- [ ] Create and ship new orders
- [ ] Go to Coverage Check → verify Expected Lines increases
- [ ] Allocate COGS for new orders
- [ ] Return to Coverage Check → verify Allocated Lines increases

### INT-7: Returns + Sales Orders
- [ ] Create and ship order with qty=5
- [ ] Go to Returns → search order
- [ ] Return qty=2 with RETURN_RECEIVED
- [ ] Search same order again → verify qty_returned=2
- [ ] **Phase 2:** Verify stock increased by 2
- [ ] **Phase 2:** Verify COGS reversed in P&L

### INT-8: Returns + COGS Coverage (Phase 2)
- [ ] Create order, ship, allocate COGS
- [ ] COGS Coverage shows 100%
- [ ] Process return with RETURN_RECEIVED
- [ ] **Phase 2:** Verify COGS Coverage recalculates correctly (return reversal)
- [ ] **Phase 2:** Verify reversal entry shown in COGS Allocations tab

### INT-9: Import + Returns Tracking Search
- [ ] Import Excel with "Tracking ID" column
- [ ] Verify import succeeds
- [ ] Go to Returns page
- [ ] Search by imported tracking number
- [ ] Verify order found immediately

---

## 🛡️ Security & RLS Tests

### SEC-1: Multi-User Expenses
- [ ] User A creates expenses
- [ ] User B cannot see/delete User A's expenses
- [ ] Verify RLS blocks at query level

### SEC-2: Multi-User Bank Classification
- [ ] User A classifies transactions
- [ ] User B cannot see/modify User A's classifications
- [ ] Verify RLS blocks at query level

### SEC-3: Import RLS
- [ ] User A exports transactions
- [ ] User B imports User A's file
- [ ] Verify all rows UNMATCHED (RLS blocks)

### SEC-4: COGS Coverage RLS
- [ ] User A has 100 orders with 50% coverage
- [ ] User B has 50 orders with 100% coverage
- [ ] Login as User A → verify sees only A's stats
- [ ] Login as User B → verify sees only B's stats
- [ ] Verify no data leakage between users

### SEC-5: Returns RLS
- [ ] User A creates order A1
- [ ] User B creates order B1
- [ ] Login as User A → search order A1 → can return ✓
- [ ] Login as User A → search order B1 → not found (RLS blocks) ✓
- [ ] Login as User B → search order B1 → can return ✓
- [ ] Login as User B → search order A1 → not found (RLS blocks) ✓
- [ ] Verify inventory_returns table RLS policies work

---

## 📊 Performance Tests

### PERF-1: Expenses Bulk Delete (Large Set)
- [ ] Create 100 test expenses
- [ ] Select all filtered → delete
- [ ] Verify completes within 10 seconds
- [ ] Verify audit logs created (100 entries)

### PERF-2: Bank Classification (Large Set)
- [ ] Create 200 unclassified bank inflows
- [ ] Select all filtered → classify
- [ ] Verify completes within 10 seconds

### PERF-3: Import Large File
- [ ] Import 500-row CSV
- [ ] Verify preview loads within 10 seconds
- [ ] Apply → verify completes within 30 seconds

### PERF-4: Sidebar Render
- [ ] Navigate between pages rapidly
- [ ] Verify no lag/flicker
- [ ] Verify smooth expand/collapse animations

### PERF-5: COGS Coverage (Large Dataset)
- [ ] Set date range with 1000+ orders
- [ ] Go to Coverage Check
- [ ] Verify stats load within 10 seconds
- [ ] Verify missing table renders within 10 seconds
- [ ] Export CSV → verify completes within 30 seconds

### PERF-6: Returns Search (With Indexes)
- [ ] Search by order ID → verify <500ms
- [ ] Search by tracking number → verify <500ms
- [ ] Search by partial match → verify <1s
- [ ] Database has 10,000+ orders
- [ ] Verify indexes on (created_by, external_order_id) and (created_by, tracking_number) exist

### PERF-7: Returns Submit
- [ ] Submit return with 1 line item → verify <1s
- [ ] Submit return with 10 line items → verify <2s
- [ ] No per-row loops (bulk insert if possible)

---

## 🐛 Edge Cases & Error Handling

### EDGE-1: Bulk Delete Empty Selection
- [ ] Try to delete without selecting rows
- [ ] Verify appropriate message/disabled button

### EDGE-2: Classification Empty Selection
- [ ] Try to classify without selecting rows
- [ ] Verify appropriate message/disabled button

### EDGE-3: Import Invalid File Type
- [ ] Try to upload PDF/image file
- [ ] Verify error message about file type

### EDGE-4: Import Corrupted XLSX
- [ ] Upload corrupted/invalid XLSX
- [ ] Verify graceful error handling

### EDGE-5: Network Error During Bulk Operation
- [ ] Simulate network failure (DevTools offline mode)
- [ ] Try bulk delete/classify
- [ ] Verify error message shown
- [ ] Verify no partial updates (transaction safety)

### EDGE-6: Concurrent Updates
- [ ] User A starts classifying transaction
- [ ] User B classifies same transaction before A confirms
- [ ] User A confirms → verify conflict detection

---

## 📱 Browser Compatibility Tests

### BROWSER-1: Chrome
- [ ] Test all features in Chrome
- [ ] Verify sidebar animations work
- [ ] Verify file upload/download works

### BROWSER-2: Firefox
- [ ] Test all features in Firefox
- [ ] Verify sidebar animations work
- [ ] Verify file upload/download works

### BROWSER-3: Safari (if available)
- [ ] Test all features in Safari
- [ ] Verify sidebar animations work
- [ ] Verify file upload/download works

### BROWSER-4: Edge
- [ ] Test all features in Edge
- [ ] Verify sidebar animations work
- [ ] Verify file upload/download works

---

## 📝 Documentation Tests

### DOC-1: Commit Messages
- [ ] Verify all commits have clear messages
- [ ] Verify test plans included in commit bodies

### DOC-2: Code Comments
- [ ] Review new code for clarity
- [ ] Verify complex logic has comments

### DOC-3: Type Safety
- [ ] Verify no TypeScript errors
- [ ] Verify proper type definitions used

---

## 🎯 Acceptance Criteria Checklist

### Expenses Bulk Delete:
- [x] Can select rows with checkboxes
- [x] Can select all on page
- [x] Can select all matching filtered results
- [x] Delete confirmation requires typing "DELETE {N}"
- [x] Bulk delete uses single query (no loops)
- [x] Audit logs created for all deleted rows
- [x] RLS enforced (user's own data only)
- [ ] **All test cases passed**

### Bank Cash In Classification:
- [x] Cash In Classification tab exists
- [x] Shows only amount > 0 transactions
- [x] 14 classification types supported
- [x] Bulk select + apply type works
- [x] Note required for OTHER/OTHER_INCOME
- [x] Can clear classification
- [x] RLS enforced
- [ ] **All test cases passed**

### Sidebar Restructure:
- [x] 5 groups created (Overview, Sales, Money, Operations, Settings)
- [x] Groups collapsible/expandable
- [x] Active route auto-expands parent group
- [x] Active highlighting works
- [x] No localStorage usage
- [ ] **All test cases passed**

### Import Cash In Classification:
- [x] Download template generates XLSX with instructions
- [x] Import shows preview with 4 status types
- [x] Validation works (amount, cash_in_type, note)
- [x] Matching logic works (primary + fallback)
- [x] Conflict detection works
- [x] Bulk apply updates classifications
- [x] RLS enforced
- [x] Idempotent (re-import safe)
- [ ] **All test cases passed**

### COGS Coverage Checker:
- [x] Coverage Check tab added to Inventory > Movements
- [x] Shows 7 stats cards (Expected, Allocated, Missing, Coverage %, Qty, Duplicates)
- [x] Visual indicators (green/yellow/red) based on coverage %
- [x] Missing allocations table with sortable columns
- [x] Export CSV works (server-side generation)
- [x] Duplicate detection works
- [x] Date filter integration (MTD default)
- [x] RLS enforced (user sees own data only)
- [x] Auto-refresh when date changes
- [x] Read-only feature (no schema changes)
- [ ] **All test cases passed**

### Returns v1 with Barcode Search:
- [x] Returns page created at /returns
- [x] Added to Operations menu in sidebar
- [x] Large search input with auto-focus (barcode compatible)
- [x] Search by order ID or tracking number
- [x] Auto-open drawer if 1 result found
- [x] Show list if multiple results
- [x] Return drawer with line items table
- [x] 3 return types: RETURN_RECEIVED, REFUND_ONLY, CANCEL_BEFORE_SHIP
- [x] Validation: prevent over-return, require positive qty
- [x] RLS enforced (user's own orders only)
- [x] Focus management (auto-refocus after submit)
- [x] inventory_returns table created with RLS
- [ ] ⚠️ **Known Limitation:** COGS reversal not implemented (Phase 2)
- [ ] ⚠️ **Known Limitation:** Stock movement not implemented (Phase 2)
- [ ] **All test cases passed**

### Returns Tracking Search Bugfix:
- [x] Import logic updated to populate tracking_number column
- [x] Parser extracts "Tracking ID" from import files
- [x] Backfill completed: 1,000 orders (33.4% coverage)
- [x] Search by tracking number works
- [x] Case-insensitive and partial match supported
- [x] Indexes created for performance
- [x] Regression test passed (order ID search still works)
- [ ] **All test cases passed**

---

## 🚀 Pre-Production Checklist

Before deploying to production:
- [ ] All test cases passed
- [ ] Database migration applied successfully
- [ ] Build passes with no errors
- [ ] No TypeScript errors
- [ ] No lint errors/warnings (or documented)
- [ ] RLS policies verified on production DB
- [ ] Performance acceptable with production data volume
- [ ] Backup database before migration
- [ ] Monitor logs after deployment
- [ ] Test on production-like staging environment first

---

## 📋 Notes Section

**Issues Found:**
_(Record any bugs/issues discovered during testing)_

**Performance Observations:**
_(Record any performance concerns)_

**UX Feedback:**
_(Record any UX improvements needed)_

**Future Enhancements:**
_(Ideas for future improvements)_

---

**Last Updated:** 2026-02-17
- Feature 5: COGS Coverage Checker (36 test cases)
- Feature 6: Returns v1 with Barcode Search (30 test cases)
- Feature 7: Returns Tracking Search Bugfix (10 test cases)

**Status:** Ready for testing
**Total Features:** 7
**Total Test Cases:** ~240
**Tester:** _______________
**Date Started:** _______________
**Date Completed:** _______________
