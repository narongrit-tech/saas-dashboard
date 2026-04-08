# CONTENT_OPS_MODULE_MAP.md
Generated: 2026-04-08 | Auditor: Claude Code ORCH run
Source: D:\AI_OS\projects\saas-dashboard

---

## Route → Code → Data Map

### A. Content Library (Snapshot Viewer)

| Layer | Location |
|-------|----------|
| Route | `app/(dashboard)/content-ops/library/page.tsx` |
| Data loader | `lib/content-ops/tiktok-studio-import.ts` → `getTikTokStudioLatestImport()` |
| Types | `lib/content-ops/tiktok-studio-types.ts` |
| Data source | Local filesystem (NOT Supabase) |
| Registry path | `D:/AI_OS/projects/tiktok-content-registry/data/studio-content/registry/snapshot-manifest.json` |
| Fallback | `lib/content-ops/sample-data/tiktok-studio/registry/snapshot-manifest.json` |
| DB tables | NONE — file-based only |
| Trigger | Manual CLI run of `tiktok-content-registry/app/studio-main.ts` |

**Resolution order:**
1. `../../tiktok-content-registry/data/studio-content/registry/snapshot-manifest.json` ← FOUND (real data)
2. `../tiktok-content-registry/...` ← fallback
3. Checked-in sample data ← fallback

---

### B. TikTok Affiliate Dashboard (Overview)

| Layer | Location |
|-------|----------|
| Route | `app/(dashboard)/content-ops/tiktok-affiliate/page.tsx` |
| Server action | `actions.ts` → `getPipelineStatus()` |
| DB tables | `tiktok_affiliate_import_batches`, `tiktok_affiliate_order_raw_staging`, `content_order_facts`, `tt_content_costs`, `tt_content_cost_allocations`, `content_profit_attribution_summary`, `content_order_attribution` (view) |

---

### C. Upload (File Import)

| Layer | Location |
|-------|----------|
| Route | `app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx` |
| API endpoint | `app/api/content-ops/tiktok-affiliate/upload/route.ts` → `POST` |
| Core library | `lib/content-ops/tiktok-affiliate-orders.ts` → `importTikTokAffiliateFile()` |
| Parser | `parseTikTokAffiliateWorkbook()` — header scan + XLSX.sheet_to_json |
| Staging insert | Supabase: `tiktok_affiliate_order_raw_staging` (chunked 500 rows) |
| Normalization | Supabase RPC: `normalize_tiktok_affiliate_order_batch(p_import_batch_id)` |
| Batch table | `tiktok_affiliate_import_batches` |
| CLI alternative | `scripts/import-tiktok-affiliate-orders.ts` |

---

### D. Batches

| Layer | Location |
|-------|----------|
| Route | `app/(dashboard)/content-ops/tiktok-affiliate/batches/page.tsx` |
| Server action | `actions.ts` → `getBatches()` |
| DB table | `tiktok_affiliate_import_batches` |

---

### E. Facts (Normalized Order Items)

| Layer | Location |
|-------|----------|
| Route | `app/(dashboard)/content-ops/tiktok-affiliate/facts/page.tsx` |
| Server action | `actions.ts` → `getFacts()`, `getDistinctContentIds()` |
| DB table | `content_order_facts` |
| Grain | `UNIQUE (created_by, order_id, sku_id, product_id, content_id)` |

---

### F. Attribution

| Layer | Location |
|-------|----------|
| Route | `app/(dashboard)/content-ops/tiktok-affiliate/attribution/page.tsx` |
| Server action | `actions.ts` → `getAttribution()` |
| DB view | `content_order_attribution` (migration 096) |
| Source view | `content_order_attribution_candidates` (migration 096) |
| DB table | `content_order_facts` (source) |
| Logic | Deterministic last-touch winner selection by status_rank + recency |

---

### G. Costs

| Layer | Location |
|-------|----------|
| Route | `app/(dashboard)/content-ops/tiktok-affiliate/costs/page.tsx` |
| Server actions | `actions.ts` → `getCosts()`, `insertCost()`, `deleteCost()` |
| DB table | `tt_content_costs` (migration 097) |

---

### H. Profit

| Layer | Location |
|-------|----------|
| Route | `app/(dashboard)/content-ops/tiktok-affiliate/profit/page.tsx` |
| Server action | `actions.ts` → `getProfit()`, `runProfitRefresh()` |
| DB view | `content_profit_attribution_summary` (migration 097) |
| DB table | `tt_content_cost_allocations` (migration 097) |
| RPC | `refresh_content_profit_layer(p_created_by)` |

---

### I. Pipeline Verification

