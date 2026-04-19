# CONTENT_OPS_BLOCKERS_AFTER_IMPORT.md
Generated: 2026-04-08 | After Part 1 completion

---

## What Was Completed in Part 1

✅ Root cause found and fixed: normalization RPC timeout (12K+ rows)
✅ New scripts written: `import-affiliate-js.ts`, `normalize-staged-batch.ts`
✅ All 11 XLSX files imported: 107,987 facts in DB
✅ All batches status: `normalized`
✅ Product/shop master server actions: `getProductMaster()`, `getShopMaster()`
✅ Migration 102 SQL file ready for manual application

---

## Remaining Blockers

### CRITICAL

None. Data is in the system.

---

### HIGH

**1. Bangkok timezone not fixed in DB**
- Timestamps stored as UTC even though source data is Bangkok time
- Fix: Apply SQL in Supabase SQL Editor (SQL provided in IMPORT_EXECUTION_REPORT.md)
- Re-run: `npx tsx scripts/normalize-staged-batch.ts --batch-id <uuid>` for each batch
- Impact: day-boundary analytics off by up to 7 hours for orders near midnight Bangkok time

**2. Content library is filesystem-based (no DB persistence)**
- 45 studio posts load from local JSON files
- Not accessible if app moves to another machine or Vercel deployment
- Fix: Implement `tt_content_posts` table + import script (Part 2 scope)

**3. Showcase products disconnected**
- Scraper exists but output is not in Supabase
- Products visible in affiliate data (product_id, name, shop) but no images/prices
- Fix: Implement tt_showcase_products table + import pipeline (Part 2 scope)

---

### MEDIUM

**4. Migration 102 not yet applied**
- `tt_product_master` and `tt_shop_master` tables don't exist
- Currently served via server action aggregation (works but expensive for large data)
- Fix: Apply migration-102 via Supabase SQL Editor, then use RPC for refresh

**5. No cost entries in `tt_content_costs`**
- Profit layer cannot produce meaningful output
- Fix: Add real cost data via `/content-ops/tiktok-affiliate/costs` page

**6. content_id → studio post linkage missing**
- attribution page shows content_id values but no link to actual video/live title
- content library shows posts but no revenue/attribution data
- Fix: JOIN content_id against studio snapshot manifest post_ids (Part 2)

---

### LOW

**7. Profit page shows 0 until costs + refresh**
- Not a bug. Just requires user action: add costs → run "Refresh Profit"

**8. Attribution view not verifiable via service role**
- `content_order_attribution` uses `security_invoker = true`
- Works correctly for authenticated users in the app
- Cannot be counted via REST API with service role key
- No action needed — works as designed

---

## What Should Be Done Next (Ordered)

### Immediate (can do today)

1. **Apply Bangkok timezone fix** in Supabase SQL Editor (5 min)
2. **Apply migration 102** in Supabase SQL Editor to create persistent product/shop tables (5 min)
3. **Add real cost entries** for at least one content_id via `/costs` page
4. **Run "Refresh Profit"** and verify profit summary shows real numbers
5. **Open facts page in app** and verify data looks correct (Thai product names, real order IDs)

### Next Sprint (Part 2)

6. Persist studio snapshot data to Supabase (`tt_content_posts` table)
7. Connect content_id → studio post in attribution/facts pages
8. Connect showcase scraper output → `tt_showcase_products` table
9. Add product images to product master via showcase pipeline
10. Build CEO-readable overview: top products, top shops, top content, commission summary

### Do NOT Do Yet

- Finance/wallet/reconciliation integration
- Complex profit analytics or graphs
- Navigation redesign
- Public-facing reporting

---

## Current System Status (After Part 1)

```
tiktok_affiliate_import_batches  = 12 rows (11 real + 1 test)
tiktok_affiliate_order_raw_staging = 107,988 rows
content_order_facts              = 107,988 rows
  └─ settled: 82,769
  └─ ineligible: 12,394
  └─ pending: 9,842
  └─ awaiting_payment: 2,982
content_order_attribution        = live view (correct for authenticated users)
tt_content_costs                 = 0 rows (needs user input)
tt_product_master                = NOT YET CREATED (migration 102 pending)
tt_shop_master                   = NOT YET CREATED (migration 102 pending)
Total GMV in system              = ฿19,760,786.29
Total earned commission          = ฿1,488,835.58
Unique products                  = 281
Unique shops                     = 190
Unique content IDs               = 647
```
