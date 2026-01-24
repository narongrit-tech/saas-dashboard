-- Migration 006: User Column Mappings for Manual Ads Import
-- Purpose: Store user-defined column mappings (presets) for manual ads import wizard
-- Created: 2026-01-23

-- ============================================================================
-- Table: user_column_mappings
-- ============================================================================
-- Stores user-defined column mapping presets for Excel import
-- Each user can save multiple presets per report type (product/live/tiger)
-- Enables quick re-import of files with non-standard column names

CREATE TABLE user_column_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Pattern matching
  filename_pattern text NOT NULL,  -- Original filename or normalized pattern for matching
  report_type text NOT NULL CHECK (report_type IN ('product', 'live', 'tiger')),

  -- Column mapping data
  column_mapping jsonb NOT NULL,  -- Maps system fields to Excel column names
                                  -- Example: {"ad_date": "Date", "spend": "Cost", ...}

  -- Usage tracking
  use_count int NOT NULL DEFAULT 0,  -- Track how many times preset has been used
  last_used_at timestamptz NOT NULL DEFAULT now(),

  -- Audit fields
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Unique constraint: one preset per user + filename pattern + report type
  UNIQUE(user_id, filename_pattern, report_type)
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Fast lookup by user + report type (common query pattern)
CREATE INDEX idx_user_column_mappings_user_type
  ON user_column_mappings(user_id, report_type);

-- Order by last used (for showing recent presets first)
CREATE INDEX idx_user_column_mappings_last_used
  ON user_column_mappings(last_used_at DESC);

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE user_column_mappings ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only manage their own column mappings
CREATE POLICY "Users can manage own mappings"
  ON user_column_mappings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE user_column_mappings IS
  'User-defined column mapping presets for manual ads import. ' ||
  'Allows users to save and reuse Excel column mappings when auto-parse fails.';

COMMENT ON COLUMN user_column_mappings.filename_pattern IS
  'Original filename or normalized pattern for fuzzy matching. ' ||
  'Used to auto-detect preset when similar filename is uploaded.';

COMMENT ON COLUMN user_column_mappings.column_mapping IS
  'JSONB mapping of system field names to Excel column names. ' ||
  'Example: {"ad_date": "Campaign Date", "campaign_name": "Campaign", "spend": "Cost"}';

COMMENT ON COLUMN user_column_mappings.use_count IS
  'Number of times this preset has been used. ' ||
  'Incremented on each successful import using this mapping.';

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Uncomment to verify table creation:
-- SELECT * FROM user_column_mappings LIMIT 0;

-- Check RLS policies:
-- SELECT * FROM pg_policies WHERE tablename = 'user_column_mappings';

-- Check indexes:
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'user_column_mappings';
