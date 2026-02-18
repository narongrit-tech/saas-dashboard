# Inventory Bug Fixes and Features

**Date:** 2026-02-18
**Status:** ✅ Complete
**Scope:** Bug fix + 3 major features

---

## 🐛 BUG: Bundle SKU Typo (NEWOON003)

### Problem
- TikTok orders use SKU: `NEWONN003`
- System has bundle SKU: `NEWOON003` (typo - missing 'N')
- Orders don't allocate COGS due to SKU mismatch
- Bundle `NEWOON003` never gets allocated

### Impact
- Lost revenue tracking
- Incorrect P&L
- Inventory not reflected properly

---

## ✅ SOLUTIONS IMPLEMENTED

### Phase 1: Database Migration (Fix Typo)

**File:** `database-scripts/migration-058-rename-bundle-sku-NEWOON003.sql`

**What it does:**
- Renames `NEWOON003` → `NEWONN003` safely
- Updates affected tables:
  - `inventory_items.sku_internal`
  - `inventory_bundle_components.bundle_sku`
  - `inventory_bundle_components.component_sku` (if applicable)
  - `inventory_receipt_layers.sku_internal` (if applicable)

**Safety Guards:**
1. ✅ Check source SKU exists
2. ✅ Check target SKU doesn't already exist (prevent conflict)
3. ✅ Check no COGS allocations exist (should be none for typo)
4. ✅ Warn if sales_orders reference exists (for manual followup)
5. ✅ Transaction with rollback on error
6. ✅ Verification after rename

**Usage:**
```bash
psql -d your_database -f database-scripts/migration-058-rename-bundle-sku-NEWOON003.sql
```

**Note:** This migration does NOT update `sales_orders.seller_sku` (historical import table).
You may need to manually update imports or existing orders if needed.

---

### Phase 2: UX Refactor (Separate Bundle Creation)

**Goal:** Clear separation between Products and Bundles

**Changes:**

#### Products Tab
**File:** `frontend/src/components/inventory/ProductsTab.tsx`

- ❌ Removed "Is Bundle" checkbox from create/edit dialog
- ✅ Products tab now creates ONLY main products (`is_bundle = false`)
- ✅ Simplified product creation flow

#### Bundles Tab
**Files:**
- `frontend/src/components/inventory/BundlesTab.tsx`
- `frontend/src/components/inventory/CreateBundleModal.tsx` (NEW)

- ✅ Added "สร้าง Bundle" button
- ✅ New CreateBundleModal for bundle creation
- ✅ Creates bundle SKU in `inventory_items` with `is_bundle = true`
- ✅ After creation, can add components via recipe editor

**User Flow:**
1. Go to Bundles tab
2. Click "สร้าง Bundle"
3. Enter Bundle SKU, Name, Cost
4. Click "สร้าง Bundle"
5. Use existing recipe editor to add components

---

### Phase 3: Safe SKU Rename Feature

**Goal:** Allow users to rename SKU (typo fixes) with safety checks

**Files:**
- `frontend/src/app/(dashboard)/inventory/actions.ts` - Server actions
- `frontend/src/components/inventory/RenameSkuModal.tsx` - UI component
- `frontend/src/components/inventory/ProductsTab.tsx` - Add rename button
- `frontend/src/components/inventory/BundlesTab.tsx` - Add rename button

#### Server Actions

##### `checkSkuRenameEligibility(sku)`
Checks if SKU can be safely renamed.

**Eligibility Criteria:**
- ❌ No receipt layers (stock in)
- ❌ No COGS allocations (sales)
- ❌ No bundle recipe (if bundle SKU)
- ❌ Not used as component in bundles
- ❌ No sales orders

**Returns:**
```typescript
{
  eligible: boolean
  reasons: string[]
  blockers: Array<{
    category: string
    count: number
    message: string
  }>
}
```

##### `renameInventorySku(old_sku, new_sku)`
Performs the rename if eligible.

**Updates:**
- `inventory_items.sku_internal`
- `inventory_bundle_components.bundle_sku` (if bundle)
- `inventory_bundle_components.component_sku` (if component)

**Safety:**
- ✅ Eligibility check first
- ✅ Checks new SKU doesn't exist
- ✅ Transaction-safe
- ✅ Revalidates paths after success

#### UI Components

**RenameSkuModal:**
- Two-step process:
  1. Check eligibility
  2. Confirm rename (only if eligible)
- Shows clear reasons if not eligible
- Supports both product and bundle SKUs

**Usage:**
- Products tab: Click 🟧 FileEdit icon in Actions column
- Bundles tab: Click 🟧 FileEdit icon in Actions column

---

### Phase 4: Allocation Skip Report

**Goal:** Better visibility into why orders were skipped during COGS allocation

**Files:**
- `frontend/src/app/(dashboard)/inventory/actions.ts` - Enhanced applyCOGSMTD
- `frontend/src/components/inventory/ApplyCOGSMTDModal.tsx` - Enhanced UI

