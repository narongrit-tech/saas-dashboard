# Tiger Awareness Import Mismatch — January 2026

**Date:** 2026-03-03
**Branch:** feat/performance-dashboard-v2
**Reported by:** Manual test — Column Mapping Wizard → Tiger Awareness (Monthly)

---

## 1. File Metadata

| Field | Value |
|-------|-------|
| Path | `D:\Projects\saas-dashboard\raw.data\Tiger x CoolSmile - client's credit card-Campaign Report-(2026-01-01 to 2026-01-31) (1).xlsx` |
| Extension | `.xlsx` (Excel, not CSV) |
| File size | 9,498 bytes |
| Last modified | 2026-03-03T05:34:36.938Z |
| Sheet | Sheet1 |
| Report period | 2026-01-01 to 2026-01-31 |

---

## 2. Parsing Method

- Parser: `XLSX.utils.sheet_to_json(worksheet, { defval: null })`
- Library: `xlsx` (npm, server-side in Next.js Server Action)
- Called from: `parseWithCustomMapping()` in `manual-mapping-actions.ts`
- Column keys used: `Campaign name` → `campaign_name`, `Cost` → `spend`

---

## 3. Detected Columns (Row 0 / Header)

```
Campaign name, Primary status, Campaign Budget, Cost,
CPC (destination), CPM, Impressions, Clicks (destination),
CTR (destination), Conversions, Cost per conversion,
Conversion rate (CVR), Results, Cost per result, Result rate,
Deep funnel result, Cost per deep funnel result, Deep funnel result rate,
Goal-based budget increase, Currency
```

**Total headers:** 20 columns
**Key columns:** `Campaign name` (index 0), `Cost` (index 3), `Currency` (index 19)

---

## 4. Row Count Analysis

| Category | Count |
|----------|-------|
| Total rows (sheet_to_json object mode) | 34 |
| Valid campaign rows (spend > 0, non-summary) | 8 |
| Zero-spend rows (Cost = 0.00) | 25 |
| **Summary/Total rows** | **1** |

---

## 5. Valid Campaign Rows

| # | Campaign Name (truncated) | Cost (THB) |
|---|--------------------------|-----------|
| 0 | 13012025 Reach \| Live Cool Smile \| Re Targeting | 6,264.84 |
| 1 | 13012026 Reach \| Cool Smile Live \| NewAudience | 2,574.99 |
| 2 | 27-31 /01/2026 Reach \| Cool Smile เสื้อม่วงไม่ปัก | 1,065.93 |
| 3 | 27-31 /01/2026 Reach \| 24Plus Serum ไม่ปัก | 1,063.31 |
| 4 | Live 30012026 \| Kibnalisa | 543.09 |
| 5 | Reach20260122224643 | 500.00 |
| 6 | 27-31 /01/2026 VDO View \| SX Coffee Warm-ปัก | 328.54 |
| 7 | 27-31 /01/2026 VDO View \| Cool Smile เสื้อม่วง+ปัก | 296.29 |

**Sum of valid campaigns: 12,636.99 THB**

---

## 6. Summary Row (The Bug Source)

Row index 33 (last row in file):

```json
{
  "Campaign name": "Total of 33 results",
  "Primary status": "-",
  "Campaign Budget": "-",
  "Cost": "12636.99",
  "Currency": "THB"
}
```

TikTok Ads Manager automatically appends a **"Total of N results"** footer row to every Campaign Report export. This row contains the grand total of all columns (Cost, Impressions, Clicks, etc.).

---

## 7. Root Cause

```
Bug location:  manual-mapping-actions.ts → parseWithCustomMapping()
Secondary:     tiger-import-actions.ts → parseTigerReportFile()

Logic flaw:
  Parser iterates ALL rows from sheet_to_json().
  Summary row "Total of 33 results" has:
    - campaignName = "Total of 33 results"  → not empty → passes check
    - spend = 12636.99                       → > 0 → passes check
  → Row gets added to parsedRows[] and spend is added to totalSpend

Result:
  totalSpend = Σ(8 valid campaigns) + summary_row_cost
             = 12,636.99             + 12,636.99
             = 25,273.98  ← exactly 2× the correct value

Preview shows:  25,273.98 THB  (WRONG)
TikTok UI shows: 12,636.99 THB  (CORRECT)
recordCount:     9 (8 campaigns + 1 summary row)  (WRONG, should be 8)
```

**Duplicate pattern:** Not row duplication — single summary footer row counted as campaign.

---

## 8. Terminal Log: Verification Output

```
=== NUMBERS ===
Valid campaign rows:             8
Zero-spend rows:                25
Summary rows (Total of N results): 1

Raw sum (campaign rows only):   12636.99
Buggy sum (all rows with cost>0): 25273.98
Ratio buggy/real:               2.0000  ← exactly double

TikTok UI total:   12636.99
Preview shows:     25273.98 = 12636.99 + 12636.99 (summary row)
```

---

## 9. Fix Decision

**Strategy:** Skip rows where `campaign_name` matches the pattern `^total\s+of\s+\d+` (case-insensitive regex). This matches TikTok's standard footer format "Total of N results" without risk of false-positives on real campaign names.

**Files changed:**

1. `frontend/src/app/(dashboard)/wallets/manual-mapping-actions.ts`
   → `parseWithCustomMapping()` — add `isSummaryRow` guard before `parsedRows.push()`

2. `frontend/src/app/(dashboard)/wallets/tiger-import-actions.ts`
   → `parseTigerReportFile()` — add same guard in the campaign loop

---

## 10. Expected Outcome After Fix

| Step | Value | Status |
|------|-------|--------|
| Raw rows from XLSX | 34 | unchanged |
| Rows with spend > 0 | 9 (8 + 1 summary) | |
| Rows after summary filter | 8 | ✅ correct |
| `raw_sum` (pre-filter) | 25,273.98 | |
| `dedup_sum` / `monthly_total` (post-filter) | **12,636.99** | ✅ matches TikTok UI |
| Preview Total Spend | **12,636.99 THB** | ✅ |
| wallet_ledger entries created | 1 | ✅ |
| wallet_ledger amount | 12,636.99 | ✅ |
| ad_daily_performance rows | 0 (Tiger = no perf rows) | ✅ |
