# Cash In Classification & Sidebar Restructure Implementation

**Date:** 2026-02-17
**Status:** Completed - Ready for Testing

## Overview

This implementation adds two major features:
1. **Cash In Classification System**: Source of truth for categorizing bank inflows
2. **Sidebar Menu Restructure**: Grouped dropdown navigation for better UX

---

## Part A: Cash In Classification

### Database Changes

**Migration:** `database-scripts/migration-019-cash-in-classification.sql`

Added columns to `bank_transactions`:
- `cash_in_type` TEXT NULL - Classification type (SALES_SETTLEMENT, DIRECTOR_LOAN, etc.)
- `cash_in_ref_type` TEXT NULL - Optional reference entity type
- `cash_in_ref_id` TEXT NULL - Optional reference entity ID
- `classified_at` TIMESTAMPTZ NULL - Timestamp of classification
- `classified_by` UUID NULL - User who classified (FK to auth.users)

**Indexes Created:**
- `idx_bank_txn_cash_in_type` - For filtering by classification status
- `idx_bank_txn_unclassified_inflows` - For querying unclassified cash inflows

**RLS Policy:**
- Users can update cash_in classification on their own transactions only

### Backend (Server Actions)

**File:** `frontend/src/app/(dashboard)/bank/cash-in-actions.ts`

Functions implemented:
1. `getCashInTransactions()` - Fetch cash inflow transactions with filters
2. `getCashInSelectionSummary()` - Get summary of selected transactions
3. `applyCashInType()` - Bulk apply classification (supports select-all-filtered)
4. `clearCashInType()` - Bulk clear classification

**Business Rules Enforced:**
- Only cash inflows (deposit > 0) are processed
- Note required for types: OTHER, OTHER_INCOME
- RLS ensures users can only update their own transactions
- Server-side bulk operations (no client-side loops)

### Type Definitions

**File:** `frontend/src/types/bank.ts`

Added types:
- `CashInType` - 14 classification types
- `CASH_IN_TYPE_LABELS` - Thai labels for each type
- `CashInClassificationPayload` - Payload for applying classification
- `CashInSelectionSummary` - Summary for confirmation UI

**Classification Types:**
- SALES_SETTLEMENT - เงินจากการขาย
- SALES_PAYOUT_ADJUSTMENT - ปรับยอด Settlement
- DIRECTOR_LOAN - เงินกู้จากผู้ถือหุ้น/กรรมการ
- CAPITAL_INJECTION - เงินลงทุนเพิ่ม
- LOAN_PROCEEDS - เงินกู้จากสถาบันการเงิน
- REFUND_IN - เงินคืนจากลูกค้า
- VENDOR_REFUND - เงินคืนจากซัพพลายเออร์
- TAX_REFUND - เงินคืนภาษี
- INTERNAL_TRANSFER_IN - โอนเงินภายในบริษัท
- WALLET_WITHDRAWAL - ถอนเงินจาก Wallet
- REBATE_CASHBACK - Rebate/Cashback
- OTHER_INCOME - รายได้อื่นๆ
- REVERSAL_CORRECTION_IN - ปรับปรุง/ยกเลิกรายการ
- OTHER - อื่นๆ (ระบุ)

### Frontend Components

**1. CashInClassification Component**
- File: `frontend/src/components/bank/CashInClassification.tsx`
- Features:
  - Filter by bank account, date range, search
  - Toggle to show/hide classified transactions
  - Bulk selection with two modes:
    - **IDs mode**: Select specific rows on current page
    - **Filtered mode**: Select all rows matching current filters
  - Selection banner with "Select all X matching rows" link
  - Displays: date, bank account, description, amount, classification type

**2. CashInTypeDialog Component**
- File: `frontend/src/components/bank/CashInTypeDialog.tsx`
- Features:
  - Dropdown to select classification type
  - Optional ref_type and ref_id fields
  - Note field (required for OTHER and OTHER_INCOME types)
  - Confirmation input: user must type "APPLY {N}" to proceed
  - Warning alert about bulk operation impact

**3. BankModuleClient Updates**
- File: `frontend/src/components/bank/BankModuleClient.tsx`
- Added tabs navigation:
  - Overview (Daily Summary)
  - Transactions
  - **Cash In Classification** (NEW)
- Tab state synced with URL query param `?tab=cash-in-classification`

### Integration Points

**Company Cashflow:**
- Added note in Bank View alert: "Cash In Classification: ดูรายละเอียดประเภทเงินเข้าได้ที่ Bank > Cash In Classification tab"
- Future enhancement: Display cash_in_type in daily breakdown table (requires query updates)

**Reconciliation:**
- Future enhancement: Filter/group by cash_in_type in reconciliation views

---

## Part B: Sidebar Menu Restructure

### Changes

**File:** `frontend/src/components/dashboard/sidebar.tsx`

