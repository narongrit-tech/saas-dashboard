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

# Current System State (Updated: 2026-01-23)

## ✅ Completed Features

### Sales Orders (COMPLETE - MVP Core Feature)
- ✅ View: Paginated list with filters (marketplace, date range, search)
- ✅ Add: Manual order entry with validation
- ✅ Edit: Update existing orders with server-side validation
- ✅ Delete: Hard delete with confirmation dialog
- ✅ Export: CSV export respecting all filters (Asia/Bangkok timezone)

**Location:**
- Page: `frontend/src/app/(dashboard)/sales/page.tsx`
- Actions: `frontend/src/app/(dashboard)/sales/actions.ts`
- Components:
  - `frontend/src/components/sales/AddOrderDialog.tsx`
  - `frontend/src/components/sales/EditOrderDialog.tsx`
  - `frontend/src/components/shared/DeleteConfirmDialog.tsx`

**CSV Export:**
- Filename format: `sales-orders-YYYYMMDD-HHmmss.csv`
- Headers: Order ID, Marketplace, Product Name, Quantity, Unit Price, Total Amount, Status, Order Date, Created At
- Server-side generation, respects filters (marketplace, date range, search)

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

### Cashflow View (COMPLETE - MVP Core Feature)
- ✅ Daily cashflow calculation (cash in/out)
- ✅ Date range view with running balance
- ✅ Shows actual money movement (not accounting profit)
- ✅ Thai formatting

**Location:**
- Utilities: `frontend/src/lib/cashflow.ts`
- Page: `frontend/src/app/(dashboard)/cashflow/page.tsx`
- Actions: `frontend/src/app/(dashboard)/cashflow/actions.ts`

**Business Logic:**
- Cash In = Completed sales ONLY (actual money received)
- Cash Out = All expenses (actual money spent)
- Net Change = Cash In - Cash Out
- Running Balance = Cumulative sum (simple version, no bank API)

### Multi-Wallet System (COMPLETE - Phase 3)
- ✅ 2 wallets: TikTok Ads, Foreign Subscriptions
- ✅ Future-proof design (scalable to more wallets)
- ✅ Wallet ledger with CRUD operations
- ✅ Balance calculation (opening, in, out, closing)
- ✅ CSV export with filters
- ✅ **STRICT business rules enforcement**

**Location:**
- Page: `frontend/src/app/(dashboard)/wallets/page.tsx`
- Actions: `frontend/src/app/(dashboard)/wallets/actions.ts`
- Balance Utility: `frontend/src/lib/wallet-balance.ts`
- Types: `frontend/src/types/wallets.ts`
- Components:
  - `frontend/src/components/wallets/AddLedgerDialog.tsx`
  - `frontend/src/components/wallets/EditLedgerDialog.tsx`
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

## 🚀 Future Enhancements (Not in Current MVP)

### Phase 3 - Data Import & Automation
1. **CSV Import for Sales Orders**
   - Upload component with drag-and-drop
   - Server-side parsing and validation
   - Reuse existing `createManualOrder()` logic
   - Duplicate detection

2. **CSV Import for Expenses**
   - Upload component
   - Server-side parsing and validation
   - Reuse existing `createManualExpense()` logic

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

7. **`frontend/src/lib/wallet-balance.ts`** ⭐ CORE
   - Wallet balance calculation (opening, in, out, closing)
   - Breakdown by entry type (top-up, spend, refund, adjustment)
   - Used for wallet summary cards
   - DO NOT CHANGE without approval

### Database Schema Files
- Supabase migrations (especially `migration-005-wallets.sql`)
- RLS policies (wallet access control)

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

### 🟢 LOW PRIORITY - Performance
**Issue:**
- No query optimization for large datasets
- No caching layer

**Impact:**
- May slow down with thousands of records

**Status:**
- Acceptable for MVP (<5 users)
- Add Redis cache or query optimization later if needed

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

6. **`CLAUDE.md`** (this file)
   - Project rules and guidelines
   - Current system state
   - Extension guide
   - Updated: 2026-01-23 (Phase 3: Multi-Wallet Complete)

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
