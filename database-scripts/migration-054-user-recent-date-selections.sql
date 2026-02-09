-- Migration 054: User Recent Date Selections
-- Purpose: Store user's recently used date ranges for DateRangePicker
-- Date: 2026-02-09

-- Create table for storing user's recently used date ranges
CREATE TABLE IF NOT EXISTS user_recent_date_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL,           -- Display text (e.g., "1 ก.พ. - 5 ก.พ. 2569")
  start_date text NOT NULL,      -- YYYY-MM-DD format (Bangkok calendar date)
  end_date text NOT NULL,        -- YYYY-MM-DD format (Bangkok calendar date)
  preset text,                   -- Preset key if from preset (e.g., "last7days"), null for custom
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_date_range UNIQUE(user_id, start_date, end_date)
);

-- Index for performance (fetch recent selections sorted by last_used_at)
CREATE INDEX IF NOT EXISTS idx_recent_selections_user_last_used
  ON user_recent_date_selections(user_id, last_used_at DESC);

-- Enable RLS
ALTER TABLE user_recent_date_selections ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own selections
CREATE POLICY "Users can view own recent selections"
  ON user_recent_date_selections
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own selections
CREATE POLICY "Users can insert own recent selections"
  ON user_recent_date_selections
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can update their own selections
CREATE POLICY "Users can update own recent selections"
  ON user_recent_date_selections
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can delete their own selections
CREATE POLICY "Users can delete own recent selections"
  ON user_recent_date_selections
  FOR DELETE
  USING (auth.uid() = user_id);

-- Comment on table
COMMENT ON TABLE user_recent_date_selections IS 'Stores recently used date ranges for each user (max 3 per user)';

-- Comment on columns
COMMENT ON COLUMN user_recent_date_selections.label IS 'Display text for UI (e.g., "1 ก.พ. - 5 ก.พ. 2569")';
COMMENT ON COLUMN user_recent_date_selections.start_date IS 'Start date in YYYY-MM-DD format (Bangkok timezone)';
COMMENT ON COLUMN user_recent_date_selections.end_date IS 'End date in YYYY-MM-DD format (Bangkok timezone)';
COMMENT ON COLUMN user_recent_date_selections.preset IS 'Preset key (e.g., "last7days") if selected from preset, null for custom range';
