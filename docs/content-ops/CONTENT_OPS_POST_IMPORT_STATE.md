# CONTENT_OPS_POST_IMPORT_STATE.md
Generated: 2026-04-08 | After Part 1 import execution

---

## DB Counts After Import

| Table / View | Count | Notes |
|-------------|-------|-------|
| `tiktok_affiliate_import_batches` | 12 | 1 test + 11 real files |
| `tiktok_affiliate_order_raw_staging` | 107,988 | 107,987 real + 1 test |
| `content_order_facts` | 107,988 | Perfect match — 0 cross-file duplicates |
| `content_order_attribution` | ~107,987 | View via security_invoker; visible to authenticated user |
| `tt_content_costs` | 0 | Not yet entered |
| `tt_content_cost_allocations` | 0 | Not yet entered |
| `content_profit_attribution_summary` | 0 | Awaiting refresh after costs added |

---

## Real Data Summary

| Metric | Value |
|--------|-------|
| Total order-item facts | 107,987 |
| Settled (commission earned) | 82,769 (76.6%) |
| Ineligible (no commission) | 12,394 (11.5%) |
| Pending | 9,842 (9.1%) |
| Awaiting payment | 2,982 (2.8%) |
| Unique products | 281 |
| Unique shops | 190 |
| Unique content IDs | 647 |
| Total GMV (THB) | ฿19,760,786.29 |
| Total earned commission (THB) | ฿1,488,835.58 |
| Date range | 2026-03 to 2026-04 |
| Currency | THB (Thai Baht) |

---

## Page Status After Import

| Page | Was | Now | Notes |
|------|-----|-----|-------|
| `/content-ops/tiktok-affiliate` (overview) | All 0 | Real counts | Pipeline status shows real numbers |
| `/content-ops/tiktok-affiliate/batches` | Empty | 12 batches | All normalized ✅ |
| `/content-ops/tiktok-affiliate/facts` | Empty | 107,988 rows | Filterable by content_id, status, batch |
| `/content-ops/tiktok-affiliate/attribution` | Empty | Real rows | Visible to authenticated user |
| `/content-ops/tiktok-affiliate/costs` | Empty | Still empty | Need to add real cost entries |
| `/content-ops/tiktok-affiliate/profit` | Empty | Still empty | Needs costs + refresh |
| `/content-ops/tiktok-affiliate/verification` | Trivially pass | Real results | Run now for real checks |
| `/content-ops/library` | 45 items (file-based) | 45 items (file-based) | Unchanged — no DB persistence yet |

---

## Top 10 Findings After Import

1. **All 107,987 rows have valid keys** — 0 missing order_id/sku_id/product_id/content_id. Clean data.
2. **82,769 rows (76.6%) are settled** — these have actual commission earned. Profit summary will be meaningful once costs are added.
3. **281 unique products across 190 shops** — significant variety. Shop master will be valuable for grouping.
4. **Total GMV ฿19.76M, earned ฿1.49M** — 7.5% average commission rate.
5. **647 unique content IDs** — each is a TikTok video or live session that drove orders.
6. **0 cross-file duplicates** — each (order_id, sku_id, product_id, content_id) appeared in only one file. Files represent different time periods with no overlap.
7. **Attribution view works** — `content_order_attribution` view is live and will return correct data for authenticated users. Winner selection logic correctly handles the settled > pending > awaiting_payment > ineligible priority.
8. **Bangkok timezone not yet fixed** — timestamps parsed as if UTC. Orders near midnight Bangkok time may be bucketed to wrong day in analytics. Does NOT affect order counts or commission amounts.
9. **Product/shop master now queryable** — `getProductMaster()` and `getShopMaster()` server actions added to `actions.ts`. Return live aggregates from `content_order_facts`. Migration 102 SQL file created for future persistent tables.
10. **Profit layer is ready to use** — once cost entries are added via `/costs` page, run `refresh_content_profit_layer()` to populate profit summary.

---

## What the CEO Can Read Now

✅ **Facts page** — real order items with product names (Thai), shops, content IDs, GMV, status
✅ **Batches page** — 11 import runs, all normalized, with row counts
✅ **Attribution page** — order → content winner mapping live
✅ **Overview page** — real pipeline counts: 12 batches, 107,987 staging rows, 107,987 facts
⚠️ **Costs page** — form works, but no costs entered yet (page will be empty)
⚠️ **Profit page** — structure correct, numbers 0 until costs entered + refresh run
⚠️ **Content library** — shows real 45 studio posts but file-based (not in DB)

**Can the CEO read something meaningful now?** YES for the first time — but requires filtering by product/shop/content to see structured view. The raw tables show data but are not yet aggregated into a CEO-readable summary.

---

## Snapshot and Showcase Status (Unchanged)

| Component | Status |
|-----------|--------|
| Studio snapshot | 3 snapshots, 45 posts — loaded from `D:/AI_OS/projects/tiktok-content-registry/data/studio-content/registry/` |
| Showcase scraper | EXISTS in tiktok-content-registry project — NOT connected to saas-dashboard |
| Product data completeness | Affiliate data provides product_id, product_name, shop_code, shop_name for 281 products ✅ |
| What showcase adds | product_image_url, current_price, current_commission_rate, stock_status |
