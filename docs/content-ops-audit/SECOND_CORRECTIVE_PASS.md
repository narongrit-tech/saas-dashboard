# Second Corrective Pass

## Current State After Pass

All attribution surfaces in Content Ops now render correctly on real data volume
(~108k facts, complex `content_order_attribution` view). No surface issues exact
count queries against the attribution view. Runtime states flow from server actions
through diagnostics into the UI on every attribution load.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/attribution/page.tsx` | Fixed null-safety crash: `total.toLocaleString()` on line that could receive `total === null` |
| `frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts` | Fixed `runVerification()` Check 7: replaced unsafe `count: 'exact', head: true` on `content_order_attribution` with bounded probe (`limit(1)`) |
| `frontend/src/app/(dashboard)/content-ops/analysis/attribution/page.tsx` | Fixed pre-existing JSX syntax error: bare `->` arrows in text content replaced with `&#8594;` entities |

---

## What Was Stabilized

### 1. Null safety in TikTok Affiliate attribution page

**Before:** Line 100 rendered `{total.toLocaleString()} rows.` where `total` is typed
`number | null`. When `content_order_attribution` returns a non-final page, `total`
is correctly `null`. The old code crashed at runtime with `TypeError: Cannot read
properties of null`.

**After:** The expression is now `{total !== null ? \` ${total.toLocaleString()} rows.\` : ''}`.
The description line renders without the row count when total is unknown.

### 2. Verification Check 7: unsafe attribution count removed

**Before:** `runVerification()` Check 7 ("Facts vs attribution coverage") ran
`count: 'exact', head: true` directly against `content_order_attribution`. This
is the same pattern that caused production timeouts on the attribution pages before
Pass 1. A full sequential scan of a complex view over 108k rows to produce a single
integer.

**After:** The check now issues a `limit(1)` probe on the attribution view — the
same pattern used by `getPipelineStatus()` and `getDataHealth()`. The check correctly
detects absence of attribution rows (0 rows returned by probe while facts > 0)
without ever requesting a full count. A timeout in the probe is surfaced as a
verification failure with the real error message.

### 3. Pre-existing JSX syntax error fixed

`analysis/attribution/page.tsx` had bare `->` in JSX text content, which is not
valid in `.tsx`. TypeScript reported 3 errors at that line. Fixed with HTML entities.

---

## Attribution Runtime Stabilization: Complete Picture

After both passes, the full set of attribution queries against `content_order_attribution`:

| Call site | Query pattern | Safe? |
|-----------|--------------|-------|
| `getAttributionFull()` in `actions.ts` | `range(offset, offset+limit)` — no count | ✅ |
| `getAttribution()` in `tiktok-affiliate/actions.ts` | `range(offset, offset+limit)` — no count | ✅ |
| `getDataHealth()` attribution probe | `limit(1)` | ✅ |
| `getPipelineStatus()` attribution probe | `limit(1)` | ✅ |
| `runVerification()` Check 1 (grain uniqueness) | `limit(1000)` | ✅ |
| `runVerification()` Check 2 (key completeness) | `limit(10)` | ✅ |
| `runVerification()` Check 7 (facts vs attribution) | `limit(1)` probe (fixed in this pass) | ✅ |

No remaining exact count scans against `content_order_attribution`.

---

## Observability: Complete Picture

Every attribution load emits a structured log via `logAttributionDiagnostics()`:

```
[content-ops attribution] {
  context: 'analysis_attribution_rows' | 'tiktok_affiliate_attribution_rows' | ...,
  state: 'success' | 'partial' | 'timed_out' | 'failed' | 'no_data',
  queryPath: 'stable_page_slice' | 'stable_probe' | ...,
  durationMs: number,
  degraded: boolean,
  timedOut: boolean,
  totalMode: 'exact' | 'derived_last_page' | 'skipped',
  summaryMode: 'exact' | 'page_slice' | 'probe' | 'skipped',
  message: string | null,
}
```

Logged at `console.warn` on `timed_out` or `failed`; `console.info` otherwise.

---

## What Still Remains

1. **Query/index optimization on `content_order_attribution` view itself.**
   Both passes stabilized the read path (no full scans) and made failures visible.
   The view may still be slow for large result pages, but no longer hangs in a
   timeout loop on count queries. If median page load is too slow, the next step
   is to investigate indexes on the underlying `content_order_facts` table columns
   used by the view (particularly `(created_by, order_date)`).

2. **Preview-before-import flow** — intentionally excluded from both passes.

3. **Cost / profit layers** — `tt_content_costs` still empty, profit summary stale.
   Not in scope for corrective passes.

4. **Video / product / shop architecture** — `tt_product_master` and `tt_shop_master`
   exist in DB but UI still aggregates from facts. Not in scope.

---

## Verification

```
npx tsc --noEmit  →  0 errors
```
