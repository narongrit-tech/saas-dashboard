# Ads Import Confirm Fix - Checklist

## ปัญหาที่พบ
- Preview สำเร็จ: parse ได้, ตัวเลขถูกต้อง
- Confirm ล้ม: "Failed to create import batch"
- Error message ไม่ชัดเจน (ไม่รู้ว่าพังเพราะอะไร)

## Root Cause Analysis

### H1: UNIQUE constraint ชน (idx_import_batches_unique_file)
**Status**: ✅ CONFIRMED

**Evidence**:
```sql
CREATE UNIQUE INDEX idx_import_batches_unique_file
  ON public.import_batches(created_by, file_hash, report_type)
  WHERE file_hash IS NOT NULL AND status = 'success';
```

**Current Dedup Logic** (route.ts lines 74-99):
```typescript
const { data: existingBatches } = await supabase
  .from('import_batches')
  .select('id, status, created_at, metadata')
  .eq('created_by', user.id)
  .eq('marketplace', 'tiktok')
  .eq('report_type', 'tiktok_ads_daily')
  .eq('file_hash', fileHash)
  .eq('status', 'success');

const duplicateBatch = existingBatches?.find((batch) => {
  const meta = batch.metadata as any;
  return (
    meta?.reportDate === reportDateStr &&
    meta?.adsType === adsType
  );
});
```

**Problem**: Dedup ใช้ metadata (reportDate + adsType) แต่ unique index ไม่รู้จัก metadata → constraint ชนก่อน

### H2: Confirm ใช้ validation เก่า (ไม่ sync กับ Preview)
**Status**: ✅ VERIFIED - ใช้ parser เดียวกัน

**Evidence**:
- Preview: `parseAdsExcel(buffer, reportDate, adsType || undefined)` (preview route line 70)
- Confirm: `parseAdsExcel(buffer, reportDate, adsType || undefined)` (route line 130)
- Parser รองรับ reportDate fallback (tiktok-ads-daily.ts line 729-749)

**Problem**: Logic ใช้ร่วมกัน แต่ error handling ไม่ครบ

### H3: FK/Wallet dependency
**Status**: ⚠️ POTENTIAL ISSUE

**Evidence** (route.ts lines 174-179):
```typescript
const { data: adsWallet } = await supabase
  .from('wallets')
  .select('id')
  .eq('created_by', user.id)
  .eq('wallet_type', 'ADS')
  .single();
```

**Problem**: ถ้าไม่มี ADS wallet → walletInsertedCount = 0 แต่ไม่ throw error

---

## Acceptance Criteria

### AC1: Confirm สำเร็จ
- [x] สร้าง import_batch record ✅
- [x] Insert ad_daily_performance records ✅
- [x] สร้าง wallet_ledger SPEND entries ✅

### AC2: Duplicate detection ชัดเจน
- [ ] ไฟล์ซ้ำ (file_hash + report_type เดียวกัน) → error: "DUPLICATE_IMPORT"
- [ ] Message: "มีการนำเข้าไฟล์นี้แล้วเมื่อ [timestamp]"
- [ ] Return existing batch ID
- [ ] Idempotent (ห้าม double import)

### AC3: รองรับไฟล์ไม่มี Date column
- [x] Parser ใช้ reportDate แทน Date column ✅
- [x] Warning: "⚠️ ไฟล์ไม่มี Date column - ใช้ Report Date สำหรับทุก row" ✅

### AC4: Debug payload/log
- [ ] Structured logging: [CONFIRM] Step 1/2/3/4
- [ ] Error response: { code, message, details }
- [ ] รู้ว่าพัง step ไหน (batch / rows / wallet)

### AC5: Business rules ไม่เปลี่ยน
- [x] Ads spend = IMPORTED source only ✅
- [x] Timezone Asia/Bangkok ✅
- [x] No localStorage ✅

---

## การแก้ไข

### Phase 1: Fix Deduplication Logic (HIGH PRIORITY)

**Problem**: UNIQUE constraint ใช้ (created_by, file_hash, report_type) แต่ code check metadata

**Solution**: เปลี่ยน dedup key ให้ตรงกับ unique index

**Options**:
1. **Option A**: ใช้ file_hash + report_type เป็น dedup key (ignore reportDate/adsType)
   - Pros: Simple, ตรงกับ DB constraint
   - Cons: ไฟล์เดียวกันไม่สามารถ import ซ้ำ (แม้ต่างวัน/ประเภท)

