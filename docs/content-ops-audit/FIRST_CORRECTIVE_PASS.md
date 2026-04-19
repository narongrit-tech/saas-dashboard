# First Corrective Pass

## Files Changed

- [frontend/src/app/(dashboard)/content-ops/status-utils.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/status-utils.ts:1)
- [frontend/src/app/(dashboard)/content-ops/attribution-query-utils.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/attribution-query-utils.ts:1)
- [frontend/src/app/(dashboard)/content-ops/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:1)
- [frontend/src/app/(dashboard)/content-ops/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/page.tsx:1)
- [frontend/src/app/(dashboard)/content-ops/analysis/orders/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/analysis/orders/page.tsx:1)
- [frontend/src/app/(dashboard)/content-ops/products/[productId]/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/products/[productId]/page.tsx:1)
- [frontend/src/app/(dashboard)/content-ops/shops/[shopCode]/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/shops/[shopCode]/page.tsx:1)
- [frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:1)
- [frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/facts/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/facts/page.tsx:1)
- [frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/page.tsx:1)
- [frontend/src/app/(dashboard)/content-ops/data-health/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/data-health/page.tsx:1)
- [frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx:1)
- [frontend/src/app/api/content-ops/tiktok-affiliate/upload/route.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/api/content-ops/tiktok-affiliate/upload/route.ts:1)
- [frontend/src/lib/content-ops/tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:1)

## Exact Issues Fixed

- Canonical Content Ops statuses are now centralized and reused across overview, orders, facts, product detail, and shop detail paths.
- Drill links from overview/product/shop pages now pass canonical status keys instead of human labels that broke DB filters.
- Orders and facts filters now normalize legacy status aliases on input, so older bookmarked URLs do not silently fail.
- Facts page no longer presents `Completed` and `Cancelled` as if they are live module statuses.
- Attribution count failures/timeouts are now classified as `timed_out` or `failed` and surfaced as real blocker states in the TikTok affiliate overview and data-health paths.
- Attribution-related server actions no longer collapse failed count queries into `0` rows or "not available".
- Upload API responses for the Content Ops TikTok affiliate upload route now use a standardized error shape:
  `ok: false`, `error.code`, `error.message`, optional `error.stage`.
- Upload UI now reads the new error shape and shows the real message instead of assuming a loose `error` string contract.
- Upload page copy no longer claims fully safe idempotent re-upload.
- Import pipeline now preserves the original uploaded filename when creating/parsing the import batch.

## Exact Issues Intentionally Not Fixed

- No preview-before-import flow was added.
- No validate-before-write redesign was added beyond truthful API/error messaging.
- No attribution query/index redesign was attempted in this pass.
- No video/product/profit architecture refactor was attempted.
- No wallet, finance, reconciliation, or old reporting modules were changed.

## Remaining Blockers

- Attribution queries can still time out under current data volume. The UI is now truthful about that, but the runtime problem still exists.
- Upload still writes to raw staging before the user gets a preview or row-level pre-write validation result.
- Raw batch duplication remains possible even though downstream fact normalization dedupes winners.
- Cost and profit layers remain outside the scope of this pass and are still not trustworthy for production decision-making if costs/allocations are absent.

## Recommended Next Step

- Focus the next pass on attribution runtime stability only. Start with [frontend/src/app/(dashboard)/content-ops/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/actions.ts:1), [frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts:1), and the underlying Supabase objects that serve `content_order_attribution`, then reduce timeout risk without changing the higher-level Content Ops architecture.