**Structure:**
- Converted flat list to grouped dropdown menu
- 5 top-level groups:
  1. **Overview** (default expanded)
     - Dashboard
     - Daily P&L
  2. **Sales** (default expanded)
     - Sales Orders
     - Affiliates
     - Affiliate Report
  3. **Money** (default expanded)
     - Marketplace Wallets
     - Company Cashflow
     - Bank
     - Bank Reconciliation
     - P&L Reconciliation
  4. **Operations** (default collapsed)
     - Expenses
     - Inventory
     - Payables
  5. **Settings** (default collapsed)
     - Settings

**Behavior:**
- Groups auto-expand when they contain the active route
- Group headers highlight when any child is active
- Chevron icons indicate expand/collapse state
- State managed via React hooks (no localStorage)
- Smooth transitions and consistent styling

---

## Files Changed

### New Files:
1. `database-scripts/migration-019-cash-in-classification.sql`
2. `frontend/src/app/(dashboard)/bank/cash-in-actions.ts`
3. `frontend/src/components/bank/CashInClassification.tsx`
4. `frontend/src/components/bank/CashInTypeDialog.tsx`
5. `CASH_IN_CLASSIFICATION_IMPLEMENTATION.md` (this file)

### Modified Files:
1. `frontend/src/types/bank.ts` - Added cash_in types and interfaces
2. `frontend/src/components/bank/BankModuleClient.tsx` - Added tabs
3. `frontend/src/components/dashboard/sidebar.tsx` - Restructured with groups
4. `frontend/src/app/(dashboard)/company-cashflow/page.tsx` - Added classification note

---

## Manual Test Plan

### Prerequisites:
1. Run migration 019: `psql < database-scripts/migration-019-cash-in-classification.sql`
2. Ensure you have bank accounts and transactions imported
3. Start dev server: `cd frontend && npm run dev`

### Test A: Cash In Classification

#### Test A1: Basic Classification (By IDs)
1. Login and navigate to Bank module
2. Select a bank account
3. Click "Cash In Classification" tab
4. Should see unclassified inflows only (default)
5. Select 2-3 transactions using checkboxes
6. Selection banner should appear showing count and total amount
7. Click "กำหนดประเภท" button
8. In dialog:
   - Select type: "DIRECTOR_LOAN"
   - Enter optional ref_type: "loan"
   - Enter optional ref_id: "test-123"
   - Type confirmation: "APPLY 3" (if 3 selected)
9. Click "ยืนยัน"
10. **Expected:** Toast shows success, selected rows disappear from table
11. Toggle "แสดงรายการที่จัดประเภทแล้ว" checkbox
12. **Expected:** Classified rows now visible with badge showing type

#### Test A2: Select All Filtered
1. Go to Cash In Classification tab
2. Apply date range filter (e.g., last 30 days)
3. Check header checkbox to select all on page
4. **Expected:** Selection banner shows "Selected X on this page"
5. Click link: "เลือกทั้งหมด Y รายการที่ตรงเงื่อนไข"
6. **Expected:** Banner updates to show all Y selected
7. Click "กำหนดประเภท"
8. Select type: "SALES_SETTLEMENT"
9. Type confirmation: "APPLY Y"
10. Click "ยืนยัน"
11. **Expected:** All matching transactions classified (verify count matches)

#### Test A3: Note Requirement Validation
1. Select some unclassified transactions
2. Click "กำหนดประเภท"
3. Select type: "OTHER"
4. Leave Note field empty
5. Type confirmation correctly
6. **Expected:** Cannot submit (button disabled or validation error)
7. Enter note: "Test classification"
8. **Expected:** Can now submit successfully

#### Test A4: Clear Classification
1. Toggle "แสดงรายการที่จัดประเภทแล้ว" ON
2. Select 2-3 classified transactions
3. Click "ล้างการจัดประเภท" button
4. Confirm browser alert
5. **Expected:** Selected rows have classification removed, move back to unclassified

#### Test A5: RLS Enforcement
1. Login as User A
2. Classify some transactions
3. Logout and login as User B
4. Go to Cash In Classification
5. **Expected:** Cannot see User A's transactions
6. **Expected:** Cannot modify User A's classifications

### Test B: Sidebar Menu

#### Test B1: Group Expand/Collapse
1. Login and observe sidebar
2. **Expected:** Overview, Sales, Money groups expanded by default
3. **Expected:** Operations, Settings groups collapsed
4. Click "Operations" group header
5. **Expected:** Group expands, showing Expenses, Inventory, Payables
6. Click "Operations" again
7. **Expected:** Group collapses

#### Test B2: Active Route Highlighting
1. Navigate to Dashboard (/)
2. **Expected:** "Overview" group highlighted, "Dashboard" item active (blue bg)
3. Navigate to Bank (/bank)
4. **Expected:** "Money" group highlighted, "Bank" item active
5. Navigate to Expenses (/expenses)
6. **Expected:** "Operations" group auto-expands, "Expenses" item active