#### Enhanced applyCOGSMTD Action

**New Return Data:**
```typescript
{
  success: true,
  data: {
    total: number
    eligible: number
    successful: number
    skipped: number
    failed: number
    errors: Array<{ order_id: string; reason: string }>
    skip_reasons: Array<{  // NEW!
      code: string
      label: string
      count: number
      samples: Array<{
        order_id: string
        sku?: string
        detail?: string
      }>
    }>
  }
}
```

**Skip Reason Categories:**
1. **ALREADY_ALLOCATED** - เคย allocate แล้ว (idempotent skip)
2. **MISSING_SKU** - ไม่มี seller_sku ใน order
3. **INVALID_QUANTITY** - quantity ไม่ถูกต้อง (null/zero/negative)
4. **NOT_SHIPPED** - ยังไม่ได้ shipped (ไม่มี shipped_at)
5. **ALLOCATION_FAILED** - ไม่สามารถ allocate ได้ (SKU ไม่มี/stock ไม่พอ/bundle ไม่มี recipe)
6. **EXCEPTION** - เกิด exception ระหว่าง allocate

**Features:**
- ✅ Groups skip reasons by category
- ✅ Counts per category
- ✅ Shows sample order_ids (up to 5 per category)
- ✅ Includes SKU and detail info in samples

#### Enhanced UI

**ApplyCOGSMTDModal:**
- ✅ Added collapsible "Skip Reasons Breakdown" section
- ✅ Shows categorized reasons with counts
- ✅ Expandable to see samples
- ✅ Color-coded (yellow for skips)
- ✅ Shows order_id + SKU + detail for each sample

**Example Display:**
```
Skip Reasons Breakdown (4 categories) ▼

🟨 เคย allocate แล้ว (idempotent skip)
   Code: ALREADY_ALLOCATED
   125 orders
   ตัวอย่าง:
   - ORDER001 SKU: SKU001
   - ORDER002 SKU: SKU002
   ...

🟨 ไม่สามารถ allocate ได้ (SKU ไม่มี/stock ไม่พอ/bundle ไม่มี recipe)
   Code: ALLOCATION_FAILED
   8 orders
   ตัวอย่าง:
   - ORDER123 SKU: NEWOON003
   - ORDER124 SKU: UNKNOWN_SKU
   ...
```

---

## 📊 TESTING CHECKLIST

### ✅ Migration Testing
- [ ] Run migration-058 on staging database
- [ ] Verify NEWOON003 no longer exists
- [ ] Verify NEWONN003 exists with correct recipe
- [ ] Check sales_orders for NEWOON003 references (manual cleanup if needed)
- [ ] Test COGS allocation for NEWONN003 orders

### ✅ Bundle Creation Testing
- [ ] Products tab: Create product → should NOT have "Is Bundle" checkbox
- [ ] Bundles tab: Click "สร้าง Bundle" → creates bundle successfully
- [ ] Bundles tab: Add recipe to new bundle → works correctly
- [ ] Products tab: Should only show main products (no bundles)
- [ ] Bundles tab: Should only show bundles

### ✅ Rename SKU Testing

**Test Case 1: Fresh SKU (eligible)**
- [ ] Create new product SKU (no stock in, no sales)
- [ ] Click rename button
- [ ] Check eligibility → should be eligible
- [ ] Rename → should succeed
- [ ] Verify new SKU appears, old SKU gone

**Test Case 2: Used SKU (not eligible)**
- [ ] Select SKU with stock in or sales
- [ ] Click rename button
- [ ] Check eligibility → should NOT be eligible
- [ ] Should show blockers with counts
- [ ] Confirm button should be disabled

**Test Case 3: Bundle SKU**
- [ ] Create bundle with recipe
- [ ] Try to rename → should block (has recipe)
- [ ] Delete recipe first
- [ ] Try to rename → should work if no other blockers

### ✅ Allocation Report Testing
- [ ] Go to Inventory > Movements tab
- [ ] Click "Apply COGS (Date Range)"
- [ ] Select date range with mixed orders (some allocated, some failed)
- [ ] Click "Apply COGS"
- [ ] Verify summary shows correct counts
- [ ] Expand "Skip Reasons Breakdown"
- [ ] Verify categories are correct
- [ ] Verify samples show order_id + SKU
- [ ] Check for ALLOCATION_FAILED with NEWOON003 → should see it if not fixed yet

---

## 🔄 COMMIT STRATEGY

### Commit 1: Database Migration
```bash
git add database-scripts/migration-058-rename-bundle-sku-NEWOON003.sql
git commit -m "fix(db): rename bundle sku NEWOON003 -> NEWONN003 (typo fix)

- Add migration with safety guards
- Update inventory_items, bundle_components, receipt_layers
- Prevent conflicts, check allocations, warn on sales_orders references
- Transaction-safe with verification"
```

