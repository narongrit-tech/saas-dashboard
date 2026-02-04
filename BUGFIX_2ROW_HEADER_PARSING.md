# Bugfix: TikTok OrderSKUList 2-Row Header Parsing

**Date**: 2026-02-03
**Issue**: Import sometimes uses Row 2 (description row) as headers causing column mapping failures
**Status**: ✅ Fixed

---

## Problem

TikTok OrderSKUList Excel files have 2-row headers:
- **Row 1**: Real headers (English) - e.g., "Order ID", "Created Time", "Product Name"
- **Row 2**: Descriptions (Thai) - e.g., "รหัสคำสั่งซื้อ", "เวลาที่สร้าง", "ชื่อสินค้า"
- **Row 3+**: Actual data

**Root Cause**: Previous code used `sheet_to_json(worksheet, { defval: null })` which:
- Automatically treats Row 1 as headers
- Treats Row 2+ as data rows
- Sometimes Row 2 (description row) gets parsed as a data row with invalid column mappings
- Can cause parsing errors if Row 2 values look like valid data

---

## Solution

### A) Added `normalizeHeader()` Helper Function

**File**: `frontend/src/app/(dashboard)/sales/sales-import-actions.ts` (line ~124)

```typescript
/**
 * Normalize header string (trim whitespace, collapse multiple spaces)
 */
function normalizeHeader(header: unknown): string {
  if (!header) return ''
  return String(header)
    .trim()
    .replace(/\s+/g, ' ') // Collapse multiple spaces to single space
}
```

**Purpose**: Clean up header strings to handle extra whitespace and normalize column names.

### B) Modified `parseTikTokFormat()` to Parse as Array-of-Arrays

**File**: `frontend/src/app/(dashboard)/sales/sales-import-actions.ts` (line ~261)

**BEFORE (Incorrect)**:
```typescript
const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null }) as Record<string, unknown>[]

if (rows.length === 0) {
  return { /* error */ }
}

// TikTok has Row 1 = headers, Row 2 = description (SKIP), Row 3+ = data
// After sheet_to_json, Row 2 might have nulls or invalid data - we'll filter
```

**AFTER (Fixed)**:
```typescript
// TikTok has Row 1 = headers, Row 2 = description (SKIP), Row 3+ = data
// Parse as array-of-arrays to handle 2-row headers correctly
const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null }) as unknown[][]

if (rawRows.length === 0) {
  return { /* error */ }
}

// Extract Row 1 as headers (normalize to handle whitespace)
const headerRow = rawRows[0] || []
const headers = headerRow.map(h => normalizeHeader(h))

// Skip Row 2 (description row) and process Row 3+ as data
const dataRows = rawRows.slice(2) // Skip rows[0] (headers) and rows[1] (descriptions)

// Convert data rows to objects using headers
const rows: Record<string, unknown>[] = dataRows.map(dataRow => {
  const obj: Record<string, unknown> = {}
  headers.forEach((header, index) => {
    if (header) {
      obj[header] = dataRow[index] ?? null
    }
  })
  return obj
})
```

**Key Changes**:
1. Use `{ header: 1 }` to parse as array-of-arrays (matrix format)
2. Extract `rawRows[0]` as header row and normalize with `normalizeHeader()`
3. **Explicitly skip `rawRows[1]`** (description row)
4. Process `rawRows.slice(2)` onwards as data rows
5. Manually map each data array to an object using normalized headers

---

## Data Flow (Correct)

```
Excel File Structure:
┌─────────────────────────────────────────────────────────────────┐
│ Row 1: Order ID  | Created Time    | Product Name  | ...       │ ← Headers (used)
├─────────────────────────────────────────────────────────────────┤
│ Row 2: รหัสคำสั่งซื้อ | เวลาที่สร้าง | ชื่อสินค้า | ...         │ ← Descriptions (SKIPPED)
├─────────────────────────────────────────────────────────────────┤
│ Row 3: 12345...  | 01/01/2026 10:00| Widget A      | ...       │ ← Data row 1
│ Row 4: 12346...  | 01/01/2026 11:00| Widget B      | ...       │ ← Data row 2
│ ...                                                             │
└─────────────────────────────────────────────────────────────────┘

Parsing Process:
1. sheet_to_json(worksheet, { header: 1 }) → rawRows[][]
2. rawRows[0] → ["Order ID", "Created Time", "Product Name", ...]
3. headers = rawRows[0].map(normalizeHeader) → clean headers
4. rawRows[1] → ["รหัสคำสั่งซื้อ", "เวลาที่สร้าง", "ชื่อสินค้า", ...] (SKIPPED)
5. dataRows = rawRows.slice(2) → [[12345, "01/01/2026 10:00", "Widget A", ...], ...]
6. Map each dataRow to object: { "Order ID": 12345, "Created Time": "01/01/2026 10:00", ... }
```

