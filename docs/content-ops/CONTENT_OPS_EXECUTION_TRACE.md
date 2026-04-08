# CONTENT_OPS_EXECUTION_TRACE.md
Generated: 2026-04-08 | Auditor: Claude Code ORCH run

---

## Trace 1: Affiliate Import Flow (UI path)

```
User → /content-ops/tiktok-affiliate/upload (page.tsx)
  → user selects .xlsx file
  → POST /api/content-ops/tiktok-affiliate/upload (route.ts)
    → verifies auth via supabase.auth.getUser()
    → validates: file exists, .xlsx extension, < 50MB
    → writes file to OS temp dir: /tmp/tiktok-affiliate-{uuid}.xlsx
    → calls importTikTokAffiliateFile({ filePath, createdBy, sheetName })
      [lib/content-ops/tiktok-affiliate-orders.ts]

      STEP 1 — Parse
        → parseTikTokAffiliateWorkbook(fileBuffer, fileName, sheetName)
          → XLSX.read() with cellDates=false, raw=false
          → findHeaderRowIndex() — scans first 15 rows for "Order ID" AND "Content ID"
          → XLSX.utils.sheet_to_json() from header row
          → mapRawRow() — maps OBSERVED_HEADERS to typed struct
          → filters blank rows (all 45 columns empty)
          → returns: { rowCount, rows[], headers, sheetName, headerRowNumber }

      STEP 2 — Create batch
        → INSERT INTO tiktok_affiliate_import_batches
          { created_by, source_file_name, source_file_hash(sha256), raw_row_count, status: 'processing' }
        → returns batch.id (UUID)

      STEP 3 — Stage rows
        → maps rows to staging structs (all 45 columns preserved)
        → insertStagingRows() — chunks 500 rows per INSERT
        → INSERT INTO tiktok_affiliate_order_raw_staging (chunked)
        → UPDATE tiktok_affiliate_import_batches SET status='staged', staged_row_count=N

      STEP 4 — Normalize
        → RPC: normalize_tiktok_affiliate_order_batch(p_import_batch_id)
          [migration-094 SQL function]
          → reads from tiktok_affiliate_order_raw_staging WHERE import_batch_id = ?
          → runs all parse/normalize helper functions
          → classifies rows: missing_required_key, invalid_numeric_fields
          → computes normalized_row_version_hash (md5 of normalized field values)
          → selects winners by status_rank DESC, created_at DESC
          → UPSERT INTO content_order_facts (ON CONFLICT DO UPDATE)
          → UPDATE tiktok_affiliate_import_batches: status, counts, rejection_details (JSONB)
          → returns: { valid_candidate_row_count, winner_row_count, missing_key_row_count,
                       invalid_value_row_count, duplicate_non_winner_row_count }

      STEP 5 — Read batch summary
        → SELECT * FROM tiktok_affiliate_import_batches WHERE id = batch.id
        → returns full ImportTikTokAffiliateFileResult

    → returns NextResponse.json({ success: true, result })
    → deletes temp file (finally block)
  ← UI receives result, shows summary
```

**CLI alternative path:**
```
$ npx tsx scripts/import-tiktok-affiliate-orders.ts --file "<path>" --created-by "<uuid>" [--sheet "<name>"]
  → calls importTikTokAffiliateFile() directly
  → same execution path from STEP 1 onward
```

---

## Trace 2: Content Snapshot Flow (Studio Library)

