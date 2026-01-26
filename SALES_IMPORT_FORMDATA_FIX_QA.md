# Sales Import FormData Fix - Manual QA Checklist

## เป้าหมาย
แก้ไขปัญหา "Only plain objects, and a few built-ins, can be passed to Server Actions" โดยเปลี่ยนให้ทุก Server Action ใช้ FormData pattern

## ไฟล์ที่แก้ไข
1. `frontend/src/app/(dashboard)/sales/sales-import-actions.ts` (Backend)
2. `frontend/src/components/sales/SalesImportDialog.tsx` (Frontend)

---

## Test Case 1: New File Import (First Time)

### Setup
- เตรียมไฟล์ TikTok OrderSKUList.xlsx ที่ยังไม่เคย import

### Steps
1. Login เข้าระบบ
2. ไปหน้า `/sales`
3. Click ปุ่ม "Import"
4. เลือกไฟล์ TikTok OrderSKUList.xlsx
5. รอ Preview โหลด

### Expected Results
- ✅ ไม่มี Console error: "Only plain objects..."
- ✅ Preview แสดงข้อมูลถูกต้อง (summary, sample rows)
- ✅ Click "Confirm Import" → Import สำเร็จ
- ✅ แสดงผลลัพธ์: "Import สำเร็จ: X รายการ | รายได้รวม: ฿XX,XXX"
- ✅ หน้า `/sales` refresh แล้วเห็นข้อมูลใหม่

### Pass Criteria
- [ ] ไม่มี payload error ใน Console
- [ ] Import สำเร็จและข้อมูลเข้า database

---

## Test Case 2: Duplicate File Detection

### Setup
- ใช้ไฟล์เดียวกับ Test Case 1

### Steps
1. เปิด Import dialog อีกครั้ง
2. เลือกไฟล์เดิม (ที่เพิ่ง import ไปแล้ว)
3. รอ Preview โหลด

### Expected Results
- ✅ ไม่มี Console error
- ✅ Preview แสดงข้อมูลถูกต้อง
- ✅ Click "Confirm Import"
- ✅ แสดง Duplicate prompt:
  - "ไฟล์นี้ถูก import ไปแล้ว"
  - แสดงชื่อไฟล์และวันที่ import
  - มีปุ่ม: "ยกเลิก" และ "นำเข้าซ้ำเพื่ออัปเดตข้อมูล"

### Pass Criteria
- [ ] ไม่มี payload error
- [ ] Duplicate detection ทำงานถูกต้อง
- [ ] UI แสดง prompt ถูกต้อง

---

## Test Case 3: Re-import Action

### Setup
- อยู่ใน Duplicate prompt จาก Test Case 2

### Steps
1. Click ปุ่ม "นำเข้าซ้ำเพื่ออัปเดตข้อมูล"
2. รอ import เสร็จ

### Expected Results
- ✅ ไม่มี Console error
- ✅ Import เสร็จโดยไม่มีข้อผิดพลาด
- ✅ แสดงผลลัพธ์: "Import สำเร็จ: X รายการ"
- ✅ Log ใน Console (ฝั่ง server): `[RE-IMPORT] User: ... | File: ... | FileHash: ...`

### Pass Criteria
- [ ] ไม่มี payload error
- [ ] Re-import ทำงานถูกต้อง (upsert data)
- [ ] Server log แสดง re-import flag

---

## Test Case 4: Cancel Re-import

### Setup
- Repeat Test Case 2 เพื่อเข้า Duplicate prompt

### Steps
1. Click ปุ่ม "ยกเลิก"

### Expected Results
- ✅ กลับไปหน้า Upload (step 'upload')
- ✅ File input ถูก reset (เลือกไฟล์ใหม่ได้)
- ✅ ไม่มี error

### Pass Criteria
- [ ] Cancel action ทำงานถูกต้อง
- [ ] State ถูก reset

---

## Test Case 5: Large File (Chunked Import)

### Setup
- เตรียมไฟล์ที่มีมากกว่า 500 rows (เพื่อทดสอบ chunking)

### Steps
1. Import ไฟล์ขนาดใหญ่
2. สังเกต import progress

### Expected Results
- ✅ ไม่มี Console error
- ✅ แสดง progress: "Processing chunk 1 of 2", "Processing chunk 2 of 2", etc.
- ✅ Import สำเร็จทุก chunk
- ✅ Finalize batch สำเร็จ
- ✅ ข้อมูลเข้า database ถูกต้อง (ตรวจสอบจำนวนแถว)

