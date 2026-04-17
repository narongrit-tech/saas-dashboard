# Content Ops Audit: Blockers

## Architecture

### 1. Two attribution systems still exist in parallel

Why it matters:
- The repo still has a new Content Ops attribution pipeline and an older affiliate/order attribution pipeline.
- This creates conflicting truth surfaces and keeps Content Ops from being a clean independent system.

Evidence:
- New system uses `content_order_attribution` in [migration-096-tiktok-content-order-attribution.sql](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-096-tiktok-content-order-attribution.sql:1).
- Old system still uses `order_attribution` in:
  - [reports/profit/affiliate-import-actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/reports/profit/affiliate-import-actions.ts:715)
  - [sales/attribution-actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/sales/attribution-actions.ts:28)
  - [affiliates/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/affiliates/actions.ts:245)
  - [reports/profit/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/reports/profit/page.tsx:38)

Impact:
- Blocks trustworthiness
- Blocks production-readiness

### 2. Product/shop master exists but the runtime UI ignores it

Why it matters:
- Persistent product/shop registries now exist in DB, but runtime pages still aggregate directly from `content_order_facts`.
- That keeps product/shop UX tied to raw order scans instead of a cleaner module boundary.

Evidence:
- Live DB:
  - `tt_product_master`: 401 rows
  - `tt_shop_master`: 279 rows
- Migration exists in [migration-102-tiktok-affiliate-product-shop-master.sql](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-102-tiktok-affiliate-product-shop-master.sql:1).
- Product/shop pages still read from facts in [content-ops/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:194) and [content-ops/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:423).
- Unused master actions sit in [tiktok-affiliate/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:584) and [tiktok-affiliate/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:641).

Impact:
- Blocks production-readiness
- Increases maintenance risk

### 3. Video layer is still separate from the actual sales/profit system

Why it matters:
- The target model starts with `Video`, but the current library is still a file-backed Studio viewer with placeholder operator actions.
- There is no real DB-backed video linkage layer driving `Product / Shop -> Sales -> Cost -> Profit`.

Evidence:
- Library uses local registry/sample files in [tiktok-studio-import.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-studio-import.ts:28).
- Placeholder signals in [library/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/library/page.tsx:457), [library/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/library/page.tsx:461), and [library/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/library/page.tsx:527).

Impact:
- Blocks usability
- Blocks architecture alignment

## Data

### 4. Attribution view is architecturally correct but operationally unstable

Why it matters:
- A correct SQL design is not enough if the runtime UI query shape times out on real data.
- If the page cannot read attribution reliably, users cannot trust pipeline state.

Evidence:
- Real query pattern in [content-ops/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:704) and [tiktok-affiliate/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:230).
- Live DB reproduction of the same broad count/range query returned `57014 canceling statement due to statement timeout`.

Impact:
- Blocks usability
- Blocks trustworthiness

### 5. Profit output is not trustworthy because the cost layer is empty and summary is effectively test-only

Why it matters:
- The locked rule says `actual_commission_total = truth`, but profit depends on costs too.
- Without real costs and allocations, the profit page suggests business meaning that does not exist yet.

Evidence:
- Live DB counts:
  - `tt_content_costs`: 0
  - `tt_content_cost_allocations`: 0
  - `content_profit_attribution_summary`: 1
- The only summary row matches `ORDER-001` / `CONTENT-001` / `PROD-001`, which is consistent with manual test data rather than the full live import set.

Impact:
- Blocks trustworthiness
- Blocks production-readiness

### 6. Existing docs inside the repo are stale about real DB state

Why it matters:
- The code and DB have moved past earlier assumptions, but several Content Ops docs still say migration 102 is pending or tables do not exist.
- This increases the chance of wrong implementation decisions.

