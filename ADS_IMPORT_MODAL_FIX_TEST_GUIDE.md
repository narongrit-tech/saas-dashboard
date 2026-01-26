# Ads Import Modal Fix - Manual Test Guide

## สรุปการแก้ไข

### ปัญหาที่แก้ไป
1. **Modal Stuck Issue**: หลัง import สำเร็จ modal ติดอยู่ที่หน้า "result" → กด Import อีกครั้งเปิดหน้า result เดิม (ไม่ reset state)
2. **No Feedback**: ไม่มี toast notification หลัง import สำเร็จ
3. **UX Confusion**: User ต้องปิด modal ก่อนถึงจะเปิดใหม่ได้ปกติ

### Solution Implemented
**Option 1: Force Remount with Key (Preferred)**
- เพิ่ม `modalInstanceKey` state ในหน้า `/ads`
- เมื่อกด "Import Ads Data" button → increment key + open modal
- React remount component เมื่อ key เปลี่ยน → reset internal state ทั้งหมด

---

## 📋 Files Changed

### 1. Frontend Page (`ads/page.tsx`)
**Changes:**
- เพิ่ม state: `const [modalInstanceKey, setModalInstanceKey] = useState(0);`
- เพิ่ม handler:
  ```typescript
  const handleOpenImportDialog = () => {
    setModalInstanceKey((k) => k + 1); // Force remount
    setImportDialogOpen(true);
  };
  ```
- แก้ปุ่ม Import: `<Button onClick={handleOpenImportDialog}>`
- แก้ render modal: `<ImportAdsDialog key={modalInstanceKey} .../>`
- แก้ `handleImportSuccess()`: ลบ `setImportDialogOpen(false)` (ไม่ปิด modal ทันที)

**Lines Changed:** +10, -1

---

### 2. Import Dialog Component (`ImportAdsDialog.tsx`)
**Changes:**
- เพิ่ม toast notification หลัง import สำเร็จ:
  ```typescript
  toast({
    title: '✓ Import สำเร็จ',
    description: `นำเข้าข้อมูล ${data.insertedCount} rows (Updated: ${data.updatedCount})`,
    variant: 'default',
  });
  ```
- เรียก `onSuccess()` (refetch data) แต่ไม่ปิด modal
- User กด "Close" button เองเมื่อดู result เสร็จ

**Lines Changed:** +8, -1

---

## ✅ How It Works

### User Flow (Fixed)
1. User คลิก "Import Ads Data" button
   - `handleOpenImportDialog()` ถูกเรียก
   - `modalInstanceKey` เพิ่มขึ้น (0 → 1)
   - Modal remount พร้อม clean state (step='upload')

2. User เลือกไฟล์ + preview + import
   - Import สำเร็จ → `step='result'`

3. หลัง import สำเร็จ:
   - 🎉 **Toast แสดง**: "✓ Import สำเร็จ - นำเข้าข้อมูล N rows (Updated: M)"
   - 📊 **Data table refresh**: router.refresh() + fetchData()
   - 📄 **Modal ยังเปิด**: แสดงหน้า result พร้อม:
     - Import summary (rows processed, inserted, updated)
     - Preview totals (Spend, Orders, Revenue, ROI)
     - Batch ID
     - Rollback button

4. User กด "Close" button
   - Modal ปิด
   - Internal state ยังคงเป็น `step='result'` (แต่ไม่เป็นปัญหา)

5. User คลิก "Import Ads Data" อีกครั้ง
   - `modalInstanceKey` เพิ่มขึ้นอีก (1 → 2)
   - React remount component ใหม่
   - ✅ **Modal reset เป็น step='upload'** (file picker screen)

---

## 🧪 Manual Test Cases

### Test Case 1: First Import Success Flow
**Steps:**
1. เปิดหน้า `/ads`
2. คลิก "Import Ads Data (.xlsx)" button
3. เลือก Report Date, Ads Type, File
4. คลิก "ดู Preview"
5. คลิก "ยืนยันนำเข้า"
6. รอจนกว่า import สำเร็จ

**Expected:**
- ✅ Toast notification ขึ้นมุมขวาบน: "✓ Import สำเร็จ - นำเข้าข้อมูล X rows (Updated: Y)"
- ✅ Modal ยังเปิดอยู่ที่หน้า "result" (ไม่ปิดทันที)
- ✅ แสดง Import Summary:
  - Rows Processed
  - Inserted count
  - Updated count
  - Data Imported (Spend, Orders, Revenue, ROI)
  - Batch ID
- ✅ ปุ่ม "Close" และ "Rollback This Import" แสดง
- ✅ Data table refresh (แสดงข้อมูลใหม่ที่ import)

---

