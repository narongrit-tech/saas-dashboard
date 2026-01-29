# QA Checklist: Reset TikTok OrderSKUList Data

## Overview

This document provides a comprehensive QA checklist for testing the "Reset TikTok OrderSKUList" feature, which allows admins to delete all TikTok OrderSKUList data (sales_orders + import_batches) with production-safe guardrails.

**Feature Location:** `/sales` page → "Reset TikTok (OrderSKUList)" button

---

## Prerequisites

Before testing, ensure:

1. **Migration 031 is applied:**
   ```sql
   -- Run in DB console (Supabase SQL Editor)
   \i database-scripts/migration-031-reset-tiktok-ordersku-list.sql
   ```

2. **Test data exists:**
   - At least 1 TikTok OrderSKUList import batch in `import_batches`
   - At least 1 sales order with `metadata->>'source_report' = 'OrderSKUList'`

3. **Two test users:**
   - **Admin user:** Has `role = 'admin'` in `user_roles` table
   - **Non-admin user:** Either no entry in `user_roles` or `role = 'user'`

4. **Seed admin user (if needed):**
   ```sql
   -- Replace YOUR_USER_ID with your actual Supabase auth user ID
   INSERT INTO public.user_roles (user_id, role)
   VALUES ('YOUR_USER_ID', 'admin')
   ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
   ```

---

## Test Scenarios

### 1. UI Visibility Tests

#### Test 1.1: Admin sees Reset button
**Pre-condition:** Logged in as admin user

**Steps:**
1. Navigate to `/sales` page
2. Look for "Reset TikTok (OrderSKUList)" button in the toolbar (near Import button)

**Expected:**
- ✅ Reset button is visible (red-colored outline)
- ✅ Button has red text and red border
- ✅ Button shows RotateCcw icon + text

**Actual:** ____________________

---

#### Test 1.2: Non-admin does NOT see Reset button
**Pre-condition:** Logged in as non-admin user (or user without role entry)

**Steps:**
1. Navigate to `/sales` page
2. Look for "Reset TikTok (OrderSKUList)" button in the toolbar

**Expected:**
- ✅ Reset button is NOT visible
- ✅ Import button is still visible

**Actual:** ____________________

---

### 2. Dry-Run Preview Tests

#### Test 2.1: Preview loads counts correctly
**Pre-condition:** Logged in as admin user

**Steps:**
1. Click "Reset TikTok (OrderSKUList)" button
2. Wait for dialog to open and preview to load

**Expected:**
- ✅ Dialog opens with title "Reset TikTok OrderSKUList Data"
- ✅ Preview section shows "Sales Orders (Lines)" count (e.g., 1530)
- ✅ Preview section shows "Import Batches" count (e.g., 3)
- ✅ Counts match SQL query:
  ```sql
  -- Verify counts
  SELECT COUNT(*) FROM sales_orders WHERE metadata->>'source_report' = 'OrderSKUList';
  SELECT COUNT(*) FROM import_batches WHERE marketplace = 'tiktok_shop' AND report_type = 'sales_order_sku_list';
  ```

**Actual:** ____________________

---

#### Test 2.2: Preview shows zero if no data
**Pre-condition:** No TikTok OrderSKUList data in DB

**Steps:**
1. Delete all TikTok OrderSKUList data manually (or use previous reset)
2. Click "Reset TikTok (OrderSKUList)" button

**Expected:**
- ✅ Dialog opens
- ✅ Preview shows "Sales Orders (Lines): 0"
- ✅ Preview shows "Import Batches: 0"

**Actual:** ____________________

---

### 3. Authorization Tests

#### Test 3.1: Non-admin cannot execute reset (UI level)
**Pre-condition:** Logged in as non-admin user

**Steps:**
1. Try to navigate to `/sales` page
2. Confirm Reset button is not visible (from Test 1.2)

**Expected:**
- ✅ Reset button is not rendered (cannot even attempt to click)

**Actual:** ____________________

---

#### Test 3.2: Non-admin cannot execute reset (API level)
**Pre-condition:** Logged in as non-admin user with browser DevTools open

**Steps:**
1. Open browser console
2. Run this code to bypass UI:
   ```javascript
   // Attempt to call reset action directly
   fetch('/api/reset-tiktok', { method: 'POST', body: JSON.stringify({ dry_run: false }) })
   ```
   OR call the RPC function directly via Supabase client

