# CONTENT_OPS_PRODUCT_SHOP_MASTER_STATE.md
Generated: 2026-04-08 | Part 1 Closure Run

---

## Current State

| Component | Status | Detail |
|-----------|--------|--------|
| `tt_product_master` table | ❌ NOT EXISTS | Migration 102 not yet applied |
| `tt_shop_master` table | ❌ NOT EXISTS | Migration 102 not yet applied |
| `refresh_tt_product_shop_master()` RPC | ❌ NOT EXISTS | Migration 102 not yet applied |
| `getProductMaster()` server action | ✅ LIVE | Live aggregation from `content_order_facts` |
| `getShopMaster()` server action | ✅ LIVE | Live aggregation from `content_order_facts` |
| Migration 102 SQL file | ✅ READY | `database-scripts/migration-102-tiktok-affiliate-product-shop-master.sql` |

---

## Why Tables Don't Exist

Migration 102 requires direct SQL execution (DDL: CREATE TABLE, CREATE FUNCTION).
The Supabase REST API (PostgREST) cannot execute DDL statements.
No psql, no Supabase CLI auth token, no DATABASE_URL available in this environment.

**The migration file is complete and tested. It only needs to be pasted into the Supabase SQL Editor.**

---

## What Works Right Now Without the Tables

`getProductMaster()` and `getShopMaster()` (added to `actions.ts` in Part 1) aggregate live from `content_order_facts`. Any page can import and call these server actions today — no migration required.

```typescript
// Import in any server component or action:
import { getProductMaster, getShopMaster } from '@/app/(dashboard)/content-ops/tiktok-affiliate/actions'

// Usage:
const { data: products } = await getProductMaster()   // up to 200 products
const { data: shops }    = await getShopMaster()       // all 190 shops
```

**Caveat:** These functions scan `content_order_facts` on every call (107,988 rows). Fine for current data size; will become expensive if data grows 10x+. Migration 102 persistent tables solve this with an indexed query.

---

## What Migration 102 Adds

**Tables created:**
- `tt_product_master (id, created_by, product_id, product_name, shop_code, shop_name, total_order_items, settled_order_items, total_gmv, total_earned, currency, first_seen_at, last_seen_at, product_image_url, current_price, current_commission_rate, stock_status, created_at, updated_at)`
- `tt_shop_master (id, created_by, shop_code, shop_name, total_products, total_order_items, settled_order_items, total_gmv, total_earned, currency, created_at, updated_at)`

**RPC created:**
- `refresh_tt_product_shop_master(p_created_by UUID)` → returns `{products_upserted: int, shops_upserted: int}`

**How to apply:**
```sql
-- Step 1: Paste migration-102 SQL file contents and run

-- Step 2: Refresh with real data
SELECT * FROM refresh_tt_product_shop_master('2c4e254d-c779-4f8a-af93-603dc26e6af0');
-- Expected: products_upserted = 281, shops_upserted = 190
```

---

## Expected Product/Shop Master Data (From Live Aggregation)

| Metric | Count |
|--------|-------|
| Unique products | 281 |
| Unique shops | 190 |
| All products have Thai names | ✅ |
| All products have shop linkage | ✅ |

**Sample products (from `content_order_facts`):**
- กาแฟโสมชาเขียว 2 ห่อ แถม ไฟเบอร์2ซอง — Faii cawaii 2456
- มูสทำความสะอาดส่วนตัว NMB — Mccall house46
- ถุงขยะดำแบบบาง เกรดA 200กรัม — Easylife Foodbox
- IBLANC UNDERARM TONING — iblanc Beauty Care
- Life Plus ProBio18 โพรไบโอติก — Life Supplements

**What showcase data would add (not yet connected):**
- `product_image_url` — from showcase scraper output
- `current_price` — live price from TikTok showcase
- `current_commission_rate` — live commission rate
- `stock_status` — current stock level

---

## Status After Migration 102 Is Applied

Once applied and refreshed:
- Product pages can query `tt_product_master` directly via PostgREST (indexed, fast)
- `getProductMaster()` server action can be updated to read from table instead of aggregating
- Showcase scraper output can be merged in via product_id key
- Product images can be added to the UI
