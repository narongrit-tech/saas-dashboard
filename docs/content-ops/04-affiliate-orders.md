# Affiliate Orders Layer

Note: This file defines the affiliate orders layer for the Content Ops / Content Attribution module only. It is intentionally isolated from existing SaaS sales, finance, wallet, and reconciliation logic.

## Purpose

The affiliate orders layer gives the module a stable order-attribution source that can be joined to content and product entities without depending on the existing commerce reporting stack.

Its job is to:

- preserve the raw TikTok affiliate export exactly as received
- normalize order-level attribution fields into a consistent fact model
- support joins by `content_id`, `product_id`, `sku_id`, and `order_id`
- keep settlement status separate from attribution semantics

## Current Status

- Affiliate normalization foundation: done.
- Interim analytics layer: done.
- Content order attribution layer: done.
- Full Phase 3 profit layer: done.

## Status Snapshot

### What exists now

- Raw TikTok affiliate files can be staged into a module-local import pipeline.
- Module-local normalization into `content_order_facts` is implemented with the locked grain, validation, and dedupe rules.
- Interim analytics views now exist on top of `content_order_facts` for daily content, content-product, product, channel-split, and loss reporting.

### What is intentionally provisional

- The analytics layer currently treats `total_earned_amount` as a provisional commission signal for reporting.
- Rollups remain module-local and intentionally separate from existing SaaS sales, finance, wallet, and reconciliation logic.
- This upstream orders layer still does not itself define or allocate `ads_cost`, `creator_cost`, `other_cost`, `profit`, or `roi`; those now exist downstream in the dedicated Phase 3 profit layer.

### What exists downstream now

- `migration-096-tiktok-content-order-attribution.sql` adds final winner selection in `public.content_order_attribution`.
- `migration-097-tiktok-affiliate-content-profit-layer.sql` adds module-local cost allocation and `public.content_profit_attribution_summary`.
- This document remains focused on the upstream affiliate orders contract that feeds those layers.

## Current Source And Status

| Item | Current state |
| --- | --- |
| Source | TikTok affiliate Excel export |
| Delivery mode | Manual file export / batch import |
| Current truth source | Raw affiliate Excel rows |
| Current module status | Affiliate normalization foundation done; interim analytics layer done; content order attribution done; full Phase 3 profit layer done |
| Current app status | No Content Ops app integration promised yet |
| Boundary | Module-local data layer only, not a replacement for existing SaaS order or finance tables |

## Observed Raw Fields From TikTok Affiliate Excel

Observed export columns are consistent enough to define a raw staging contract.

| Group | Observed raw fields |
| --- | --- |
| Order identity | `Order ID`, `SKU ID`, `Product ID`, `Product name` |
| Unit and price | `Price`, `Items sold`, `Items refunded`, `Currency`, `GMV` |
| Shop and partner | `Shop name`, `Shop code`, `Affiliate partner`, `Agency` |
| Attribution | `Order type`, `Indirect`, `Commission type`, `Content Type`, `Content ID` |
| Commission rates | `Standard`, `Shop ads`, `TikTok bonus`, `Partner bonus`, `Revenue sharing portion` |
| Estimated commission | `Est. commission base`, `Est. standard commission`, `Est. Shop Ads commission`, `Est. Bonus`, `Est. Affiliate partner bonus`, `Est. IVA`, `Est. ISR`, `Est. PIT`, `Est. revenue sharing portion` |
| Actual commission | `Actual commission base`, `Standard commission`, `Shop Ads commission`, `Bonus`, `Affiliate partner bonus`, `Shared with partner`, `Total final earned amount` |
| Tax | `Tax - ISR`, `Tax - IVA`, `Tax - PIT` |
| Status and dates | `Order settlement status`, `Order date`, `Commission settlement date` |

## Proposed Raw Staging Table

### Table

`tiktok_affiliate_order_raw_staging`

### Grain

`1 raw Excel row`

### Why this layer exists

- preserves the original export before any parsing or dedupe
- keeps source auditability when files overlap or schema drifts
- lets normalization be rerun safely without losing the original row

### Proposed shape

