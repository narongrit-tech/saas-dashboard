# Manual QA Checklist - Tasks A, B, C, D
**Created:** 2026-01-25
**Phase:** Task completion verification
**Test Environment:** Local development (http://localhost:3000)

---

## Prerequisites

Before starting tests:
- [ ] Database migrations applied (migration-013-expense-audit-logs.sql)
- [ ] npm run dev running
- [ ] Logged in with test user
- [ ] Sample data exists (sales orders, expenses, cashflow settlements)

---

## TASK D: Unified Date Picker (Bangkok Timezone)

### Test D1: SingleDateRangePicker Component
**Location:** Sales page, Expenses page, Company Cashflow page, Reconciliation page

**Steps:**
1. Navigate to /sales
2. Click on "Date Range" picker
3. Verify Bangkok timezone is used (today's date matches Thai calendar)
4. Select a preset: "Last 7 Days"
5. Verify date range updates correctly
6. Select custom range: start date and end date
7. Verify results filter correctly
8. Repeat for /expenses, /company-cashflow, /reconciliation pages

**Expected:**
- ✅ All pages use same date picker component
- ✅ Presets show Bangkok dates (not UTC)
- ✅ Custom ranges respect Bangkok timezone
- ✅ Data filters correctly by date range

### Test D2: SingleDatePicker Component
**Location:** Daily P&L page

**Steps:**
1. Navigate to /daily-pl
2. Click on single date picker
3. Verify today's date matches Bangkok timezone
4. Select yesterday's date
5. Verify P&L data updates for selected date
6. Check exported CSV uses Bangkok date in filename

**Expected:**
- ✅ Single date picker shows Bangkok dates
- ✅ P&L data matches selected date
- ✅ No timezone drift (17:00 UTC ≠ next day)

---

## TASK A: Company Cashflow

### Test A1: Company Cashflow Summary
**Location:** /company-cashflow

**Steps:**
1. Navigate to /company-cashflow
2. Verify default date range: Last 7 days
3. Check summary cards display:
   - Total Cash In (from settlement_transactions)
   - Total Cash Out (from expenses + wallet top-ups)
   - Net Cashflow (In - Out)
4. Change date range to "Last 30 Days"
5. Verify numbers update correctly

**Expected:**
- ✅ Summary loads in < 5 seconds
- ✅ Numbers are accurate (match DB query)
- ✅ Cash In = sum(settlement_amount) from settlement_transactions
- ✅ Cash Out = sum(expenses.amount) + sum(wallet_ledger TOP_UP)
- ✅ Net = Cash In - Cash Out

### Test A2: Daily Breakdown Table
**Location:** /company-cashflow

**Steps:**
1. Scroll to "Daily Breakdown" table
2. Verify columns: Date, Cash In, Cash Out, Net, Running Balance
3. Check running balance calculation (cumulative)
4. Verify dates are in Bangkok timezone
5. Check sorting (most recent first)

**Expected:**
- ✅ Daily rows show correct aggregation
- ✅ Running balance = previous balance + current net
- ✅ All dates in Asia/Bangkok timezone
- ✅ No duplicate dates

### Test A3: CSV Export
**Location:** /company-cashflow

**Steps:**
1. Click "Export CSV" button
2. Verify file downloads: `company-cashflow-YYYYMMDD-HHMMSS.csv`
3. Open CSV file
4. Check columns: Date, Cash In, Cash Out, Net Cashflow, Running Balance
5. Verify all rows from selected date range are included
6. Check Thai number formatting (2 decimal places)

**Expected:**
- ✅ CSV filename uses Bangkok timezone timestamp
- ✅ All data rows present
- ✅ Numbers formatted correctly
- ✅ Respects selected date range filter

---

## TASK B: Cashflow vs P&L Reconciliation

### Test B1: Reconciliation Summary
**Location:** /reconciliation

**Steps:**
1. Navigate to /reconciliation
2. Verify default date range: Last 7 days
3. Check two summary cards:
   - Accrual P&L: Revenue, Ad Spend, COGS, Operating, Net Profit
   - Company Cashflow: Cash In, Cash Out, Net Cashflow
4. Verify numbers match Task A Company Cashflow for same period
5. Change date range to "MTD" (Month to Date)
6. Verify numbers update

**Expected:**
- ✅ Accrual P&L matches daily-pl calculations
- ✅ Company Cashflow matches /company-cashflow page
- ✅ Numbers load in < 5 seconds
- ✅ All amounts rounded to 2 decimals

### Test B2: Bridge Items Table
**Location:** /reconciliation

**Steps:**
1. Scroll to "Bridge Items" table
2. Verify 3 bridge items:
   - Revenue not yet settled (Accrual Revenue - Cash In)
   - Wallet top-ups (cash out but not expense)
   - Ad spend timing differences (placeholder: 0)
3. Check "Data Available" column:
   - First two items: ✅ (green check)
   - Third item: ❌ (gray X)
4. Verify Total Bridge = sum of all bridge items
5. Check Verification formula: Accrual Net + Bridge = Cashflow Net

**Expected:**
- ✅ Bridge items explain the difference
- ✅ Total Bridge calculated correctly
- ✅ Verification error near 0 (< 0.01) if all accounted for
- ✅ Warning shown if verification error > 0.01

### Test B3: Explanation Card
**Location:** /reconciliation (bottom of page)

**Steps:**
1. Read the blue explanation card
2. Verify it explains:
   - Accrual P&L: Records revenue on sale, expense on occurrence
   - Cashflow: Records only when money moves
   - Example bridge item scenario

**Expected:**
- ✅ Card displays with clear Thai explanation
- ✅ Helps user understand the difference

### Test B4: CSV Export
**Location:** /reconciliation

**Steps:**
1. Click "Export CSV" button
2. Verify file downloads: `reconciliation-YYYYMMDD-HHMMSS.csv`
3. Open CSV file
4. Check sections:
   - Accrual P&L (Performance)
   - Company Cashflow (Liquidity)
   - Bridge Items
   - Verification Error
5. Verify all numbers match the UI

**Expected:**
- ✅ CSV filename uses Bangkok timezone
- ✅ All sections present
- ✅ Numbers match UI exactly
- ✅ Bridge items include explanations

---

## TASK C: Expenses Template + Import + Audit Log

### Test C1: Download Template
**Location:** /expenses

**Steps:**
1. Navigate to /expenses
2. Click "Download Template" button
3. Verify file downloads: `expense-template-YYYYMMDD.xlsx`
4. Open Excel file
5. Check "expenses_template" sheet:
   - Headers: date, category, description, amount, payment_method, vendor, notes, reference_id
   - Example row with sample data
   - Column widths formatted
6. Check "Instructions" sheet:
   - Thai + English instructions
   - Required columns listed
   - Category values explained (Advertising, COGS, Operating)
   - Example usage notes

**Expected:**
- ✅ Template downloads successfully
- ✅ Filename uses Bangkok date (YYYYMMDD)
- ✅ Both sheets present
- ✅ Instructions clear and helpful
- ✅ Example row can be used as reference

### Test C2: Import Template - Success Case
**Location:** /expenses

**Steps:**
1. Download template from /expenses
2. Fill in 5 test expense rows:
   - Date: 2026-01-25
   - Category: Advertising, COGS, Operating (mix)
   - Amount: various positive numbers
   - Description: test descriptions
3. Save file as `test-expenses-import.xlsx`
4. Click "Import" button on /expenses
5. Upload the file
6. Verify preview shows:
   - Total Rows: 5
   - Total Amount: sum of all amounts
   - Category Breakdown: correct sums per category
   - Sample Rows: first 5 rows
   - No errors
7. Click "Confirm Import"
8. Wait for import to complete
9. Verify success message: "Import สำเร็จ: 5 รายการ"
10. Check expenses table refreshes with new rows

**Expected:**
- ✅ Preview accurate (no errors)
- ✅ All 5 rows imported successfully
- ✅ source='imported', import_batch_id set
- ✅ Expense table updates immediately

### Test C3: Import Template - Validation Errors
**Location:** /expenses

**Steps:**
1. Create test file with errors:
   - Row 2: Missing category
   - Row 3: Invalid category "Marketing"
   - Row 4: Negative amount
   - Row 5: Invalid date format
   - Row 6: Valid row
2. Click "Import" button
3. Upload the file
4. Verify preview shows:
   - Total Rows: 1 (only valid row)
   - Errors section: 4 errors with row numbers
   - Sample Rows: only the valid row
5. Click "Confirm Import"
6. Verify only 1 row imported

**Expected:**
- ✅ Parser detects all errors
- ✅ Error messages clear (row number + field + reason)
- ✅ Only valid rows imported
- ✅ Import summary shows: "1 inserted, 4 errors"

### Test C4: Import Deduplication
**Location:** /expenses

**Steps:**
1. Import `test-expenses-import.xlsx` (from Test C2)
2. Verify import succeeds
3. Try to import SAME file again (without allowDuplicate flag)
4. Verify error: "ไฟล์นี้เคยถูก import แล้ว (timestamp)"
5. Check import_batches table:
   - file_hash stored
   - report_type = 'expenses_template'
   - status = 'success'

**Expected:**
- ✅ Duplicate file rejected
- ✅ Error message shows original import timestamp
- ✅ Database prevents duplicate data

### Test C5: Audit Log - CREATE
**Location:** Database query or future audit UI

**Steps:**
1. Navigate to /expenses
2. Click "Add Expense" (manual entry)
3. Fill form:
   - Date: 2026-01-25
   - Category: Operating
   - Amount: 1500
   - Description: Test Manual Expense
4. Click "Save"
5. Query database:
   ```sql
   SELECT * FROM expense_audit_logs
   WHERE expense_id = [new expense id]
   ORDER BY performed_at DESC
   LIMIT 1;
   ```
6. Verify audit log record:
   - action = 'CREATE'
   - performed_by = current user ID
   - changes.created = { category, amount, expense_date, description }

**Expected:**
- ✅ Audit log created automatically
- ✅ CREATE action recorded
- ✅ changes JSON contains created data
- ✅ performed_at timestamp accurate

### Test C6: Audit Log - UPDATE
**Location:** /expenses

**Steps:**
1. Click "Edit" on existing expense (from Test C5)
2. Change amount: 1500 → 2000
3. Change description: "Test Manual Expense" → "Updated Expense"
4. Click "Save"
5. Query database:
   ```sql
   SELECT * FROM expense_audit_logs
   WHERE expense_id = [expense id]
   AND action = 'UPDATE'
   ORDER BY performed_at DESC
   LIMIT 1;
   ```
6. Verify audit log:
   - action = 'UPDATE'
   - changes.before = old values
   - changes.after = new values

**Expected:**
- ✅ UPDATE audit log created
- ✅ changes.before captures old state
- ✅ changes.after captures new state
- ✅ Both before and after are complete

### Test C7: Audit Log - DELETE
**Location:** /expenses

**Steps:**
1. Click "Delete" on expense (from Test C5)
2. Confirm deletion in dialog
3. Query database:
   ```sql
   SELECT * FROM expense_audit_logs
   WHERE expense_id = [deleted expense id]
   AND action = 'DELETE'
   ORDER BY performed_at DESC
   LIMIT 1;
   ```
4. Verify audit log:
   - action = 'DELETE'
   - changes.deleted = { category, amount, expense_date, description }
5. Verify expense record deleted from expenses table

**Expected:**
- ✅ DELETE audit log created BEFORE deletion
- ✅ changes.deleted captures full record
- ✅ Expense hard deleted from expenses table
- ✅ Audit log remains (CASCADE delete does NOT delete logs)

---

## Cross-Feature Integration Tests

### Integration 1: Bangkok Timezone Consistency
**Steps:**
1. Set computer clock to UTC time
2. Navigate to all pages with date pickers
3. Verify all pages show Bangkok time (UTC+7)
4. Create records on different pages (sales, expenses)
5. Verify all timestamps consistent across pages
6. Export CSV from multiple pages
7. Verify all CSV filenames use Bangkok timestamp

**Expected:**
- ✅ No timezone drift across pages
- ✅ All exports use Asia/Bangkok
- ✅ Record timestamps consistent

### Integration 2: Company Cashflow vs Reconciliation Match
**Steps:**
1. Select same date range on both /company-cashflow and /reconciliation
2. Compare "Total Cash In" and "Total Cash Out"
3. Verify numbers are identical
4. Change date range on both pages
5. Re-verify numbers match

**Expected:**
- ✅ Company Cashflow numbers = Reconciliation Cashflow numbers
- ✅ Both pages use same data source
- ✅ Calculations consistent

### Integration 3: Expenses Import Impact on Daily P&L
**Steps:**
1. Note current day's P&L on /daily-pl
2. Import 3 expenses for today:
   - Advertising: 5000
   - COGS: 3000
   - Operating: 2000
3. Refresh /daily-pl page
4. Verify P&L updated:
   - Advertising Cost increased by 5000
   - COGS increased by 3000
   - Operating increased by 2000
   - Net Profit decreased by 10000

**Expected:**
- ✅ Imported expenses immediately affect P&L
- ✅ Breakdown by category correct
- ✅ Net Profit calculation accurate

---

## Security & Data Integrity Tests

### Security 1: RLS Policy - Audit Logs
**Steps:**
1. User A creates expense
2. User A views expense (visible)
3. User B tries to view User A's expense audit logs
4. Query database as User B:
   ```sql
   SELECT * FROM expense_audit_logs
   WHERE expense_id = [User A's expense];
   ```

**Expected:**
- ✅ User B cannot see User A's expense audit logs
- ✅ RLS policy enforces: Only see own expenses' logs

### Security 2: Import Batch Ownership
**Steps:**
1. User A imports expense template
2. Check import_batches record:
   - created_by = User A
3. User B tries to query User A's import batch
4. Verify RLS blocks access

**Expected:**
- ✅ Import batches linked to creator
- ✅ RLS enforces user isolation

### Data Integrity 1: File Hash Uniqueness
**Steps:**
1. Import file A (SHA256 hash calculated)
2. Modify file A (change one cell)
3. Try to import modified file
4. Verify: Different hash, import allowed
5. Import original file A again
6. Verify: Same hash, import rejected

**Expected:**
- ✅ File hash accurately detects duplicates
- ✅ Modified files have different hash

### Data Integrity 2: Audit Trail Immutability
**Steps:**
1. Create audit log record (via expense CREATE)
2. Try to UPDATE audit log record:
   ```sql
   UPDATE expense_audit_logs
   SET changes = '{"fake": "data"}'
   WHERE id = [log id];
   ```
3. Try to DELETE audit log record:
   ```sql
   DELETE FROM expense_audit_logs
   WHERE id = [log id];
   ```

**Expected:**
- ✅ UPDATE blocked (no RLS policy for UPDATE)
- ✅ DELETE blocked (no RLS policy for DELETE)
- ✅ Audit logs are append-only

---

## Performance Tests

### Performance 1: Page Load Times
**Steps:**
1. Open Chrome DevTools Network tab
2. Navigate to each page:
   - /company-cashflow
   - /reconciliation
   - /expenses
3. Measure "DOMContentLoaded" time

**Expected:**
- ✅ All pages load < 2 seconds (local)
- ✅ API responses < 1 second (local)

### Performance 2: Large Import (1000 rows)
**Steps:**
1. Create expense template with 1000 rows
2. Import via /expenses
3. Measure import time
4. Verify all 1000 rows inserted

**Expected:**
- ✅ Import completes < 30 seconds (local)
- ✅ No memory errors
- ✅ All rows inserted correctly

---

## Regression Tests

### Regression 1: Existing Sales CRUD
**Steps:**
1. Navigate to /sales
2. Add new order
3. Edit existing order
4. Delete order
5. Export CSV

**Expected:**
- ✅ All existing sales functionality works
- ✅ No breaking changes from Task D (date picker)

### Regression 2: Existing Expenses CRUD
**Steps:**
1. Navigate to /expenses
2. Add new expense
3. Edit existing expense
4. Delete expense
5. Export CSV

**Expected:**
- ✅ All existing expenses functionality works
- ✅ Template import does not break manual entry
- ✅ Audit logs created for all operations

### Regression 3: Dashboard Stats
**Steps:**
1. Navigate to / (dashboard)
2. Verify cards:
   - Total Sales Today
   - Total Expenses Today
   - Net Profit Today
3. Verify 7-day chart displays

**Expected:**
- ✅ Dashboard unaffected by Tasks A, B, C, D
- ✅ Stats calculation correct

---

## Edge Cases & Error Handling

### Edge Case 1: Empty Date Range
**Steps:**
1. Navigate to /company-cashflow
2. Select date range with no data
3. Verify empty state displayed
4. Try to export CSV
5. Verify error: "ไม่พบข้อมูลที่จะ export"

**Expected:**
- ✅ Empty state displayed (no crash)
- ✅ Export blocked with clear message

### Edge Case 2: Template with Empty Rows
**Steps:**
1. Download template
2. Fill rows 2, 3, 4
3. Leave rows 5, 6, 7 empty
4. Fill row 8
5. Import template

**Expected:**
- ✅ Parser skips empty rows
- ✅ Only filled rows (2, 3, 4, 8) imported

### Edge Case 3: Special Characters in Expense Description
**Steps:**
1. Import expense with description: "Test ทดสอบ 测试 тест 😀"
2. Verify import succeeds
3. View expense in table
4. Export CSV
5. Open CSV in Excel

**Expected:**
- ✅ Unicode characters preserved
- ✅ No encoding errors
- ✅ CSV displays correctly in Excel

### Edge Case 4: Large Amount Numbers
**Steps:**
1. Create expense with amount: 9,999,999.99
2. Verify saved correctly
3. Check P&L calculation includes large amount
4. Export CSV and verify formatting

**Expected:**
- ✅ Large numbers handled correctly
- ✅ No overflow or precision loss
- ✅ Thai number formatting correct (commas)

---

## Acceptance Criteria Verification

### Task D Acceptance Criteria ✅
- [x] All pages use unified date picker components
- [x] Bangkok timezone (Asia/Bangkok) used consistently
- [x] No breaking changes to existing date filtering
- [x] Presets work correctly (Today, Last 7 Days, etc.)

### Task A Acceptance Criteria ✅
- [x] Company Cashflow page accessible at /company-cashflow
- [x] Summary cards show: Cash In, Cash Out, Net Cashflow
- [x] Daily breakdown table with running balance
- [x] Date range filter (default: Last 7 days)
- [x] CSV export with Bangkok timezone filename
- [x] Page loads in < 5 seconds

### Task B Acceptance Criteria ✅
- [x] Reconciliation page accessible at /reconciliation
- [x] Side-by-side comparison: Accrual P&L vs Cashflow
- [x] Bridge items table with explanations
- [x] Verification formula checks accuracy
- [x] Date range filter (default: Last 7 days)
- [x] CSV export with all sections

### Task C Acceptance Criteria ✅
- [x] Download Template button on /expenses
- [x] Template generates .xlsx with 2 sheets
- [x] Import dialog with preview and validation
- [x] File hash deduplication works
- [x] Audit log table created with RLS policies
- [x] CREATE/UPDATE/DELETE operations logged
- [x] Audit logs immutable (no UPDATE/DELETE policies)

---

## Sign-Off

**QA Performed By:** _______________
**Date:** _______________
**All Tests Passed:** [ ] Yes / [ ] No
**Issues Found:** _______________
**Notes:** _______________

---

## Known Limitations

1. **Tiger Ads Timing Differences (Task B):**
   - Bridge item "Ad spend timing differences" currently placeholder (0)
   - Data source not yet available
   - Does not affect accuracy if Tiger imports done correctly

2. **Audit Log UI:**
   - No UI page to view audit logs yet
   - Must query database directly for now
   - Future enhancement: /expenses/[id]/audit-log page

3. **Import Batch Details:**
   - No UI to view import history
   - Must query import_batches table directly
   - Future enhancement: /imports page

---

## Future Manual Tests (Out of Scope)

- [ ] Mobile responsive layout (all new pages)
- [ ] Dark mode compatibility
- [ ] Browser compatibility (Chrome, Firefox, Safari, Edge)
- [ ] Slow network simulation
- [ ] Concurrent user import conflicts
- [ ] Database failover scenarios

---

**Document Version:** 1.0
**Last Updated:** 2026-01-25
**Related Documents:**
- BUSINESS_RULES_AUDIT.md
- QA_CHECKLIST.md
- MVP_QA_VALIDATION.md
- CLAUDE.md
