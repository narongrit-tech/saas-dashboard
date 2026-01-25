# Test Plan: Cashflow Timezone Fix

## Test Case 1: Basic Date Display

**Setup:**
1. Import income data with `settled_time = '2026-01-24 17:00:00+00'` (UTC)
   - This equals: 2026-01-25 00:00:00 Bangkok time
2. Rebuild summary for January 2026

**Test Steps:**
1. ไปหน้า Cashflow
2. เลือก date range: 25 ม.ค. 2569 – 25 ม.ค. 2569
3. ดูตาราง "Daily Cash In Summary"

**Expected Result:**
- ✅ แสดงวันที่ **25 ม.ค. 2569** (ไม่ใช่ 24)
- ✅ ยอด Actual ถูกต้องตามข้อมูลที่ import
- ✅ ยอด Forecast (ถ้ามี) ถูกต้องตามข้อมูลที่ import

**Actual Result:**
- [ ] Date: _____________
- [ ] Actual: _____________
- [ ] Forecast: _____________

---

## Test Case 2: Date Range Filter

**Setup:**
1. มีข้อมูลหลายวัน (23-27 ม.ค. 2569)

**Test Steps:**
1. เลือก date range: 24 ม.ค. – 26 ม.ค. 2569
2. ดูตารางว่าแสดงกี่วัน

**Expected Result:**
- ✅ แสดง 3 วัน: 24, 25, 26 ม.ค.
- ✅ ไม่แสดง 23 และ 27 ม.ค.
- ✅ ยอดเงินแต่ละวันถูกต้อง

**Actual Result:**
- [ ] Days shown: _____________
- [ ] Dates: _____________

---

## Test Case 3: UTC Midnight vs Bangkok Midnight

**Setup:**
1. Import data with exact times:
   - A: `settled_time = '2026-01-24 16:59:59+00'` → Bangkok: 2026-01-24 23:59:59
   - B: `settled_time = '2026-01-24 17:00:00+00'` → Bangkok: 2026-01-25 00:00:00

**Test Steps:**
1. Rebuild summary
2. เลือกวันที่ 24 ม.ค. 2569
3. ตรวจสอบว่ายอด Actual แสดงเฉพาะ Transaction A (ไม่รวม B)
4. เลือกวันที่ 25 ม.ค. 2569
5. ตรวจสอบว่ายอด Actual แสดง Transaction B (ไม่รวม A)

**Expected Result:**
- ✅ วันที่ 24: แสดงเฉพาะ A
- ✅ วันที่ 25: แสดงเฉพาะ B
- ✅ Timezone boundary ตัด 00:00 Bangkok (ไม่ใช่ 00:00 UTC)

**Actual Result:**
- [ ] Jan 24 amount: _____________
- [ ] Jan 25 amount: _____________

---

## Test Case 4: Summary Cards

**Setup:**
1. มีข้อมูล Forecast และ Actual ในช่วง 20-30 ม.ค.

**Test Steps:**
1. เลือก date range: 20 ม.ค. – 30 ม.ค. 2569
2. ดู Summary Cards (Forecast Total, Actual Total, Gap)

**Expected Result:**
- ✅ Forecast Total = ยอดรวมของ unsettled_transactions ในช่วงวันที่ (Bangkok date)
- ✅ Actual Total = ยอดรวมของ settlement_transactions ในช่วงวันที่ (Bangkok date)
- ✅ Gap = Actual - Forecast
- ✅ ยอดตรงกับตาราง Daily Summary (รวมทุกวัน)

**Actual Result:**
- [ ] Forecast Total: _____________
- [ ] Actual Total: _____________
- [ ] Gap: _____________
- [ ] Match with table sum: _____________

---

## Test Case 5: Tab Switching (Forecast/Actual)

**Setup:**
1. เลือก date range: 24-26 ม.ค. 2569

**Test Steps:**
1. คลิก Tab "Forecast"
2. ตรวจสอบว่าแสดง transactions ที่ estimated_settle_time อยู่ในช่วง 24-26 (Bangkok date)
3. คลิก Tab "Actual"
4. ตรวจสอบว่าแสดง transactions ที่ settled_time อยู่ในช่วง 24-26 (Bangkok date)

**Expected Result:**
- ✅ Forecast tab แสดงเฉพาะ transactions ที่ estimated_settle_time (Bangkok) อยู่ในช่วง
- ✅ Actual tab แสดงเฉพาะ transactions ที่ settled_time (Bangkok) อยู่ในช่วง
- ✅ Date time display ถูกต้อง (แสดงเป็นเวลาไทย)

