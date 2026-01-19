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

# Current System State (Updated: 2026-01-19)

## ✅ Completed Features

### Sales Orders (Partial MVP)
- ✅ View: Paginated list with filters (marketplace, date range, search)
- ✅ Add: Manual order entry with validation
- ❌ Edit: NOT YET IMPLEMENTED
- ❌ Delete: NOT YET IMPLEMENTED
- ❌ Export: NOT YET IMPLEMENTED

**Location:**
- Page: `frontend/src/app/(dashboard)/sales/page.tsx`
- Actions: `frontend/src/app/(dashboard)/sales/actions.ts`
- Component: `frontend/src/components/sales/AddOrderDialog.tsx`

### Expenses (Partial MVP)
- ✅ View: Paginated list with filters (category, date range, search)
- ✅ Add: Manual expense entry with category validation
- ❌ Edit: NOT YET IMPLEMENTED
- ❌ Delete: NOT YET IMPLEMENTED
- ❌ Export: NOT YET IMPLEMENTED

**Location:**
- Page: `frontend/src/app/(dashboard)/expenses/page.tsx`
- Actions: `frontend/src/app/(dashboard)/expenses/actions.ts`
- Component: `frontend/src/components/expenses/AddExpenseDialog.tsx`

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

---

## 🚀 Safe to Extend Next

### Immediate Next Steps (No Breaking Changes)
1. **Edit/Delete for Sales Orders**
   - Create `EditOrderDialog.tsx` component
   - Add `updateOrder()` and `deleteOrder()` server actions
   - Pattern: Follow `AddOrderDialog.tsx` structure

2. **Edit/Delete for Expenses**
   - Create `EditExpenseDialog.tsx` component
   - Add `updateExpense()` and `deleteExpense()` server actions
   - Pattern: Follow `AddExpenseDialog.tsx` structure

3. **Export to CSV**
   - Add server actions to generate CSV
   - Use existing filtered data
   - No DB schema changes needed

4. **CSV Import**
   - Add upload component
   - Server-side parsing and validation
   - Reuse existing `createManualOrder()` / `createManualExpense()`

5. **Daily P&L Page**
   - Create new page: `frontend/src/app/(dashboard)/daily-pl/page.tsx`
   - Use existing utilities from `lib/daily-pl.ts`
   - Display date range + P&L breakdown table

### Safe Extension Principles
- Current features are well-isolated
- Server actions pattern is established
- Business rules are documented
- No refactoring required for extensions

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

### Database Schema Files
- Supabase migrations (if any)
- RLS policies

### What CAN be modified safely:
- UI components (pages, dialogs, cards)
- Styling (Tailwind classes)
- Filter/search logic (UI level)
- New features that don't touch existing calculations

---

## ⚠️ Known Issues & Technical Debt

### 🔴 HIGH PRIORITY - Timezone Handling
**Issue:**
- Code uses `new Date()` which gets server's local timezone
- Business requires Asia/Bangkok (UTC+7)
- If deployed to cloud (UTC), dates will be wrong by 7 hours

**Impact:**
- Daily reports may count wrong day's data
- Order/expense dates may display incorrectly

**Location:**
- `frontend/src/app/(dashboard)/actions.ts:47`
- `frontend/src/app/(dashboard)/sales/actions.ts:54`
- All date-related code

**Fix Required:**
- Install `date-fns-tz` package
- Use `toZonedTime(new Date(), 'Asia/Bangkok')` consistently
- OR configure server timezone to Asia/Bangkok

**Documented in:** `BUSINESS_RULES_AUDIT.md`

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

4. **`CLAUDE.md`** (this file)
   - Project rules and guidelines
   - Current system state
   - Extension guide
   - Updated: 2026-01-19 (MVP Completion)

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
