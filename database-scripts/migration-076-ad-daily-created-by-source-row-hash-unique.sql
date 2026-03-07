-- ============================================
-- Migration 076: Add unique index for ad upsert conflict target
-- Purpose: Support ON CONFLICT (created_by, source_row_hash)
-- Date: 2026-03-07
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS ad_daily_perf_created_by_source_row_hash_uidx
ON public.ad_daily_performance (created_by, source_row_hash)
WHERE source_row_hash IS NOT NULL;

