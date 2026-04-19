# Attribution Engine

Note: This file defines the business-facing attribution engine for the Content Ops / Content Attribution module only. It does not commit to integration with existing SaaS sales, finance, wallet, or reconciliation systems.

## Module Objective At Business Level

The module should evolve from a content registry into a profit attribution engine that can answer:

- which content generated orders
- which products and creators produced profit
- where commission was earned
- where commission was lost
- which channels are worth scaling

The business outcome is not just content visibility. It is profit visibility by content, product, creator, and channel.

## Current Status

- Affiliate normalization foundation: done.
- Interim analytics layer: done.
- Content order attribution layer: done.
- Full Phase 3 profit layer: done.

## Status Snapshot

### What exists now

- The module has a working affiliate normalization foundation feeding `content_order_facts`.
- The module also has an interim analytics layer for daily content, product, content-product, channel, and loss reporting.
- The current implemented boundary stops at normalized attribution facts plus interim analytics views.

### What is intentionally provisional

- The analytics layer is still interim and uses provisional commission reporting rather than final profit logic.
- Creator profitability and business views beyond the module-local summary are intentionally not implemented yet.
- Nothing in the current state changes or replaces existing SaaS sales, finance, wallet, or reconciliation logic.

### What exists now

- `content_order_facts` remains the normalized source.
- `public.content_order_attribution` is the deterministic last-touch winner layer.
- `public.tt_content_costs`, `public.tt_content_cost_allocations`, and `public.content_profit_attribution_summary` complete the module-local Phase 3 profit layer.

## Updated Direction

### Current direction

`Content Library`

Current Content Ops work gives us a controlled registry of source content and, separately, product registry assets.

### Updated direction

`Content Library -> Affiliate Orders Layer -> Attribution Engine -> Profit Views`

The content library is only the first asset registry. The module direction is to connect:

- content identity
- product identity
- affiliate order outcomes
- cost inputs
- profit outputs

This is the path from content operations to business attribution.

## Required Metrics

| Metric | Definition | Minimum required inputs |
| --- | --- | --- |
| `expected_commission` | Commission expected from eligible attributed orders | affiliate order raw / normalized commission estimate fields |
| `actual_commission` | Commission actually earned | final earned / actual commission fields |
| `commission_loss` | `expected_commission - actual_commission` | expected + actual commission |
| `commission_loss_rate` | `commission_loss / expected_commission` | expected + actual commission |
| `total_orders` | All attributed orders in scope | normalized affiliate order facts |
| `successful_orders` | Orders treated as successful / realized | normalized settlement logic |
| `failed_orders` | Orders not realized successfully | normalized settlement logic |
| `cancelled_orders` | Orders cancelled / ineligible / refunded by policy | normalized settlement logic |
| `lost_gmv` | GMV attached to failed or cancelled outcomes | normalized order facts |
| `lost_commission` | Commission tied to failed or cancelled outcomes | normalized order facts |
| `ads_cost` | Paid media cost allocated to content/product scope | separate cost input, not current affiliate export |
| `creator_cost` | Creator payment or creator-side operating cost | separate cost input |
| `other_cost` | Additional manual or imported cost | separate cost input |
| `profit` | `actual_commission - ads_cost - creator_cost - other_cost` | actual commission + cost inputs |
| `roi` | `profit / total_cost` or agreed denominator | profit + cost policy |

### Important rule

Do not mix `expected_commission`, `actual_commission`, and `profit` into one number. They answer different business questions.

### Locked v1 order outcome formulas

- `successful_orders = COUNT(*) WHERE is_successful = true`
- `cancelled_orders = COUNT(*) WHERE is_cancelled = true`
- `failed_orders = COUNT(*) WHERE is_successful = false AND is_cancelled = false`

## Required Dimensions

| Dimension | Why it matters |
| --- | --- |
| `content` | Core attribution unit for performance and loss analysis |
| `product` | Needed for product win/loss and showcase join paths |
| `creator` | Needed for creator profitability and cost comparisons |
| `shop/brand` | Needed for merchant and brand-level performance analysis |
| `content_type` | Needed to compare `live`, `video`, `showcase`, `other` |

### Required `content_type` values

- `live`
- `video`
- `showcase`
- `other`

## Required Future Views

- content performance
- product performance
- creator performance
- loss dashboard
- channel split

### Expected purpose of each view

| View | Primary question |
| --- | --- |
| Content performance | Which content units produce orders, commission, and profit |
| Product performance | Which products convert and stay profitable across content |
| Creator performance | Which creators produce profitable output after creator cost |
| Loss dashboard | Where GMV and commission are being lost |
| Channel split | How results break down across affiliate, shop ads, indirect, and future source buckets |

