# Migration 029 + Backend Fallback - QA Checklist

**Date:** 2026-01-28
**Scope:** TikTok Business Timestamps Backfill + Backend Fallback Logic
**Goal:** ทำให้ระบบไม่พัง และไม่โชว์ 0 เมื่อข้อมูลเก่ามี created_time=NULL

---

## ✅ PRE-DEPLOYMENT

### 1. Database Migration Verification

#### 1.1 Run Migration
```bash
# In Supabase Dashboard SQL Editor or via psql:
# Run: database-scripts/migration-029-tiktok-business-timestamps.sql
```

#### 1.2 Check Verification Output
- [ ] Migration runs without errors
- [ ] Verification output shows:
  - `created_time_pct` ≈ 100% (for imported data)
  - `paid_time_pct` ≈ 70-90% (depends on payment rate)
  - `cancelled_time_pct` ≈ 5-15% (depends on cancel rate)
- [ ] Sample rows with NULL created_time: 0 (or only manual entries)

#### 1.3 Manual SQL Verification
```sql
-- Check overall coverage
SELECT
  COUNT(*) as total,
  COUNT(created_time) as has_created_time,
  COUNT(paid_time) as has_paid_time,
  COUNT(cancelled_time) as has_cancelled_time,
  ROUND(100.0 * COUNT(created_time) / COUNT(*), 2) as created_time_pct
FROM public.sales_orders;

-- Expected: created_time_pct ≈ 100% after migration

-- Check NULL created_time rows (should be minimal)
SELECT COUNT(*) as null_created_time_count
FROM public.sales_orders
WHERE created_time IS NULL;

-- Expected: 0 (for imported data) or only manual entries

-- Sample data check
SELECT
  order_id,
  source,
  created_time,
  order_date,
  paid_time,
  paid_at,
  cancelled_time,
  metadata->>'cancelled_time' as metadata_cancelled
FROM public.sales_orders
ORDER BY created_at DESC
LIMIT 10;

-- Verify: created_time populated from metadata or order_date fallback
```

---

## ✅ FUNCTIONAL TESTING

### 2. Sales Page - Order Basis (created_time)

**Test URL:** `/sales?basis=order&startDate=2026-01-15&endDate=2026-01-28`

#### 2.1 Page Loads Without Errors
- [ ] Page loads successfully
- [ ] No console errors
- [ ] No "0 results" shown (if data exists in date range)

#### 2.2 Story Panel Displays Correctly
- [ ] Left card: Revenue (Net) shows non-zero value (if orders exist)
- [ ] Right card: Orders (Net) shows non-zero count
- [ ] Cancel rate % shows correct value
- [ ] No "NaN" or "Infinity" displayed

#### 2.3 Summary Bar Displays Correctly
- [ ] Revenue (Paid) shows value
- [ ] Orders count > 0
- [ ] Units (Qty) shows correct sum
- [ ] AOV calculates correctly (Revenue / Orders)

#### 2.4 Order View Table
- [ ] Table shows orders (1 row per order_id)
- [ ] Total Units aggregated correctly
- [ ] Order Amount correct (not inflated by multi-SKU)

#### 2.5 Line View Table
- [ ] Switch to Line View works
- [ ] Shows SKU lines (1 row per product)
- [ ] All rows visible (no missing data)

---

### 3. Sales Page - Paid Basis (paid_time)

**Test URL:** `/sales?basis=paid&startDate=2026-01-15&endDate=2026-01-28`

#### 3.1 Page Loads Without Errors
- [ ] Page loads successfully
- [ ] Shows only paid orders (paid_time NOT NULL)
- [ ] COD orders without paid_time excluded correctly

#### 3.2 Story Panel (Paid Basis)
- [ ] Revenue shows paid orders only
- [ ] Orders count = paid orders only
- [ ] No unpaid orders included

#### 3.3 Fallback Behavior
- [ ] Orders without paid_time excluded (correct)
- [ ] Orders with paid_at but no paid_time still shown (fallback works)

---

### 4. Date Range Edge Cases

