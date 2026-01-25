# Cashflow Fix - Complete Test Plan

## Objective
Fix Cashflow to be "accurate + fast + not tied to auth.uid()" with daily forecast/actual display.

## Fixes Applied

### A) ROOT CAUSE FIX - Auth UID Dependency Removed
- ✅ Disabled RLS on cashflow tables (internal dashboard - single tenant)
- ✅ Removed `created_by = auth.uid()` filters from all queries
- ✅ Service role imports now visible to all authenticated users

### B) FORECAST DATE FIX - 0% NULL estimated_settle_time
- ✅ Parser fallback chain: Direct date → "Delivered + N days" → created_at + 7 days
- ✅ Backfill migration for existing NULL rows

### C) AUTO REBUILD SUMMARY
- ✅ Income import → auto rebuild summary for date range
- ✅ Onhold import → auto rebuild summary for date range
- ✅ Log: "[Cashflow] Summary rebuilt after import"

### D) UX - Daily Summary + Date Picker
- ✅ Daily Cash In Summary table (PRIMARY view)
- ✅ SingleDateRangePicker (one button, 2-month calendar)
- ✅ Lazy load transactions (only when tab clicked)

### E) UPLOAD SAME FILE
- ✅ Checkbox: "Allow re-upload same file (testing mode)"
- ✅ Clear input after success/failure

### F) PERFORMANCE
- ✅ Pre-aggregated table: cashflow_daily_summary
- ✅ Indexes: marketplace + date (no created_by)
- ✅ Bulk reconciliation: 3 queries (not 401)

---

## STEP-BY-STEP TESTING

### STEP 0: Run Migration

```bash
# Connect to Supabase SQL Editor
# Copy/paste migration-011-cashflow-remove-auth-dependency.sql
# Execute entire migration

# Expected output:
# - NOTICE: [Cashflow] Backfilled X rows with NULL estimated_settle_time
# - All statements executed successfully
```

**Verify RLS Disabled:**
```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('settlement_transactions', 'unsettled_transactions', 'cashflow_daily_summary');

-- Expected:
-- tablename                    | rowsecurity
-- -----------------------------|-------------
-- settlement_transactions      | false
-- unsettled_transactions       | false
-- cashflow_daily_summary       | false
```

**Verify Indexes Created:**
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('settlement_transactions', 'unsettled_transactions', 'cashflow_daily_summary')
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- Expected: Multiple indexes including marketplace + date combinations
```

---

### STEP 1: Check NULL estimated_settle_time (Must be 0%)

```sql
SELECT
  COUNT(*) as total_rows,
  COUNT(CASE WHEN estimated_settle_time IS NULL THEN 1 END) as null_count,
  ROUND(
    100.0 * COUNT(CASE WHEN estimated_settle_time IS NULL THEN 1 END) / NULLIF(COUNT(*), 0),
    2
  ) as null_percentage
FROM unsettled_transactions
WHERE marketplace = 'tiktok';

-- Expected:
-- total_rows | null_count | null_percentage
-- -----------|------------|----------------
--       253  |          0 |           0.00  ✅
```

---

### STEP 2: Import TikTok Onhold (Forecast)

**Actions:**
1. Go to `/cashflow` page
2. Click "Import Forecast" button
3. Select TikTok Onhold Excel file
4. Optional: Check "Allow re-upload same file (testing mode)" for testing
5. Click "นำเข้าข้อมูล"

**Expected Console Logs:**
```
[Onhold API] File name: onhold_report_2026-01.xlsx
[Onhold API] File size: 45123 bytes
[Onhold Import] Total rows parsed: 226
[Onhold Parser] estimated_settle_time NULL count: 0 (0.0%)  ✅
[Onhold Import] Upserting 226 rows...
[Onhold Import] Results: inserted=180, updated=46, errors=0
[Onhold Import] Rebuilding summary for date range: 2026-01-15 to 2026-01-31
[Cashflow] Summary rebuilt after import  ✅
```

**Expected UI:**
- Success message: "นำเข้าข้อมูลสำเร็จ!"
- Shows: ทั้งหมด 226 รายการ
- Daily summary table auto-refreshes (no page reload needed)

**Verify Database:**
```sql
-- Check unsettled_transactions count
SELECT COUNT(*) FROM unsettled_transactions WHERE marketplace = 'tiktok';
-- Expected: 226 (or more if already had data)

