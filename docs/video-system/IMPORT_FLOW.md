# Video System — Import Flow

## Per-Pipeline Lifecycle

### Studio Analytics (JSON)
1. Upload JSON snapshot file via `/content-ops/tiktok-studio-analytics/upload`
2. API route → `tiktok-studio-analytics-import.ts`
3. Parse JSON → validate rows → create batch (status='processing')
4. Insert rows → `tiktok_studio_analytics_rows`
5. Update batch (status='staged')
6. **Fire-and-forget**: `syncStudioAnalyticsBatch(supabase, createdBy, batchId)`
   - For each post_id: upsert video_master + upsert source_mapping (stage 1, confidence 1.0)

### Perf Stats (XLSX)
1. Upload xlsx file via `/content-ops/tiktok-studio-analytics/upload-perf`
2. API route → `tiktok-video-performance-import.ts`
3. Parse xlsx → validate rows → create batch (status='processing')
4. Insert rows → `tiktok_video_perf_stats`
5. Update batch (status='staged')
6. **Fire-and-forget**: `syncPerfStatsBatch(supabase, createdBy, batchId)`
   - For each video_id_raw: upsert video_master + upsert source_mapping (stage 1, confidence 1.0)

### Affiliate Orders (XLSX)
1. Upload xlsx file via `/content-ops/tiktok-affiliate/upload`
2. `tiktok-affiliate-orders.ts` → parse → stage rows → run normalization RPC
3. Update batch (status='staged' via RPC)
4. **Fire-and-forget**: `syncAffiliateBatch(supabase, createdBy, batchId)`
   - For each distinct content_id: run 3-stage matching (Stage 1 → 3a → 3b → unmatched)
   - Upsert source_mapping with appropriate stage/confidence/status

## Fire-and-Forget Pattern

All sync calls are wrapped in `.catch(() => {})` — sync failure does NOT fail the import.
This ensures import reliability. Sync failures are silent; run full sync manually if needed.

## Full Sync (On-Demand)

`runFullVideoMasterSync(supabase, createdBy)` in `video-master-sync.ts`:
- Iterates all staged batches for all three sources
- Re-runs matching for all rows
- Can be triggered from the Video Overview page (admin action)

## Backfill (Migration)

migration-106 runs backfill SQL as part of the transaction:
- 3a: studio analytics → video_master
- 3b: perf stats → video_master (studio title takes precedence via COALESCE)
- 3c: source mappings for studio
- 3d: source mappings for perf
- 3e: matched affiliate source mappings (content_id already in video_master)
- 3f: unmatched affiliate source mappings (residual)

No re-upload required after migration-106.
