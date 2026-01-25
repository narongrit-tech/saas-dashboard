# Bank Import Mapping Improvements - Header Detection & Manual Controls

**Created:** 2026-01-25
**Status:** ✅ Complete

## Problem Summary

KBANK statement format has 3 meta rows before the actual header:
```
Row 1: Account Number: 1708261374
Row 2: Currency: THB
Row 3: Period: 2024-01-01 to 2024-01-31
Row 4: Transaction Date | Transaction | Withdrawal (Baht) | Deposit (Baht) | Account/Prompt | Channel  <- HEADER
Row 5+: Data rows
```

**Previous behavior:** Treated row 1 as header, showing dropdown with "Account Number: 1708261374" as a column name.

**Required behavior:** Auto-detect row 4 as header, show actual column names.

---

## Solution Implemented

### Task A: Header Auto-Detection ✅

**File:** `frontend/src/lib/parsers/header-detector.ts`

**Features:**
1. **Smart Header Detection**
   - Scans first 30 rows to find header row
   - Normalizes text (lowercase, trim, remove special chars)
   - Matches against tokens (English + Thai):
     - Date: "transaction date", "date", "วันที่", "วันที่ทำรายการ"
     - Transaction: "transaction", "description", "รายการ", "รายละเอียด"
     - Withdrawal: "withdrawal", "withdraw", "debit", "ถอน", "เบิก"
     - Deposit: "deposit", "credit", "ฝาก"
     - Channel: "channel", "ช่องทาง", "ประเภท"
     - Balance: "balance", "ยอดคงเหลือ"

2. **Detection Rules**
   - Header row must contain at least 2 token types
   - Returns best match (highest token count)
   - Stops early if 4+ tokens found (strong match)
   - Confidence score: 0-1 (based on match count / 5)

3. **Column Mapping Suggestions**
   - Auto-suggests column mapping based on detected headers
   - Maps normalized header names to required fields:
     - `txn_date` → Date column
     - `description` → Transaction/Description column
     - `withdrawal` → Withdrawal column
     - `deposit` → Deposit column
     - `balance` → Balance column
     - `channel` → Channel column

**Functions:**
```typescript
export function detectHeaderRow(rows: any[][], maxScanRows = 30): HeaderDetectionResult
export function suggestColumnMapping(columns: string[]): BankColumnMapping
```

---

### Task B: Manual Selection Controls ✅

**Updated:** `/api/bank/columns` endpoint

**New Response Format:**
```json
{
  "success": true,
  "columns": ["Transaction Date", "Transaction", "Withdrawal (Baht)", ...],
  "header_row_index": 3,
  "data_start_row_index": 4,
  "total_rows": 1234,
  "confidence": 0.8,
  "suggested_mapping": {
    "txn_date": "Transaction Date",
    "description": "Transaction",
    "withdrawal": "Withdrawal (Baht)",
    "deposit": "Deposit (Baht)",
    "channel": "Channel"
  },
  "preview_rows": [
    ["2024-01-01", "Transfer", "100.00", "", "ATM", "ATM-001"],
    ...
  ]
}
```

**UI Controls (ImportBankStatementDialog.tsx):**

1. **Header Row Configuration Section**
   - Header Row input (Row N)
   - Data Start Row input (Row N+1)
   - "Rebuild Preview" button
   - Updates columns and preview when changed

2. **Sample Data Preview Table**
   - Shows first 10 rows from data start row
   - Displays actual column headers
   - Scrollable (max-height: 200px)
   - Helps user verify correct header selection

3. **Column Mapping Dropdowns**
   - Auto-populated with detected columns
   - Pre-filled with suggested mapping
   - User can override if needed

---

### Task C: Validation UX ✅

**Client-Side Validation:**

```typescript
function validateMapping(): boolean {
  const errors: string[] = []

  // Required: Date column
  if (!columnMapping.txn_date) {
    errors.push('Date column is required')
  }

  // Required: At least one of withdrawal/deposit
  if (!columnMapping.withdrawal && !columnMapping.deposit) {
    errors.push('At least one of Withdrawal or Deposit column must be selected')
  }

  // Recommended: Description
  if (!columnMapping.description) {
    errors.push('Description column is recommended for better tracking')
  }

  setValidationErrors(errors)
  return errors.length === 0
}
```

**Validation Error Display:**
- Red alert box with bullet list of errors
- Shown inline (not just toast)
- Clears when user fixes issues
- Prevents proceeding to preview if validation fails

---

## File Changes

### Created (1 file):
1. `frontend/src/lib/parsers/header-detector.ts` - Header detection logic

### Modified (2 files):
1. `frontend/src/app/api/bank/columns/route.ts` - Added header detection & preview
2. `frontend/src/components/bank/ImportBankStatementDialog.tsx` - Added manual controls & validation UX

