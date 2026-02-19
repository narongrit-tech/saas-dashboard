# Bank Module Implementation Plan
**Status:** Phase 1-2 Complete, Phase 3-5 Pending
**Created:** 2026-01-25

## ✅ Completed (Phase 1-2)

### Database Schema
- ✅ `migration-014-bank-module.sql`
  - bank_accounts table
  - bank_statement_import_batches table
  - bank_transactions table
  - bank_reconciliations table
  - Indexes + RLS policies
  - Helper function: `get_bank_opening_balance()`

- ✅ `migration-015-expenses-subcategory.sql`
  - Added `subcategory` field to expenses table (nullable)

### Backend Actions
- ✅ `frontend/src/types/bank.ts` - All TypeScript types
- ✅ `frontend/src/lib/parsers/bank-statement-parser.ts` - Parser (KBIZ/K PLUS/Generic)
- ✅ `frontend/src/app/(dashboard)/bank/actions.ts` - Bank CRUD + daily summary
- ✅ `frontend/src/app/(dashboard)/bank/import-actions.ts` - Import logic with preview
- ✅ `frontend/src/app/(dashboard)/reconciliation/bank-reconciliation-actions.ts` - Reconciliation engine
- ✅ `frontend/src/app/(dashboard)/expenses/actions.ts` - **UPDATED** with subcategory
- ✅ `frontend/src/types/expenses.ts` - **UPDATED** with subcategory

---

## 🚧 Pending (Phase 3-5)

### Phase 3: Frontend UI

#### A) Bank Module (`/bank`)

**Main Page:** `frontend/src/app/(dashboard)/bank/page.tsx`
```tsx
// Layout:
// 1. Header: Bank account selector + Date range picker + Import + Export buttons
// 2. Daily Summary Table (default view)
// 3. Raw Transactions Table (collapsible)
```

**Components to create:**
1. `frontend/src/components/bank/BankAccountSelector.tsx`
   - Dropdown to select active bank account
   - Fetch accounts from getBankAccounts()

2. `frontend/src/components/bank/ImportBankStatementDialog.tsx`
   - Upload file (.xlsx or .csv)
   - Auto-detect format → Preview
   - Manual mapping fallback (reuse wizard pattern from wallets)
   - Confirm → Import

3. `frontend/src/components/bank/BankDailySummaryTable.tsx`
   - Columns: Date, Cash In, Cash Out, Net, Running Balance, Txn Count
   - Pagination: 30 rows/page
   - Bangkok timezone formatting

4. `frontend/src/components/bank/BankTransactionsTable.tsx`
   - Columns: Date, Description, Withdrawal, Deposit, Balance, Channel, Ref ID
   - Search: Description filter
   - Pagination: 50 rows/page

5. `frontend/src/components/bank/AddBankAccountDialog.tsx`
   - Form: Bank name, Account number, Account type, Currency
   - Create via createBankAccount()

#### B) Reconciliation Module (`/bank-reconciliation`)

**Main Page:** `frontend/src/app/(dashboard)/bank-reconciliation/page.tsx`
```tsx
// Layout:
// 1. Header: Date range picker + "Run Auto-Match" button (disabled in v1)
// 2. Summary Cards: Bank Net, Internal Total, Matched Count, Unmatched Count, Gap
// 3. Unmatched Bank Transactions table
// 4. Unmatched Internal Records tabs (Settlements / Expenses / Wallet Top-ups)
```

**Components to create:**
1. `frontend/src/components/reconciliation/ReconciliationSummaryCards.tsx`
   - 5 cards: Bank Net, Internal Total, Matched, Unmatched, Gap
   - Color-coded: Green (matched), Red (unmatched), Yellow (gap)

2. `frontend/src/components/reconciliation/UnmatchedBankTransactionsTable.tsx`
   - Show unmatched bank transactions
   - Badge: "Unmatched" (red)
   - Future: Show suggested matches

3. `frontend/src/components/reconciliation/UnmatchedInternalRecordsTabs.tsx`
   - 3 tabs: Settlements / Expenses / Wallet Top-ups
   - Show unmatched internal records
   - Badge: "Unmatched" (yellow)

#### C) Update Company Cashflow (`/company-cashflow`)

**File:** `frontend/src/app/(dashboard)/company-cashflow/page.tsx`
- Add toggle: "Bank View" vs "Marketplace View"
- Default: Bank View (use bank_transactions as source)
- Marketplace View: Keep existing logic (settlement + expenses + wallet)

**Actions:** Already updated in Phase 7 Task A
- `frontend/src/app/(dashboard)/company-cashflow/actions.ts`
- Add parameter: `source: 'bank' | 'marketplace'`

#### D) Update Expenses UI

**Files to update:**
1. `frontend/src/components/expenses/AddExpenseDialog.tsx`
   - Add field: Subcategory (text input, optional, after Category dropdown)
   - Placeholder: "e.g., Facebook Ads, Google Ads, Office Rent"

2. `frontend/src/components/expenses/EditExpenseDialog.tsx`
   - Add field: Subcategory (same as Add dialog)

3. `frontend/src/app/(dashboard)/expenses/page.tsx`
   - Add filter: Subcategory dropdown (show unique values from DB)
   - Add column: Subcategory (between Category and Amount)

---

### Phase 4: Integration Testing

#### Test Scenarios:
1. **Bank Import Test**
   - Upload KBIZ format → Verify auto-detect works
   - Upload K PLUS format → Verify auto-detect works
   - Upload generic CSV → Verify fallback to manual mapping
   - Re-upload same file → Verify duplicate file hash error

