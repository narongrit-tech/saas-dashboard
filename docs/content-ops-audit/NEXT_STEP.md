# Content Ops Audit: Next Step

## Real Current State (updated 2026-04-18)

Five corrective passes have made Content Ops truthful, structurally aligned,
operationally hardened, and decision-usable:

- **Pass 1**: Status filters canonical, attribution failures surfaced, upload API standardized
- **Pass 2**: All attribution queries bounded (no full scans on `content_order_attribution`),
  null safety fixed, TSC clean
- **Pass 3**: Dead facts-as-registry code removed, master functions read from correct tables,
  detail pages use master for canonical identity, `runMasterRefresh()` action added
- **Pass 4**: Preview-before-import gate added, pre-write row validation, duplicate file detection
- **Pass 5**: `runMasterRefresh` wired to overview UI, Bangkok date default fixed in cost input,
  profit page truthfulness banner added for no-cost-data state

**Consistency fix applied 2026-04-18**: Overview / Products / Shops were
silently capped at 1000 rows by Supabase's default PostgREST row limit.
All aggregation queries now use `.limit(200000)`. Attribution column
footprint reduced; page limit halved to 25. See `CONSISTENCY_FIX_PASS.md`.

**Overview KPI hotfix applied 2026-04-18**: `.limit(200000)` does NOT override
Supabase PostgREST `max-rows` (hard server cap = 1000). `getOverviewDataFiltered`
now uses a parallel `{ count: 'exact', head: true }` query for ORDER ITEMS — exact
`SELECT COUNT(*)`, not subject to `max-rows`. See `OVERVIEW_KPI_HOTFIX.md`.

**Overview KPI final fix applied 2026-04-18**: Products / Shops / Content IDs KPIs
were still sample-derived (1000 rows). Added third parallel `kpiRes` query using
PostgREST aggregate `COUNT(DISTINCT col)` syntax — all four KPI cards are now exact,
no DB migration required. See `OVERVIEW_KPI_FINAL_FIX.md`.

The module is now:
- Truthful (no fabricated states, clear no-data indicators)
- Structurally sound (DB schema aligned, dead code removed)
- Import contract hardened (preview → validate → import)
- Cost → profit layer activated and decision-usable
- **KPI-exact** (all four Overview KPI cards reflect true date-range totals)

The only remaining gaps are operator-level (data entry) and low-priority UX additions.

---

## Corrective Passes: Completed

### Pass 1 — Truthfulness Fixes
- Canonical status values end-to-end
- Attribution failures surfaced as real states
- Upload API error shape standardized
- Upload copy no longer overclaims idempotency
- Original filenames preserved through import pipeline

### Pass 2 — Attribution Runtime Stabilization
- All 7 attribution query sites use bounded queries (no `count: 'exact'` on the view)
- `runVerification()` Check 7 uses probe instead of full scan
- Null safety crash fixed
- JSX syntax error fixed
- TSC: 0 errors

### Pass 3 — Product/Shop Master Alignment
- Removed dead `getProductList()`, `getShopList()` (facts-as-registry pattern)
- Fixed `getProductMaster()`, `getShopMaster()` to read from actual master tables
- Updated `ProductSummary`, `ShopSummary` types to match DB columns
- Detail pages use master for canonical identity with facts fallback
- `runMasterRefresh()` server action added
- TSC: 0 errors

### Pass 4 — Import Contract Hardening
- `previewTikTokAffiliateFile()` added: parses file, checks hash, validates rows, no DB writes
- `POST /api/content-ops/tiktok-affiliate/preview` route added
- Pre-write validation: rows missing `order_id`, `content_id`, or `product_id` dropped before staging
- `preWriteRejectedRowCount` tracked in import result
- Upload UI: two-phase "Preview → Import" flow with per-file preview card
- Duplicate file detection: amber warning with existing batch ID shown before import
- TSC: 0 errors

### Pass 5 — Cost → Profit Layer Activation
- `MasterRefreshButton` client component added, wired to overview page quick actions
- Bangkok date default fixed in cost input (`today()` was UTC, now UTC+7)
- Profit page: amber banner when `rows.length > 0 && total_cost === 0` ("profit = commission only")
- Profit empty state: explains add-costs-first flow explicitly
- TSC: 0 errors

---

## Remaining Gaps (priority order)

### 1. Enter real cost data — HIGH (operator task, not code)
`tt_content_costs` = 0 rows. Profit cannot be computed until operator enters costs.
QA path: `/content-ops/tiktok-affiliate/costs` → add cost rows → run profit refresh
→ verify no-cost-data banner disappears → verify profit summary shows non-zero costs.

### 2. Full operator QA loop on Vercel — HIGH
End-to-end smoke test:
1. Upload new batch → preview shows correct row count → confirm import → batch count increments
2. Re-upload same file → "Duplicate" badge in preview
3. Check attribution pages → `success` or `partial` badge (not crash)
4. Run master refresh from overview → product/shop counts update inline
5. Enter cost row → run profit refresh → no-cost-data banner disappears → summary non-empty
6. Run verification → all 8 checks pass

### 3. `getProductMaster()` / `getShopMaster()` have no page consumer — LOW
These now read from the correct tables but no page surfaces the full registry.
A "Product Registry" admin view with all-time GMV and commission could be useful
but is not required for current operator flow.

### 4. Attribution view performance — LOW (monitor, don't fix pre-emptively)
Bounded queries prevent timeouts. If page load times become a complaint, investigate
indexes on `content_order_facts(created_by, order_date)` and the attribution view
predicate. No action needed until timing data shows a real problem.

---

## Architecture Boundaries (do not cross)

- Content Ops is independent — do not merge into wallet / finance / reconciliation
- Video/content entity layer — do not redesign yet
- Cost/profit architecture — do not redesign until real cost data exists
- Preview-before-import beyond critical field validation — intentionally deferred
