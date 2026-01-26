# Sales Orders Re-import UX - Safety & Design Notes

**Created:** 2026-01-26
**Feature:** Smart duplicate file detection with re-import prompt
**Status:** ✅ Implemented

---

## Overview

When a user uploads a sales order file that has already been imported, the system now:
1. **Detects duplicate file** via SHA256 hash
2. **Shows smart prompt** with filename + timestamp
3. **Asks user to confirm** re-import (not auto-import)
4. **Updates existing rows** via idempotent upsert (no duplicates)

---

## Why This is Safe

### 1. Default Behavior Remains SAFE
- ✅ **New files:** Import normally (no prompt)
- ✅ **Duplicate files:** DO NOT auto-run import
- ✅ **User must confirm:** Explicit "Re-import" button click required

### 2. Idempotency Guaranteed
- **Upsert Key:** `(created_by, order_line_hash)`
- **Hash Formula:** `user_id|platform|order_id|product|qty|amount`
- **Behavior:**
  - If row exists → UPDATE
  - If row new → INSERT
  - **No duplicates possible**

### 3. Data Integrity
- **Conflict Resolution:** Uses PostgreSQL `ON CONFLICT` with full unique index
- **Transaction Safety:** Chunked import handles errors gracefully
- **Audit Trail:** `[RE-IMPORT]` log in server console

---

## Use Cases

### Use Case 1: Status Updates
**Scenario:** Orders initially marked "รอจัดส่ง" (pending) are now "จัดส่งแล้ว" (delivered).

**Steps:**
1. Export updated TikTok report
2. Import modified file
3. System detects duplicate → shows prompt
4. User clicks "Re-import"
5. System updates `platform_status`, `shipped_at`, `delivered_at` fields

**Result:** Existing rows updated, no duplicates.

---

### Use Case 2: Incremental Import
**Scenario:** New orders added to platform since last import.

**Steps:**
1. Export latest TikTok report (includes old + new orders)
2. Import file
3. System detects duplicate → shows prompt
4. User clicks "Re-import"
5. System:
   - Updates existing rows (if data changed)
   - Inserts new rows (new orders)

**Result:** Total row count increases by exactly the number of new orders.

---

### Use Case 3: Accidental Re-upload
**Scenario:** User accidentally uploads same file twice.

**Steps:**
1. Import file → Success
2. Upload same file again → Duplicate prompt appears
3. User realizes mistake → clicks "Cancel"

**Result:** No duplicate import, dialog resets to upload state.

---

## Technical Implementation

### Backend Changes
**File:** `frontend/src/app/(dashboard)/sales/sales-import-actions.ts`

**Function:** `createImportBatch()`

**Before:**
```typescript
export async function createImportBatch(
  fileHash: string,
  fileName: string,
  totalRows: number,
  dateRange: string
): Promise<{ success: boolean; batchId?: string; error?: string }>
```

**After:**
```typescript
export async function createImportBatch(
  fileHash: string,
  fileName: string,
  totalRows: number,
  dateRange: string,
  allowReimport?: boolean // NEW PARAMETER
): Promise<{
  success: boolean;
  batchId?: string;
  error?: string;
  status?: 'duplicate_file' | 'created'; // NEW FIELD
  fileName?: string; // NEW FIELD
  importedAt?: string; // NEW FIELD
}>
```

**Key Changes:**
1. Add `allowReimport` parameter (default: `false`)
2. Skip file hash check when `allowReimport=true`
3. Return structured response (not error) for duplicate detection
4. Add `[RE-IMPORT]` console logging

---

### Frontend Changes
**File:** `frontend/src/components/sales/SalesImportDialog.tsx`

**State Machine:**
- **Before:** `upload` → `preview` → `importing` → `result`
- **After:** `upload` → `preview` → `duplicate` (if needed) → `importing` → `result`

**New State:** `duplicate`
- Shows amber/yellow warning alert
- Displays filename + import timestamp
- Two buttons:
  - "ยกเลิก" (secondary) → resets to upload state
  - "นำเข้าซ้ำเพื่ออัปเดตข้อมูล" (primary) → calls import with `allowReimport=true`

**Key Changes:**
1. Add `duplicateInfo` state (stores filename + timestamp)
2. Modify `handleConfirmImport()` to accept `allowReimport` parameter
3. Handle `duplicate_file` response status
4. Add duplicate prompt UI

---

## Database Schema (Idempotency)

**Migration:** `migration-025-sales-order-line-hash-full-unique-index.sql`

