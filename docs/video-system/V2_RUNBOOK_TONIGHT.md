# V2 Video Master — Runbook for Tonight

**Goal:** Scrape fresh V2 dataset, import into isolated V2 tables, compare against V1 before cutover.

**V1 is never touched.** All V2 data goes to `video_master_v2`, `video_source_mapping_v2`, `video_overview_cache_v2`.

---

## Prerequisites

### 1. Apply migration-108 in Supabase SQL Editor
```sql
-- Copy-paste contents of:
-- D:\AI_OS\projects\saas-dashboard\database-scripts\migration-108-video-master-v2.sql
-- Run once. Safe to re-run (IF NOT EXISTS guards).
```

Verify success:
```sql
SELECT
  (SELECT count(*) FROM video_master_v2)         AS vm2,
  (SELECT count(*) FROM video_source_mapping_v2) AS vsm2,
  (SELECT count(*) FROM video_overview_cache_v2) AS voc2;
-- Expected: 0 | 0 | 0
```

### 2. Know your created_by UUID
```
2c4e254d-c779-4f8a-af93-603dc26e6af0
```
Used in all import commands below. Replace if different.

---

## Step 1 — Scrape Studio Analytics (V2)

**Double-click:**
```
D:\AI_OS\projects\tiktok-content-registry\START_STUDIO_ANALYTICS_FULL_V2.bat
```

**What it does:**
- Opens Chrome on port 9222
- Prompts for manual TikTok Studio login
- Runs full analytics scrape → `data/v2/studio-analytics/`
- Saves checkpoints every 25 posts
- Max 5000 posts, max 400 scroll rounds

**Success output looks like:**
```
  [1040/1040] scraped studio-analytics-XXXX.analytics-rows.json
  ✓ checkpoint saved
  V2 Studio Analytics Scrape COMPLETE
  Output: data/v2/studio-analytics/registry/latest-by-post.json
```

**If login expires mid-scrape:**
1. Log in again in the Chrome window
2. The scraper will retry automatically (it uses checkpoints)
3. If it exits, re-run the .bat — checkpoint state is saved

**If a selector breaks:**
```
ERROR: selector '[data-tt=...]' not found after 90s
```
→ TikTok changed the DOM. Open an issue. For now, use V1 data.

**Output location:**
```
D:\AI_OS\projects\tiktok-content-registry\data\v2\studio-analytics\
  registry\latest-by-post.json      ← canonical latest per post
  normalized\snapshots\*.json        ← one file per scrape run
  raw\*.json                         ← raw DOM capture
```

---

## Step 2 — Scrape Thumbnails (V2)

**Double-click:**
```
D:\AI_OS\projects\tiktok-content-registry\START_STUDIO_THUMBNAILS_FULL_V2.bat
```

**What it does:**
- Opens Chrome on port 9223 (separate thumbnail profile)
- Prompts for manual login
- Runs full thumbnail scrape → `data/v2/studio-thumbnails/`
- `--force` flag re-scrapes all posts regardless of prior registry state
- Max 5000 posts, checkpoints every 50

**Success output:**
```
  Saved thumbnail for 7623081123010137365 (dom_url)
  ✓ checkpoint (250 processed)
  V2 Thumbnail Scrape COMPLETE
  Output: data/v2/studio-thumbnails/registry/latest-by-post.json
```

**Output location:**
```
D:\AI_OS\projects\tiktok-content-registry\data\v2\studio-thumbnails\
  registry\latest-by-post.json      ← latest thumbnail per post
  normalized\*.json                  ← normalized per scrape run
  raw\*.json                         ← raw capture
```

---

## Step 3 — Import Analytics to video_master_v2

**Run from** `D:\AI_OS\projects\saas-dashboard\frontend\`:

```powershell
npx tsx --env-file .env.local scripts/import-studio-analytics-v2.ts `
  --dir "D:/AI_OS/projects/tiktok-content-registry/data/v2/studio-analytics/normalized/snapshots" `
  --created-by "2c4e254d-c779-4f8a-af93-603dc26e6af0"
```

**Dry-run first (no DB writes):**
```powershell
npx tsx --env-file .env.local scripts/import-studio-analytics-v2.ts `
  --dir "D:/AI_OS/projects/tiktok-content-registry/data/v2/studio-analytics/normalized/snapshots" `
  --created-by "2c4e254d-c779-4f8a-af93-603dc26e6af0" `
  --dry-run
```

**Success output:**
```
━━ V2 Studio Analytics Import ━━
  mode      : LIVE → video_master_v2
  files     : 12
  created_by: 2c4e254d-...

  ✓ upserted=1040 errors=0 invalid=0  [1/12] studio-analytics-XXXX.json
  ...

━━ Import Summary ━━
  rows upserted   : 1250
  affected IDs    : 1250 unique canonical IDs

━━ Cache Rebuild ━━
  rows written     : 1250
  with thumbnail   : 0   ← expected (thumbnails synced in Step 4)
  with studio data : 1250

━━ V2 DB Counts ━━
  video_master_v2 total          : 1250
  video_master_v2 with thumbnail : 0
  video_overview_cache_v2 total  : 1250
```

---

## Step 4 — Sync Thumbnails to video_master_v2

```powershell
npx tsx --env-file .env.local scripts/sync-thumbnails-to-v2.ts `
  --registry "D:/AI_OS/projects/tiktok-content-registry/data/v2/studio-thumbnails/registry/latest-by-post.json" `
  --created-by "2c4e254d-c779-4f8a-af93-603dc26e6af0" `
  --verify
