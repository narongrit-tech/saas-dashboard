# Third Corrective Pass

## Current State After Pass

Product and shop runtime surfaces are now aligned with the persistent master tables
(`tt_product_master`, `tt_shop_master`) for identity resolution. Dead code that
aggregated facts-as-registry has been removed. Master functions now read from the
correct tables. A `runMasterRefresh()` server action now exists to keep the tables
in sync after imports.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/app/(dashboard)/content-ops/actions.ts` | Removed `getProductList()`, `getShopList()` (dead code). Updated `getProductDetail()` and `getShopDetail()` to use master for canonical identity. |
| `frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts` | Fixed `getProductMaster()` and `getShopMaster()` to read from master tables. Updated `ProductSummary` and `ShopSummary` types. Added `runMasterRefresh()` action. |

No page files changed — `ProductDetail` and `ShopDetail` response shapes are identical.

---

## What Was Aligned (facts → master)

### Dead code removed

`getProductList()` and `getShopList()` in `content-ops/actions.ts`:
- Were never imported by any page (confirmed by grep)
- Aggregated all 107k facts in JS to produce a product/shop registry
- Used facts as the primary product/shop registry, which is the wrong role
- Removed entirely — their types (`ProductListRow`, `ProductListResult`,
  `ShopListRow`, `ShopListResult`) removed with them

### Master functions fixed

`getProductMaster()` and `getShopMaster()` in `tiktok-affiliate/actions.ts`:
- Previously read from `content_order_facts` and aggregated in JS — same
  misleading pattern as the removed list functions
- Now read directly from `tt_product_master` and `tt_shop_master` with a
  simple `SELECT` + `range()` — no in-JS aggregation
- `ProductSummary.total_earned` renamed to `total_commission` to match
  the actual DB column name (`tt_product_master.total_commission`)
- Both types now include `first_seen_at`, `last_seen_at` from master

### Detail pages aligned to master for identity

`getProductDetail()` now runs parallel queries:
- `tt_product_master` → `product_name` (canonical name from most recent import)
- `content_order_facts` → all counts and derived metrics

`getShopDetail()` now runs parallel queries:
- `tt_shop_master` → `shop_name` (canonical name from most recent import)
- `content_order_facts` → all counts and derived metrics

Source boundaries are documented with inline comments in both functions.

### runMasterRefresh added

New server action `runMasterRefresh()` in `tiktok-affiliate/actions.ts`:
- Calls `refresh_tt_product_shop_master(p_created_by)` DB function
- Returns `{ products_upserted, shops_upserted }` from the RPC result
- Revalidates `/content-ops/products`, `/content-ops/shops`,
  `/content-ops/tiktok-affiliate` paths on success

---

## What Still Remains Fact-Derived

### By design — facts are the correct source

| Surface | Why facts stay |
|---------|---------------|
| `totalOrderItems` in detail stats | Master stats may be stale; facts always current |
| `settledCount` in detail stats | Same reason |
| `shopCount` on product detail | Master has only 1 shop per product (most recent); distinct count requires facts |
| `productCount` on shop detail | Master has only a pre-computed count; live distinct requires facts |
| `topShopName` on product detail | Master has primary shop, not highest-volume shop |
| `topProductName` on shop detail | Master has no per-product ranking |
| Status breakdown (settled/pending/etc.) | Not stored in master |
| Top shops / top products lists | Not stored in master |
| Top content IDs | Not stored in master |
| Related orders preview | Not stored in master |

### By design — period-scoped surfaces

`getProductTrends()` and `getShopTrends()` are period-scoped (compare two date
ranges, compute sparklines). Master tables have no date-range dimension. These
remain fact-derived and are correct for their purpose.

---

## What Still Remains Blocked

1. **`runMasterRefresh()` has no UI trigger.**
   The action exists but no page calls it. Master tables stay fresh only if the
   operator calls refresh manually or if a future import hook triggers it.
   Next: wire into the TikTok affiliate pipeline page or add a button to data-health.

2. **`getProductMaster()` and `getShopMaster()` are still not called by any page.**
   The functions now read from the correct tables, but no page surfaces the full
   product/shop registry view with all-time GMV and commission. This is a future
   UX decision, not a correctness blocker.

3. **Master staleness is silent.**
   If an import batch adds new products/shops, master won't reflect them until
   refresh runs. The detail pages handle this gracefully (fallback to facts for
   identity if master row is absent), but the user has no indicator.

4. **Showcase enrichment fields remain empty.**
   `product_image_url`, `current_price`, `current_commission_rate`, `stock_status`
   in `tt_product_master` are all NULL. Populated by a future showcase pipeline.

---

## Verification

```
npx tsc --noEmit  →  0 errors
```
