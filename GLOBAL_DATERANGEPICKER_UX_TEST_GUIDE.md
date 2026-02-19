# Global DateRangePicker UX Standard - Manual Test Guide

## 🎯 Global UX Decision

**Decision:** Standardize DateRangePicker behavior across **ALL** pages in the entire app.

**Core Principle:**
- ❌ **NO** fetch/apply on first click (start date)
- ✅ **ONLY** apply when range is complete (start + end)
- ✅ Auto-close popover after commit
- ✅ Support single-day selection (click same date twice)

---

## 📋 Summary of Changes

### ✅ What Changed

**File:** `frontend/src/components/shared/SingleDateRangePicker.tsx`

**Refactored to use Draft + Applied State Pattern:**

1. **Two State System:**
   - `draftRange`: Internal calendar selection (not yet applied)
   - `appliedRange`: Committed range (shown in button, sent to parent)

2. **Commit Logic:**
   ```typescript
   // First click: Set draftRange.from, NO commit
   // Second click: Set draftRange.to, COMMIT + close
   // Same date twice: Single-day range, COMMIT + close
   // Presets: Immediate COMMIT (both dates set at once)
   ```

3. **User Guidance:**
   - Hint text inside popover:
     - No start selected: "เลือกวันเริ่มต้นและวันสิ้นสุด"
     - Start selected: "เลือกวันสิ้นสุด"

4. **Network Efficiency:**
   - Before: 2 network requests (first click + second click)
   - After: 1 network request (only on commit)

---

## 🗂️ Files Changed

### 1. Shared Component (Global)
**File:** `frontend/src/components/shared/SingleDateRangePicker.tsx`
**Changes:** +84 lines, -22 lines
**Impact:** All pages using this component (8+ pages)

### 2. Pages Automatically Fixed (No Code Changes Needed)
These pages use `SingleDateRangePicker` and automatically inherit the new behavior:
- ✅ `/ads` - Ads Performance
- ✅ `/sales` - Sales Orders
- ✅ `/expenses` - Expenses
- ✅ `/finance/marketplace-wallets` - Cashflow (Settlement tracking)
- ✅ `/company-cashflow` - Company Cashflow
- ✅ `/reconciliation` - P&L vs Cashflow Reconciliation
- ✅ `/bank` - Bank Module (Daily Summary + Transactions)
- ✅ `/bank-reconciliation` - Bank Reconciliation

**Total Pages Affected:** 8+ pages

---

## 🧪 Manual Test Cases (CRITICAL - MUST PASS)

### Test Case 1: Basic Range Selection (Two Clicks)
**Steps:**
1. เปิดหน้า `/sales`
2. คลิก date range picker button
3. Popover เปิด → ดู hint text ควรเห็น "เลือกวันเริ่มต้นและวันสิ้นสุด"
4. คลิกวันที่ 16 มกราคม 2026 (start date)
5. **⚠️ CRITICAL CHECK:**
   - Popover ยังเปิดอยู่ (ไม่ปิด)
   - Hint text เปลี่ยนเป็น "เลือกวันสิ้นสุด"
   - **NO network request** (เปิด browser DevTools → Network tab → ไม่มี request ใหม่)
   - Button ยังแสดงค่าเดิม (ไม่เปลี่ยน)
6. คลิกวันที่ 18 มกราคม 2026 (end date)

**Expected:**
- ✅ Popover ปิดอัตโนมัติ
- ✅ Button แสดง "16 Jan 2026 – 18 Jan 2026"
- ✅ **Exactly ONE network request** (fetch data for 16-18 Jan)
- ✅ Data table refresh พร้อมข้อมูลวันที่ 16-18
- ✅ Summary cards update

**FAIL IF:**
- ❌ Popover ปิดหลังคลิก start date
- ❌ มี network request หลังคลิก start date
- ❌ มี network request 2 ครั้ง (start + end)

---

### Test Case 2: Single-Day Selection (Click Same Date Twice)
**Steps:**
1. เปิดหน้า `/expenses`
2. คลิก date range picker button
3. คลิกวันที่ 20 มกราคม 2026 (first click)
4. **⚠️ CRITICAL CHECK:** Popover ยังเปิด, NO network request
5. คลิกวันที่ 20 มกราคม 2026 อีกครั้ง (same date, second click)

**Expected:**
- ✅ Popover ปิดอัตโนมัติ
- ✅ Button แสดง "20 Jan 2026 – 20 Jan 2026" (single day)
- ✅ **Exactly ONE network request**
- ✅ Data table แสดงข้อมูลเฉพาะวันที่ 20

**FAIL IF:**
- ❌ ไม่สามารถเลือกวันเดียวได้
- ❌ มี network request 2 ครั้ง

---