-- Check NULL estimated_settle_time (MUST be 0)
SELECT COUNT(*)
FROM unsettled_transactions
WHERE marketplace = 'tiktok' AND estimated_settle_time IS NULL;
-- Expected: 0  ✅

-- Check daily summary was rebuilt
SELECT date, forecast_sum, forecast_count
FROM cashflow_daily_summary
WHERE date >= '2026-01-15' AND date <= '2026-01-31'
ORDER BY date;
-- Expected: Multiple rows with forecast_sum > 0
```

---

### STEP 3: Import TikTok Income (Actual)

**Actions:**
1. Stay on `/cashflow` page
2. Click "Import Actual" button
3. Select TikTok Income/Settlement Excel file
4. Click "นำเข้าข้อมูล"

**Expected Console Logs:**
```
[Income API] File name: income_report_2026-01.xlsx
[Income API] File size: 89456 bytes
[Income Import] Total rows parsed: 198
[Income Import] Upserting 198 rows...
[Income Import] Results: inserted=150, updated=48, errors=0
[Income Import] Starting reconciliation...
[Reconcile] Processing 198 settlements (BULK mode)
[Reconcile] Found 180 matching unsettled records
[Reconcile] 175 records to reconcile
[Reconcile] Successfully reconciled 175 records  ✅
[Reconcile] Not found in forecast: 23
[Income Import] Rebuilding summary for date range: 2026-01-15 to 2026-01-31
[Cashflow] Summary rebuilt after import  ✅
```

**Expected UI:**
- Success message with reconciliation summary
- จับคู่กับ Forecast สำเร็จ: 175 รายการ
- ไม่พบใน Forecast: 23 รายการ
- Daily summary table shows actual_sum > 0

**Verify Database:**
```sql
-- Check settlement_transactions count
SELECT COUNT(*) FROM settlement_transactions WHERE marketplace = 'tiktok';
-- Expected: 198 (or more)

-- Check reconciliation (status='settled')
SELECT COUNT(*)
FROM unsettled_transactions
WHERE marketplace = 'tiktok' AND status = 'settled';
-- Expected: 175 (matched with actual settlements)

-- Check daily summary (both forecast AND actual)
SELECT date, forecast_sum, actual_sum, gap_sum
FROM cashflow_daily_summary
WHERE date >= '2026-01-15' AND date <= '2026-01-31'
ORDER BY date;
-- Expected: Multiple rows with BOTH forecast_sum AND actual_sum > 0
```

---

### STEP 4: Verify Daily Summary Table (UX)

**Actions:**
1. Stay on `/cashflow` page
2. Scroll to "Daily Cash In Summary (Forecast vs Actual)" section

**Expected:**
- Table with columns: Date, Forecast, Actual, Gap, Status
- Multiple rows (14 per page by default)
- Status badges:
  - 🟢 Green (actual > forecast): "actual_over"
  - 🟡 Yellow (forecast > actual > 0): "pending"
  - 🔵 Blue (actual > 0, forecast = 0): "actual_only"
  - ⚪ Gray (forecast only): "forecast_only"
- Pagination working (if > 14 days)

**Page Load Performance:**
```
Check Network tab → /cashflow page load
Expected: < 500ms TTFB (Time To First Byte)

Check Console → [Daily Summary Table] log
Expected: "Loaded X rows in <100ms"
```

---

### STEP 5: Test Date Range Picker

**Actions:**
1. Click date range button at top (shows current range)
2. Calendar opens with 2 months visible
3. Select new start date
4. Select new end date
5. Calendar auto-closes and page refreshes

**Expected:**
- Single button (not 2 separate inputs) ✅
- 2-month calendar in single popover ✅
- Quick presets: Today / Last 7 Days / Last 30 Days / MTD / Last Month ✅
- Auto-apply on range selection ✅
- Debounced: 300ms delay before query ✅

**Verify Query:**
```
Check Network tab → API calls after date change
Expected: Only 2 API calls:
  1. getCashflowSummary (summary cards)
  2. getDailyCashflowSummary (daily table)

