# Sixth Corrective Pass

## Current State After Pass

`content_id` is now a first-class runtime entity in Content Ops. Operators can
navigate to a content list, drill into a content detail page, see which products a
content piece drove, and see real profit data when available — with explicit notices
when it is not.

No DB schema changes. No import pipeline changes. No attribution redesign.
Everything derives from the three existing tables: `content_order_facts`,
`content_profit_attribution_summary`, and `tt_content_costs`.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/app/(dashboard)/content-ops/actions.ts` | Added `ContentSummaryRow`, `ContentDetailStats`, `ContentProfitSummary`, `ContentDetailProduct`, `ContentDetail` types. Added `getContentList()` and `getContentDetail()` server actions. |
| `frontend/src/app/(dashboard)/content-ops/content/page.tsx` | **New file.** Content list page — ranked by order volume, with orders / settled / products / commission columns. |
| `frontend/src/app/(dashboard)/content-ops/content/[contentId]/page.tsx` | **New file.** Content detail page — KPI row, profit section, products list, status breakdown, related orders preview. |
| `frontend/src/app/(dashboard)/content-ops/products/[productId]/page.tsx` | "Top Content IDs" items are now `<Link>` elements pointing to `/content-ops/content/[contentId]`. Previously non-clickable `<div>` items. |
| `frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/attribution/page.tsx` | Content column link changed from `/content-ops/tiktok-affiliate/facts?content_id=…` to `/content-ops/content/[contentId]`. |
| `frontend/src/app/(dashboard)/content-ops/page.tsx` | "Content IDs" KPI card now links to `/content-ops/content` instead of the attribution analysis page. |

---

## What Was Added

### `getContentList()`

Derives content entities from `content_order_facts` — groups by `content_id` in JS
(same pattern as `getProductTrends`), returns sorted by order volume descending.

Per row:
- `contentId` — the identifier
- `totalOrders` — all order lines for this content
- `settledOrders` — lines with `is_successful = true`
- `productCount` — distinct `product_id`s driven by this content
- `totalCommission` — sum of `total_commission_amount` from facts (null if no data)
- `firstOrderDate` / `lastOrderDate` — from `order_date`, shows activity span

No DB schema required. Always fresh — reads current facts, no refresh needed.

### `getContentDetail(contentId)`

Parallel queries:
1. `content_order_facts` filtered by `content_id` — all counts, status breakdown,
   top products, related orders
2. `content_profit_attribution_summary` filtered by `content_id` — summed across
   all `(content_id, product_id)` rows to give aggregate commission / cost / profit

Returns `profitSummary: ContentProfitSummary | null`:
- `null` — profit refresh has not been run; page shows a "run refresh" notice
- Not null — shows actual commission, cost, profit; `hasCostData: boolean` controls
  whether the cost/profit columns are shown or replaced with "no data" notice

### `/content-ops/content` list page

- All content IDs ranked by order volume
- Columns: #, content ID, total orders, settled, products, commission
- Content ID links to detail page
- Date span (first → last order date) shown as secondary text under the ID
- Empty state guides operator to upload data

### `/content-ops/content/[contentId]` detail page

Four sections:
1. **KPI row** — orders, settled%, products, top product
2. **Profit section** — three states:
   - `profitSummary === null` → "Run profit refresh first" notice with link
   - `profitSummary.hasCostData === false` → shows commission, amber notice "profit = commission only", link to add costs
   - `profitSummary.hasCostData === true` → shows commission / cost / profit in green/red
3. **Products** — ranked by order count, each links to `/content-ops/products/[productId]`
4. **Status breakdown** — segmented bar + status grid (links to orders explorer filtered by content + status)

**Truthfulness rule**: profit is never fabricated. When cost data is absent, the
page says so explicitly and does not show a profit number.

### Navigation wiring

- `content-ops/page.tsx` "Content IDs" KPI card → `/content-ops/content`
- `products/[productId]` "Top Content IDs" card → `/content-ops/content/[contentId]`
- `tiktok-affiliate/attribution` content column → `/content-ops/content/[contentId]`

---

## What Still Remains

### Not in scope for Pass 6 (by design)
- **Video metadata** (title, thumbnail, duration) — no ingestion pipeline exists.
  The entity layer is ID-only until a Studio/Showcase sync is built.
- **Content type labels** — `content_type` column exists in facts but is not always
  populated. Not surfaced on the content list (would be mostly null).
- **Content → cost input** — costs are entered per-content on the costs page
  (`/content-ops/tiktok-affiliate/costs`). No dedicated cost input on the content
  detail page — operator should use the existing costs page.
- **Shops detail page** "Top Content IDs" — not yet linked (same gap as products
  before this pass). Can be wired identically when needed.

### Known follow-up
- Wire "Top Content IDs" on `shops/[shopCode]` detail page (same pattern as this pass)
- Add content count to Data Health page `knownGaps`
- Consider adding `getContentList()` result to the overview KPI when content is a
  primary decision dimension

---

## Verification

```
npx tsc --noEmit  →  0 errors
```
