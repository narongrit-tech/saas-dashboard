# Phase 3 Profit Layer

Date: 2026-04-03

Status:

- Phase 3 database layer: implemented.
- UI changes: none in this implementation set.
- SaaS core integration: none.

## Scope

This round stays inside the Content Ops / Content Attribution module.

It adds:

- `public.tt_content_costs`
- `public.tt_content_cost_allocations`
- `public.content_profit_attribution_summary`
- refresh functions and the pipeline wrapper SQL script

It depends on:

- `public.content_order_attribution` from `migration-096-tiktok-content-order-attribution.sql`

It does not touch:

- existing SaaS sales tables
- existing finance tables
- wallet, reconciliation, or shared P&L modules
- UI or dashboard pages

## Design Choices

- `public.content_order_attribution` is the final order winner output and stays a separate migration concern.
- `migration-097-tiktok-affiliate-content-profit-layer.sql` reads that output directly instead of rebuilding attribution.
- `tt_content_costs` requires `content_id` and allows optional `product_id` for direct exact-scope costs.
- `tt_content_cost_allocations` preserves the original cost row link through `cost_id` and stores explicit unallocated rows.
- `content_profit_attribution_summary` is the final aggregated table at `created_by + content_id + product_id + currency`.

## Locked Rules

- Deterministic joins only.
- No fuzzy matching.
- No split attribution across multiple winner rows.
- `actual_commission_total` comes from the attribution output.
- Content-only costs allocate by `actual_commission_total` share first, then `gmv`, otherwise remain unallocated.
- `profit = commission_realized - total_cost`
- `roi = profit / total_cost`, or `NULL` when total cost is zero.

## Run Order

1. `migration-094-tiktok-affiliate-content-attribution.sql`
2. `migration-095-tiktok-affiliate-content-analytics.sql`
3. `migration-096-tiktok-content-order-attribution.sql`
4. `migration-097-tiktok-affiliate-content-profit-layer.sql`
5. `migration-098-tiktok-affiliate-content-review-fixes.sql`

## Pipeline

Apply the migration:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -f database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql
```

Refresh the full Phase 3 derived layer:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -v created_by="'<auth_user_uuid>'" -f database-scripts/tiktok-affiliate-content-profit-pipeline.sql
```

Validate:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -f database-scripts/verify-tiktok-affiliate-content-profit-layer.sql
```
