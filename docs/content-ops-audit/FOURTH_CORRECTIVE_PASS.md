# Fourth Corrective Pass

## Current State After Pass

The Content Ops import flow now has a preview-before-import gate. Operators see row
counts, pre-write rejection counts, and duplicate file warnings before committing to
an import. Rows missing critical keys (`order_id`, `content_id`, `product_id`) are
rejected before staging insertion rather than flowing through to the normalization
RPC as `missingKeyRowCount`.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/lib/content-ops/tiktok-affiliate-orders.ts` | Added `TikTokAffiliatePreviewResult` type. Added `previewTikTokAffiliateFile()` function. Added `getCriticalFieldFailures()` helper. Added `preWriteRejectedRowCount` to `ImportTikTokAffiliateFileResult`. Updated `importTikTokAffiliateFile()` to filter invalid rows before `insertStagingRows()`. |
| `frontend/src/app/api/content-ops/tiktok-affiliate/preview/route.ts` | **New file.** POST handler: auth → form data → `previewTikTokAffiliateFile()` → `{ ok: true, preview }`. No temp file, no DB writes. |
| `frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/upload/page.tsx` | Added `PreviewSummary` interface and `previewSummary` field to `QueueItem`. Added `previewing` and `previewed` states. Two-step UI: "Preview N files" → shows preview card per file → "Import N files" to confirm. |

---

## What Was Added

### 1. `previewTikTokAffiliateFile()`

A pure read-only function in `tiktok-affiliate-orders.ts`:
- Calls `parseTikTokAffiliateWorkbook()` to parse the xlsx in memory
- Computes `source_file_hash` (SHA-256) and checks it against `tiktok_affiliate_import_batches` for the current user
- Runs `getCriticalFieldFailures()` on every parsed row to count pre-write rejections
- Returns `TikTokAffiliatePreviewResult` — no DB writes

```typescript
export interface TikTokAffiliatePreviewResult {
  fileName: string
  sheetName: string
  rowCount: number
  validRowCount: number
  preWriteRejectedRowCount: number
  missingCriticalFieldCounts: Record<string, number>  // field → count of rows missing it
  isDuplicateFile: boolean
  existingBatchId: string | null
}
```

### 2. `getCriticalFieldFailures()` (private helper)

Returns the names of critical DB key fields that are blank in a parsed row:
- `order_id` — required for normalization grain
- `content_id` — required for attribution join
- `product_id` — required for product master lookup

Rows where this returns non-empty are dropped before staging in `importTikTokAffiliateFile()`.

### 3. Pre-write row filtering in `importTikTokAffiliateFile()`

After parsing, rows are split:
```typescript
const validRows = parsedWorkbook.rows.filter((row) => getCriticalFieldFailures(row).length === 0)
const preWriteRejectedRowCount = parsedWorkbook.rowCount - validRows.length
```

Only `validRows` are passed to `insertStagingRows()`. The batch record retains `raw_row_count = parsedWorkbook.rowCount` (full file count) while `staged_row_count = validRows.length`. The difference is now surfaced as `preWriteRejectedRowCount` in the import result.

### 4. `POST /api/content-ops/tiktok-affiliate/preview`

New route that:
- Auth-checks the request (user-scoped Supabase client)
- Reads the file buffer directly from form data (no temp file write)
- Calls `previewTikTokAffiliateFile(buffer, fileName, user.id, sheetName?)`
- Returns `{ ok: true, preview: TikTokAffiliatePreviewResult }` or `{ ok: false, error: { code, message, stage } }`

`maxDuration = 60` (preview is faster than import — no staging inserts or RPC calls).

### 5. Two-phase upload UI

`upload/page.tsx` state machine per queue item:
```
queued → previewing → previewed → importing → done | error
```

**Phase 1 — Preview:**
- "Preview N files" button processes all `queued` items sequentially
- Each file calls `POST /api/content-ops/tiktok-affiliate/preview`
- Preview card shows: rows in file / valid rows / pre-write rejected count
- Amber warning if `isDuplicateFile: true` with existing batch ID prefix
- Amber warning if `preWriteRejectedRowCount > 0` listing which fields will be dropped

**Phase 2 — Import:**
- "Import N files" button processes all `previewed` items
- Existing `uploadFile()` / import flow unchanged
- Post-import card shows staged / winners / duplicates / errors counts
- `preWriteRejectedRowCount` in result shown as footnote if non-zero

---

## What Was Not Changed

- `importTikTokAffiliateFile()` still creates a new batch for duplicate files. The
  preview warns the operator, but import is not blocked — normalization dedupes
  winner facts in either case.
- Downstream normalization RPC (`normalize_tiktok_affiliate_order_batch`) is
  unchanged. The RPC's `missingKeyRowCount` will now be lower (some bad rows filtered
  client-side), which is correct.
- No change to batch metadata format or `rejectionDetails` extraction.
- `upload/route.ts` (the existing import endpoint) is unchanged.

---

## Truthful Duplicate Handling

Before Pass 4, the operator had no signal that a file had already been imported.
Now:
1. Preview phase shows "Duplicate" badge + amber warning with existing batch ID prefix
2. The warning explains that normalization will still dedupe facts
3. The operator can remove the file from the queue or proceed intentionally

The underlying import behavior is unchanged (no hard block), which preserves the
ability to re-import corrected files without needing a special bypass flow.

---

## Verification

```
npx tsc --noEmit  →  0 errors
```