NO transaction list calls (lazy loaded) ✅
```

---

### STEP 6: Test Lazy Loading (Transactions)

**Actions:**
1. Scroll down to "Raw Transactions" section
2. Click "Forecast" tab

**Expected:**
- First click: Network call to fetch forecast transactions
- Shows paginated list (50 per page)
- Each row: txn_id, date, amount, status, marketplace

**Repeat for other tabs:**
- "Actual" tab
- "Exceptions" tab

**Expected:**
- Each tab triggers ONE API call on first click ✅
- No API calls on initial page load (before tab click) ✅

---

### STEP 7: Test Re-Upload Same File

**Actions:**
1. Click "Import Forecast" button
2. Check "Allow re-upload same file (testing mode)"
3. Select SAME Excel file used in STEP 2
4. Click "นำเข้าข้อมูล"

**Expected:**
- No "Duplicate file" error ✅
- Import succeeds
- Console log: `[Onhold API] Duplicate check skipped (testing mode)` ✅
- File input clears after 2 seconds ✅
- Can immediately select same file again ✅

**Without checkbox:**
- Uncheck "Allow re-upload same file"
- Upload same file again

**Expected:**
- Error: "Duplicate file - This file has already been imported successfully on [date]" ✅

---

### STEP 8: Verify Service Role Import Visibility

**Setup:**
1. Use Supabase SQL Editor to insert data with service role

```sql
-- Insert test unsettled transaction (service role - no created_by)
INSERT INTO unsettled_transactions (
  marketplace,
  txn_id,
  type,
  estimated_settle_time,
  estimated_settlement_amount,
  currency,
  status
) VALUES (
  'tiktok',
  'TEST-SERVICE-ROLE-001',
  'sale',
  '2026-01-28 00:00:00+07'::timestamptz,
  1000.00,
  'THB',
  'unsettled'
);

-- Rebuild summary to include new row
SELECT rebuild_cashflow_daily_summary(
  (SELECT id FROM auth.users LIMIT 1),
  '2026-01-28'::date,
  '2026-01-28'::date
);
```

**Expected:**
- Insert succeeds (no RLS blocking service role) ✅
- Rebuild succeeds ✅

**Verify UI:**
1. Go to `/cashflow` page
2. Check date range includes 2026-01-28
3. Look at daily summary table

**Expected:**
- 2026-01-28 shows forecast_sum = 1000.00 ✅
- Service role data VISIBLE to authenticated users ✅

**Cleanup:**
```sql
DELETE FROM unsettled_transactions WHERE txn_id = 'TEST-SERVICE-ROLE-001';
```

---

### STEP 9: Performance Benchmark

**Measure Page Load:**
```javascript
// Open Chrome DevTools → Performance tab
// Record → Reload page → Stop

Expected metrics:
- LCP (Largest Contentful Paint): < 1.5s
- FCP (First Contentful Paint): < 0.8s
- TTI (Time To Interactive): < 2.0s
- Daily summary query: < 100ms (check [Daily Summary Table] log)
```

**Measure Import Speed:**
```
Onhold import (226 rows):
  Expected: < 5 seconds

Income import (198 rows):
  Expected: < 8 seconds (includes reconciliation + rebuild)

Reconciliation (198 settlements):
  Expected: < 3 seconds (bulk operations - 3 queries)
  Check log: [Reconcile] Successfully reconciled X records
```

---

## SQL DEBUG SNIPPETS

Copy these into `docs/CASHFLOW_DEBUG.sql` or similar:

```sql
-- ============================================
-- CASHFLOW DEBUG QUERIES
-- ============================================

-- 1. Check unsettled (forecast) count
SELECT COUNT(*) as forecast_count
FROM unsettled_transactions
WHERE marketplace = 'tiktok';

-- 2. Check settlement (actual) count
SELECT COUNT(*) as actual_count
FROM settlement_transactions
WHERE marketplace = 'tiktok';

-- 3. Check NULL estimated_settle_time (MUST BE 0)
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN estimated_settle_time IS NULL THEN 1 END) as null_count
FROM unsettled_transactions
WHERE marketplace = 'tiktok';

-- 4. Check reconciliation status
SELECT
  status,
  COUNT(*) as count
FROM unsettled_transactions
WHERE marketplace = 'tiktok'
GROUP BY status;
-- Expected: settled = X, unsettled = Y

-- 5. Check daily summary rows
SELECT COUNT(*) as summary_rows
FROM cashflow_daily_summary;

-- 6. View daily summary for date range
SELECT
  date,
  forecast_sum,
  forecast_count,
  actual_sum,
  actual_count,
  gap_sum,
  matched_count,
  overdue_count
FROM cashflow_daily_summary
WHERE date >= '2026-01-01' AND date <= '2026-01-31'
ORDER BY date;

-- 7. Check RLS status (MUST BE false)
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('settlement_transactions', 'unsettled_transactions', 'cashflow_daily_summary');

-- 8. Check indexes
SELECT
  schemaname,
  tablename,
  indexname
