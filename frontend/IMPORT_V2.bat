@echo off
powershell -NoExit -Command ^
  "Write-Host ''; " ^
  "Write-Host '============================================================' -ForegroundColor Cyan; " ^
  "Write-Host '  V2 Import: Analytics + Thumbnails + Compare' -ForegroundColor Cyan; " ^
  "Write-Host '============================================================' -ForegroundColor Cyan; " ^
  "Write-Host ''; " ^
  "cd 'D:\AI_OS\projects\saas-dashboard\frontend'; " ^
  "Write-Host '--- Step 1: Import analytics -> video_master_v2 ---' -ForegroundColor Yellow; " ^
  "npx tsx --env-file .env.local scripts/import-studio-analytics-v2.ts --dir 'D:/AI_OS/projects/tiktok-content-registry/data/v2/studio-analytics/normalized/snapshots' --created-by '2c4e254d-c779-4f8a-af93-603dc26e6af0'; " ^
  "Write-Host ''; " ^
  "Write-Host '--- Step 2: Sync thumbnails -> video_master_v2 + rebuild cache ---' -ForegroundColor Yellow; " ^
  "npx tsx --env-file .env.local scripts/sync-thumbnails-to-v2.ts --registry 'D:/AI_OS/projects/tiktok-content-registry/data/v2/studio-thumbnails/registry/latest-by-post.json' --created-by '2c4e254d-c779-4f8a-af93-603dc26e6af0' --verify; " ^
  "Write-Host ''; " ^
  "Write-Host '--- Step 3: Compare V1 vs V2 ---' -ForegroundColor Yellow; " ^
  "npx tsx --env-file .env.local scripts/compare-v1-v2.ts --created-by '2c4e254d-c779-4f8a-af93-603dc26e6af0' --samples; " ^
  "Write-Host ''; " ^
  "Write-Host '============================================================' -ForegroundColor Green; " ^
  "Write-Host '  DONE. Check output above for V1 vs V2 comparison.' -ForegroundColor Green; " ^
  "Write-Host '============================================================' -ForegroundColor Green; " ^
  "Read-Host 'Press Enter to close'"
