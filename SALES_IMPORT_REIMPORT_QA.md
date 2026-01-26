# Sales Import - Duplicate File Re-import QA Checklist

## Objective
Test complete Option B (decision-based UX) for duplicate file re-import in Sales Import modal.

---

## Test Environment
- Branch: `main` (commit: ca110b7)
- Modified Files:
  - `frontend/src/app/(dashboard)/sales/sales-import-actions.ts`
  - `frontend/src/components/sales/SalesImportDialog.tsx`

---

## Test Scenarios

### Test 1: New File Import (Baseline)
**Purpose:** Verify normal import flow is unchanged

**Steps:**
1. Navigate to `/sales`
2. Click "Import" button
3. Upload a NEW TikTok Shop file (not imported before)
4. Verify preview appears
5. Click "Confirm Import"
6. Wait for import to complete

**Expected:**
- ✅ No duplicate prompt appears
- ✅ Import proceeds directly to "Importing" state
- ✅ Import succeeds
- ✅ Success message shows inserted count + revenue

**Status:** [ ] Pass / [ ] Fail

**Notes:**
_______________________________________________________

---

### Test 2: Duplicate File Detection
**Purpose:** Verify duplicate prompt appears with correct data

**Steps:**
1. Navigate to `/sales`
2. Click "Import" button
3. Upload the SAME file used in Test 1
4. Wait for preview step (file parses successfully)
5. Click "Confirm Import"

**Expected:**
- ✅ Dialog changes to "duplicate" state
- ✅ Yellow/amber alert visible (NOT red destructive)
- ✅ Alert shows:
  - Title: "ไฟล์นี้ถูก import ไปแล้ว"
  - Filename: (correct filename from first import)
  - Timestamp: Thai format (e.g., "25 ม.ค. 2026 14:30")
  - Explanation: About updating data or adding new orders
- ✅ Two buttons visible:
  - "ยกเลิก" (outline variant)
  - "นำเข้าซ้ำเพื่ออัปเดตข้อมูล" (primary variant)

**Status:** [ ] Pass / [ ] Fail

**Notes:**
_______________________________________________________

---

### Test 3: Cancel Action
**Purpose:** Verify cancel returns to initial state

**Steps:**
1. Continue from Test 2 (duplicate prompt visible)
2. Click "ยกเลิก" button

**Expected:**
- ✅ Dialog returns to "upload" state
- ✅ No file selected (file input is empty)
- ✅ No error shown
- ✅ No import happens (database unchanged)

**Status:** [ ] Pass / [ ] Fail

**Notes:**
_______________________________________________________

---

### Test 4: Re-import Action
**Purpose:** Verify re-import proceeds and succeeds

**Steps:**
1. Navigate to `/sales`
2. Click "Import" button
3. Upload the SAME file again (trigger duplicate prompt)
4. Click "Confirm Import" to reach duplicate prompt
5. Click "นำเข้าซ้ำเพื่ออัปเดตข้อมูล" button
6. Wait for import to complete

**Expected:**
- ✅ Dialog changes to "importing" state
- ✅ Progress shows (chunk X of Y)
- ✅ Import completes successfully
- ✅ Success message appears
- ✅ No duplicate rows created (upsert works correctly)
- ✅ If file has updated status/dates → database reflects updates
- ✅ Console shows: `[RE-IMPORT] User: ... | File: ... | FileHash: ...`

**Status:** [ ] Pass / [ ] Fail

**Notes:**
_______________________________________________________

---

### Test 5: No Server Action Errors
**Purpose:** Verify no payload serialization errors

**Steps:**
1. Complete Test 4 (re-import)
2. Open browser DevTools → Console
3. Check for errors

**Expected:**
- ✅ No "Only plain objects can be passed to Server Actions" error
- ✅ No "must be serializable" error
- ✅ No payload-related errors
- ✅ Only standard logs visible

**Status:** [ ] Pass / [ ] Fail

**Notes:**
_______________________________________________________

---

## Edge Case Tests

### Edge Case 1: Close Dialog During Duplicate Prompt
**Steps:**
1. Trigger duplicate prompt
2. Click outside dialog (or press ESC) to close

**Expected:**
- ✅ Dialog closes cleanly
- ✅ State resets (duplicate info cleared)
- ✅ No lingering data

**Status:** [ ] Pass / [ ] Fail

---

### Edge Case 2: Multiple Re-imports
**Steps:**
1. Import file A (new)
2. Re-import file A (duplicate prompt → re-import)
3. Re-import file A again (duplicate prompt → re-import)

**Expected:**
- ✅ Each re-import shows prompt
- ✅ Each re-import succeeds
- ✅ No database corruption
- ✅ import_batches table has multiple entries (not deduplicated)

**Status:** [ ] Pass / [ ] Fail

---

### Edge Case 3: Timestamp Formatting (importedAt = null)
**Steps:**
1. Manually clear `created_at` in import_batches (or simulate null timestamp)
2. Trigger duplicate prompt

**Expected:**
- ✅ Shows "Unknown" instead of crashing
- ✅ Dialog still functional

**Status:** [ ] Pass / [ ] Fail

---

### Edge Case 4: Dark Mode Support
**Steps:**
1. Trigger duplicate prompt
2. Toggle dark mode (if supported)

**Expected:**
- ✅ Alert colors adapt (amber-50 → amber-950)
- ✅ Text remains readable
- ✅ Icons remain visible

**Status:** [ ] Pass / [ ] Fail

---

## Performance Tests

### Performance 1: Re-import Speed
**Steps:**
1. Re-import a large file (500+ rows)
2. Measure total time

**Expected:**
- ✅ Re-import takes similar time as new import
- ✅ No significant slowdown from duplicate check
- ✅ Upsert performs well (< 5 seconds for 500 rows)

**Status:** [ ] Pass / [ ] Fail

**Notes:**
_______________________________________________________

---

## Regression Tests

### Regression 1: Legacy Import (importSalesToSystem)
**Purpose:** Verify deprecated function still works

**Steps:**
1. Check if any code still calls `importSalesToSystem()`
2. If yes, test that code path

**Expected:**
- ✅ Legacy path unchanged (no breaking changes)
- ✅ Still blocks duplicates with error message

**Status:** [ ] Pass / [ ] Fail

---

### Regression 2: Manual Mapping Wizard
**Purpose:** Verify manual mapping still works after changes

**Steps:**
1. Upload non-TikTok file (triggers "Try Manual Mapping")
2. Complete manual mapping wizard
3. Confirm import

**Expected:**
- ✅ Wizard flow unchanged
- ✅ Import succeeds
- ✅ No duplicate prompt issues (if applicable)

**Status:** [ ] Pass / [ ] Fail

---

## Final Acceptance Criteria

- [ ] **New File Import:** No duplicate prompt, proceeds normally
- [ ] **Duplicate File Detection:** Yellow warning prompt with 2 buttons
- [ ] **Cancel Action:** Returns to initial state, no import
- [ ] **Re-import Action:** Import proceeds and succeeds, no duplicate rows
- [ ] **No Server Action Errors:** Console clean, no payload errors

---

## Test Results Summary

**Date Tested:** _________________

**Tested By:** _________________

**Overall Status:** [ ] All Pass / [ ] Some Fail

**Critical Issues Found:**
_______________________________________________________
_______________________________________________________

**Non-Critical Issues:**
_______________________________________________________
_______________________________________________________

**Ready for Production:** [ ] Yes / [ ] No

---

## Additional Notes

_______________________________________________________
_______________________________________________________
_______________________________________________________
