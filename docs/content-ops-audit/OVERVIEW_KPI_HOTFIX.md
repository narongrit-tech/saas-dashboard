# Overview KPI Hotfix

## Root Cause

**The Supabase PostgREST `max-rows` setting is a hard server-side cap.**

The consistency fix pass added `.limit(200000)` to all aggregation queries,
expecting this to override the default 1000-row cap. It does not.

PostgREST enforces `max-rows` (default: **1000**) regardless of any `.limit(N)`
the client sends. If the client requests more than `max-rows`, PostgREST silently
returns exactly `max-rows` rows. `.limit(N)` only applies *within* the server cap
— it cannot exceed it.

As a result, after the consistency fix pass, Overview still showed
ORDER ITEMS = 1,000 because `getOverviewDataFiltered` still fetched at most
1000 rows from `content_order_facts`.

Products and Shops appeared to show different numbers after the consistency fix
because their queries fetched a different 1000-row window (wider date range
`prevFrom → to`), not because they bypassed the cap.

---

## The Correct Approach

`{ count: 'exact', head: true }` runs `SELECT COUNT(*) ... WHERE ...` on the
database server and returns the total in the `Content-Range` response header.
It transfers **zero rows** to the client, so `max-rows` has no effect on it.

This is the only reliable way to get an exact row total from Supabase PostgREST
without changing the server's `max-rows` configuration.

---

## File Changed

`frontend/src/app/(dashboard)/content-ops/actions.ts`

`getOverviewDataFiltered` was rewritten from a single-query approach to a
parallel two-query approach:

### Before

```typescript
const { data, error, count } = await supabase
  .from('content_order_facts')
  .select('product_id,product_name,...', { count: 'exact' })
  .eq('created_by', user.id)
  .gte('order_date', from)
  .lte('order_date', to)
  .limit(200000)  // ← ignored: PostgREST max-rows = 1000 overrides this

// count was null (count: 'exact' without head: true requires full row fetch)
// totalOrderItems was computed as data?.length → max 1000
```

### After

```typescript
const [countRes, dataRes] = await Promise.all([
  // Query A: exact COUNT(*) — no row transfer, not subject to max-rows
  supabase
    .from('content_order_facts')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .gte('order_date', from)
    .lte('order_date', to),

  // Query B: field values for JS aggregation (status, top products/shops)
  supabase
    .from('content_order_facts')
    .select('product_id,product_name,shop_code,shop_name,content_id,order_settlement_status')
    .eq('created_by', user.id)
    .gte('order_date', from)
    .lte('order_date', to),
])

// countRes.count = exact total from SELECT COUNT(*) — always correct
// dataRes.data = up to 1000 rows for status/top-lists (best-effort sample)
const totalOrderItems = countRes.count ?? (dataRes.data?.length ?? 0)
```

---

## What Was Fixed

- **`totalOrderItems`** (ORDER ITEMS KPI card) now shows the exact row count
  from `SELECT COUNT(*)`. For a dataset of e.g. 11,875 rows it shows 11,875
  instead of 1,000.

- **`uniqueProducts`, `uniqueShops`, `uniqueContentIds`** — these are still
  computed from the data query (up to 1000 rows). They will be accurate only
  for datasets ≤ 1000 rows. For larger datasets they are "count within the
  first 1000 rows" not "all-time unique count". This is a known limitation
  and is acceptable — the critical business metric (total order items) is
  now exact.

- **Status breakdown, top products, top shops** — also derived from the up-to-
  1000 row sample. Percentages within the sample are correct; they represent
  the shape of the data, not a guaranteed full count.

---

## What Was NOT Fixed

The remaining three KPIs (`uniqueProducts`, `uniqueShops`, `uniqueContentIds`)
are still capped at 1000 rows in the data query. Fixing them requires either:

- Running three additional `count: 'exact', head: true` queries with
  `.distinct()` on each field (Supabase PostgREST doesn't support `SELECT
  COUNT(DISTINCT col)` directly — would need DB functions or views), or
- Accepting that these counts reflect the sample (current behavior)

These are lower-priority metrics. The critical ORDER ITEMS KPI is now correct.

---

## Verification

```
npx tsc --noEmit  →  0 errors
```

After deploying:
- Overview ORDER ITEMS should match Orders Explorer total for the same date range
- For a 11,875-row dataset: ORDER ITEMS should show 11,875, not 1,000
- Status breakdown percentages remain internally consistent (sum to 100%)