### Pass Criteria
- [ ] Chunked import ทำงานถูกต้อง
- [ ] ไม่มี payload error ในทุก chunk

---

## Test Case 6: Invalid File Format

### Setup
- เตรียมไฟล์ .xlsx ที่ไม่ใช่ TikTok OrderSKUList format

### Steps
1. Import ไฟล์ที่ไม่ถูกต้อง
2. รอ Preview

### Expected Results
- ✅ ไม่มี Console error: "Only plain objects..."
- ✅ Preview แสดง error: "ไม่สามารถตรวจจับรูปแบบ TikTok Shop (OrderSKUList) ได้"
- ✅ ปุ่ม "Confirm Import" ถูก disable
- ✅ แนะนำให้ใช้ Manual Mapping

### Pass Criteria
- [ ] Validation ทำงานถูกต้อง
- [ ] Error message ชัดเจน

---

## Test Case 7: Console Error Check

### Setup
- เปิด DevTools → Console tab

### Steps
1. ทำ Test Case 1-6 ทั้งหมด
2. สังเกต Console

### Expected Results
- ✅ ไม่มี error: "Only plain objects, and a few built-ins, can be passed to Server Actions"
- ✅ ไม่มี error เกี่ยวกับ "Classes or null prototypes are not supported"
- ✅ อาจมี warning หรือ info log ปกติ (ไม่เป็น error สีแดง)

### Pass Criteria
- [ ] ไม่มี payload error ใน Console เลย

---

## Regression Tests

### Test R1: Manual Order CRUD (Sales Page)
- ทดสอบ Add/Edit/Delete order แบบ manual (ไม่ใช่ import)
- Expected: ทำงานปกติ ไม่มี regression

### Test R2: Export CSV
- Click "Export CSV" ในหน้า Sales
- Expected: Export สำเร็จ ไม่มี error

### Test R3: Filter and Search
- ทดสอบ filter (platform, status, payment, date range)
- ทดสอบ search
- Expected: ทำงานปกติ

---

## Acceptance Criteria (สรุป)

- ✅ ทุก Test Case (1-7) pass ทั้งหมด
- ✅ ไม่มี "Only plain objects..." error ใน Console เลย
- ✅ Import logic ทำงานเหมือนเดิม (no behavior change)
- ✅ Duplicate detection ทำงาน
- ✅ Re-import action ทำงาน
- ✅ Chunked import ทำงาน (files > 500 rows)
- ✅ Error handling ถูกต้อง (invalid files)
- ✅ ไม่มี regression ใน Sales CRUD/Export/Filter

---

## Technical Notes

### การเปลี่ยนแปลง

**Backend (Server Actions):**
```typescript
// Before
export async function createImportBatch(
  fileHash: string,
  fileName: string,
  totalRows: number,
  dateRange: string,
  allowReimport?: boolean
)

// After
export async function createImportBatch(
  formData: FormData
) {
  const fileHash = formData.get('fileHash') as string
  const fileName = formData.get('fileName') as string
  const totalRows = parseInt(formData.get('totalRows') as string, 10)
  // ...
}
```

**Frontend (Client Calls):**
```typescript
// Before
await createImportBatch(fileHash, fileName, totalRows, dateRange, allowReimport)

// After
const fd = buildBatchFormData(fileHash, fileName, totalRows, dateRange, allowReimport)
await createImportBatch(fd)
```

### Helper Functions
- `buildBatchFormData()` - สร้าง FormData สำหรับ createImportBatch
- `buildChunkFormData()` - สร้าง FormData สำหรับ importSalesChunk
- `buildFinalizeFormData()` - สร้าง FormData สำหรับ finalizeImportBatch

### Business Rules (ไม่เปลี่ยนแปลง)
- TikTok OrderSKUList detection
- Line-level import (each SKU = separate row)
- File hash deduplication (SHA256)
- Chunked import (500 rows per chunk)
- Idempotent upsert (order_line_hash)
- Status normalization (Thai keywords support)
- Bangkok timezone consistency

---

## Test Status

**Tester:** ______________
**Date:** ______________
**Result:** ☐ PASS | ☐ FAIL

**Notes:**
-
-
-

**Issues Found (if any):**
1.
2.
3.

---

**ตอนนี้พร้อมทดสอบแล้ว - กรุณาทดสอบตาม checklist ทั้ง 7 test cases และ regression tests**
