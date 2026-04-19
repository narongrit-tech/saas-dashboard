# TikTok Affiliate Content Analytics Layer

Status:

- Affiliate normalization foundation: done.
- Interim analytics layer: done.
- Content order attribution layer: done.
- Full Phase 3 profit layer: done.

## Status Snapshot

### What exists now

- Module-local analytics views exist on top of `public.content_order_facts`.
- The layer supports daily content, content-product, product, channel-split, and loss analytics.
- This deliverable passed as an interim analytics layer after the attribution foundation.

### What is intentionally provisional

- `total_earned_amount` is still treated as a provisional commission signal for analytics.
- The layer intentionally excludes creator scope and does not replace the final Phase 3 profit summary.
- This is not a replacement for existing SaaS logic.

### What exists downstream now

- `migration-096-tiktok-content-order-attribution.sql` adds the deterministic final winner layer.
- `migration-097-tiktok-affiliate-content-profit-layer.sql` adds the module-local cost allocation and final profit summary.
- This README remains focused on the analytics views only.

## Scope

This layer is isolated to the Content Ops / Content Attribution module.

It creates only module-local analytics views on top of `public.content_order_facts`:

- `public.content_order_analytics_daily_base`
- `public.content_performance_daily`
- `public.content_product_performance_daily`
- `public.product_performance_daily`
- `public.content_channel_split_daily`
- `public.content_loss_daily`

It does not touch:

- existing SaaS sales tables
- existing SaaS finance tables
- existing wallet tables
- existing reconciliation tables
- existing dashboard logic or UI
- existing SaaS RPCs
- cost allocation or final profit logic
- creator-level analytics or creator profitability views

## File Locations

- Migration: `database-scripts/migration-095-tiktok-affiliate-content-analytics.sql`
- Verification: `database-scripts/verify-tiktok-affiliate-content-analytics.sql`
- Foundation dependency: `database-scripts/migration-094-tiktok-affiliate-content-attribution.sql`

## Design Notes

- Views-first implementation: no physical rollup tables in this round.
- Daily business date: `DATE(order_date AT TIME ZONE 'Asia/Bangkok')`.
- Commission basis for this round: `total_earned_amount` is used exactly as the requested provisional `actual_commission_total`.
- Loss basis for this round: `lost_orders`, `lost_gmv`, and `lost_commission` are driven by failed-or-cancelled outcomes.
- No expected commission, allocation, profit, ROI, or final business-truth reinterpretation is added here.
- This deliverable should be treated as an interim analytics layer on the path to Phase 3, not as full Phase 3 completion.

## Currency Safety

The source-of-truth docs explicitly require any money aggregation to group by `currency`.

Because of that, every analytics view includes `currency` in its grain even though the draft field list omitted it. This avoids silently summing different currencies together.

## Implemented Views

### 1. `public.content_performance_daily`

Grain:

- `created_by + content_id + currency + order_date`

Fields:

- `created_by`
- `content_id`
- `content_type`
- `currency`
- `order_date`
- `total_orders`
- `successful_orders`
- `failed_orders`
- `cancelled_orders`
- `total_units_sold`
- `total_units_refunded`
- `gmv_total`
- `actual_commission_total`
- `lost_gmv`
- `lost_commission`
- `success_rate`
- `cancel_rate`

### 2. `public.content_product_performance_daily`

Grain:

- `created_by + content_id + product_id + sku_id + currency + order_date`

Fields:

- `created_by`
- `content_id`
- `product_id`
- `sku_id`
- `product_name`
- `content_type`
- `currency`
- `order_date`
- `total_orders`
- `successful_orders`
- `failed_orders`
- `cancelled_orders`
- `total_units_sold`
- `total_units_refunded`
- `gmv_total`
- `actual_commission_total`
- `lost_gmv`
- `lost_commission`

### 3. `public.product_performance_daily`

Grain:

- `created_by + product_id + sku_id + currency + order_date`

Fields:

- `created_by`
- `product_id`
- `sku_id`
- `product_name`
- `currency`
- `order_date`
- `total_orders`
- `successful_orders`
- `failed_orders`
- `cancelled_orders`
- `total_units_sold`
- `gmv_total`
- `actual_commission_total`
- `lost_gmv`
- `lost_commission`

### 4. `public.content_channel_split_daily`

Grain:

- `created_by + content_id + currency + order_date + attribution_type`

Fields:

- `created_by`
- `content_id`
- `currency`
- `order_date`
- `attribution_type`
- `total_orders`
- `gmv_total`
- `actual_commission_total`
- `lost_gmv`
- `lost_commission`

### 5. `public.content_loss_daily`

Grain:

- `created_by + content_id + currency + order_date`

Fields:

