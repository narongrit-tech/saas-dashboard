# Ads Campaign Type Tabs - Manual Test Guide

## สรุปการแก้ไข

### ไฟล์ที่แก้
1. **frontend/src/app/(dashboard)/ads/actions.ts** (Backend API)
   - เพิ่ม `CampaignTypeFilter` type: 'all' | 'product' | 'live'
   - แก้ `getAdsSummary()`: รับ parameter `campaignType` และเพิ่ม conditional filter
   - แก้ `getAdsPerformance()`: รับ parameter `campaignType` และเพิ่ม conditional filter
   - Logic: ถ้า campaignType เป็น 'product' หรือ 'live' → เพิ่ม `.eq('campaign_type', campaignType)`
   - Logic: ถ้า campaignType เป็น 'all' หรือ undefined → ไม่ filter (รวมทั้งหมด)

2. **frontend/src/app/(dashboard)/ads/page.tsx** (Frontend UI)
   - เพิ่ม import: `useRouter`, `useSearchParams`, `Tabs` component
   - อ่าน `?tab=` URL param → set เป็น `campaignType` (default: 'all')
   - เพิ่ม useEffect dependency: `[dateRange, campaignType]` → auto-fetch เมื่อเปลี่ยน tab
   - เพิ่ม `handleTabChange()`: update URL via router.replace (no full reload)
   - เพิ่ม Tabs UI: 3 tabs (รวมทั้งหมด, GMV Max (Product), LIVE)
   - ส่ง `campaignType` ไป API ทั้ง `getAdsSummary()` และ `getAdsPerformance()`

## Commits

### Commit 1: Backend API Support
```
7c0792e feat(ads-api): add campaignType filter support
```

### Commit 2: Frontend Tabs + URL State
```
a30296a feat(ads-ui): add campaign type filter tabs with URL state
```

---

## Manual Test Steps

### Prerequisite
ต้องมี ads data ใน database ทั้ง 2 types:
- `campaign_type = 'product'` (GMV Max campaigns)
- `campaign_type = 'live'` (LIVE campaigns)

หากไม่มีข้อมูล → import ads data ก่อนทดสอบ

---

### Test Case 1: Default Tab (รวมทั้งหมด)
**Steps:**
1. เปิดหน้า `/ads` (ไม่มี query param)
2. ดู URL → ต้องไม่มี `?tab=` (default)
3. ดู Tabs UI → tab "รวมทั้งหมด" ต้องถูกเลือก (active)
4. ดู Summary Cards และตาราง

**Expected:**
- Tab "รวมทั้งหมด" active
- Summary cards แสดง totals รวมทั้ง product + live
- ตารางแสดงทั้ง product และ live campaigns (เห็นทั้ง badge สีน้ำเงิน และสีม่วง)
- Console log: `campaignType: "all"`

**SQL Verification:**
```sql
-- ตรวจสอบว่า totals ตรงกับผลรวมทั้ง product + live
SELECT
  COUNT(*) as total_rows,
  SUM(spend) as total_spend,
  SUM(revenue) as total_revenue,
  SUM(orders) as total_orders
FROM ad_daily_performance
WHERE ad_date BETWEEN '2026-01-16' AND '2026-01-17'; -- ตัวอย่าง date range
```

---

### Test Case 2: Filter by Product Only
**Steps:**
1. คลิก tab "GMV Max (Product)"
2. ดู URL → ต้องเปลี่ยนเป็น `/ads?tab=product`
3. ดู Summary Cards และตาราง

**Expected:**
- URL: `/ads?tab=product`
- Tab "GMV Max (Product)" active
- Summary cards แสดง totals เฉพาะ product campaigns
- ตารางแสดง**เฉพาะ** product campaigns (badge สีน้ำเงิน เท่านั้น)
- **ห้ามมี** live campaigns (badge สีม่วง) ในตาราง
- Console log: `campaignType: "product"`
- หน้าไม่ reload (smooth transition)