**Expected:**
- ✅ Function returns error: "Unauthorized: Only admins can execute reset (non-dry-run)"
- ✅ No data is deleted
- ✅ Toast shows error: "ไม่มีสิทธิ์: เฉพาะ Admin เท่านั้นที่สามารถรีเซ็ตข้อมูลได้"

**Actual:** ____________________

---

### 4. Confirmation Validation Tests

#### Test 4.1: Cannot confirm without checkbox
**Pre-condition:** Logged in as admin, dialog open

**Steps:**
1. Open Reset dialog
2. Leave checkbox unchecked
3. Try to type confirmation text
4. Try to click "รีเซ็ตข้อมูล" button

**Expected:**
- ✅ Confirmation input is disabled (grayed out)
- ✅ "รีเซ็ตข้อมูล" button is disabled

**Actual:** ____________________

---

#### Test 4.2: Cannot confirm without exact phrase
**Pre-condition:** Logged in as admin, dialog open

**Steps:**
1. Open Reset dialog
2. Check "ฉันเข้าใจว่า..." checkbox
3. Type incorrect text in confirmation input (e.g., "reset tiktok" lowercase, "RESET TIKTOK " with space)
4. Try to click "รีเซ็ตข้อมูล" button

**Expected:**
- ✅ "รีเซ็ตข้อมูล" button remains disabled
- ✅ Only exact phrase `RESET TIKTOK` (no trailing spaces) enables button

**Actual:** ____________________

---

#### Test 4.3: Confirm enabled with valid inputs
**Pre-condition:** Logged in as admin, dialog open

**Steps:**
1. Open Reset dialog
2. Check "ฉันเข้าใจว่า..." checkbox
3. Type exact phrase `RESET TIKTOK` in confirmation input
4. Observe "รีเซ็ตข้อมูล" button state

**Expected:**
- ✅ "รีเซ็ตข้อมูล" button becomes enabled (clickable)
- ✅ Button has red background (destructive variant)

**Actual:** ____________________

---

### 5. Reset Execution Tests

#### Test 5.1: Successful reset execution
**Pre-condition:** Logged in as admin, TikTok OrderSKUList data exists

**Steps:**
1. Open Reset dialog
2. Note preview counts (e.g., 1530 lines, 3 batches)
3. Check checkbox
4. Type `RESET TIKTOK`
5. Click "รีเซ็ตข้อมูล" button
6. Wait for operation to complete

**Expected:**
- ✅ Button shows loading state ("กำลังรีเซ็ต..." with spinner)
- ✅ Dialog closes after ~2-5 seconds
- ✅ Success toast appears: "รีเซ็ตข้อมูลสำเร็จ" with deleted counts
- ✅ Sales page data refreshes automatically (Orders count updates to 0 or lower)
- ✅ Verify in DB:
  ```sql
  -- Should return 0 rows
  SELECT COUNT(*) FROM sales_orders WHERE metadata->>'source_report' = 'OrderSKUList';
  SELECT COUNT(*) FROM import_batches WHERE marketplace = 'tiktok_shop' AND report_type = 'sales_order_sku_list';
  ```
- ✅ Audit log entry created:
  ```sql
  SELECT * FROM admin_actions ORDER BY created_at DESC LIMIT 1;
  -- Should show action = 'reset_tiktok_ordersku_list' with details
  ```

**Actual:** ____________________

---

#### Test 5.2: Reset with zero data (idempotent)
**Pre-condition:** No TikTok OrderSKUList data (after previous reset)

**Steps:**
1. Open Reset dialog
2. Confirm preview shows 0 for both counts
3. Check checkbox
4. Type `RESET TIKTOK`
5. Click "รีเซ็ตข้อมูล" button

**Expected:**
- ✅ Operation completes successfully
- ✅ Success toast shows "ลบ 0 sales orders และ 0 import batches"
- ✅ No errors thrown
- ✅ Audit log entry created (even though nothing was deleted)

**Actual:** ____________________

---

### 6. Re-Import After Reset Tests

#### Test 6.1: Can re-import after reset
**Pre-condition:** TikTok OrderSKUList data has been reset

**Steps:**
1. On `/sales` page, click "Import" button
2. Upload a TikTok OrderSKUList CSV file
3. Complete import process

**Expected:**
- ✅ Import succeeds without errors
- ✅ Data appears in sales table
- ✅ New import batch created
- ✅ Deduplication works as expected (no duplicate line_hash warnings)

**Actual:** ____________________

---

#### Test 6.2: Re-importing same file after reset
**Pre-condition:** File A was imported, then reset, now re-importing File A

**Steps:**
1. Reset TikTok OrderSKUList data
2. Re-import the exact same CSV file that was previously imported

