# Content Ops Audit: Import Engine

Scope:
- [upload/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx:1)
- [route.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/api/content-ops/tiktok-affiliate/upload/route.ts:1)
- [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:1)

## Verdict By Required Rule

| Rule | Status | Notes |
|---|---|---|
| validate before insert | Fail | bad rows are parsed and inserted into raw staging before DB normalization rejects them |
| reject bad rows before DB write | Fail | bad rows are kept in `tiktok_affiliate_order_raw_staging` |
| parse / insert / validate separated | Partial | logically distinguishable, but still bundled inside one importer function and one request path |
| standardized error shape | Fail | API returns loose `{ error: string }` |
| UI shows real error | Partial | UI can show a thrown string, but not structured row-level validation detail |
| preview before import | Fail | no Content Ops preview step exists |
| logging / observability | Partial | batch metadata preserves normalization results, but runtime UI and API do not expose enough operational detail |

## Evidence

### 1. Validate Before Insert

Status: Fail

Evidence:
- Upload route directly calls the importer after writing a temp file in [route.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/api/content-ops/tiktok-affiliate/upload/route.ts:40).
- Importer creates the batch before validation in [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:186).
- Importer inserts staging rows before calling normalization in [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:289) and [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:303).

Meaning:
- Validation exists, but it is downstream validation inside the DB normalization step, not pre-write validation.

### 2. Reject Bad Rows Before DB Write

Status: Fail

Evidence:
- Parsed rows are always written into `tiktok_affiliate_order_raw_staging` first.
- Rejection details are derived after normalization and stored in batch metadata, not enforced before staging write.

Meaning:
- The system preserves raw input for traceability, which is useful, but it does not satisfy the requested pre-write rejection behavior.

### 3. Parse / Insert / Validate Separation

Status: Partial

Evidence:
- `parseTikTokAffiliateWorkbook()` is a separate helper in [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:329).
- `insertStagingRows()` is a separate helper in [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:319).
- Validation is effectively delegated to `normalize_tiktok_affiliate_order_batch`.

Why still partial:
- The end-to-end importer function still owns parse, batch create, staging insert, normalization, and result assembly inside one path.
- There is no preview/approval boundary between parse and insert.

### 4. Standardized Error Shape

Status: Fail

Evidence:
- API returns `NextResponse.json({ error: message }, { status: 500 })` in [route.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/api/content-ops/tiktok-affiliate/upload/route.ts:57).
- Success shape is separate and loosely transformed by the client in [upload/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx:24).

Meaning:
- There is no stable error contract like `code`, `message`, `row_errors`, `batch_id`, `can_retry`, or similar.

### 5. UI Shows Real Error

Status: Partial

Evidence:
- Upload UI surfaces thrown API error strings in [upload/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx:92).
- The UI summary only shows counts for staged rows, winners, duplicates, and error counts; it does not expose row-level rejection detail from batch metadata.

Meaning:
- The user can see that something failed, but not enough structured detail to resolve issues confidently from the upload screen alone.

### 6. Preview Before Import

Status: Fail

Evidence:
- The Content Ops upload page queues files and imports directly.
- There is no preview route, preview server action, or preview state in the Content Ops upload path.

Contrast inside the repo:
- The old affiliate import dialog does have a preview step in [AffiliateImportDialog.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/components/shared/AffiliateImportDialog.tsx:1), but that belongs to the legacy `order_attribution` flow, not Content Ops.

### 7. Logging / Observability

Status: Partial

What exists:
- `tiktok_affiliate_import_batches` stores counts and metadata.
- Normalization result includes:
  - valid candidate rows
  - winner rows
  - missing key rows
  - invalid value rows
  - duplicate non-winner rows

What is missing:
- Strong API-level structured logs
- clear surfacing of batch metadata samples in the upload UI
- pre-import duplicate warning even though file hash is computed

## Additional Violations

### Misleading source filename handling

Evidence:
- API writes the upload to a random temp path in [route.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/api/content-ops/tiktok-affiliate/upload/route.ts:40).
- Importer derives `fileName` from `path.basename(options.filePath)` in [tiktok-affiliate-orders.ts](/d:/AI_OS/projects/saas-dashboard/frontend/src/lib/content-ops/tiktok-affiliate-orders.ts:183).

Result:
- `source_file_name` reflects the temp filename, not the user-uploaded original name.

Why it matters:
- Weakens auditability of import history.

### Idempotency claim is overstated

Evidence:
- Upload UI says re-uploading the same file is safe in [upload/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx:135) and [upload/page.tsx](/d:/AI_OS/projects/saas-dashboard/frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx:299).
- Live DB shows repeated duplicate file hashes across import batches.

Result:
- The system is not truly idempotent at the batch/raw staging level.

## Bottom Line

The import engine is technically functional, but it does not meet the requested import contract. It is currently best described as:

- parse file
- write raw rows
- normalize in DB
- summarize results afterward

That is enough to populate facts, but not enough to claim a production-grade operator import workflow yet.
