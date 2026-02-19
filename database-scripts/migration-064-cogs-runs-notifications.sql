-- =============================================================
-- Migration 064: cogs_allocation_runs + notifications tables
-- =============================================================
-- Table A: cogs_allocation_runs  (tracks each Apply COGS job)
-- Table B: notifications         (bell notification inbox)
-- =============================================================

-- ─────────────────────────────────────────────
-- TABLE A: cogs_allocation_runs
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cogs_allocation_runs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What triggered this run
  trigger_source   text        NOT NULL CHECK (trigger_source IN ('MTD', 'DATE_RANGE', 'IMPORT_BATCH')),
  date_from        date        NULL,
  date_to          date        NULL,
  import_batch_id  uuid        NULL,   -- -> import_batches.id (soft reference)

  -- Lifecycle
  status           text        NOT NULL DEFAULT 'running'
                               CHECK (status IN ('running', 'success', 'failed')),

  -- Result payload (set on success)
  summary_json     jsonb       NULL,

  -- Error (set on failure)
  error_message    text        NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cogs_allocation_runs_user_created
  ON cogs_allocation_runs (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cogs_allocation_runs_user_status
  ON cogs_allocation_runs (created_by, status, created_at DESC);

-- RLS
ALTER TABLE cogs_allocation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cogs_allocation_runs_select_own"
  ON cogs_allocation_runs FOR SELECT
  USING (created_by = auth.uid());

CREATE POLICY "cogs_allocation_runs_insert_own"
  ON cogs_allocation_runs FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "cogs_allocation_runs_update_own"
  ON cogs_allocation_runs FOR UPDATE
  USING (created_by = auth.uid());

-- ─────────────────────────────────────────────
-- TABLE B: notifications
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Notification content
  type         text        NOT NULL,   -- 'cogs_allocation'
  title        text        NOT NULL,
  body         text        NOT NULL,

  -- Linked entity
  entity_type  text        NOT NULL,   -- 'cogs_run'
  entity_id    uuid        NOT NULL,   -- -> cogs_allocation_runs.id

  -- Read state
  is_read      boolean     NOT NULL DEFAULT false
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (created_by, is_read, created_at DESC);

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own"
  ON notifications FOR SELECT
  USING (created_by = auth.uid());

CREATE POLICY "notifications_insert_own"
  ON notifications FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "notifications_update_own"
  ON notifications FOR UPDATE
  USING (created_by = auth.uid());

-- ─────────────────────────────────────────────
-- updated_at trigger for cogs_allocation_runs
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cogs_allocation_runs_updated_at ON cogs_allocation_runs;
CREATE TRIGGER cogs_allocation_runs_updated_at
  BEFORE UPDATE ON cogs_allocation_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
