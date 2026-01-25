# Manual Bank Reconciliation QA Checklist
Created: 2026-01-26

## Overview
Manual testing checklist for Manual Bank Reconciliation Override feature.

---

## Pre-requisites
- [ ] Database migration-020 applied successfully
- [ ] Dev server running
- [ ] User logged in
- [ ] Bank account exists with transactions
- [ ] At least 3 unmatched bank transactions available
- [ ] Wallet (ADS, SUBSCRIPTION) exists
- [ ] Settlement transactions exist
- [ ] Expenses exist

---

## Test Scenario 1: Match to Settlement

**Setup:**
- Bank transaction: Deposit ฿5,000 on 2026-01-20
- Settlement transaction: ฿5,000 settled on 2026-01-20

**Steps:**
1. Navigate to `/bank-reconciliation`
2. Verify summary shows unmatched bank transaction
3. Click "Match" button on bank transaction
4. Modal opens with transaction details
5. Suggested matches section shows settlement with score 100
6. Select suggested settlement match
7. Add notes: "Matched to TikTok settlement"
8. Click "ยืนยัน"

**Expected:**
- ✅ Success toast appears
- ✅ Modal closes
- ✅ Unmatched list refreshes (transaction removed)
- ✅ Gap reduced by ฿5,000
- ✅ Database: bank_reconciliations record created with matched_type='settlement'

---

## Test Scenario 2: Create Expense

**Setup:**
- Bank transaction: Withdrawal ฿3,000 on 2026-01-21

**Steps:**
1. Click "Match" on withdrawal transaction
2. Modal opens
3. Select radio option "สร้าง Expense ใหม่"
4. Fill form:
   - Category: Advertising
   - Subcategory: Facebook Ads
   - Description: Campaign Jan 2026
   - Amount: 3000
5. Add notes: "Created from bank transaction"
6. Click "ยืนยัน"

**Expected:**
- ✅ Success toast appears
- ✅ Expense created in database (check /expenses page)
- ✅ Expense has source='bank_reconciliation'
- ✅ Audit log created for expense (CREATE action)
- ✅ bank_reconciliations record created with matched_type='expense'
- ✅ Gap reduced by ฿3,000

---

## Test Scenario 3: Create Wallet Top-up

**Setup:**
- Bank transaction: Withdrawal ฿10,000 on 2026-01-22
- Wallet: TikTok Ads wallet exists

**Steps:**
1. Click "Match" on withdrawal transaction
2. Select radio option "Wallet Top-up"
3. Fill form:
   - Select wallet: TikTok Ads
   - Amount: 10000
4. Add notes: "Top-up for ads campaign"
5. Click "ยืนยัน"

**Expected:**
- ✅ Success toast appears
- ✅ wallet_ledger entry created (entry_type=TOP_UP, direction=OUT, source=bank_reconciliation)
- ✅ Wallet balance updated (check /wallets page)
- ✅ bank_reconciliations record created with matched_type='wallet_topup'
- ✅ Gap reduced by ฿10,000

---

## Test Scenario 4: Create Wallet Spend (BLOCKED for ADS wallet)

**Setup:**
- Bank transaction: Withdrawal ฿2,000 on 2026-01-23
- Wallet: TikTok Ads wallet (wallet_type=ADS)

**Steps:**
1. Click "Match" on withdrawal transaction
2. Select radio option "Wallet Spend"
3. Fill form:
   - Select wallet: TikTok Ads (ADS type)
   - Amount: 2000
4. Click "ยืนยัน"

**Expected:**
- ❌ Error toast appears: "❌ ห้ามสร้าง SPEND แบบ Manual สำหรับ ADS Wallet (ต้อง import จาก report เท่านั้น)"
- ✅ No database changes
- ✅ Modal remains open
- ✅ Business rule enforced

---

## Test Scenario 5: Create Wallet Spend (ALLOWED for SUBSCRIPTION wallet)

**Setup:**
- Bank transaction: Withdrawal ฿500 on 2026-01-23
- Wallet: Foreign Subscriptions (wallet_type=SUBSCRIPTION)

**Steps:**
1. Click "Match" on withdrawal transaction
2. Select radio option "Wallet Spend"
3. Fill form:
   - Select wallet: Foreign Subscriptions
   - Amount: 500
4. Add notes: "Shopify monthly subscription"
5. Click "ยืนยัน"

**Expected:**
- ✅ Success toast appears
- ✅ wallet_ledger entry created (entry_type=SPEND, direction=OUT, source=bank_reconciliation)
- ✅ Wallet balance updated
- ✅ bank_reconciliations record created with matched_type='wallet_spend'
- ✅ Gap reduced by ฿500

---

## Test Scenario 6: Create Adjustment

**Setup:**
- Bank transaction: Withdrawal ฿50 on 2026-01-24 (bank fee)

**Steps:**
1. Click "Match" on bank fee transaction
2. Select radio option "ปรับปรุงบัญชี"
3. Fill form:
   - Type: bank_error
   - Notes: "Bank transaction fee - monthly maintenance"
4. Click "ยืนยัน"