### Test Case 2: Modal Reset After Close
**Steps:**
1. ทำ Test Case 1 จนถึง import สำเร็จ (modal แสดง result)
2. คลิก "Close" button
3. คลิก "Import Ads Data (.xlsx)" อีกครั้ง

**Expected:**
- ✅ Modal เปิดที่หน้า **"Select file"** (step='upload')
- ✅ ไม่เห็นหน้า result เดิม (reset clean)
- ✅ Form ว่างเปล่า (ไม่มี file, date, type จาก import ก่อน)
- ✅ Ready สำหรับ import ใหม่ทันที

**Critical Check:**
- ❌ ห้ามเห็นหน้า result เดิม
- ❌ ห้าม stuck ที่ step='result'

---

### Test Case 3: Multiple Imports in a Row
**Steps:**
1. Import file 1 → สำเร็จ → modal แสดง result
2. คลิก "Close"
3. Import file 2 → สำเร็จ → modal แสดง result
4. คลิก "Close"
5. Import file 3 → สำเร็จ → modal แสดง result

**Expected:**
- ✅ ทุกครั้งที่เปิด modal ใหม่ → เริ่มที่ file picker (ไม่ stuck)
- ✅ Toast แสดงทุกครั้งหลัง import สำเร็จ
- ✅ Data table refresh ทุกครั้ง
- ✅ Batch ID เปลี่ยนไปทุกครั้ง (import ใหม่)

---

### Test Case 4: Import Error Handling
**Steps:**
1. คลิก "Import Ads Data"
2. เลือกไฟล์ที่ผิด format หรือ duplicate
3. คลิก "ยืนยันนำเข้า"
4. Import failed (เช่น duplicate import error)

**Expected:**
- ✅ Modal กลับไป step='preview' (ไม่ไปที่ result)
- ✅ แสดง error message พร้อม rollback button (ถ้าเป็น duplicate)
- ✅ ไม่มี toast notification (เพราะ import ไม่สำเร็จ)

**Steps (Continue):**
5. คลิก "กลับ" → กลับไป step='upload'
6. คลิก "Close" modal
7. คลิก "Import Ads Data" อีกครั้ง

**Expected:**
- ✅ Modal reset เป็น step='upload' (ไม่เห็น error ก่อนหน้า)

---

### Test Case 5: Rollback Still Works
**Steps:**
1. Import สำเร็จ → modal แสดง result พร้อม Batch ID
2. คลิก "Rollback This Import" button
3. ยืนยัน rollback ใน confirmation dialog

**Expected:**
- ✅ Toast แสดง: "Rollback Success - ลบข้อมูลสำเร็จ: X ads records, Y wallet entries"
- ✅ Data table refresh (ข้อมูลที่ import หายไป)
- ✅ Modal ปิดอัตโนมัติหลัง rollback สำเร็จ

**Steps (Continue):**
4. คลิก "Import Ads Data" อีกครั้ง

**Expected:**
- ✅ Modal เปิดที่ step='upload' (ไม่มีร่องรอยของ import ก่อนหน้า)

---

### Test Case 6: Toast Notification Content
**Steps:**
1. Import file สำเร็จ (สมมติ: 100 rows processed, 80 inserted, 20 updated)
2. ดู toast notification

**Expected:**
- ✅ Title: "✓ Import สำเร็จ"
- ✅ Description: "นำเข้าข้อมูล 80 rows (Updated: 20)"
- ✅ Toast แสดงเวลาพอสมควร (default: 5 seconds) แล้วค่อยหายไป
- ✅ Toast style: success (ไม่ใช่ error หรือ warning)

---

### Test Case 7: Rapid Clicks (Edge Case)
**Steps:**
1. คลิก "Import Ads Data" button
2. ยังไม่ทันเลือกไฟล์ → คลิก "Close"
3. คลิก "Import Ads Data" อีกครั้งทันที (rapid click)

**Expected:**
- ✅ Modal เปิดปิดได้ปกติ
- ✅ ไม่มี race condition
- ✅ ทุกครั้งที่เปิด → เริ่มที่ step='upload'

---

### Test Case 8: Import While Modal Open (Edge Case)
**Steps:**
1. คลิก "Import Ads Data" → modal เปิด (step='upload')
2. **อย่าปิด modal**
3. คลิก "Import Ads Data" button อีกครั้ง (ในพื้นหลัง, ถ้ามองเห็น)

**Expected:**
- Option A (Current): ไม่เกิดอะไร (modal ยังเปิดอยู่เหมือนเดิม)
- Option B (Better UX): Modal reset เป็น step='upload' (ถ้า implementation รองรับ)

**Note:** ตาม current implementation ปุ่ม Import น้อยที่จะคลิกได้ตอน modal เปิดอยู่ (modal fullscreen)

---

## 🔧 Technical Details

