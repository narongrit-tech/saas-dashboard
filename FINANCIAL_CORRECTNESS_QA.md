# Financial Correctness QA Checklist

**Purpose:** Verify that all financial calculations are correct and handle edge cases safely.
**Date:** 2026-01-19
**Status:** LONG-RUN HARDENING COMPLETE

---

## 1. DECIMAL PRECISION VERIFICATION

### Test: Floating Point Accuracy
**Scenario:** Add order with awkward decimal amounts

**Steps:**
1. Add sale: quantity=3, unit_price=10.33
2. Expected: total_amount = 30.99 (not 30.990000000001)
3. Verify P&L shows exactly 30.99

**Validation:**
- [ ] total_amount stored as 30.99
- [ ] P&L displays 30.99
- [ ] No floating point errors visible

**What to check in Supabase:**
```sql
SELECT total_amount FROM sales_orders WHERE order_id = 'MAN-...-001';
-- Should return exactly 30.99
```

---

## 2. NEGATIVE VALUE PROTECTION

### Test: Corrupted Negative Amount
**Scenario:** Data corruption introduces negative values (manual DB edit)

**Steps:**
1. Manually insert negative total_amount in Supabase
2. View Dashboard and Daily P&L
3. Expected: Negative value rejected, shows 0 instead

**Validation:**
- [ ] Dashboard doesn't show negative revenue
- [ ] P&L doesn't include negative amounts
- [ ] System remains stable

**Protection code location:**
- `lib/daily-pl.ts:63-67` (revenue)
- `lib/finance/marketplace-wallets.ts:67-71` (cash in)
- `app/(dashboard)/actions.ts:70-73` (dashboard sales)

---

## 3. CANCELLED ORDERS EXCLUSION

### Test 3.1: Cancelled Order - Revenue
**Scenario:** Cancelled orders must not affect revenue

**Steps:**
1. Add completed order: ฿10,000
2. Add pending order: ฿5,000
3. Add cancelled order: ฿3,000
4. View Dashboard and Daily P&L

**Expected Results:**
- Dashboard Revenue: ฿15,000
- Daily P&L Revenue: ฿15,000
- Cashflow Cash In: ฿10,000 (only completed)

**Validation:**
- [ ] Cancelled order not in revenue
- [ ] Dashboard correct
- [ ] P&L correct
- [ ] Cashflow correct (only completed)

### Test 3.2: Cancel Existing Order
**Scenario:** Change order from completed to cancelled

**Steps:**
1. Add completed order: ฿5,000
2. Note Dashboard revenue
3. Change order status to cancelled in Supabase
4. Refresh Dashboard

**Expected Results:**
- Revenue decreases by ฿5,000
- Cashflow decreases by ฿5,000

**Validation:**
- [ ] Revenue updated correctly
- [ ] Cashflow updated correctly

---

## 4. EMPTY DATA HANDLING

### Test 4.1: No Data at All
**Scenario:** Future date with no sales or expenses

**Steps:**
1. Select date far in future (e.g., 2027-12-31)
2. View Dashboard, Daily P&L, Cashflow

**Expected Results:**
- All values show ฿0.00
- No errors or null values
- UI displays cleanly

**Validation:**
- [ ] Dashboard: Sales ฿0.00, Expenses ฿0.00, Profit ฿0.00
- [ ] Daily P&L: All categories ฿0.00
- [ ] Cashflow: Cash In ฿0.00, Cash Out ฿0.00, Net ฿0.00
- [ ] No console errors
- [ ] No "NaN" displayed

### Test 4.2: Only Sales, No Expenses
**Scenario:** Day with sales but no expenses

**Steps:**
1. Add sale: ฿10,000
2. Add no expenses
3. View Daily P&L

**Expected Results:**
- Revenue: ฿10,000
- All expense categories: ฿0.00
- Net Profit: ฿10,000

**Validation:**
- [ ] Expenses show ฿0.00 (not null/undefined)
- [ ] Net Profit = Revenue

### Test 4.3: Only Expenses, No Sales
**Scenario:** Day with expenses but no sales

**Steps:**
1. Add no sales
2. Add expense: ฿2,000
3. View Daily P&L

**Expected Results:**
- Revenue: ฿0.00
- Expenses: ฿2,000
- Net Profit: -฿2,000 (loss)

**Validation:**
- [ ] Revenue shows ฿0.00 (not null/undefined)
- [ ] Loss displayed correctly (red)

---

## 5. DATE BOUNDARY CORRECTNESS

### Test 5.1: End of Day Boundary
**Scenario:** Order at 23:59 should count toward that day

**Steps:**
1. Manually insert order with timestamp: `2026-01-19T23:59:00+07:00`
2. View Dashboard for 2026-01-19
3. Expected: Order counted toward Jan 19

**Validation:**
- [ ] Order appears in Jan 19 stats
- [ ] Does not appear in Jan 20 stats

**Database Query:**
```sql
SELECT * FROM sales_orders
WHERE order_date >= '2026-01-19T00:00:00+07:00'
AND order_date <= '2026-01-19T23:59:59+07:00';
```