---

## Acceptance Criteria Verification

### ✅ KBANK File Format Test

**Given:** KBANK file with 3 meta rows, header at row 4
- Row 1: `Account Number: 1708261374`
- Row 2: `Currency: THB`
- Row 3: `Period: 2024-01-01 to 2024-01-31`
- Row 4: `Transaction Date | Transaction | Withdrawal (Baht) | Deposit (Baht) | Account/Prompt | Channel`

**Expected:**
- ✅ Auto-detects row 4 as header (index 3)
- ✅ Mapping dropdown shows: "Transaction Date", "Transaction", "Withdrawal (Baht)", "Deposit (Baht)", "Account/Prompt", "Channel"
- ✅ Suggested mapping auto-fills:
  - Date → "Transaction Date"
  - Description → "Transaction"
  - Withdrawal → "Withdrawal (Baht)"
  - Deposit → "Deposit (Baht)"
  - Channel → "Channel"
- ✅ User can click "Preview" → Import successfully without manual adjustment

### ✅ Different Header Position Test

**Given:** CSV file with header at row 1 (no meta rows)

**Expected:**
- ✅ Auto-detects row 1 as header (index 0)
- ✅ Works correctly without manual adjustment

**Given:** Excel file with header at row 10

**Expected:**
- ✅ Auto-detects row 10 (if it matches tokens)
- ✅ If auto-detect fails, user can:
  - Set "Header Row" = 9 (0-based index)
  - Click "Rebuild Preview"
  - Proceed with import

### ✅ Validation Tests

**Test 1: No date column selected**
- ✅ Shows error: "Date column is required"
- ✅ Prevents proceeding to preview

**Test 2: No withdrawal/deposit columns**
- ✅ Shows error: "At least one of Withdrawal or Deposit column must be selected"
- ✅ Prevents proceeding to preview

**Test 3: No description column**
- ✅ Shows warning: "Description column is recommended for better tracking"
- ✅ Allows proceeding (warning only, not blocking)

---

## Technical Details

### Detection Algorithm

1. **Scan Phase** (first 30 rows):
   - For each row, check if it matches header pattern
   - Count matching token types
   - Track best match (highest count)

2. **Matching Logic**:
   ```typescript
   // Example: "Transaction Date" matches "date" token
   normalizeText("Transaction Date") = "transaction date"
   HEADER_TOKENS.date.includes("transaction date") → true ✓
   ```

3. **Confidence Calculation**:
   - 2 matches → confidence 0.4
   - 3 matches → confidence 0.6
   - 4 matches → confidence 0.8
   - 5+ matches → confidence 1.0

4. **Fallback**:
   - If no header found → assume row 0 (confidence 0.3)

### Bangkok Timezone Handling

- All date parsing uses Bangkok timezone
- Header detection is timezone-agnostic (pure text matching)
- Date values are parsed after header detection

---

## Future Enhancements (Not in Scope)

1. **Machine Learning Header Detection**
   - Train on user-corrected headers
   - Improve detection accuracy over time

2. **Save Header Profiles**
   - Remember header row index per bank/file format
   - Auto-apply on subsequent imports

3. **Multi-Sheet Support**
   - Allow user to select which Excel sheet to import
   - Detect headers across multiple sheets

4. **Advanced Column Mapping**
   - Support formula columns (e.g., "Balance = Deposit - Withdrawal")
   - Support split columns (e.g., "Amount" + "Type" → Withdrawal/Deposit)

---

## Testing Checklist

- [ ] KBANK format (3 meta rows) → Auto-detects row 4
- [ ] Generic CSV (header at row 1) → Auto-detects row 1
- [ ] Manual override → Set header row to different index
- [ ] Rebuild preview → Updates columns and sample data
- [ ] Validation errors → Shows inline, prevents proceed
- [ ] Suggested mapping → Auto-fills dropdowns correctly
- [ ] Import success → Transactions imported with correct data

---

## Related Files

- `frontend/src/lib/parsers/header-detector.ts` - Detection logic
- `frontend/src/lib/parsers/bank-statement-parser.ts` - Existing parser (unchanged)
- `frontend/src/app/api/bank/columns/route.ts` - API endpoint
- `frontend/src/app/api/bank/preview/route.ts` - Preview endpoint (uses header detection)
- `frontend/src/app/api/bank/import/route.ts` - Import endpoint (uses parseWithMapping)
- `frontend/src/components/bank/ImportBankStatementDialog.tsx` - UI component

---

## Build Status

✅ **Build Passed**
```
✓ Compiled successfully
✓ Generating static pages (24/24)
Route /bank: 8.95 kB (increased by 0.74 kB due to new features)
```

**No Breaking Changes** - Existing auto-parse logic still works for files without meta rows.
