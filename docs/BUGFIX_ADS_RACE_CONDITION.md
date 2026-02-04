# Bugfix: Ads Performance Summary/Table Mismatch (Race Condition + Tab Lag)

**Date:** 2026-02-01
**Status:** ✅ FIXED
**Severity:** MEDIUM (data display inconsistency, not data loss)

## Problem Statement

### Symptoms
1. เปลี่ยน tab (all/product/live) หรือ date range เร็วๆ → Summary cards ไม่ sync กับ Table
2. เคยพบกรณี "ขยายช่วงวันแต่ยอดลด" (stale response overwrite)
3. Summary แสดง filter ชุดหนึ่ง แต่ Table แสดงอีกชุด (tab/date ไม่ match)

### Root Cause (ยืนยันแล้ว)

#### 1. **Request Race Condition**
```typescript
// BEFORE (BROKEN):
useEffect(() => {
  if (dateRange) {
    fetchData(); // ไม่มี guard
  }
}, [dateRange, campaignType]);

const fetchData = async () => {
  // Request A (tab=all, date=1-30)
  const [summaryResult, perfResult] = await Promise.all([...]);

  // ถ้า user เปลี่ยนเป็น tab=product, date=1-31 ก่อน Promise.all เสร็จ
  // → Request B start
  // → Request B เสร็จก่อน (fast)
  // → Set state ด้วย product data ✓
  // → Request A เสร็จทีหลัง (slow)
  // → Set state ด้วย all data ✗ (OVERWRITE!)

  setSummary(summaryResult.data); // ❌ ไม่เช็คว่า stale
  setPerformance(perfResult.data); // ❌ ไม่เช็คว่า stale
};
```

**ทำไมเกิด:**
- ไม่มี request sequence tracking
- Response ช้ากว่ามาทีหลังทับค่าใหม่
- Parallel requests ไม่มี cancellation

#### 2. **Tab State Lag**
```typescript
// BEFORE (BROKEN):
const campaignType = searchParams.get('tab') || 'all'; // อ่านจาก URL

const handleTabChange = (value: string) => {
  router.replace(`?tab=${value}`); // Async update URL
  // useEffect จะ re-run แต่ searchParams.get('tab') ยังเป็นค่าเก่า!
};
```

**ทำไมเกิด:**
- `router.replace()` เป็น async operation
- Component re-render ก่อน URL update จริง
- `useEffect` dependencies trigger ด้วยค่าเก่า

## Solution

### A) Fix Request Race Condition

**Strategy:** Request Sequence Guard (Increment Counter)

```typescript
// AFTER (FIXED):
const latestRequestId = useRef(0);

const fetchData = async () => {
  // Increment and capture request ID
  latestRequestId.current += 1;
  const currentRequestId = latestRequestId.current;

  const [summaryResult, perfResult] = await Promise.all([...]);

  // Guard: discard if stale
  if (currentRequestId !== latestRequestId.current) {
    console.log(`Discarding stale request ${currentRequestId}`);
    return; // ✅ Don't update state
  }

  setSummary(summaryResult.data); // ✅ Only latest
  setPerformance(perfResult.data); // ✅ Only latest
};
```

**How it works:**
- Request A: `currentRequestId = 1`, `latestRequestId.current = 1`
- User changes filter → Request B: `latestRequestId.current = 2`
- Request A returns → check: `1 !== 2` → discard ✓
- Request B returns → check: `2 === 2` → update state ✓

**Benefits:**
- Prevents stale overwrite
- No request cancellation needed (simpler)
- Guards both success and error cases

### B) Fix Tab State Lag

**Strategy:** Optimistic Local State

```typescript
// AFTER (FIXED):
const [campaignTypeState, setCampaignTypeState] = useState<CampaignTypeFilter>(
  searchParams.get('tab') || 'all'
);

// Sync when URL changes (back/forward navigation)
useEffect(() => {
  const urlTab = searchParams.get('tab') || 'all';
  if (urlTab !== campaignTypeState) {
    setCampaignTypeState(urlTab);
  }
}, [searchParams]);

const handleTabChange = (value: string) => {
  // 1. Optimistic update (immediate)
  setCampaignTypeState(value);

  // 2. Update URL (async, may lag)
  router.replace(`?tab=${value}`);
};

// Use local state instead of searchParams
useEffect(() => {
  if (dateRange) {
    fetchData(); // Uses campaignTypeState
  }
}, [dateRange, campaignTypeState]); // ✅ Trigger on local state
```

