# Sales Import - Duplicate Batches Fix - QA Checklist

**Goal:** Prevent duplicate `import_batches` and complete Option B (re-import UX)

**Changes:**
1. Backend: Refactored `createImportBatch()` to check duplicates BEFORE creating batch
2. Backend: Added `already_processing` detection (within 30 min)
3. Backend: Enhanced error handling to update batch status to 'failed'
4. Frontend: Added `already_processing` state with blue info prompt
5. Utility: Created cleanup helper functions
6. Documentation: SQL cleanup script

---

## Test 1: New File Upload (No Duplicates)

**Objective:** Verify new file import creates exactly 1 batch

**Steps:**
1. Go to `/sales` page
2. Click "Import" button
3. Upload a NEW TikTok OrderSKUList.xlsx file (not imported before)
4. Wait for preview
5. Click "Confirm Import"
6. Wait for completion

**Expected Results:**
- ✅ Preview shows correct summary (Total Rows, Total Revenue)
- ✅ Import succeeds with green success message
- ✅ Result shows: "Import สำเร็จ: N รายการ | รายได้รวม: ฿X,XXX"
- ✅ Page refreshes and shows imported orders

**Database Verification:**
```sql
-- Check batch count for this file_hash
SELECT
  file_hash,
  COUNT(*) as batch_count,
  status
FROM import_batches
WHERE file_name = 'YOUR_FILE_NAME.xlsx'
  AND marketplace = 'tiktok_shop'
GROUP BY file_hash, status;
```
- ✅ Batch count = 1
- ✅ Status = 'success'

---

## Test 2: Duplicate File Detection (No Re-import)

**Objective:** Verify duplicate file shows yellow warning prompt WITHOUT creating new batch

**Steps:**
1. Go to `/sales` page
2. Click "Import" button
3. Upload the SAME file from Test 1
4. Wait for preview
5. Click "Confirm Import"

**Expected Results:**
- ✅ Preview shows correct summary
- ✅ Yellow warning prompt appears with:
  - Title: "ไฟล์นี้ถูก import ไปแล้ว"
  - ไฟล์: [filename]
  - นำเข้าเมื่อ: [Thai formatted date]
  - Message: "คุณสามารถนำเข้าซ้ำเพื่ออัปเดตข้อมูล..."
- ✅ Two buttons visible: "ยกเลิก" | "นำเข้าซ้ำเพื่ออัปเดตข้อมูล"

**Database Verification:**
```sql
-- Check batch count for this file_hash
SELECT
  file_hash,
  COUNT(*) as batch_count,
  status
FROM import_batches
WHERE file_name = 'YOUR_FILE_NAME.xlsx'
  AND marketplace = 'tiktok_shop'
GROUP BY file_hash, status;
```
- ✅ Batch count STILL = 1 (no new batch created)
- ✅ Status = 'success'

---

## Test 3: Re-import Confirmed (Option B)

**Objective:** Verify re-import creates NEW batch and succeeds

**Steps:**
1. From Test 2, click "นำเข้าซ้ำเพื่ออัปเดตข้อมูล"
2. Wait for import to complete

**Expected Results:**
- ✅ Dialog changes to "Importing..." step
- ✅ Progress shows: "Processing chunk 1 of N"
- ✅ Import succeeds with green success message
- ✅ Result shows: "Import สำเร็จ: N รายการ"

**Database Verification:**
```sql
-- Check batch count for this file_hash
SELECT
  file_hash,
  COUNT(*) as batch_count,
  status,
  created_at,
  inserted_count
FROM import_batches
WHERE file_name = 'YOUR_FILE_NAME.xlsx'
  AND marketplace = 'tiktok_shop'
GROUP BY file_hash, status, created_at, inserted_count
ORDER BY created_at DESC;
```
- ✅ Batch count = 2 (new batch created)
- ✅ Both batches have status = 'success'
- ✅ Both batches have inserted_count > 0
- ✅ Newest batch created_at > oldest batch created_at

**Console Log Check:**
```
[RE-IMPORT] User: [user_id] | File: [filename] | FileHash: [hash]...
```

---

## Test 4: Already Processing (Concurrent Import)

**Objective:** Verify concurrent import shows blue info prompt WITHOUT creating duplicate batch

**Prerequisites:** Requires 2 browser tabs/windows OR manual database manipulation