---

## Testing

### Before Fix
```
❌ Risk: Row 2 (description row) might get parsed as data
❌ Column mappings could be incorrect if Row 2 treated as header
❌ Import might fail with "Order ID not found" or invalid data
```

### After Fix
```
✅ Row 1 explicitly used as headers
✅ Row 2 explicitly skipped
✅ Row 3+ processed as data
✅ Headers normalized (whitespace trimmed, spaces collapsed)
```

### Test File
- **File**: `ทั้งหมด คำสั่งซื้อ-2026-02-03-01_07.xlsx`
- **Expected**: Import succeeds, all chunks process correctly
- **Verification**: Check that first data row starts from Row 3 (not Row 2)

---

## Files Changed

```
Modified:
✅ frontend/src/app/(dashboard)/sales/sales-import-actions.ts
   - Added normalizeHeader() helper function (line ~124)
   - Modified parseTikTokFormat() to parse as array-of-arrays (line ~261)
   - Explicitly skip Row 2 (description row)
   - Manually map data rows to objects using normalized headers
```

---

## Verification Checklist

- [x] Build compiles successfully (TypeScript)
- [x] normalizeHeader() trims whitespace and collapses spaces
- [x] parseTikTokFormat() uses { header: 1 } for array-of-arrays
- [x] Row 1 extracted as headers
- [x] Row 2 explicitly skipped
- [x] Row 3+ processed as data
- [ ] Test import with actual TikTok file (user to verify)
- [ ] Verify first data row is Row 3 in Excel
- [ ] Verify column mappings are correct

---

## Commit Message

```bash
git add frontend/src/app/\(dashboard\)/sales/sales-import-actions.ts
git commit -m "fix: handle TikTok OrderSKUList 2-row headers correctly

PROBLEM:
- TikTok files have Row 1 (real headers) + Row 2 (Thai descriptions)
- Previous parsing treated Row 2 as data, causing mapping failures
- sheet_to_json() auto-detection could use wrong row as headers

ROOT CAUSE:
- Used sheet_to_json(worksheet, { defval: null }) without explicit header handling
- No mechanism to skip Row 2 description row
- Header whitespace not normalized

FIX:
- Parse as array-of-arrays using { header: 1 }
- Extract rows[0] as headers, normalize with normalizeHeader()
- Explicitly skip rows[1] (description row)
- Process rows[2] onwards as data rows
- Manually map each data array to object using normalized headers

IMPLEMENTATION:
1. Added normalizeHeader() helper: trim + collapse whitespace
2. Modified parseTikTokFormat():
   - rawRows = sheet_to_json(worksheet, { header: 1 })
   - headers = rawRows[0].map(normalizeHeader)
   - dataRows = rawRows.slice(2) // Skip Row 2
   - Map dataRows to objects using headers

IMPACT:
- Import correctly parses TikTok OrderSKUList 2-row header format
- Row 2 description row no longer interferes with parsing
- Column mappings always use Row 1 English headers
- No data loss, no UI changes

TESTING:
- Build succeeds ✅
- Ready to test with: ทั้งหมด คำสั่งซื้อ-2026-02-03-01_07.xlsx

FILES:
- frontend/src/app/(dashboard)/sales/sales-import-actions.ts (modified)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
"
```

---

## Notes

1. **Why array-of-arrays?**
   - Gives full control over which row is used as headers
   - Allows explicit skipping of Row 2
   - Prevents auto-detection from using wrong row

2. **normalizeHeader() purpose**:
   - Handles extra whitespace in header cells
   - Collapses multiple spaces to single space
   - Ensures consistent column name matching

3. **Backwards compatibility**:
   - Rest of parsing logic unchanged (row.['Order ID'] still works)
   - Output format remains Record<string, unknown>[]
   - Same validation and error handling

---

**Status**: ✅ Ready for Testing
**Next Step**: Re-run import with actual TikTok file to verify fix
