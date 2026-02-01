-- ============================================
-- Migration 037: Affiliate UX Enhancements
-- Purpose: Import Mappings + TikTok Affiliate TH Support + Commission Split
-- Date: 2026-01-30
-- ============================================

-- ============================================
-- A) IMPORT MAPPINGS TABLE (Persist user-specific mappings)
-- ============================================

CREATE TABLE IF NOT EXISTS public.import_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    mapping_type VARCHAR(50) NOT NULL, -- e.g., 'tiktok_affiliate_th', 'shopee_affiliate', 'generic'
    mapping_json JSONB NOT NULL, -- { "order_id": "หมายเลขคำสั่งซื้อ", ... }
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(created_by, mapping_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_import_mappings_created_by
ON import_mappings(created_by);

CREATE INDEX IF NOT EXISTS idx_import_mappings_type
ON import_mappings(mapping_type);

-- RLS Policies
ALTER TABLE import_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own import mappings" ON import_mappings;
CREATE POLICY "Users can view own import mappings"
ON import_mappings
FOR SELECT
USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can insert own import mappings" ON import_mappings;
CREATE POLICY "Users can insert own import mappings"
ON import_mappings
FOR INSERT
WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can update own import mappings" ON import_mappings;
CREATE POLICY "Users can update own import mappings"
ON import_mappings
FOR UPDATE
USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can delete own import mappings" ON import_mappings;
CREATE POLICY "Users can delete own import mappings"
ON import_mappings
FOR DELETE
USING (auth.uid() = created_by);

-- ============================================
-- B) ENHANCE order_attribution TABLE (Commission Split)
-- ============================================

-- Add commission split columns for TikTok Affiliate (organic vs shop ad)
ALTER TABLE order_attribution
ADD COLUMN IF NOT EXISTS commission_amt_organic DECIMAL(12, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS commission_amt_shop_ad DECIMAL(12, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS commission_type VARCHAR(20) CHECK (commission_type IN ('organic', 'shop_ad', 'mixed', 'none'));

-- Update existing commission_amt to be organic by default (migration safety)
-- This is idempotent - only updates NULL commission_type rows
UPDATE order_attribution
SET
    commission_amt_organic = COALESCE(commission_amt, 0),
    commission_type = CASE
        WHEN commission_amt > 0 THEN 'organic'
        ELSE 'none'
    END
WHERE commission_type IS NULL;

-- Add index for commission_type filtering
CREATE INDEX IF NOT EXISTS idx_order_attribution_commission_type
ON order_attribution(commission_type);

-- ============================================
-- C) COMMENTS
-- ============================================

COMMENT ON TABLE import_mappings IS 'User-specific import column mappings (persisted, no localStorage)';
COMMENT ON COLUMN order_attribution.commission_amt_organic IS 'Commission from standard/organic sales (มาตรฐานโดยประมาณ)';
COMMENT ON COLUMN order_attribution.commission_amt_shop_ad IS 'Commission from shop ad sales (โฆษณาร้านค้าโดยประมาณ)';
COMMENT ON COLUMN order_attribution.commission_type IS 'Type of commission: organic, shop_ad, mixed, or none';

-- ============================================
-- END OF MIGRATION 037
-- ============================================
