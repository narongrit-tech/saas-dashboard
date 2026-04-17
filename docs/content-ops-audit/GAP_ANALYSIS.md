# Content Ops Audit: Gap Against Target

Target structure:

1. Video
2. Product / Shop
3. Sales (Import)
4. Cost
5. Profit

Target user flow:

`Upload Sales -> Map Product -> Link Video -> Add Cost -> See Profit`

## Video

What already exists:
- A visible Content Library route at [library/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/library/page.tsx:1).
- A file-based Studio import resolver at [tiktok-studio-import.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-studio-import.ts:1).

What exists but is in the wrong place or shape:
- The library is effectively a Studio snapshot viewer, not a content entity system wired to sales/profit.
- It sits outside the real operator flow and still contains placeholder controls and unassigned ownership.

What is missing:
- DB-backed video/content records that are operationally linked to `product_id`, `shop_code`, imported sales, costs, and profit.
- A real "Link Video" step in the operator flow.

What should be refactored or removed:
- Placeholder action affordances on the library page.
- "Phase 2.5" framing once a real operational flow exists.

## Product / Shop

What already exists:
- Real product and shop pages backed by facts:
  - [products/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/products/page.tsx:1)
  - [shops/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/shops/page.tsx:1)
- Persistent DB registries exist:
  - `tt_product_master`
  - `tt_shop_master`

What exists but is in the wrong place or shape:
- Runtime pages still aggregate from `content_order_facts` instead of using the persistent master tables.
- Detail pages still point into a broken status-filter flow.

What is missing:
- A stable product/shop registry-driven UI aligned to the operator flow.
- Clear "Map Product" behavior in the upload-to-profit path.

What should be refactored or removed:
- Facts-first product/shop aggregation as the primary runtime source.
- Unused master actions unless they become the real source.

## Sales (Import)

What already exists:
- Real upload route and importer:
  - [upload/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx:1)
  - [route.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/api/content-ops/tiktok-affiliate/upload/route.ts:1)
  - [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:1)
- Live data confirms the pipeline has processed real volumes into facts.

What exists but is in the wrong place or shape:
- The operator surface still promotes `Facts` and `Attribution` as user steps.
- Import behavior is not preview-first and not validate-before-write.

What is missing:
- Preview-before-import.
- Reject-before-write behavior for bad rows.
- Clear product mapping step after sales import.
- A reliable import error/reporting contract.

What should be refactored or removed:
- Idempotent marketing copy that overstates current duplicate protection.
- Dev-centric `Upload -> Facts -> Attribution` framing as the primary operator story.

## Cost

What already exists:
- Real `tt_content_costs` table and insert/delete UI.
- Real allocation schema in migration 097.

What exists but is in the wrong place or shape:
- Cost is technically isolated correctly, but the current page copy is slightly wrong about allocation rules.
- Cost entry is not yet part of a proven working end-to-end loop because there is no live cost data.

What is missing:
- Real operational use of the cost layer.
- Evidence that costs are being entered, allocated, and checked against profit output in production-like usage.

What should be refactored or removed:
- Copy that says blank `product_id` allocates by GMV share only.

## Profit

What already exists:
- Real summary table and refresh action.
- Correct isolated module-local schema shape in migration 097.

What exists but is in the wrong place or shape:
- Profit is visible in the UI even though the current live data state does not support trustworthy business interpretation.

What is missing:
- Real allocated costs.
- Real refreshed summary across the imported dataset.
- Trustworthy operator messaging that distinguishes "technical table exists" from "profit is ready."

What should be refactored or removed:
- Any implication that profit is business-ready before costs and allocations exist.

## Net Gap Summary

Closest-to-target pieces:
- Sales import foundation
- Facts normalization
- Product/shop pages
- Cost table and profit schema

Exists but misplaced or misleading:
- Product/shop master tables exist but are not the runtime source
- Attribution is treated as an operator destination instead of a backend transformation
- Data Health overstates certainty
- Profit page exists before the cost layer is actually in use

Missing for the target structure:
- Real video-to-sales linkage
- Real product-mapping step in user flow
- Preview-first import
- Trustworthy cost/profit loop
