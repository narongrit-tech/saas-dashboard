# Manual Verification Checklist - Sales & Expenses CRUD

**Date:** 2026-01-23
**Feature:** Full CRUD (Edit + Delete) for Sales Orders and Expenses
**Build Status:** ✅ PASSED (with pre-existing warnings only)

---

## Build & Lint Status

### ✅ Build Results
- **TypeScript compilation:** PASSED
- **Lint errors:** 0 (all fixed)
- **Build output:** Production build successful
- **Bundle size:** Within normal range

### ⚠️ Remaining Warnings (Pre-existing, Unrelated)
The following warnings exist in the codebase but are NOT introduced by this CRUD implementation:
- `useEffect` exhaustive-deps warnings in:
  - `ads/page.tsx:58`
  - `cashflow/page.tsx:112`
  - `daily-pl/page.tsx:44`
  - `expenses/page.tsx:56` (pre-existing)
  - `sales/page.tsx:57` (pre-existing)
- Dynamic server usage warning for cookies (expected behavior for authenticated routes)

These warnings were present before CRUD implementation and do not affect functionality.

---

## A. Sales Orders - Edit Functionality

### Test Cases (Minimum 5)

#### 1. ✅ Edit Success - Normal Update
- **Steps:**
  1. Navigate to Sales page
  2. Click Edit (pencil icon) on any order
  3. Change product name, quantity, or price
  4. Click "บันทึก" (Save)
- **Expected:**
  - Dialog closes
  - Order updates in table
  - Total amount recalculated correctly
  - No errors shown
- **Status:** Pending manual test

#### 2. ✅ Edit Success - Change Status to Cancelled
- **Steps:**
  1. Edit an order with status "completed" or "pending"
  2. Change status to "cancelled"
  3. Save
- **Expected:**
  - Total amount becomes 0 (business rule)
  - Status badge changes to red "Cancelled"
  - Order still visible in list
- **Status:** Pending manual test

#### 3. ❌ Edit Failure - Empty Product Name
- **Steps:**
  1. Edit an order
  2. Clear product name field
  3. Attempt to save
- **Expected:**
  - Red error message: "กรุณากรอกชื่อสินค้า"
  - Dialog stays open
  - No database update
- **Status:** Pending manual test

#### 4. ❌ Edit Failure - Invalid Quantity (Zero or Negative)
- **Steps:**
  1. Edit an order
  2. Set quantity to 0 or negative number
  3. Attempt to save
- **Expected:**
  - Red error message: "จำนวนต้องมากกว่า 0"
  - Dialog stays open
- **Status:** Pending manual test

#### 5. ❌ Edit Failure - RLS Violation (Wrong User)
- **Steps:**
  1. Login as User A
  2. Create an order
  3. Logout and login as User B
  4. Attempt to edit User A's order
- **Expected:**
  - Error: "คุณไม่มีสิทธิ์แก้ไข order นี้"
  - OR order not visible to User B (RLS filters)
- **Status:** Pending manual test

#### 6. ✅ Edit UI - Form Pre-populated Correctly
- **Steps:**
  1. Click Edit on an existing order
  2. Verify all fields show current values
- **Expected:**
  - Order date, marketplace, product name, quantity, unit price, status all match current order
  - Total preview calculates correctly
- **Status:** Pending manual test

#### 7. ✅ Edit Cancel - No Changes Applied
- **Steps:**
  1. Edit an order
  2. Change some fields
  3. Click "ยกเลิก" (Cancel)
- **Expected:**
  - Dialog closes
  - No changes saved to database
  - Table shows original values
- **Status:** Pending manual test

---

## B. Sales Orders - Delete Functionality

### Test Cases (Minimum 5)

#### 8. ✅ Delete Success - With Confirmation
- **Steps:**
  1. Click Delete (trash icon) on any order
  2. Confirmation dialog appears
  3. Click "ลบ" (Delete)
- **Expected:**
  - Order removed from table
  - Total count decrements
  - No errors
- **Status:** Pending manual test

#### 9. ✅ Delete Cancel - No Changes
- **Steps:**
  1. Click Delete on an order
  2. Click "ยกเลิก" (Cancel) in confirmation dialog
- **Expected:**
  - Dialog closes
  - Order still visible in table
  - No database changes
- **Status:** Pending manual test

#### 10. ❌ Delete Failure - RLS Violation
- **Steps:**
  1. Login as User A, create order
  2. Logout, login as User B
  3. Attempt to delete User A's order
- **Expected:**
  - Error: "คุณไม่มีสิทธิ์ลบ order นี้"
  - OR order not visible to User B
- **Status:** Pending manual test

#### 11. ✅ Delete Impact - Daily P&L Reflects Change
- **Steps:**
  1. Note current Daily P&L revenue
  2. Delete a completed order (e.g., 1000 THB)
  3. Check Daily P&L page
- **Expected:**
  - Revenue decreases by deleted order amount
  - Net profit recalculates correctly
