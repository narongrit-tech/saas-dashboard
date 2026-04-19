# CONTENT_OPS_NEXT_ACTIONS.md
Generated: 2026-04-08 | Based on: CONTENT_OPS_REAL_SYSTEM_AUDIT.md

---

## Priority Classification

- **NOW** — Blocks all downstream value. Do these first.
- **NEXT** — High value, no hard blocker.
- **LATER** — Important but not urgent.
- **DO NOT DO YET** — Out of scope for this run.

---

## NOW (Must Do First)

### Action 1: Import the 11 real affiliate XLSX files into the DB

**Why:** Zero data exists in `tiktok_affiliate_order_raw_staging`, `content_order_facts`, and all downstream tables. Every page shows empty. Nothing can be verified or analyzed until data is in.

**How:**
```bash
cd D:/AI_OS/projects/saas-dashboard/frontend

# Get the user UUID from Supabase auth (run once)
# Then run for each file:
npx tsx scripts/import-tiktok-affiliate-orders.ts \
  --file "D:/AI_OS/data/raw/tiktok-affiliate-orders/affiliate_orders_7618854163563579157.xlsx" \
  --created-by "<YOUR_USER_UUID>"

# Repeat for all 11 files
```

**Or:** Upload via UI at `/content-ops/tiktok-affiliate/upload` (one at a time).

**Expected output per file:** batch created, staged rows = N, normalized facts = M (≤ N), rejection details in batch metadata.

**Verify after:** Check `/content-ops/tiktok-affiliate/batches` and `/content-ops/tiktok-affiliate/facts`.

---

### Action 2: Run pipeline verification after import

**Why:** 8 checks exist. Run them after data is in to confirm system health.

**How:** Go to `/content-ops/tiktok-affiliate/verification` → click "Run Checks"

**Expected results after import:**
- Attribution grain: PASS (no duplicate order+product winners)
- Key completeness: PASS or surface which orders have null keys
- Profit formula: N/A (no costs yet) → PASS trivially
- Facts vs attribution: PASS (both > 0)

---

### Action 3: Fix Bangkok timezone issue in timestamp parsing

**Why:** `tiktok_affiliate_parse_timestamp()` in migration-094 uses `to_timestamp()` without explicit timezone. On a UTC Supabase instance, dates parsed from `DD/MM/YYYY` strings will be UTC, not Bangkok time. Orders near midnight Bangkok are at risk of being bucketed to the wrong day.

**Fix:** Update the function to AT TIME ZONE 'Asia/Bangkok' after parsing:

```sql
CREATE OR REPLACE FUNCTION public.tiktok_affiliate_parse_timestamp(p_value TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  cleaned TEXT;
BEGIN
  cleaned := public.tiktok_affiliate_trim_null(p_value);
  IF cleaned IS NULL OR cleaned = '/' THEN RETURN NULL; END IF;

  BEGIN
    RETURN (to_timestamp(cleaned, 'DD/MM/YYYY HH24:MI:SS') AT TIME ZONE 'Asia/Bangkok')::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    RETURN (to_timestamp(cleaned, 'DD/MM/YYYY HH24:MI') AT TIME ZONE 'Asia/Bangkok')::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    RETURN ((to_date(cleaned, 'DD/MM/YYYY'))::TIMESTAMPTZ AT TIME ZONE 'Asia/Bangkok');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN NULL;
END;
$$;
```

**Apply before importing real data if possible.** If data already imported, re-run normalization after fix.

---

## NEXT (High Value, Do After NOW)

### Action 4: Build product_master and shop_master from facts

**Why:** After import, `content_order_facts` will contain distinct product_id, product_name, shop_code, shop_name. A simple materialized view or table derived from this gives you a product registry from real order data — no showcase scraping required.

**Suggested migration:**

```sql
CREATE TABLE IF NOT EXISTS public.tt_product_master (
  product_id TEXT NOT NULL,
  product_name TEXT,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (created_by, product_id)
);

CREATE TABLE IF NOT EXISTS public.tt_shop_master (
  shop_code TEXT NOT NULL,
  shop_name TEXT,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (created_by, shop_code)
);
```

