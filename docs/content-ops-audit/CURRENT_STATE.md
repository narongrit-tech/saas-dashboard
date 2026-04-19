# Content Ops Audit: Current State

Audit date: 2026-04-17

Scope:
- `frontend/src/app/(dashboard)/content-ops/**`
- related Content Ops components, server actions, upload/API code, DB migrations, and in-repo docs
- live Supabase reads used to verify row counts and behavior

Reality check:
- The technical pipeline is partly real: import batches, raw staging, normalized facts, attribution SQL, product/shop master tables, and cost/profit schema all exist.
- The operator experience is not yet aligned to the required mental model `Video -> Product / Shop -> Sales (Import) -> Cost -> Profit`.
- Live data is present for imports/facts, but costs are empty and profit is not trustworthy yet.

## Done For Real

- TikTok affiliate file upload exists and writes through a real API route at [route.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/api/content-ops/tiktok-affiliate/upload/route.ts:1).
- Import batches and raw staging are real. Live DB counts:
  - `tiktok_affiliate_import_batches`: 24
  - `tiktok_affiliate_order_raw_staging`: 228,171
- Facts normalization is real and populated. Live DB count:
  - `content_order_facts`: 107,988
- Attribution SQL exists at the correct business grain in [migration-096-tiktok-content-order-attribution.sql](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-096-tiktok-content-order-attribution.sql:1).
  - Candidate grain: `created_by + order_id + product_id + content_id`
  - Winner grain: `created_by + order_id + product_id`
  - Business bucket mapping matches the locked rules.
- Product/shop master schema exists in [migration-102-tiktok-affiliate-product-shop-master.sql](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-102-tiktok-affiliate-product-shop-master.sql:1), and live DB confirms it is populated:
  - `tt_product_master`: 401
  - `tt_shop_master`: 279
- Cost and profit schema exists in [migration-097-tiktok-affiliate-content-profit-layer.sql](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql:1).
- Cost input UI is real and writes to `tt_content_costs` via [actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:261).
- Content library page is real as a file-backed Studio registry viewer via [library/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/library/page.tsx:1) and [tiktok-studio-import.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-studio-import.ts:1).

## Visible But Not Usable

- Attribution UI exists but broad queries are not usable at current data volume.
  - The page uses exact-count and ordered range queries on `content_order_attribution` in [content-ops/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:704).
  - Live DB reproduction of the same query pattern returned `57014 canceling statement due to statement timeout`.
- Verification exists, but some checks depend on the same attribution view and can fail due to query behavior rather than business logic absence. See [verification/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/verification/page.tsx:1) and [tiktok-affiliate/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:355).
- Library page is visible, but operator actions are still placeholders:
  - `Unassigned` hardcoded at [library/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/library/page.tsx:125)
  - disabled `Refresh Latest` at [library/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/library/page.tsx:457)
  - disabled `Rerun Import` at [library/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/library/page.tsx:461)
- Profit page exists, but live data is not business-usable:
  - `tt_content_costs`: 0
  - `tt_content_cost_allocations`: 0
  - `content_profit_attribution_summary`: 1 stale/manual-looking row only

## Partial Or Misleading

- Upload UI claims idempotency in [upload/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx:135) and [upload/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx:299), but live DB shows duplicate file hashes across batches.
  - Result: same file can be re-imported into batches/raw staging repeatedly even if downstream facts dedupe.
- Status filters are broken across core pages because UI sends title-cased labels while DB stores lowercase normalized statuses.
  - Broken examples:
    - [analysis/orders/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/analysis/orders/page.tsx:152)
    - [content-ops/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/page.tsx:108)
    - [products/[productId]/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/products/[productId]/page.tsx:155)
    - [shops/[shopCode]/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/shops/[shopCode]/page.tsx:155)
    - [tiktok-affiliate/facts/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/facts/page.tsx:45)
- Facts page still exposes legacy/wrong statuses `Completed` and `Cancelled` at [facts/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/facts/page.tsx:45), but live DB has zero rows for both and real rows are `settled`, `pending`, `awaiting_payment`, `ineligible`.
- Data Health metrics are partially fabricated:
  - `Coverage: assume 100% if data exists` at [content-ops/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:816)
  - `Attribution not available` can be emitted even when the real issue is query failure/timeouts at [content-ops/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:835)
- Product/shop master exists in DB but the UI still aggregates directly from `content_order_facts`; the dedicated master actions are present but unused:
  - [tiktok-affiliate/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:584)
  - [tiktok-affiliate/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:641)
- Existing docs are stale about migration 102. Example:
  - [CONTENT_OPS_CLOSURE_RUN_REPORT.md](/d:/AI_OS/projects/saas-dashboard/docs/content-ops/CONTENT_OPS_CLOSURE_RUN_REPORT.md:25)
  - [CONTENT_OPS_PRODUCT_SHOP_MASTER_STATE.md](/d:/AI_OS/projects/saas-dashboard/docs/content-ops/CONTENT_OPS_PRODUCT_SHOP_MASTER_STATE.md:10)

## Not Implemented

- A true end-to-end operator flow of `Upload Sales -> Map Product -> Link Video -> Add Cost -> See Profit`.
- A DB-backed video/content entity layer that is actually linked to product/shop/sales/profit.
- Preview-before-import for the Content Ops upload path.
- Real pre-write row rejection before staging insert.
- Reliable attribution UI/query strategy for current row volume.
- Trustworthy cost-to-profit reporting with live allocated costs.
- Removal or isolation of the old affiliate attribution stack still used elsewhere in the app.
