# Sales Page "Too Many Re-renders" Fix

**Date:** 2026-01-27
**Issue:** Infinite render loop when visiting `/sales?basis=order_date&startDate=...`
**Root Cause:** Circular dependency between URL and state synchronization

---

## Problem Analysis

### Before Fix - Circular Dependencies

1. **`getFiltersFromURL()` had side effect** (line 92):
   ```typescript
   // BAD: Side effect in getter function
   if (basisParam && ...) {
     setDateBasis(basisParam)  // ❌ setState in function called during render
   }
   ```

2. **`useEffect` triggered setState**:
   ```typescript
   useEffect(() => {
     const urlFilters = getFiltersFromURL()  // Calls setDateBasis()
     setFilters(urlFilters)                  // Triggers re-render
   }, [searchParams])
   ```

3. **`updateURL()` changed searchParams**:
   ```typescript
   const updateURL = (newFilters) => {
     // ...
     router.push(`/sales?${params}`)  // Changes searchParams → triggers effect again
   }
   ```

4. **Circular loop**:
   ```
   URL change → Effect A runs → setState → re-render →
   Handler called → updateURL → router.push → URL change → Effect A runs → ...
   ```

---

## Solution - Separate URL↔State Sync into 2 Guarded Effects

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      URL (searchParams)                  │
└────────────────┬────────────────────────▲───────────────┘
                 │                        │
            Effect A (URL→State)    Effect B (State→URL)
           (NO router calls)        (NO setState calls)
                 │                        │
                 ▼                        │
┌─────────────────────────────────────────────────────────┐
│              State (dateBasis, filters)                  │
└─────────────────────────────────────────────────────────┘
```

### Effect A: URL → State

**Purpose:** Read URL and update state
**NO:** Router calls (push/replace)
**Guards:** Only setState if value changed

```typescript
useEffect(() => {
  // Read from URL
  const basisParam = searchParams.get('basis')
  const urlFilters = { ... }  // Parse all URL params

  // Update date basis (guarded)
  const newBasis = (basisParam === 'order_date' || ...) ? basisParam : 'order_date'
  setDateBasis(prev => prev !== newBasis ? newBasis : prev)

  // Update filters (guarded)
  setFilters(prev => {
    const changed = (
      prev.sourcePlatform !== urlFilters.sourcePlatform ||
      // ... check all fields
    )
    return changed ? urlFilters : prev  // Only update if changed
  })
}, [searchParams])
```

### Effect B: State → URL

**Purpose:** Read state and update URL if needed
**NO:** setState calls
**Guards:** Only router.replace if query string changed

```typescript
useEffect(() => {
  // Build URL from state
  const params = new URLSearchParams()
  params.set('basis', dateBasis)
  if (filters.startDate) params.set('startDate', filters.startDate)
  // ... add all filter params

  const newQueryString = params.toString()
  const currentQueryString = searchParams.toString()

  // Only update URL if changed (guard)
  if (newQueryString !== currentQueryString) {
    router.replace(`/sales?${newQueryString}`, { scroll: false })
  }
}, [dateBasis, filters.sourcePlatform, ...])  // State dependencies only
```

**CRITICAL:** Do NOT add `searchParams` or `router` to Effect B dependencies!

---

## Handler Changes

All handlers now **ONLY** update state (no URL updates):

### Before (with updateURL)
```typescript
const handleFilterChange = (key, value) => {
  const newFilters = { ...filters, [key]: value, page: 1 }
  setFilters(newFilters)
  updateURL(newFilters)  // ❌ Direct URL manipulation
}
```

### After (state only)
```typescript
const handleFilterChange = (key, value) => {
  setFilters(prev => ({ ...prev, [key]: value, page: 1 }))  // ✅ State only
  // Effect B will sync to URL automatically
}
```

Same pattern for:
- `handleDateRangeChange`
- `handleStatusToggle`
- `handlePageChange`
- `handlePageSizeChange`
- `handleDateBasisChange`

---

## Code Changes Summary

### Removed
- ❌ `getFiltersFromURL()` function (had side effects)
- ❌ `updateURL()` function (direct URL manipulation)
- ❌ Side effects in getter functions
- ❌ URL updates in handlers

### Added
- ✅ Effect A: URL → State sync (guarded)
- ✅ Effect B: State → URL sync (guarded)
- ✅ Functional setState with guards
- ✅ Query string comparison before router.replace

### Modified
- 🔧 All handler functions → setState only
- 🔧 Initial state → minimal defaults
- 🔧 Dependencies → primitives only (no objects)

---

## Testing

### Manual Test Checklist

- [x] Navigate to `/sales` → loads without error
- [x] Change date basis → URL updates once (no loop)
- [x] Change date range → URL updates once (no loop)
- [x] Change filters → URL updates once (no loop)
- [x] Pagination → URL updates once (no loop)
- [x] Browser back/forward → state syncs correctly
- [x] Direct URL visit with query params → state initializes correctly
- [x] `npm run build` → builds successfully

### Verification Commands

```bash
# TypeScript check
cd frontend
npx tsc --noEmit 2>&1 | grep "sales/page" || echo "✓ No errors"

# Build check
npm run build

# Dev server
npm run dev
# Visit: http://localhost:3000/sales?basis=order_date&startDate=2026-01-01&endDate=2026-01-31
# Should load without "Too many re-renders" error
```

---

## Key Learnings

### ✅ DO
1. **Separate concerns**: URL→State and State→URL in different effects
2. **Guard updates**: Only setState/router if value actually changed
3. **Pure functions**: No side effects in getter functions
4. **Functional setState**: Use `prev =>` pattern with comparison
5. **Query string comparison**: Check if URL needs update before calling router

### ❌ DON'T
1. **Don't call setState** in getter functions
2. **Don't call router** in URL→State effect
3. **Don't call setState** in State→URL effect
4. **Don't add searchParams** to State→URL effect dependencies
5. **Don't update URL directly** in handlers (let Effect B handle it)

---

## File Changes

**Modified:** `frontend/src/app/(dashboard)/sales/page.tsx`

**Lines Changed:** ~80 lines
- Removed: getFiltersFromURL() function with side effects
- Removed: updateURL() function
- Added: Effect A (URL→State) with guards
- Added: Effect B (State→URL) with guards
- Modified: All handler functions to setState only

---

## Git Commit

```bash
git add frontend/src/app/\(dashboard\)/sales/page.tsx
git add docs/SALES_PAGE_RERENDER_FIX.md

git commit -m "fix(sales): resolve 'Too many re-renders' infinite loop

Root cause: Circular dependency between URL and state synchronization.
- getFiltersFromURL() had setState side effect
- updateURL() triggered searchParams change → infinite loop

Solution: Separate URL↔State sync into 2 guarded effects:
- Effect A (URL→State): Read searchParams, update state (NO router calls)
- Effect B (State→URL): Read state, update URL if changed (NO setState)

Changes:
- Remove getFiltersFromURL() function (side effects)
- Remove updateURL() function (direct URL manipulation)
- Add Effect A with guarded setState
- Add Effect B with guarded router.replace
- Update all handlers to setState only (Effect B syncs to URL)

Testing:
✓ TypeScript check passes
✓ Build succeeds
✓ /sales loads without runtime error
✓ Date basis/range/filter changes update URL once (no loop)
✓ Browser navigation works correctly

Fixes: Visiting /sales?basis=order_date&startDate=... no longer crashes

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Status

✅ **Fixed and Verified**
- TypeScript: ✓ No errors
- Build: ✓ Success
- Runtime: ✓ No infinite loop
- Navigation: ✓ Working correctly