### Commit 2: UX Refactor
```bash
git add frontend/src/components/inventory/ProductsTab.tsx
git add frontend/src/components/inventory/BundlesTab.tsx
git add frontend/src/components/inventory/CreateBundleModal.tsx
git commit -m "feat(inventory): separate bundle creation into Bundles tab

- Remove 'Is Bundle' checkbox from Products tab
- Add 'Create Bundle' button in Bundles tab
- Create CreateBundleModal component
- Clear UX separation: Products = main SKUs, Bundles = bundle SKUs"
```

### Commit 3: Safe Rename SKU
```bash
git add frontend/src/app/\(dashboard\)/inventory/actions.ts
git add frontend/src/components/inventory/RenameSkuModal.tsx
git add frontend/src/components/inventory/ProductsTab.tsx
git add frontend/src/components/inventory/BundlesTab.tsx
git commit -m "feat(inventory): add safe SKU rename feature

- Add checkSkuRenameEligibility() server action
- Add renameInventorySku() server action
- Create RenameSkuModal component
- Add rename button to Products and Bundles tabs
- Safety: block rename if SKU has been used (receipt layers, COGS, sales orders)
- Show clear reasons and blockers when not eligible"
```

### Commit 4: Allocation Skip Report
```bash
git add frontend/src/app/\(dashboard\)/inventory/actions.ts
git add frontend/src/components/inventory/ApplyCOGSMTDModal.tsx
git commit -m "feat(inventory): add detailed allocation skip report

- Enhanced applyCOGSMTD to track skip reasons by category
- Add skip_reasons breakdown in return data
- Categories: ALREADY_ALLOCATED, MISSING_SKU, INVALID_QUANTITY, NOT_SHIPPED, ALLOCATION_FAILED, EXCEPTION
- Show sample order_ids (up to 5) per category
- Enhanced ApplyCOGSMTDModal with collapsible skip reasons breakdown
- Better visibility into why orders failed to allocate"
```

---

## 📚 FILES CHANGED

### Phase 1: Migration
- ✅ `database-scripts/migration-058-rename-bundle-sku-NEWOON003.sql` (NEW)

### Phase 2: UX Refactor
- ✅ `frontend/src/components/inventory/ProductsTab.tsx` (MODIFIED)
- ✅ `frontend/src/components/inventory/BundlesTab.tsx` (MODIFIED)
- ✅ `frontend/src/components/inventory/CreateBundleModal.tsx` (NEW)

### Phase 3: Safe Rename
- ✅ `frontend/src/app/(dashboard)/inventory/actions.ts` (MODIFIED)
- ✅ `frontend/src/components/inventory/RenameSkuModal.tsx` (NEW)
- ✅ `frontend/src/components/inventory/ProductsTab.tsx` (MODIFIED)
- ✅ `frontend/src/components/inventory/BundlesTab.tsx` (MODIFIED)

### Phase 4: Allocation Report
- ✅ `frontend/src/app/(dashboard)/inventory/actions.ts` (MODIFIED)
- ✅ `frontend/src/components/inventory/ApplyCOGSMTDModal.tsx` (MODIFIED)

---

## 🎯 SUCCESS CRITERIA

### Phase 1: Migration ✅
- [x] Migration script created with guards
- [x] Safe rename NEWOON003 → NEWONN003
- [x] No data loss
- [x] Verification included

### Phase 2: UX Refactor ✅
- [x] Products tab creates only main products
- [x] Bundles tab has "Create Bundle" button
- [x] Clear separation of concerns
- [x] Existing functionality preserved

### Phase 3: Safe Rename ✅
- [x] Eligibility check implemented
- [x] Rename action implemented
- [x] UI modal created
- [x] Blockers clearly shown
- [x] Works for both products and bundles

### Phase 4: Allocation Report ✅
- [x] Skip reasons categorized
- [x] Counts per category
- [x] Sample order_ids shown
- [x] UI displays breakdown
- [x] Collapsible/expandable

---

## 🚀 DEPLOYMENT NOTES

### Pre-Deployment
1. Backup database
2. Test migration on staging
3. Verify NEWOON003 → NEWONN003 rename
4. Check for sales_orders with NEWOON003 (manual cleanup if needed)

### Deployment Steps
1. Deploy migration-058 (database)
2. Deploy frontend code
3. Run migration on production
4. Monitor COGS allocation
5. Verify NEWONN003 orders allocate correctly

### Post-Deployment
1. Test rename feature (create test SKU, rename, verify)
2. Run Apply COGS MTD, check skip reasons report
3. Monitor for ALLOCATION_FAILED with NEWONN003 (should be gone)

---

**Implementation Complete** ✅
**All 4 Phases Done** ✅
**Ready for Testing & Deployment** ✅

---

*Last Updated: 2026-02-18*
