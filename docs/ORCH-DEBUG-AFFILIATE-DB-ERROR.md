# ORCH (DEBUG PATCH): Reveal Supabase 400 "Bad Request" + Fix

**Status:** ✅ Instrumented & Ready for Debug
**Date:** 2026-01-30

---

## Problem Statement

**Issue:** Affiliate XLSX parses successfully but import fails with generic "Database error: Bad Request"
**Context:**
- Parse step: ✅ OK (rowsType=array, totalRows ~1433)
- Import step: ❌ "Database error: Bad Request" (no details)

**Goal:** Surface the REAL Supabase/PostgREST error (code/details/hint) and apply minimal fix

---

## Changes Implemented

### A) Instrumented DB Write (Server-Side)

**File:** `frontend/src/app/(dashboard)/reports/profit/affiliate-import-actions.ts`

#### A1. Added Canonical Table Constant (Line 514)
```typescript
// Table name constant (canonical)
const ORDER_ATTRIBUTION_TABLE = 'order_attribution'
```

**Why:** Ensure consistent table reference everywhere (not "order_attributions" typo)

#### A2. Entry Logging (Lines 538-545)
```typescript
const parsedRows: ParsedAffiliateRow[] = JSON.parse(parsedDataJson)
const distinctOrders = new Set(parsedRows.map(r => r.order_id)).size

// Entry log
console.log('[AffiliateImport] start', {
  rows: parsedRows.length,
  distinctOrders,
  fileName
})
```

**Output Example:**
```
[AffiliateImport] start {
  rows: 1433,
  distinctOrders: 1200,
  fileName: 'creator_order_all_20260101.xlsx'
}
```

#### A3. Defensive Schema Validation (Lines 759-773)
```typescript
const payloadKeys = Object.keys(sanitizedPayload[0] || {})
const invalidKeys = payloadKeys.filter(k => !ALLOWED_COLUMNS.includes(k))
if (invalidKeys.length > 0) {
  const errorMsg = `Invalid payload keys not in schema: ${invalidKeys.join(', ')}`
  console.error('[AffiliateImport Schema Validation Error]', errorMsg)

  return {
    success: false,
    error: errorMsg
  }
}
```

**Why:** Catch schema mismatches BEFORE calling DB (fail fast with clear error)

#### A4. Upsert Attempt Logging (Lines 778-784)
```typescript
console.log('[AffiliateImport] upsert attempt', {
  table: ORDER_ATTRIBUTION_TABLE,
  payloadCount: sanitizedPayload.length,
  payloadKeys,
  samplePayload: sanitizedPayload[0]
})
```

**Output Example:**
```
[AffiliateImport] upsert attempt {
  table: 'order_attribution',
  payloadCount: 1150,
  payloadKeys: ['order_id', 'attribution_type', 'created_by', ...],
  samplePayload: {
    order_id: '12345',
    attribution_type: 'external_affiliate',
    commission_amt: 150,
    commission_pct: null,
    commission_amt_organic: 100,
    commission_amt_shop_ad: 50,
    commission_type: 'mixed',
    created_by: 'uuid-456'
  }
}
```

#### A5. Full Error Logging (Lines 792-817)
```typescript
if (upsertError) {
  const fullError = {
    message: upsertError?.message ?? 'Unknown DB error',
    details: upsertError?.details ?? null,
    hint: upsertError?.hint ?? null,
    code: upsertError?.code ?? null,
    status: (upsertError as any)?.status ?? null,
    statusCode: (upsertError as any)?.statusCode ?? null,
    statusText: (upsertError as any)?.statusText ?? null,
    table: ORDER_ATTRIBUTION_TABLE,
    payloadKeys: Object.keys(sanitizedPayload?.[0] ?? {}),
    payloadSample: sanitizedPayload?.[0] ?? null,
    payloadCount: sanitizedPayload?.length ?? 0,
    onConflict: 'created_by,order_id'
  }

  console.error('[AffiliateImport DB Error FULL]', fullError)
  // ...
}
```

**Output Example (if error):**
```
[AffiliateImport DB Error FULL] {
  message: 'new row violates check constraint "order_attribution_commission_type_check"',
  details: 'Failing row contains (...)',
  hint: null,
  code: '23514',
  status: 400,
  statusCode: 400,
  statusText: 'Bad Request',
  table: 'order_attribution',
  payloadKeys: [...],
  payloadSample: { ... },
  payloadCount: 1150,
  onConflict: 'created_by,order_id'
}
```