### Test 5.2: Start of Day Boundary
**Scenario:** Order at 00:00 should count toward that day

**Steps:**
1. Manually insert order with timestamp: `2026-01-20T00:00:00+07:00`
2. View Dashboard for 2026-01-20
3. Expected: Order counted toward Jan 20

**Validation:**
- [ ] Order appears in Jan 20 stats
- [ ] Does not appear in Jan 19 stats

---

## 6. EXPENSE CATEGORY SEGREGATION

### Test: Category Separation in P&L
**Scenario:** Expenses must be correctly split by category

**Steps:**
1. Add Advertising expense: ฿1,000
2. Add COGS expense: ฿2,000
3. Add Operating expense: ฿500
4. View Daily P&L

**Expected Results:**
- Advertising Cost: ฿1,000
- COGS: ฿2,000
- Operating Expenses: ฿500
- Total expenses in Dashboard: ฿3,500

**Validation:**
- [ ] P&L shows correct breakdown
- [ ] Dashboard total matches sum
- [ ] No category mixing

---

## 7. P&L VS CASHFLOW DIFFERENCE

### Test: Pending Sale Difference
**Scenario:** P&L includes pending, Cashflow only completed

**Steps:**
1. Add completed sale: ฿10,000
2. Add pending sale: ฿5,000
3. Add expenses: ฿3,000
4. View both Daily P&L and Cashflow

**Expected Results:**

| Metric | Daily P&L | Cashflow |
|--------|-----------|----------|
| Revenue/Cash In | ฿15,000 | ฿10,000 |
| Expenses/Cash Out | ฿3,000 | ฿3,000 |
| Net Profit/Change | ฿12,000 | ฿7,000 |

**Validation:**
- [ ] P&L Revenue = ฿15,000 (includes pending)
- [ ] Cashflow Cash In = ฿10,000 (only completed)
- [ ] Difference clearly visible
- [ ] Both calculations correct independently

---

## 8. 7-DAY TREND COMPLETENESS

### Test 8.1: All Days Present
**Scenario:** 7-day trend must show all 7 days

**Steps:**
1. Add sales only on 2 days out of last 7
2. View Dashboard trend chart

**Expected Results:**
- Chart shows exactly 7 data points
- Days with no data show ฿0
- No gaps in chart

**Validation:**
- [ ] All 7 days displayed
- [ ] Correct chronological order
- [ ] Thai day labels (จ, อ, พ, etc.)
- [ ] Empty days show 0, not missing

### Test 8.2: Sparse Data
**Scenario:** Only 1 day has data

**Steps:**
1. Add sale only on today
2. View 7-day trend

**Expected Results:**
- 6 days show ฿0
- 1 day shows actual value
- Chart renders correctly

**Validation:**
- [ ] Chart displays all 7 points
- [ ] No rendering errors

---

## 9. RUNNING BALANCE ACCUMULATION

### Test: Cumulative Balance Accuracy
**Scenario:** Running balance must accumulate correctly

**Steps:**
1. Add data for 3 consecutive days:
   - Day 1: Sales ฿10,000, Expenses ฿7,000 (Net: +฿3,000)
   - Day 2: Sales ฿5,000, Expenses ฿8,000 (Net: -฿3,000)
   - Day 3: Sales ฿15,000, Expenses ฿5,000 (Net: +฿10,000)
2. View Cashflow Trend for these 3 days

**Expected Results:**
| Day | Cash In | Cash Out | Net Change | Running Balance |
|-----|---------|----------|------------|-----------------|
| Day 1 | ฿10,000 | ฿7,000 | +฿3,000 | ฿3,000 |
| Day 2 | ฿5,000 | ฿8,000 | -฿3,000 | ฿0 |
| Day 3 | ฿15,000 | ฿5,000 | +฿10,000 | ฿10,000 |

**Validation:**
- [ ] Running balance accumulates correctly
- [ ] Can go negative (shows as -฿...)
- [ ] Precision maintained (no 0.000001 errors)

---

## 10. LARGE NUMBER HANDLING

### Test: High Volume Transactions
**Scenario:** System handles large amounts correctly

**Steps:**
1. Add sale: ฿999,999.99
2. Add expense: ฿888,888.88
3. View P&L

**Expected Results:**
- Revenue: ฿999,999.99
- Expenses: ฿888,888.88
- Net Profit: ฿111,111.11

**Validation:**
- [ ] Numbers display correctly with commas
- [ ] Precision maintained at 2 decimals
- [ ] No overflow errors
- [ ] UI formats properly

---

## 11. CALCULATION FORMULA CORRECTNESS

### Test: Net Profit Formula
**Scenario:** Net Profit = Revenue - Advertising - COGS - Operating

**Steps:**
1. Add sales: ฿50,000
2. Add Advertising: ฿10,000
3. Add COGS: ฿15,000
4. Add Operating: ฿5,000
5. View Daily P&L

**Manual Calculation:**
```
Revenue:            ฿50,000
- Advertising:      ฿10,000
- COGS:             ฿15,000
- Operating:        ฿5,000
------------------------
= Net Profit:       ฿20,000
```

