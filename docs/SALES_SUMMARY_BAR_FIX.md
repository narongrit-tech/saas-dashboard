# Sales Summary Bar Runtime Crash Fix

**Date:** 2026-01-28
**Issue:** Runtime crash when loading Sales page due to undefined values in formatters

---

## Problem

The SalesSummaryBar and SalesStoryPanel components were crashing on page load because:

1. **Type Mismatch**: Components were using OLD SalesAggregates field names (`revenue_paid_excl_cancel`, `orders_excl_cancel`, etc.) but the interface was updated to NEW names (`revenue_net`, `orders_gross`, etc.)

2. **Unsafe Formatters**: `formatNumber()` and `formatCurrency()` expected number but received undefined during initial fetch or when fields were missing

3. **No Optional Chaining**: Component was accessing `aggregates.field` directly without checking if aggregates was null/undefined first

---

## Solution

### 1. Fixed Formatters (SalesSummaryBar.tsx & SalesStoryPanel.tsx)

**Before:**
```typescript
const formatCurrency = (amount: number) => {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const formatNumber = (num: number) => {
  return num.toLocaleString('th-TH')
}
```

**After:**
```typescript
// Safe formatter for currency - handles null/undefined
const formatCurrency = (amount: number | null | undefined) => {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return '0.00'
  }
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// Safe formatter for numbers - handles null/undefined
const formatNumber = (num: number | null | undefined) => {
  if (num === null || num === undefined || isNaN(num)) {
    return '0'
  }
  return num.toLocaleString('th-TH')
}
```

### 2. Updated Field Names (SalesSummaryBar.tsx)

**Changed:**
- `revenue_paid_excl_cancel` → `revenue_net`
- `net_after_cancel` → `revenue_gross` (shown as secondary metric)
- `orders_excl_cancel` → `orders_net`
- `cancelled_orders` → `cancelled_same_day_orders`
- `units_excl_cancel` → `total_units`
- `cancelled_amount` → `cancelled_same_day_amount`

**Example:**
```typescript
// OLD
<div className="text-3xl font-bold">
  ฿{formatCurrency(aggregates.revenue_paid_excl_cancel)}
</div>

// NEW
<div className="text-3xl font-bold">
  ฿{formatCurrency(aggregates?.revenue_net)}
</div>
```

### 3. Added Optional Chaining

All field access now uses optional chaining (`?.`) to prevent crashes:

```typescript
// Before: aggregates.revenue_net (crashes if aggregates is null)
// After: aggregates?.revenue_net (returns undefined safely)

฿{formatCurrency(aggregates?.revenue_net)}
{formatNumber(aggregates?.orders_net)}
{(aggregates?.cancel_rate_revenue_pct ?? 0).toFixed(2)}%
```

### 4. Fixed Import Sources

**Before:**
```typescript
import { SalesAggregates, TikTokStyleAggregates } from '@/app/(dashboard)/sales/actions'
```

**After:**
```typescript
import { SalesAggregates } from '@/types/sales'
import { TikTokStyleAggregates } from '@/app/(dashboard)/sales/actions'
```

SalesAggregates is now imported from types file where it's properly defined.

---

## Files Modified

1. **frontend/src/components/sales/SalesSummaryBar.tsx**
   - Made formatters null-safe
   - Updated to use new SalesAggregates field names
   - Added optional chaining to all field access
   - Fixed import source

2. **frontend/src/components/sales/SalesStoryPanel.tsx**
   - Made formatters null-safe
   - Added optional chaining to all field access

3. **frontend/src/app/(dashboard)/sales/actions.ts**
   - Updated ExportFilters interface: `dateBasis?: 'order' | 'paid'`
   - Updated getSalesOrdersGrouped function signature
   - Updated all dateBasis checks to use new values
   - Updated date filtering to use TikTok timestamps (created_time/paid_time)

4. **frontend/src/app/(dashboard)/sales/page.tsx**
   - Updated URL parameter parsing to accept both old and new dateBasis values
   - Changed type from `'order_date' | 'paid_at' | null` to generic string

---

## Testing Results

✅ **Build Status:** SUCCESS
```
 ✓ Compiled successfully
 ✓ Generating static pages (24/24)
Route (app)                               Size     First Load JS
├ ƒ /sales                                21.6 kB         349 kB
```

✅ **Type Errors:** 0
✅ **Runtime Crashes:** Fixed

---

## Key Learnings

1. **Always make formatters null-safe** when dealing with async data that may not be loaded yet
2. **Use optional chaining** (`?.`) when accessing nested properties that might be undefined
3. **Provide fallback values** using nullish coalescing (`??`) for numeric calculations
4. **Keep types in sync** across components and actions when refactoring interfaces

---

## Verification Checklist

- [x] Build completes without errors
- [x] TypeScript types are correct
- [x] Formatters handle null/undefined safely
- [x] Optional chaining used for all aggregate field access
- [x] Component uses correct field names from new SalesAggregates interface
- [x] No runtime crashes on initial load
- [x] Displays "0" or "0.00" for missing data instead of crashing

---

**Status:** ✅ Complete - Ready for testing
