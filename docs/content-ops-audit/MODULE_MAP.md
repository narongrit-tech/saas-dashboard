# Content Ops Audit: Module Map

## Routes And Pages

| Route | File | Real source | Current state |
|---|---|---|---|
| `/content-ops` | [page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/page.tsx:1) | `content_order_facts` via [actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:850) | Real overview, but still facts-first and status links are broken |
| `/content-ops/analysis/orders` | [orders/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/analysis/orders/page.tsx:1) | `content_order_facts` via [getOrdersExplorer](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:633) | Real table, but broken status filter values |
| `/content-ops/analysis/attribution` | [attribution/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/analysis/attribution/page.tsx:1) | `content_order_attribution` via [getAttributionFull](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:704) | Exists, but likely times out on real volume |
| `/content-ops/data-health` | [data-health/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/data-health/page.tsx:1) | counts from facts/batches/attribution/cost/profit via [getDataHealth](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:791) | Visible, but metrics are partially fabricated |
| `/content-ops/library` | [library/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/library/page.tsx:1) | local registry/sample fallback via [tiktok-studio-import.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-studio-import.ts:1) | File-backed Studio view, not integrated into operator flow |
| `/content-ops/products` | [products/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/products/page.tsx:1) | `content_order_facts` via [getProductList](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:194) | Real page, not using `tt_product_master` |
| `/content-ops/products/[productId]` | [products/[productId]/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/products/[productId]/page.tsx:1) | `content_order_facts` via [getProductDetail](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:305) | Real detail page, but status links are broken |
| `/content-ops/shops` | [shops/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/shops/page.tsx:1) | `content_order_facts` via [getShopList](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:423) | Real page, not using `tt_shop_master` |
| `/content-ops/shops/[shopCode]` | [shops/[shopCode]/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/shops/[shopCode]/page.tsx:1) | `content_order_facts` via [getShopDetail](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:518) | Real detail page, but status links are broken |
| `/content-ops/tiktok-affiliate` | [tiktok-affiliate/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/page.tsx:1) | pipeline counts via [getPipelineStatus](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:103) | Dev-centric operator console (`Upload -> Facts -> Attribution -> Profit`) |
| `/content-ops/tiktok-affiliate/upload` | [upload/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx:1) | POST `/api/content-ops/tiktok-affiliate/upload` | Real upload UI, but no preview and misleading idempotent messaging |
| `/content-ops/tiktok-affiliate/batches` | [batches/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/batches/page.tsx:1) | `tiktok_affiliate_import_batches` via [getBatches](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:163) | Real import history |
| `/content-ops/tiktok-affiliate/facts` | [facts/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/facts/page.tsx:1) | `content_order_facts` via [getFacts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:181) | Real facts page, but wrong status options |
| `/content-ops/tiktok-affiliate/attribution` | [attribution/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/attribution/page.tsx:1) | `content_order_attribution` via [getAttribution](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:230) | Real route, but query pattern does not scale cleanly |
| `/content-ops/tiktok-affiliate/costs` | [costs/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/costs/page.tsx:1) | `tt_content_costs` via [getCosts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:261) | Real CRUD surface, but currently disconnected from live profit outcomes |
| `/content-ops/tiktok-affiliate/profit` | [profit/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/profit/page.tsx:1) | `content_profit_attribution_summary` via [getProfit](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:327) | Real route, but current data is not trustworthy |
| `/content-ops/tiktok-affiliate/verification` | [verification/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/verification/page.tsx:1) | read-only checks via [runVerification](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:355) | Real checks UI, but not enough to offset query and data-truth issues |

## Major Components

- [date-range-filter.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/components/content-ops/date-range-filter.tsx:1)
  - Shared date filter used on overview and orders explorer.
- [entity-avatar.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/components/content-ops/entity-avatar.tsx:1)
  - Placeholder/avatar-only visual treatment for product/shop lists.
- [full-table.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/components/content-ops/full-table.tsx:1)
  - Shared product/shop table component.
- [sparkline.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/components/content-ops/sparkline.tsx:1)
  - Exists for trend UI but is not what currently defines the Content Ops operator flow.

## Server Actions, API, And Hooks

- General Content Ops server actions: [content-ops/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:1)
  - overview
  - product/shop list/detail aggregation
  - orders explorer
  - attribution analysis
  - data health
- TikTok Affiliate server actions: [tiktok-affiliate/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:1)
  - pipeline counts
  - batches/facts/attribution/costs/profit/verification
  - contains unused `getProductMaster()` and `getShopMaster()` actions
- Upload API: [api/content-ops/tiktok-affiliate/upload/route.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/api/content-ops/tiktok-affiliate/upload/route.ts:1)
  - temp-file based `.xlsx` upload entrypoint
- Import library: [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:1)
  - parse workbook
  - create import batch
  - insert raw staging
  - call normalization RPC

## Data Sources

