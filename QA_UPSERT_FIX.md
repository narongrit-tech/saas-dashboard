# QA Checklist: Ad Daily Performance Upsert Fix

## ปัญหา
- Import confirm says: "updated 13 rows" (keptRows=13, totals non-zero)
- DB shows: spend=0, revenue=0, orders=0 for all 13 rows
- **Root Cause:** Supabase `.upsert()` ไม่ update numeric columns จริง

## การแก้ไข
1. **Replaced `.upsert()` with explicit UPDATE/INSERT**
   - Check if exists → UPDATE if found, INSERT if not
   - Force update ทุก numeric column (spend, orders, revenue, roi)
2. **Added debug logs**
   - แสดง existing status (Found/Not found)
   - แสดง values before upsert (types, amounts)
   - แสดง success/error for first 3 rows
3. **Use `.maybeSingle()` instead of `.single()`**
   - Prevent error if no match found

## Test Steps

### Pre-Test: Backup Current Data
```sql
-- Delete old data (clean slate)
DELETE FROM ad_daily_performance WHERE ad_date = '2026-01-16';
SELECT COUNT(*) FROM ad_daily_performance WHERE ad_date = '2026-01-16';
-- Expected: 0
```

### Test 1: Fresh Import (INSERT)
1. Go to `/ads`
2. Click "นำเข้าข้อมูล" button
3. Upload file: Product ads report (date=2026-01-16)
4. Parameters:
   - Report Date: 2026-01-16
   - Ads Type: Product
   - Skip Zero Rows: Yes
5. Preview → Check summary:
   - ✅ keptRows = 13
   - ✅ total_spend ≈ 80.83
   - ✅ total_revenue ≈ 5497.8
   - ✅ total_orders = 24
6. Confirm import
7. **Check console logs:**
   ```
   [UPSERT_DEBUG] Row 1: {
     adDate: '2026-01-16',
     campaign: '...',
     spend: 80.83,      // Must be > 0
     orders: 24,        // Must be > 0
     revenue: 5497.8,   // Must be > 0
     roi: 68.05,
     types: { spend: 'number', orders: 'number', revenue: 'number' },
     existing: 'Not found (will INSERT)'
   }
   [UPSERT_SUCCESS] Inserted row 1
   ```
8. **Check success toast:** "นำเข้าสำเร็จ 13 แถว"
9. **Verify DB:**
   ```sql
   SELECT COUNT(*), SUM(spend), SUM(revenue), SUM(orders)
   FROM ad_daily_performance
   WHERE ad_date = '2026-01-16';
   ```
   Expected: 13 rows, spend ≈ 80.83, revenue ≈ 5497.8, orders = 24

### Test 2: Re-Import Same File (UPDATE)
1. Import same file again (Product ads, date=2026-01-16)
2. Preview → Confirm
3. **Check console logs:**
   ```
   [UPSERT_DEBUG] Row 1: {
     existing: 'Found (id=...)'  // Must show existing ID
   }
   [UPSERT_SUCCESS] Updated row 1
   ```
4. **Check success toast:** "อัปเดต 13 แถว"
5. **Verify DB:** Values still correct (not reset to 0)
   ```sql
   SELECT campaign_name, spend, revenue, orders
   FROM ad_daily_performance
   WHERE ad_date = '2026-01-16'
   ORDER BY spend DESC
   LIMIT 5;
   ```
   Expected: All rows have non-zero values

### Test 3: Verify UI Display
1. Go to `/ads`
2. Select date: 2026-01-16
3. Select type: Product
4. **Verify summary cards:**
   - Total Spend ≈ 80.83 THB
   - Total Revenue ≈ 5,497.80 THB
   - Total Orders = 24
   - Avg ROI ≈ 68.05
5. **Verify table:**
   - Shows 13 rows
   - All rows have non-zero spend/revenue/orders
   - No rows with spend=0

### Test 4: Test UPDATE with Different Values
1. Manually edit DB row:
   ```sql
   UPDATE ad_daily_performance
   SET spend = 999.99, revenue = 12345.67, orders = 999
   WHERE ad_date = '2026-01-16'
   AND campaign_name = '...' -- pick any campaign
   LIMIT 1;
   ```
2. Re-import same file
3. Verify: Edited row reverted to original file values (not 999.99)

### Test 5: Edge Case - campaign_name = NULL
1. Check if any rows have campaign_name = NULL
2. If yes, verify they still match correctly on re-import
3. Verify: No duplicate rows created

## Success Criteria

✅ **Console logs show non-zero values before upsert**
✅ **First import: "Inserted 13 rows" (not "Updated")**
✅ **Re-import: "Updated 13 rows" (not "Inserted")**
✅ **DB query shows non-zero spend/revenue/orders**
✅ **UI /ads displays correct totals**
✅ **Re-import overwrites values correctly (not reset to 0)**
✅ **No duplicate rows created**
✅ **No errors in console**

## Rollback Plan
If fix fails:
1. Revert changes to `frontend/src/lib/importers/tiktok-ads-daily.ts`
2. Use git to restore previous version:
   ```bash
   git checkout HEAD -- frontend/src/lib/importers/tiktok-ads-daily.ts
   ```

## Files Changed
- ✅ `frontend/src/lib/importers/tiktok-ads-daily.ts`
  - Lines 1111-1171: Replaced `.upsert()` with explicit UPDATE/INSERT
  - Added debug logs for first 3 rows
  - Used `.maybeSingle()` instead of `.single()`
  - Explicit `updated_at` timestamp on UPDATE

## Manual Test Results

| Test | Status | Notes |
|------|--------|-------|
| Test 1: Fresh Import | ⬜ | |
| Test 2: Re-Import (UPDATE) | ⬜ | |
| Test 3: UI Display | ⬜ | |
| Test 4: UPDATE Overwrites | ⬜ | |
| Test 5: NULL campaign_name | ⬜ | |

---

## Next Steps After Fix Verified
1. Remove debug logs (or keep if helpful)
2. Apply same fix to other import modules if they use `.upsert()`
3. Document pattern in project guidelines