#### Test B3: Navigation Across Groups
1. Start at Dashboard
2. Click Money group → Bank
3. **Expected:** Page loads, Bank item active
4. Click Sales group → Affiliates
5. **Expected:** Page loads, Affiliates item active, Money group remains visible
6. Click Operations group → Inventory
7. **Expected:** Page loads, Inventory item active, Operations group expands

#### Test B4: Persistence on Route Change
1. Navigate to Bank
2. **Expected:** Money group auto-expanded
3. Collapse Money group manually
4. Click on a different item in Money (e.g., Company Cashflow)
5. **Expected:** Money group re-expands (because it contains active route)

### Test C: Integration

#### Test C1: Company Cashflow Info Note
1. Navigate to Company Cashflow
2. Select "Bank View" toggle
3. **Expected:** Info alert includes text: "Cash In Classification: ดูรายละเอียดประเภทเงินเข้าได้ที่ Bank > Cash In Classification tab"
4. Click on Bank in sidebar
5. Click "Cash In Classification" tab
6. **Expected:** Arrives at classification page

---

## Known Limitations (MVP Scope)

1. **Cash Out Classification**: Not implemented (only cash in for MVP)
2. **Company Cashflow Integration**: Type display in daily breakdown not yet implemented (requires query update)
3. **Reconciliation Integration**: Filtering by cash_in_type not yet implemented
4. **Bulk Edit**: Cannot edit existing classification in bulk (must clear then reapply)
5. **Export**: Cash In Classification table does not have CSV export yet

---

## Risks & Mitigation

### Risk 1: Performance with Large Datasets
- **Risk:** Select-all-filtered on 10,000+ transactions might be slow
- **Mitigation:** Server-side bulk operation, uses indexes, RLS limits to user's data
- **Monitoring:** Check query performance in production logs

### Risk 2: Accidental Bulk Misclassification
- **Risk:** User accidentally classifies wrong transactions
- **Mitigation:**
  - Confirmation modal with typed confirmation ("APPLY {N}")
  - Warning alert about impact
  - Clear classification feature available
- **Recommendation:** Add audit log in future iteration

### Risk 3: RLS Policy Gaps
- **Risk:** Users might be able to update others' classifications
- **Mitigation:** UPDATE policy checks `created_by = auth.uid()` and server actions double-check
- **Testing:** Test A5 validates RLS enforcement

---

## Next Steps (Future Enhancements)

1. **Cash Out Classification**: Extend system to handle withdrawals
2. **Company Cashflow Table Update**: Add cash_in_type column in daily breakdown
3. **Reconciliation Filters**: Add cash_in_type filter in reconciliation pages
4. **CSV Export**: Add export button for Cash In Classification table
5. **Audit Log**: Track classification changes for compliance
6. **Bulk Edit Dialog**: Allow editing existing classification without clearing first
7. **Classification Rules**: Auto-classify based on description patterns
8. **Analytics Dashboard**: Show classification breakdown (pie chart, trends)

---

## Database Migration Instructions

```bash
# Connect to Supabase database
psql <connection_string>

# Run migration
\i database-scripts/migration-019-cash-in-classification.sql

# Verify columns added
\d bank_transactions

# Test select
SELECT id, txn_date, deposit, cash_in_type, classified_at
FROM bank_transactions
WHERE deposit > 0
LIMIT 5;
```

---

## Rollback Plan

If issues are found:

1. **UI Rollback:**
   ```bash
   git revert <commit_hash>
   ```

2. **Database Rollback:**
   ```sql
   -- Remove indexes
   DROP INDEX IF EXISTS idx_bank_txn_cash_in_type;
   DROP INDEX IF EXISTS idx_bank_txn_unclassified_inflows;

   -- Drop policy
   DROP POLICY IF EXISTS "Users can update cash_in classification on own transactions"
     ON bank_transactions;

   -- Remove columns
   ALTER TABLE bank_transactions
   DROP COLUMN IF EXISTS cash_in_type,
   DROP COLUMN IF EXISTS cash_in_ref_type,
   DROP COLUMN IF EXISTS cash_in_ref_id,
   DROP COLUMN IF EXISTS classified_at,
   DROP COLUMN IF EXISTS classified_by;
   ```

---

## Success Criteria

- [ ] Migration runs without errors
- [ ] All 15 manual tests pass
- [ ] No console errors in browser
- [ ] RLS enforcement verified
- [ ] Bulk operations complete within acceptable time (<5s for 1000 rows)
- [ ] Sidebar navigation works across all routes
- [ ] Active route highlighting accurate
- [ ] No localStorage usage detected
- [ ] Toast notifications display correctly
- [ ] Confirmation modal prevents accidental actions

---

**End of Implementation Summary**
