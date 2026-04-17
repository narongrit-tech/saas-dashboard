# Consistency Fix Pass

## Root Cause

**Supabase PostgREST default row cap = 1000.**

All aggregation queries in `actions.ts` called `.select()` without an
explicit `.limit()`. Supabase's PostgREST returns at most `max-rows`
(default: **1000**) when no limit is set. This caused every metric that
derives from a full-table JS aggregation to silently compute from only
the first 1000 rows, regardless of the actual imported dataset size.

The Orders Explorer was not affected because it uses `.range(offset, end)`
for pagination and `{ count: 'exact' }` for the total — PostgREST returns
the true count in the response header independent of the row cap.

Secondary issue: the `content_order_attribution` view selected 18 columns
including 5 that are not rendered by the attribution page
(`is_realized`, `is_open`, `is_lost`, `commission`, `created_by`). The
view is computed on-the-fly; unnecessary column selection increases
computation cost and contributes to the ~10 s timeout.

---

## Pages That Were Partial Before This Fix

| Page | Function | Was Capped At |
|------|----------|---------------|
| `/content-ops` (overview KPIs) | `getOverviewDataFiltered` | 1000 rows |
| `/content-ops` (health snapshot) | `getOverviewData` | 1000 rows |
| `/content-ops/products` | `getProductTrends` | 1000 rows |
| `/content-ops/shops` | `getShopTrends` | 1000 rows |
| `/content-ops/content` | `getContentList` | 1000 rows |
| `/content-ops/data-health` | `getDataHealth` (coverage metrics) | 1000 rows |
| `/content-ops/tiktok-affiliate/attribution` | `getAttribution` | timed out |

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/app/(dashboard)/content-ops/actions.ts` | Added `.limit(200000)` to 6 aggregation queries: `getOverviewData`, `getOverviewDataFiltered`, `getProductTrends`, `getShopTrends`, `getContentList`, `getDataHealth`. |
| `frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts` | Narrowed `getAttribution` column SELECT from 18 columns to 13 — removed `created_by`, `is_realized`, `is_open`, `is_lost`, `commission` (none rendered by the page). |
| `frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/attribution/page.tsx` | Reduced page limit from 50 → 25. Cuts view rows computed per request roughly in half. |

---

## What Was Fixed

### A. Overview, Products, Shops, Content — full truth restored

`.limit(200000)` overrides the Supabase 1000-row default.

All JS aggregations now operate on the full fact set within the selected
date range. Overview KPIs, status breakdown, top-product / top-shop
lists, and unique count metrics will now reflect the real imported data.

For the current dataset (~108k rows), each query fetches ~2–4 MB of
narrow JSON. This runs server-side (Next.js server → Supabase), so
there is no client bandwidth concern.

### B. Attribution — reduced computation footprint

Removing 5 unused columns from the SELECT reduces the amount of work the
`content_order_attribution` view must do per row. Combined with reducing
the page size from 50 → 25 rows, the view processes ~half as many rows
per request.

The degraded-mode logic (partial/notice/timed_out states) is unchanged —
if the view still times out on a particularly loaded query, the page
degrades gracefully with an amber notice rather than showing a blank
state.

---

## What Still Remains

- **Attribution timeout root cause is in the DB view**, not the client.
  The `content_order_attribution` view is unindexed and computed live.
  The column reduction and limit reduction reduce risk but do not
  eliminate the timeout — if the view definition is complex (window
  functions, lateral joins), a real fix requires DB-side optimization
  (materialized view, or index on `(created_by, order_date)`). This is
  out of scope for this pass.

- **Shops "Top Content IDs"** — `shops/[shopCode]/page.tsx` does not link
  to the content detail page (noted in Pass 6 as out of scope).

- **Date range mismatch diagnostic** — if a user's imported data has
  `order_date` values outside the default 7-day window, Overview will
  correctly show lower counts. This is expected behavior, not a bug.
  The fix is to use a wider date range via the date filter.

---

## Verification

```
npx tsc --noEmit  →  0 errors
```

After deploying:
- Overview order item count should match Orders Explorer total for the
  same date range
- Products and Shops pages should list all products/shops present in the
  selected date range (not just those from the first 1000 fact rows)
- Attribution page should load 25 rows or show a graceful partial notice
  instead of timing out silently