2. **Bank Daily Summary Test**
   - Import transactions for 7 days
   - Check daily summary aggregation (cash in/out/net/running balance)
   - Verify opening balance calculation from first transaction

3. **Bank Reconciliation Test**
   - Create settlement (marketplace income)
   - Create expense (cash out)
   - Create wallet top-up (cash out)
   - Run reconciliation → Verify unmatched lists show all 3 + bank transactions

4. **Expenses Subcategory Test**
   - Create expense with subcategory → Verify saved
   - Create expense without subcategory → Verify null value OK
   - Filter by subcategory → Verify filtering works
   - Export CSV → Verify subcategory column included
   - Check Daily P&L → Verify still uses main category ONLY (not subcategory)

5. **Company Cashflow Bank View Test**
   - Toggle to Bank View → Verify uses bank_transactions data
   - Toggle to Marketplace View → Verify uses old logic
   - Compare totals → Document expected differences

---

### Phase 5: QA Checklist

Create `BANK_MODULE_QA.md` with sections:

1. **Bank Import QA**
   - [ ] KBIZ format auto-detection works
   - [ ] K PLUS format auto-detection works
   - [ ] Generic CSV auto-detection works
   - [ ] Manual column mapping fallback works
   - [ ] File hash deduplication works
   - [ ] Import preview shows correct summary
   - [ ] Imported transactions appear in raw table
   - [ ] Bangkok timezone consistency (dates match statement)

2. **Bank Daily Summary QA**
   - [ ] Opening balance calculated correctly
   - [ ] Daily cash in/out aggregation correct
   - [ ] Running balance matches bank statement
   - [ ] Pagination works (30 rows/page)
   - [ ] Date range filter works
   - [ ] CSV export includes all columns

3. **Bank Reconciliation QA**
   - [ ] Summary cards show correct totals
   - [ ] Unmatched bank transactions list accurate
   - [ ] Unmatched settlements list accurate
   - [ ] Unmatched expenses list accurate
   - [ ] Unmatched wallet top-ups list accurate
   - [ ] Gap calculation correct (Bank Net - Internal Total)
   - [ ] Date range filter affects all summaries

4. **Expenses Subcategory QA**
   - [ ] Add expense with subcategory → Saved
   - [ ] Add expense without subcategory → Saved as null
   - [ ] Edit expense → Subcategory updates
   - [ ] Subcategory filter shows unique values
   - [ ] Subcategory column visible in table
   - [ ] CSV export includes subcategory
   - [ ] **CRITICAL:** Daily P&L still uses main category only (unchanged)

5. **Company Cashflow Bank View QA**
   - [ ] Bank View toggle works
   - [ ] Bank View shows bank_transactions data
   - [ ] Marketplace View shows old logic data
   - [ ] Opening balance computed from bank
   - [ ] Running balance matches bank statement

6. **Security & RLS QA**
   - [ ] Users can only see own bank accounts
   - [ ] Users can only see own bank transactions
   - [ ] Users can only see own reconciliations
   - [ ] RLS prevents cross-user data access

7. **Performance QA**
   - [ ] Bank import < 5 seconds (1000 rows)
   - [ ] Daily summary query < 2 seconds
   - [ ] Raw transactions pagination fast (< 1 second)
   - [ ] Reconciliation summary < 3 seconds

---

## Files Created (Summary)

### Database
- `database-scripts/migration-014-bank-module.sql`
- `database-scripts/migration-015-expenses-subcategory.sql`

### Backend
- `frontend/src/types/bank.ts`
- `frontend/src/lib/parsers/bank-statement-parser.ts`
- `frontend/src/app/(dashboard)/bank/actions.ts`
- `frontend/src/app/(dashboard)/bank/import-actions.ts`
- `frontend/src/app/(dashboard)/reconciliation/bank-reconciliation-actions.ts`
- `frontend/src/app/(dashboard)/expenses/actions.ts` (UPDATED)
- `frontend/src/types/expenses.ts` (UPDATED)

### Frontend (TODO)
- `frontend/src/app/(dashboard)/bank/page.tsx`
- `frontend/src/components/bank/BankAccountSelector.tsx`
- `frontend/src/components/bank/ImportBankStatementDialog.tsx`
- `frontend/src/components/bank/BankDailySummaryTable.tsx`
- `frontend/src/components/bank/BankTransactionsTable.tsx`
- `frontend/src/components/bank/AddBankAccountDialog.tsx`
- `frontend/src/app/(dashboard)/bank-reconciliation/page.tsx`
- `frontend/src/components/reconciliation/ReconciliationSummaryCards.tsx`
- `frontend/src/components/reconciliation/UnmatchedBankTransactionsTable.tsx`
- `frontend/src/components/reconciliation/UnmatchedInternalRecordsTabs.tsx`
- `frontend/src/app/(dashboard)/company-cashflow/page.tsx` (UPDATE)
- `frontend/src/components/expenses/AddExpenseDialog.tsx` (UPDATE)
- `frontend/src/components/expenses/EditExpenseDialog.tsx` (UPDATE)
- `frontend/src/app/(dashboard)/expenses/page.tsx` (UPDATE)

### Documentation (TODO)
- `BANK_MODULE_QA.md`
- `CLAUDE.md` (UPDATE - add Bank Module section)

---

## Next Steps

1. ✅ Run database migrations (migration-014, migration-015)
2. ⏳ Create frontend pages and components
3. ⏳ Update existing pages (company-cashflow, expenses)
4. ⏳ Integration testing
5. ⏳ Create QA checklist
6. ⏳ Update CLAUDE.md

**Estimated Remaining Work:** 8-10 hours
**Complexity:** Medium (reuse existing patterns from wallets/finance/marketplace-wallets modules)
