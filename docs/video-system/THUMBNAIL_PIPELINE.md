# Thumbnail Pipeline — Video Master

## Overview

Thumbnails are scraped from TikTok Studio by the `tiktok-content-registry` scraper and
synced into the canonical `video_master` table via a CLI script. The frontend reads
thumbnails exclusively from the DB cache — no live TikTok requests at render time.

---

## Source Data

| Field | Source | Location |
|-------|--------|----------|
| `thumbnail_url_raw` | DOM img src from TikTok Studio grid | `tiktok-content-registry/data/studio-thumbnails/registry/latest-by-post.json` |
| `thumbnail_source` | How the URL was obtained | Always `dom_url` when scraped via Playwright |
| `post_id` | TikTok numeric video ID | Join key → `video_master.tiktok_video_id` |
| `post_url` | Full TikTok video URL | Also upserted into `video_master.post_url` |

### `latest-by-post.json` entry schema

```json
{
  "snapshot_id": "thumb-2026-04-19T09-24-51-284Z",
  "post_id": "7623081123010137365",
  "post_url": "https://www.tiktok.com/@username/video/7623081123010137365",
  "title": "...",
  "caption": "...",
  "thumbnail_url_raw": "https://p16-common-sign.tiktokcdn.com/...300:400...",
  "thumbnail_local_path": null,
  "thumbnail_source": "dom_url",
  "scraped_at": "2026-04-19T09:33:07.779Z"
}
```

---

## DB Schema

Both tables received `thumbnail_url` and `thumbnail_source` columns via **migration-107**.

### `video_master` (canonical)
```sql
thumbnail_url    TEXT   -- signed CDN URL; expires after ~hours; refresh via sync script
thumbnail_source TEXT   -- 'dom_url' | null
```

### `video_overview_cache` (pre-aggregated)
Same columns, populated by `rebuildVideoOverviewCache()` which reads from `video_master`.

---

## Sync Script

```bash
# From frontend/
npx tsx --env-file .env.local scripts/sync-thumbnails-from-registry.ts \
  --registry "D:/AI_OS/projects/tiktok-content-registry/data/studio-thumbnails/registry/latest-by-post.json" \
  --created-by "<your-auth-uuid>"

# Dry run (no writes)
... --dry-run
```

What it does:
1. Reads `latest-by-post.json`
2. Filters to entries with `thumbnail_url_raw` present
3. Looks up `video_master.id` by `tiktok_video_id = post_id` (batch 200)
4. Upserts `thumbnail_url`, `thumbnail_source`, `post_url` into `video_master`
5. Calls `rebuildVideoOverviewCache()` for all affected canonical IDs

---

## URL Expiry

`thumbnail_url_raw` is a signed CDN URL containing `x-expires=<unix_ts>`. The URLs
expire after several hours. To keep thumbnails valid, re-run the scraper and sync script
regularly (e.g., daily alongside the studio analytics scrape).

**Never fetch TikTok CDN URLs from the frontend at render time** — always serve from the
cached value in `video_overview_cache.thumbnail_url`.

---

## Frontend Rendering

`/content-ops/video-master` — Video Overview table:
- Thumbnail displayed as 40×54px portrait image (3:4 ratio)
- Clicking thumbnail → opens `post_url` in new tab (TikTok)
- Clicking title → opens internal detail page `/content-ops/video-master/[videoId]`
- Placeholder (Play icon) shown when `thumbnail_url` is null

Uses plain `<img>` (not Next.js `<Image>`) to avoid needing remote domain config for
signed TikTok CDN URLs.

---

## Source Priority

When multiple sources provide thumbnail data, **the most recent sync wins** (upsert with
`ignoreDuplicates: false`). There is no multi-source merging — the scraper always
produces the freshest URLs.

| source_type | thumbnail | post_url |
|-------------|-----------|----------|
| `studio_thumbnails` (scraper) | ✅ primary | ✅ primary |
| `studio_analytics` import | ❌ none | ✅ fallback |
| `perf_stats` import | ❌ none | ❌ none |
