# TikTok Ads Import Performance Fix - Specification

**Created:** 2026-01-26
**Status:** ✅ APPROVED
**Impact:** PERF FIX (no business logic change)

---

## ปัญหา

- **Symptom:** Confirm ช้ามาก (freeze UI, timeout risk)
- **Root Cause:** Insert rows เยอะ (100k+ rows, majority all-zero data)
- **Impact:** Poor UX, wasted DB resources, slow import completion

---

## เป้าหมาย

1. **Filter all-zero rows** before insert (spend=0 AND orders=0 AND revenue=0)
2. **Batch insert** (<=1000 rows/batch) to avoid timeout
3. **Preview ที่แม่นยำ** - แสดง counts + totals ที่จะ import จริง
4. **UI Toggle** - User เลือกได้ว่าจะ skip all-zero หรือไม่ (default: ON)
5. **Business rules ไม่เปลี่ยน** - Ads spend, date logic, dedup ยังเหมือนเดิม

---

## Solution Design

### A) Filter Rule

```typescript
// Keep rows where:
spend > 0 OR orders > 0 OR revenue > 0

// Skip rows where:
spend = 0 AND orders = 0 AND revenue = 0
```

**Rationale:**
- All-zero rows ไม่มีค่าต่อ P&L, performance tracking, wallet spend
- ลด DB load, speed up import, improve UX

**Edge Cases:**
- `spend=0, orders=10, revenue=500` → **KEEP** (มี conversion ฟรี)
- `spend=100, orders=0, revenue=0` → **KEEP** (มี spend แต่ไม่มี conversion)
- `spend=0, orders=0, revenue=0` → **SKIP** (ไม่มีประโยชน์)
- Treat `null` / empty as `0`

---

### B) Batch Insert

**Config:**
```typescript
const BATCH_SIZE = 1000;
```

**Logic:**
```typescript
// Split rows into chunks
for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const chunk = rows.slice(i, i + BATCH_SIZE);
  await supabase.from('ad_daily_performance').insert(chunk);
}
```

**Error Handling:**
- If any chunk fails → STOP immediately, mark batch as 'failed'
- Option A: Keep partial data (for debug)
- Option B: Rollback (delete all inserted rows from this batch)
- **Decision:** Option A (easier recovery, can re-import after fix)

---

### C) Preview Enhancement

**New Fields (returned by preview API):**
```typescript
interface PreviewResult {
  success: boolean;
  summary: {
    // ... existing fields
    totalRows: number;           // ทั้งหมดในไฟล์
    keptRows: number;            // NEW: แถวที่จะนำเข้า
    skippedAllZeroRows: number;  // NEW: แถวที่ข้าม (all-zero)
    totalSpend: number;          // NEW: ยอดรวมจาก kept rows
    totalOrders: number;         // NEW: ยอดรวมจาก kept rows
    totalRevenue: number;        // NEW: ยอดรวมจาก kept rows
    skipZeroRowsUsed: boolean;   // NEW: Filter enabled?
  };
  // ... existing fields
}
```

**UI Changes:**
- Show 3-column card: Total Rows | Kept Rows | Skipped Rows
- Show totals (Spend/Orders/Revenue) from **kept rows** ONLY
- If skipZeroRows = OFF → keptRows = totalRows, skippedAllZeroRows = 0

---

### D) UI Toggle

**Component:**
```tsx
<Checkbox
  id="skipZeroRows"
  checked={skipZeroRows}
  onCheckedChange={setSkipZeroRows}
/>
<label htmlFor="skipZeroRows">
  ข้ามแถวที่เป็น 0 ทั้งหมด (แนะนำ)
</label>
```

**Behavior:**
- Default: `skipZeroRows = true`
- User toggle OFF → import ALL rows (for debug/completeness)
- Sent to both `/preview` and `/confirm` endpoints

---

### E) Business Rules (Unchanged)