| Layer | Location |
|-------|----------|
| Route | `app/(dashboard)/content-ops/tiktok-affiliate/verification/page.tsx` |
| Server action | `actions.ts` → `runVerification()` |
| Checks | 8 SQL-based data integrity checks (no RPC — direct queries from server action) |

---

## External Projects

### tiktok-content-registry (D:\AI_OS\projects\tiktok-content-registry)

| Component | File | Status |
|-----------|------|--------|
| Studio snapshot CLI | `app/studio-main.ts` | EXISTS — manual run |
| Showcase scraper CLI | `app/showcase-main.ts` | EXISTS — manual run, NOT connected to saas-dashboard |
| Showcase runner | `app/showcase-runner.ts` | EXISTS |
| Showcase models | `app/showcase-models.ts` | EXISTS |
| Showcase registry | `app/showcase-registry.ts` | EXISTS |
| Real studio data | `data/studio-content/registry/snapshot-manifest.json` | EXISTS — 3 snapshots, 45 items |
| Showcase data output | `D:/AI_OS/data/processed/tiktok-showcase-products` | Output location, NOT in saas-dashboard DB |

---

## DB Tables — Content Ops Scope

| Table | Migration | Grain | RLS |
|-------|-----------|-------|-----|
| `tiktok_affiliate_import_batches` | 094 | 1 per import batch | ✅ |
| `tiktok_affiliate_order_raw_staging` | 094 | 1 per raw Excel row | ✅ |
| `content_order_facts` | 094 | 1 per (created_by, order_id, sku_id, product_id, content_id) | ✅ |
| `tt_content_costs` | 097 | 1 per cost entry | ✅ |
| `tt_content_cost_allocations` | 097 | 1 per cost allocation slice | ✅ |

## DB Views — Content Ops Scope

| View | Migration | Grain | Security |
|------|-----------|-------|---------|
| `content_order_attribution_candidates` | 096 | (created_by, order_id, product_id, content_id) | security_invoker |
| `content_order_attribution` | 096 | winner per (created_by, order_id, product_id) | security_invoker |
| `content_order_analytics_daily_base` | 095 | daily base | security_invoker |
| `content_performance_daily` | 095 | content × day | security_invoker |
| `content_product_performance_daily` | 095 | content × product × day | security_invoker |
| `content_profit_attribution_summary` | 097 | (created_by, content_id, product_id, currency) | security_invoker |

## DB RPCs — Content Ops Scope

| RPC | Migration | Purpose |
|-----|-----------|---------|
| `normalize_tiktok_affiliate_order_batch(p_import_batch_id UUID)` | 094 | Raw staging → content_order_facts |
| `refresh_content_profit_layer(p_created_by UUID)` | 097 | Rebuild profit summary from attribution + costs |

## Helper Functions (DB)

| Function | Purpose |
|----------|---------|
| `tiktok_affiliate_trim_null(text)` | Normalize empty/dash/NA to NULL |
| `tiktok_affiliate_parse_money(text)` | Parse currency text → NUMERIC |
| `tiktok_affiliate_parse_rate(text)` | Parse percentage/decimal → NUMERIC(9,6) |
| `tiktok_affiliate_parse_count(text)` | Parse integer strings |
| `tiktok_affiliate_parse_timestamp(text)` | Parse DD/MM/YYYY and ISO8601 formats |
| `tiktok_affiliate_normalize_status(text)` | Map raw status → settled/pending/awaiting_payment/ineligible/unknown |
| `tiktok_affiliate_normalize_content_type(text)` | Map raw type → live/video/showcase/other |
| `tiktok_affiliate_normalize_attribution_type(text, text)` | Map order_type + indirect_flag → affiliate/shop_ads/indirect/unknown |
| `tiktok_affiliate_status_rank(text)` | Rank for winner selection: settled=3, ineligible=3, pending=2, awaiting_payment=1 |
| `tiktok_affiliate_resolve_actual_commission(numeric, numeric)` | total_earned_amount fallback to total_commission_amount |
| `tiktok_affiliate_rollup_status(text[])` | Aggregate multiple statuses → mixed if conflicting |
| `tiktok_affiliate_map_business_bucket(text)` | normalized_status → realized/open/lost/unknown |

---

## Missing Connections (Gaps)

| Expected Link | Status |
|---------------|--------|
| Showcase scraper output → saas-dashboard DB | NOT EXISTS |
| Showcase products table in Supabase | NOT EXISTS |
| Content snapshot data → Supabase DB | NOT EXISTS (file-based only) |
| Product master / shop master tables derived from affiliate facts | NOT EXISTS |
| Showcase products linked to affiliate order items by product_id | NOT EXISTS |
| Automation / cron for snapshot ingestion | NOT EXISTS |
| Automation / cron for showcase ingestion | NOT EXISTS |
