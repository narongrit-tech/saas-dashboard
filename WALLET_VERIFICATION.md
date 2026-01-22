# Wallet System - Manual Verification Checklist

**Created:** 2026-01-23 (Phase 3 - Multi-Wallet Foundation)
**Purpose:** Verify wallet system functionality and business rules enforcement

---

## Prerequisites

Before testing, ensure you have:
- [ ] Run `migration-005-wallets.sql` in Supabase
- [ ] Run `migration-005-wallets-seed.sql` to create initial wallets
- [ ] Logged in to the application
- [ ] Verified 2 wallets exist: TikTok Ads Wallet, Foreign Subscriptions

---

## 1. Database Schema Verification

### 1.1 Check Tables Exist
- [ ] `wallets` table exists with correct columns
- [ ] `wallet_ledger` table exists with correct columns
- [ ] RLS policies are enabled on both tables
- [ ] Indexes are created

**SQL to verify:**
```sql
-- Check wallets table
SELECT * FROM wallets LIMIT 1;

-- Check wallet_ledger table
SELECT * FROM wallet_ledger LIMIT 1;

-- Check RLS enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('wallets', 'wallet_ledger');
```

### 1.2 Check Seed Data
- [ ] TikTok Ads Wallet exists (`wallet_type=ADS`)
- [ ] Foreign Subscriptions wallet exists (`wallet_type=SUBSCRIPTION`)
- [ ] Both wallets are `is_active=true`

---

## 2. UI Basic Functionality

### 2.1 Wallet Selection
- [ ] Navigate to `/wallets` page
- [ ] Wallet dropdown shows 2 wallets
- [ ] Can select TikTok Ads Wallet
- [ ] Can select Foreign Subscriptions wallet
- [ ] Balance summary cards display (even if empty)

### 2.2 Empty State
- [ ] With no ledger entries, table shows "ไม่พบข้อมูล"
- [ ] Balance cards show ฿0.00
- [ ] Export button is disabled when no data

---

## 3. ADS Wallet - Business Rules (CRITICAL)

### 3.1 Top-up Entry (ALLOWED)
- [ ] Select "TikTok Ads Wallet"
- [ ] Click "Add Entry"
- [ ] Set Entry Type = "Top-up"
- [ ] Direction auto-sets to "IN"
- [ ] Enter amount = ฿10,000
- [ ] Entry saves successfully
- [ ] Balance card shows +฿10,000

### 3.2 Manual SPEND Entry (BLOCKED ❌)
- [ ] Select "TikTok Ads Wallet"
- [ ] Click "Add Entry"
- [ ] Set Entry Type = "Spend"
- [ ] See **Warning message**: "⚠️ ADS Wallet SPEND entries must be imported from Ads Report only"
- [ ] Direction auto-sets to "OUT"
- [ ] Enter amount = ฿5,000
- [ ] Click "เพิ่มรายการ"
- [ ] **Verify Error:** "❌ ห้ามสร้าง SPEND แบบ Manual สำหรับ ADS Wallet"
- [ ] Entry is NOT created

**Expected:** System blocks manual SPEND for ADS wallet

### 3.3 Refund Entry (ALLOWED)
- [ ] Select "TikTok Ads Wallet"
- [ ] Click "Add Entry"
- [ ] Set Entry Type = "Refund"
- [ ] Direction auto-sets to "IN"
- [ ] Enter amount = ฿500
- [ ] Note: "Refund from platform"
- [ ] Entry saves successfully
- [ ] Balance increases by ฿500

### 3.4 Adjustment Entry (ALLOWED)
- [ ] Select "TikTok Ads Wallet"
- [ ] Click "Add Entry"
- [ ] Set Entry Type = "Adjustment"
- [ ] Direction dropdown is ENABLED (can choose IN or OUT)
- [ ] Try with direction = IN, amount = ฿100
- [ ] Entry saves successfully
- [ ] Try with direction = OUT, amount = ฿50
- [ ] Entry saves successfully

---

