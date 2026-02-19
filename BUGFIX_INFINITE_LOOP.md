# Bug Fix: Infinite Render Loop (Maximum Update Depth Exceeded)
**วันที่:** 2026-01-25
**Priority:** 🔴 CRITICAL (blocked all pages)
**Status:** ✅ FIXED

---

## สรุปปัญหา

**Observed Behavior:**
```
Unhandled Runtime Error
Error: Maximum update depth exceeded
Stack: React → setRef → compose-refs (@radix-ui/react-compose-refs)
```

- เกิดทุกหน้า: /expenses, /sales, /finance/marketplace-wallets, /daily-pl, /company-cashflow, /reconciliation
- App ไม่สามารถ render ได้เลย
- Error เกิดจาก infinite loop ใน React component lifecycle

---

## Root Cause Analysis

### ไฟล์ที่มีปัญหา:
```
frontend/src/components/shared/SingleDateRangePicker.tsx
Line: 94 (useEffect dependency array)
```

### โค้ดที่ทำให้เกิด loop:
```typescript
// ❌ BUG: onChange in dependency array
useEffect(() => {
  if (dateRange?.from && dateRange?.to) {
    onChange({
      startDate: dateRange.from,
      endDate: dateRange.to,
    });
  }
}, [dateRange, onChange]); // ← onChange causes infinite loop
```

### ทำไมถึง loop?

**การทำงานปกติ (คาดหวัง):**
1. User เลือกวันที่ → `dateRange` เปลี่ยน
2. useEffect trigger → เรียก `onChange()`
3. Parent component update state
4. จบ

**สิ่งที่เกิดขึ้นจริง (infinite loop):**
1. Parent component renders → สร้าง `onChange` function ใหม่
2. Pass `onChange` ให้ child (SingleDateRangePicker)
3. Child's useEffect เห็น `onChange` เปลี่ยน (new reference) → trigger effect
4. Effect เรียก `onChange({ startDate, endDate })`
5. Parent update state ใน `onChange` handler
6. Parent re-render → สร้าง `onChange` function ใหม่อีกรอบ
7. กลับไป step 2 → **INFINITE LOOP** ♾️

### ทำไมถึงเกิดทุกหน้า?

SingleDateRangePicker ถูกใช้ใน:
- ✅ /sales (date range filter)
- ✅ /expenses (date range filter)
- ✅ /company-cashflow (date range filter)
- ✅ /reconciliation (date range filter)
- ✅ /finance/marketplace-wallets (date range filter)

เพราะฉะนั้น infinite loop เกิดทุกหน้าที่ใช้ component นี้

---

## The Fix

### โค้ดที่แก้ไข:
```typescript
// ✅ FIXED: Remove onChange from deps
// Auto-apply when both dates selected
// Note: onChange intentionally omitted from deps to avoid infinite loop
// (parent may recreate onChange on every render, but we only want to trigger on dateRange change)
useEffect(() => {
  if (dateRange?.from && dateRange?.to) {
    onChange({
      startDate: dateRange.from,
      endDate: dateRange.to,
    });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [dateRange]); // ← Only dateRange in deps
```

### อธิบายการแก้ไข:

**ลบ `onChange` ออกจาก dependency array**

**เหตุผล:**
- `onChange` เป็น callback prop (ช่องทางการแจ้งเตือน parent)
- ไม่ใช่ state ที่ต้อง subscribe
- Parent อาจสร้าง function ใหม่ทุกครั้งที่ render (inline arrow function)
- เราต้องการ trigger effect เฉพาะเมื่อ `dateRange` เปลี่ยน (user เลือกวันที่)
- ไม่ต้องการ trigger เมื่อ `onChange` reference เปลี่ยน

**Pattern นี้เป็น best practice ของ React:**
- Callback props (onChange, onSubmit, onClick, etc.) **ไม่ควรอยู่ใน effect deps**
- ถ้าจำเป็นต้องใช้ latest callback → ใช้ `useRef` แทน
- หรือ parent ใช้ `useCallback` เพื่อ memoize callback

---

## Verification

### Build Status: ✅ PASSED
```bash
npm run build
✓ Compiled successfully
```

### Manual Test Results: ✅ ALL PASSED
1. ✅ /expenses → renders, no error
2. ✅ /sales → renders, no error
3. ✅ /finance/marketplace-wallets → renders, no error
4. ✅ /daily-pl → renders, no error
5. ✅ /company-cashflow → renders, no error
6. ✅ /reconciliation → renders, no error
7. ✅ Date picker interaction → works correctly
8. ✅ Preset buttons (Today, Last 7 Days, MTD) → works
9. ✅ Custom date range selection → works
10. ✅ Date range auto-apply → triggers parent onChange correctly

---

## Lessons Learned

### ❌ Common Pitfalls (ข้อผิดพลาดที่มักเกิด)

**1. Callback Props in useEffect Deps**
```typescript
// ❌ BAD: Causes infinite loop
useEffect(() => {
  onChange(value);
}, [value, onChange]);

// ✅ GOOD: Only trigger on value change
useEffect(() => {
  onChange(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [value]);
```

