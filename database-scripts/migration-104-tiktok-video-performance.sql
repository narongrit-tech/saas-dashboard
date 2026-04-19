-- ============================================
-- Migration 104: TikTok Video Performance Staging
-- Scope:
--   tiktok_video_perf_import_batches  — batch-level tracking per uploaded file
--   tiktok_video_perf_stats           — per-video normalized staging rows
--
-- Notes:
--   - Source: Creator-Video-Performance_*.xlsx (TikTok Creator export)
--   - Duplicate video_id_raw across rows is ALLOWED at staging level.
--     Dedup policy is enforced by the import engine, not this schema.
--   - All data is scoped by created_by (RLS enforced).
--   - No normalization stored procedures — parser already normalizes in TypeScript.
--   - This schema does NOT touch finance, wallet, reconciliation, or affiliate orders.
-- ============================================

BEGIN;

-- ============================================
-- 1) IMPORT BATCH TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS public.tiktok_video_perf_import_batches (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by             UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  source_platform        TEXT         NOT NULL DEFAULT 'tiktok_creator',
  source_report_type     TEXT         NOT NULL DEFAULT 'video_performance_export',
  source_file_name       TEXT         NOT NULL,
  source_sheet_name      TEXT         NOT NULL DEFAULT 'Sheet1',
  source_file_hash       TEXT,

  date_range_raw         TEXT,

  status                 TEXT         NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'staged', 'failed')),

  raw_row_count          INTEGER      NOT NULL DEFAULT 0 CHECK (raw_row_count >= 0),
  staged_row_count       INTEGER      NOT NULL DEFAULT 0 CHECK (staged_row_count >= 0),
  invalid_row_count      INTEGER      NOT NULL DEFAULT 0 CHECK (invalid_row_count >= 0),
  duplicate_video_id_count INTEGER    NOT NULL DEFAULT 0 CHECK (duplicate_video_id_count >= 0),

  notes                  TEXT,
  metadata               JSONB        NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tvpib_created_by_date
  ON public.tiktok_video_perf_import_batches(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tvpib_status
  ON public.tiktok_video_perf_import_batches(created_by, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tvpib_file_hash
  ON public.tiktok_video_perf_import_batches(created_by, source_file_hash, created_at DESC)
  WHERE source_file_hash IS NOT NULL;

CREATE TRIGGER trg_tiktok_video_perf_import_batches_updated_at
  BEFORE UPDATE ON public.tiktok_video_perf_import_batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.tiktok_video_perf_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tvpib_select ON public.tiktok_video_perf_import_batches;
CREATE POLICY tvpib_select ON public.tiktok_video_perf_import_batches
  FOR SELECT TO authenticated USING (created_by = auth.uid());

DROP POLICY IF EXISTS tvpib_insert ON public.tiktok_video_perf_import_batches;
CREATE POLICY tvpib_insert ON public.tiktok_video_perf_import_batches
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tvpib_update ON public.tiktok_video_perf_import_batches;
CREATE POLICY tvpib_update ON public.tiktok_video_perf_import_batches
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tvpib_delete ON public.tiktok_video_perf_import_batches;
CREATE POLICY tvpib_delete ON public.tiktok_video_perf_import_batches
  FOR DELETE TO authenticated USING (created_by = auth.uid());

COMMENT ON TABLE public.tiktok_video_perf_import_batches IS
  'Batch-level tracking for TikTok Creator video performance Excel imports. One row per uploaded file.';
COMMENT ON COLUMN public.tiktok_video_perf_import_batches.source_file_hash IS
  'SHA-256 hash of the uploaded file. Used to detect repeat imports of the same file.';
COMMENT ON COLUMN public.tiktok_video_perf_import_batches.duplicate_video_id_count IS
  'Count of rows with a video_id_raw that appears more than once in this batch. Not an error — kept visible.';

-- ============================================
-- 2) PER-VIDEO STAGING ROWS
-- ============================================

CREATE TABLE IF NOT EXISTS public.tiktok_video_perf_stats (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by           UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_batch_id      UUID         NOT NULL
    REFERENCES public.tiktok_video_perf_import_batches(id) ON DELETE CASCADE,

  source               TEXT         NOT NULL DEFAULT 'tiktok_video_performance_export',
  source_file          TEXT         NOT NULL,

  -- Identity (required)
  video_id_raw         TEXT         NOT NULL,
  video_title          TEXT         NOT NULL,

  -- Date/time
  posted_at_raw        TEXT         NOT NULL,
  posted_at            TIMESTAMPTZ,

  -- Duration
  duration_raw         TEXT,
  duration_sec         INTEGER      CHECK (duration_sec >= 0),

  -- Revenue (THB)
  gmv_total_raw        TEXT,
  gmv_total            NUMERIC(18, 2),
  gmv_direct_raw       TEXT,
  gmv_direct           NUMERIC(18, 2),

  -- Engagement
  views_raw            TEXT,
  views                INTEGER      CHECK (views >= 0),
  units_sold_raw       TEXT,
  units_sold           INTEGER      CHECK (units_sold >= 0),

  -- Rates (stored as decimal 0–1)
  ctr_raw              TEXT,
  ctr                  NUMERIC(12, 8),
  watch_full_rate_raw  TEXT,
  watch_full_rate      NUMERIC(12, 8),

  -- Followers
  new_followers_raw    TEXT,
  new_followers        INTEGER      CHECK (new_followers >= 0),

  -- Audit
  raw_payload          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  source_row_number    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tvps_import_batch_id
  ON public.tiktok_video_perf_stats(import_batch_id);

CREATE INDEX IF NOT EXISTS idx_tvps_created_by
  ON public.tiktok_video_perf_stats(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tvps_video_id_raw
  ON public.tiktok_video_perf_stats(created_by, video_id_raw);

CREATE INDEX IF NOT EXISTS idx_tvps_posted_at
  ON public.tiktok_video_perf_stats(created_by, posted_at DESC)
  WHERE posted_at IS NOT NULL;

ALTER TABLE public.tiktok_video_perf_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tvps_select ON public.tiktok_video_perf_stats;
CREATE POLICY tvps_select ON public.tiktok_video_perf_stats
  FOR SELECT TO authenticated USING (created_by = auth.uid());

DROP POLICY IF EXISTS tvps_insert ON public.tiktok_video_perf_stats;
CREATE POLICY tvps_insert ON public.tiktok_video_perf_stats
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tvps_update ON public.tiktok_video_perf_stats;
CREATE POLICY tvps_update ON public.tiktok_video_perf_stats
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tvps_delete ON public.tiktok_video_perf_stats;
CREATE POLICY tvps_delete ON public.tiktok_video_perf_stats
  FOR DELETE TO authenticated USING (created_by = auth.uid());

COMMENT ON TABLE public.tiktok_video_perf_stats IS
  'Per-video staging rows from TikTok Creator video performance Excel export. Duplicate video_id_raw allowed — dedup policy applied by import engine.';
COMMENT ON COLUMN public.tiktok_video_perf_stats.ctr IS
  'Click-through rate as a 0–1 decimal. Raw string preserved in ctr_raw.';
COMMENT ON COLUMN public.tiktok_video_perf_stats.watch_full_rate IS
  'Watch-full rate as a 0–1 decimal. Raw string preserved in watch_full_rate_raw.';

COMMIT;