**Validation:**
- [ ] P&L shows exactly ฿20,000 profit
- [ ] Breakdown matches line items
- [ ] No rounding errors

---

## 12. ERROR RECOVERY

### Test 12.1: Database Error Handling
**Scenario:** Query fails gracefully

**Steps:**
1. Simulate DB error (disconnect network temporarily)
2. Try to load Dashboard
3. Expected: Error message displayed, no crash

**Validation:**
- [ ] Error message shows in Thai
- [ ] System doesn't crash
- [ ] Can retry after network restored

### Test 12.2: Invalid Data Type
**Scenario:** Non-numeric value in amount field

**Steps:**
1. Manually insert text in amount field in Supabase
2. View Dashboard
3. Expected: Value treated as 0, no crash

**Validation:**
- [ ] System handles gracefully
- [ ] Shows ฿0.00 for invalid data
- [ ] No NaN propagation

---

## 13. AUTHENTICATION & RLS

### Test: Unauthorized Access
**Scenario:** Logged out user cannot see data

**Steps:**
1. Log out of system
2. Try to navigate to /daily-pl
3. Expected: Redirect to login or error message

**Validation:**
- [ ] Cannot access without login
- [ ] No data leaked
- [ ] RLS enforced

---

## 14. TIMEZONE CONSISTENCY

### Test: Date Matching
**Scenario:** All date fields use consistent timezone

**Steps:**
1. Add sale with order_date = 2026-01-19
2. View on different dates
3. Expected: Always appears on Jan 19, not shifted

**Known Issue:**
- ⚠️ Server timezone assumption (see CLAUDE.md)
- If server is UTC, dates may shift

**Validation:**
- [ ] Dates consistent across views
- [ ] No unexpected day shifts

---

## 15. CONCURRENT USER SCENARIO

### Test: Multi-User Data Isolation
**Scenario:** Users only see their own data (RLS)

**Steps:**
1. User A adds sales
2. User B logs in
3. Expected: User B doesn't see User A's sales

**Validation:**
- [ ] RLS enforced
- [ ] Data properly isolated
- [ ] No leakage between users

---

## CRITICAL PATH TESTS (MUST PASS)

### Priority 1: Financial Accuracy
- [ ] Test 1: Decimal precision
- [ ] Test 3: Cancelled order exclusion
- [ ] Test 11: Net profit formula

### Priority 2: Data Integrity
- [ ] Test 2: Negative value protection
- [ ] Test 4: Empty data handling
- [ ] Test 12: Error recovery

### Priority 3: Business Logic
- [ ] Test 6: Expense category segregation
- [ ] Test 7: P&L vs Cashflow difference
- [ ] Test 9: Running balance accumulation

---

## REGRESSION RISK AREAS

**High Risk (Test First):**
1. Revenue calculation (affects all reports)
2. Expense categorization (affects P&L breakdown)
3. Date boundaries (affects all time-based queries)

**Medium Risk:**
4. Running balance (cumulative errors possible)
5. 7-day trend (missing day logic)

**Low Risk:**
6. UI formatting (visual only)
7. Thai localization (display only)

---

## WHEN TESTS FAIL

### If Revenue Mismatch:
1. Check cancelled orders excluded: `lib/daily-pl.ts:55`
2. Check negative protection: `lib/daily-pl.ts:66`
3. Check date range: `lib/daily-pl.ts:47-48`
4. Verify RLS: User authenticated?

### If Decimal Issues:
1. Check rounding applied: Search for `Math.round(... * 100) / 100`
2. Verify input rounding: `sales/actions.ts:53`, `expenses/actions.ts:45`
3. Check output rounding: All lib functions

### If Empty Data Shows Null/NaN:
1. Check `|| 0` fallbacks in reduce operations
2. Check `Number.isFinite()` guards
3. Check default returns are 0, not null

---

## MANUAL VERIFICATION QUERIES

### Check Total Revenue:
```sql
SELECT SUM(total_amount) as total_revenue
FROM sales_orders
WHERE status != 'cancelled'
AND order_date::date = '2026-01-19';
```

### Check Expense Breakdown:
```sql
SELECT category, SUM(amount) as total
FROM expenses
WHERE expense_date = '2026-01-19'
GROUP BY category;
```

### Verify Audit Trail:
```sql
SELECT source, COUNT(*) as count
FROM sales_orders
GROUP BY source;

SELECT source, COUNT(*) as count
FROM expenses
GROUP BY source;
```

---

## CONFIDENCE LEVELS

After completing all tests:

**Financial Correctness:** [ ] HIGH / [ ] MEDIUM / [ ] LOW
**Data Integrity:** [ ] HIGH / [ ] MEDIUM / [ ] LOW
**Error Handling:** [ ] HIGH / [ ] MEDIUM / [ ] LOW
**Overall System:** [ ] HIGH / [ ] MEDIUM / [ ] LOW

**Ready for real money:** [ ] YES / [ ] NO / [ ] CONDITIONALLY

---

## NOTES & OBSERVATIONS

(Add findings during manual testing here)

---

**Last Updated:** 2026-01-19 (LONG-RUN HARDENING)
**Next Review:** After any changes to financial calculation logic