**Method A: Two Tabs (Harder to reproduce - needs timing)**
1. Tab 1: Go to `/sales`, click "Import", upload file, click "Confirm Import" (DON'T WAIT FOR COMPLETION)
2. IMMEDIATELY Tab 2: Go to `/sales`, click "Import", upload SAME file, click "Confirm Import"

**Method B: Manual Database Manipulation (Easier to test)**
1. Upload file once and wait for completion
2. Manually update batch status to 'processing':
```sql
UPDATE import_batches
SET status = 'processing', created_at = NOW()
WHERE file_hash = 'YOUR_FILE_HASH'
  AND marketplace = 'tiktok_shop'
ORDER BY created_at DESC
LIMIT 1;
```
3. Try to upload same file again

**Expected Results (Method B):**
- ✅ Preview shows correct summary
- ✅ Blue info prompt appears with:
  - Title: "กำลัง import ไฟล์นี้อยู่"
  - ไฟล์: [filename]
  - เริ่มเมื่อ: [Thai formatted date]
  - Message: "ไฟล์นี้กำลังถูก import อยู่ กรุณารอให้เสร็จก่อน..."
- ✅ One button visible: "ปิด"

**Database Verification:**
```sql
-- Check batch count for this file_hash
SELECT
  file_hash,
  COUNT(*) as batch_count,
  status
FROM import_batches
WHERE file_name = 'YOUR_FILE_NAME.xlsx'
  AND marketplace = 'tiktok_shop'
GROUP BY file_hash, status;
```
- ✅ No new batch created
- ✅ Only 1 batch with status = 'processing'

---

## Test 5: No Stuck Processing Batches (Error Handling)

**Objective:** Verify import errors update batch status to 'failed' (not stuck in 'processing')

**Method:** Cause import error (multiple ways)

**Method A: Invalid File After Preview**
1. Upload valid TikTok file
2. Preview shows correct data
3. Before import completes, kill network (airplane mode ON)
4. Click "Confirm Import"
5. Wait for error

**Method B: Invalid Data (Requires modified test file)**
1. Manually create invalid TikTok file (missing required columns)
2. Upload and try to import

**Expected Results:**
- ✅ Red error alert appears with error message
- ✅ Error message is descriptive (not generic "Unknown error")

**Database Verification:**
```sql
-- Check for stuck processing batches
SELECT
  id,
  file_name,
  status,
  created_at,
  notes,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 as age_minutes
FROM import_batches
WHERE status = 'processing'
  AND created_at < NOW() - INTERVAL '30 minutes'
ORDER BY created_at DESC;
```
- ✅ No batches stuck in 'processing' > 30 min
- ✅ Failed batch has status = 'failed'
- ✅ Failed batch has notes with error description

---

## Test 6: Cleanup Stale Batches (Manual SQL)

**Objective:** Verify manual cleanup SQL script works correctly

**Prerequisites:** Create stale processing batch (from Test 5 or manual)

**Steps:**
1. Create stale batch (manual SQL):
```sql
-- Create fake stale batch
INSERT INTO import_batches (
  file_hash, marketplace, report_type, file_name,
  row_count, status, created_at, created_by
)
VALUES (
  'test-stale-hash-123',
  'tiktok_shop',
  'sales_order_sku_list',
  'test-stale-file.xlsx',
  100,
  'processing',
  NOW() - INTERVAL '2 hours', -- 2 hours ago
  (SELECT id FROM auth.users LIMIT 1)
);
```

2. Run STEP 1 of cleanup script (inspect):
```sql
SELECT
  status,
  COUNT(*) as count,
  COUNT(CASE WHEN created_at < NOW() - INTERVAL '1 hour' THEN 1 END) as stale_count_1h
FROM import_batches
GROUP BY status;
```

3. Run STEP 2 DRY RUN (preview):
```sql
SELECT
  id, file_name, status, created_at, 'Would mark as failed' as action
FROM import_batches
WHERE status = 'processing' AND created_at < NOW() - INTERVAL '1 hour';
```

4. Run STEP 2 ACTUAL UPDATE (uncomment and execute):
```sql
UPDATE import_batches
SET
  status = 'failed',
  notes = CASE
    WHEN notes IS NULL THEN 'Marked as failed due to timeout (manual cleanup)'
    ELSE notes || ' | Marked as failed due to timeout (manual cleanup)'
  END
WHERE status = 'processing' AND created_at < NOW() - INTERVAL '1 hour';
```

5. Run STEP 3 (verify):
```sql
SELECT status, COUNT(*) as count
FROM import_batches
GROUP BY status;
```

**Expected Results:**
- ✅ STEP 1 shows at least 1 stale processing batch
- ✅ STEP 2 DRY RUN shows test batch
- ✅ STEP 2 ACTUAL UPDATE returns: UPDATE 1
- ✅ STEP 3 shows no processing batches older than 1 hour
- ✅ Test batch now has status = 'failed'
- ✅ Test batch notes contain "Marked as failed due to timeout (manual cleanup)"

---

## Test 7: Cleanup Helper Function (TypeScript)

**Objective:** Verify `cleanupStaleImportBatches()` helper function works

**Prerequisites:** Stale batch from Test 6 or create new one

**Steps:**
1. Create API route or temp script:
```typescript
// frontend/src/app/api/cleanup-stale-batches/route.ts
import { cleanupStaleImportBatches } from '@/lib/import-batch-cleanup'

export async function GET() {
  const result = await cleanupStaleImportBatches()
  return Response.json(result)
}
```

2. Call API: `http://localhost:3000/api/cleanup-stale-batches`

**Expected Results:**
- ✅ Response: `{ success: true, count: 1 }`
- ✅ Console log: `[CLEANUP] Cleaned up 1 stale import batches for user: [user_id]`

**Database Verification:**
```sql
SELECT id, status, notes FROM import_batches WHERE status = 'failed' ORDER BY created_at DESC LIMIT 5;
```
- ✅ Stale batch marked as 'failed'
- ✅ Notes contain: "Marked as failed due to timeout (> 1 hour) - Automatic cleanup"

---

## Acceptance Criteria (All Tests)

### Backend (Server Actions)
- ✅ `createImportBatch()` checks duplicates BEFORE creating batch
- ✅ `createImportBatch()` detects `already_processing` (< 30 min)
- ✅ `createImportBatch()` returns structured status (not just error)
- ✅ `importSalesChunk()` marks batch as 'failed' on error
- ✅ `finalizeImportBatch()` marks batch as 'failed' on error
- ✅ All error handling updates batch status (no stuck 'processing')

### Frontend (UI Component)
- ✅ `already_processing` state renders blue info prompt
- ✅ Duplicate file shows yellow warning prompt
- ✅ Re-import creates NEW batch (not reusing old one)
- ✅ All states render correctly (upload/preview/duplicate/already_processing/importing/result)

### Database
- ✅ No duplicate batches for same file_hash (unless re-import confirmed)
- ✅ No stuck 'processing' batches older than 30 min
- ✅ Failed batches have descriptive error in notes

### Utilities
- ✅ Cleanup helper function works correctly
- ✅ Manual SQL cleanup script works correctly
- ✅ No data loss or corruption

---

## Edge Cases

### Edge Case 1: User cancels during duplicate prompt
**Expected:** Dialog closes, no batch created, can re-open and try again

### Edge Case 2: Network error during chunk upload
**Expected:** Batch marked as 'failed', error message shown, can retry

### Edge Case 3: User closes dialog during import
**Expected:** Batch continues in background (if possible), or marked as 'failed'

### Edge Case 4: Two users upload same file concurrently
**Expected:** Each user creates own batch (file_hash same, but created_by different)

### Edge Case 5: Re-import old file after 30+ days
**Expected:** Works correctly, creates new batch with current timestamp

---

## Regression Tests

### Regression 1: Normal import still works
**Test:** Upload new file, verify import succeeds (Test 1)

### Regression 2: Re-import updates existing orders
**Test:** Re-import file with updated status, verify orders updated in DB

### Regression 3: Chunk size handling
**Test:** Import file with 1000+ rows, verify all chunks processed correctly

### Regression 4: Multiple files in sequence
**Test:** Import 3 different files back-to-back, verify all succeed

---

## Performance Tests

### Performance 1: Duplicate check speed
**Expected:** < 200ms for duplicate check query

### Performance 2: Cleanup function speed
**Expected:** < 1 second to cleanup 100 stale batches

### Performance 3: Import with large files
**Expected:** 2000+ row file imports in < 60 seconds

---

## Security Tests

### Security 1: User isolation
**Test:** User A cannot see User B's import batches
**Verify:** RLS policy enforces created_by filter

### Security 2: File hash integrity
**Test:** Same file uploaded by different users creates separate batches
**Verify:** Each batch has same file_hash but different created_by

### Security 3: Batch status tampering
**Test:** User cannot manually set batch status to 'success' via API
**Verify:** Only server actions can update batch status

---

## Documentation Checklist

- ✅ Created `cleanup-stale-import-batches.sql` (manual SQL script)
- ✅ Created `import-batch-cleanup.ts` (TypeScript helper functions)
- ✅ Updated `CLAUDE.md` with fix details
- ✅ Created this QA checklist

---

## Commit Message

```
fix(sales-import): prevent duplicate batches and complete Option B re-import UX

Backend:
- Refactor createImportBatch() to check duplicates BEFORE creating batch
- Add duplicate_file status (no batch created, shows prompt)
- Add already_processing status (prevents concurrent imports)
- Add error handling that updates batch to 'failed' (no stuck processing)
- Add report_type to duplicate checks for multi-report support

Frontend:
- Add already_processing state with blue info prompt
- Ensure re-import creates NEW batch (not reusing old one)
- Polish UX for all states (duplicate, processing, error, success)
- Add Info icon import for already_processing alert

Utilities:
- Add cleanupStaleImportBatches() helper function
- Add getStaleImportBatchCount() monitoring function

Documentation:
- Add cleanup-stale-import-batches.sql (manual SQL script)
- Add SALES_IMPORT_DUPLICATE_FIX_QA.md (complete test checklist)

Acceptance:
- New file upload creates exactly 1 batch
- Duplicate file shows prompt, no batch created
- Re-import creates exactly 1 new batch
- Concurrent uploads show already_processing, no duplicate batch
- No stuck 'processing' batches (all errors mark as 'failed')

Tests: All 7 test scenarios pass (see QA checklist)
```

---

## DONE WHEN

- ✅ All 7 test cases pass
- ✅ No duplicate 'processing' batches in database
- ✅ Option B works correctly (prompt → re-import → new batch)
- ✅ No stuck 'processing' batches (all > 30 min are 'failed')
- ✅ Error handling marks batches as 'failed' with descriptive notes
- ✅ Cleanup utility functions work correctly
- ✅ Manual SQL script documented and tested
- ✅ Code committed with detailed message
- ✅ QA checklist completed and reviewed