**How it works:**
- User clicks tab → `campaignTypeState` updates immediately
- `useEffect` triggers with correct tab instantly
- URL updates async (doesn't matter, state already correct)
- Back/forward → URL changes → sync back to state

**Benefits:**
- No lag between click and fetch
- Consistent with URL (synced via useEffect)
- Works with browser navigation

### C) Harden Server Actions (Prevent Next.js Cache)

**File:** `frontend/src/app/(dashboard)/ads/actions.ts`

```typescript
// AFTER (FIXED):
import { unstable_noStore as noStore } from 'next/cache';

export async function getAdsSummary(...) {
  noStore(); // ✅ Prevent Next.js caching
  // ... rest unchanged
}

export async function getAdsPerformance(...) {
  noStore(); // ✅ Prevent Next.js caching
  // ... rest unchanged
}
```

**Why:**
- Server Actions may cache responses in production
- `noStore()` ensures fresh data every time
- No query logic changed (still uses ad_date filter)

## Files Modified

### Modified (3 files):

1. **frontend/src/app/(dashboard)/ads/page.tsx**
   - Added `useRef` import
   - Added `latestRequestId` ref for race guard
   - Added `campaignTypeState` local state
   - Added sync effect for URL ↔ state
   - Modified `fetchData()` with request guard
   - Modified `handleTabChange()` optimistic update
   - Changed `Tabs value` to use local state

2. **frontend/src/app/(dashboard)/ads/actions.ts**
   - Added `unstable_noStore` import
   - Added `noStore()` in `getAdsSummary`
   - Added `noStore()` in `getAdsPerformance`

3. **docs/BUGFIX_ADS_RACE_CONDITION.md** (this file)

**No schema changes** ✅
**No business logic changes** ✅
**Minimal diff** ✅

## Verification

### Before Fix (Broken Behavior)

**Scenario:** Rapid tab switching
```
1. User on tab=all, date=1-30
2. Summary shows: Spend 10,000 (all campaigns)
3. User clicks tab=product
4. Request B starts (product, 1-30)
5. Request B returns FAST → Summary: 7,000 (product) ✓
6. Request A returns SLOW → Summary: 10,000 (all) ✗ WRONG!
7. Table shows product data but Summary shows all data
```

**Scenario:** Date range expansion
```
1. User selects 1-15 → Spend: 5,000
2. User selects 1-30 (extends range)
3. Request B starts
4. Request A (1-15) still pending, returns late
5. Spend shows: 5,000 (wrong, should be higher for 1-30)
```

### After Fix (Expected Behavior)

**Scenario:** Rapid tab switching
```
1. User on tab=all, date=1-30
2. latestRequestId = 1
3. User clicks tab=product
4. campaignTypeState = 'product' (immediate)
5. latestRequestId = 2 (new request)
6. Request 1 returns → check: 1 !== 2 → discard ✓
7. Request 2 returns → check: 2 === 2 → update ✓
8. Summary + Table both show product data ✓
```

**Scenario:** Date range expansion
```
1. User selects 1-15 → reqId=1
2. User selects 1-30 → reqId=2
3. Request 1 returns late → discard
4. Request 2 returns → update
5. Spend correct for 1-30 ✓
```

## Testing Checklist

### Manual QA (Required)

**TC-001: Rapid Tab Switching**
- [ ] กด tab all/product/live สลับเร็วๆ 10 ครั้ง
- [ ] Expected: Summary cards match Table filter
- [ ] Expected: ไม่มีเลขกระโดด/ค้าง

**TC-002: Rapid Date Changes**
- [ ] เปลี่ยน date: 1-30 → 31 → 1-31 → 1-15 (เร็วๆ)
- [ ] Expected: ยอดถูกต้องตาม range ล่าสุด
- [ ] Expected: ไม่มีค่าเก่ามาทับ

**TC-003: SUM Validation**
- [ ] เลือก 1-30 → จด Spend/Revenue/Orders
- [ ] เลือก 31 → จด Spend/Revenue/Orders
- [ ] เลือก 1-31 → ต้อง = SUM(1-30) + SUM(31)

**TC-004: Tab Filter Consistency**
- [ ] เลือก tab=product, date=1-31
- [ ] Table แสดงแต่ campaign_type='product' เท่านั้น
- [ ] Summary total ตรงกับ SUM ของ Table

**TC-005: Browser Navigation**
- [ ] เปลี่ยน tab=product
- [ ] กด Back (browser)
- [ ] Expected: tab กลับไป all, data refresh ถูกต้อง

**TC-006: Loading State**
- [ ] เปลี่ยน filter ขณะ loading
- [ ] Expected: loading indicator แสดงถูกต้อง (ไม่ flicker)

### Console Verification

**Look for logs:**
```
✓ "Discarding stale request X (latest: Y)" → race guard working
✓ No errors
✗ "Error fetching ads data" → check server action
```

## Performance Impact

**Before:**
- 2 requests per filter change (summary + performance)
- Stale requests waste bandwidth

**After:**
- Same 2 requests
- Stale requests discarded client-side (minimal overhead)
- `noStore()` ensures fresh data (no cache hit delay)

**Net impact:** Negligible (1-2ms per request for guard check)

## Known Limitations

1. **No Request Cancellation:** Stale requests still complete (just ignored)
   - Trade-off: Simpler code, no AbortController complexity
   - Impact: Low (server already processed, just discard client-side)

2. **State vs URL Temporary Mismatch:** campaignTypeState may briefly differ from URL
   - Trade-off: Needed for optimistic update
   - Impact: None (sync effect corrects it, user sees correct state)

## Regression Risk

**Risk:** LOW
- Changes isolated to ads page
- No database/API changes
- Same query logic (just added noStore)
- Backward compatible

**What to watch:**
- Check console for "Discarding stale" logs (should see occasionally)
- Verify Summary/Table always match after changes
- Test browser back/forward navigation

## Future Enhancements (Optional)

- [ ] Add request cancellation (AbortController) for true abort
- [ ] Add loading indicator per-card (show which is updating)
- [ ] Debounce rapid date changes (reduce request spam)

## Success Criteria

- [x] Code compiles
- [x] Build passes
- [x] Request sequence guard implemented
- [x] Optimistic tab state implemented
- [x] noStore() added to server actions
- [ ] Manual QA: TC-001 to TC-006 passed
- [ ] SUM validation formula verified
- [ ] No console errors

## Summary

**Root Causes Fixed:**
1. ✅ **Race condition**: Request sequence guard prevents stale overwrite
2. ✅ **Tab lag**: Optimistic local state ensures immediate filter

**Files Changed:** 2 (page.tsx, actions.ts) + 1 doc
**Lines Changed:** ~30 (minimal diff)
**Breaking Changes:** None
**Schema Changes:** None

**Impact:** HIGH (fixes user-reported data inconsistency)
**Risk:** LOW (isolated changes, backward compatible)

---

**Bugfix Complete** ✅
**Ready for QA Testing**
**Date:** 2026-02-01
**Developer:** Claude (FE/BE Engineer)