**Unique Index:**
```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_orders_order_line_hash
ON public.sales_orders (created_by, order_line_hash)
WHERE order_line_hash IS NOT NULL;
```

**Upsert Logic:**
```typescript
await supabase
  .from('sales_orders')
  .upsert(salesRows, {
    onConflict: 'created_by,order_line_hash',
    ignoreDuplicates: false, // UPDATE existing rows
  })
```

**Why This Works:**
- `order_line_hash` is deterministic (same input = same hash)
- Unique index prevents duplicates at database level
- Upsert updates existing rows instead of failing

---

## Security & RLS

**RLS Policy:** `user_sales_orders_policy`

**Scope:** File hash check is scoped by user:
```sql
.eq('file_hash', fileHash)
.eq('marketplace', 'tiktok_shop')
.eq('status', 'success')
.gt('inserted_count', 0)
```

**Result:**
- User A can import file X
- User B can also import file X (different user_id)
- No cross-user interference

---

## Edge Cases Handled

### Edge 1: Cancelled Import
- **Scenario:** User starts import, then cancels mid-way
- **Behavior:** File hash check requires `status='success'` AND `inserted_count > 0`
- **Result:** Next import is allowed (not treated as duplicate)

### Edge 2: Failed Import
- **Scenario:** Import fails due to error
- **Behavior:** Batch status set to `'failed'`, `inserted_count=0`
- **Result:** Next import is allowed (not treated as duplicate)

### Edge 3: Multiple Users
- **Scenario:** User A and User B upload same file
- **Behavior:** File hash check scoped by `created_by` (RLS)
- **Result:** Both imports succeed independently

---

## Logging (Audit Trail)

**Format:**
```
[RE-IMPORT] User: <uuid> | File: <filename> | FileHash: <hash>
```

**Location:** Server console (stdout)

**When:** Triggered when `allowReimport=true` in `createImportBatch()`

**Purpose:**
- Audit trail for compliance
- Debug re-import issues
- Track user behavior

---

## QA Checklist

See `QA_SALES_REIMPORT_UX.md` for full test cases.

**Key Tests:**
1. ✅ New file imports without prompt
2. ✅ Duplicate file shows prompt
3. ✅ Cancel button resets dialog
4. ✅ Re-import updates existing rows (no duplicates)
5. ✅ Re-import is idempotent (multiple times safe)
6. ✅ Status updates reflected correctly
7. ✅ New rows inserted correctly (incremental import)
8. ✅ Console logging works

---

## Performance Considerations

**Chunked Import:** Import happens in chunks of 500 rows.

**Why:**
- Avoid timeouts on large files
- Better progress feedback
- Graceful error handling

**Impact on Re-import:**
- Same chunked logic applies
- No performance degradation
- Idempotent upsert per chunk

---

## Backwards Compatibility

**Breaking Changes:** None

**Compatibility:**
- ✅ `allowReimport` defaults to `false`
- ✅ Existing import flows unchanged
- ✅ API signature extended (not changed)
- ✅ Frontend gracefully handles old response format

---

## Future Enhancements

### Enhancement 1: Diff Preview
**Feature:** Show diff of what will change before re-import.

**Example:**
- 3 rows will be updated (status changed)
- 5 new rows will be inserted
- 50 rows unchanged

**Benefit:** More transparency, user confidence.

---

### Enhancement 2: Partial Re-import
**Feature:** Let user select which rows to update/insert.

**Example:**
- Checkbox per row in preview table
- Only import selected rows

**Benefit:** Granular control, avoid overwriting intentional changes.

---

### Enhancement 3: Change History
**Feature:** Audit log of all changes per row.

**Example:**
- Table: `sales_order_history`
- Track: before/after values, changed_by, changed_at
- UI: "View History" button per row

**Benefit:** Full audit trail, compliance, rollback capability.

---

## Conclusion

The re-import UX provides a **safe, user-friendly way to update existing sales data** without creating duplicates.

**Key Principles:**
1. **Safety First:** Default behavior blocks duplicates
2. **User Control:** Explicit confirmation required
3. **Idempotency:** No duplicates possible (guaranteed by database)
4. **Transparency:** Clear messaging + audit logging
5. **Backwards Compatible:** No breaking changes

**Status:** ✅ Production-ready

**Documentation:** This file + QA checklist + code comments

**Maintained By:** Backend team (server actions) + Frontend team (UI components)

---

**Last Updated:** 2026-01-26
**Reviewed By:** ORCH Agent
**Approved:** Yes