**SQL Verification:**
```sql
-- ตรวจสอบว่า totals ตรงกับผลรวมเฉพาะ product
SELECT
  COUNT(*) as product_only_rows,
  SUM(spend) as product_spend,
  SUM(revenue) as product_revenue,
  SUM(orders) as product_orders
FROM ad_daily_performance
WHERE ad_date BETWEEN '2026-01-16' AND '2026-01-17'
  AND campaign_type = 'product';
```

---

### Test Case 3: Filter by LIVE Only
**Steps:**
1. คลิก tab "LIVE"
2. ดู URL → ต้องเปลี่ยนเป็น `/ads?tab=live`
3. ดู Summary Cards และตาราง

**Expected:**
- URL: `/ads?tab=live`
- Tab "LIVE" active
- Summary cards แสดง totals เฉพาะ live campaigns
- ตารางแสดง**เฉพาะ** live campaigns (badge สีม่วง เท่านั้น)
- **ห้ามมี** product campaigns (badge สีน้ำเงิน) ในตาราง
- Console log: `campaignType: "live"`
- หน้าไม่ reload

**SQL Verification:**
```sql
-- ตรวจสอบว่า totals ตรงกับผลรวมเฉพาะ live
SELECT
  COUNT(*) as live_only_rows,
  SUM(spend) as live_spend,
  SUM(revenue) as live_revenue,
  SUM(orders) as live_orders
FROM ad_daily_performance
WHERE ad_date BETWEEN '2026-01-16' AND '2026-01-17'
  AND campaign_type = 'live';
```

---

### Test Case 4: Validation (Summary = Product + Live)
**Steps:**
1. เปิดหน้า `/ads?tab=all` → note ค่า Total Spend, Revenue, Orders
2. เปิดหน้า `/ads?tab=product` → note ค่า totals
3. เปิดหน้า `/ads?tab=live` → note ค่า totals

**Expected:**
```
Totals(all) = Totals(product) + Totals(live)
```

**Example:**
- All: Spend=715.26, Revenue=12846.03, Orders=60
- Product: Spend=80.83, Revenue=5497.80, Orders=24
- Live: Spend=634.43, Revenue=7348.23, Orders=36
- ✅ Verified: 80.83 + 634.43 = 715.26

---

### Test Case 5: Tab + Date Range Interaction
**Steps:**
1. เลือก tab "GMV Max (Product)"
2. เปลี่ยน date range (เช่น จาก Last 7 Days → วันนี้)
3. ดู Summary Cards และตาราง

**Expected:**
- Tab ยังเป็น "GMV Max (Product)" (ไม่ reset)
- URL: `/ads?tab=product` (คงอยู่)
- Summary cards และตารางแสดงเฉพาะ product campaigns ในวันที่ใหม่
- Console log: `campaignType: "product", startDate: ...`

**Steps (Continue):**
4. เลือก tab "LIVE"
5. Date range ไม่เปลี่ยน

**Expected:**
- Tab เปลี่ยนเป็น "LIVE"
- URL: `/ads?tab=live`
- Summary cards และตารางแสดงเฉพาะ live campaigns (date range เดิม)

---

### Test Case 6: URL State Persistence (Refresh)
**Steps:**
1. เปิดหน้า `/ads?tab=product`
2. ดูหน้า (ต้องแสดงเฉพาะ product)
3. กด F5 (refresh)

**Expected:**
- หลัง refresh: URL ยังเป็น `/ads?tab=product`
- Tab "GMV Max (Product)" ยัง active
- Summary cards และตารางยังแสดงเฉพาะ product campaigns
- ✅ State persist (no reset to 'all')

---

### Test Case 7: URL Direct Access
**Steps:**
1. ปิด browser tab
2. เปิด browser ใหม่
3. พิมพ์ URL โดยตรง: `http://localhost:3000/ads?tab=live`

**Expected:**
- Tab "LIVE" active ทันที
- Summary cards และตารางแสดงเฉพาะ live campaigns
- Console log: `campaignType: "live"`
- ✅ URL routing works correctly

---