## 4. SUBSCRIPTION Wallet - Business Rules

### 4.1 Top-up Entry (ALLOWED)
- [ ] Select "Foreign Subscriptions"
- [ ] Click "Add Entry"
- [ ] Set Entry Type = "Top-up"
- [ ] Enter amount = ฿5,000
- [ ] Entry saves successfully

### 4.2 Manual SPEND Entry (ALLOWED ✅)
- [ ] Select "Foreign Subscriptions"
- [ ] Click "Add Entry"
- [ ] Set Entry Type = "Spend"
- [ ] **No warning message** (unlike ADS wallet)
- [ ] Enter amount = ฿599
- [ ] Note: "ChatGPT Plus monthly"
- [ ] Entry saves successfully ✅
- [ ] Balance decreases by ฿599

**Expected:** Manual SPEND is allowed for SUBSCRIPTION wallet

### 4.3 Multiple Subscription Entries
Create several subscription entries:
- [ ] GSuite: ฿360
- [ ] Canva Pro: ฿450
- [ ] Domain renewal: ฿500
- [ ] All entries save successfully

---

## 5. Balance Calculation Verification

### 5.1 Opening Balance
- [ ] Add entries on different dates
- [ ] Set date filter to exclude some entries
- [ ] Verify "Opening Balance" = sum of entries before start date
- [ ] Verify calculation: IN entries add, OUT entries subtract

### 5.2 Balance Summary Cards
- [ ] **Opening Balance**: Correct value
- [ ] **Total IN**: Sum of all IN entries in date range
- [ ] **Total OUT**: Sum of all OUT entries in date range
- [ ] **Closing Balance**: Opening + IN - OUT
- [ ] **Net Change**: IN - OUT

### 5.3 Breakdown by Entry Type
- [ ] Top-up total displays correctly under "Total IN"
- [ ] Spend total displays correctly under "Total OUT"
- [ ] Refund total displays (if any)
- [ ] Numbers match manual calculation

---

## 6. Edit Functionality

### 6.1 Edit Manual Entry
- [ ] Click pencil icon on a manual entry
- [ ] Edit dialog opens with pre-filled data
- [ ] Can change date, amount, note
- [ ] Cannot change wallet_id
- [ ] Save works correctly
- [ ] Table refreshes with new values

### 6.2 Edit IMPORTED Entry (BLOCKED ❌)
For this test, you would need to:
1. Manually insert an IMPORTED entry via SQL (or wait for Ads import feature)
2. Verify edit button is **disabled** for imported entries
3. If clicked, shows message: "Cannot Edit Imported Entry"

**SQL to manually create imported entry (for testing):**
```sql
-- Create test import batch first
INSERT INTO import_batches (marketplace, report_type, row_count, status, created_by)
VALUES ('TikTok', 'ads_daily', 1, 'success', auth.uid())
RETURNING id;

-- Use the returned ID in next query
INSERT INTO wallet_ledger (
  wallet_id, date, entry_type, direction, amount,
  source, import_batch_id, created_by
)
VALUES (
  '[TikTok Ads Wallet ID]',
  '2026-01-23',
  'SPEND',
  'OUT',
  3000.00,
  'IMPORTED',
  '[batch ID from above]',
  auth.uid()
);
```

- [ ] Verify edit button is disabled
- [ ] Verify error message if attempted

---

## 7. Delete Functionality

### 7.1 Delete Manual Entry
- [ ] Click trash icon on a manual entry
- [ ] Confirmation dialog appears
- [ ] Shows entry details
- [ ] Click "ยืนยันการลบ"
- [ ] Entry is deleted
- [ ] Table refreshes
- [ ] Balance recalculates correctly

### 7.2 Delete IMPORTED Entry (BLOCKED ❌)
- [ ] Delete button is **disabled** for imported entries
- [ ] If clicked, shows error: "ไม่สามารถลบรายการที่ import มาได้"

---

## 8. Filters and Pagination