- **Status:** Pending manual test

#### 12. ✅ Delete Impact - Pagination Stability
- **Steps:**
  1. Navigate to page 2 of Sales Orders
  2. Delete last order on page 2
  3. Observe pagination
- **Expected:**
  - Pagination adjusts correctly
  - No blank pages or errors
  - User redirected to valid page if needed
- **Status:** Pending manual test

---

## C. Expenses - Edit Functionality

### Test Cases (Minimum 5)

#### 13. ✅ Edit Success - Normal Update
- **Steps:**
  1. Navigate to Expenses page
  2. Click Edit on any expense
  3. Change amount or category
  4. Save
- **Expected:**
  - Expense updates in table
  - Category badge changes if category changed
  - Amount displays correctly with 2 decimals
- **Status:** Pending manual test

#### 14. ✅ Edit Success - Change Category
- **Steps:**
  1. Edit an expense with category "Advertising"
  2. Change to "COGS"
  3. Save
- **Expected:**
  - Badge color changes (purple → orange)
  - Label changes to "ต้นทุนขาย"
  - Daily P&L reflects category change
- **Status:** Pending manual test

#### 15. ❌ Edit Failure - Invalid Amount (Zero or Negative)
- **Steps:**
  1. Edit an expense
  2. Set amount to 0 or negative
  3. Attempt to save
- **Expected:**
  - Error: "จำนวนเงินต้องมากกว่า 0"
  - No database update
- **Status:** Pending manual test

#### 16. ❌ Edit Failure - Missing Date
- **Steps:**
  1. Edit an expense
  2. Clear expense date
  3. Attempt to save
- **Expected:**
  - Error: "กรุณาระบุวันที่"
  - Dialog stays open
- **Status:** Pending manual test

#### 17. ❌ Edit Failure - RLS Violation
- **Steps:**
  1. Login as User A, create expense
  2. Logout, login as User B
  3. Attempt to edit User A's expense
- **Expected:**
  - Error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้"
  - OR expense not visible
- **Status:** Pending manual test

---

## D. Expenses - Delete Functionality

### Test Cases (Minimum 5)

#### 18. ✅ Delete Success - With Confirmation
- **Steps:**
  1. Click Delete on any expense
  2. Confirm deletion
- **Expected:**
  - Expense removed from table
  - Total count updates
  - No errors
- **Status:** Pending manual test

#### 19. ✅ Delete Cancel - No Changes
- **Steps:**
  1. Click Delete
  2. Click Cancel in confirmation
- **Expected:**
  - Dialog closes
  - Expense still in table
- **Status:** Pending manual test

#### 20. ❌ Delete Failure - RLS Violation
- **Steps:**
  1. Login as User A, create expense
  2. Logout, login as User B
  3. Attempt to delete
- **Expected:**
  - Error or expense not visible
- **Status:** Pending manual test

#### 21. ✅ Delete Impact - Daily P&L Updates
- **Steps:**
  1. Note Daily P&L expenses (e.g., Advertising = 5000)
  2. Delete an Advertising expense (1000 THB)
  3. Check Daily P&L
- **Expected:**
  - Advertising expense decreases by 1000
  - Net profit increases by 1000
- **Status:** Pending manual test

#### 22. ✅ Delete Impact - Filter Stability
- **Steps:**
  1. Filter expenses by "Advertising"
  2. Delete an Advertising expense
  3. Verify filter still applied
- **Expected:**
  - Remaining Advertising expenses still shown
  - Other categories not visible
  - Search/filter state preserved
- **Status:** Pending manual test

---

## E. Integration & Stability

### Test Cases (Minimum 5)

#### 23. ✅ Filters Remain Active After Edit
- **Steps:**
  1. Filter Sales by "TikTok" marketplace
  2. Edit a TikTok order
  3. Save
- **Expected:**
  - Filter still shows "TikTok" only
  - Updated order visible
  - Page doesn't reset to "All"
- **Status:** Pending manual test

#### 24. ✅ Search Remains Active After Delete
- **Steps:**
  1. Search Sales for "Product A"
  2. Delete one search result
  3. Verify
- **Expected:**
  - Search box still contains "Product A"
  - Remaining matches still shown
  - Search not cleared
- **Status:** Pending manual test

#### 25. ✅ Pagination Stability After Edit
- **Steps:**
  1. Navigate to page 3
  2. Edit an order on page 3
  3. Save
- **Expected:**
  - User stays on page 3
  - Edited order visible on same page
  - Page number doesn't reset to 1
- **Status:** Pending manual test

#### 26. ✅ Concurrent Edits (If Multi-User)
- **Steps:**
  1. User A opens Edit dialog for Order X
  2. User B edits same Order X and saves
  3. User A attempts to save
- **Expected:**
  - User A's changes overwrite (last-write-wins)
  - OR conflict error shown (if implemented)
  - No data corruption
- **Status:** Pending manual test (requires 2 users)

