# Testing Guide: Affiliate UX Enhancements

## Test File
- **Location:** `D:\TikTok Affiliate จ่ายค่าคอมมิชชั่น TH\creator_order_all_20260101000000_20260130235959_13496739.xlsx`
- **Format:** TikTok Affiliate Report (Thailand)

## Expected Columns (Thai)
- `หมายเลขคำสั่งซื้อ` → order_id
- `ชื่อผู้ใช้ของครีเอเตอร์` → affiliate_channel_id
- `SKU ของผู้ขาย` → seller_sku
- `ปริมาณ` → qty
- `การจ่ายค่าคอมมิชชั่นมาตรฐานโดยประมาณ` → commission_amt_organic
- `การจ่ายค่าคอมมิชชั่นโฆษณาร้านค้าโดยประมาณ` → commission_amt_shop_ad

## Manual Testing Steps

### Part 1: Initial Import (Auto-Map Test)
1. **Navigate to Sales Orders**
   - Go to `/sales`
   - Click "Attach Affiliate" button (Link icon)

2. **Upload File**
   - Select `creator_order_all_20260101000000_20260130235959_13496739.xlsx`
   - Click "Parse File"

3. **Verify Auto-Mapping**
   - ✅ Check "Auto-mapped (TikTok Affiliate TH)" badge shows
   - ✅ Preview shows:
     - Total rows count
     - Matched orders count
     - Orphan orders count (orders not in sales_orders yet)
     - Distinct orders count
     - Total commission (organic + shop_ad)
     - Channel count
   - ✅ Sample rows show correct data

4. **Confirm Import**
   - Click "Confirm Import"
   - Wait for success message
   - Close dialog

### Part 2: Verify Badges in Sales Orders
1. **Check Order View**
   - Switch to "Order View" (group by order)
   - Find imported orders
   - ✅ Verify "Source / Affiliate" column shows:
     - 🟣 Affiliate (Organic) - if only organic commission
     - 🔵 Affiliate (Shop Ad) - if only shop_ad commission
     - 🟪 Affiliate (Mixed) - if both commissions exist
     - Commission amount shows below badge: "Comm: ฿X,XXX"

2. **Check Line View**
   - Switch to "Line View" (by product)
   - ✅ Same badges should appear per line item
   - ✅ Commission total is sum of all lines for that order

### Part 3: Re-Import (Mapping Persistence Test)
1. **Re-upload Same File**
   - Click "Attach Affiliate" again
   - Upload same file

2. **Verify Instant Mapping**
   - ✅ Auto-mapped badge should show IMMEDIATELY
   - ✅ No need to manually map columns
   - ✅ Preview shows same data structure

3. **Verify Deduplication**
   - Click "Confirm Import"
   - ✅ System should UPDATE existing records (not duplicate)
   - ✅ import_batches table should show new batch with 0 inserted, N updated

### Part 4: Mixed Attribution Types
1. **Test Internal Affiliate**
   - Manually create order_attribution with `attribution_type = 'internal_affiliate'`
   - ✅ Badge shows: 🟠 Owned Channel

2. **Test Paid Ads**
   - Set `attribution_type = 'paid_ads'`
   - ✅ Badge shows: 🔵 Paid Ads

3. **Test Organic**
   - Set `attribution_type = 'organic'`
   - ✅ Badge shows: 🟢 Organic

4. **Test No Attribution**
   - Order without order_attribution record
   - ✅ Badge shows: ⚪ No Affiliate

### Part 5: Commission Calculations
1. **Organic Only**
   - `commission_amt_organic = 100`, `commission_amt_shop_ad = 0`
   - ✅ Badge: 🟣 Affiliate (Organic)
   - ✅ Commission: ฿100

2. **Shop Ad Only**
   - `commission_amt_organic = 0`, `commission_amt_shop_ad = 200`
   - ✅ Badge: 🔵 Affiliate (Shop Ad)
   - ✅ Commission: ฿200