✅ **No Change:**
- Ads spend = imported rows (from kept rows)
- Date derived/override logic (reportDate fallback)
- File deduplication (SHA256 hash)
- Wallet entry creation (daily aggregated spend)
- Campaign type detection (product/live)

🔒 **Guaranteed:**
- Preview totals = DB totals (after import)
- Filter applies to BOTH ad_daily_performance AND wallet_ledger
- Dedup still blocks duplicate file_hash + report_type

---

## Implementation Breakdown

### Phase 1: Backend (Core Filter + Batch Insert)
**File:** `frontend/src/lib/importers/tiktok-ads-daily.ts`

**Changes:**
1. Add `filterRows()` function:
   - Input: `rows: AdsRow[]`, `skipZeroRows: boolean`
   - Output: `{ totalRows, keptRows, skippedAllZeroRows, totals }`
2. Update `parseAdsExcel()`:
   - Accept `skipZeroRows` param (default: true)
   - Call `filterRows()` after parsing
   - Return filtered data + counts
3. Update `previewAdsExcel()`:
   - Pass `skipZeroRows` to `parseAdsExcel()`
   - Include new fields in return value

**File:** `frontend/src/app/api/import/tiktok/ads-daily/route.ts` (Confirm)

**Changes:**
1. Extract `skipZeroRows` from FormData
2. Pass to `parseAdsExcel()`
3. Implement `batchInsertAds()` helper:
   - Split into chunks (BATCH_SIZE = 1000)
   - Insert chunk-by-chunk with error tracking
   - Return: `{ inserted, errors }`
4. Replace single `upsertAdRows()` with `batchInsertAds()`
5. Add error handling + rollback logic

---

### Phase 2: Frontend (UI Toggle + Counts Display)
**File:** `frontend/src/components/ads/ImportAdsDialog.tsx`

**Changes:**
1. Add state: `const [skipZeroRows, setSkipZeroRows] = useState(true)`
2. Add Checkbox UI (before file upload)
3. Update `handlePreview()`:
   - Send `skipZeroRows` in FormData
   - Store preview result with new fields
4. Update Preview display:
   - Add counts card (Total/Kept/Skipped)
   - Update totals (use kept rows)
5. Update `handleImport()`:
   - Send `skipZeroRows` in FormData

---

### Phase 3: Preview API Update
**File:** `frontend/src/app/api/import/tiktok/ads-daily/preview/route.ts`

**Changes:**
1. Extract `skipZeroRows` from FormData (default: "true")
2. Convert to boolean: `const skip = skipZeroRows === 'true'`
3. Pass to `previewAdsExcel(buffer, fileName, reportDate, adsType, skip)`
4. Return updated result (with new fields)

---

## Manual QA Checklist

### Test 1: Product file (100k rows), skipZeroRows=ON
**Steps:**
1. Upload large file (100k+ rows, majority all-zero)
2. Verify `skipZeroRows` checkbox is **checked** (default)
3. Click "ดู Preview"
4. **Expected:**
   - totalRows = 100000
   - keptRows = ~5000 (example, depends on data)
   - skippedAllZeroRows = ~95000
   - Totals (Spend/Orders/Revenue) calculated from **5000 rows** ONLY
5. Click "ยืนยันนำเข้า"
6. **Expected:**
   - Import completes in < 30 seconds (was several minutes)
   - No freeze/hang
   - Success message: "นำเข้าสำเร็จ 5000 แถว"
7. Verify DB:
   ```sql
   SELECT COUNT(*) FROM ad_daily_performance WHERE import_batch_id = $batchId;
   -- Result: 5000

   SELECT SUM(spend), SUM(revenue), SUM(orders)
   FROM ad_daily_performance WHERE import_batch_id = $batchId;
   -- Result: Match preview totals
   ```
8. Verify Wallet:
   ```sql
   SELECT SUM(amount) FROM wallet_ledger WHERE import_batch_id = $batchId;
   -- Result: Match preview totalSpend
   ```

