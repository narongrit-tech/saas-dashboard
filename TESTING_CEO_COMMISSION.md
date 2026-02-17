# CEO Commission Flow - Testing Guide

**Feature:** CEO Commission + Bank Source Integration
**Date:** 2026-02-18
**Migrations:** 058, 059

---

## Pre-requisites

### 1. Run Migrations
```sql
-- In Supabase SQL Editor:
-- 1. Run migration-058-ceo-commission.sql
-- 2. Run migration-059-ceo-commission-bank-sources.sql
```

**Verify:**
```sql
-- Check tables created
SELECT tablename FROM pg_tables
WHERE tablename IN ('ceo_commission_receipts', 'ceo_commission_sources');

-- Check RLS enabled
SELECT tablename, rowsecurity FROM pg_tables
WHERE tablename IN ('ceo_commission_receipts', 'ceo_commission_sources');

-- Check DIRECTOR_LOAN wallet type
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'wallets_wallet_type_valid';
-- Should include 'DIRECTOR_LOAN'
```

### 2. Create DIRECTOR_LOAN Wallet
1. Navigate to `/wallets`
2. Click "สร้าง Wallet ใหม่"
3. Fill:
   - **Name:** Director Loan - CEO to Company
   - **Type:** DIRECTOR_LOAN
   - **Currency:** THB
   - **Description:** Director loan from CEO commission transfers
4. Click Save

**Verify:** Wallet appears in list with type DIRECTOR_LOAN

### 3. Import Bank Statements
Import bank statements into at least 2 different bank accounts with:
- Multiple incoming transactions (deposit > 0)
- Various amounts and dates
- At least 3-5 transactions per account

---

## Test Suite

### Test 1: Bank Source Selection 🎯

**Objective:** Configure which bank accounts are CEO commission sources

**Steps:**
1. Navigate to `/ceo-commission`
2. Find "แหล่งเงิน CEO Commission (บัญชีต้นทาง)" card
3. Initially: Should show all bank accounts unchecked
4. Select **only Bank Account A** (checkbox)
5. Click "บันทึก"

**Expected:**
- ✅ Success toast: "บันทึกแหล่งเงิน Commission สำเร็จ (1 บัญชี)"
- ✅ Card shows "(1 บัญชี)" badge
- ✅ Selected account has green checkmark

**Verify Database:**
```sql
SELECT cs.*, ba.bank_name, ba.account_number
FROM ceo_commission_sources cs
JOIN bank_accounts ba ON ba.id = cs.bank_account_id
WHERE cs.created_by = auth.uid();
-- Should return 1 row for Bank A
```

---

### Test 2: Import from Bank - Candidate Filtering 🎯

**Objective:** Verify only transactions from selected sources appear

**Steps:**
1. Click "ดึงจากธนาคาร" button
2. Dialog opens - Step 1: Filter
3. Leave date range empty (or set range)
4. Click "ดูรายการ"

**Expected:**
- ✅ Dialog shows Step 2: Transaction list
- ✅ **Only transactions from Bank Account A** appear
- ✅ Transactions from Bank Account B **DO NOT** appear
- ✅ Only deposit > 0 transactions shown
- ✅ Transactions already declared as commission **DO NOT** appear

**If no transactions appear:**
- Check: Are there deposits in Bank A?
- Check: Have all deposits been declared already?
- Check: Is Bank A properly selected in sources?

---

### Test 3: Declare Commission from Bank Transaction 🎯

**Objective:** Link bank transaction to commission record + auto-create wallet TOP_UP

**Setup:** Select Bank A in sources (from Test 1)

**Steps:**
1. Click "ดึงจากธนาคาร"
2. Click "ดูรายการ"
3. Select a transaction with deposit = 10,000 THB
4. Dialog shows Step 3: Declaration form
5. Fill:
   - **วันที่รับ Commission:** (pre-filled from txn date - leave as is)
   - **Platform:** TikTok
   - **Commission (Gross):** 10000 (pre-filled)
   - **ใช้ส่วนตัว:** 3000
   - **โอนให้บริษัท:** 7000 (auto-calculated)
   - **หมายเหตุ:** "ทดสอบระบบ Bank Integration"