2. **Option B**: เพิ่ม reportDate + adsType ใน file_hash calculation
   - Pros: Granular dedup (ไฟล์เดียวกัน import ได้หลายวัน)
   - Cons: Breaking change

3. **Option C**: ลบ unique index, ใช้ application-level dedup
   - Pros: Flexible
   - Cons: ไม่ idempotent ถ้า concurrent requests

**Decision**: **Option A + Enhanced Error Handling**
- Dedup: file_hash + report_type ONLY (simple, safe)
- Error: Show clear message + existing batch timestamp
- Future: Option B if business needs granular dedup

**Implementation**:
```typescript
// Step 1: Check dedup FIRST (before creating batch)
const { data: existingBatch } = await supabase
  .from('import_batches')
  .select('id, status, created_at, metadata')
  .eq('created_by', user.id)
  .eq('file_hash', fileHash)
  .eq('report_type', 'tiktok_ads_daily')
  .eq('status', 'success')
  .single();

if (existingBatch) {
  return NextResponse.json({
    success: false,
    code: 'DUPLICATE_IMPORT',
    message: `ไฟล์นี้ถูก import แล้วเมื่อ ${new Date(existingBatch.created_at).toLocaleString('th-TH')}`,
    details: {
      existingBatchId: existingBatch.id,
      importedAt: existingBatch.created_at,
    },
  }, { status: 400 });
}
```

### Phase 2: Add Structured Logging

**Implementation**:
```typescript
console.log('[CONFIRM] Step 1: Received payload', {
  reportDate: reportDateStr,
  adsType,
  fileHash,
  fileName: file.name,
  fileSize: file.size,
});

console.log('[CONFIRM] Step 2: Creating import batch...');
// ... batch creation

console.log('[CONFIRM] Step 3: Parsing Excel...', { reportDate, adsType });
// ... parse

console.log('[CONFIRM] Step 4: Inserting ad rows...', { rowCount: rows.length });
// ... insert

console.log('[CONFIRM] Step 5: Creating wallet entries...', { dailySpendMap: Array.from(dailySpendMap.entries()) });
// ... wallet

console.log('[CONFIRM] Step 6: Success', { batchId: batch.id, insertedCount, walletInsertedCount });
```

### Phase 3: Wallet Safety Check

**Problem**: ถ้าไม่มี ADS wallet → silent fail (walletInsertedCount = 0)

**Solution**: Throw error ถ้าไม่มี wallet

**Implementation**:
```typescript
const { data: adsWallet, error: walletError } = await supabase
  .from('wallets')
  .select('id')
  .eq('created_by', user.id)
  .eq('wallet_type', 'ADS')
  .single();

if (walletError || !adsWallet) {
  // Mark batch as failed
  await supabase
    .from('import_batches')
    .update({ status: 'failed', notes: 'ADS wallet not found' })
    .eq('id', batch.id);

  return NextResponse.json({
    success: false,
    code: 'WALLET_NOT_FOUND',
    message: 'ไม่พบ TikTok Ads wallet - กรุณาสร้าง wallet ก่อนนำเข้าข้อมูล',
    details: {
      batchId: batch.id,
      step: 'wallet_lookup',
    },
  }, { status: 400 });
}
```

### Phase 4: Enhanced Error Response

**Standard Error Format**:
```typescript
return NextResponse.json({
  success: false,
  code: 'DUPLICATE_IMPORT' | 'WALLET_NOT_FOUND' | 'PARSE_ERROR' | 'DB_ERROR' | 'UNKNOWN_ERROR',
  message: 'Human-readable message (Thai)',
  details: {
    step: 'dedup' | 'create_batch' | 'parse' | 'insert_rows' | 'create_wallet',
    constraint?: 'idx_import_batches_unique_file',
    field?: 'field_name',
    existingBatchId?: 'uuid',
    importedAt?: 'timestamp',
    // ... other debug info
  }
}, { status: 400 | 500 });
```

---

## Test Cases

### Test 1: Product file (no date column) + reportDate
**Input**:
- File: product-ads-no-date.xlsx (has spend/orders/revenue, NO date column)
- reportDate: 2026-01-20
- adsType: product