**Expected:**
- ✅ Import succeeds (not blocked by file_hash)
- ✅ All rows are inserted (dedup is line-level, not file-level)
- ✅ New import_batches entry created with same file_hash
- ✅ No errors or warnings about duplicate import

**Actual:** ____________________

---

### 7. Error Handling Tests

#### Test 7.1: Network error during preview
**Pre-condition:** Logged in as admin

**Steps:**
1. Open browser DevTools → Network tab
2. Set network throttling to "Offline"
3. Click "Reset TikTok (OrderSKUList)" button

**Expected:**
- ✅ Dialog opens
- ✅ Preview shows loading state
- ✅ Error toast appears: "ไม่สามารถโหลด preview ได้"
- ✅ Preview section shows error message
- ✅ "รีเซ็ตข้อมูล" button remains disabled

**Actual:** ____________________

---

#### Test 7.2: Network error during reset execution
**Pre-condition:** Logged in as admin, dialog open with valid confirmation

**Steps:**
1. Open Reset dialog
2. Complete checkbox and confirmation text
3. Set network throttling to "Offline"
4. Click "รีเซ็ตข้อมูล" button

**Expected:**
- ✅ Button shows loading state
- ✅ After timeout, error toast appears
- ✅ Dialog remains open (allows retry)

**Actual:** ____________________

---

### 8. UI/UX Tests

#### Test 8.1: Dialog cancellation
**Pre-condition:** Logged in as admin, dialog open

**Steps:**
1. Open Reset dialog
2. Check checkbox and type partial confirmation text
3. Click "ยกเลิก" button OR click X button OR press ESC key

**Expected:**
- ✅ Dialog closes immediately
- ✅ No data is deleted
- ✅ Sales page remains unchanged

**Actual:** ____________________

---

#### Test 8.2: Button disabled states
**Pre-condition:** Logged in as admin, dialog open

**Steps:**
1. Observe button states in each scenario:
   - No checkbox, no text
   - Checkbox only, no text
   - Checkbox + wrong text
   - Checkbox + correct text
   - During loading

**Expected:**
- ✅ "รีเซ็ตข้อมูล" button correctly disabled/enabled
- ✅ "ยกเลิก" button always enabled except during loading
- ✅ Loading state shows spinner icon

**Actual:** ____________________

---

### 9. Data Integrity Tests

#### Test 9.1: Only TikTok OrderSKUList data deleted
**Pre-condition:** DB has mixed data:
- TikTok OrderSKUList orders (metadata->>'source_report' = 'OrderSKUList')
- Manual orders (source = 'manual')
- Other imports (different source_report values)

**Steps:**
1. Count rows before reset:
   ```sql
   SELECT metadata->>'source_report', COUNT(*) FROM sales_orders GROUP BY 1;
   ```
2. Execute reset
3. Count rows after reset

**Expected:**
- ✅ Only rows with `metadata->>'source_report' = 'OrderSKUList'` are deleted
- ✅ Manual orders remain intact
- ✅ Other import types remain intact
- ✅ Total count decrease = preview count

**Actual:** ____________________

---

#### Test 9.2: Transactional integrity
**Pre-condition:** Large dataset (e.g., 10k+ rows)

**Steps:**
1. Execute reset
2. During execution, check DB for partial deletes:
   ```sql
   -- Run this immediately after clicking reset
   SELECT COUNT(*) FROM sales_orders WHERE metadata->>'source_report' = 'OrderSKUList';
   ```

**Expected:**
- ✅ Either all data is present OR all data is deleted (no partial state)
- ✅ If error occurs mid-transaction, all data is rolled back
- ✅ Both sales_orders and import_batches delete atomically

**Actual:** ____________________

---

### 10. Audit Log Tests

#### Test 10.1: Audit log entry created
**Pre-condition:** Admin executes successful reset

**Steps:**
1. Execute reset (dry_run=false)
2. Query audit log:
   ```sql
   SELECT * FROM admin_actions
   WHERE action = 'reset_tiktok_ordersku_list'
   ORDER BY created_at DESC
   LIMIT 1;
   ```

**Expected:**
- ✅ Entry exists with correct user_id (current admin)
- ✅ Action = 'reset_tiktok_ordersku_list'
- ✅ Details JSON contains:
  - `sales_orders_deleted`
  - `import_batches_deleted`
  - `sales_orders_before`
  - `import_batches_before`
  - `timestamp`
- ✅ created_at timestamp matches reset time

**Actual:** ____________________

---

