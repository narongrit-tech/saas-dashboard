# Current State & V2 Plan

## Why V2 is needed

V1 was built by backfilling from existing staging tables (`tiktok_studio_analytics_rows`, `tiktok_video_perf_stats`). The backfill captured what was in the DB at migration time, but had gaps:

1. **Thumbnail coverage gap**: Original sync script relied on `post_id` field (unreliable). Fixed in V1, but the root cause was a match failure between 696 registry entries and `video_master` rows.
2. **Silent failure history**: `rebuildVideoOverviewCache` had a bug where large IN clauses caused `TypeError: fetch failed` → `data=null` → silent early return. Result: 854/1733 thumbnails in cache instead of 1733/1733.
3. **Partial scrape history**: V1 analytics were scraped over multiple sessions. Some videos may have been missed or only partially scraped.
4. **No compare baseline**: No clean way to verify if V1 mapping is optimal.

**V2 goal:** Start fresh. Scrape everything in one clean session. Prove 100% thumbnail coverage from day 1. Validate that mapping is correct and complete.

---

## Current V1 State (as of 2026-04-19)

| Table | Row count | Notes |
|-------|-----------|-------|
| `video_master` | 1,733 | Includes 696 thumbnail-only rows |
| `video_source_mapping` | ~1,733 | Mostly matched (stage 1) |
| `video_overview_cache` | 1,733 | 1,733/1,733 thumbnails ✓ |
| `tiktok_studio_analytics_rows` | ~1,040 videos × N snapshots | Multiple snapshots per video |

V1 is stable and working. V1 will remain as-is while V2 is built.

---

## V2 Scope

### In scope for tonight
- Full re-scrape: studio analytics + thumbnails
- V2 canonical tables: `video_master_v2`, `video_source_mapping_v2`, `video_overview_cache_v2`
- V2 import scripts
- V1 vs V2 comparison

### Out of scope for now
- Sales re-import (after fresh scrape, reimport affiliate data separately)
- V2 UI (compare script is sufficient; no new page needed until cutover decision)
- Stage 2/3 affiliate matching in V2 (add after sales re-import)
- Cutover (V2 → V1 replacement) — pending comparison results

---

## V2 Files Created

| File | Location | Purpose |
|------|----------|---------|
| `migration-108-video-master-v2.sql` | `database-scripts/` | V2 table DDL |
| `video-master-v2-sync.ts` | `src/lib/content-ops/` | V2 upsert + cache rebuild functions |
| `import-studio-analytics-v2.ts` | `scripts/` | Analytics JSON → video_master_v2 |
| `sync-thumbnails-to-v2.ts` | `scripts/` | Thumbnail registry → video_master_v2 |
| `compare-v1-v2.ts` | `scripts/` | V1 vs V2 coverage comparison |
| `START_STUDIO_ANALYTICS_FULL_V2.bat` | `tiktok-content-registry/` | Full analytics scrape |
| `START_STUDIO_THUMBNAILS_FULL_V2.bat` | `tiktok-content-registry/` | Full thumbnail scrape |
| `START_VIDEO_V2_FULL_REFRESH.bat` | `tiktok-content-registry/` | Orchestrator (both scrapers) |

---

## V1 vs V2 Data Flow

```
V1 Flow (existing, unchanged):
  tiktok_studio_analytics_rows  ─┐
  tiktok_video_perf_stats        ├─► video_master ──► video_overview_cache
  content_order_facts (via vsm) ─┘

V2 Flow (new, isolated):
  data/v2/studio-analytics/*.json  ─┐
  data/v2/studio-thumbnails/*.json  ├─► video_master_v2 ──► video_overview_cache_v2
  (affiliate — future)              ─┘
  (engagement from V1 staging tables reused in cache rebuild)
```

---

## Cutover Decision Criteria

V2 can replace V1 when:
1. `video_master_v2 total >= video_master total`
2. `video_overview_cache_v2 thumbnail coverage = 100%`
3. `has_studio_data coverage >= V1`
4. At least one full sales cycle imported and matched in V2

Do NOT cut over until all criteria are met. V1 data is the production dataset.
