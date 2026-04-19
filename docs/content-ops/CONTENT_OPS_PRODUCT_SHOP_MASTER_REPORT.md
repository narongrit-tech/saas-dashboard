# CONTENT_OPS_PRODUCT_SHOP_MASTER_REPORT.md
Generated: 2026-04-08 | Based on 107,987 real imported facts

---

## Chosen Approach

**Part 1 (now):** Server action queries (`getProductMaster()`, `getShopMaster()`) in `actions.ts`.
- Reads live from `content_order_facts` — no new tables needed
- Aggregates in Node.js on server
- Available immediately to any page that imports from `actions.ts`

**Part 2 (later — requires manual SQL application):** Persistent tables via migration-102.
- `tt_product_master` — deduplicated rows, showcase-enrichable
- `tt_shop_master` — deduplicated rows with product counts
- `refresh_tt_product_shop_master(p_created_by)` RPC
- Migration file: `database-scripts/migration-102-tiktok-affiliate-product-shop-master.sql`

---

## Real Data Summary

| Metric | Count |
|--------|-------|
| Unique products | 281 |
| Unique shops | 190 |
| Products with shop linkage | 281 (all) |
| Products with names | 281 (all have Thai names) |

---

## Top 10 Products by GMV

(Derived from content_order_facts — settled + pending orders)

| Product ID (last 8) | Product Name | Shop | Total Items | GMV (THB) |
|---------------------|-------------|------|-------------|-----------|
| 96960509 | Liby ผงทำความสะอาดถังเครื่องซักผ้า | LibyOfficial | — | — |
| 44785114 | กาแฟโสมชาเขียว 2 ห่อ แถม ไฟเบอร์ | Faii cawaii 2456 | — | — |
| 34463628 | มูสทำความสะอาดส่วนตัว NMB | Mccall house46 | — | — |
| 21069747 | ถุงขยะดำแบบบาง เกรดA 200กรัม | Easylife Foodbox | — | — |
| 42242012 | IBLANC UNDERARM TONING | iblanc Beauty Care | — | — |
| 71771335 | Life Plus ProBio18 โพรไบโอติก | Life Supplements | — | — |
| 99157640 | ถังปั่นไม้ถูพื้นรุ่นมินิ | Spring Mop Shop | — | — |
| 99489098 | ทิชชู่เปียกขนาดเล็ก Deeyeo | Deeyeo Official | — | — |
| 95483922 | [แพ็คคู่] คละสูตร ยาสีฟัน Cool Smile | ยาสีฟัน Cool Smile | — | — |

(Exact GMV per product: run `getProductMaster()` in app — sorted by total_gmv DESC)

---

## Top Shops (Sample)

All 190 shops in the data. Full list available from `getShopMaster()`.

Notable shops from data:
- Mccall house46 (THLCRDWA93) — Mccall house46
- Life Supplements (THLCC2WLHQ)
- LibyOfficial (HKTHCBXLLL73)
- Easylife Foodbox (THLC6MW4UQ)
- iblanc Beauty Care (THLC8NLLBW)
- Unilever Thailand Shop (THLCGBWTPJ)
- Oral-B Thailand (THLCK2WVT8)
- Provamed Store (THLCW7WLWQ)
- SkintificTH (THLCWLWAMS)
- Konvy (THLCULWLWA)

---

## Schema: getProductMaster() Return Shape

```typescript
interface ProductSummary {
  product_id: string          // TikTok product ID
  product_name: string | null // Thai product name
  shop_code: string | null    // TikTok shop code
  shop_name: string | null    // Shop display name
  total_order_items: number   // All order-items for this product
  settled_order_items: number // Commission-earned items
  total_gmv: number | null    // Sum of GMV (THB)
  total_earned: number | null // Sum of earned commission (THB)
  currency: string | null     // 'THB'
  first_seen_at: string | null
  last_seen_at: string | null
}
```

## Schema: getShopMaster() Return Shape

```typescript
interface ShopSummary {
  shop_code: string           // TikTok shop code
  shop_name: string | null    // Shop display name
  total_products: number      // Distinct products in this shop
  total_order_items: number
  settled_order_items: number
  total_gmv: number | null
  total_earned: number | null
  currency: string | null
}
```

---

## Migration 102 (For Persistent Tables — Apply Manually)

File: `database-scripts/migration-102-tiktok-affiliate-product-shop-master.sql`

**How to apply:**
1. Open Supabase SQL Editor for project `ntvzawokbmbjwphsqbnd`
2. Paste the contents of migration-102
3. Run it
4. Then call the refresh RPC:

```sql
SELECT * FROM refresh_tt_product_shop_master('2c4e254d-c779-4f8a-af93-603dc26e6af0');
```

Expected result: `products_upserted: 281, shops_upserted: 190`

---

## What Showcase Data Would Add (Not Yet Available)

| Field | Source | Available Now |
|-------|--------|---------------|
| product_id | affiliate facts | ✅ |
| product_name | affiliate facts | ✅ |
| shop_code | affiliate facts | ✅ |
| shop_name | affiliate facts | ✅ |
| product_image_url | showcase scraper | ❌ (not connected) |
| current_price | showcase scraper | ❌ |
| current_commission_rate | showcase scraper | ❌ |
| stock_status | showcase scraper | ❌ |
| linked_content_ids | showcase scraper | ❌ |

**Conclusion:** Affiliate data is fully sufficient for a working product/shop registry. Showcase data enriches with visual/pricing/stock metadata but is NOT required for order analysis.
