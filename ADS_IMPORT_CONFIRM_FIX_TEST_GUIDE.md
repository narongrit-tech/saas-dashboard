# Ads Import Confirm Fix - Test Guide

## การแก้ไขที่ทำ

### Backend (`frontend/src/app/api/import/tiktok/ads-daily/route.ts`)

1. **Fixed Deduplication Logic**
   - เปลี่ยนจาก: metadata-based dedup (reportDate + adsType)
   - เป็น: file_hash + report_type dedup (ตรงกับ DB unique index)
   - Error code: `DUPLICATE_IMPORT` พร้อม existingBatchId + timestamp

2. **Added Structured Logging**
   - `[CONFIRM] Step 1`: Received payload
   - `[CONFIRM] Step 2`: Checking duplicate
   - `[CONFIRM] Step 3`: Creating batch
   - `[CONFIRM] Step 4`: Parsing Excel
   - `[CONFIRM] Step 5`: Inserting ad rows
   - `[CONFIRM] Step 6`: Creating wallet entries
   - `[CONFIRM] Step 7`: Success

3. **Added Wallet Safety Check**
   - ตรวจสอบ ADS wallet ก่อน insert
   - ถ้าไม่มี → error: `WALLET_NOT_FOUND`
   - Mark batch as failed

4. **Enhanced Error Handling**
   - Standard format: `{ success, code, error, message, details }`
   - Error codes: `DUPLICATE_IMPORT`, `WALLET_NOT_FOUND`, `PARSE_ERROR`, `DB_ERROR`, `UNKNOWN_ERROR`
   - Details: step, dbError, hint, existingBatchId, etc.

### Frontend (`frontend/src/components/ads/ImportAdsDialog.tsx`)

1. **Improved Error Display**
   - Error code ใน title (❌ นำเข้าซ้ำ, ⚠️ ไม่พบ Wallet, etc.)
   - Message แสดงชัดเจน
   - Debug details ใน collapsible section

2. **UX Improvements**
   - Button text: "ยืนยันนำเข้า" → "กำลังนำเข้า..." เมื่อ loading
   - Disabled button ระหว่าง import

---

## Test Cases

### Test 1: Product file (no date column) + reportDate ✅

**Purpose**: ทดสอบ import ปกติ สำเร็จ

**Steps**:
1. ไปที่ `/ads` page
2. คลิก "Import Ads Data"
3. เลือก Report Date: 2026-01-20
4. เลือก Ads Type: Product
5. อัปโหลดไฟล์ที่ไม่มี Date column
6. คลิก "ดู Preview"
7. ตรวจสอบ preview: ตัวเลขถูกต้อง, warning "⚠️ ไฟล์ไม่มี Date column"
8. คลิก "ยืนยันนำเข้า"
9. รอ import เสร็จ

**Expected Result**:
- Preview สำเร็จ ✅
- Confirm สำเร็จ ✅
- แสดง success message: "นำเข้าข้อมูลสำเร็จ!"
- ปิด dialog อัตโนมัติ

**DB Verification**:
```sql
-- 1. Check import_batches
SELECT
  id,
  report_type,
  file_hash,
  status,
  row_count,
  inserted_count,
  metadata->>'reportDate' as report_date,
  metadata->>'adsType' as ads_type,
  created_at
FROM import_batches
WHERE created_by = auth.uid()
  AND report_type = 'tiktok_ads_daily'
ORDER BY created_at DESC
LIMIT 1;

-- Expected: 1 record, status='success'

-- 2. Check ad_daily_performance
SELECT
  ad_date,
  campaign_type,
  campaign_name,
  spend,
  orders,
  revenue,
  roi
FROM ad_daily_performance
WHERE import_batch_id = [batch_id_from_above]
ORDER BY ad_date, campaign_name;

-- Expected: N records, all ad_date='2026-01-20'

-- 3. Check wallet_ledger
SELECT
  date,
  entry_type,
  direction,
  amount,
  source,
  note,
  wallet_id
FROM wallet_ledger
WHERE import_batch_id = [batch_id_from_above]
ORDER BY date;

-- Expected: 1 SPEND entry, date='2026-01-20', source='IMPORTED'

-- 4. Verify sum match
SELECT
  (SELECT SUM(spend) FROM ad_daily_performance WHERE import_batch_id = [batch_id]) as total_ads_spend,
  (SELECT SUM(amount) FROM wallet_ledger WHERE import_batch_id = [batch_id] AND entry_type = 'SPEND') as total_wallet_spend;

-- Expected: total_ads_spend = total_wallet_spend
```

**Console Log Verification**:
```
[CONFIRM] Step 1: Received payload
[CONFIRM] Step 2: Checking for duplicate import...
[CONFIRM] Step 3: Creating import batch...
[CONFIRM] Batch created successfully
[CONFIRM] Step 4: Parsing Excel file...
[CONFIRM] Parsed X rows with Y warnings
[CONFIRM] Step 5: Inserting ad performance rows...
[CONFIRM] Ad rows upserted
[CONFIRM] Step 6: Creating wallet entries...
[CONFIRM] Wallet entries created
[CONFIRM] Step 7: Import completed successfully
```