**2. setState in Callback Refs**
```typescript
// ❌ BAD: Causes infinite loop
<div ref={(el) => setState(el)} />

// ✅ GOOD: Use useRef + useLayoutEffect
const ref = useRef<HTMLDivElement>(null);
useLayoutEffect(() => {
  if (ref.current) {
    setState(ref.current);
  }
}, []); // Only on mount
<div ref={ref} />
```

**3. useEffect with Self-Dependency**
```typescript
// ❌ BAD: Infinite loop
useEffect(() => {
  setX(x + 1);
}, [x]);

// ✅ GOOD: Use functional update
useEffect(() => {
  setX(prev => prev + 1);
}, []); // Or remove x from deps
```

### 🎯 Best Practices

**When to Include Callback Props in Deps:**
- ❌ Never for "notification" callbacks (onChange, onSubmit, onSuccess)
- ✅ Only if callback captures external state you MUST react to
- ✅ Or use `useCallback` in parent + include in deps (overkill for simple cases)

**Callback Prop Patterns:**
```typescript
// Pattern 1: Omit from deps (most common) ✅
useEffect(() => {
  if (condition) {
    onChange(value);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [value]);

// Pattern 2: Use useRef (if need latest) ✅
const onChangeRef = useRef(onChange);
onChangeRef.current = onChange;

useEffect(() => {
  if (condition) {
    onChangeRef.current(value);
  }
}, [value]);

// Pattern 3: Parent uses useCallback ✅
// Parent:
const handleChange = useCallback((val) => {
  setParentState(val);
}, []); // Empty deps if no external dependencies

// Child: Now safe to include in deps
useEffect(() => {
  onChange(value);
}, [value, onChange]);
```

---

## Regression Guard

### Prevention Measures:

**1. Code Comment Added:**
```typescript
// Note: onChange intentionally omitted from deps to avoid infinite loop
// (parent may recreate onChange on every render, but we only want to trigger on dateRange change)
```

**2. ESLint Disable with Explanation:**
```typescript
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [dateRange]); // Only dateRange
```

**3. Documentation Updated:**
- `BUGFIX_INFINITE_LOOP.md` (this file)
- Pattern documented for future reference

**4. Similar Components Checked:**
- ✅ SingleDatePicker - Safe (no useEffect with onChange)
- ✅ Other date pickers - No similar issues found

### Code Review Checklist:

เมื่อสร้าง/แก้ไข shared components ให้ตรวจสอบ:
- [ ] useEffect deps array: callback props ไม่ควรอยู่ใน deps
- [ ] Callback refs: ไม่ควรเรียก setState โดยตรง
- [ ] Parent components: พิจารณาใช้ useCallback ถ้าส่ง callback ไป child ที่มี useEffect
- [ ] Test on multiple pages: ถ้า component ใช้ global → ต้องทดสอบทุกหน้า

---

## Impact Assessment

### Before Fix:
- 🔴 **Severity:** CRITICAL
- 🚨 **Impact:** 100% of pages blocked (cannot render)
- ⏱️ **Duration:** Immediate after Task D deployment
- 👥 **Affected Users:** All users (if deployed to production)

### After Fix:
- ✅ **Status:** Resolved
- ✅ **Verification:** All pages render correctly
- ✅ **Performance:** No impact (callback omission is standard pattern)
- ✅ **Functionality:** Date pickers work as expected

---

## Related Files

### Changed:
- `frontend/src/components/shared/SingleDateRangePicker.tsx` (fix applied)

### Checked (no changes needed):
- `frontend/src/components/shared/SingleDatePicker.tsx` (safe)
- All pages using date pickers (no changes needed)

---

## References

### React Documentation:
- [useEffect dependencies](https://react.dev/reference/react/useEffect#specifying-reactive-dependencies)
- [Removing Effect dependencies](https://react.dev/learn/removing-effect-dependencies)

### Similar Issues:
- [Radix UI compose-refs infinite loop](https://github.com/radix-ui/primitives/issues/1937)
- [React Hook exhaustive-deps warning](https://github.com/facebook/react/issues/14920)

### Related Tasks:
- Task D: Unified Date Picker (Bangkok Timezone) - Phase 7
- Component created/modified causing this bug

---

**Fix Applied:** 2026-01-25
**Commit:** `cbcd9cf` - fix: prevent infinite render loop in SingleDateRangePicker (radix refs)
**Verified By:** Manual testing + Build passed
**Status:** ✅ CLOSED

---

## Appendix: Debug Process

### Steps Taken to Find Root Cause:

1. **Identified Symptom:**
   - Error: "Maximum update depth exceeded"
   - Stack: @radix-ui/react-compose-refs setRef

2. **Narrowed Down Scope:**
   - Affects all pages → must be shared component
   - Recently changed: SingleDateRangePicker (Task D)

3. **Inspected Component:**
   - Checked useEffect hooks
   - Found `onChange` in dependency array

4. **Understood Loop Mechanism:**
   - Parent recreates onChange → Child useEffect triggers
   - Effect calls onChange → Parent updates state
   - Parent re-renders → Loop repeats

5. **Applied Fix:**
   - Remove onChange from deps
   - Add explanatory comment
   - Verify build passes

6. **Manual Verification:**
   - Test all pages using component
   - Verify date pickers still work
   - Confirm no other regressions

### Debug Time: ~10 minutes
### Fix Time: ~2 minutes
### Total: ~12 minutes

---

**Document Version:** 1.0
**Last Updated:** 2026-01-25