FROM pg_indexes
WHERE tablename IN ('settlement_transactions', 'unsettled_transactions', 'cashflow_daily_summary')
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- 9. Manually rebuild summary
SELECT rebuild_cashflow_daily_summary(
  (SELECT id FROM auth.users LIMIT 1),
  '2026-01-01'::date,
  '2026-01-31'::date
);

-- 10. Check import batches
SELECT
  id,
  marketplace,
  report_type,
  file_name,
  status,
  row_count,
  inserted_count,
  updated_count,
  created_at
FROM import_batches
WHERE marketplace = 'tiktok'
ORDER BY created_at DESC
LIMIT 10;

-- 11. Verify timezone bucketing (UTC 17:00 → Thai date)
SELECT
  txn_id,
  settled_time AS utc_time,
  settled_time AT TIME ZONE 'Asia/Bangkok' AS bangkok_time,
  (settled_time AT TIME ZONE 'Asia/Bangkok')::date AS thai_date
FROM settlement_transactions
WHERE settled_time >= '2026-01-24 17:00:00+00'
  AND settled_time < '2026-01-25 17:00:00+00'
LIMIT 5;
-- Expected: thai_date = 2026-01-25 (NOT 2026-01-24)

-- 12. Find forecast without match (exceptions)
SELECT
  u.txn_id,
  u.estimated_settle_time,
  u.estimated_settlement_amount,
  u.status
FROM unsettled_transactions u
LEFT JOIN settlement_transactions s
  ON s.marketplace = u.marketplace
  AND s.txn_id = u.txn_id
WHERE u.marketplace = 'tiktok'
  AND u.status = 'unsettled'
  AND s.id IS NULL
ORDER BY u.estimated_settle_time DESC
LIMIT 20;

-- 13. Find actual without forecast
SELECT
  s.txn_id,
  s.settled_time,
  s.settlement_amount
FROM settlement_transactions s
LEFT JOIN unsettled_transactions u
  ON u.marketplace = s.marketplace
  AND u.txn_id = s.txn_id
WHERE s.marketplace = 'tiktok'
  AND u.id IS NULL
ORDER BY s.settled_time DESC
LIMIT 20;
```

---

## ACCEPTANCE CRITERIA (ALL MUST PASS)

### ✅ A) Auth Dependency Removed
- [ ] RLS disabled on all 3 cashflow tables
- [ ] Service role insert visible to all authenticated users
- [ ] No `created_by` filter in application queries

### ✅ B) Forecast Date Fixed
- [ ] 0% NULL estimated_settle_time
- [ ] Parser fallback chain works for "Delivered + N days"
- [ ] Existing NULL rows backfilled by migration

### ✅ C) Auto Rebuild
- [ ] Income import → auto rebuild → log present
- [ ] Onhold import → auto rebuild → log present
- [ ] Daily summary updates immediately (no manual rebuild)

### ✅ D) UX Complete
- [ ] Daily summary table shows multiple rows
- [ ] SingleDateRangePicker (one button, 2-month calendar)
- [ ] Lazy load transactions (no initial API calls)
- [ ] Page load < 500ms

### ✅ E) Re-Upload Works
- [ ] Checkbox present and functional
- [ ] Same file upload succeeds with checkbox
- [ ] Same file blocked without checkbox
- [ ] File input clears after success

### ✅ F) Performance
- [ ] Import onhold (226 rows): < 5 seconds
- [ ] Import income (198 rows): < 8 seconds
- [ ] Reconciliation: < 3 seconds (bulk operations)
- [ ] Page load: < 500ms TTFB

---

## ROLLBACK PLAN (if needed)

If critical issues found:

```sql
-- 1. Re-enable RLS
ALTER TABLE settlement_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE unsettled_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashflow_daily_summary ENABLE ROW LEVEL SECURITY;

-- 2. Recreate policies (use old migration-010 as reference)
-- (See migration-010-cashflow-performance.sql lines 80-96)

-- 3. Revert rebuild function (add created_by filter back)
-- (See migration-010-cashflow-performance.sql lines 102-193)
```

---

## NOTES

- All console logs use `[Cashflow]`, `[Income Import]`, `[Onhold Import]`, `[Reconcile]` prefixes for easy filtering
- Testing mode (re-upload) is intentional for development/QA - disable in production if needed
- RLS disabled is safe for internal dashboard (<5 users) - re-enable if multi-tenant needed
- Daily summary is cache - rebuild if data looks wrong
