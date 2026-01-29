-- ============================================
-- Migration 034: Opening Balance Void Tracking
-- Description: Add columns for soft delete (void) of opening balance layers
-- Date: 2026-01-30
-- ============================================

-- ============================================
-- ADD COLUMNS TO inventory_receipt_layers
-- ============================================

-- Add void tracking columns
ALTER TABLE public.inventory_receipt_layers
ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.inventory_receipt_layers
ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.inventory_receipt_layers
ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add comments
COMMENT ON COLUMN public.inventory_receipt_layers.is_voided IS 'True if this layer has been voided (soft deleted)';
COMMENT ON COLUMN public.inventory_receipt_layers.voided_at IS 'Timestamp when layer was voided (Bangkok TZ)';
COMMENT ON COLUMN public.inventory_receipt_layers.voided_by IS 'User who voided this layer';

-- ============================================
-- INDEXES
-- ============================================

-- Index for filtering non-voided layers by user and date
CREATE INDEX IF NOT EXISTS idx_receipt_layers_user_voided_date
ON public.inventory_receipt_layers(created_by, is_voided, received_at)
WHERE is_voided = false;

-- Index for filtering voided layers
CREATE INDEX IF NOT EXISTS idx_receipt_layers_voided
ON public.inventory_receipt_layers(is_voided, voided_at)
WHERE is_voided = true;

-- ============================================
-- UPDATE EXISTING QUERIES (OPTIONAL)
-- ============================================

-- Note: Existing queries should filter WHERE is_voided = false
-- to exclude voided layers from FIFO allocation and reports

-- ============================================
-- END OF MIGRATION
-- ============================================