### Test Case 8: Empty Data for Specific Tab
**Steps:**
1. เลือก tab "LIVE"
2. เลือกวันที่ที่ไม่มี live campaigns (แต่มี product campaigns)

**Expected:**
- Tab "LIVE" ยัง active
- Summary cards: Totals = 0 (Spend=0, Revenue=0, Orders=0, ROI=0)
- ตารางว่างเปล่า (แสดงข้อความ "ไม่พบข้อมูลโฆษณาในช่วงเวลาที่เลือก")
- **ห้ามแสดง product campaigns** (ต้องว่างจริงๆ)

---

### Test Case 9: Summary Cards vs Table Sync
**Critical Test:** ตรวจสอบว่า Summary cards กับตารางใช้ filter เดียวกัน (no drift)

**Steps:**
1. เลือก tab "GMV Max (Product)"
2. เปิด browser console
3. ดู console logs: `[ADS_SUMMARY]` และ `[ADS_PERFORMANCE]`

**Expected:**
```
[ADS_SUMMARY] Query params: {
  userId: "...",
  startDate: "2026-01-17",
  endDate: "2026-01-17",
  campaignType: "product"  ✅ ต้องมี
}

[ADS_PERFORMANCE] Query params: {
  userId: "...",
  startDate: "2026-01-17",
  endDate: "2026-01-17",
  campaignType: "product"  ✅ ต้องเหมือนกัน
}
```

**Manual Verification:**
- นับจำนวน rows ในตาราง (manual count)
- เช็คว่า SUM(spend) ในตารางตรงกับ Total Spend card หรือไม่
- ✅ ต้องตรงกัน 100%

---

### Test Case 10: Tabs UI/UX Check
**Steps:**
1. คลิกแต่ละ tab (รวมทั้งหมด, GMV Max, LIVE)
2. ดู visual feedback

**Expected:**
- ✅ Tab ที่เลือกมี active state (สีเข้ม, underline, หรือ background)
- ✅ Tab ที่ไม่เลือกมี inactive state (สีอ่อน)
- ✅ Hover effect ทำงาน
- ✅ Transition smooth (ไม่กระตุก)
- ✅ Tabs UI เหมือน shadcn/ui standard (consistent กับ components อื่น)

---

## SQL Comprehensive Verification

หากต้องการตรวจสอบข้อมูลทั้งหมดพร้อมกัน:

```sql
-- ตรวจสอบว่า totals แยกตาม campaign_type
SELECT
  campaign_type,
  COUNT(*) as row_count,
  SUM(spend) as total_spend,
  SUM(revenue) as total_revenue,
  SUM(orders) as total_orders
FROM ad_daily_performance
WHERE ad_date BETWEEN '2026-01-16' AND '2026-01-17'
GROUP BY campaign_type
ORDER BY campaign_type;

-- ตรวจสอบว่ามี campaign_type อะไรบ้างใน database
SELECT DISTINCT campaign_type, COUNT(*)
FROM ad_daily_performance
GROUP BY campaign_type;

-- ตรวจสอบว่า all = product + live
SELECT
  'all' as filter_type,
  COUNT(*) as row_count,
  SUM(spend) as total_spend,
  SUM(revenue) as total_revenue,
  SUM(orders) as total_orders
FROM ad_daily_performance
WHERE ad_date BETWEEN '2026-01-16' AND '2026-01-17'

UNION ALL

SELECT
  'product' as filter_type,
  COUNT(*) as row_count,
  SUM(spend) as total_spend,
  SUM(revenue) as total_revenue,
  SUM(orders) as total_orders
FROM ad_daily_performance
WHERE ad_date BETWEEN '2026-01-16' AND '2026-01-17'
  AND campaign_type = 'product'

UNION ALL

SELECT
  'live' as filter_type,
  COUNT(*) as row_count,
  SUM(spend) as total_spend,
  SUM(revenue) as total_revenue,
  SUM(orders) as total_orders
FROM ad_daily_performance
WHERE ad_date BETWEEN '2026-01-16' AND '2026-01-17'
  AND campaign_type = 'live';
```

