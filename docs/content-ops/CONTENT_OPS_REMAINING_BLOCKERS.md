# CONTENT_OPS_REMAINING_BLOCKERS.md
Generated: 2026-04-08 | Part 1 Closure Run (post-verification)

---

## Summary

Part 1 is operationally complete. Data is in the system. All analytical infrastructure is working.
The remaining items below are improvements, not blockers.

**No critical blockers remain.**

---

## Manual SQL (Requires Supabase SQL Editor)

### 1. Apply Migration 102 — MEDIUM priority

**What:** Create `tt_product_master` and `tt_shop_master` persistent tables.

**Why not critical:** `getProductMaster()` / `getShopMaster()` server actions provide full product/shop data today via live aggregation. The pages work without migration 102.

**When to apply:** Before data grows significantly or before building the product catalog UI.

**How:**
1. Open https://supabase.com/dashboard/project/ntvzawokbmbjwphsqbnd/sql
2. Paste `database-scripts/migration-102-tiktok-affiliate-product-shop-master.sql`
3. Run
4. `SELECT * FROM refresh_tt_product_shop_master('2c4e254d-c779-4f8a-af93-603dc26e6af0');`
5. Expected: `products_upserted: 281, shops_upserted: 190`

---

### 2. Fix Bangkok TZ in DB Function — LOW priority (downgraded)

**What:** Update `public.tiktok_affiliate_parse_timestamp(text)` to subtract 7h when parsing.

**Why downgraded to LOW:** All 107,987 imported rows were processed by the JS normalizer (`import-affiliate-js.ts`) which correctly applies -7h offset. Verified from live data: raw `24/02/2026 00:01:03` → stored `2026-02-23T17:01:03+00:00` ✅

The DB function is only called by `normalize_tiktok_affiliate_order_batch()` RPC, which is no longer used for imports (superseded by the JS pipeline).

**When to apply:** If the old RPC is ever needed again, or as general hygiene.

**SQL:** See `CONTENT_OPS_IMPORT_EXECUTION_REPORT.md` — Issue 2 section.

---

## User Actions Required

### 3. Add Cost Entries — MEDIUM priority (blocks profit)

**What:** Navigate to `/content-ops/tiktok-affiliate/costs` and enter real cost data.

**Why needed:** `tt_content_costs` has 0 rows. `content_profit_attribution_summary` currently has 1 stale test row from before the real import. Profit layer cannot produce meaningful numbers without costs.

**What to enter:**
- `content_id` — TikTok video/live ID (from the 647 unique content IDs in the system)
- `cost_type` — `ads`, `creator`, or `other`
- `amount_thb` — cost in Thai Baht
- `period_start` / `period_end` — coverage period

**After entering costs:** Click "Refresh Profit" on the profit page.

---

### 4. Run Profit Refresh After Costs Added — LOW priority (user-driven)

**What:** Click "Refresh Profit" button on `/content-ops/tiktok-affiliate/profit` page.

**Why:** This calls `refresh_content_profit_layer()` RPC which populates `content_profit_attribution_summary`.

**Current state:** 1 stale test row (content_id = "CONTENT-001") — not real data.

---

## Part 2 Scope (Next Sprint)

These are improvements beyond Part 1. Do not start until costs/profit are configured.

| Item | Priority | Description |
|------|----------|-------------|
| Persist studio snapshots to DB | HIGH | `tt_content_posts` table — 45 posts currently file-based |
| Link content_id → studio post | HIGH | Attribution page shows content_id but no video title |
| Connect showcase scraper → Supabase | MEDIUM | 281 products need images/prices from showcase data |
| Add product images to product master | MEDIUM | Requires showcase scraper connection first |
| CEO overview page | HIGH | Top products, top shops, top content, commission summary |

---

## What Is NOT a Blocker (By Design)

| Item | Status | Reason |
|------|--------|--------|
| Attribution view timeout via service role | Expected | `security_invoker=true` — works correctly for app users |
| Profit page shows 0 | Expected | Needs cost input from user — not a code bug |
| Content library is file-based | Known | Out of scope for Part 1 — Part 2 item |
| Showcase products not in DB | Known | Scraper exists in separate project — Part 2 integration |

---

## Current System Readiness

| Audience | Readiness | Notes |
|----------|-----------|-------|
| CEO reading facts | ✅ Ready | 107,987 real orders with Thai product names and GMV |
| CEO reading attribution | ✅ Ready | Order → content winner mapping live |
| CEO reading profit | ⚠️ Pending | Add costs first → run refresh |
| Developer building product catalog UI | ⚠️ Partial | `getProductMaster()` works; migration 102 preferred for production |
| Pipeline operations team | ✅ Ready | Import new files with `import-affiliate-js.ts` |
