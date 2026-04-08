# CONTENT_OPS_DATA_GRAIN_FINDINGS.md
Generated: 2026-04-08 | Source: migration-094, tiktok-affiliate-orders.ts, raw XLSX files

---

## 1. Affiliate Raw File Grain (Ground Truth)

**Source:** `D:/AI_OS/data/raw/tiktok-affiliate-orders/*.xlsx` (11 files, 1.8–2.7 MB each)

**Confirmed columns from parser (OBSERVED_HEADERS, tiktok-affiliate-orders.ts:9–55):**
```
Order ID, SKU ID, Product name, Product ID, Price, Items sold, Items refunded,
Shop name, Shop code, Affiliate partner, Agency, Currency, Order type,
Order settlement status, Indirect, Commission type, Content Type, Content ID,
Standard, Shop ads, TikTok bonus, Partner bonus, Revenue sharing portion, GMV,
Est. commission base, Est. standard commission, Est. Shop Ads commission,
Est. Bonus, Est. Affiliate partner bonus, Est. IVA, Est. ISR, Est. PIT,
Est. revenue sharing portion, Actual commission base, Standard commission,
Shop Ads commission, Bonus, Affiliate partner bonus, Tax - ISR, Tax - IVA,
Tax - PIT, Shared with partner, Total final earned amount, Order date,
Commission settlement date
```
Total: 45 columns

**TRUE grain of the source file:**
- 1 row = 1 order × 1 SKU × 1 product × 1 content_id
- One Order ID MAY repeat across multiple rows if it contains multiple SKUs
- Each combination of (Order ID, SKU ID, Product ID, Content ID) is one line item

**Confirmed:** The system CORRECTLY identifies this grain.

---

## 2. System Modeling of Grain

### Raw Staging (`tiktok_affiliate_order_raw_staging`)

Grain: 1 raw Excel row per `(created_by, import_batch_id, source_file_name, source_sheet_name, source_row_number)`

**CONSTRAINT:**
```sql
UNIQUE (created_by, import_batch_id, source_file_name, source_sheet_name, source_row_number)
```

Status: ✅ CORRECT — preserves every row as-is.

---

### Normalized Facts (`content_order_facts`)

Grain: 1 winner row per `(created_by, order_id, sku_id, product_id, content_id)`

**CONSTRAINT:**
```sql
UNIQUE (created_by, order_id, sku_id, product_id, content_id)
```

Key fact fields preserved:
- `order_id` — order identifier
- `sku_id` — SKU within the order
- `product_id` — product identifier
- `content_id` — TikTok content that drove attribution
- `product_name` — preserved from raw
- `shop_name` — preserved from raw
- `shop_code` — preserved from raw
- `content_type` — live / video / showcase / other
- `attribution_type` — affiliate / shop_ads / indirect / unknown
- `gmv`, `items_sold`, `items_refunded`, `price` — numeric fields
- `total_earned_amount` — actual settlement amount

Status: ✅ CORRECT — grain is order-item-content, NOT order-level.

**Winner selection:** When duplicate rows appear (same order_id + sku_id + product_id + content_id from different batches), winner is chosen by `tiktok_affiliate_status_rank` (settled=3 wins). This is idempotent re-import behavior.

---

### Attribution Candidates View (`content_order_attribution_candidates`)

Grain: `(created_by, order_id, product_id, content_id)`

**Key change from facts:** sku_id is collapsed here. Multiple SKU rows for the same order+product+content are aggregated.

This is intentional — at attribution level, the business question is "which content drove this order's product sale?" not "which SKU specifically."

Status: ✅ CORRECT collapse — no loss of business truth at attribution grain.

---

### Attribution Winners View (`content_order_attribution`)

Grain: `(created_by, order_id, product_id)`

**Key change from candidates:** content_id is resolved to a single winner. If one order+product is claimed by multiple content_ids, the winner is selected by status_rank then recency.

Status: ✅ CORRECT — deterministic and documented.

---

### Attribution to Facts Relationship

```
1 content_order_attribution row
  ← 1 winner from content_order_attribution_candidates
    ← N content_order_facts rows (collapsed by sku_id)
      ← N tiktok_affiliate_order_raw_staging rows (raw Excel rows)
```