**Actual Result:**
- [ ] Forecast count: _____________
- [ ] Actual count: _____________
- [ ] Dates correct: _____________

---

## Test Case 6: Page Refresh

**Setup:**
1. เลือก date range: 25 ม.ค. 2569
2. Refresh page (F5)

**Test Steps:**
1. ตรวจสอบว่า date range ยังคงเป็น 25 ม.ค. (ถ้า persist ไว้)
2. ตรวจสอบว่าตารางแสดงวันที่ถูกต้อง

**Expected Result:**
- ✅ Date range persist (optional, ขึ้นอยู่กับ implementation)
- ✅ ตารางแสดงวันที่ 25 ม.ค. ไม่เปลี่ยนเป็น 24

**Actual Result:**
- [ ] Date after refresh: _____________
- [ ] Table date: _____________

---

## Test Case 7: Rebuild Command (SQL)

**Test Steps:**
1. เปิด Supabase SQL Editor
2. Run:
   ```sql
   SELECT id, email FROM auth.users;
   ```
3. Copy UUID
4. Run:
   ```sql
   SELECT rebuild_cashflow_daily_summary(
     'YOUR_UUID'::UUID,
     '2026-01-01'::date,
     '2026-01-31'::date
   );
   ```

**Expected Result:**
- ✅ Function returns จำนวนแถวที่ rebuild (> 0 ถ้ามีข้อมูล)
- ✅ ไม่มี error
- ✅ Refresh หน้า Cashflow แล้วเห็นข้อมูลอัพเดท

**Actual Result:**
- [ ] Rows affected: _____________
- [ ] Error: _____________
- [ ] Data updated: _____________

---

## Test Case 8: Debug Query (Verification)

**Test Steps:**
1. เปิด Supabase SQL Editor
2. Run debug query จาก `CASHFLOW_TIMEZONE_FIX_README.md` (Query 1-3)

**Expected Result:**
- ✅ Query 1: `th_date` ถูกต้อง (UTC 17:00 → TH next day)
- ✅ Query 2: Summary dates ตรงกับ TH dates
- ✅ Query 3: Raw vs Summary match (status = '✅ Match')

**Actual Result:**
- [ ] Query 1 result: _____________
- [ ] Query 2 result: _____________
- [ ] Query 3 result: _____________

---

## Regression Tests (ไม่ควรเสีย)

### RT1: Sales Orders
- [ ] Filter by date ยังทำงานถูกต้อง
- [ ] Export CSV วันที่ถูกต้อง

### RT2: Expenses
- [ ] Filter by date ยังทำงานถูกต้อง
- [ ] Export CSV วันที่ถูกต้อง

### RT3: Daily P&L
- [ ] เลือกวันที่ 25 ม.ค. แล้วแสดงข้อมูลวันที่ 25 (ไม่เลื่อน)
- [ ] Net Profit ถูกต้อง

### RT4: Wallet System
- [ ] Filter by date ยังทำงานถูกต้อง
- [ ] Ledger entries แสดงวันที่ถูกต้อง

---

## Performance Check

**Test Steps:**
1. เลือก date range ขนาดใหญ่ (เช่น ทั้งเดือน)
2. วัดเวลา page load

**Expected Result:**
- ✅ Daily Summary Table load < 500ms (จาก pre-aggregated table)
- ✅ Summary Cards load < 500ms
- ✅ ไม่มี N+1 queries
- ✅ Transactions load เมื่อคลิก tab เท่านั้น (lazy load)

**Actual Result:**
- [ ] Summary load time: _____________
- [ ] Daily table load time: _____________
- [ ] Transactions load time: _____________

---

## Sign-off

**Tester:** _____________
**Date:** _____________
**Status:** [ ] Pass / [ ] Fail
**Notes:** _____________________________________________

---

## Quick Smoke Test (Minimal)

สำหรับ test รวดเร็วหลัง deploy:

1. ✅ เปิดหน้า Cashflow
2. ✅ เลือกวันที่ 25 ม.ค. 2569
3. ✅ ตารางแสดงวันที่ 25 (ไม่ใช่ 24)
4. ✅ ยอดเงินดูถูกต้อง (ไม่เป็น 0 หรือผิดพลาด)

**If all 4 pass → Deploy OK ✅**
**If any fail → Rollback ❌**
