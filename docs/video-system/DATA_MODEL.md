# Video System — Data Model

## Tables (persistent, user-owned)

### `video_master`
Canonical video registry. One row per (created_by, tiktok_video_id).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | gen_random_uuid() |
| created_by | UUID FK → auth.users | RLS owner |
| tiktok_video_id | TEXT NOT NULL | Numeric TikTok video ID |
| content_type | TEXT | video / live / showcase / unknown |
| video_title | TEXT | Best-available title |
| posted_at | DATE | Best-available post date |
| duration_sec | INTEGER | From perf stats |
| post_url | TEXT | Full TikTok URL |
| title_source | TEXT | studio_analytics / perf_stats / manual |
| UNIQUE | (created_by, tiktok_video_id) | Enforces one row per video per user |

### `video_source_mapping`
Audit trail of how each source ID was matched to a canonical video. One row per (created_by, source_type, external_id).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| created_by | UUID FK → auth.users | RLS owner |
| source_type | TEXT | studio_analytics / perf_stats / affiliate |
| external_id | TEXT | post_id / video_id_raw / content_id |
| canonical_id | UUID FK → video_master.id | NULL if unmatched |
| match_stage | INTEGER | 1 / 2 / 3 |
| confidence_score | NUMERIC(5,4) | 0.0–1.0 |
| match_status | TEXT | matched / unmatched / needs_review / conflict |
| match_reason | TEXT | Short code explaining match method |
| latest_source_table | TEXT | Raw table the external_id came from |
| last_seen_at | TIMESTAMPTZ | Updated on each import |
| reviewed_at | TIMESTAMPTZ | Human review timestamp |
| reviewed_by | UUID FK → auth.users | Human reviewer |
| UNIQUE | (created_by, source_type, external_id) | One mapping per source ID per user |

## Views (derived, no data storage)

### `video_engagement_daily`
Studio analytics snapshots joined to canonical video. Multiple rows per video (one per scrape).

Key columns: canonical_id, created_by, scraped_at, snapshot_date, headline_video_views, watched_full_video_rate, average_watch_time_seconds, analytics_new_followers, traffic_sources

### `video_performance_daily`
Perf stat imports joined to canonical video. Multiple rows per video (one per xlsx import).

Key columns: canonical_id, created_by, imported_at, import_date, views, gmv_total, units_sold, ctr, watch_full_rate, duration_sec

### `video_sales_fact`
Affiliate orders joined to canonical video via source_mapping (matched rows only). Grain: (canonical_id, order_id, product_id, sku_id).

Key columns: canonical_id, created_by, content_id, order_id, product_id, sku_id, gmv, commission, order_settlement_status, is_settled, order_date

### `video_perf_products`
Sales aggregated per (canonical_id, product_id). Used for video detail product breakdowns.

### `video_overview_view`
Unified row per video with latest engagement, latest perf stats, and aggregated sales. Main source for the video overview page.

Key columns: id, tiktok_video_id, video_title, posted_at, has_studio_data, has_perf_data, has_sales_data, headline_video_views, gmv_total, total_realized_gmv, total_commission, settled_order_count

## ID Equivalence

```
studio_analytics.post_id = perf_stats.video_id_raw = affiliate.content_id (for video-type)
```

These three numeric strings all refer to the same TikTok video. Stage 1 matching is trivial.
Live/showcase content_ids differ from video IDs → fall to stage 2/3 or remain unmatched.

## RLS

Both `video_master` and `video_source_mapping` have full RLS (SELECT/INSERT/UPDATE/DELETE).
All views require explicit `GRANT SELECT TO authenticated, service_role` (views don't inherit RLS).
