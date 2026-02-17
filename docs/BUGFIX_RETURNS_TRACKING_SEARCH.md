# Bug Fix: Returns Tracking Number Search Not Working

## Date
2026-02-17

## Issue Summary
Tracking numbers exist in the TikTok import files but are not searchable in the Returns page. Users cannot find orders by scanning tracking number barcodes.

## Root Cause Analysis

### Investigation Steps
1. **Database Schema Check** ✓
   - Column `tracking_number` exists in `sales_orders` table (added by migration-055)
   - Indexes exist: `idx_sales_orders_tracking_number` and `idx_sales_orders_search_external_order_id`

2. **Data Availability Check** ✗
   - **ROOT CAUSE FOUND:** All 2,993 orders have `tracking_number = NULL` (0% populated)
   - TikTok import files contain "Tracking ID" column with valid tracking numbers

3. **Import Logic Check** ✗
   - **BUG FOUND:** Import parser reads "Tracking ID" from Excel but only stores it in `metadata` JSONB field
   - Parser does NOT populate the dedicated `tracking_number` column during insert/upsert

4. **Search Query Check** ✓
   - Returns search action correctly queries `tracking_number` column
   - Search uses case-insensitive ILIKE pattern matching

## Files Affected

### 1. Parser (Client-Side)
**File:** `frontend/src/lib/sales-parser.ts`

**Issue:** Line 315 stores Tracking ID only in metadata, not in `tracking_number` field

**Fix Applied:**
```typescript
// BEFORE (line 319-351)
parsedRows.push({
  // ... other fields
  created_time: createdTime ? toBangkokDatetime(createdTime) || undefined : undefined,
  paid_time: paidTime ? toBangkokDatetime(paidTime) || undefined : undefined,
  cancelled_time: cancelledTime ? toBangkokDatetime(cancelledTime) || undefined : undefined,
})

// AFTER
parsedRows.push({
  // ... other fields
  created_time: createdTime ? toBangkokDatetime(createdTime) || undefined : undefined,
  paid_time: paidTime ? toBangkokDatetime(paidTime) || undefined : undefined,
  cancelled_time: cancelledTime ? toBangkokDatetime(cancelledTime) || undefined : undefined,

  // Tracking number (for Returns search)
  tracking_number: row['Tracking ID'] ? String(row['Tracking ID']).trim() : undefined,
})
```

### 2. Server Action (Server-Side Parser)
**File:** `frontend/src/app/(dashboard)/sales/sales-import-actions.ts`

**Issue:** Server-side parser (line 467) stores Tracking ID only in metadata

**Fix Applied:**
```typescript
// Line 509-511 (BEFORE)
created_time: createdTime ? toBangkokDatetime(createdTime) : null,
paid_time: paidTime ? toBangkokDatetime(paidTime) : null,
cancelled_time: cancelledTime ? toBangkokDatetime(cancelledTime) : null,

// AFTER
created_time: createdTime ? toBangkokDatetime(createdTime) : null,
paid_time: paidTime ? toBangkokDatetime(paidTime) : null,
cancelled_time: cancelledTime ? toBangkokDatetime(cancelledTime) : null,

// Tracking number (for Returns search)
tracking_number: getCellValue(row, 'Tracking ID') ? String(getCellValue(row, 'Tracking ID')).trim() : null,
```

**Issue:** Import upsert (line 998-1035) doesn't include `tracking_number` field

**Fix Applied:**
```typescript
// Line 1031-1035 (BEFORE)
// TikTok Business Timestamps (from parser)
created_time: row.created_time,
paid_time: row.paid_time,
cancelled_time: row.cancelled_time,

// AFTER
// TikTok Business Timestamps (from parser)
created_time: row.created_time,
paid_time: row.paid_time,
cancelled_time: row.cancelled_time,

// Tracking number (for Returns search)
tracking_number: row.tracking_number,
```

### 3. Type Definitions
**File:** `frontend/src/types/sales-import.ts`

**Issue:** `ParsedSalesRow` interface missing `tracking_number` field

**Fix Applied:**
```typescript
// Line 191-194 (BEFORE)
// TikTok Business Timestamps (from OrderSKUList export)
created_time?: string | null
paid_time?: string | null
cancelled_time?: string | null

// Order-level fields...

// AFTER
// TikTok Business Timestamps (from OrderSKUList export)
created_time?: string | null
paid_time?: string | null
cancelled_time?: string | null

// Returns support
tracking_number?: string | null // Shipping tracking number (for barcode search in Returns)

// Order-level fields...
```

## Migration
**File:** `database-scripts/migration-056-fix-tracking-search.sql`

**Purpose:** Verify schema and indexes are correct (idempotent verification)

**Contents:**
- Verify `tracking_number` column exists
- Verify search indexes exist
- Check data availability
- Sample query for debugging

## Testing

### Before Fix
```bash
cd frontend
export $(cat .env.local | xargs)
npx tsx src/scripts/check-tracking.ts
```

**Result:**
```
Total orders: 2993
Orders with tracking: 0 (0.0%)
❌ No orders with tracking_number found.
```

### After Fix (Expected)
1. **Re-import sales orders** with new TikTok OrderSKUList file
2. Run check script again:
   ```bash
   npx tsx src/scripts/check-tracking.ts
   ```
3. **Expected Result:**
   ```
   Total orders: 2993
   Orders with tracking: 2500+ (80%+)
   ✓ Found 10 results for tracking search
   ```

### Manual Test Cases

