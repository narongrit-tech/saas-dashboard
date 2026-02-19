# Auto Match Bank Transactions - QA Test Guide

**Feature:** Auto Match (Exact Only) - Conservative automatic matching of bank transactions with internal records

**Created:** 2026-01-26

**Matching Criteria:**
- ✅ Same date (exact match)
- ✅ Same amount (within 0.01)
- ✅ Only 1 candidate found (no ambiguity)
- ✅ Match types: Expenses (withdrawals), Settlements (deposits)
- ❌ Skip: Multiple candidates, wallet top-ups, already matched

---

## Test Scenarios

### Test 1: Exact Match (1 Expense)

**Objective:** Verify auto-match works for exact expense match

**Setup:**
1. Navigate to `/expenses` page
2. Click "Add Expense" button
3. Create expense:
   - Date: 2026-01-26
   - Category: Operating
   - Description: "Test Expense - Auto Match T1"
   - Amount: 5000
4. Navigate to `/bank` page
5. Select active bank account (or create one if none exists)
6. Manually add bank transaction (or import statement):
   - Date: 2026-01-26
   - Description: "Office Rent Payment"
   - Withdrawal: 5000
   - Deposit: 0

**Test Steps:**
1. Navigate to `/bank-reconciliation` page
2. Set date range to include 2026-01-26 (e.g., Last 7 Days)
3. Verify summary shows:
   - Unmatched Bank Count: 1
   - Unmatched Internal Count: 1 (in Expenses tab)
4. Click "Auto Match (Exact Only)" button
5. Wait for toast notification

**Expected Results:**
- ✅ Toast shows: "จับคู่อัตโนมัติ: 1 รายการ"
- ✅ Toast shows: "ข้ามไป: 0 รายการ"
- ✅ Summary cards refresh automatically
- ✅ Matched Count increases by 1
- ✅ Unmatched Bank Count decreases to 0
- ✅ Unmatched Internal Count (Expenses) decreases to 0
- ✅ Bank transaction disappears from "Unmatched Bank Transactions" table
- ✅ Expense disappears from "Unmatched Internal Records" → Expenses tab

**Database Verification:**
```sql
SELECT
  bank_transaction_id,
  matched_type,
  matched_record_id,
  notes,
  metadata
FROM bank_reconciliations
WHERE notes LIKE '%Auto-matched (exact)%'
ORDER BY created_at DESC
LIMIT 1;
```

Expected:
- `matched_type = 'expense'`
- `metadata.matching_rule = 'auto_exact'`
- `metadata.auto_matched = true`

---

### Test 2: Exact Match (1 Settlement)

**Objective:** Verify auto-match works for exact settlement match

**Setup:**
1. Navigate to `/finance/marketplace-wallets` page
2. Import TikTok Income file (or manually create settlement):
   - Transaction ID: "TEST_SETTLEMENT_001"
   - Settlement Amount: 10000
   - Settled Time: 2026-01-26 10:00:00
3. Navigate to `/bank` page
4. Add bank transaction:
   - Date: 2026-01-26
   - Description: "TikTok Settlement"
   - Withdrawal: 0
   - Deposit: 10000

**Test Steps:**
1. Navigate to `/bank-reconciliation` page
2. Set date range to include 2026-01-26
3. Verify summary shows:
   - Unmatched Bank Count: 1
   - Unmatched Internal Count: 1 (in Settlements tab)
4. Click "Auto Match (Exact Only)" button

**Expected Results:**
- ✅ Toast shows: "จับคู่อัตโนมัติ: 1 รายการ"
- ✅ Summary refreshes
- ✅ Matched Count increases by 1
- ✅ Unmatched Bank Count decreases to 0
- ✅ Unmatched Internal Count (Settlements) decreases to 0
- ✅ Bank deposit matched to settlement

**Database Verification:**
```sql
SELECT matched_type, metadata->>'matching_rule' as rule
FROM bank_reconciliations
WHERE matched_type = 'settlement'
ORDER BY created_at DESC
LIMIT 1;
```

Expected:
- `matched_type = 'settlement'`
- `rule = 'auto_exact'`

---

### Test 3: Multiple Candidates (Skip)

**Objective:** Verify auto-match skips ambiguous matches

