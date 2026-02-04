-- Migration 053: Internal Affiliates Management
-- Create table to store internal affiliate data for profit attribution
-- Author: Claude
-- Date: 2026-02-04

-- ============================================
-- 1. CREATE TABLE: internal_affiliates
-- ============================================

CREATE TABLE IF NOT EXISTS internal_affiliates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Affiliate identifiers
  channel_id TEXT NOT NULL, -- TikTok username or channel ID (e.g., "@username")
  display_name TEXT, -- Optional friendly display name

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Metadata
  notes TEXT, -- Optional notes or description

  -- Audit columns
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT internal_affiliates_channel_id_not_empty CHECK (LENGTH(TRIM(channel_id)) > 0),
  CONSTRAINT internal_affiliates_unique_channel_per_user UNIQUE (created_by, channel_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_internal_affiliates_created_by
  ON internal_affiliates(created_by);

CREATE INDEX IF NOT EXISTS idx_internal_affiliates_channel_id
  ON internal_affiliates(channel_id);

CREATE INDEX IF NOT EXISTS idx_internal_affiliates_is_active
  ON internal_affiliates(is_active) WHERE is_active = true;

-- ============================================
-- 2. RLS POLICIES
-- ============================================

-- Enable RLS
ALTER TABLE internal_affiliates ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own affiliates
CREATE POLICY internal_affiliates_select_own
  ON internal_affiliates
  FOR SELECT
  USING (auth.uid() = created_by);

-- Policy: Users can insert their own affiliates
CREATE POLICY internal_affiliates_insert_own
  ON internal_affiliates
  FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- Policy: Users can update their own affiliates
CREATE POLICY internal_affiliates_update_own
  ON internal_affiliates
  FOR UPDATE
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- Policy: Users can delete their own affiliates
CREATE POLICY internal_affiliates_delete_own
  ON internal_affiliates
  FOR DELETE
  USING (auth.uid() = created_by);

-- ============================================
-- 3. FUNCTION: Auto-update updated_at timestamp
-- ============================================

CREATE OR REPLACE FUNCTION update_internal_affiliates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER internal_affiliates_updated_at_trigger
  BEFORE UPDATE ON internal_affiliates
  FOR EACH ROW
  EXECUTE FUNCTION update_internal_affiliates_updated_at();

-- ============================================
-- 4. GRANT PERMISSIONS
-- ============================================

-- Grant access to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON internal_affiliates TO authenticated;

-- ============================================
-- 5. COMMENTS
-- ============================================

COMMENT ON TABLE internal_affiliates IS
  'Store internal affiliate data for profit attribution. Each user maintains their own affiliate list.';

COMMENT ON COLUMN internal_affiliates.channel_id IS
  'TikTok channel ID or username (e.g., @username). Used to match with order_attribution.affiliate_channel_id.';

COMMENT ON COLUMN internal_affiliates.display_name IS
  'Optional friendly name for display in reports (e.g., full name or nickname).';

COMMENT ON COLUMN internal_affiliates.is_active IS
  'Flag to soft-delete or disable affiliates without losing historical data.';