```

**Success output:**
```
Loaded 1733 entries from V2 thumbnail registry
  → 1733 with valid video ID + thumbnail

Pass 1: updating existing video_master_v2 rows...
  updated 1250 (100%)
  ✓ Pass 1: 1250 updated, 483 unmatched

Pass 2: inserting 483 missing rows into video_master_v2...
  inserted 483 (100%)
  ✓ Pass 2: 483 inserted

━━ Write Results ━━
  Coverage: 1733/1733 registry entries in video_master_v2

━━ Before → After Counts ━━
  video_master_v2 WITH thumbnail_url:         0 → 1733
  video_overview_cache_v2 WITH thumbnail_url: 0 → 1733

━━ Top 5 rows by views ━━
  7623081123... | views: 4123456 | thumb: ✓ | My viral video title...
```

---

## Step 5 — Compare V1 vs V2

```powershell
npx tsx --env-file .env.local scripts/compare-v1-v2.ts `
  --created-by "2c4e254d-c779-4f8a-af93-603dc26e6af0" `
  --samples
```

**Example output:**
```
━━ V1 vs V2 Comparison ━━

Metric                                      V1          V2
─────────────────────────────────────────────────────────────────
video_master — total                      1733        1733
video_master — with thumbnail         1733 (100%) 1733 (100%)
video_overview_cache — total              1733        1733
cache — has_studio_data               1037 (60%) 1250 (72%)  ← V2 improved!
cache — with thumbnail                1733 (100%) 1733 (100%)
```

V2 is ready for cutover if:
- `video_master_v2 total >= video_master total`
- `thumbnail coverage = 100%`
- `has_studio_data coverage >= V1`

---

## Optional: Rebuild V2 Cache Only (no re-import)

If you just want to rebuild the V2 cache after making changes:

```powershell
npx tsx --env-file .env.local scripts/sync-thumbnails-to-v2.ts `
  --registry "D:/AI_OS/projects/tiktok-content-registry/data/v2/studio-thumbnails/registry/latest-by-post.json" `
  --created-by "2c4e254d-c779-4f8a-af93-603dc26e6af0" `
  --skip-insert-missing `
  --verify
```

---

## Optional: Import V1 Analytics into Staging (for V2 engagement data)

If V2 cache shows `has_studio_data = false` for most rows, it means the analytics data
is not yet in `tiktok_studio_analytics_rows`. Run the V1 analytics import for the V2 files:

```powershell
npx tsx --env-file .env.local scripts/import-tiktok-studio-analytics.ts `
  --dir "D:/AI_OS/projects/tiktok-content-registry/data/v2/studio-analytics/normalized/snapshots" `
  --created-by "2c4e254d-c779-4f8a-af93-603dc26e6af0"
```

This imports V2 analytics rows into `tiktok_studio_analytics_rows` (V1 staging table).
V2 cache rebuild will then join this engagement data.
Then rebuild V2 cache:

```powershell
npx tsx --env-file .env.local scripts/sync-thumbnails-to-v2.ts `
  --registry "D:/AI_OS/projects/tiktok-content-registry/data/v2/studio-thumbnails/registry/latest-by-post.json" `
  --created-by "2c4e254d-c779-4f8a-af93-603dc26e6af0" `
  --skip-insert-missing `
  --verify
```

---

## Verification SQL (run in Supabase SQL Editor)

```sql
-- V2 counts
SELECT
  (SELECT count(*) FROM video_master_v2 WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') AS vm2_total,
  (SELECT count(*) FROM video_master_v2 WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0' AND thumbnail_url IS NOT NULL) AS vm2_with_thumb,
  (SELECT count(*) FROM video_overview_cache_v2 WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') AS voc2_total,
  (SELECT count(*) FROM video_overview_cache_v2 WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0' AND has_studio_data = true) AS voc2_studio,
  (SELECT count(*) FROM video_overview_cache_v2 WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0' AND thumbnail_url IS NOT NULL) AS voc2_thumb;

-- Top 10 V2 videos by views (with thumbnails)
SELECT tiktok_video_id, video_title, headline_video_views, thumbnail_url IS NOT NULL AS has_thumb, has_studio_data
FROM video_overview_cache_v2
WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
ORDER BY headline_video_views DESC NULLS LAST
LIMIT 10;
```

---

## If Something Goes Wrong

| Symptom | Fix |
|---------|-----|
| Scraper exits with "login wall detected" | Log in to TikTok Studio in Chrome, then re-run .bat |
| `fetch failed` in import script | Network issue or Supabase down; retry the import command |
| `video_overview_cache_v2` stays empty | Run Step 4 (thumbnail sync triggers cache rebuild) |
| `has_studio_data = false` for all rows | Run V1 analytics import on V2 files (see Optional step above) |
| Selector not found error | TikTok changed DOM; check tiktok-content-registry issues; use V1 data |
| `migration-108` fails with "already exists" | Tables already created — OK, skip migration |

---

## After Sales Re-import (Future)

After uploading new sales data:
1. Run V2 affiliate sync when ready
2. Rebuild V2 cache: `sync-thumbnails-to-v2.ts --skip-insert-missing`
3. Compare V1 vs V2 sales coverage: `compare-v1-v2.ts`
4. If V2 matches or exceeds V1: cutover V2 → V1 (update sidebar link, etc.)