### 8.1 Date Range Filter
- [ ] Set "วันที่เริ่มต้น" = today - 7 days
- [ ] Set "วันที่สิ้นสุด" = today
- [ ] Table shows only entries within range
- [ ] Balance summary updates
- [ ] Export respects date filter

### 8.2 Entry Type Filter
- [ ] Set Entry Type = "Top-up"
- [ ] Table shows only TOP_UP entries
- [ ] Set Entry Type = "Spend"
- [ ] Table shows only SPEND entries
- [ ] Set Entry Type = "ทั้งหมด"
- [ ] Table shows all entries

### 8.3 Source Filter
- [ ] Set Source = "Manual"
- [ ] Table shows only manual entries
- [ ] Set Source = "Imported"
- [ ] Table shows only imported entries (if any)

### 8.4 Pagination
- [ ] Create 25+ entries
- [ ] Verify pagination appears
- [ ] Click "ถัดไป" to go to page 2
- [ ] Click "ก่อนหน้า" to go back
- [ ] Verify "แสดง X ถึง Y จากทั้งหมด Z รายการ"

---

## 9. CSV Export

### 9.1 Export All Data
- [ ] Clear all filters
- [ ] Click "Export CSV"
- [ ] File downloads with name: `wallet-tiktok-ads-wallet-YYYYMMDD-HHmmss.csv`
- [ ] Open in Excel/Google Sheets
- [ ] Verify columns: Date, Entry Type, Direction, Amount, Source, Reference ID, Note, Created At
- [ ] Verify all rows are present

### 9.2 Export with Filters
- [ ] Set date range filter
- [ ] Set entry_type = "Top-up"
- [ ] Click "Export CSV"
- [ ] Verify exported file contains only filtered data
- [ ] Verify row count matches table display

### 9.3 CSV Format
- [ ] Thai characters display correctly
- [ ] Amounts show 2 decimal places
- [ ] Dates in YYYY-MM-DD format
- [ ] No broken rows (commas handled correctly)

---

## 10. Security & RLS

### 10.1 User Isolation (RLS)
For this test, you need 2 users:

**User A:**
- [ ] Create wallet entries
- [ ] Note down entry IDs

**User B (different account):**
- [ ] Login as User B
- [ ] Cannot see User A's wallets
- [ ] Cannot see User A's ledger entries
- [ ] Cannot edit/delete User A's entries

**Expected:** Each user only sees their own data

### 10.2 Authentication Required
- [ ] Logout
- [ ] Try to access `/wallets` directly
- [ ] Should redirect to login (middleware protection)
- [ ] Direct API calls should fail with auth error

---

## 11. Business Logic Integration Tests

### 11.1 P&L vs Cashflow Separation
**Scenario:** Top-up ADS wallet, then have some ad spend (imported)

1. Create TOP_UP ฿10,000 to ADS wallet on Day 1
2. (Manually insert) IMPORTED SPEND ฿3,000 on Day 2

**Verify:**
- [ ] Wallet closing balance = ฿7,000
- [ ] Cashflow page shows -฿10,000 on Day 1 (top-up is cash out)
- [ ] Daily P&L page shows -฿3,000 advertising cost (only imported spend)
- [ ] Top-up does NOT appear in P&L expenses

### 11.2 Subscription Spend in P&L
**Scenario:** Monthly subscription payment

1. Create TOP_UP ฿5,000 to SUBSCRIPTION wallet
2. Create SPEND ฿599 for ChatGPT Plus (manual)

**Verify:**
- [ ] Wallet closing balance = ฿4,401
- [ ] Both top-up AND spend appear in Cashflow (actual cash out)
- [ ] Only spend (฿599) should eventually appear in P&L Operating expenses
  *(Note: This may require future enhancement to link wallet spend to P&L)*

---

## 12. Edge Cases & Error Handling

### 12.1 Negative Amounts
- [ ] Try to enter amount = -100
- [ ] Client validation prevents negative entry
- [ ] Server rejects if bypassed