## Gap Analysis

| Area | Current state | Gap to engine |
| --- | --- | --- |
| Content registry | TikTok Studio content library exists | Needs joins to order and cost layers |
| Product registry | Showcase product registry exists outside the app flow | Needs module-level product join path by `product_id` |
| Affiliate orders | Module-local parser, staging load, and `content_order_facts` normalization foundation are implemented | Needs promotion into final profit-layer reporting inputs |
| Attribution resolution | Module-local attribution joins now run through normalized keys: `content_id`, `product_id`, `sku_id`, `order_id` | No final profit-layer resolver yet |
| Cost inputs | Ads and other cost systems exist elsewhere in SaaS | No module-local cost contract yet |
| Profit logic | Existing SaaS has other profit reporting paths | No Content Ops profit model yet |
| Loss metrics | Interim module-local loss analytics are implemented | Needs final Phase 3 profit/loss interpretation with costs |
| Business views | Interim module-local analytics views exist without UI expansion | No final profit attribution dashboards yet |

## Phased Roadmap

### Phase 1: Order Attribution Foundation

- load TikTok affiliate exports into raw staging
- normalize module-local `content_order_facts`
- validate joins by `content_id`, `product_id`, `sku_id`, `order_id`

### Phase 2: Engine Join Layer

- connect content library to affiliate order facts by `content_id`
- connect product registry to order facts by `product_id`
- preserve `content_type` for `live`, `video`, `showcase`, `other`

### Phase 3: Profit And Loss Layer

- define successful / failed / cancelled outcome policy
- calculate `expected_commission`, `actual_commission`, `commission_loss`, `lost_gmv`, `lost_commission`
- add module-local cost inputs: `ads_cost`, `creator_cost`, `other_cost`
- calculate `profit` and `roi`

## Locked V1 Cost Allocation Policy

V1 uses one policy for `ads_cost`, `creator_cost`, and `other_cost`:

`direct scope first, otherwise allocate within the supplied parent scope by actual_commission share, with GMV share as the only fallback`

### Why this is the v1 policy

- it stays inside the module and does not depend on finance or wallet systems
- it keeps manually entered or imported costs attributable to the same dimensions the engine reports on
- it uses `actual_commission` first, which is the closest revenue-side signal to profit inside this module
- it avoids speculative global allocation across unrelated content or products

### Allocation rules

1. If a cost row has `content_id + product_id` then allocate `100%` to that exact content-product scope.
2. If a cost row also has `sku_id`, allocate `100%` to that exact content-product-sku scope.
3. If a cost row has `content_id` only, allocate it across that content's child product rows for the same reporting window in proportion to `actual_commission`.
4. If a cost row has `product_id` only, allocate it across that product's child content rows for the same reporting window in proportion to `actual_commission`.
5. If a cost row has `creator_id` only, allocate it across that creator's child content rows for the same reporting window in proportion to `actual_commission`.
6. If the `actual_commission` denominator for the chosen parent scope is `0`, fallback once to proportional `GMV`.
7. If both `actual_commission` and `GMV` denominators are `0`, do not force an even split. Keep the row as unallocated within its parent scope and exclude it from lower-grain profit views until scoped data exists.
8. A cost row with none of `content_id`, `product_id`, or `creator_id` is out of scope for v1 attribution and must be rejected from engine allocation.
9. Allocation must stay inside the row's own reporting window and currency. No cross-window or cross-currency spreading is allowed.
10. `profit` is always calculated from allocated cost, not raw unallocated parent cost.

### Implementation notes

- use the same allocation engine for `ads_cost`, `creator_cost`, and `other_cost`
- keep the original input row and the allocated child rows linked by `cost_input_id`
- preserve any unallocated remainder explicitly instead of hiding it inside lower-grain rows

### Phase 4: Business Views

- content performance view
- product performance view
- creator performance view
- loss dashboard
- channel split view

## Explicit Not Now

- no merge into existing SaaS sales order tables
- no merge into current finance, wallet, or reconciliation workflows
- no promise of cross-module shared profit logic yet
- no automatic payout logic
- no multi-platform expansion beyond the current module definition
- no real-time sync requirement
- no UI commitment beyond future module views listed here

## Implementation Readiness

- [x] Direction clarified: content library is not the end state
- [x] Required business metrics listed
- [x] Required dimensions listed
- [x] Required future views listed
- [x] Module boundary kept explicit
- [x] Affiliate order normalization implemented
- [x] Interim analytics layer implemented
- [x] Cost input contract defined
- [x] Profit and loss formulas implemented
- [ ] Business views implemented
