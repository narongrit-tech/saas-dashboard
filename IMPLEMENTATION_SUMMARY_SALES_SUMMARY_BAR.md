# Implementation Summary - Sales Summary Bar

**Date:** 2026-01-26
**Feature:** Daily Sales Summary Bar on Sales Orders Page
**Status:** ✅ COMPLETE

---

## Overview

Added a summary bar above the filters section on the Sales Orders page that displays key daily metrics. The summary uses `paid_at` basis (not `order_date`) to ensure revenue metrics reflect only paid orders.

---

## What Changed

### 1. Backend (Server Actions)

**File:** `frontend/src/app/(dashboard)/sales/actions.ts`

**New Function:** `getSalesAggregates(filters: ExportFilters)`

**Returns:**
```typescript
interface SalesAggregates {
  revenue_paid_excl_cancel: number   // Revenue (paid, exclude cancelled)
  cancelled_amount: number            // Total cancelled amount
  net_after_cancel: number            // Net revenue after cancellations
  orders_excl_cancel: number          // Order count (exclude cancelled)
  cancelled_orders: number            // Cancelled order count
  units_excl_cancel: number           // Total units (exclude cancelled)
  aov_net: number                     // Average Order Value (net / orders)
}
```

**Key Logic:**
- Uses SAME filters as table query to prevent drift
- Date filtering: `paid_at` column (not `order_date`)
- Cancelled detection: `platform_status.toLowerCase().includes('ยกเลิก')`
- Zero handling: Returns zero metrics (not NaN) when no data
- Rounding: All currency values rounded to 2 decimal places

---

### 2. Frontend (Page Component)

**File:** `frontend/src/app/(dashboard)/sales/page.tsx`

**Changes:**
1. **Default Date Range:** Changed from "Last 7 Days" to "Today" (Bangkok timezone)
   - Uses `startOfDayBangkok()` and `getBangkokNow()` for date defaults

2. **Date Filter Basis:** Changed from `order_date` to `paid_at`
   - Table query: `.order('paid_at', { ascending: false })`
   - Date filters: `.gte('paid_at', ...)` and `.lte('paid_at', ...)`

3. **Aggregates State:**
   - Added `aggregates` state for summary metrics
   - Added `aggregatesLoading` and `aggregatesError` states

4. **New Function:** `fetchAggregates()`
   - Called whenever filters change
   - Debounced with search filter (300ms)
   - Updates aggregates state

5. **Layout:** Added `<SalesSummaryBar />` above filters section

---

### 3. Frontend (Summary Bar Component)

**File:** `frontend/src/components/sales/SalesSummaryBar.tsx`

**Layout:**
- **Primary Row:** 2 large cards
  - Card 1: Revenue (Paid) with "Net after cancel" subtext
  - Card 2: Orders with "Cancelled: N orders" subtext

- **Secondary Row:** 3 small cards
  - Card 3: Units (Qty)
  - Card 4: AOV
  - Card 5: Cancelled Amount (red text)

**Features:**
- Thai locale formatting: `฿X,XXX.XX` for currency
- Loading state: Skeleton cards during fetch
- Error state: Red error banner
- Null handling: Component returns null if no aggregates

---

### 4. Documentation

**Files Updated:**
1. `CLAUDE.md` - Added "Daily Sales Summary Bar" section under Sales Orders
2. `QA_SALES_SUMMARY_BAR.md` - Comprehensive QA checklist (10 test cases)

---

## Business Rules

### Date Basis: paid_at (Not order_date)

**Why paid_at?**
- Revenue recognition: Only orders with payment received count toward revenue
- Cash flow accuracy: Matches when money actually entered business
- Prevents inflated revenue from unpaid orders
- Aligns with accounting standards (accrual basis with payment verification)

### Cancelled Orders Handling

**Detection:** `platform_status.toLowerCase().includes('ยกเลิก')`

**Treatment:**
- Excluded from main metrics (revenue, orders, units)
- Shown separately in:
  - "Cancelled Amount" card (red text)
  - "Cancelled: N orders" subtext in Orders card

**Formula:**
```
net_after_cancel = revenue_paid_excl_cancel - cancelled_amount
aov_net = net_after_cancel / orders_excl_cancel (handles divide by zero)
```

---

## Filter Consistency

**Critical:** Summary ALWAYS uses SAME filters as table query