**Expected Output:**
```
filter_type | row_count | total_spend | total_revenue | total_orders
------------------------------------------------------------------------
all         | 100       | 715.26      | 12846.03      | 60
product     | 13        | 80.83       | 5497.80       | 24
live        | 87        | 634.43      | 7348.23       | 36

Verification:
✅ row_count(all) = row_count(product) + row_count(live) → 100 = 13 + 87
✅ total_spend(all) = total_spend(product) + total_spend(live) → 715.26 = 80.83 + 634.43
```

---

## Regression Test: ตรวจสอบหน้าอื่นไม่เสีย

### Pages to Check:
- `/` - Dashboard (ไม่เกี่ยวกับ ads API, ต้องยังใช้งานได้)
- `/daily-pl` - Daily P&L (ads data ไม่ broken)
- `/company-cashflow` - Cashflow (ไม่เกี่ยวกับ ads)
- `/reconciliation` - Reconciliation (ไม่เกี่ยวกับ ads)

**Expected:** ไม่มีหน้าใดเสีย เพราะแก้เฉพาะ `/ads` และ actions เป็น optional parameter (backward compatible)

---

## Known Limitations

1. **Campaign type ที่ไม่รู้จัก:**
   - ถ้า database มี `campaign_type` อื่นที่ไม่ใช่ 'product' หรือ 'live' (เช่น NULL, 'unknown')
   - Tab "รวมทั้งหมด" จะแสดงข้อมูลนั้น
   - Tab "GMV Max" และ "LIVE" จะไม่แสดง

2. **URL manipulation:**
   - ถ้า user พิมพ์ `?tab=invalid` → จะ fallback เป็น 'all' (ตาม TypeScript type)
   - URL จะไม่ update เป็น `?tab=invalid` (ใช้ CampaignTypeFilter type guard)

3. **No debounce:**
   - เปลี่ยน tab → query ทันที (no debounce)
   - ถ้า user คลิก tab เร็วมาก → อาจมี race condition (แต่ React concurrent mode จัดการให้)

---

## Technical Details

### Backend API Logic
```typescript
// actions.ts
if (campaignType === 'product' || campaignType === 'live') {
  query = query.eq('campaign_type', campaignType);
}
// else: no filter (รวมทั้งหมด)
```

### Frontend URL State Management
```typescript
// page.tsx
const campaignType = (searchParams.get('tab') as CampaignTypeFilter) || 'all';

const handleTabChange = (value: string) => {
  const params = new URLSearchParams(searchParams.toString());
  if (value === 'all') {
    params.delete('tab'); // default, ไม่ต้องใส่ URL
  } else {
    params.set('tab', value);
  }
  router.replace(`?${params.toString()}`, { scroll: false });
};
```

### useEffect Trigger
```typescript
useEffect(() => {
  if (dateRange) {
    fetchData();
  }
}, [dateRange, campaignType]); // ← เพิ่ม campaignType dependency
```

---

## Rollback Plan (หากพบปัญหา)

### Rollback Backend:
```bash
git revert 7c0792e
```

### Rollback Frontend:
```bash
git revert a30296a
```

### Rollback Both:
```bash
git revert HEAD~2..HEAD
```

หรือแก้กลับด้วยมือ:
1. `actions.ts`: ลบ parameter `campaignType` และ conditional filter
2. `page.tsx`: ลบ Tabs UI, ลบ URL state management, ลบ `campaignType` จาก API calls

---

## Contact

หากพบปัญหาหรือผลทดสอบไม่ตรงตาม expected → รายงานผลพร้อม:
1. Screenshot ของ Tabs UI + Summary Cards
2. Screenshot ของตาราง (แสดง campaign type badges)
3. Browser console log ที่มี `[ADS_SUMMARY]` และ `[ADS_PERFORMANCE]`
4. SQL query result จาก verification queries ด้านบน
5. URL ที่ทดสอบ (เช่น `/ads?tab=product`)