6. Click "Declare Commission"

**Expected:**
- ✅ Success toast: "Declare Commission สำเร็จ"
- ✅ Dialog closes
- ✅ Main page refreshes, showing new commission record in table
- ✅ Summary cards update:
  - Commission ทั้งหมด: +10,000
  - ใช้ส่วนตัว: +3,000
  - โอนให้บริษัท: +7,000
  - Director Loan Balance: +7,000

**Verify Database:**
```sql
-- Check commission receipt created
SELECT * FROM ceo_commission_receipts
WHERE bank_transaction_id IS NOT NULL
ORDER BY created_at DESC LIMIT 1;
-- Should have bank_transaction_id populated

-- Check wallet_ledger entry created
SELECT * FROM wallet_ledger
WHERE reference_id LIKE 'CEO_COMMISSION:%'
ORDER BY created_at DESC LIMIT 1;
-- Should be:
-- - entry_type = TOP_UP
-- - direction = IN
-- - amount = 7000
-- - wallet_id = DIRECTOR_LOAN wallet
```

---

### Test 4: Idempotency - Block Duplicate Declaration 🎯

**Objective:** Cannot declare the same bank transaction twice

**Steps:**
1. Click "ดึงจากธนาคาร" again
2. Click "ดูรายการ"
3. **Expected:** The transaction from Test 3 **DOES NOT appear** in list
4. Try to manually create commission with same bank_transaction_id (via API or SQL)

**Expected:**
- ✅ Transaction does NOT appear in candidate list (filtered out)
- ✅ If forced via SQL: unique constraint violation error
- ✅ User sees clear error message: "รายการธนาคารนี้ถูก declare เป็น Commission ไปแล้ว"

**Verify:**
```sql
-- Try to insert duplicate (should fail)
INSERT INTO ceo_commission_receipts (
  commission_date,
  platform,
  gross_amount,
  personal_used_amount,
  transferred_to_company_amount,
  bank_transaction_id,
  created_by
) VALUES (
  '2026-02-18',
  'Test',
  1000,
  0,
  1000,
  '<bank_transaction_id_from_test3>',
  auth.uid()
);
-- Should fail with: duplicate key value violates unique constraint
```

---

### Test 5: Company Cashflow Integration 🎯 **CRITICAL**

**Objective:** Director Loan TOP_UP = Cash IN (not OUT)

**Steps:**
1. Navigate to `/company-cashflow`
2. Select date range covering Test 3 commission date
3. Find the date with the commission

**Expected:**
- ✅ **Cash IN** increases by 7,000 (transferred_to_company_amount)
- ✅ **NOT Cash OUT** (this was the bug we fixed!)
- ✅ Running balance updates correctly
- ✅ Net = Cash IN - Cash OUT shows correct calculation

**Verify Logic:**
```sql
-- Check wallet_ledger entry
SELECT wl.*, w.wallet_type
FROM wallet_ledger wl
JOIN wallets w ON w.id = wl.wallet_id
WHERE wl.reference_id LIKE 'CEO_COMMISSION:%';
-- wallet_type should be DIRECTOR_LOAN
-- entry_type = TOP_UP, direction = IN
```

**Company Cashflow should treat this as:**
- DIRECTOR_LOAN + TOP_UP + IN = **Cash IN to company** ✅
- NOT Cash OUT ❌

---

### Test 6: P&L NOT Affected 🎯 **CRITICAL**