Evidence:
- Stale docs:
  - [CONTENT_OPS_CLOSURE_RUN_REPORT.md](/d:/AI_OS/projects/saas-dashboard/docs/content-ops/CONTENT_OPS_CLOSURE_RUN_REPORT.md:25)
  - [CONTENT_OPS_BLOCKERS_AFTER_IMPORT.md](/d:/AI_OS/projects/saas-dashboard/docs/content-ops/CONTENT_OPS_BLOCKERS_AFTER_IMPORT.md:48)
  - [CONTENT_OPS_PRODUCT_SHOP_MASTER_STATE.md](/d:/AI_OS/projects/saas-dashboard/docs/content-ops/CONTENT_OPS_PRODUCT_SHOP_MASTER_STATE.md:10)
- Live DB confirms both tables exist and are populated.

Impact:
- Blocks production-readiness
- Creates design drift

## Flow

### 7. Status filtering is broken across the main facts/order/product/shop flows

Why it matters:
- Status buckets are locked business logic.
- If filter links send values that do not exist in the DB, the user flow breaks at the exact point where the operator is supposed to inspect realized/open/lost behavior.

Evidence:
- UI sends title-cased labels:
  - [content-ops/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/page.tsx:108)
  - [products/[productId]/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/products/[productId]/page.tsx:155)
  - [shops/[shopCode]/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/shops/[shopCode]/page.tsx:155)
  - [analysis/orders/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/analysis/orders/page.tsx:152)
- Query does direct equality on `order_settlement_status` in [content-ops/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:653).
- Facts page still exposes wrong statuses in [facts/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/facts/page.tsx:45).
- Live DB real statuses are only `settled`, `pending`, `awaiting_payment`, `ineligible`.

Impact:
- Blocks usability

### 8. Import flow does not meet the requested validation contract

Why it matters:
- The required import behavior is `validate before insert`, `preview before import`, `parse / insert / validate separated`, and `UI shows real error`.
- Current Content Ops upload path is batch-first and staging-first.

Evidence:
- API route directly imports after temp-file write in [route.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/api/content-ops/tiktok-affiliate/upload/route.ts:40).
- Importer creates batch, inserts staging rows, then calls normalization RPC in [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:213).
- No preview page exists in the Content Ops upload route.

Impact:
- Blocks production-readiness
- Harms trustworthiness

### 9. Duplicate file handling is weaker than the UI claims

Why it matters:
- The upload screen promises safe idempotent re-uploads.
- Actual behavior allows repeated batches/raw rows for the same file hash.

Evidence:
- UI copy in [upload/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx:135) and [upload/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx:299).
- Live DB showed 24 batches but only 12 distinct file hashes, with 11 duplicate-hash groups.

Impact:
- Harms trustworthiness
- Raises operational cleanup cost

## UI

### 10. The main operator surface still preserves the dev-centric mental model

Why it matters:
- The required mental model is `Video -> Product / Shop -> Sales (Import) -> Cost -> Profit`.
- The current operator console still centers `Facts -> Attribution -> Profit`.

Evidence:
- [tiktok-affiliate/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/page.tsx:95)
- [tiktok-affiliate/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/page.tsx:145)
- [tiktok-affiliate/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/page.tsx:220)

Impact:
- Blocks usability

### 11. Data Health presents confidence-sounding metrics that are not real coverage metrics

Why it matters:
- This page can give false reassurance.
- Coverage values should reflect actual mapping/linkage quality, not proxy math.

Evidence:
- `Coverage: assume 100% if data exists` in [content-ops/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:816).
- `productMapped = 100` and `shopMapped = 100` when any data exists.

Impact:
- Harms trustworthiness

### 12. Cost page copy does not match actual DB allocation logic

Why it matters:
- Users can make wrong operational assumptions about how content-only costs spread.

Evidence:
- UI says blank `product_id` allocates by realized GMV share in [costs/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/costs/page.tsx:94).
- Migration 097 explicitly says allocation uses `actual_commission_share` first and GMV only as fallback in [migration-097-tiktok-affiliate-content-profit-layer.sql](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql:88).

Impact:
- Harms trustworthiness