### Runtime DB tables and views actually used

- `tiktok_affiliate_import_batches`
- `tiktok_affiliate_order_raw_staging`
- `content_order_facts`
- `content_order_attribution`
- `tt_content_costs`
- `tt_content_cost_allocations`
- `content_profit_attribution_summary`

### Runtime DB tables/views that exist but are underused or unused

- `tt_product_master`
- `tt_shop_master`
- `content_order_attribution_candidates`

### File-based sources

- TikTok Studio local registry via [tiktok-studio-import.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-studio-import.ts:28)
- Sample fallback data under `frontend/src/lib/content-ops/sample-data/tiktok-studio/**`

## Tables, Views, RPCs, And Migrations

### Migrations

- [migration-094-tiktok-affiliate-content-attribution.sql](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-094-tiktok-affiliate-content-attribution.sql:1)
- [migration-096-tiktok-content-order-attribution.sql](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-096-tiktok-content-order-attribution.sql:1)
- [migration-097-tiktok-affiliate-content-profit-layer.sql](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql:1)
- [migration-102-tiktok-affiliate-product-shop-master.sql](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-102-tiktok-affiliate-product-shop-master.sql:1)
- [migration-103-normalize-function-timeout-fix.sql](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-103-normalize-function-timeout-fix.sql:1)

### DB objects

- `content_order_facts`
  - current operational source of truth for imported sales rows
  - live count: 107,988
- `content_order_attribution_candidates`
  - intermediate collapsed candidates at `order + product + content`
- `content_order_attribution`
  - final winner rows at `order + product`
  - live broad queries time out
- `tt_content_costs`
  - manual cost inputs
  - live count: 0
- `tt_content_cost_allocations`
  - derived cost slices
  - live count: 0
- `content_profit_attribution_summary`
  - final profit summary table
  - live count: 1 stale/manual-looking row
- `tt_product_master`
  - derived persistent product registry
  - live count: 401
- `tt_shop_master`
  - derived persistent shop registry
  - live count: 279

### RPCs

- `normalize_tiktok_affiliate_order_batch`
  - called from [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:303)
- `refresh_content_profit_layer`
  - called from [tiktok-affiliate/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:338)
- `refresh_tt_product_shop_master`
  - defined in [migration-102-tiktok-affiliate-product-shop-master.sql](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-102-tiktok-affiliate-product-shop-master.sql:128)
  - not currently part of the runtime UI flow

## Import Flow

Actual current flow:

1. Upload UI posts file to `/api/content-ops/tiktok-affiliate/upload`.
2. API route writes the upload to a temp `.xlsx` file at [route.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/api/content-ops/tiktok-affiliate/upload/route.ts:40).
3. Importer parses workbook and creates a row in `tiktok_affiliate_import_batches` at [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:213).
4. Importer inserts all parsed rows into `tiktok_affiliate_order_raw_staging` before normalization at [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:289).
5. Importer calls `normalize_tiktok_affiliate_order_batch` at [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:303).
6. Facts become queryable through `content_order_facts`.
7. Attribution and profit are downstream read models on top of facts.

Observed issues in this flow:

- No preview-before-import step.
- Validation/rejection is not fully pre-write; bad rows can still land in raw staging.
- Uploaded original filename is lost because importer uses `path.basename(options.filePath)` on the temp path at [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:183).
- Duplicate file hash protection is not enforced before batch creation.

## Cost / Profit Flow

Current flow:

1. Manual input writes to `tt_content_costs`.
2. Profit refresh calls `refresh_content_profit_layer`.
3. DB refresh derives `tt_content_cost_allocations`.
4. Summary writes to `content_profit_attribution_summary`.

Current live state:

- Cost input surface exists, but no live cost rows exist.
- No live allocation rows exist.
- Profit summary currently contains only one stale/manual-looking row, not a meaningful production summary.

## Where Content Ops Touches Or Leaks Into Other Modules

Content Ops is supposed to stay independent for now, but the repo still contains a parallel older affiliate attribution system.

Leaking legacy surfaces:

- [reports/profit/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/reports/profit/page.tsx:38)
  - still opens `AffiliateImportDialog`
  - still contains TODO placeholders for profit sections
- [components/shared/AffiliateImportDialog.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/components/shared/AffiliateImportDialog.tsx:1)
  - separate preview/import flow for old affiliate data
- [reports/profit/affiliate-import-actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/reports/profit/affiliate-import-actions.ts:715)
  - still writes to `order_attribution`
- [sales/attribution-actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/sales/attribution-actions.ts:28)
  - still queries `order_attribution`
- [affiliates/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/affiliates/actions.ts:245)
  - joins through `order_attribution`

Net effect:

- There are two attribution worlds in the repo:
  - new Content Ops: `content_order_facts` -> `content_order_attribution`
  - old affiliate reporting: `order_attribution`
- This is a real architecture leak and a real source of operator confusion.