```
Browser → /content-ops/library (page.tsx, force-dynamic)
  → Server renders page
  → calls getTikTokStudioLatestImport()
    [lib/content-ops/tiktok-studio-import.ts]

    STEP 1 — Resolve registry location
      → resolveLocalStudioRegistry()
        checks paths in order:
        1. {cwd}/../../tiktok-content-registry/data/studio-content/registry/snapshot-manifest.json
           = D:/AI_OS/projects/tiktok-content-registry/data/studio-content/registry/snapshot-manifest.json
           → EXISTS ✅ — uses this path
        2. {cwd}/../tiktok-content-registry/... (skipped)
        3. {cwd}/projects/tiktok-content-registry/... (skipped)
        → returns { registryRoot, manifestPath }

    STEP 2 — Load registry
      → tryLoadRegistry(localRegistry, 'local_registry')
        → readJsonFile(manifestPath) → TikTokStudioSnapshotManifest
        → resolveLatestSnapshot(manifest) → latest entry (studio-2026-04-02T15-38-35-486Z)
        → reads content-items JSON: data/studio-content/normalized/snapshots/studio-2026-04-02T15-38-35-486Z.content-items.json
        → reads metric-snapshots JSON: data/studio-content/normalized/snapshots/studio-2026-04-02T15-38-35-486Z.metric-snapshots.json
        → buildImportedContentRecords(contentItems, metricSnapshots)
          → joins by post_url (deduplication key)
          → returns 45 content records with latest metrics
        → returns TikTokStudioLatestImport {
            status: 'ready', source: 'local_registry',
            items: [45 records], snapshotHistory: [3 snapshots]
          }

    IF registry fails → fallback to checked-in sample JSON (sample_fallback)
    IF sample also fails → returns empty state

  ← page renders 45 content items from real snapshot (2026-04-02)
```

**How snapshots get created (manual process):**
```
$ cd D:/AI_OS/projects/tiktok-content-registry
$ pnpm studio:ingest  (or: npx tsx app/studio-main.ts)
  → browser automation runs against TikTok Studio
  → writes raw snapshot JSON
  → normalizes to content-items.json + metric-snapshots.json
  → updates snapshot-manifest.json
```
No cron. No API trigger. Manual only.

---

## Trace 3: Showcase / Product Ingestion Flow

```
$ cd D:/AI_OS/projects/tiktok-content-registry
$ pnpm showcase:ingest [--page-url <url>] [--max-rows 200]
  → showcase-main.ts → runShowcaseIngestion(options)
    [app/showcase-runner.ts]
    → browser automation (Playwright or Chrome)
    → scrolls TikTok showcase product list
    → extracts product rows (product_id, name, price, commission, stock, shop_name)
    → saves raw snapshot JSON
    → saves normalized snapshot product-items JSON
    → updates showcase manifest
    → output goes to: D:/AI_OS/data/processed/tiktok-showcase-products/
```

**CRITICAL GAP:** The showcase output goes to a flat file on disk.
- There is NO API route in saas-dashboard that reads showcase products.
- There is NO DB table in Supabase for showcase products.
- There is NO server action that queries showcase data.
- There is NO page component that renders showcase product lists from this data.

The showcase scraper works in isolation. The saas-dashboard cannot see its output.

---

## Trace 4: Attribution Flow

```
Browser → /content-ops/tiktok-affiliate/attribution (page.tsx)
  → calls getAttribution(filters, limit, offset)
    [actions.ts]
    → supabase.from('content_order_attribution')
       .select('order_id, product_id, content_id, content_type, product_name, currency,
                order_date, normalized_status, business_bucket, is_realized, is_open, is_lost,
                gmv, commission, actual_commission_total, source_fact_count, content_candidate_count')
       .eq('created_by', user.id)
       .range(offset, offset + limit - 1)
    ← returns AttributionRow[]

content_order_attribution VIEW (migration 096):
  → reads content_order_attribution_candidates VIEW
    → reads content_order_facts TABLE
      → requires: data in content_order_facts

  → winner selection logic:
    ROW_NUMBER() OVER (PARTITION BY created_by, order_id, product_id
                       ORDER BY status_rank DESC, source_fact_updated_at DESC)
    → winner WHERE rn = 1

  → enriches with:
    business_bucket (realized/open/lost/unknown)
    is_realized, is_open, is_lost (boolean)
    source_fact_count (how many fact rows collapsed into this candidate)
    content_candidate_count (how many content IDs competed for this order+product)
```