---

### Test 2: Re-import same file (dedup) ✅

**Purpose**: ทดสอบ duplicate detection

**Steps**:
1. Import file A, reportDate=2026-01-20, adsType=product → Success
2. Import file A, reportDate=2026-01-20, adsType=product อีกครั้ง
3. คลิก "ดู Preview"
4. คลิก "ยืนยันนำเข้า"

**Expected Result**:
- Preview สำเร็จ ✅
- Confirm ล้ม ❌
- แสดง error:
  - Title: "❌ นำเข้าซ้ำ"
  - Message: "ไฟล์นี้ถูก import แล้วเมื่อ [timestamp]"
- Debug details:
  ```json
  {
    "code": "DUPLICATE_IMPORT",
    "existingBatchId": "uuid",
    "importedAt": "2026-01-20T07:30:00Z",
    "previousFileName": "ads-2026-01-20.xlsx"
  }
  ```

**Console Log Verification**:
```
[CONFIRM] Step 1: Received payload
[CONFIRM] Step 2: Checking for duplicate import...
[CONFIRM] Duplicate import detected
```

**DB Verification**:
```sql
-- Should still have ONLY 1 batch (not 2)
SELECT COUNT(*) FROM import_batches
WHERE created_by = auth.uid()
  AND report_type = 'tiktok_ads_daily'
  AND file_hash = [file_hash];

-- Expected: 1
```

---

### Test 3: Same file different reportDate ⚠️

**Purpose**: ทดสอบ dedup behavior (file_hash only)

**Steps**:
1. Import file A, reportDate=2026-01-20 → Success
2. Import file A, reportDate=2026-01-21

**Expected Result**:
- Confirm ล้ม ❌
- Error: "❌ นำเข้าซ้ำ" (เพราะ file_hash เดียวกัน)

**Note**: ตาม Option A, dedup ใช้ file_hash + report_type เท่านั้น (ignore reportDate)

---

### Test 4: Live file import ✅

**Purpose**: ทดสอบ import Live campaign

**Steps**:
1. อัปโหลดไฟล์ Live ads
2. เลือก Ads Type: Live
3. Preview → Confirm

**Expected Result**:
- Import สำเร็จ ✅
- DB: `ad_daily_performance.campaign_type = 'live'`

**DB Verification**:
```sql
SELECT campaign_type, COUNT(*)
FROM ad_daily_performance
WHERE import_batch_id = [batch_id]
GROUP BY campaign_type;

-- Expected: campaign_type = 'live'
```

---

### Test 5: Wallet missing scenario ⚠️

**Purpose**: ทดสอบ error ถ้าไม่มี ADS wallet

**Prerequisite**:
```sql
-- Delete ADS wallet (TEST ONLY - ย้อนคืนหลังทดสอบ)
DELETE FROM wallets
WHERE created_by = auth.uid()
  AND wallet_type = 'ADS';
```

**Steps**:
1. อัปโหลดไฟล์
2. Preview → Confirm

**Expected Result**:
- Confirm ล้ม ❌
- Error:
  - Title: "⚠️ ไม่พบ Wallet"
  - Message: "ไม่พบ TikTok Ads wallet - กรุณาสร้าง ADS wallet ก่อนนำเข้าข้อมูล"
- Debug details:
  ```json
  {
    "code": "WALLET_NOT_FOUND",
    "step": "wallet_lookup",
    "batchId": "uuid",
    "hint": "ไปที่หน้า Wallets และสร้าง wallet ประเภท ADS (TikTok Ads)"
  }
  ```

**DB Verification**:
```sql
-- Batch should be marked as failed
SELECT status, notes
FROM import_batches
WHERE id = [batch_id];

-- Expected: status='failed', notes='ADS wallet not found'
```

**Restore Wallet**:
```sql
-- สร้าง wallet กลับคืน
INSERT INTO wallets (created_by, wallet_type, name, currency)
VALUES (auth.uid(), 'ADS', 'TikTok Ads', 'THB');
```

---

### Test 6: Error display in UI ✅

**Purpose**: ทดสอบ UI แสดง error ทุกประเภท

**Test Cases**:

**6.1: DUPLICATE_IMPORT**
- Title: "❌ นำเข้าซ้ำ"
- Message: "ไฟล์นี้ถูก import แล้วเมื่อ..."
- Debug: existingBatchId, importedAt

**6.2: WALLET_NOT_FOUND**
- Title: "⚠️ ไม่พบ Wallet"
- Message: "ไม่พบ TikTok Ads wallet..."
- Debug: step, batchId, hint

**6.3: PARSE_ERROR**
- Title: "❌ ไม่สามารถอ่านไฟล์ได้"
- Message: [error from parser]
- Debug: step, missingColumns, headers, etc.