| Filter Type | Filter Basis | Applied To |
|-------------|--------------|------------|
| Date Range | `paid_at` | Both summary & table |
| Platform | `source_platform` | Both summary & table |
| Status | `platform_status` (Thai values) | Both summary & table |
| Payment | `payment_status` | Both summary & table |
| Search | `order_id`, `product_name`, `external_order_id` | Both summary & table |

**Result:** No drift between summary metrics and table data

---

## Default Behavior

**First Load (No URL Params):**
- Date Range: Today (Bangkok timezone)
- Start: `startOfDayBangkok()` → 00:00:00 Asia/Bangkok
- End: `getBangkokNow()` → Current time Asia/Bangkok
- All other filters: Default to "All"

**URL Persistence:**
- Date range stored in URL: `?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- Summary respects URL params on page refresh

---

## Performance

**Query Strategy:**
- Summary: Fetches ALL matching orders, aggregates in code
- Table: Paginated query (20/50/100 per page)
- Both queries: Use same filter logic (no drift)

**Optimization Notes:**
- Consider database aggregation (SUM, COUNT) if dataset grows beyond 10K orders
- Current approach: Client-side aggregation (simpler, consistent with export logic)

---

## Testing Checklist

See `QA_SALES_SUMMARY_BAR.md` for full test cases:

1. ✅ Test 1: Default Load Shows Today
2. ✅ Test 2: Preset Changes (Last 7 Days / MTD / Custom Range)
3. ✅ Test 3: Platform Filter (TikTok/Shopee/All)
4. ✅ Test 4: Status Filter (Multi-Select Checkboxes)
5. ✅ Test 5: Payment Filter (Paid/Unpaid/All)
6. ✅ Test 6: Search by Order ID
7. ✅ Test 7: Cancelled Orders Handling
8. ✅ Test 8: AOV Calculation
9. ✅ Integration Test: CSV Export Verification
10. ✅ Regression Tests: Existing Features Still Work

---

## Files Changed

### Backend
- `frontend/src/app/(dashboard)/sales/actions.ts` (added `getSalesAggregates()`)

### Frontend
- `frontend/src/app/(dashboard)/sales/page.tsx` (integrated summary bar, changed date basis)
- `frontend/src/components/sales/SalesSummaryBar.tsx` (new component)

### Documentation
- `CLAUDE.md` (updated Sales Orders section)
- `QA_SALES_SUMMARY_BAR.md` (new QA checklist)
- `IMPLEMENTATION_SUMMARY_SALES_SUMMARY_BAR.md` (this file)

---

## Manual Test Steps (Quick Verification)

1. Navigate to `/sales` (fresh load)
2. Verify date range shows "Today"
3. Check summary bar displays 5 cards
4. Verify numbers match table data visually
5. Change to "Last 7 Days" → both summary and table update
6. Select "TikTok" platform → both summary and table filter
7. Search for order ID → both summary and table filter
8. Export CSV → verify totals match summary in Excel

---

## Commit Info

**Commit Hash:** 61dc9d2
**Message:** feat(sales): add daily sales summary bar with paid_at basis

**Co-Authored-By:** Claude Sonnet 4.5 <noreply@anthropic.com>

---

## Next Steps (Optional Enhancements)

1. **Performance Optimization:** Move aggregation to database (PostgreSQL SUM/COUNT) if dataset > 10K
2. **Export Enhancement:** Add summary section to CSV export header
3. **Mobile Responsive:** Test layout on mobile devices (current: desktop-first)
4. **Real-Time Updates:** Add refresh button or auto-refresh every N minutes
5. **Historical Comparison:** Add "vs Yesterday" or "vs Last Week" delta indicators

---

## Known Limitations

1. **Unpaid Orders:** Orders without `paid_at` will NOT appear in date-filtered results
   - This is intentional (paid_at basis)
   - Unpaid orders should be tracked separately (e.g., "Pending Payment" report)

2. **Cancelled Amount Metric:** Only shows total cancelled amount, not breakdown by reason
   - Future enhancement: Add cancellation reason tracking

3. **AOV Calculation:** Simple average (total / count), not weighted by product mix
   - This is standard AOV formula
   - For advanced analysis, use separate report

---

## Support

**Questions?** See `CLAUDE.md` → Sales Orders section
**Issues?** Check `QA_SALES_SUMMARY_BAR.md` for expected behavior
**Changes Needed?** This feature is modular - summary bar can be hidden/modified without affecting table