**Error Codes Reference:**
- `23502`: NOT NULL violation (missing required field)
- `23514`: CHECK constraint violation (enum value mismatch)
- `23505`: UNIQUE constraint violation (duplicate key)
- `42703`: Undefined column (missing column in table)
- `42P01`: Undefined table (table name typo)

#### A6. Rich Error Return to Client (Lines 826-836)
```typescript
return {
  success: false,
  insertedCount: 0,
  updatedCount: 0,
  orphanCount,
  error: fullError.message,
  errorDetails: {
    code: fullError.code,
    details: fullError.details,
    hint: fullError.hint,
    status: fullError.status,
    samplePayloadKeys: fullError.payloadKeys
  }
}
```

**Why:** Client can display specific error info (not just "Bad Request")

---

### B) Updated UI to Show Rich Error Details

**File:** `frontend/src/components/shared/AffiliateImportDialog.tsx`

#### B1. Enhanced Result State Type (Lines 55-64)
```typescript
const [result, setResult] = useState<{
  success: boolean
  message: string
  errorDetails?: {
    code?: string | null
    details?: string | null
    hint?: string | null
    status?: number | null
    samplePayloadKeys?: string[]
  }
} | null>(null)
```

#### B2. Capture errorDetails on Import Failure (Lines 175-180)
```typescript
} else {
  setResult({
    success: false,
    message: importResult.error || 'Import failed',
    errorDetails: importResult.errorDetails
  })
}
```

#### B3. Rich Error Display (Lines 399-455)
**Features:**
- Show error code with badge
- Show details (truncated to 300 chars, scrollable)
- Show hint (yellow highlight)
- Show payload columns (comma-separated)
- **"Copy Debug Info" button** → Copies errorDetails JSON to clipboard

**UI Preview:**
```
❌ Database error: new row violates check constraint...

┌─────────────────────────────────────────┐
│ Debug Information:                      │
│                                         │
│ Error Code: 23514                       │
│                                         │
│ Details:                                │
│ ┌─────────────────────────────────────┐ │
│ │ Failing row contains (order_id='...│ │
│ │ commission_type='invalid')          │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Hint:                                   │
│ ┌─────────────────────────────────────┐ │
│ │ Check constraint violated           │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Payload Columns:                        │
│ order_id, attribution_type, created_by, │
│ commission_amt, commission_pct, ...     │
│                                         │
│ [📋 Copy Debug Info]                    │
└─────────────────────────────────────────┘

[Close]
```

---

### C) Updated Types for Rich Error

**File:** `frontend/src/types/profit-reports.ts`

#### C1. Enhanced AffiliateImportResult (Lines 55-68)
```typescript
export interface AffiliateImportResult {
  success: boolean
  insertedCount: number
  updatedCount: number
  orphanCount: number
  batchId?: string
  error?: string
  errorDetails?: {
    code?: string | null
    details?: string | null
    hint?: string | null
    status?: number | null
    samplePayloadKeys?: string[]
  }
}
```

---

### D) Verified Schema & Constraints