- `created_by`
- `content_id`
- `currency`
- `order_date`
- `lost_orders`
- `lost_gmv`
- `lost_commission`
- `cancelled_orders`
- `failed_orders`
- `cancel_rate`

## Formulas Implemented

- `successful_orders = COUNT(*) WHERE outcome_status = 'realized'`
- `cancelled_orders = COUNT(*) WHERE outcome_status = 'lost'`
- `failed_orders = COUNT(*) WHERE outcome_status = 'unknown'`
- `lost_orders = COUNT(*) WHERE outcome_status = 'lost'`
- `lost_gmv = SUM(gmv) WHERE outcome_status = 'lost'`
- `lost_commission = SUM(reported_commission_amount) WHERE outcome_status = 'lost'`
- `actual_commission_total = SUM(actual_commission_amount)` where `actual_commission_amount` is settled-only
- `success_rate = successful_orders / total_orders`
- `cancel_rate = cancelled_orders / total_orders`

## Example Queries

Top content by actual commission:

```sql
SELECT
  content_id,
  content_type,
  currency,
  SUM(actual_commission_total) AS actual_commission_total,
  SUM(gmv_total) AS gmv_total,
  SUM(successful_orders) AS successful_orders
FROM public.content_performance_daily
WHERE created_by = '<auth_user_uuid>'
  AND order_date BETWEEN DATE '2026-04-01' AND DATE '2026-04-30'
GROUP BY content_id, content_type, currency
ORDER BY actual_commission_total DESC
LIMIT 25;
```

Daily loss view for content:

```sql
SELECT
  order_date,
  currency,
  lost_orders,
  lost_gmv,
  lost_commission,
  cancelled_orders,
  failed_orders,
  cancel_rate
FROM public.content_loss_daily
WHERE created_by = '<auth_user_uuid>'
  AND content_id = '<content_id>'
ORDER BY order_date DESC, currency;
```

Product winners and losers:

```sql
SELECT
  product_id,
  sku_id,
  product_name,
  currency,
  SUM(total_orders) AS total_orders,
  SUM(actual_commission_total) AS actual_commission_total,
  SUM(lost_gmv) AS lost_gmv
FROM public.product_performance_daily
WHERE created_by = '<auth_user_uuid>'
  AND order_date BETWEEN DATE '2026-04-01' AND DATE '2026-04-30'
GROUP BY product_id, sku_id, product_name, currency
ORDER BY actual_commission_total DESC, lost_gmv ASC;
```

Channel split for one content item:

```sql
SELECT
  order_date,
  currency,
  attribution_type,
  total_orders,
  gmv_total,
  actual_commission_total,
  lost_gmv,
  lost_commission
FROM public.content_channel_split_daily
WHERE created_by = '<auth_user_uuid>'
  AND content_id = '<content_id>'
ORDER BY order_date DESC, currency, attribution_type;
```

Content-to-product breakdown:

```sql
SELECT
  content_id,
  product_id,
  sku_id,
  product_name,
  content_type,
  currency,
  SUM(total_orders) AS total_orders,
  SUM(successful_orders) AS successful_orders,
  SUM(cancelled_orders) AS cancelled_orders,
  SUM(actual_commission_total) AS actual_commission_total
FROM public.content_product_performance_daily
WHERE created_by = '<auth_user_uuid>'
  AND order_date BETWEEN DATE '2026-04-01' AND DATE '2026-04-30'
GROUP BY content_id, product_id, sku_id, product_name, content_type, currency
ORDER BY actual_commission_total DESC;
```

## Exact Run Commands

If the attribution foundation is not applied yet:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -f database-scripts/migration-094-tiktok-affiliate-content-attribution.sql
```

Apply the analytics layer:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -f database-scripts/migration-095-tiktok-affiliate-content-analytics.sql
```

Run foundation verification:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -f database-scripts/verify-tiktok-affiliate-content-attribution.sql
```

Run analytics verification:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -f database-scripts/verify-tiktok-affiliate-content-analytics.sql
```

## Known Limitations

- `total_earned_amount` is treated as the requested provisional commission signal for analytics only; this README does not promote it to final business truth.
- This deliverable remains an interim analytics layer even though full Phase 3 now exists downstream, because these views are not the final profit summary.
- These views do not implement expected commission, commission loss rate, creator performance, ads cost, creator cost, other cost, profit, or ROI.
- Rows with `order_date IS NULL` are excluded because a daily grain cannot be formed safely.
- Descriptor fields such as `content_type` and `product_name` use `MAX(...)` inside a grain when multiple values exist; the verification file includes drift checks to surface those inconsistencies.
- No FX conversion exists in this module. Cross-currency totals must stay grouped by `currency`.