**Pass Criteria:**
✅ Confirm time < 30s
✅ No UI freeze
✅ DB counts = 5000 (not 100000)
✅ DB totals = Preview totals
✅ Wallet spend = Preview totalSpend

---

### Test 2: Same file, skipZeroRows=OFF
**Steps:**
1. Upload same file
2. **Uncheck** `skipZeroRows` checkbox
3. Click "ดู Preview"
4. **Expected:**
   - totalRows = 100000
   - keptRows = 100000
   - skippedAllZeroRows = 0
   - Totals calculated from **100000 rows** (includes zeros)
5. Click "ยืนยันนำเข้า"
6. **Expected:**
   - Import slower (more rows) but should still complete
   - Success message: "นำเข้าสำเร็จ 100000 แถว"
7. Verify DB:
   ```sql
   SELECT COUNT(*) FROM ad_daily_performance WHERE import_batch_id = $batchId;
   -- Result: 100000 (all rows imported)
   ```

**Pass Criteria:**
✅ All 100k rows imported
✅ DB totals = Preview totals
✅ Toggle works (filter can be disabled)

---

### Test 3: Deduplication still works
**Steps:**
1. Import file A, skipZeroRows=ON → **Success**
2. Import file A again, skipZeroRows=ON → **DUPLICATE_IMPORT error**
3. Import file A again, skipZeroRows=OFF → **DUPLICATE_IMPORT error** (same file_hash)