### Key-Based Remount Mechanism
```typescript
// page.tsx
const [modalInstanceKey, setModalInstanceKey] = useState(0);

const handleOpenImportDialog = () => {
  setModalInstanceKey((k) => k + 1); // 0 → 1 → 2 → ...
  setImportDialogOpen(true);
};

// Render
<ImportAdsDialog
  key={modalInstanceKey} // ← React remounts when key changes
  open={importDialogOpen}
  onOpenChange={setImportDialogOpen}
  onSuccess={handleImportSuccess}
/>
```

**Why This Works:**
- React treats components with different `key` as completely different instances
- When `key` changes: React unmounts old component → mounts new component
- New component starts with initial state: `step='upload'`, `file=null`, `result=null`, etc.

---

### Toast Implementation
```typescript
// ImportAdsDialog.tsx (line 252)
toast({
  title: '✓ Import สำเร็จ',
  description: `นำเข้าข้อมูล ${data.insertedCount} rows (Updated: ${data.updatedCount})`,
  variant: 'default', // success style (green)
});
```

**Toast Hook:** `useToast()` from `@/hooks/use-toast`
**Library:** shadcn/ui toast component
**Duration:** Default 5 seconds (auto-dismiss)

---

### Data Refresh Strategy
**After Import Success:**
1. `router.refresh()` → Revalidate Next.js server components
2. `onSuccess()` → Call `fetchData()` in parent (refetch client data)
3. Toast notification → Visual feedback
4. Modal stays open → User sees result summary

**User closes modal:**
- Next open → Key changes → Remount → Clean state

---

## 🚨 Known Edge Cases & Limitations

### 1. Multiple Rapid Clicks
**Scenario:** User คลิก "Import Ads Data" หลายครั้งติดกัน
**Behavior:** `modalInstanceKey` จะเพิ่มขึ้นทุกครั้ง (0 → 1 → 2 → 3...)
**Impact:** ไม่เป็นปัญหา (key ใหญ่ขึ้นเรื่อยๆ แต่ไม่มี side effect)
**Mitigation:** ไม่จำเป็นต้องแก้ (JavaScript Number.MAX_SAFE_INTEGER = 9007199254740991)

### 2. Toast Overlap
**Scenario:** Import หลายครั้งติดกัน → toast ซ้อนกัน
**Behavior:** shadcn/ui toast จัดการ queue เอง (แสดงทีละอัน)
**Impact:** ไม่เป็นปัญหา (UX ปกติ)

### 3. Modal State Leak (Fixed)
**Before:** Internal state ไม่ reset → stuck
**After:** Key-based remount → clean state ทุกครั้ง
**Trade-off:** Lose state intentionally (ตามที่ต้องการ)

---

## 📊 Regression Testing

### Pages to Check (No Breaking Changes)
- ✅ `/ads` - Ads Performance page (primary fix)
- ✅ Other pages with import modals:
  - `/sales` - Sales Import (different modal, ไม่ควรเสีย)
  - `/expenses` - Expenses Import (different modal, ไม่ควรเสีย)
  - `/wallets` - Ads Import (ถ้ามี, ต้องเช็ค)

**Expected:** หน้าอื่นไม่ควรเสีย เพราะแก้เฉพาะ `/ads` page และ `ImportAdsDialog` component

---

## 🎯 Acceptance Criteria

✅ **Must Pass All Tests:**
1. Import สำเร็จ → toast แสดง inserted/updated counts
2. Modal ยังเปิดหลัง import สำเร็จ (แสดง result)
3. ปิด modal → กด Import อีกครั้ง → เริ่มที่ file picker (ไม่ stuck)
4. Data table refresh หลัง import
5. Rollback button ยังใช้งานได้
6. Import error ไม่ทำให้ modal stuck
7. Multiple imports ติดกันไม่มีปัญหา

---

## 🔄 Rollback Plan (หากพบปัญหา)

```bash
git revert 534c886
```

หรือแก้กลับด้วยมือ:
1. `page.tsx`: ลบ `modalInstanceKey` state และ `handleOpenImportDialog()`, เปลี่ยนกลับเป็น `onClick={() => setImportDialogOpen(true)}`
2. `page.tsx`: ลบ `key={modalInstanceKey}` จาก `<ImportAdsDialog>`
3. `page.tsx`: เพิ่ม `setImportDialogOpen(false)` กลับใน `handleImportSuccess()`
4. `ImportAdsDialog.tsx`: ลบ toast notification code

---

## 📞 Contact

หากพบปัญหา → รายงานพร้อม:
1. Screenshot ของ modal (แสดง step ที่ stuck)
2. Screenshot ของ toast notification
3. Browser console log (errors ถ้ามี)
4. Steps to reproduce (ทำอย่างไรให้เกิด bug)
5. Expected vs Actual behavior
