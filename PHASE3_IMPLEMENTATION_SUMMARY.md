# PHASE3_IMPLEMENTATION_SUMMARY

Date: 2026-04-03

## Architecture Summary

Phase 3 stays fully inside the Content Ops / Content Attribution module.

Final module flow:

1. `migration-094-tiktok-affiliate-content-attribution.sql`
   Raw TikTok affiliate rows land in `public.tiktok_affiliate_import_batches` and `public.tiktok_affiliate_order_raw_staging`, then normalize into `public.content_order_facts`.
2. `migration-095-tiktok-affiliate-content-analytics.sql`
   Interim daily analytics views sit on top of `public.content_order_facts`.
3. `migration-096-tiktok-content-order-attribution.sql`
   Final attribution winners are exposed through:
   - `public.content_order_attribution_candidates`
   - `public.content_order_attribution`
4. `migration-097-tiktok-affiliate-content-profit-layer.sql`
   Final attribution winners feed:
   - `public.tt_content_costs`
   - `public.tt_content_cost_allocations`
   - `public.content_profit_attribution_summary`
   via refresh functions.
5. `migration-098-tiktok-affiliate-content-review-fixes.sql`
   Review fixes keep interim analytics semantics aligned with the locked realized/open/lost mapping.

Isolation rules preserved:

- no UI changes in this implementation set
- no SaaS sales, finance, wallet, reconciliation, or shared P&L integration
- no fuzzy joins
- no split attribution
- currency-safe money aggregation only

## Migration Order

1. `database-scripts/migration-094-tiktok-affiliate-content-attribution.sql`
2. `database-scripts/migration-095-tiktok-affiliate-content-analytics.sql`
3. `database-scripts/migration-096-tiktok-content-order-attribution.sql`
4. `database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql`
5. `database-scripts/migration-098-tiktok-affiliate-content-review-fixes.sql`

## Tables / Views Added

Tables:

- `public.tiktok_affiliate_import_batches`
- `public.tiktok_affiliate_order_raw_staging`
- `public.content_order_facts`
- `public.tt_content_costs`
- `public.tt_content_cost_allocations`
- `public.content_profit_attribution_summary`

Views:

- `public.content_order_analytics_daily_base`
- `public.content_performance_daily`
- `public.content_product_performance_daily`
- `public.product_performance_daily`
- `public.content_channel_split_daily`
- `public.content_loss_daily`
- `public.content_order_attribution_candidates`
- `public.content_order_attribution`

Functions / pipelines:

- `public.normalize_tiktok_affiliate_order_batch(uuid)`
- `public.refresh_tt_content_cost_allocations(uuid)`
- `public.refresh_content_profit_attribution_summary(uuid)`
- `public.refresh_content_profit_layer(uuid)`
- `database-scripts/tiktok-affiliate-content-attribution-pipeline.sql`
- `database-scripts/tiktok-affiliate-content-profit-pipeline.sql`

## Formulas Used

Normalization:

- normalized fact grain:
  `created_by + order_id + sku_id + product_id + content_id`
- final attribution candidate grain:
  `created_by + order_id + product_id + content_id`
- final attribution winner grain:
  `created_by + order_id + product_id`

Status mapping:

- `settled -> realized`
- `pending -> open`
- `awaiting_payment -> open`
- `ineligible -> lost`
- anything else or mixed unsupported values -> `unknown`

Attribution:

- final winner selection rule:
  latest source fact update, then latest staging timestamp, then status rank, then settlement-date presence, then latest settlement date, then `content_id`
- commission resolver:
  `coalesce(total_earned_amount, total_commission_amount, 0)` at line level

Profit layer:

- direct product-scoped cost:
  `100%` to the matching `content_id + product_id + currency + cost_date`
- content-only cost allocation basis:
  `actual_commission_total` share first
- fallback allocation basis:
  `gmv` share
- if both bases are zero or no same-scope child rows exist:
  keep an explicit unallocated row
- `total_cost = ads_cost + creator_cost + other_cost`
- `profit = commission_realized - total_cost`
- `roi = profit / total_cost`
- `roi = null` when `total_cost = 0`

## Validation Checklist

Run in order:

1. `database-scripts/verify-tiktok-affiliate-content-attribution.sql`
2. `database-scripts/verify-tiktok-affiliate-content-analytics.sql`
3. `database-scripts/verify-tiktok-content-order-attribution.sql`
4. `database-scripts/verify-tiktok-affiliate-content-profit-layer.sql`

Expected checks:

- no duplicate rows at the normalized fact grain
- no duplicate rows at the attribution candidate or final winner grains
- final winner rows reconcile back to `public.content_order_attribution_candidates`
- interim analytics preserve the corrected realized/open/lost semantics
- every cost input reconciles to allocated plus unallocated slices
- direct product-scoped costs remain `100%` direct
- final summary reconciles back to `public.content_order_attribution`
- final summary cost buckets reconcile back to `public.tt_content_cost_allocations`
- `profit` and `roi` formulas hold

## Risks / Follow-ups

- `public.content_order_attribution` is intentionally a view, not a materialized snapshot. Phase 3 refreshes depend on its current output.
- Content-only costs with no same-day attribution basis remain explicitly unallocated by design.
- Interim analytics remain useful operational views, but they are not the final profit surface.
- Creator-level profitability, UI surfaces, and any SaaS integration remain out of scope and should be handled as separate work.