### Test Case 3: Preset Buttons (Immediate Apply)
**Steps:**
1. เปิดหน้า `/ads`
2. คลิกปุ่ม "วันนี้" (Today preset)

**Expected:**
- ✅ **Immediate commit** (ไม่ต้องเปิด popover)
- ✅ Button แสดงวันนี้ (start = end = today)
- ✅ **Exactly ONE network request**
- ✅ Data table refresh ทันที

**Steps (Continue):**
3. คลิกปุ่ม "7 วันล่าสุด" (Last 7 Days)

**Expected:**
- ✅ **Immediate commit**
- ✅ Button แสดง range 7 วัน
- ✅ **Exactly ONE network request**
- ✅ Data table refresh

**Steps (Continue):**
4. คลิกปุ่ม "MTD" (Month to Date)

**Expected:**
- ✅ **Immediate commit**
- ✅ Button แสดง range วันที่ 1 ของเดือนจนถึงวันนี้
- ✅ **Exactly ONE network request**

---

### Test Case 4: Range Selection Cancellation
**Steps:**
1. เปิดหน้า `/finance/marketplace-wallets`
2. คลิก date range picker button
3. คลิกวันที่ 10 มกราคม (start date)
4. **ไม่คลิก end date**
5. คลิกข้างนอก popover (หรือกด ESC) เพื่อปิด popover

**Expected:**
- ✅ Popover ปิด
- ✅ Button ยังแสดงค่าเดิม (ไม่เปลี่ยน)
- ✅ **NO network request** (draft discarded)
- ✅ Data table ยังแสดงข้อมูลเดิม

**Steps (Continue):**
6. เปิด popover อีกครั้ง

**Expected:**
- ✅ Calendar แสดง applied range เดิม (ไม่ใช่ draft ที่ discard ไป)
- ✅ Hint text: "เลือกวันเริ่มต้นและวันสิ้นสุด" (reset)

---

### Test Case 5: Multiple Pages Consistency
**Steps:**
1. เปิดหน้า `/sales` → ทดสอบ range selection (16-18 Jan)
2. เปิดหน้า `/expenses` → ทดสอบ range selection (10-12 Jan)
3. เปิดหน้า `/ads` → ทดสอบ range selection (15-20 Jan)
4. เปิดหน้า `/company-cashflow` → ทดสอบ range selection (1-7 Jan)
5. เปิดหน้า `/bank` → ทดสอบ range selection (20-25 Jan)

**Expected (All Pages):**
- ✅ First click: NO fetch, popover stays open
- ✅ Second click: ONE fetch, popover closes
- ✅ Same date twice: ONE fetch, single-day range
- ✅ Presets: Immediate fetch
- ✅ **IDENTICAL behavior** ทุกหน้า (no exceptions)

**FAIL IF:**
- ❌ หน้าใดหน้าหนึ่งมี behavior ต่าง (inconsistent)

---

### Test Case 6: Network Request Count Verification
**Critical Test:** ตรวจสอบจำนวน network requests

**Steps:**
1. เปิด browser DevTools → Network tab
2. Filter: ดูเฉพาะ XHR/Fetch requests
3. Clear console (กด Clear button)
4. เปิดหน้า `/sales`
5. คลิก date range picker
6. คลิก start date (16 Jan)
7. **⚠️ COUNT requests:** ควรเป็น **0 requests**
8. คลิก end date (18 Jan)
9. **⚠️ COUNT requests:** ควรเป็น **1 request** (เช่น `getAdsPerformance` หรือ `getSalesOrders`)

**Expected:**
- ✅ Total requests = **1** (exactly one)
- ✅ No requests on first click
- ✅ One request on second click

**FAIL IF:**
- ❌ Total requests = 2 (double fetch)
- ❌ Request on first click

---

### Test Case 7: Hint Text Visibility
**Steps:**
1. เปิดหน้า `/expenses`
2. คลิก date range picker button
3. ดู popover (ยังไม่คลิกอะไร)

**Expected:**
- ✅ Hint text ที่ด้านล่าง calendar: "เลือกวันเริ่มต้นและวันสิ้นสุด"
- ✅ Background สี muted (bg-muted/30)
- ✅ Text สี muted (text-muted-foreground)
- ✅ Font size เล็ก (text-xs)

**Steps (Continue):**
4. คลิกวันที่ 15 มกราคม (start date)

**Expected:**
- ✅ Hint text เปลี่ยนเป็น: "เลือกวันสิ้นสุด"

**Steps (Continue):**
5. คลิกวันที่ 20 มกราคม (end date)

**Expected:**
- ✅ Popover ปิด (ไม่เห็น hint text)

---

### Test Case 8: Rapid Clicks (Edge Case)
**Steps:**
1. เปิดหน้า `/ads`
2. คลิก date range picker
3. คลิกวันที่ 10 มกราคม (start)
4. รีบคลิกวันที่ 11 มกราคม (end) ทันที (rapid double click)

