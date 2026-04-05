# TikTok Affiliate Content Profit Layer

Status:

- Affiliate normalization foundation: done.
- Interim analytics layer: done.
- Content order attribution layer: done.
- Full Phase 3 profit layer: done in this migration set.

## Scope

This layer stays inside the Content Ops / Content Attribution module.

It adds:

- module-local `public.tt_content_costs`
- module-local `public.tt_content_cost_allocations`
- module-local `public.content_profit_attribution_summary`
- refresh functions that read the final attribution output from `public.content_order_attribution`

It does not add:

- UI changes
- SaaS sales integration
- wallet integration
- finance or reconciliation integration
- shared P&L logic

## Migration Order

1. `database-scripts/migration-094-tiktok-affiliate-content-attribution.sql`
2. `database-scripts/migration-095-tiktok-affiliate-content-analytics.sql`
3. `database-scripts/migration-096-tiktok-content-order-attribution.sql`
4. `database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql`
5. `database-scripts/migration-098-tiktok-affiliate-content-review-fixes.sql`

## Final Objects

- Input table: `public.tt_content_costs`
- Allocation table: `public.tt_content_cost_allocations`
- Final summary table: `public.content_profit_attribution_summary`
- Refresh functions:
  - `public.refresh_tt_content_cost_allocations(uuid)`
  - `public.refresh_content_profit_attribution_summary(uuid)`
  - `public.refresh_content_profit_layer(uuid)`

## Connection To Attribution

- Final order winners come from `public.content_order_attribution`.
- Profit refreshes do not rebuild attribution and do not join raw costs to raw order rows.
- Content-only costs allocate only within the matching `created_by + content_id + currency + cost_date` scope.

## Locked Formulas

- `profit = commission_realized - total_cost`
- `roi = profit / total_cost`
- `roi = null` when `total_cost = 0`
- direct product-scoped costs allocate `100%` to that product row
- content-only costs allocate by `actual_commission_total` share first, then `gmv` share, otherwise remain explicitly unallocated

## Validation

Validation file:

- `database-scripts/verify-tiktok-affiliate-content-profit-layer.sql`

Key checks:

1. Final summary duplicate grain check
2. Allocation duplicate / shape check
3. Raw cost conservation per `cost_id`
4. Direct-scope costs stay `100%` direct
5. Final summary reconciles back to `public.content_order_attribution`
6. Final summary cost buckets reconcile back to `public.tt_content_cost_allocations`
7. `profit` and `roi` formulas hold
8. Unallocated costs remain visible instead of hidden

## Run Commands

Apply the profit migration:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -f database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql
```

Refresh the full Phase 3 layer:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -v created_by="'<auth_user_uuid>'" -f database-scripts/tiktok-affiliate-content-profit-pipeline.sql
```

Run validation:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -f database-scripts/verify-tiktok-affiliate-content-profit-layer.sql
```
