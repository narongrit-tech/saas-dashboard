# Phase 3 Edge Case Audit

Scope reviewed:
- `migration-096-tiktok-content-order-attribution.sql`
- `migration-097-tiktok-affiliate-content-profit-layer.sql`
- `verify-tiktok-affiliate-content-profit-layer.sql`

Review constraints:
- SQL only
- no UI review
- no SaaS integration review
- no architecture redesign

Audit mode:
- static SQL audit only
- I did not execute these queries against a live database in this pass

## Summary

I did not find a clear critical data-logic break in the final Phase 3 SQL. The core protections are solid:
- final attribution is forced to one row per `created_by + order_id + product_id` via deterministic ranking in [`migration-096-tiktok-content-order-attribution.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-096-tiktok-content-order-attribution.sql#L212C1)
- content-only cost allocation preserves explicit unallocated rows instead of silently dropping remainder or no-basis cases in [`migration-097-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql#L425C1)
- ROI division is protected with `NULLIF(..., 0)` and a table check in [`migration-097-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql#L239C1) and [`migration-097-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql#L672C1)

The main remaining risks are around observability and auditability of edge cases rather than obvious broken arithmetic.

## Risks By Severity

### Critical

None identified in this static review.

### Medium

1. Unknown-status economics are only partially surfaced in the final summary.

`migration-096` intentionally maps unsupported or mixed statuses to `business_bucket = 'unknown'` and exposes `has_unsupported_status` in attribution output in [`migration-096-tiktok-content-order-attribution.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-096-tiktok-content-order-attribution.sql#L34C1) and [`migration-096-tiktok-content-order-attribution.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-096-tiktok-content-order-attribution.sql#L174C1). In `migration-097`, the final summary keeps only `realized`, `open`, and `lost` measures, while unknown rows survive only as the hidden gap between `total_orders` and `successful_orders + open_orders + lost_orders` in [`migration-097-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql#L206C1) and [`migration-097-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql#L594C1). That means unknown-row GMV and commission are not visible in the summary even though those rows can still participate in allocation basis by date/content/product/currency in [`migration-097-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql#L311C1) and [`migration-097-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql#L362C1).

Why it matters:
- a summary row can look under-explained when costs exist but some source economics are sitting in an implicit unknown bucket
- this is especially easy to miss if the verifier does not surface the hidden-order gap

Recommended fix:
- no schema redesign applied
- use the added unknown-bucket reconciliation query in [`verify-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/verify-tiktok-affiliate-content-profit-layer.sql#L256C1) as a required validation step
- if unknown volume becomes materially nontrivial, a follow-up SQL-only migration to add explicit `unknown_orders`, `gmv_unknown`, and `commission_unknown` columns would be justified

2. Commission source-of-truth is deterministic, but fallback usage is not directly visible at the final row.

The resolver is explicit: `COALESCE(total_earned_amount, total_commission_amount, 0)` at line level in [`migration-096-tiktok-content-order-attribution.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-096-tiktok-content-order-attribution.sql#L20C1). Final attribution rows retain only rolled-up `source_total_earned_amount`, `source_total_commission_amount`, and a generic rule string in [`migration-096-tiktok-content-order-attribution.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-096-tiktok-content-order-attribution.sql#L180C1). That means a final winner can represent a mixture of preferred-source lines and fallback-source lines without exposing how much of the total came from fallback.

Why it matters:
- commission arithmetic is still deterministic
- but debugging discrepancies becomes harder when only some underlying lines used fallback `total_commission_amount`

Recommended fix:
- no migration logic change applied
- use the added final-winner commission reconciliation query in [`verify-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/verify-tiktok-affiliate-content-profit-layer.sql#L341C1)
- if operational debugging shows repeated confusion here, add optional audit columns for fallback line count / fallback amount in a future narrow migration

3. The original profit-layer verifier was missing a few precondition checks that Phase 3 depends on.

`migration-097` assumes final attribution keys are already clean and unique, and that content-only cost allocation fan-out matches the distinct product basis set. Those assumptions are structurally reasonable, but the original verifier did not assert them. That left room for an upstream regression to look like a profit-layer defect.

Recommended fix:
- applied
- added:
  - final attribution duplicate and blank-key checks in [`verify-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/verify-tiktok-affiliate-content-profit-layer.sql#L15C1)
  - content-only allocation fan-out check in [`verify-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/verify-tiktok-affiliate-content-profit-layer.sql#L135C1)
  - unknown-bucket reconciliation check in [`verify-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/verify-tiktok-affiliate-content-profit-layer.sql#L256C1)
  - final commission resolver reconciliation in [`verify-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/verify-tiktok-affiliate-content-profit-layer.sql#L341C1)

### Low

1. Null `content_id` / `product_id` leakage risk is low in the reviewed SQL, but blank-string hygiene still relies partly on upstream discipline.

Candidate attribution excludes null `order_id`, `product_id`, and `content_id` in [`migration-096-tiktok-content-order-attribution.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-096-tiktok-content-order-attribution.sql#L157C1), and the final summary table requires non-null `content_id`, `product_id`, and nonblank uppercase `currency` in [`migration-097-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql#L210C1). The residual gap is that `content_order_attribution` filters `IS NOT NULL`, not `BTRIM(...) <> ''`, so blank strings would only be caught if upstream normalization or direct-write discipline remains correct.

Recommended fix:
- none required for this phase
- the added verifier now checks blank as well as null keys in [`verify-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/verify-tiktok-affiliate-content-profit-layer.sql#L27C1)

2. Duplicate attribution and cost-join explosion risk looks well-contained by the current grain choices.

Attribution candidates collapse to `created_by + order_id + product_id + content_id` in [`migration-096-tiktok-content-order-attribution.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-096-tiktok-content-order-attribution.sql#L156C1), final attribution enforces one winner row per `created_by + order_id + product_id` in [`migration-096-tiktok-content-order-attribution.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-096-tiktok-content-order-attribution.sql#L238C1), and allocation tables enforce one allocated row per `cost_id + product_id + currency` in [`migration-097-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql#L171C1).

Recommended fix:
- none required
- keep the new verifier fan-out query in the regression suite

3. ROI division safety is already handled correctly.

`roi` is nullable, the summary check disallows non-null ROI when `total_cost = 0`, and refresh logic divides by `NULLIF(total_cost, 0)` in [`migration-097-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql#L241C1) and [`migration-097-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql#L672C1).

Recommended fix:
- none

## Validation Changes Applied

I updated [`verify-tiktok-affiliate-content-profit-layer.sql`](/d:/AI_OS/projects/saas-dashboard/database-scripts/verify-tiktok-affiliate-content-profit-layer.sql#L1C1) only. No migration logic was changed.

Added checks:
- upstream attribution duplicate / blank-key prerequisite checks
- content-only cost allocation fan-out integrity
- unknown-bucket reconciliation against the summary hidden-order gap
- final winner commission resolver reconciliation back to `content_order_facts`

## Bottom Line

Phase 3 SQL looks shippable from a static edge-case review. The remaining concerns are mostly around making hidden edge cases visible early, not around obvious broken math in the current migrations. The verifier is now stronger in the exact areas most likely to hide correctness drift.