**Pass Criteria:**
✅ 2nd import blocked with DUPLICATE_IMPORT
✅ 3rd import blocked (skipZeroRows state doesn't affect dedup)
✅ Error message shows original import timestamp

---

### Test 4: Wallet spend = Preview spend
**Steps:**
1. Import file, skipZeroRows=ON
2. Preview shows: `totalSpend = 50000.00`
3. After import, query wallet:
   ```sql
   SELECT SUM(amount) FROM wallet_ledger
   WHERE import_batch_id = $batchId AND entry_type = 'SPEND';
   ```
4. **Expected:** Result = 50000.00

**Pass Criteria:**
✅ Wallet spend matches preview exactly
✅ No missing or extra amount

---

### Test 5: DB totals = Preview totals
**Steps:**
1. Import file, skipZeroRows=ON
2. Preview shows:
   - totalSpend = X
   - totalRevenue = Y
   - totalOrders = Z
3. After import, query DB:
   ```sql
   SELECT
     SUM(spend) as total_spend,
     SUM(revenue) as total_revenue,
     SUM(orders) as total_orders
   FROM ad_daily_performance
   WHERE import_batch_id = $batchId;
   ```
4. **Expected:**
   - total_spend = X
   - total_revenue = Y
   - total_orders = Z

**Pass Criteria:**
✅ All 3 totals match exactly
✅ No rounding errors (< 0.01)

---

### Test 6: Batch Insert (Large File)
**Steps:**
1. Upload file with 5000 kept rows (after filtering)
2. Import with skipZeroRows=ON
3. Monitor server logs for chunk messages:
   ```
   [CONFIRM] Inserting 5000 rows in 5 chunks
   [CONFIRM] Chunk 1/5: 1000 rows
   [CONFIRM] Chunk 2/5: 1000 rows
   ...
   [CONFIRM] Chunk 5/5: 1000 rows
   ```

**Pass Criteria:**
✅ Logs show chunk processing
✅ No timeout errors
✅ All chunks complete successfully

---

### Test 7: Error Recovery (Chunk Failure)
**Steps:**
1. Simulate DB constraint violation (e.g., duplicate key)
2. Import should fail mid-batch (e.g., chunk 3/5)
3. **Expected:**
   - Batch status = 'failed'
   - Error message clear: "เกิดข้อผิดพลาดในการบันทึกข้อมูล"
   - Partial data kept in DB (chunks 1-2 inserted)
   - Can delete batch and retry

**Pass Criteria:**
✅ Batch marked as 'failed'
✅ Clear error message
✅ Partial data identifiable (for cleanup)

---

## Success Metrics

### Performance
- **Before:** Confirm time ~5 minutes (300s) for 100k rows
- **After:** Confirm time < 30s for 5k kept rows (10x improvement)
- **Target:** < 1 second per 1000 rows

### Accuracy
- **Preview totals = DB totals** (100% match)
- **Wallet spend = Preview totalSpend** (100% match)
- **Filter works correctly** (all-zero rows excluded)

### UX
- **No UI freeze** during import
- **Clear counts** (Total/Kept/Skipped) in preview
- **Toggle works** (user can disable filter)

### Business Rules
- **Ads spend formula unchanged** (from kept rows)
- **Date logic unchanged** (reportDate fallback)
- **Dedup unchanged** (file_hash check)
- **Wallet entries unchanged** (daily aggregated)

---

## Risks & Mitigations

### Risk 1: Partial Import on Chunk Failure
**Impact:** DB left with partial data
**Mitigation:**
- Mark batch as 'failed' clearly
- Log which chunk failed
- Option to rollback (delete by import_batch_id)

### Risk 2: Preview Totals != DB Totals
**Impact:** User confused, trust loss
**Mitigation:**
- Apply filter consistently (preview + confirm use SAME logic)
- Add Test 5 (verify totals match)
- Server-side validation before insert

### Risk 3: skipZeroRows Flag Lost/Ignored
**Impact:** Wrong rows imported
**Mitigation:**
- Default = true (safer)
- Explicit pass to all functions (no implicit assumption)
- Log skipZeroRows value in console

### Risk 4: Batch Size Too Large (Timeout)
**Impact:** Still timeout on very large files
**Mitigation:**
- Set BATCH_SIZE = 1000 (conservative)
- Monitor chunk insert time in logs
- Can reduce to 500 if needed

---

## Rollout Plan

### Phase 1: Backend Core (30 min)
- Implement filter logic in `tiktok-ads-daily.ts`
- Implement batch insert in `route.ts` (confirm)
- Add new fields to preview result
- **Test:** Unit test filter function

### Phase 2: Frontend UI (20 min)
- Add skipZeroRows checkbox
- Update preview display (counts card)
- Update confirm payload
- **Test:** Manual test toggle behavior

### Phase 3: Integration Test (20 min)
- Run Tests 1-7 (manual QA)
- Verify logs, DB state, wallet entries
- **Test:** Full end-to-end flow

### Phase 4: Documentation (10 min)
- Update `ADS_IMPORT_TEST_GUIDE.md` (if exists)
- Add filter logic to code comments
- Update this spec with test results

---

## Acceptance Criteria

✅ **Filter works:**
- All-zero rows excluded when skipZeroRows=ON
- All rows imported when skipZeroRows=OFF

✅ **Batch insert works:**
- Large files (100k+) complete in < 30s (after filtering)
- No timeout, no UI freeze
- Logs show chunk processing

✅ **Preview accurate:**
- Counts (Total/Kept/Skipped) displayed correctly
- Totals calculated from kept rows ONLY
- DB totals match preview totals (Test 5 passes)

✅ **Business rules unchanged:**
- Ads spend = sum of kept rows
- Dedup still works (Test 3 passes)
- Wallet entries correct (Test 4 passes)

✅ **UX improved:**
- Toggle visible and functional
- Clear counts in preview
- Import completes fast

---

## DONE WHEN

1. ✅ Filter logic implemented + tested
2. ✅ Batch insert implemented + tested
3. ✅ Preview shows counts + totals (kept rows)
4. ✅ UI toggle works (default ON)
5. ✅ Tests 1-7 pass (manual QA)
6. ✅ DB totals = Preview totals (100% match)
7. ✅ Confirm time < 30s for realistic file (5k kept rows)

---

**Approved by:** ORCH Agent
**Implementation Start:** 2026-01-26
