# TikTok Affiliate Content Attribution Foundation

Status:

- Affiliate normalization foundation: done.
- Interim analytics layer: done.
- Content order attribution layer: done.
- Full Phase 3 profit layer: done.

## Status Snapshot

### What exists now

- The attribution foundation schema, normalization RPC, parser/import path, and verification checks are in place.
- `content_order_facts` is the current module-local normalized source for downstream attribution reporting.
- The interim analytics layer now depends on this foundation.

### What is intentionally provisional

- This foundation is intentionally limited to module-local staging and normalized attribution facts.
- It does not itself add cost inputs, allocation, profit, ROI, or any cross-module SaaS integrations.
- It remains an upstream dependency for the downstream attribution and profit layers.

### What exists downstream now

- `migration-096-tiktok-content-order-attribution.sql` adds deterministic final winner selection.
- `migration-097-tiktok-affiliate-content-profit-layer.sql` adds cost allocation and the final profit summary refresh path.
- This README remains focused on the upstream schema and normalization contract.

## Scope

This implementation is isolated to the Content Ops / Content Attribution module.

It creates only:

- `public.tiktok_affiliate_import_batches`
- `public.tiktok_affiliate_order_raw_staging`
- `public.content_order_facts`
- module-local helper functions and the normalization RPC `public.normalize_tiktok_affiliate_order_batch(uuid)`

It does not touch:

- existing sales tables
- existing finance tables
- existing ads tables
- existing wallet tables
- existing reconciliation tables
- existing dashboard page logic
- existing RPCs or server actions

## File Locations

- Migration: `database-scripts/migration-094-tiktok-affiliate-content-attribution.sql`
- Normalize helper: `database-scripts/tiktok-affiliate-content-attribution-pipeline.sql`
- Validation checks: `database-scripts/verify-tiktok-affiliate-content-attribution.sql`
- Parser/import library: `frontend/src/lib/content-ops/tiktok-affiliate-orders.ts`
- CLI import runner: `frontend/scripts/import-tiktok-affiliate-orders.ts`

## Import Flow

1. Parse the TikTok affiliate Excel file.
2. Create a module-local row in `tiktok_affiliate_import_batches`.
3. Insert every parsed row into append-only `tiktok_affiliate_order_raw_staging`.
4. Normalize the staged batch into `content_order_facts` with the documented logical grain:
   `created_by + order_id + sku_id + product_id + content_id`
5. Keep only one current fact winner per grain using the locked V1 tie-break rules.
6. Leave repeated and conflicting versions in raw staging for auditability.

## Normalization Rules Implemented

- Settlement status stays separate from attribution semantics.
- Rows missing any logical grain key are excluded from `content_order_facts`.
- Non-blank money, rate, or count fields that fail V1 parsing rules are excluded from `content_order_facts`.
- `content_type` is normalized to `live`, `video`, `showcase`, or `other` while preserving `content_type_raw`.
- `currency` is uppercased and preserved separately as `currency_raw`.
- `normalized_row_version_hash` tracks the winning normalized version of each logical row.
- Raw staging is append-only for normal authenticated access. The importer writes rows once; normalization never mutates staged rows.
- `raw_payload` preserves workbook cell text without importer-side trim normalization so the recovery payload stays closer to the source file.
- Batch metadata now stores rejection details for missing keys, malformed numeric fields, and duplicate non-winner rows.

## Exact Run Commands

Apply the schema:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -f database-scripts/migration-094-tiktok-affiliate-content-attribution.sql
```

Import one Excel file end to end:

```powershell
cd D:\AI_OS\projects\saas-dashboard\frontend
npx tsx scripts/import-tiktok-affiliate-orders.ts --file "D:\path\to\tiktok-affiliate-orders.xlsx" --created-by "<auth_user_uuid>"
```

Rerun normalization for an existing batch:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -v batch_id="'<batch_uuid>'" -f database-scripts/tiktok-affiliate-content-attribution-pipeline.sql
```

Run validation checks:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -f database-scripts/verify-tiktok-affiliate-content-attribution.sql
```

## Known Limitations

- `total_commission_amount` is inferred from the sum of the actual commission component fields and should be confirmed if business semantics tighten later.
- Raw rows with missing `order_id`, `sku_id`, `product_id`, or `content_id` are staged but intentionally not promoted into facts because the documented fact grain cannot be formed safely.
- Staging business columns still store workbook text as parsed by the XLSX library, so this layer is source-faithful at the workbook-text level rather than byte-for-byte file preservation.
- This round does not create UI, downstream attribution views, cost inputs, or profit views.
- This round does not build `content_video_performance` or `content_product_performance`.