3. **Mixed**
   - `commission_amt_organic = 100`, `commission_amt_shop_ad = 200`
   - ✅ Badge: 🟪 Affiliate (Mixed)
   - ✅ Commission: ฿300 (total)

### Part 6: Line-Level Import
1. **Upload File with Multiple Lines per Order**
   - Same order_id appears 3 times (3 SKUs)
   - Each line has different commission amounts

2. **Verify Aggregation**
   - ✅ System aggregates by order_id
   - ✅ Commission_amt_organic = sum of all lines
   - ✅ Commission_amt_shop_ad = sum of all lines
   - ✅ Only ONE order_attribution record created per order

### Part 7: Orphan Handling
1. **Check Orphan Count**
   - In preview, note orphan count
   - ✅ Orphans are orders not found in sales_orders

2. **Verify No Creation**
   - After import, check sales_orders table
   - ✅ No new orders created for orphans
   - ✅ Only order_attribution records for matched orders

### Part 8: Performance
1. **Batch Fetching**
   - Load Sales Orders page with 100+ orders
   - Open DevTools → Network tab
   - ✅ Only ONE query to order_attribution (batch fetch)
   - ✅ No N+1 query problem

2. **Page Load Speed**
   - With 1000+ orders
   - ✅ Page loads < 2 seconds
   - ✅ Badges render without flicker

## Database Verification

### Check import_mappings
```sql
SELECT * FROM import_mappings
WHERE created_by = '<user_id>'
AND mapping_type = 'affiliate_import';
```
Expected: One record with JSONB mapping

### Check order_attribution
```sql
SELECT
  order_id,
  attribution_type,
  affiliate_channel_id,
  commission_amt_organic,
  commission_amt_shop_ad,
  commission_type
FROM order_attribution
WHERE created_by = '<user_id>'
LIMIT 10;
```
Expected: Records with correct commission split

### Check import_batches
```sql
SELECT
  file_name,
  status,
  total_rows,
  success_count,
  orphan_count,
  created_at
FROM import_batches
WHERE created_by = '<user_id>'
AND batch_type = 'affiliate_attributions'
ORDER BY created_at DESC
LIMIT 5;
```
Expected: Import history with counts

## Edge Cases

### Case 1: BOM in CSV
- File starts with UTF-8 BOM (`\uFEFF`)
- ✅ System removes BOM before matching headers

### Case 2: Extra Whitespace
- Column header: `"  หมายเลขคำสั่งซื้อ  "`
- ✅ System trims and normalizes before matching

### Case 3: Missing Columns
- File missing `commission_amt_shop_ad` column
- ✅ System sets shop_ad to 0, proceeds with organic only

### Case 4: Header Not in Row 1
- Header is in row 3 (first 2 rows are metadata)
- ✅ Auto-detect scans first 10 rows, finds header

### Case 5: Duplicate Order IDs
- Same order_id appears 5 times in file
- ✅ System aggregates, creates ONE attribution record
- ✅ Commission totals are summed

## Success Criteria

- ✅ TikTok TH preset auto-maps on first import
- ✅ Mapping persists in database (not localStorage)
- ✅ Re-import uses saved mapping instantly
- ✅ Badges show correctly (5 types)
- ✅ Commission amounts accurate (organic + shop_ad)
- ✅ No N+1 queries (batch fetch works)
- ✅ Line-level import aggregates correctly
- ✅ Orphans logged but not created
- ✅ RLS enforced (user sees only their data)
- ✅ Deduplication works (no duplicates in order_attribution)

## Rollback Plan
If issues found:
1. Revert migration: `DROP TABLE import_mappings; ALTER TABLE order_attribution DROP COLUMN commission_amt_organic, commission_amt_shop_ad, commission_type;`
2. Restore old affiliate-import-actions.ts
3. Move AffiliateImportDialog back to reports/profit/

## Notes
- **Bangkok timezone:** All dates use Asia/Bangkok
- **RLS:** All queries filtered by `created_by = auth.uid()`
- **Performance:** Batch fetch prevents N+1, summary tables for fast reporting
