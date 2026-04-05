# TikTok Content Order Attribution

Status:

- Affiliate normalization foundation: done.
- Interim analytics layer: done.
- Content order attribution transformation layer: done in this file set.
- Full profit / cost / ROI layer: done downstream in `migration-097-tiktok-affiliate-content-profit-layer.sql`.

## Current Objects Identified

- Current raw order table: `public.tiktok_affiliate_order_raw_staging`
- Current normalized order table: `public.content_order_facts`
- Current content registry: TikTok Studio snapshot registry resolved by `frontend/src/lib/content-ops/tiktok-studio-import.ts`
- Current product registry: TikTok Showcase product registry under `D:\AI_OS\data\processed\tiktok-showcase-products`
- Existing content/product fact logic: `public.content_product_performance_daily`, `public.product_performance_daily`, and related analytics views from `migration-095-tiktok-affiliate-content-analytics.sql`

## Data Flow

1. TikTok affiliate Excel rows land in `public.tiktok_affiliate_order_raw_staging`.
2. The normalization RPC promotes valid rows into `public.content_order_facts` at the line-aware grain:
   `created_by + order_id + sku_id + product_id + content_id`
3. `public.content_order_attribution_candidates` rolls those normalized facts up to the business grain candidate:
   `created_by + order_id + product_id + content_id`
4. `public.content_order_attribution` applies deterministic TikTok last-touch winner selection so the final output is exactly:
   `1 row = 1 order + 1 product + 1 content`

## Locked Rules Implemented

- No UI changes.
- No SaaS integration.
- No wallet, finance, reconciliation, P&L, or `sales_orders` joins.
- Deterministic joins only.
- TikTok last-touch only.
- No split attribution.
- No fuzzy matching.
- Business bucket mapping:
  `settled -> realized`
  `pending -> open`
  `awaiting_payment -> open`
  `ineligible -> lost`
- Commission resolver:
  `total_earned_amount` is treated as the source of truth when present.
  `total_commission_amount` is the deterministic fallback.

## Traceability Preserved

Final rows keep:

- `order_id`
- `content_id`
- `product_id`
- `gmv`
- `commission`
- `normalized_status`
- `business_bucket`
- `is_realized`
- `is_open`
- `is_lost`

Final rows also expose source trace columns:

- `source_fact_ids`
- `source_staging_row_ids`
- `source_import_batch_ids`
- `source_sku_ids`
- `source_total_earned_amount`
- `source_total_commission_amount`
- `commission_source_rule`

## Assumptions

- `content_order_facts` remains the canonical normalized source for this module.
- `actual_commission_total` is interpreted from the current module source as `total_earned_amount`, because `content_order_facts` does not yet expose a separate physical column with that exact name.
- `content_id` and `product_id` already represent deterministic join-ready keys, so this change does not introduce new registry ingestion tables.
- If multiple `sku_id` rows exist for the same `order_id + product_id + content_id`, they are intentionally rolled up by summing GMV and resolved commission.
- If conflicting normalized statuses exist inside the same rolled-up candidate, the candidate status becomes `mixed` instead of being coerced.

## Known Edge Cases

- The content and product registries currently live outside the app database flow, so this layer stays join-ready by deterministic IDs rather than enriching from registry metadata tables.
- If the same `order_id + product_id` appears with multiple `content_id` values in normalized facts, the final view keeps one winner only using deterministic last-touch ordering and exposes all competing `content_id` values through `competing_content_ids`.
- Unsupported or conflicting statuses are surfaced explicitly through `normalized_status = 'unknown'` or `normalized_status = 'mixed'`, with `business_bucket = 'unknown'`.
- Currency drift inside the same candidate row is surfaced as `currency = 'MIXED'` and `has_mixed_currency = true`.

## Run Commands

Apply the attribution migration:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -f database-scripts/migration-096-tiktok-content-order-attribution.sql
```

Run validation checks:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -f database-scripts/verify-tiktok-content-order-attribution.sql
```