**Expected**:
1. Preview → Success ✅
2. Confirm → Success ✅
3. DB Verification:
   - import_batches: 1 record, status=success
   - ad_daily_performance: N records, all ad_date=2026-01-20
   - wallet_ledger: 1 SPEND entry, date=2026-01-20

**SQL**:
```sql
-- Check import_batches
SELECT id, report_type, file_hash, status, row_count, inserted_count
FROM import_batches
WHERE created_by = current_user
  AND report_type = 'tiktok_ads_daily'
ORDER BY created_at DESC
LIMIT 1;

-- Check ad_daily_performance
SELECT ad_date, campaign_type, campaign_name, spend, orders, revenue
FROM ad_daily_performance
WHERE import_batch_id = [batch_id]
ORDER BY ad_date, campaign_name;

-- Check wallet_ledger
SELECT date, entry_type, direction, amount, source, note
FROM wallet_ledger
WHERE import_batch_id = [batch_id]
ORDER BY date;
```

### Test 2: Re-import same file (dedup)
**Input**:
1. Import file A, reportDate=2026-01-20, adsType=product → Success
2. Import file A, reportDate=2026-01-20, adsType=product → **Expected: DUPLICATE_IMPORT error**

**Expected Error**:
```json
{
  "success": false,
  "code": "DUPLICATE_IMPORT",
  "message": "ไฟล์นี้ถูก import แล้วเมื่อ 20 ม.ค. 2026 14:30:00",
  "details": {
    "existingBatchId": "uuid",
    "importedAt": "2026-01-20T07:30:00Z"
  }
}
```

**UI Behavior**:
- แสดง error message ชัดเจน
- ไม่ใช่ generic "Failed to create import batch"

### Test 3: Same file different reportDate
**Input**:
1. Import file A, reportDate=2026-01-20 → Success
2. Import file A, reportDate=2026-01-21 → **Expected: DUPLICATE_IMPORT error** (Option A)

**Note**: ตาม Option A, dedup ใช้ file_hash + report_type เท่านั้น (ignore reportDate)

### Test 4: Live file import
**Input**:
- File: live-ads.xlsx
- reportDate: 2026-01-20
- adsType: live

**Expected**:
1. Confirm → Success
2. DB: ad_daily_performance.campaign_type = 'live'

### Test 5: Wallet missing scenario
**Input**:
1. Delete ADS wallet (test only)
2. Try import

**Expected**:
```json
{
  "success": false,
  "code": "WALLET_NOT_FOUND",
  "message": "ไม่พบ TikTok Ads wallet - กรุณาสร้าง wallet ก่อนนำเข้าข้อมูล",
  "details": {
    "batchId": "uuid",
    "step": "wallet_lookup"
  }
}
```

### Test 6: Error display in UI
**Input**: Any error (DUPLICATE_IMPORT, WALLET_NOT_FOUND, etc.)

**Expected UI**:
- Alert with error code as title:
  - DUPLICATE_IMPORT → "❌ นำเข้าซ้ำ"
  - WALLET_NOT_FOUND → "⚠️ ไม่พบ Wallet"
  - VALIDATION_ERROR → "❌ ข้อมูลไม่ถูกต้อง"
- Error message displayed
- Debug details in collapsible section

---

## Files to Modify

### Backend
1. **`frontend/src/app/api/import/tiktok/ads-daily/route.ts`** (MAIN)
   - Fix dedup logic (lines 74-99)
   - Add structured logging
   - Add wallet safety check
   - Enhanced error handling

### Frontend
2. **`frontend/src/components/ads/ImportAdsDialog.tsx`**
   - Update error display (lines 566-571)
   - Add error code handling
   - Disable confirm button during import
   - Show progress indicator

---

## Implementation Order

1. ✅ Create checklist (this file)
2. 🔄 Fix backend dedup + logging (route.ts)
3. 🔄 Add wallet safety check
4. 🔄 Update frontend error display
5. 🔄 Run manual tests (Test 1-6)
6. 🔄 Update documentation

---

## Success Metrics

- [ ] All 6 test cases pass
- [ ] Error messages ชัดเจน (ไม่ generic)
- [ ] Console logs มี [CONFIRM] Step 1-6
- [ ] Duplicate import blocked (idempotent)
- [ ] Wallet missing ให้ error ชัดเจน