#### Test 10.2: No audit log for dry-run
**Pre-condition:** Admin runs preview (dry_run=true)

**Steps:**
1. Open Reset dialog (triggers preview)
2. Cancel without executing
3. Query audit log (as above)

**Expected:**
- ✅ No new audit log entry created (dry-run doesn't log)

**Actual:** ____________________

---

## Performance Tests

### Test 11.1: Large dataset reset
**Dataset:** 50,000 sales_orders rows, 50 import_batches

**Steps:**
1. Execute reset
2. Measure time to completion

**Expected:**
- ✅ Completes within 30 seconds
- ✅ No timeouts or DB locks
- ✅ UI remains responsive (loading indicator shows)

**Actual:** ____________________

---

## Browser Compatibility Tests

### Test 12.1: Cross-browser support
**Browsers:** Chrome, Firefox, Safari, Edge

**Steps:**
1. Test reset flow in each browser

**Expected:**
- ✅ Dialog renders correctly
- ✅ Checkbox and input work
- ✅ Button states update correctly
- ✅ Toasts appear
- ✅ No console errors

**Actual:** ____________________

---

## Regression Tests

### Test 13.1: Import functionality still works
**Pre-condition:** After reset

**Steps:**
1. Click "Import" button
2. Upload TikTok OrderSKUList file
3. Complete import

**Expected:**
- ✅ Import works exactly as before reset feature
- ✅ No errors or degraded performance

**Actual:** ____________________

---

### Test 13.2: Sales page metrics update correctly
**Pre-condition:** After reset and re-import

**Steps:**
1. Observe Sales page summary metrics (Orders Gross, Lines, Revenue, etc.)
2. Verify against DB counts

**Expected:**
- ✅ All metrics match DB queries
- ✅ No stale cached data shown

**Actual:** ____________________

---

## Sign-Off

| Test Phase | Status | Tester | Date | Notes |
|------------|--------|--------|------|-------|
| UI Visibility | ☐ Pass ☐ Fail | _______ | ______ | _______ |
| Dry-Run Preview | ☐ Pass ☐ Fail | _______ | ______ | _______ |
| Authorization | ☐ Pass ☐ Fail | _______ | ______ | _______ |
| Confirmation Validation | ☐ Pass ☐ Fail | _______ | ______ | _______ |
| Reset Execution | ☐ Pass ☐ Fail | _______ | ______ | _______ |
| Re-Import After Reset | ☐ Pass ☐ Fail | _______ | ______ | _______ |
| Error Handling | ☐ Pass ☐ Fail | _______ | ______ | _______ |
| UI/UX | ☐ Pass ☐ Fail | _______ | ______ | _______ |
| Data Integrity | ☐ Pass ☐ Fail | _______ | ______ | _______ |
| Audit Log | ☐ Pass ☐ Fail | _______ | ______ | _______ |
| Performance | ☐ Pass ☐ Fail | _______ | ______ | _______ |
| Browser Compatibility | ☐ Pass ☐ Fail | _______ | ______ | _______ |
| Regression | ☐ Pass ☐ Fail | _______ | ______ | _______ |

---

## Known Issues / Limitations

1. **Migration Required:** Feature requires migration-031 to be applied first
2. **Single Platform:** Only resets TikTok OrderSKUList data (not Shopee, Lazada, etc.)
3. **No Undo:** Once executed, data is permanently deleted (no soft delete)
4. **Admin Setup:** Requires manual admin role assignment in DB (no UI for role management yet)

---

## Rollback Procedure

If issues are found in production:

1. **UI Rollback:**
   ```bash
   git revert <commit-hash>
   npm run build
   # Deploy frontend
   ```

2. **DB Rollback (if needed):**
   ```sql
   -- Drop function
   DROP FUNCTION IF EXISTS public.reset_tiktok_ordersku_list(boolean);

   -- Drop tables (if absolutely necessary, but keep for audit trail)
   -- DROP TABLE IF EXISTS public.admin_actions;
   -- DROP TABLE IF EXISTS public.user_roles;
   ```

3. **Restore Data (from backup):**
   ```sql
   -- If data was accidentally deleted, restore from daily backup
   -- Contact DevOps for backup restore procedure
   ```

---

## Contact

For questions or issues during QA:
- **Feature Owner:** [Your Name]
- **QA Lead:** [QA Team]
- **Documentation:** `docs/SALES_RESET_TIKTOK_QA.md`
- **Migration File:** `database-scripts/migration-031-reset-tiktok-ordersku-list.sql`

---

**Last Updated:** 2026-01-29