No data destruction at any stage. Raw rows preserved. Facts preserved. Only attribution does final winner resolution.

---

## 3. Wrong Assumptions Found

### ❌ None Found in DB Schema or Core Import Logic

The grain is correctly modeled throughout. No code found that treats 1 order = 1 product.

### ⚠️ Potential Issue: `sku_id` collapse in attribution

The attribution candidates view collapses `sku_id`. This is architecturally correct for attribution purposes, but means: if you want to know exactly which SKU of a product was sold under which content, you must query `content_order_facts` directly, not `content_order_attribution`.

The facts page (`/facts`) reads from `content_order_facts` which preserves sku_id. ✅

---

## 4. Product and Shop Identity — Can Affiliate File Build product_master?

**YES.** The affiliate file contains:
- `product_id` — TikTok product identifier (stable ID)
- `product_name` — product display name
- `shop_name` — TikTok shop name
- `shop_code` — TikTok shop identifier

These fields are preserved verbatim in both `tiktok_affiliate_order_raw_staging` and `content_order_facts`.

**What affiliate file CAN build:**
- A deduplicated product list: `SELECT DISTINCT product_id, product_name FROM content_order_facts`
- A deduplicated shop list: `SELECT DISTINCT shop_code, shop_name FROM content_order_facts`
- A product × shop mapping: `SELECT DISTINCT product_id, product_name, shop_code, shop_name FROM content_order_facts`

**What showcase ingestion ADDS on top (that affiliate file cannot provide):**
- `product_image_url` — thumbnail image
- `price` at time of showcase (current live price, may differ from order price)
- `estimated_commission` and `estimated_commission_rate` — current rates
- `stock_status` — live inventory status
- `product_status` — active/inactive
- `linked_content_ids` — content pieces that feature this product in showcase

**Conclusion:** Affiliate file is sufficient to build a first usable `product_master` and `shop_master`. Showcase data enriches it but is not required for order-level analysis.

---

## 5. Content ID — How Attribution Works

The affiliate file includes `Content ID` (mapped to `content_id` in facts).

This is the TikTok content piece (video or live session) that the streamer/creator used to drive the sale.

The `content_id` in affiliate data matches the `post_id` or TikTok content identifier in the studio snapshot.

**Current status of the link:**
- Affiliate data has `content_id` ✅
- Studio snapshot has content items with `post_id` and `post_url` ✅
- There is NO JOIN currently implemented between the two in the saas-dashboard DB
- The content library page shows snapshots; the facts/attribution pages show content_ids — but there is no in-app cross-reference to show "this content_id → this studio post"

**Missing link:** `content_id` from affiliate facts needs to be joinable to `post_id` from studio snapshots. Currently this requires manual lookup.

---

## 6. Date Parsing — Bangkok Timezone

Timestamp parse in DB function `tiktok_affiliate_parse_timestamp`:
```sql
to_timestamp(cleaned, 'DD/MM/YYYY HH24:MI:SS')
to_timestamp(cleaned, 'DD/MM/YYYY HH24:MI')
(to_date(cleaned, 'DD/MM/YYYY'))::TIMESTAMPTZ
cleaned::TIMESTAMPTZ
```

⚠️ **Risk:** These timestamps are stored as TIMESTAMPTZ but the parse does NOT explicitly set Bangkok timezone (Asia/Bangkok / UTC+7). The `to_timestamp` function in Postgres uses the session timezone at the time of execution. If the Supabase instance is UTC (as is typical), timestamps from DD/MM/YYYY strings will be treated as UTC, NOT Bangkok time.

The analytics views (migration 095) use `AT TIME ZONE 'Asia/Bangkok'` for daily rollups. But the raw order_date field may be off by 7 hours for any orders near midnight Bangkok time.

**Severity:** Medium — affects day boundary attribution for orders near midnight Bangkok time.

---

## 7. Data Completeness vs Business Completeness

| Level | Current State |
|-------|---------------|
| **Data completeness** | NOT YET — 11 real files exist but zero rows in DB |
| **Schema completeness** | HIGH — all tables, views, RPCs exist |
| **Business completeness** | NOT APPLICABLE YET — depends on data completeness first |

The system is technically ready to accept data. The immediate action is to import the 11 XLSX files.