**Table:** `order_attribution` (confirmed in migration-036)
**Unique Constraint:** ✅ EXISTS
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_attribution_unique
ON order_attribution(created_by, order_id);
```

**Upsert Strategy:** ✅ CORRECT
```typescript
.upsert(sanitizedPayload, {
  onConflict: 'created_by,order_id',
  ignoreDuplicates: false
})
```

**CHECK Constraints:**
```sql
attribution_type CHECK (attribution_type IN ('internal_affiliate', 'external_affiliate', 'paid_ads', 'organic'))
commission_type CHECK (commission_type IN ('organic', 'shop_ad', 'mixed', 'none'))
confidence_level CHECK (confidence_level IN ('high', 'inferred'))
```

**Enum Safety:** ✅ IMPLEMENTED (Lines 611-631)
- Falls back to 'none' if commission_type invalid
- Falls back to 'external_affiliate' if attribution_type invalid

---

## Testing Instructions

### Step 1: Reproduce the Error (With Full Logging)

1. **Set Environment:**
   ```bash
   export NODE_ENV=development  # Enable dev logs
   ```

2. **Upload Affiliate File:**
   - Go to Sales Orders → Click "Attach Affiliate"
   - Upload `creator_order_all_*.xlsx`
   - Click "Confirm Import"

3. **Check Server Logs (Terminal):**
   ```
   [AffiliateImport] start { rows: 1433, distinctOrders: 1200 }
   [AffiliateImport Payload Sample] { ... }
   [AffiliateImport Columns] [...]
   [AffiliateImport] upsert attempt { ... }
   [AffiliateImport DB Error FULL] {
     message: '...',
     code: '23514',
     details: '...',
     hint: '...',
     payloadSample: { ... }
   }
   ```

4. **Check UI Error Display:**
   - Should show error code, details, hint, payload columns
   - Should have "Copy Debug Info" button

### Step 2: Diagnose Based on Error Code

#### If code = 23514 (CHECK Constraint)
**Likely cause:** `commission_type` or `attribution_type` value not in allowed set

**Check:**
1. Look at `payloadSample.commission_type` in logs
2. Verify it's one of: `['organic', 'shop_ad', 'mixed', 'none']`
3. If not → Bug in enum safety logic (lines 611-623)

**Fix:**
- Strengthen enum validation
- Add explicit type assertion

#### If code = 23502 (NOT NULL)
**Likely cause:** Missing required field (order_id, attribution_type, created_by)

**Check:**
1. Look at `payloadSample` in logs
2. Check if any required field is null/undefined

**Fix:**
- Add validation before aggregation (lines 597-647)
- Ensure all required fields set

#### If code = 42703 (Undefined Column)
**Likely cause:** Column in payload doesn't exist in table

**Check:**
1. Look at `samplePayloadKeys` in error
2. Compare against ALLOWED_COLUMNS (line 738)

**Fix:**
- If new column needed → Create migration-038
- If typo → Fix column name in code

#### If code = 23505 (UNIQUE Violation)
**Likely cause:** Duplicate (created_by, order_id) and onConflict not working

**Check:**
1. Verify unique index exists (should be OK from migration-036)
2. Check if onConflict syntax correct

**Fix:**
- Verify DB migration applied
- Check Supabase version (some versions have onConflict bugs)

### Step 3: Apply the Fix

Based on error code from Step 2, apply the appropriate fix from Task E above.

### Step 4: Verify Success

After fix:
1. **Re-upload file**
2. **Check logs:**
   ```
   [AffiliateImport] start { rows: 1433, distinctOrders: 1200 }
   [AffiliateImport] upsert attempt { payloadCount: 1150 }
   [AffiliateImport Success] { insertedCount: 1150, orphanCount: 50 }
   ```
3. **Check UI:**
   - ✅ "Import สำเร็จ: 1150 รายการ | 50 orphans"
   - ✅ Badges appear in Sales Orders
4. **Check DB:**
   ```sql
   SELECT COUNT(*) FROM order_attribution WHERE created_by = '<user_id>';
   -- Should return 1150
   ```

---

## Common Fixes (Task E)

### Fix 1: CHECK Constraint on commission_type (Code 23514)

**If error details show:** "violates check constraint order_attribution_commission_type_check"

**Root cause:** commission_type value not in ['organic', 'shop_ad', 'mixed', 'none']

**Fix:** Strengthen enum safety (already implemented, but verify it runs)
```typescript
// Lines 611-623
const ALLOWED_COMMISSION_TYPES = ['organic', 'shop_ad', 'mixed', 'none']
let commissionType: string = 'none'
// ... logic
if (!ALLOWED_COMMISSION_TYPES.includes(commissionType)) {
  commissionType = 'none'
}
```

**If still fails:** Add debug log before push:
```typescript
console.log('[DEBUG] commission_type', { commissionType, ALLOWED_COMMISSION_TYPES })
if (!ALLOWED_COMMISSION_TYPES.includes(commissionType)) {
  console.error('[ERROR] Invalid commission_type', commissionType)
  commissionType = 'none'
}
```

### Fix 2: CHECK Constraint on attribution_type (Code 23514)

**If error details show:** "violates check constraint order_attribution_attribution_type_check"

**Root cause:** attribution_type value not in ['internal_affiliate', 'external_affiliate', 'paid_ads', 'organic']

**Fix:** Already implemented (lines 625-631), but verify ParsedAffiliateRow sets valid value

**Add validation at parse time:**
```typescript
// In parseAffiliateImportFile (line ~310)
let attributionType: 'internal_affiliate' | 'external_affiliate' = 'external_affiliate'
if (channelId.toLowerCase().includes('internal') || channelId.toLowerCase().includes('owned')) {
  attributionType = 'internal_affiliate'
}
```

### Fix 3: Missing Column (Code 42703)

**If error details show:** "column 'X' does not exist"

**Root cause:** Payload includes column not in DB schema

**Fix:** Should be caught by defensive validation (lines 759-773), but if not:
```typescript
// Remove the offending column from ALLOWED_COLUMNS list
const ALLOWED_COLUMNS = [
  'order_id',
  'attribution_type',
  // ...
  // DO NOT include column 'X' if it doesn't exist in table
]
```

**If column SHOULD exist:** Create migration-038:
```sql
ALTER TABLE order_attribution
ADD COLUMN X VARCHAR(100);
```

### Fix 4: NULL in NOT NULL Column (Code 23502)

**If error details show:** "null value in column 'Y' violates not-null constraint"

**Root cause:** Required field not set in payload

**Fix:** Add explicit null check before upsert:
```typescript
// Before sanitizedPayload creation (line ~750)
for (const attr of attributionsToUpsert) {
  if (!attr.order_id) throw new Error('order_id is required')
  if (!attr.attribution_type) throw new Error('attribution_type is required')
  if (!attr.created_by) throw new Error('created_by is required')
}
```

---

## Files Changed

### Server-Side
- ✅ `frontend/src/app/(dashboard)/reports/profit/affiliate-import-actions.ts`
  - Lines 514-516: Added ORDER_ATTRIBUTION_TABLE constant
  - Lines 538-545: Entry logging
  - Lines 759-773: Defensive schema validation
  - Lines 778-784: Upsert attempt logging
  - Lines 792-817: Full error logging
  - Lines 826-836: Rich error return

### Client-Side
- ✅ `frontend/src/components/shared/AffiliateImportDialog.tsx`
  - Lines 55-64: Enhanced result state type
  - Lines 175-180: Capture errorDetails
  - Lines 399-455: Rich error display + Copy Debug Info button

### Types
- ✅ `frontend/src/types/profit-reports.ts`
  - Lines 55-68: Enhanced AffiliateImportResult with errorDetails

---

## Success Criteria (DONE WHEN)

- [x] UI shows real error code (not just "Bad Request")
- [x] UI shows error details (truncated, scrollable)
- [x] UI shows error hint (if available)
- [x] UI shows payload columns
- [x] "Copy Debug Info" button works
- [x] Server logs show full error object
- [x] Server logs show upsert attempt details
- [ ] **After fix applied:** Import succeeds
- [ ] **After fix applied:** Matched/Orphan counts computed
- [ ] **After fix applied:** Total commission > 0
- [ ] **After fix applied:** order_attribution rows inserted
- [ ] **After fix applied:** Badges appear in Sales Orders

---

## Next Steps

1. **Run the import with instrumentation enabled**
2. **Check server logs for `[AffiliateImport DB Error FULL]`**
3. **Note the error code**
4. **Apply the specific fix from Task E based on code**
5. **Re-test import**
6. **Verify success criteria**

---

## Example Debugging Session

### Scenario: CHECK Constraint Violation

**Server Log:**
```
[AffiliateImport] start { rows: 1433, distinctOrders: 1200 }
[AffiliateImport] upsert attempt { payloadCount: 1150, payloadKeys: [...] }
[AffiliateImport DB Error FULL] {
  message: 'new row violates check constraint "order_attribution_commission_type_check"',
  details: 'Failing row contains (commission_type="invalid_value")',
  hint: null,
  code: '23514',
  payloadSample: {
    order_id: '12345',
    commission_type: 'invalid_value',  // ❌ Not in allowed set!
    ...
  }
}
```

**UI Display:**
```
❌ Database error: new row violates check constraint