#### 4.1 Legacy Data Range
**Test:** Select date range before migration was applied (e.g., 2025-12-01 to 2025-12-31)

- [ ] Page loads without errors
- [ ] Shows data correctly (even if created_time was NULL before)
- [ ] Backend fallback to order_date works
- [ ] Console warning logged: "Found X rows with NULL created_time" (if any)

#### 4.2 Recent Data Range
**Test:** Select date range after migration (e.g., 2026-01-25 to 2026-01-28)

- [ ] Page loads without errors
- [ ] No console warnings about NULL created_time
- [ ] All data uses created_time (no fallback needed)

#### 4.3 Mixed Data Range
**Test:** Select date range spanning before/after migration

- [ ] Both legacy and new data displayed
- [ ] No double-counting
- [ ] No missing data

---

### 5. Same-Day Cancel Logic

**Test:** Orders cancelled on same calendar day as created (Bangkok timezone)

#### 5.1 Verify Same-Day Cancel Detection
```sql
-- Find sample same-day cancelled order
SELECT
  order_id,
  DATE(created_time AT TIME ZONE 'Asia/Bangkok') as created_date_bkk,
  DATE(cancelled_time AT TIME ZONE 'Asia/Bangkok') as cancelled_date_bkk,
  created_time,
  cancelled_time
FROM public.sales_orders
WHERE cancelled_time IS NOT NULL
  AND DATE(created_time AT TIME ZONE 'Asia/Bangkok') = DATE(cancelled_time AT TIME ZONE 'Asia/Bangkok')
LIMIT 5;
```

- [ ] Query returns same-day cancelled orders
- [ ] Story Panel cancel rate includes these orders
- [ ] Net metrics exclude same-day cancelled orders

---

### 6. Export Functionality

#### 6.1 Order View Export
**Test:** Export from Order View

- [ ] Click "Export Orders CSV" button
- [ ] CSV downloads successfully
- [ ] Filename: `sales-orders-grouped-YYYYMMDD-HHMMSS.csv`
- [ ] CSV contains correct columns (Order ID, Total Units, SKU Count, etc.)
- [ ] Row count matches Order View table
- [ ] No duplicate orders in CSV

#### 6.2 Line View Export
**Test:** Export from Line View

- [ ] Switch to Line View
- [ ] Click "Export Lines CSV" button
- [ ] CSV downloads successfully
- [ ] Filename: `sales-orders-YYYYMMDD-HHMMSS.csv`
- [ ] CSV contains SKU lines (Product Name, Quantity, etc.)
- [ ] Row count matches Line View table

#### 6.3 Export Respects Filters
- [ ] Apply date filter → Export includes only filtered dates
- [ ] Apply platform filter → Export includes only selected platform
- [ ] Apply status filter → Export includes only selected statuses

---

### 7. Performance Testing

#### 7.1 Load Time
- [ ] Page load < 3 seconds (with 500+ orders)
- [ ] Story Panel renders immediately (no long wait)
- [ ] Table pagination works smoothly

#### 7.2 Large Date Range
**Test:** Select 3-month date range (e.g., 2025-11-01 to 2026-01-28)

- [ ] Page loads without timeout
- [ ] Aggregates calculate correctly
- [ ] No browser freeze or memory issues

---

## ✅ REGRESSION TESTING

### 8. Existing Features Not Broken

#### 8.1 Date Basis Toggle
- [ ] Switch between "Order Date" and "Paid Date" works
- [ ] URL updates correctly (?basis=order vs ?basis=paid)
- [ ] Data updates correctly when toggling

#### 8.2 Order/Line View Toggle
- [ ] Switch between Order View and Line View works
- [ ] Story Panel unaffected by view change (correct)
- [ ] Export button text changes (Order CSV vs Line CSV)

#### 8.3 Filters
- [ ] Platform filter works
- [ ] Status filter (multi-select) works
- [ ] Payment status filter works
- [ ] Search filter works (Order ID, Product Name, External Order ID)

#### 8.4 Pagination
- [ ] Page size selector works (20/50/100)
- [ ] Jump to page input works
- [ ] Prev/Next buttons work
- [ ] Total count accurate