#### Test 1: Import New Sales Orders
1. Navigate to `/sales/import`
2. Upload TikTok OrderSKUList file
3. Complete import process
4. Verify: Database query shows `tracking_number` populated
   ```sql
   SELECT id, external_order_id, tracking_number
   FROM sales_orders
   WHERE tracking_number IS NOT NULL
   LIMIT 10;
   ```

#### Test 2: Search by Tracking Number
1. Find order with tracking_number from database
2. Navigate to `/returns`
3. Type or scan tracking_number in search box
4. Press Enter
5. **Expected:** Order found, drawer opens automatically

#### Test 3: Search by External Order ID (Regression)
1. Find order by external_order_id
2. Navigate to `/returns`
3. Type external_order_id in search box
4. Press Enter
5. **Expected:** Order found (existing functionality still works)

#### Test 4: Case Sensitivity
1. Search tracking number in UPPERCASE
2. Search same tracking in lowercase
3. **Expected:** Both searches work (case-insensitive ILIKE)

#### Test 5: Multiple Results
1. Search partial tracking number that matches multiple orders
2. **Expected:** List of matching orders displayed

#### Test 6: Auto-Open Drawer
1. Search tracking number that matches exactly 1 order
2. **Expected:** Drawer opens automatically without showing list

## Performance Verification

**Query Plan Check:**
```sql
EXPLAIN ANALYZE
SELECT id, external_order_id, tracking_number
FROM sales_orders
WHERE created_by = 'USER_ID_HERE'
  AND tracking_number ILIKE '%TEST123%'
LIMIT 10;
```

**Expected:**
- Uses `idx_sales_orders_tracking_number` index
- Execution time < 50ms (for table with ~3000 rows)

## Backfill Strategy

### Option 1: Re-import All Sales Files
**Pros:**
- Clean, guaranteed correct data
- No manual SQL needed

**Cons:**
- Time-consuming if many files
- Need to collect all historical import files

### Option 2: Migrate from Metadata (If Applicable)
**Only if** tracking data was stored in `metadata.tracking_id`:
```sql
UPDATE sales_orders
SET tracking_number = metadata->>'tracking_id'
WHERE metadata->>'tracking_id' IS NOT NULL
  AND tracking_number IS NULL;
```

**Note:** This project stores tracking in metadata, so this approach is valid.

### Option 3: No Backfill (Forward-Only)
- New imports populate `tracking_number`
- Old orders remain with NULL tracking_number
- Acceptable if old orders don't need return processing

## Deployment Steps

1. **Apply code changes** (already done in this fix)
   - `frontend/src/lib/sales-parser.ts`
   - `frontend/src/app/(dashboard)/sales/sales-import-actions.ts`
   - `frontend/src/types/sales-import.ts`

2. **Verify migration** (optional, schema already exists from migration-055)
   ```bash
   psql $DATABASE_URL -f database-scripts/migration-056-fix-tracking-search.sql
   ```

3. **Backfill existing data** (Option 2 - from metadata)
   ```sql
   UPDATE sales_orders
   SET tracking_number = metadata->>'tracking_id'
   WHERE metadata->>'tracking_id' IS NOT NULL
     AND tracking_number IS NULL;
   ```

4. **Verify backfill**
   ```sql
   SELECT
     COUNT(*) as total,
     COUNT(tracking_number) as with_tracking,
     ROUND(COUNT(tracking_number)::numeric / COUNT(*)::numeric * 100, 2) as percent
   FROM sales_orders;
   ```

5. **Deploy frontend** (build and restart)
   ```bash
   cd frontend
   npm run build
   # Restart Next.js server
   ```

6. **Test Returns search** with known tracking numbers

## Risks & Mitigations

### Risk 1: Metadata Field Name Mismatch
**Issue:** If metadata stores tracking as different key (e.g., `tracking_number` instead of `tracking_id`)

**Mitigation:** Check metadata structure before backfill:
```sql
SELECT metadata
FROM sales_orders
WHERE metadata IS NOT NULL
LIMIT 10;
```

### Risk 2: Import File Format Change
**Issue:** TikTok may change column names in future exports

**Mitigation:**
- Parser uses flexible column name matching
- Add monitoring/logging for import failures

### Risk 3: Backfill Overwrites Manual Edits
**Issue:** If users manually edited tracking_number, backfill may overwrite

**Mitigation:** Backfill only where `tracking_number IS NULL`

## Monitoring

**Query to check tracking_number population rate:**
```sql
SELECT
  source_platform,
  COUNT(*) as total_orders,
  COUNT(tracking_number) as with_tracking,
  ROUND(COUNT(tracking_number)::numeric / COUNT(*)::numeric * 100, 2) as percent_with_tracking
FROM sales_orders
GROUP BY source_platform
ORDER BY total_orders DESC;
```

**Expected results (after fix + backfill):**
- `tiktok_shop`: 80-90% with tracking (some orders may not have tracking yet)
- Other platforms: Lower % (if they don't provide tracking in imports)

## Conclusion

**Fix Type:** Data pipeline bug (parser not extracting field to dedicated column)

**Impact:** High (blocks Returns workflow for barcode scanning)

**Complexity:** Low (3 file changes, no schema migration needed)

**Testing Required:**
- ✓ Unit test: Parser extracts tracking_number
- ✓ Integration test: Import populates tracking_number column
- ✓ E2E test: Returns search finds orders by tracking_number

**Deployment Risk:** Low (idempotent changes, backward compatible)

**Follow-up:**
- Monitor tracking_number population rate after deployment
- Add tracking_number to Sales table UI (optional enhancement)
- Consider adding tracking_number to other marketplaces (Shopee, Lazada) when supported
