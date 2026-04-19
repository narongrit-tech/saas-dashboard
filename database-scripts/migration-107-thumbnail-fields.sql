-- ============================================================
-- Migration 107: Add thumbnail_url + thumbnail_source to canonical video layer
-- Run after migration-106 (video_master) and migration-106b (video_overview_cache)
-- ============================================================

BEGIN;

ALTER TABLE public.video_master
  ADD COLUMN IF NOT EXISTS thumbnail_url    TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_source TEXT;

ALTER TABLE public.video_overview_cache
  ADD COLUMN IF NOT EXISTS thumbnail_url    TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_source TEXT;

COMMIT;