**Expected:**
- ✅ Popover ปิดปกติ
- ✅ **Exactly ONE network request** (ไม่ซ้ำซ้อน)
- ✅ ไม่มี race condition
- ✅ Data แสดงถูกต้อง (10-11 Jan)

---

### Test Case 9: Preset After Manual Selection
**Steps:**
1. เปิดหน้า `/sales`
2. คลิก date range picker → เลือก 16-18 Jan manually
3. Data table แสดงข้อมูล 16-18 Jan
4. คลิกปุ่ม "วันนี้" preset

**Expected:**
- ✅ Button เปลี่ยนเป็นวันนี้ทันที
- ✅ **ONE new network request**
- ✅ Data table refresh ด้วยข้อมูลวันนี้
- ✅ Manual selection ก่อนหน้าถูก replace (ไม่ overlap)

---

### Test Case 10: URL Params (if implemented)
**Note:** Test เฉพาะหน้าที่ใช้ URL params (เช่น `/ads?tab=product`)

**Steps:**
1. เปิดหน้า `/ads?tab=product`
2. คลิก date range picker → เลือก 16-18 Jan
3. ดู URL

**Expected:**
- ✅ URL **ไม่มี** date params ระหว่างเลือก (draft)
- ✅ URL **มี** date params หลัง commit (ถ้า feature มีการเก็บ date ใน URL)
- ✅ Refresh หน้า → date range คงอยู่ (ถ้า persist ใน URL)

**FAIL IF:**
- ❌ URL update ระหว่าง draft (first click)

---

## 🎯 Acceptance Criteria (ALL MUST PASS)

### Critical Requirements
1. ✅ **NO fetch on first click** (start date only)
2. ✅ **ONE fetch on second click** (range complete)
3. ✅ **Popover auto-close only after commit**
4. ✅ **Single-day selection works** (same date twice)
5. ✅ **Presets apply immediately**
6. ✅ **Hint text displays correctly**
7. ✅ **Behavior consistent across ALL pages** (no exceptions)
8. ✅ **No race conditions or double requests**
9. ✅ **Draft discarded on cancel** (no partial apply)
10. ✅ **No breaking changes to existing pages**

---

## 🚨 Known Edge Cases & Behavior

### 1. Calendar Mode: Range
- Library: `react-day-picker` (shadcn/ui Calendar component)
- Mode: `range` (allows selecting start + end)
- Default behavior: First click → `from` only, Second click → `from` + `to`

### 2. Single-Day Selection Implementation
```typescript
// User clicks 20 Jan (first click)
draftRange = { from: 20 Jan, to: undefined }

// User clicks 20 Jan again (second click)
// react-day-picker sets: from=20 Jan, to=20 Jan
// Our code detects: from.getTime() === to.getTime()
// → Commit immediately (single-day range)
```

### 3. Preset vs Manual Selection
- **Presets**: Set both `from` and `to` at once → Immediate commit
- **Manual**: User picks one at a time → Wait for both

### 4. Cancel Behavior
- User closes popover without selecting end date
- Draft discarded, applied range unchanged
- Next open: Draft syncs with applied range (clean state)

---

## 📊 Performance Impact

### Before (Old Behavior)
- First click: 1 network request (wrong!)
- Second click: 1 network request
- **Total: 2 requests** per range selection

### After (New Behavior)
- First click: 0 requests
- Second click: 1 request
- **Total: 1 request** per range selection

**Improvement:** 50% reduction in unnecessary network requests

---

## 🔄 Rollback Plan (If Issues Found)

```bash
git revert 4e953b2
```

Or manually restore:
```typescript
// Revert to old useEffect auto-apply logic
useEffect(() => {
  if (dateRange?.from && dateRange?.to) {
    onChange({
      startDate: dateRange.from,
      endDate: dateRange.to,
    });
  }
}, [dateRange]);
```

---

## 📞 Contact

หากพบปัญหาหรือผลทดสอบไม่ตรงตาม expected → รายงานผลพร้อม:
1. **Page URL** (เช่น `/sales`, `/ads`)
2. **Steps to reproduce** (คลิกอะไรบ้าง)
3. **Expected vs Actual behavior**
4. **Screenshot of Network tab** (แสดงจำนวน requests)
5. **Screenshot of popover** (แสดง hint text)
6. **Browser console log** (ถ้ามี errors)

---

## 🎉 Success Criteria

**Definition of Done:**
- ✅ All 10 test cases pass
- ✅ No regression on existing pages
- ✅ Consistent behavior across entire app
- ✅ Network requests reduced by 50%
- ✅ User feedback improved (hint text)
- ✅ No breaking changes

**Ready for Production:** พร้อม deploy หากทุก test case passed