| Column area | Proposed fields |
| --- | --- |
| Row metadata | `id`, `created_at`, `updated_at`, `created_by`, `import_batch_id` |
| File metadata | `source_file_name`, `source_sheet_name`, `source_row_number`, `source_file_hash` |
| Raw business fields | preserve each observed Excel column as text |
| Recovery payload | `raw_payload jsonb` |

### Raw staging rules

- keep every business field as raw text first
- do not dedupe only by `order_id`
- enforce uniqueness at least by file row identity inside a batch
- keep `raw_payload` for recovery when headers change

## Proposed Normalized Tables

### 1. `content_order_facts`

Primary normalized fact for the module.

| Item | Definition |
| --- | --- |
| Grain | `1 deduped order-line-content attribution row` |
| Business key | `order_id + sku_id + product_id + content_id` |
| Purpose | Join affiliate orders to content and product entities |
| Boundary | Module-local fact table, not the same as existing sales order tables |

Key normalized fields:

- `order_id`
- `sku_id`
- `product_id`
- `content_id`
- `content_type`
- `product_name`
- `shop_name`
- `currency`
- `order_date`
- `commission_settlement_date`
- `order_settlement_status`
- `attribution_type`
- `is_indirect`
- `commission_type_raw`
- `price`
- `items_sold`
- `items_refunded`
- `gmv`
- `total_commission_amount`
- `total_earned_amount`

### 2. `content_video_performance`

Optional daily rollup keyed by `content_id`.

Use:

- daily content-level order count
- daily GMV and commission rollups
- later feed for content performance and loss views

### 3. `content_product_performance`

Optional daily rollup keyed by `content_id + product_id + sku_id`.

Use:

- content-to-product performance tracking
- product attribution summary
- future product-level profit views

## Key Join Strategy

| Key | Role in the module | Notes |
| --- | --- | --- |
| `content_id` | Primary link from affiliate orders to content attribution | Must remain first-class because one order can map to content |
| `product_id` | Primary product join across orders and product registry | Expected cross-link key for Showcase and order data |
| `sku_id` | Line-item precision key | Needed because `order_id` alone is not enough |
| `order_id` | Commercial order umbrella key | Useful for reconciliation and order grouping, but not unique by itself |

### Join rules

- use `content_id` for content-level attribution
- use `product_id` for product registry joins
- use `sku_id` when line-level precision matters
- use `order_id` for grouping and order-level sanity checks, not as a sole dedupe key

## Settlement Status vs Attribution Source

These are separate dimensions and must not be collapsed into one field.

| Concept | Meaning | Example raw source |
| --- | --- | --- |
| Settlement / order status | Whether the order is settled, pending, awaiting payment, or ineligible | `Order settlement status` |
| Attribution source / order type | Why the order is credited to the row | `Order type`, `Indirect` |

### Recommended normalized fields

| Normalized field | Purpose |
| --- | --- |
| `order_settlement_status` | Business outcome state |
| `order_settlement_status_raw` | Preserved source text |
| `attribution_type` | Attribution bucket such as `affiliate`, `shop_ads`, `indirect`, `unknown` |
| `order_type_raw` | Preserved order type source text |
| `is_indirect` | Explicit indirect flag |

## Known Risks And Ambiguities

- `order_id` is not sufficient as a unique key because one order can contain multiple lines.
- A small number of orders may map to more than one `content_id`, so `content_id` must stay in the fact grain.
- Overlapping export windows can create repeated rows across files or batches.
- `Order type` and `Indirect` are related but not identical signals.
- `Commission type` exists in raw data but should stay raw until its semantics are confirmed.
- `Affiliate partner` and `Agency` can be blank and should be preserved without making them required joins.
- `Content Type` can include `Video`, `LIVE`, `Showcase`, and other values, so the module should preserve the raw type.
- Monetary values arrive as exported text and need controlled numeric parsing.

## Locked V1 Execution Rules

These rules are implementation contract, not optional guidance.

### Settlement Mapping Rules

Raw status matching is case-insensitive after trim and whitespace collapse.

