# V2 Verification Queries

## CLI Verification

### After Step 3 (analytics import)
```powershell
npx tsx --env-file .env.local scripts/compare-v1-v2.ts `
  --created-by "2c4e254d-c779-4f8a-af93-603dc26e6af0"
```

Expected: `video_master_v2 total` matches `video_master total` (or higher).

### After Step 4 (thumbnail sync)
```powershell
npx tsx --env-file .env.local scripts/sync-thumbnails-to-v2.ts `
  --registry "D:/AI_OS/projects/tiktok-content-registry/data/v2/studio-thumbnails/registry/latest-by-post.json" `
  --created-by "2c4e254d-c779-4f8a-af93-603dc26e6af0" `
  --skip-insert-missing `
  --verify
```

Expected: `video_overview_cache_v2 WITH thumbnail_url: 0 → N` where N ≥ V1 thumbnail count.

### Full comparison
```powershell
npx tsx --env-file .env.local scripts/compare-v1-v2.ts `
  --created-by "2c4e254d-c779-4f8a-af93-603dc26e6af0" `
  --samples
```

---

## SQL Verification (Supabase SQL Editor)

### 1. V2 Table row counts
```sql
SELECT
  (SELECT count(*) FROM video_master_v2         WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') AS vm2_total,
  (SELECT count(*) FROM video_source_mapping_v2 WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') AS vsm2_total,
  (SELECT count(*) FROM video_overview_cache_v2 WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') AS voc2_total;
```

### 2. V2 thumbnail + studio coverage
```sql
SELECT
  count(*) FILTER (WHERE thumbnail_url IS NOT NULL) AS with_thumbnail,
  count(*) FILTER (WHERE has_studio_data = true)    AS with_studio,
  count(*) FILTER (WHERE has_perf_data = true)      AS with_perf,
  count(*) FILTER (WHERE has_sales_data = true)     AS with_sales,
  count(*)                                           AS total
FROM video_overview_cache_v2
WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0';
```

### 3. Top 10 V2 videos by views
```sql
SELECT
  tiktok_video_id,
  video_title,
  headline_video_views,
  thumbnail_url IS NOT NULL AS has_thumb,
  has_studio_data,
  posted_at
FROM video_overview_cache_v2
WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
ORDER BY headline_video_views DESC NULLS LAST
LIMIT 10;
```

### 4. V1 vs V2 side-by-side
```sql
SELECT
  'V1' AS version,
  (SELECT count(*) FROM video_master         WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') AS vm_total,
  (SELECT count(*) FROM video_master         WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0' AND thumbnail_url IS NOT NULL) AS vm_thumb,
  (SELECT count(*) FROM video_overview_cache WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0' AND has_studio_data = true) AS cache_studio
UNION ALL
SELECT
  'V2' AS version,
  (SELECT count(*) FROM video_master_v2         WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0') AS vm_total,
  (SELECT count(*) FROM video_master_v2         WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0' AND thumbnail_url IS NOT NULL) AS vm_thumb,
  (SELECT count(*) FROM video_overview_cache_v2 WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0' AND has_studio_data = true) AS cache_studio;
```

### 5. V2 videos in V2 but not V1 (new discoveries)
```sql
SELECT vm2.tiktok_video_id, vm2.video_title, vm2.post_url, vm2.thumbnail_url IS NOT NULL AS has_thumb
FROM video_master_v2 vm2
WHERE vm2.created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
  AND NOT EXISTS (
    SELECT 1 FROM video_master vm1
    WHERE vm1.created_by = vm2.created_by
      AND vm1.tiktok_video_id = vm2.tiktok_video_id
  )
ORDER BY vm2.created_at DESC
LIMIT 20;
```

### 6. V1 videos missing from V2 (coverage gap check)
```sql
SELECT vm1.tiktok_video_id, vm1.video_title, vm1.post_url
FROM video_master vm1
WHERE vm1.created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
  AND NOT EXISTS (
    SELECT 1 FROM video_master_v2 vm2
    WHERE vm2.created_by = vm1.created_by
      AND vm2.tiktok_video_id = vm1.tiktok_video_id
  )
ORDER BY vm1.created_at DESC
LIMIT 20;
```

### 7. V2 source mapping summary
```sql
SELECT source_type, match_status, match_stage, count(*) AS cnt
FROM video_source_mapping_v2
WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
GROUP BY source_type, match_status, match_stage
ORDER BY source_type, cnt DESC;
```

---

## Definition of Done (V2 is ready to compare)

| Criterion | SQL to check | Expected |
|-----------|-------------|---------|
| V2 tables created | Query #1 returns rows | All 3 tables exist |
| V2 coverage ≥ V1 | Query #4 | vm2_total ≥ vm_total |
| V2 thumbnail = 100% | Query #2 | with_thumbnail = total |
| V2 studio data > 0 | Query #2 | with_studio > 0 |
| Top V2 videos have thumbnails | Query #3 | has_thumb = true for top rows |