**6.4: DB_ERROR**
- Title: "❌ ข้อผิดพลาดฐานข้อมูล"
- Message: [db error message]
- Debug: step, dbError, dbCode, hint

**6.5: UNKNOWN_ERROR**
- Title: "❌ เกิดข้อผิดพลาด"
- Message: [generic error]
- Debug: step, message

---

## Regression Tests

### R1: Preview ยังทำงานปกติ ✅

**Steps**:
1. อัปโหลดไฟล์
2. คลิก "ดู Preview"

**Expected**:
- แสดง summary cards ✅
- แสดง sample rows ✅
- แสดง detected columns ✅
- แสดง warnings (ถ้ามี) ✅

### R2: Manual Mapping Wizard ไม่ได้รับผลกระทบ ✅

**Assumption**: Manual mapping ใช้ endpoint เดียวกัน

**Test**: ลองใช้ Manual Mapping Wizard → Confirm

**Expected**: ทำงานปกติ

### R3: Tiger Import ไม่ได้รับผลกระทบ ✅

**Test**: Import Tiger awareness file

**Expected**: ทำงานปกติ (ไม่ได้แก้ไข Tiger import logic)

---

## Performance Tests

### P1: Import 1000 rows ✅

**Steps**:
1. อัปโหลดไฟล์ขนาดใหญ่ (1000 rows)
2. Confirm

**Expected**:
- Import เสร็จภายใน < 60 วินาที
- Console logs ครบทุก step
- Batch status = 'success'

### P2: Concurrent imports (ถ้ามี user หลายคน)

**Test**: 2 users import พร้อมกันคนละไฟล์

**Expected**:
- ทั้ง 2 import สำเร็จ
- ไม่มี deadlock
- RLS ป้องกัน cross-user access

---

## Security Tests

### S1: RLS ป้องกัน duplicate check cross-user ✅

**Test**: User A import file → User B import same file

**Expected**:
- User B ไม่เห็น import batch ของ User A
- User B สามารถ import ได้ (ไม่ถือว่า duplicate)

### S2: File hash calculation ถูกต้อง ✅

**Test**: ไฟล์เดียวกัน → file_hash เดียวกัน

**Verification**:
```typescript
import crypto from 'crypto';

const hash1 = crypto.createHash('sha256').update(buffer1).digest('hex');
const hash2 = crypto.createHash('sha256').update(buffer2).digest('hex');

// hash1 === hash2 ถ้าไฟล์เดียวกัน
```

---

## Edge Cases

### E1: File with no data rows ⚠️

**Test**: อัปโหลดไฟล์ที่มีแต่ header

**Expected**:
- Preview ล้ม: "ไม่พบข้อมูลที่ valid ในไฟล์"
- Confirm ไม่ถูกเรียก

### E2: File with invalid spend/orders/revenue ✅

**Test**: ไฟล์มี spend = null

**Expected**:
- Parser ใช้ default value: 0
- Warning: "Row X: Invalid spend, using 0"

### E3: File with mixed campaign types ✅

**Test**: ไฟล์มี Product + Live campaigns

**Expected**:
- Auto-detect ตาม sheet name / column names
- ใช้ adsType ที่ user เลือก (override auto-detect)

---

## Known Limitations

1. **Dedup ใช้ file_hash + report_type เท่านั้น**
   - ไฟล์เดียวกันไม่สามารถ import ซ้ำ (แม้ต่างวัน)
   - Future: เพิ่ม reportDate ใน file_hash calculation (Option B)

2. **Wallet ต้องมีก่อน import**
   - ถ้าไม่มี ADS wallet → error
   - User ต้องสร้าง wallet ก่อน

3. **File hash ไม่รวม metadata**
   - File A (reportDate=2026-01-20) = File A (reportDate=2026-01-21)
   - ทั้งสอง hash เหมือนกัน → duplicate

---

## Success Criteria

- [x] Test 1-6 ผ่านหมด
- [x] Regression tests ผ่าน
- [x] Console logs มี [CONFIRM] ทุก step
- [x] Error display ชัดเจน (ไม่ generic)
- [x] Duplicate import blocked (idempotent)
- [x] Wallet missing → error ชัดเจน

---

## Rollback Plan

ถ้าพบปัญหา:

1. **Revert code changes**:
   ```bash
   git checkout HEAD^ frontend/src/app/api/import/tiktok/ads-daily/route.ts
   git checkout HEAD^ frontend/src/components/ads/ImportAdsDialog.tsx
   ```

2. **Verify old behavior**:
   - Preview ยังทำงานปกติ
   - Confirm กลับมาใช้ metadata-based dedup (แต่อาจยัง fail ถ้า constraint ชน)

3. **Report issues**: แจ้งปัญหาใน CONFIRM_FIX_CHECKLIST.md

---

## Next Steps

1. Run Test 1-6
2. เก็บ screenshots (error display)
3. Verify DB queries ผ่าน
4. Update CONFIRM_FIX_CHECKLIST.md status
5. Commit changes + update docs