### 12.2 Zero Amount
- [ ] Try to enter amount = 0
- [ ] Error: "จำนวนเงินต้องมากกว่า 0"

### 12.3 Missing Required Fields
- [ ] Try to submit without date
- [ ] Error shown
- [ ] Try to submit without amount
- [ ] Error shown

### 12.4 Invalid Date
- [ ] Try to enter date in future
- [ ] Should be allowed (for scheduling)
- [ ] Try very old date (e.g., 1900-01-01)
- [ ] Should be allowed but log warning

### 12.5 Large Dataset
- [ ] Create 100+ entries
- [ ] Verify pagination works
- [ ] Verify export works (with 10,000 limit)
- [ ] Verify balance calculation still accurate

### 12.6 Concurrent Edits
- [ ] Open edit dialog for entry A
- [ ] In another tab, delete entry A
- [ ] Try to save edit in first tab
- [ ] Should show error: "ไม่พบรายการที่ต้องการแก้ไข"

---

## 13. UI/UX Quality Checks

### 13.1 Loading States
- [ ] Balance loading shows skeleton/spinner
- [ ] Table loading shows skeleton rows
- [ ] Export button shows "Exporting..." during export

### 13.2 Error Messages
- [ ] Errors display in red alert box
- [ ] Error messages are in Thai and clear
- [ ] Errors auto-clear on successful action

### 13.3 Success Feedback
- [ ] Success toast shows "สำเร็จ" after add
- [ ] Success toast shows "แก้ไขรายการสำเร็จ" after edit
- [ ] Table refreshes automatically after CRUD

### 13.4 Responsive Design
- [ ] Test on mobile viewport (375px)
- [ ] Filters stack vertically
- [ ] Table scrolls horizontally
- [ ] Dialogs fit on small screens

---

## 14. Documentation Verification

### 14.1 Business Rules Doc
- [ ] Read `WALLET_BUSINESS_RULES.md`
- [ ] Verify all rules mentioned are enforced in code
- [ ] Verify "2 views" concept is clear
- [ ] Verify validation matrix matches implementation

### 14.2 Code Comments
- [ ] Check `wallets/actions.ts` has clear comments
- [ ] Validation functions have explanatory comments
- [ ] Critical business rules are marked with **CRITICAL**

---

## 15. TypeScript Compilation

### 15.1 No Type Errors
- [ ] Run `npm run build` or `tsc --noEmit`
- [ ] No TypeScript errors in wallet-related files
- [ ] No ESLint warnings

---

## Sign-Off Checklist

**Minimum Tests for Production:**
- [ ] ADS wallet BLOCKS manual SPEND ✅
- [ ] SUBSCRIPTION wallet ALLOWS manual SPEND ✅
- [ ] Top-up entries create successfully
- [ ] Balance calculation is accurate
- [ ] Cannot edit/delete IMPORTED entries
- [ ] RLS isolates user data
- [ ] CSV export works with filters
- [ ] Business rules documented and enforced

---

## Test Results

**Tester Name:** ___________________
**Test Date:** ___________________
**All Tests Passed:** [ ] Yes [ ] No

**Critical Issues Found:**
1. ___________________________________
2. ___________________________________

**Non-Critical Issues:**
1. ___________________________________
2. ___________________________________

**Notes:**
___________________________________________
___________________________________________

---

## Troubleshooting

### If ADS wallet manual SPEND is not blocked:
1. Check `wallets/actions.ts` - `validateLedgerEntry()` function
2. Verify wallet_type is correctly set to 'ADS'
3. Check server logs for validation errors

### If balance calculation is wrong:
1. Check `lib/wallet-balance.ts` - `calculateWalletBalance()` function
2. Verify IN entries add, OUT entries subtract
3. Check for NaN or null amount values

### If RLS not working:
1. Verify RLS is enabled: `ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;`
2. Check policies exist and reference `auth.uid()`
3. Test with `SELECT ... FROM wallet_ledger` while logged in

---

**Last Updated:** 2026-01-23
**Version:** 1.0 (Multi-Wallet Foundation)