Current state: View exists and is correct. Returns 0 rows because `content_order_facts` is empty.

---

## Trace 5: Cost → Profit Flow

```
User → /content-ops/tiktok-affiliate/costs (page.tsx)
  → form submission → insertCost(formData)
    [actions.ts]
    → validates: content_id, cost_type, amount, currency, cost_date
    → INSERT INTO tt_content_costs { created_by, content_id, product_id, cost_type, amount, currency, cost_date, notes }
    → revalidatePath('/content-ops/tiktok-affiliate/costs')
    → revalidatePath('/content-ops/tiktok-affiliate/profit')

User → /content-ops/tiktok-affiliate/profit (page.tsx) — "Refresh Profit" button
  → runProfitRefresh()
    [actions.ts]
    → RPC: refresh_content_profit_layer(p_created_by: user.id)
      [migration-097 function]
      → reads: content_order_attribution (winners)
      → reads: tt_content_costs (all costs for user)
      → creates cost allocation slices in tt_content_cost_allocations
      → TRUNCATE + rebuild content_profit_attribution_summary
      → returns: { attribution_row_count, cost_allocation_row_count, summary_row_count, unallocated_cost_row_count }
    → revalidatePath('/content-ops/tiktok-affiliate/profit')

  → getProfit()
    → SELECT * FROM content_profit_attribution_summary WHERE created_by = user.id
    ← returns ProfitRow[] { content_id, product_id, currency, gmv_realized, commission_realized,
                            ads_cost, creator_cost, other_cost, total_cost, profit, roi }
```

Current state: All logic exists. Profit = 0 / empty because no facts imported yet.

---

## Trace 6: Pipeline Verification Flow

```
User → /content-ops/tiktok-affiliate/verification (page.tsx) — "Run Checks" button
  → runVerification()
    [actions.ts]
    → runs 8 inline checks against live DB tables:

    Check 1: Attribution grain uniqueness
      → SELECT order_id, product_id FROM content_order_attribution WHERE created_by=uid
      → detects duplicate (order_id, product_id) pairs in-memory

    Check 2: Attribution key completeness
      → SELECT ... FROM content_order_attribution WHERE ... OR key IS NULL
      → expects 0 rows

    Check 3: Profit formula correctness
      → SELECT ... FROM content_profit_attribution_summary
      → verifies profit = commission_realized - total_cost (tolerance: 0.01)

    Check 4: ROI nullability
      → profit summary: roi must be NULL when total_cost=0

    Check 5: Summary grain uniqueness
      → checks for duplicate (content_id, product_id, currency) in profit summary

    Check 6: Unallocated costs (informational, always passes)
      → counts tt_content_cost_allocations WHERE allocation_status='unallocated'

    Check 7: Facts vs attribution coverage
      → counts content_order_facts vs content_order_attribution
      → fails if facts > 0 but attribution = 0

    Check 8: Cost conservation
      → each tt_content_costs.amount must equal sum of its allocation slices

  ← returns VerificationResult[] (8 items, each with passed/failed, rowCount, sampleRows)
```

Current state: All 8 checks run real SQL. All will "pass" trivially now because all tables are empty.

---

## Summary: What Triggers What

| Trigger | What runs | Output |
|---------|-----------|--------|
| Upload XLSX in UI | importTikTokAffiliateFile() | rows in staging + facts |
| CLI script | same as above | same |
| "Refresh Profit" button | refresh_content_profit_layer() | profit summary rebuilt |
| "Run Checks" button | runVerification() | 8 integrity checks |
| Manual studio CLI | studio-main.ts (external) | local JSON files updated |
| Manual showcase CLI | showcase-main.ts (external) | local JSON files (NOT in DB) |
| CRON | NONE | — |
| API polling | NONE | — |
| Scheduled job | NONE | — |