**Objective:** Director Loan does NOT appear in P&L (it's a liability, not revenue)

**Steps:**
1. Navigate to `/daily-pl`
2. Select the same date as Test 3 commission
3. Check P&L columns

**Expected:**
- ✅ Revenue unchanged (no increase from commission)
- ✅ Net Profit unchanged
- ✅ Director Loan amount **DOES NOT appear** anywhere in P&L
- ✅ P&L calculations remain accurate

**Explanation:**
- CEO Commission is NOT company revenue
- It's a personal income that CEO chooses to loan to company
- Accounting: Director Loan = Liability (Balance Sheet)
- P&L only includes: Revenue, COGS, Expenses

---

### Test 7: Manual Add Commission (No Bank Link) 🎯

**Objective:** Manual entries still work (bank_transaction_id = null)

**Steps:**
1. Click "เพิ่มด้วยตัวเอง" button
2. Fill form:
   - **วันที่:** 2026-02-17
   - **Platform:** Shopee
   - **Commission:** 5000
   - **ใช้ส่วนตัว:** 2000
   - **โอนให้บริษัท:** 3000
   - **หมายเหตุ:** "Manual entry test"
3. Click "บันทึก"

**Expected:**
- ✅ Success toast
- ✅ Record created with bank_transaction_id = NULL
- ✅ Director Loan wallet TOP_UP still created (3000)
- ✅ Summary cards update correctly

**Verify:**
```sql
SELECT * FROM ceo_commission_receipts
WHERE bank_transaction_id IS NULL
ORDER BY created_at DESC LIMIT 1;
-- Should exist with manual data
```

---

### Test 8: Export CSV with Bank Columns 🎯

**Objective:** Export includes bank account info

**Steps:**
1. On `/ceo-commission` page
2. Apply any filters (optional)
3. Click "ส่งออก CSV"
4. Open downloaded file

**Expected:**
- ✅ File downloads: `ceo_commission_YYYYMMDD_HHMMSS.csv`
- ✅ Headers include (in order):
  - วันที่รับ Commission
  - Platform
  - ยอดรวม (Gross)
  - ใช้ส่วนตัว
  - โอนให้บริษัท
  - **บัญชีธนาคาร** ← NEW
  - **Bank Txn Ref** ← NEW
  - หมายเหตุ
  - Reference
  - สร้างเมื่อ
- ✅ Data rows match filtered results
- ✅ Bank-linked rows show: "BankName - AccountNumber"
- ✅ Manual rows show: "Manual Entry"
- ✅ Thai characters display correctly (UTF-8 BOM)

---

### Test 9: Multi-Source Selection 🎯

**Objective:** Can select multiple bank accounts as sources

**Steps:**
1. Go to Settings section
2. Select **both Bank A and Bank B** (checkboxes)
3. Click "บันทึก"
4. Click "ดึงจากธนาคาร"
5. Click "ดูรายการ"

**Expected:**
- ✅ Transactions from **both Bank A and Bank B** appear
- ✅ Transactions properly filtered (deposit > 0, not declared)
- ✅ Can select and declare from either account

---

### Test 10: Empty State - No Sources Selected 🎯

**Objective:** Clear guidance when no sources configured

**Steps:**
1. Go to Settings section
2. **Uncheck all** bank accounts
3. Click "บันทึก"
4. Click "ดึงจากธนาคาร"
5. Click "ดูรายการ"

**Expected:**
- ✅ Error message: "กรุณาเลือกบัญชีธนาคารที่เป็นแหล่งเงิน Commission ก่อน"
- ✅ No transactions shown
- ✅ Settings card shows empty state instruction

---

### Test 11: Wallet TOP_UP Idempotency 🎯

**Objective:** Cannot create duplicate wallet ledger entry

**Setup:** Use commission from Test 3

**Steps:**
1. Get commission receipt ID from Test 3
2. Try to manually insert wallet_ledger with same reference_id:

```sql
-- This should be blocked by application logic (not by DB constraint)
-- The reference_id 'CEO_COMMISSION:<receipt_id>' should be checked before insert
```

**Expected:**
- ✅ Application checks for existing wallet_ledger entry
- ✅ Skips creation if reference_id already exists
- ✅ User does not see error (silent idempotency)

**Verify:**
```sql
SELECT COUNT(*) FROM wallet_ledger
WHERE reference_id = 'CEO_COMMISSION:<receipt_id>';
-- Should return 1 (not 2 or more)
```

---

### Test 12: Director Loan Balance Calculation 🎯

**Objective:** Balance reflects total transferred amounts

**Steps:**
1. View CEO Commission page summary cards
2. Note "Director Loan Balance" value
3. Navigate to `/wallets`
4. Open DIRECTOR_LOAN wallet
5. Check ledger entries and balance

**Expected:**
- ✅ Director Loan Balance on CEO Commission page = Wallet balance
- ✅ Calculation: SUM(amount WHERE direction='IN') - SUM(amount WHERE direction='OUT')
- ✅ Balance matches sum of all transferred_to_company_amount from receipts

**Verify:**
```sql
-- Manual calculation
SELECT SUM(transferred_to_company_amount) as expected_balance
FROM ceo_commission_receipts
WHERE created_by = auth.uid();

-- Compare with wallet balance
SELECT wl.wallet_id, SUM(
  CASE WHEN wl.direction = 'IN' THEN wl.amount ELSE -wl.amount END
) as actual_balance
FROM wallet_ledger wl
JOIN wallets w ON w.id = wl.wallet_id
WHERE w.wallet_type = 'DIRECTOR_LOAN'
  AND w.created_by = auth.uid()
GROUP BY wl.wallet_id;
-- Should match expected_balance
```

---

## Edge Cases

### Edge 1: Zero Transfer Amount
**Scenario:** Commission where all is personal use (transfer = 0)

**Steps:**
1. Declare commission: gross=5000, personal=5000, transfer=0
2. Submit

**Expected:**
- ✅ Receipt created
- ✅ NO wallet_ledger entry created (because transfer = 0)
- ✅ Director Loan Balance unchanged

### Edge 2: Date Range Filtering
**Scenario:** Only show transactions within date range

**Steps:**
1. Import from bank with date range: 2026-02-01 to 2026-02-10
2. Verify only transactions within range shown

**Expected:**
- ✅ Transactions outside date range hidden
- ✅ Empty result if no transactions in range

### Edge 3: Validation Errors
**Scenario:** Gross ≠ Personal + Transferred

**Steps:**
1. Try to submit: gross=10000, personal=4000, transfer=5000 (sum=9000)

**Expected:**
- ✅ Validation error: "ยอดรวมไม่ตรง: 10000 ≠ 4000 + 5000"
- ✅ Submit button disabled
- ✅ Cannot save until fixed

---

## Acceptance Criteria Summary

- ✅ Bank source selection works (multi-select)
- ✅ Import from bank shows ONLY selected source transactions
- ✅ Declare commission creates receipt + wallet TOP_UP atomically
- ✅ Idempotency: cannot declare same transaction twice
- ✅ Idempotency: cannot create duplicate wallet TOP_UP
- ✅ Company Cashflow: DIRECTOR_LOAN TOP_UP = Cash IN ✅
- ✅ P&L: Unaffected by Director Loan ✅
- ✅ Export CSV includes bank columns
- ✅ Manual add still works (no bank link)
- ✅ Summary cards computed server-side, match data
- ✅ Build + typecheck pass
- ✅ No console errors
- ✅ RLS enforces user isolation

---

## Rollback Plan

If critical issues found:

```sql
-- Rollback migrations (in reverse order)
-- 1. Drop new objects from migration-059
DROP TABLE IF EXISTS ceo_commission_sources CASCADE;
ALTER TABLE ceo_commission_receipts DROP COLUMN IF EXISTS bank_transaction_id;

-- 2. Drop objects from migration-058 (if needed)
DROP TABLE IF EXISTS ceo_commission_receipts CASCADE;
ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_wallet_type_valid;
ALTER TABLE wallets ADD CONSTRAINT wallets_wallet_type_valid
  CHECK (wallet_type IN ('ADS', 'SUBSCRIPTION', 'OTHER'));
```

**Note:** This will delete all commission data. Export to CSV first if needed.

---

## Performance Notes

- All queries use proper indexes (created_by, bank_transaction_id, commission_date)
- RLS policies use indexed columns
- Pagination limits query size (20 per page)
- Export is server-side (not client-side processing)

---

## Security Verification

```sql
-- Test RLS isolation
-- Login as User A, create commission
-- Login as User B, should NOT see User A's data

SELECT * FROM ceo_commission_receipts;
-- Should only return current user's records

SELECT * FROM ceo_commission_sources;
-- Should only return current user's sources
```

---

**Testing Completed By:** _______________
**Date:** _______________
**Result:** PASS / FAIL
**Notes:** _______________