| Raw value | Normalized status | `is_successful` | `is_cancelled` | `is_eligible_for_commission` | Notes |
| --- | --- | --- | --- | --- | --- |
| `Settled` | `settled` | `true` | `false` | `true` | Final realized outcome. Counts in `successful_orders`. Eligible for `expected_commission` and `actual_commission`. |
| `Pending` | `pending` | `false` | `false` | `true` | Open but commission-eligible. Counts in `expected_commission`, not in `actual_commission`. Treat as not yet realized in outcome views. |
| `AwaitingPayment` | `awaiting_payment` | `false` | `false` | `false` | Order exists but payment is not completed yet. Exclude from commission metrics until status changes. |
| `Awaiting Payment` | `awaiting_payment` | `false` | `false` | `false` | Same rule as `AwaitingPayment`. |
| `Ineligible` | `ineligible` | `false` | `true` | `false` | Final failed/cancelled outcome for v1. Counts in `cancelled_orders`, `lost_gmv`, and `lost_commission`. |
| blank / null | `unknown` | `false` | `false` | `false` | Preserve raw text as null/blank source value. Exclude from success, cancel, and commission metrics. |
| any other value | `unknown` | `false` | `false` | `false` | Preserve source text in `order_settlement_status_raw`. Do not coerce to another status without an explicit spec update. |

### Dedupe Strategy

#### Natural grain

- Raw staging identity is `created_by + import_batch_id + source_file_name + source_sheet_name + source_row_number`.
- Logical normalized grain is `created_by + order_id + sku_id + product_id + content_id`.
- `content_order_facts` must contain at most one current row per logical normalized grain.

#### Duplicate detection rule

- Parse and normalize all business fields first.
- Partition rows by logical normalized grain.
- Compute a deterministic `normalized_row_version_hash` from all normalized business fields except row metadata and file metadata.
- Same logical normalized grain plus same `normalized_row_version_hash` means repeated duplicate.
- Same logical normalized grain plus different `normalized_row_version_hash` means conflicting version of the same logical row.

#### Tie-break priority

When more than one row exists for the same logical normalized grain, keep exactly one winner in `content_order_facts` using this priority order:

1. latest raw staging `created_at`
2. higher settlement finality rank: `settled` and `ineligible` > `pending` > `awaiting_payment` > `unknown`
3. non-null `commission_settlement_date`
4. higher raw staging `id`

#### Repeated rows across batches

- Keep every repeated row in raw staging for auditability.
- Do not create additional fact rows for repeated duplicates.
- Point the fact row to the winning `staging_row_id`.

#### Conflicting versions of the same logical row

- Treat conflicting versions as updates to one logical row, not as separate facts.
- The winner replaces the prior current version in `content_order_facts`.
- Older conflicting versions remain in raw staging only.
- V1 does not maintain a separate normalized history table.

### Numeric Parsing Rules

#### Field groups

- Money fields: `Price`, `GMV`, all `Est.*` commission/tax amounts, all actual commission/tax amounts, `Shared with partner`, `Total final earned amount`
- Rate fields: `Standard`, `Shop ads`, `TikTok bonus`, `Partner bonus`, `Revenue sharing portion`
- Count fields: `Items sold`, `Items refunded`

#### Common parsing rules

- Trim leading and trailing whitespace first.
- Treat `''`, `'-'`, `'--'`, `'N/A'`, `'n/a'`, `'NULL'`, and `'null'` as null.
- Remove thousands separators `,`.
- Preserve the original raw text in staging even when parsing succeeds.
- Invalid numeric text must not be silently converted to `0`.

#### Money fields

- Allow one optional leading currency symbol from `฿`, `$`, `€`, `£`, `¥`.
- After cleanup, valid money text must match `^-?\\d+(\\.\\d+)?$`.
- `%` is never allowed in a money field.
- Store parsed money as `numeric(18,2)` using round-half-away-from-zero to 2 decimal places.
- Parsed negative values are invalid in v1 and must fail validation.

#### Rate fields