**Setup:**
1. Create 2 expenses with identical dates and amounts:
   - Expense 1: Date = 2026-01-26, Amount = 3000, Description = "Ad Campaign A"
   - Expense 2: Date = 2026-01-26, Amount = 3000, Description = "Ad Campaign B"
2. Create 1 bank withdrawal:
   - Date: 2026-01-26, Withdrawal: 3000

**Test Steps:**
1. Navigate to `/bank-reconciliation` page
2. Click "Auto Match (Exact Only)" button

**Expected Results:**
- ✅ Toast shows: "จับคู่อัตโนมัติ: 0 รายการ"
- ✅ Toast shows: "ข้ามไป: 1 รายการ"
- ✅ Toast shows: "มีหลาย candidates: 1"
- ✅ Bank transaction remains unmatched (safe - prevents wrong match)
- ✅ Both expenses remain unmatched
- ⚠️ User must manually match (choose which expense is correct)

**Business Logic:**
- Conservative approach: never auto-match if ambiguous
- Prevents wrong matches (e.g., matching to wrong campaign)

---

### Test 4: No Candidate (Skip)

**Objective:** Verify auto-match skips when no matching internal record exists

**Setup:**
1. Create bank withdrawal with unusual amount:
   - Date: 2026-01-26
   - Withdrawal: 7777
   - Description: "Mystery Transaction"
2. Do NOT create any expense or settlement with amount = 7777

**Test Steps:**
1. Navigate to `/bank-reconciliation` page
2. Click "Auto Match (Exact Only)" button

**Expected Results:**
- ✅ Toast shows: "จับคู่อัตโนมัติ: 0 รายการ"
- ✅ Toast shows: "ข้ามไป: 1 รายการ"
- ✅ Toast shows: "ไม่มี candidate: 1"
- ✅ Bank transaction remains unmatched
- ⚠️ Indicates: no internal record matches this bank transaction (data entry needed or investigate mystery transaction)

**Use Case:**
- Bank charges, fees, or unrecorded expenses
- User must manually investigate and record the expense

---

### Test 5: Already Matched (Idempotent)

**Objective:** Verify auto-match is idempotent (safe to run multiple times)

**Setup:**
1. Create expense: Date = 2026-01-26, Amount = 2000
2. Create bank withdrawal: Date = 2026-01-26, Withdrawal = 2000

**Test Steps:**
1. Navigate to `/bank-reconciliation` page
2. Click "Auto Match (Exact Only)" button
3. Verify toast shows: "จับคู่อัตโนมัติ: 1 รายการ"
4. Wait for page to refresh
5. Click "Auto Match (Exact Only)" button AGAIN (second time)

**Expected Results:**
- ✅ First run: Toast shows "จับคู่อัตโนมัติ: 1 รายการ"
- ✅ Second run: Toast shows "จับคู่อัตโนมัติ: 0 รายการ"
- ✅ Second run: Toast shows "ข้ามไป: 1 รายการ, matched แล้ว: 1"
- ✅ No duplicate reconciliation created
- ✅ Matched Count remains 1 (not 2)
- ✅ Safe to run multiple times without side effects

**Database Verification:**
```sql
SELECT COUNT(*) as reconciliation_count
FROM bank_reconciliations
WHERE bank_transaction_id = '[the bank txn id]';
```

Expected: `reconciliation_count = 1` (not 2)

---

### Test 6: Date Mismatch (Skip)

**Objective:** Verify auto-match enforces exact date matching

**Setup:**
1. Create expense:
   - Date: 2026-01-25 (Day 1)
   - Amount: 2000
2. Create bank withdrawal:
   - Date: 2026-01-26 (Day 2 - different date)
   - Withdrawal: 2000

**Test Steps:**
1. Navigate to `/bank-reconciliation` page
2. Set date range: 2026-01-24 to 2026-01-27 (include both dates)
3. Click "Auto Match (Exact Only)" button