#### 8.5 Order Detail Drawer
- [ ] Click eye icon in Order View → Drawer opens
- [ ] Drawer shows order summary correctly
- [ ] Line items table shows all SKUs
- [ ] Line subtotal = qty × unit_price (not total_amount)

---

## ✅ ERROR HANDLING

### 9. Edge Cases & Error States

#### 9.1 Manual Entry Without created_time
**Test:** Manually create order (should have order_date but maybe no created_time initially)

- [ ] Manual order appears in list
- [ ] Fallback to order_date works
- [ ] No console errors

#### 9.2 No Data Scenario
**Test:** Select date range with no orders

- [ ] Empty state shows correctly
- [ ] Story Panel shows 0 values (not NaN/Infinity)
- [ ] Summary Bar shows 0 values
- [ ] No errors in console

#### 9.3 Network Error Handling
**Test:** Disconnect network during page load

- [ ] Error message displayed to user
- [ ] No crash or white screen
- [ ] Retry mechanism works (if applicable)

---

## ✅ DATA INTEGRITY

### 10. Cross-Verification with Database

#### 10.1 Spot Check Aggregates
**Manual SQL:**
```sql
-- Count distinct orders created in date range
WITH order_level AS (
  SELECT
    COALESCE(external_order_id, order_id) as order_key,
    MAX(total_amount) as order_amount,
    SUM(quantity) as total_units,
    MAX(created_time) as created_time,
    MAX(cancelled_time) as cancelled_time
  FROM public.sales_orders
  WHERE (created_time >= '2026-01-15' OR order_date >= '2026-01-15')
    AND (created_time < '2026-01-29' OR order_date < '2026-01-29')
  GROUP BY COALESCE(external_order_id, order_id)
)
SELECT
  COUNT(*) as order_count,
  SUM(order_amount) as revenue_gross,
  SUM(total_units) as units_total,
  COUNT(*) FILTER (WHERE cancelled_time IS NOT NULL) as cancelled_orders
FROM order_level;
```

- [ ] UI order count matches SQL order_count
- [ ] UI revenue gross matches SQL revenue_gross
- [ ] UI units total matches SQL units_total
- [ ] Cancel counts match

---

## ✅ ACCEPTANCE CRITERIA

### 11. Final Validation

- [ ] **No manual backfill needed** - Migration does it automatically
- [ ] **created_time_not_null ≈ 100%** for TikTok imported data
- [ ] **Sales page does not show 0** when data exists (no created_time=NULL issue)
- [ ] **Build passes** with no TypeScript errors
- [ ] **Same-day cancel logic** works correctly (Bangkok timezone)
- [ ] **Fallback logic** transparent to user (no console errors visible)
- [ ] **Export functions** respect date basis and view mode
- [ ] **Performance acceptable** (< 3 seconds page load)

---

## 🐛 KNOWN ISSUES & WORKAROUNDS

### Issue 1: Console Warnings for NULL created_time
**Symptom:** Console shows "Found X rows with NULL created_time (using order_date fallback)"

**Expected:** X = 0 after migration (unless manual entries)

**Workaround:** None needed - this is informational logging

---

### Issue 2: Dashboard Dynamic Rendering Warning
**Symptom:** Build shows "Dynamic server usage: Route / couldn't be rendered statically"

**Impact:** None - dashboard requires auth cookies (expected behavior)

**Action:** No fix needed (not related to migration)

---

## 📊 SIGN-OFF

### QA Approval

- [ ] All critical tests passed
- [ ] No regressions detected
- [ ] Performance acceptable
- [ ] Data integrity verified

**Tested By:** ___________________
**Date:** ___________________
**Approved By:** ___________________
**Date:** ___________________

---

## 🚀 DEPLOYMENT CHECKLIST

1. [ ] Run migration-029 in Supabase (production)
2. [ ] Verify migration output (created_time_pct ≈ 100%)
3. [ ] Deploy frontend code changes
4. [ ] Monitor error logs for first 24 hours
5. [ ] Spot-check live data vs QA results

---

**STATUS:** Ready for QA Testing & Deployment