- Accept `12.5%`, `0.125`, or `12.5`.
- If the raw value ends with `%`, strip `%` and divide by `100`.
- If the raw value does not end with `%` and parses between `0` and `1`, keep it as-is.
- If the raw value does not end with `%` and parses greater than `1` and less than or equal to `100`, divide by `100`.
- Store parsed rates as fractional `numeric(9,6)`.
- Parsed rate values below `0` or above `1` after normalization are invalid.

#### Count fields

- Valid count text must match `^\\d+$` after cleanup.
- Store parsed counts as integer.
- Decimal counts and negative counts are invalid.

#### Currency preservation

- Preserve `currency_raw` exactly as exported text.
- Normalize `currency` as trimmed uppercase text only.
- Do not perform FX conversion anywhere in this module.
- Any aggregation that sums money must group by `currency`.

#### Invalid values

- If any non-blank money, rate, or count field fails parsing, the row stays in raw staging and is rejected from `content_order_facts`.
- Blank optional numeric fields may remain null.
- Required key failures and numeric parse failures must be surfaced in the import validation output.

### Validation Checklist

The normalization job is not considered successful unless these checks pass.

#### 1. Duplicate grain

```sql
SELECT created_by, order_id, sku_id, product_id, content_id, COUNT(*) AS dup_count
FROM public.content_order_facts
GROUP BY 1, 2, 3, 4, 5
HAVING COUNT(*) > 1;
```

Expected result: `0` rows.

#### 2. Missing `content_id`

```sql
SELECT COUNT(*) AS missing_content_id
FROM public.tiktok_affiliate_order_raw_staging
WHERE NULLIF(TRIM(content_id), '') IS NULL;
```

Expected result: tracked explicitly and excluded from fact load.

#### 3. Missing `product_id`

```sql
SELECT COUNT(*) AS missing_product_id
FROM public.tiktok_affiliate_order_raw_staging
WHERE NULLIF(TRIM(product_id), '') IS NULL;
```

Expected result: tracked explicitly and excluded from fact load.

#### 4. Malformed monetary values

Check every non-blank money field where raw text is present but parsed numeric value is null.

Expected result: `0` fact-loaded rows with malformed money text.

#### 5. Impossible negative values

```sql
SELECT COUNT(*) AS negative_value_rows
FROM public.content_order_facts
WHERE price < 0
   OR gmv < 0
   OR items_sold < 0
   OR items_refunded < 0
   OR total_commission_amount < 0
   OR total_earned_amount < 0;
```

Expected result: `0` rows.

#### 6. Null or unknown settlement statuses

```sql
SELECT order_settlement_status, COUNT(*) AS row_count
FROM public.content_order_facts
WHERE order_settlement_status IS NULL
   OR order_settlement_status = 'unknown'
GROUP BY 1;
```

Expected result: `0` rows for implemented known statuses; any non-zero result requires raw-value review.

#### 7. Fact-to-staging reconciliation

For each `import_batch_id`, validate:

- `loaded_fact_rows <= staging_rows`
- `SUM(fact.gmv)` equals the sum of parsed staging GMV for fact-loaded winning rows
- `SUM(fact.total_earned_amount)` equals the sum of parsed staging earned amount for fact-loaded winning rows
- rejected staging rows are accounted for by explicit validation errors

Batch reconciliation must be zero-difference after rounding to 2 decimals.

## Downstream Dependency Chain From This Layer

1. Keep the affiliate normalization foundation as the stable source for module-local attribution facts.
2. Continue using the interim analytics layer for operational reporting only.
3. Use `migration-096-tiktok-content-order-attribution.sql` for deterministic final winner selection.
4. Use `migration-097-tiktok-affiliate-content-profit-layer.sql` for cost allocation and final profit summary refreshes.

## Implementation Readiness

- [x] Raw source identified
- [x] Raw field inventory identified
- [x] Raw staging grain defined
- [x] Normalized fact grain defined
- [x] Join keys defined
- [x] Status vs attribution split defined
- [x] Parser/import implementation
- [x] Module-local normalization job
- [x] Validation and reconciliation pass
- [x] Interim analytics dependency available on top of `content_order_facts`
- [x] Full Phase 3 profit layer
- [x] Engine-level joins to final profit views
