# Business Rules Audit - SaaS Dashboard

**Audit Date:** 2026-01-19
**Phase:** Data Consistency & Business Rule Check

---

## 1. Sales & Revenue Rules

### ✅ VERIFIED - Revenue Calculation
**Rule:** Revenue = sum(sales_orders.total_amount) WHERE status != 'cancelled'

**Implementation:**
- Dashboard (actions.ts:55-62): ✅ Excludes cancelled with `.neq('status', 'cancelled')`
- Daily P&L (daily-pl.ts:45-55): ✅ Excludes cancelled
- Manual Order Creation (sales/actions.ts:43-51): ✅ Cancelled orders → total_amount = 0

**Status:** ✅ PASS - Business rule correctly implemented

---

### ✅ VERIFIED - Total Amount Calculation
**Rule:** total_amount must be calculated server-side (quantity × unit_price)

**Implementation:**
- sales/actions.ts:43-51: ✅ Server-side calculation
- Cancelled orders forced to 0

**Status:** ✅ PASS - No client-side tampering possible

---

## 2. Expenses Rules

### ✅ VERIFIED - Expense Categories
**Rule:** Expenses must be split into exactly 3 categories:
- **Advertising**: ค่าโฆษณา (ads, marketing)
- **COGS**: ต้นทุนขาย (product cost, packaging)
- **Operating**: ค่าดำเนินงาน (overhead, utilities, salaries)

**Implementation:**
- expenses/actions.ts:16: ✅ VALID_CATEGORIES enforced
- Daily P&L (daily-pl.ts:76-89): ✅ Splits by category
- Dashboard: Aggregates all expenses (no split) - intentional for "Total Expenses Today"

**Status:** ✅ PASS - Categories correctly defined and enforced

---

## 3. Daily P&L Calculation

### ✅ VERIFIED - P&L Formula
**Rule:**
```
Net Profit = Revenue - Advertising Cost - COGS - Operating Expenses
```

**Implementation:**
- daily-pl.ts:125-131: ✅ Correct formula with NaN safety

**Status:** ✅ PASS - Formula matches business logic

---

## 4. Data Safety & Defensive Programming

### ✅ VERIFIED - NaN/Null Guards
**Protection:**
- Dashboard actions: ✅ NaN safety on netProfit and trends
- Daily P&L: ✅ NaN safety on all calculations
- Reduce operations: ✅ Use `|| 0` fallback

**Status:** ✅ PASS - Defensive guards in place

---

### ✅ VERIFIED - Empty Days Handling
**Rule:** Days with no data should return 0, not skip/error

**Implementation:**
- Dashboard trends: ✅ Uses Map + `|| 0` fallback
- Daily P&L: ✅ Returns 0 for all metrics if no data

**Status:** ✅ PASS - No gaps in data display

---

## 5. RISKS IDENTIFIED

### ⚠️ RISK 1: Timezone Inconsistency (MEDIUM-HIGH)
**Issue:**
- Server code uses `new Date()` which gets server's local timezone
- Business requires Asia/Bangkok timezone (UTC+7)
- If deployed to cloud (UTC), date calculations will be off by 7 hours

**Impact:**
- Orders created at 1am Bangkok time (6pm UTC previous day) will count toward wrong date
- Daily reports will be inaccurate

**Location:**
- dashboard/actions.ts:47
- sales/actions.ts:54
- daily-pl.ts (uses same date logic)

**Mitigation:**
- Add `date-fns-tz` package
- Use `toZonedTime(new Date(), 'Asia/Bangkok')` for all date operations
- **Status:** Documented with TODO comments, not yet fixed

**Decision Required:** Should we install date-fns-tz or configure server timezone?

---

### ⚠️ RISK 2: CEO Commission Flow Not Implemented (LOW)
**Issue:**
- TikTok commission flow requires separation of:
  1. Personal income (CEO's)
  2. Director's Loan (transferred to company)
- Currently not tracked in system

**Impact:**
- Cannot accurately track company's true revenue from TikTok
- Director's loan balance unknown

**Status:**
- Not in current MVP scope
- Should be Phase 6+ feature

---

### ⚠️ RISK 3: Client-Side Queries (LOW)
**Issue:**
- Sales page (sales/page.tsx:56-87): Client-side query with filters
- Expenses page (expenses/page.tsx:56-87): Client-side query with filters

**Impact:**
- Not critical as these are read-only operations with RLS
- No calculations performed client-side

**Status:**
- Acceptable for MVP
- RLS ensures data security
- Consider moving to server actions if performance issues arise

---

## 6. Confirmed Business Rules Checklist

- [x] Sales revenue excludes cancelled orders
- [x] Cancelled orders must have total_amount = 0
- [x] Total amount calculated server-side only
- [x] Expenses categorized into exactly 3 types
- [x] Daily P&L formula is correct
- [x] Empty days return 0 (no gaps)
- [x] NaN/null safety guards present
- [x] All critical calculations are server-side
- [x] RLS enforced on all queries
- [ ] ⚠️ Timezone handling (documented but not fixed)
- [ ] ⚠️ CEO Commission flow (not implemented yet)

---

## 7. Code Comments Added

Enhanced business logic clarity with inline comments:
- sales/actions.ts:43-45
- expenses/actions.ts:12-15
- dashboard/actions.ts:55-56
- daily-pl.ts: Comprehensive comments throughout

---

## Conclusion

**Overall Status:** ✅ STABLE with known risks

**Safe to Extend:** Yes, current implementation is solid

**Must Fix Before Production:**
- ⚠️ Timezone handling (if deploying to cloud with UTC)

**Can Defer:**
- CEO Commission flow (future feature)
- Client-side queries refactor (if needed)