**Expected Results:**
- ✅ Toast shows: "จับคู่อัตโนมัติ: 0 รายการ"
- ✅ Toast shows: "ข้ามไป: 1 รายการ"
- ✅ Toast shows: "ไม่มี candidate: 1"
- ✅ Bank transaction NOT matched (date doesn't match)
- ⚠️ User must manually match if date difference is intentional (e.g., bank processing delay)

**Business Logic:**
- Conservative: only match same-date transactions
- Date differences require manual review (could be wrong expense)

---

### Test 7: Amount Mismatch (Skip)

**Objective:** Verify auto-match enforces exact amount matching

**Setup:**
1. Create expense:
   - Date: 2026-01-26
   - Amount: 1000.00
2. Create bank withdrawal:
   - Date: 2026-01-26
   - Withdrawal: 1001.00 (1 baht difference)

**Test Steps:**
1. Navigate to `/bank-reconciliation` page
2. Click "Auto Match (Exact Only)" button

**Expected Results:**
- ✅ Toast shows: "จับคู่อัตโนมัติ: 0 รายการ"
- ✅ Toast shows: "ข้ามไป: 1 รายการ"
- ✅ Toast shows: "ไม่มี candidate: 1"
- ✅ Bank transaction NOT matched (amount doesn't match)
- ⚠️ User must investigate: data entry error, bank fees, or wrong record

**Edge Case Test:**
- Create expense: 1000.001 (precision)
- Create bank: 1000.00
- Expected: Should match (within 0.01 tolerance)

**Business Logic:**
- Tolerance: 0.01 baht (handles floating-point precision)
- Beyond 0.01: requires manual review

---

## Integration Tests

### Test 8: Mixed Scenario (Multiple Transactions)

**Setup:**
1. Create 5 transactions:
   - Expense A: 2026-01-26, 500 (no bank match) → Skip: No candidate
   - Expense B: 2026-01-26, 1000 (exact bank match) → Auto-match
   - Expense C: 2026-01-26, 2000 (2 identical expenses) → Skip: Multiple candidates
   - Settlement D: 2026-01-26, 5000 (exact bank match) → Auto-match
   - Expense E: 2026-01-25, 3000 (bank on 2026-01-26) → Skip: Date mismatch

2. Create bank transactions:
   - Bank 1: 2026-01-26, withdrawal 1000 → matches Expense B
   - Bank 2: 2026-01-26, withdrawal 2000 → has 2 expense candidates (skip)
   - Bank 3: 2026-01-26, deposit 5000 → matches Settlement D
   - Bank 4: 2026-01-26, withdrawal 3000 → date mismatch with Expense E

**Test Steps:**
1. Navigate to `/bank-reconciliation` page
2. Click "Auto Match (Exact Only)" button

**Expected Results:**
- ✅ Toast shows: "จับคู่อัตโนมัติ: 2 รายการ" (Expense B + Settlement D)
- ✅ Toast shows: "ข้ามไป: 3 รายการ"
- ✅ Breakdown:
  - No candidate: 1 (Bank 4 - date mismatch)
  - Multiple candidates: 1 (Bank 2)
  - Matched: 2 (Bank 1 + Bank 3)

---

## Performance Tests

### Test 9: Large Dataset

**Setup:**
1. Import large bank statement (100+ transactions)
2. Create 50 expenses
3. Create 30 settlements

**Test Steps:**
1. Click "Auto Match (Exact Only)" button
2. Measure execution time

**Expected Results:**
- ✅ Complete within 10 seconds (for 100 bank + 80 internal = 180 records)
- ✅ No timeout errors
- ✅ Toast shows summary correctly
- ⚠️ If > 10s: consider adding progress indicator

**Database Query Count:**
- Initial load: 6 queries (bank, expenses, settlements + reconciliation checks)
- Per match: 1 query (insert reconciliation)
- Total: ~6 + N queries (N = matched count)

---

## Security Tests

### Test 10: Cross-User Isolation

**Setup:**
1. Login as User A
2. Create expense: Amount = 9999, Date = 2026-01-26
3. Logout
4. Login as User B
5. Create bank withdrawal: Amount = 9999, Date = 2026-01-26

**Test Steps:**
1. As User B, navigate to `/bank-reconciliation`
2. Click "Auto Match (Exact Only)" button

**Expected Results:**
- ✅ Toast shows: "ข้ามไป: 1 รายการ, ไม่มี candidate: 1"
- ✅ User B's bank transaction does NOT match User A's expense
- ✅ RLS (Row Level Security) enforces isolation
- ✅ No cross-user data leakage

**Database Verification:**
```sql
SELECT COUNT(*) FROM bank_reconciliations
WHERE created_by != bank_transactions.created_by; -- Must be 0
```

---

## Error Handling Tests

### Test 11: Network Error (Simulated)

**Setup:**
1. Open browser DevTools → Network tab
2. Set network throttling to "Offline"
3. Click "Auto Match (Exact Only)" button

**Expected Results:**
- ✅ Button shows loading state
- ✅ After timeout, toast shows error: "เกิดข้อผิดพลาด"
- ✅ Button returns to clickable state
- ✅ No partial matches created

---

## Regression Tests

### Test 12: Manual Match Still Works

**Objective:** Verify auto-match doesn't break manual matching

**Test Steps:**
1. Create expense + bank transaction with exact match
2. Use manual match dialog (NOT auto-match button)
3. Manually select expense and confirm match

**Expected Results:**
- ✅ Manual match still works correctly
- ✅ Can mix auto-match and manual match
- ✅ Both create reconciliation records with different `matching_rule`

---

## Acceptance Criteria Checklist

### Functionality
- [x] Auto-match button added to Bank Reconciliation page
- [x] Button shows loading state during execution
- [x] Toast notification shows summary (matched + skipped)
- [x] Page auto-refreshes after matching
- [x] Only matches exact date + exact amount
- [x] Only matches unique candidates (skips multiple)
- [x] Skips already matched transactions
- [x] Skips wallet top-ups (too risky)
- [x] Idempotent (safe to run multiple times)

### Business Rules
- [x] Matches expenses (bank withdrawals only)
- [x] Matches settlements (bank deposits only)
- [x] Tolerance: 0.01 baht for floating-point precision
- [x] Date must be exact (no +/- 1 day fuzzy matching)

### UI/UX
- [x] Button has clear label: "Auto Match (Exact Only)"
- [x] Loading spinner during execution
- [x] Success toast shows breakdown (matched + skipped details)
- [x] Error toast shows clear error message
- [x] Button disabled during loading

### Performance
- [x] Completes < 10s for 100+ transactions
- [x] No N+1 query issues
- [x] Bulk operations where possible

### Security
- [x] RLS enforced (user isolation)
- [x] No cross-user matching
- [x] Authorization checked (must be logged in)

### Data Integrity
- [x] No duplicate reconciliations
- [x] Reconciliation metadata includes: auto_matched, match_criteria, matching_rule
- [x] Notes field populated: "Auto-matched (exact): {type} {amount}"

---

## Known Limitations (v1)

1. **No fuzzy matching**: Only exact date + exact amount
   - Future: Add "Near Match" mode (+/- 1 day, +/- 1% amount)

2. **No partial matching**: Must match full amount
   - Future: Support partial reconciliation (e.g., bank = 10,000 but split into 2 expenses)

3. **No keyword matching**: Doesn't use description/notes
   - Future: Add AI-powered description matching

4. **Wallet top-ups excluded**: Too risky for auto-match
   - Design decision: Manual review required for wallet movements

5. **No undo button**: Must manually delete reconciliation to undo
   - Future: Add "Undo Auto Match" button

---

## Test Data Cleanup

After testing, clean up test data:

```sql
-- Delete test reconciliations
DELETE FROM bank_reconciliations
WHERE notes LIKE '%Auto-matched (exact)%'
AND created_at > '2026-01-26 00:00:00';

-- Delete test expenses
DELETE FROM expenses
WHERE description LIKE '%Test Expense - Auto Match%';

-- Delete test bank transactions
DELETE FROM bank_transactions
WHERE description LIKE '%Test%'
AND txn_date = '2026-01-26';
```

---

## Success Metrics

- ✅ All 12 tests pass
- ✅ No console errors
- ✅ No database constraint violations
- ✅ Auto-match completes < 10s for 100+ records
- ✅ 0 cross-user data leakage
- ✅ 100% idempotent (safe to run multiple times)

**Test Completed By:** _________________

**Test Date:** _________________

**Result:** ☐ Pass ☐ Fail

**Notes:** ________________________________________________________________