**Expected:**
- ✅ Success toast appears
- ✅ bank_reconciliations record created with matched_type='adjustment', matched_record_id=null
- ✅ Metadata contains adjustment_type, withdrawal, deposit
- ✅ Gap unchanged (adjustment doesn't create internal record)

---

## Test Scenario 7: Ignore Transaction

**Setup:**
- Bank transaction: Deposit ฿1 on 2026-01-25 (interest)

**Steps:**
1. Click "Match" on interest transaction
2. Select radio option "ข้ามรายการนี้"
3. Fill form:
   - Reason: "Bank interest - not relevant for business cashflow"
4. Click "ยืนยัน"

**Expected:**
- ✅ Success toast appears
- ✅ bank_reconciliations record created with matched_type='ignore', matched_record_id=null
- ✅ Notes prefixed with "IGNORED:"
- ✅ Metadata contains ignore_reason
- ✅ Gap unchanged (ignore doesn't create internal record)

---

## Test Scenario 8: Validation - Missing Required Fields

**Test 8A: Create Expense without description**
1. Select "สร้าง Expense ใหม่"
2. Fill category, amount, but leave description empty
3. Click "ยืนยัน"
4. Expected: Error toast "กรุณากรอกรายละเอียด"

**Test 8B: Wallet Top-up without wallet selection**
1. Select "Wallet Top-up"
2. Leave wallet unselected
3. Click "ยืนยัน"
4. Expected: Error toast "กรุณาเลือก Wallet"

**Test 8C: Adjustment without notes**
1. Select "ปรับปรุงบัญชี"
2. Leave notes empty
3. Click "ยืนยัน"
4. Expected: Error toast "กรุณากรอกหมายเหตุ"

**Test 8D: Ignore without reason**
1. Select "ข้ามรายการนี้"
2. Leave reason empty
3. Click "ยืนยัน"
4. Expected: Error toast "กรุณากรอกเหตุผล"

---

## Test Scenario 9: Duplicate Reconciliation Prevention

**Setup:**
- Bank transaction already reconciled

**Steps:**
1. Try to click "Match" on already matched transaction
2. Modal opens
3. Attempt to submit any action
4. Expected: Error "Transaction already reconciled"

---

## Test Scenario 10: Gap Recalculation Accuracy

**Setup:**
- 5 bank transactions (3 deposits, 2 withdrawals)
- Bank Net = ฿10,000
- Internal Total = ฿8,000
- Gap = ฿2,000

**Steps:**
1. Match 1 bank deposit (฿5,000) to settlement
2. Verify gap updated to ฿2,000 - ฿5,000 = -฿3,000 (or recalculated correctly)
3. Create expense (฿1,000) from 1 bank withdrawal
4. Verify gap updated again
5. Ignore 1 transaction (฿100)
6. Verify gap remains unchanged (ignore doesn't affect gap)

**Expected:**
- ✅ Gap calculation accurate after each action
- ✅ Summary cards update in real-time
- ✅ Matched count increases

---

## Test Scenario 11: RLS Policy Verification

**Setup:**
- User A creates reconciliation
- User B logged in

**Steps:**
1. User A matches bank transaction
2. User B navigates to /bank-reconciliation
3. Verify User B does NOT see User A's bank transactions
4. Verify User B does NOT see User A's reconciliations

**Expected:**
- ✅ RLS enforced (users see own data only)

---

## Test Scenario 12: Immutable Audit Trail

**Setup:**
- Reconciliation record exists

**Steps:**
1. Attempt to UPDATE reconciliation via SQL (direct database)
2. Attempt to DELETE reconciliation via SQL
3. Expected: RLS blocks UPDATE/DELETE (only SELECT/INSERT allowed)

**SQL Test:**
```sql
-- Should FAIL (no UPDATE policy)
UPDATE bank_reconciliations SET notes = 'Modified' WHERE id = '...';

-- Should FAIL (no DELETE policy)
DELETE FROM bank_reconciliations WHERE id = '...';
```

**Expected:**
- ✅ Both queries blocked by RLS
- ✅ Audit trail remains immutable

---

## Test Scenario 13: Suggested Matches Accuracy

**Setup:**
- Bank deposit: ฿5,000 on 2026-01-20
- Settlement: ฿5,000 on 2026-01-20 (exact match)
- Settlement: ฿5,200 on 2026-01-21 (near match)
- Expense: ฿5,000 on 2026-01-22 (wrong direction, should not appear)

**Steps:**
1. Click "Match" on bank deposit
2. Suggested matches section appears

**Expected:**
- ✅ Settlement ฿5,000 appears with score 100 (exact match)
- ✅ Settlement ฿5,200 appears with score 80 (near match)
- ✅ Expense does NOT appear (wrong direction - deposit vs expense)
- ✅ Tabs show correct counts (Settlements: 2, Expenses: 0, Wallets: 0)

---

## Acceptance Criteria

### Database
- [ ] migration-020 applied without errors
- [ ] All indexes created
- [ ] RLS policies active
- [ ] No UPDATE/DELETE policies on bank_reconciliations

### Server Actions
- [ ] All 7 manual match functions work
- [ ] Business rules enforced (ADS wallet SPEND blocked)
- [ ] Validation errors clear and helpful
- [ ] Audit logs created for expenses
- [ ] Rollback logic works (expense deleted if reconciliation fails)

### UI
- [ ] Modal opens/closes correctly
- [ ] Suggested matches load and display
- [ ] All 6 action types selectable
- [ ] Forms validate before submission
- [ ] Loading states work
- [ ] Success/error toasts appear
- [ ] Unmatched list refreshes after match

### Business Logic
- [ ] Gap recalculation accurate
- [ ] Matched count updates
- [ ] Internal totals update after creating expense/wallet
- [ ] Adjustment/Ignore do not affect gap (expected behavior)

### Edge Cases
- [ ] Duplicate reconciliation prevented
- [ ] Missing required fields validated
- [ ] RLS enforced (users see own data only)
- [ ] Immutable audit trail (no UPDATE/DELETE)
- [ ] ADS wallet SPEND blocked
- [ ] SUBSCRIPTION wallet SPEND allowed

---

## Sign-off

**Tester:** _______________________
**Date:** _______________________
**Status:** [ ] PASS / [ ] FAIL
**Notes:**