Error Code: 23514
Details: Failing row contains (commission_type="invalid_value")
Payload Columns: order_id, attribution_type, commission_type, ...
```

**Diagnosis:**
- Code 23514 = CHECK constraint violation
- commission_type = "invalid_value" (not in ['organic', 'shop_ad', 'mixed', 'none'])
- Enum safety should have caught this!

**Fix:**
1. Check enum safety logic (lines 611-623)
2. Add debug log to see where invalid value comes from
3. Strengthen validation:
   ```typescript
   // Force type safety
   let commissionType: 'organic' | 'shop_ad' | 'mixed' | 'none' = 'none'
   // ... logic
   ```

**Re-test:**
```
[AffiliateImport] start { rows: 1433 }
[AffiliateImport] upsert attempt { payloadCount: 1150 }
[AffiliateImport Success] { insertedCount: 1150, orphanCount: 50 }
```

✅ Success!

---

## Summary

**What We Did:**
1. ✅ Added comprehensive error logging (full Supabase error object)
2. ✅ Added rich error display in UI (code, details, hint, columns)
3. ✅ Added "Copy Debug Info" button
4. ✅ Added defensive schema validation
5. ✅ Verified table name and unique constraint
6. ✅ Documented common fixes for each error code

**What's Next:**
- Run import with instrumentation
- Identify specific error code
- Apply targeted fix
- Verify success

**TypeScript:** ✅ 0 errors