Or simpler: add a DB view that returns `SELECT DISTINCT product_id, product_name, shop_code, shop_name FROM content_order_facts WHERE created_by = auth.uid()`.

**Priority:** High — enables product grouping, product-level reporting.

---

### Action 5: Connect content_id to studio snapshot post_id

**Why:** The content library shows 45 studio posts. The facts/attribution tables show content_ids. There is no in-app link between them. A content piece referenced in affiliate data cannot currently be looked up in the studio snapshot.

**Approach:**
- Create a view or lookup function: `content_order_facts.content_id` → match against `post_id` field in studio snapshot JSON
- OR: persist studio snapshot data to Supabase (requires migration for `tt_content_posts` table)
- OR (simpler first step): add content_id to the studio snapshot manifest as a derived field, expose via the library page's "attribution" tab

**Recommended:** Persist studio snapshot to DB (see Action 7).

---

### Action 6: Add "product grouping by shop" view in UI

**Why:** The owner explicitly flagged this as important. After Actions 1+4, this is a SELECT DISTINCT on content_order_facts grouped by shop_name/shop_code with order counts and GMV.

**Where:** Add to `/content-ops/tiktok-affiliate` overview page or new `/content-ops/tiktok-affiliate/products` route.

---

## LATER (Important, Not Blocking)

### Action 7: Persist studio snapshot content to Supabase

**Why:** Currently the content library reads from local filesystem. This means:
- Only the machine running the Next.js server can see content
- No multi-user access to snapshot data
- No history browsable from DB queries

**What to build:**
- Migration: `tt_content_posts` table (post_id, post_url, caption, created_at, platform, latest_metrics JSONB)
- Migration: `tt_content_snapshots` table (snapshot_id, scraped_at, row_count, source)
- Import script: reads studio snapshot JSON → inserts into Supabase
- Server action: reads from `tt_content_posts` instead of local file
- Update `getTikTokStudioLatestImport()` to prefer DB over filesystem

---

### Action 8: Connect showcase products to saas-dashboard

**Why:** The showcase scraper (tiktok-content-registry/app/showcase-main.ts) runs and produces product data with image_url, price, commission_rate, stock_status. Currently this data is stranded in local JSON files with no DB connection.

**What to build:**
- Migration: `tt_showcase_products` table
- Import script: reads showcase JSON → upserts into Supabase via product_id
- Server action: `getShowcaseProducts()` reads from `tt_showcase_products`
- UI: product list page showing products with images, prices, commission rates

---

### Action 9: Improve content library — show attribution linkage

**Why:** After Action 1 (import), the studio content library shows posts but cannot show "this post drove X orders / Y GMV." Adding this context makes the library CEO-readable.

**What:** Add a server action that JOINs content_order_facts by content_id against the studio snapshot manifest items, and shows per-content attribution summary.

---

### Action 10: Add real content cost entries

**Why:** The costs page is working (reads/writes to `tt_content_costs`) but empty. Add actual cost data for ads, creator fees, etc. for at least one content_id after import.

**Then:** Run `refresh_content_profit_layer()` and verify profit summary reflects real numbers.

---

## DO NOT DO YET

- Do not refactor the Upload UI or redesign the affiliate workflow pages
- Do not build finance/wallet/reconciliation integration
- Do not build public-facing reporting
- Do not build automated cron jobs for snapshot ingestion until DB persistence is in place
- Do not build profit dashboards with graphs until data completeness is verified
- Do not merge content-ops data with legacy affiliate/sales_orders data

---

## Immediate 3-Step Plan (Can Start Today)

**Step 1 (30 min):** Fix Bangkok timezone in migration-094 parse function. Apply via Supabase SQL editor.

**Step 2 (1–2 hours):** Import all 11 XLSX files using CLI script with your user UUID. Check batch status after each.

**Step 3 (20 min):** Run pipeline verification. Review attribution coverage and grain checks. Document any rejection counts found.

After these 3 steps: system has real data, is verifiable, and the attribution + facts pages are readable for the first time.
