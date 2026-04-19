# V2 Video Pipeline — Architecture

## Overview

V2 is an isolated clean-rebuild path. V1 tables are never modified.

```
┌─────────────────────────────────────────────────────────────────────┐
│  SCRAPE LAYER (tiktok-content-registry)                             │
│                                                                      │
│  START_STUDIO_ANALYTICS_FULL_V2.bat                                 │
│    → data/v2/studio-analytics/normalized/snapshots/*.json           │
│    → data/v2/studio-analytics/registry/latest-by-post.json          │
│                                                                      │
│  START_STUDIO_THUMBNAILS_FULL_V2.bat                                │
│    → data/v2/studio-thumbnails/registry/latest-by-post.json         │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ operator runs import scripts
┌──────────────────────▼──────────────────────────────────────────────┐
│  IMPORT LAYER (saas-dashboard/frontend/scripts/)                    │
│                                                                      │
│  import-studio-analytics-v2.ts                                      │
│    → reads *.analytics-rows.json                                    │
│    → upserts video_master_v2 (canonical ID + metadata)              │
│    → upserts video_source_mapping_v2 (match_stage=1, conf=1.0)     │
│    → rebuilds video_overview_cache_v2                               │
│                                                                      │
│  sync-thumbnails-to-v2.ts                                           │
│    → reads latest-by-post.json                                      │
│    → upserts video_master_v2.thumbnail_url                          │
│    → inserts missing rows (V2 always uses --insert-missing)         │
│    → rebuilds video_overview_cache_v2                               │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────────┐
│  V2 DB TABLES (Supabase — isolated, never touches V1)               │
│                                                                      │
│  video_master_v2          — canonical registry (clean V2 IDs)       │
│  video_source_mapping_v2  — match audit trail (studio/perf/affiliate)│
│  video_overview_cache_v2  — pre-aggregated 1-row per video           │
│                                                                      │
│  Cache joins V1 staging for engagement/perf data:                   │
│    tiktok_studio_analytics_rows (V1, reused)                        │
│    tiktok_video_perf_stats      (V1, reused)                        │
│    content_order_facts          (V1, reused via V2 mapping)         │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────────┐
│  COMPARE + VALIDATE                                                  │
│                                                                      │
│  compare-v1-v2.ts                                                    │
│    → queries both V1 and V2 tables                                  │
│    → prints side-by-side coverage report                            │
│    → shows V1-only and V2-only video IDs                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Table Schema (V2)

All V2 tables mirror V1 schema exactly. Key differences:
- Table names: `_v2` suffix
- `video_master_v2.id` is FK in `video_source_mapping_v2` and `video_overview_cache_v2`
- No backfill SQL — tables start empty
- `video_overview_cache_v2.canonical_id` references `video_master_v2(id)`

See `database-scripts/migration-108-video-master-v2.sql` for full DDL.

---

## Matching Logic (V2)

### Stage 1 (deterministic, confidence 1.0)
- `tiktok_video_id` from analytics JSON `post_id` field
- Direct match to `video_master_v2.tiktok_video_id`
- Covers 100% of analytics data

### Thumbnail matching
- Derives `tiktok_video_id` from `post_url` regex `/\/video\/(\d+)/`
- Falls back to `post_id` if URL parsing fails
- For unmatched thumbnails: inserts new `video_master_v2` row (--insert-missing)

### Stage 2/3 (affiliate matching)
- Not yet implemented for V2
- Affiliate can be re-imported after V2 is validated
- V2 mapping table has the schema ready

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| V2 tables isolated from V1 | Safe comparison side-by-side; no risk to V1 data |
| No V2 staging tables | Analytics staging (`tiktok_studio_analytics_rows`) is reused; no need for separate V2 staging |
| `--insert-missing` ON by default for V2 | V2 starts fresh; thumbnails are the most complete data source |
| Cache joins V1 staging | Engagement data is already in `tiktok_studio_analytics_rows`; duplicating it adds no value |
| CHUNK = 100 | Avoids PostgREST URL-limit errors (proven fix from V1 thumbnail bug) |
| Retry logic (3×) on canonical query | Transient network failures under large IN clauses |

---

## File Map

### tiktok-content-registry/
| File | Purpose |
|------|---------|
| `START_STUDIO_ANALYTICS_FULL_V2.bat` | Full V2 analytics scrape → `data/v2/studio-analytics/` |
| `START_STUDIO_THUMBNAILS_FULL_V2.bat` | Full V2 thumbnail scrape → `data/v2/studio-thumbnails/` |
| `START_VIDEO_V2_FULL_REFRESH.bat` | Orchestrator: runs both scrapers sequentially |

### saas-dashboard/database-scripts/
| File | Purpose |
|------|---------|
| `migration-108-video-master-v2.sql` | Creates V2 tables with RLS and indexes |

### saas-dashboard/frontend/src/lib/content-ops/
| File | Purpose |
|------|---------|
| `video-master-v2-sync.ts` | Core V2 functions: upsertVideoMasterV2, upsertSourceMappingV2, rebuildVideoOverviewCacheV2 |

### saas-dashboard/frontend/scripts/
| File | Purpose |
|------|---------|
| `import-studio-analytics-v2.ts` | Import analytics JSON → video_master_v2 |
| `sync-thumbnails-to-v2.ts` | Sync thumbnails → video_master_v2 + rebuild cache |
| `compare-v1-v2.ts` | Side-by-side V1 vs V2 coverage report |

### saas-dashboard/docs/video-system/
| File | Purpose |
|------|---------|
| `V2_RUNBOOK_TONIGHT.md` | Exact commands for tonight's execution |
| `V2_PIPELINE.md` | Architecture (this file) |
| `CURRENT_STATE_V2_PLAN.md` | Why V2 is needed, current gaps |
| `V2_VERIFY.md` | SQL + CLI verification queries |

---

## Cutover Path (Future)

When V2 is validated:
1. Update `actions.ts` to query `video_overview_cache_v2` instead of `video_overview_cache`
2. Update sidebar link (or create `/content-ops/video-master-v2` route)
3. Run final compare to confirm parity
4. Archive V1 tables (do NOT drop — keep as fallback)

V1 tables can be retired after 30 days of V2 stable operation.
