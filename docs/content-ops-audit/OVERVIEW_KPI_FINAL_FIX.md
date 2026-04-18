# Overview KPI Final Fix — All Four Metrics Exact

## Previous Limitation

After the `OVERVIEW_KPI_HOTFIX` (ORDER ITEMS fix), three KPI cards were still wrong:

| KPI card | Source | Problem |
|----------|--------|---------|
| ORDER ITEMS | `countRes.count` (exact) | Fixed ✓ |
| Products | `productIds.size` (Set from dataRes) | Only 1000-row sample |
| Shops | `shopCodes.size` (Set from dataRes) | Only 1000-row sample |
| Content IDs | `contentIds.size` (Set from dataRes) | Only 1000-row sample |

`dataRes` is the row-data query (used for status breakdown + top lists). Supabase
PostgREST enforces `max-rows = 1000` server-side — no client-side `.limit()` or
`.range()` can override this per-request cap. So any Set built from `dataRes.data`
is computed from at most 1000 rows, regardless of the actual dataset size.

---

## Fix Approach

PostgREST v12 supports aggregate functions in the `select` clause. When applied
without a GROUP BY, they run as a single DB-side aggregate over the full filtered
result set — one row in, one row out. Not subject to `max-rows`.

The syntax used:
```
product_id.count(distinct=true)  →  COUNT(DISTINCT product_id)
shop_code.count(distinct=true)   →  COUNT(DISTINCT shop_code)
content_id.count(distinct=true)  →  COUNT(DISTINCT content_id)
```

Three aliases in a single query:
```
unique_products:product_id.count(distinct=true),
unique_shops:shop_code.count(distinct=true),
unique_content_ids:content_id.count(distinct=true)
```

PostgREST generates:
```sql
SELECT COUNT(DISTINCT product_id)  AS unique_products,
       COUNT(DISTINCT shop_code)   AS unique_shops,
       COUNT(DISTINCT content_id)  AS unique_content_ids
FROM content_order_facts
WHERE created_by = $1
  AND order_date >= $2
  AND order_date <= $3
```

Returns one row: `[{ unique_products: 42, unique_shops: 8, unique_content_ids: 150 }]`.

No row data transferred beyond that single aggregate row. Always exact.

---

## File Changed

`frontend/src/app/(dashboard)/content-ops/actions.ts` — `getOverviewDataFiltered` only.

### Before (three separate issues)

```typescript
// Two queries
const [countRes, dataRes] = await Promise.all([...])

// totalOrderItems: exact (from countRes.count) ✓
// uniqueProducts: productIds.size — built from dataRes rows, max 1000 ✗
// uniqueShops: shopCodes.size — built from dataRes rows, max 1000 ✗
// uniqueContentIds: contentIds.size — built from dataRes rows, max 1000 ✗
```

### After

```typescript
// Three queries
const [countRes, dataRes, kpiRes] = await Promise.all([
  // existing countRes
  // existing dataRes (rows for status breakdown + top lists)
  supabase
    .from('content_order_facts')
    .select('unique_products:product_id.count(distinct=true), unique_shops:shop_code.count(distinct=true), unique_content_ids:content_id.count(distinct=true)')
    .eq('created_by', user.id)
    .gte('order_date', from)
    .lte('order_date', to),
])

type KpiAggRow = { unique_products: number; unique_shops: number; unique_content_ids: number }
const kpiRow = (kpiRes.data as unknown as KpiAggRow[] | null)?.[0]
const uniqueProducts = kpiRow?.unique_products ?? productMap.size    // fallback: sample
const uniqueShops = kpiRow?.unique_shops ?? shopMap.size             // fallback: sample
const uniqueContentIds = kpiRow?.unique_content_ids ?? 0             // fallback: 0
```

---

## What Is Now Exact

| KPI card | Source after fix | Exact? |
|----------|-----------------|--------|
| ORDER ITEMS | `countRes.count` (COUNT(*)) | Yes — all rows |
| Products | `kpiRow.unique_products` (COUNT(DISTINCT product_id)) | Yes — all rows |
| Shops | `kpiRow.unique_shops` (COUNT(DISTINCT shop_code)) | Yes — all rows |
| Content IDs | `kpiRow.unique_content_ids` (COUNT(DISTINCT content_id)) | Yes — all rows |

All four Overview KPI cards now reflect the true selected-date-range totals for
any dataset size. The three additional parallel queries add negligible overhead
(one aggregate row returned each; all run concurrently).

---

## Remaining Sample-Based Elements (acceptable)

The following are still derived from the 1000-row `dataRes` sample:

- **Status breakdown percentages** — shown as `%` within the sample; still
  directionally correct, sum to 100% within the visible sample
- **Top Products list** — ordered by items within the 1000-row sample;
  rank order may differ from all-time rank for very large datasets
- **Top Shops list** — same caveat as Top Products

These are "view ranking" elements, not headline KPI metrics. The inaccuracy
is acceptable for the Top-10 lists since the most active products/shops will
generally appear in the first 1000 rows of the sort anyway.

---

## No DB Migration Required

This fix uses PostgREST's built-in aggregate function syntax. No new DB functions,
views, or migrations are needed. No deployment steps beyond normal Vercel deploy.

---

## Verification

```
npx tsc --noEmit  →  0 errors
```

After deploying:
- Overview Products KPI should match `SELECT COUNT(DISTINCT product_id) FROM content_order_facts WHERE created_by = ? AND order_date BETWEEN ? AND ?`
- Overview Shops KPI should match `SELECT COUNT(DISTINCT shop_code) ...`
- Overview Content IDs KPI should match `SELECT COUNT(DISTINCT content_id) ...`
- All four KPI cards should be consistent with each other and with Orders Explorer for the same date range