#### 27. ✅ Add → Edit → Delete Flow
- **Steps:**
  1. Add new order
  2. Immediately edit it
  3. Immediately delete it
- **Expected:**
  - All operations succeed
  - No orphaned data
  - Counts accurate
- **Status:** Pending manual test

---

## F. Business Logic Validation

### Test Cases (Minimum 3)

#### 28. ✅ Cancelled Order Total = 0 (Edit)
- **Steps:**
  1. Create order: Qty=5, Price=100, Total=500
  2. Edit: Change status to "cancelled"
  3. Save
- **Expected:**
  - Server recalculates total_amount = 0
  - Display shows ฿0.00
  - Daily P&L excludes this order from revenue
- **Status:** Pending manual test

#### 29. ✅ Total Amount Server-Side Calculation (Edit)
- **Steps:**
  1. Edit order: Set Qty=3, Price=99.99
  2. Save (do NOT rely on client calculation)
- **Expected:**
  - Server calculates: 3 × 99.99 = 299.97
  - Rounded to 2 decimals
  - Database stores 299.97
- **Status:** Pending manual test

#### 30. ✅ Category Validation (Expenses Edit)
- **Steps:**
  1. Edit expense
  2. Attempt to set invalid category (e.g., via API manipulation)
- **Expected:**
  - Server rejects: "หมวดหมู่รายจ่ายไม่ถูกต้อง"
  - Only Advertising/COGS/Operating allowed
- **Status:** Pending manual test (requires API tool)

---

## G. Edge Cases & Error Handling

### Test Cases (Minimum 3)

#### 31. ✅ Edit Non-Existent Order
- **Steps:**
  1. Note an order ID
  2. Delete it via another session
  3. Attempt to edit it
- **Expected:**
  - Error: "ไม่พบรายการ order ที่ต้องการแก้ไข"
  - Or 404 error
- **Status:** Pending manual test

#### 32. ✅ Network Error During Save
- **Steps:**
  1. Edit order
  2. Disconnect network before clicking Save
  3. Click Save
- **Expected:**
  - Error message shown
  - Dialog stays open
  - User can retry
- **Status:** Pending manual test

#### 33. ✅ Large Amount Values (Precision)
- **Steps:**
  1. Edit order: Price = 123456.789
  2. Save
- **Expected:**
  - Rounded to 123456.79 (2 decimals)
  - No overflow errors
  - Displays correctly in table
- **Status:** Pending manual test

---

## Summary

**Total Test Cases:** 33
**Passing:** 0 (pending manual execution)
**Failing:** 0
**Blocked:** 0

### Critical Tests (Must Pass Before Release)
- [ ] #1: Edit Success - Normal Update (Sales)
- [ ] #8: Delete Success - With Confirmation (Sales)
- [ ] #13: Edit Success - Normal Update (Expenses)
- [ ] #18: Delete Success - With Confirmation (Expenses)
- [ ] #28: Cancelled Order Total = 0
- [ ] #29: Total Amount Server-Side Calculation
- [ ] #11: Delete Impact - Daily P&L Reflects Change
- [ ] #21: Delete Impact - Daily P&L Updates (Expenses)

### Files Changed
**New Files:**
- `frontend/src/components/sales/EditOrderDialog.tsx`
- `frontend/src/components/expenses/EditExpenseDialog.tsx`
- `frontend/src/components/shared/DeleteConfirmDialog.tsx`

**Modified Files:**
- `frontend/src/app/(dashboard)/sales/actions.ts` (added updateOrder, deleteOrder)
- `frontend/src/app/(dashboard)/expenses/actions.ts` (added updateExpense, deleteExpense)
- `frontend/src/app/(dashboard)/sales/page.tsx` (added Edit/Delete buttons + handlers)
- `frontend/src/app/(dashboard)/expenses/page.tsx` (added Edit/Delete buttons + handlers)
- `frontend/src/types/sales.ts` (added UpdateOrderInput)
- `frontend/src/types/expenses.ts` (added UpdateExpenseInput)

**Lint Fixes (Unrelated Pre-existing Issues):**
- `frontend/src/hooks/use-toast.ts`
- `frontend/src/lib/mock-data.ts`
- `frontend/src/middleware.ts`
- `frontend/src/lib/importers/tiktok-ads-daily.ts`
- `frontend/src/lib/importers/tiktok-onhold.ts`

---

## Notes

1. **RLS Testing:** Requires multiple user accounts to test ownership validation
2. **Daily P&L Integration:** Edit/Delete operations should immediately reflect in Daily P&L calculations (test by refreshing /daily-pl page)
3. **Soft Delete:** Not implemented - using hard delete as schema has no `deleted_at` column
4. **Audit Trail:** `created_by` field prevents unauthorized edits (server-side check + RLS)
5. **No Migrations Required:** All changes are code-only, no database schema changes

---

**Build Command Used:**
```bash
cd frontend && npm run build
```

**Result:** ✅ Build successful with 0 errors
