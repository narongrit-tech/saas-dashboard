-- ============================================
-- Migration 040: Fix Stock In - Add item_id Column
-- Purpose: Add item_id to inventory_stock_in_documents for proper SKU tracking
-- Date: 2026-02-01
-- Root Cause: Stock In was failing because item_id column was missing
-- ============================================

-- ============================================
-- 1) ADD item_id COLUMN (if not exists)
-- ============================================

DO $$
BEGIN
  -- Add item_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inventory_stock_in_documents'
      AND column_name = 'item_id'
  ) THEN
    ALTER TABLE public.inventory_stock_in_documents
      ADD COLUMN item_id UUID REFERENCES public.inventory_items(id) ON DELETE CASCADE;

    RAISE NOTICE 'Added item_id column to inventory_stock_in_documents';
  ELSE
    RAISE NOTICE 'item_id column already exists in inventory_stock_in_documents';
  END IF;
END $$;

-- ============================================
-- 2) ADD INDEX for item_id
-- ============================================

CREATE INDEX IF NOT EXISTS idx_stock_in_documents_item_id
  ON public.inventory_stock_in_documents(item_id);

-- ============================================
-- 3) UPDATE COMMENT
-- ============================================

COMMENT ON COLUMN public.inventory_stock_in_documents.item_id IS
  'Reference to inventory_items table (SKU)';

-- ============================================
-- 4) BACKFILL item_id for existing rows (if any)
-- ============================================

-- For any existing stock in documents without item_id,
-- try to resolve from inventory_receipt_layers
DO $$
DECLARE
  v_updated INT := 0;
BEGIN
  -- Update documents that have a matching receipt layer
  UPDATE public.inventory_stock_in_documents doc
  SET item_id = (
    SELECT i.id
    FROM public.inventory_receipt_layers layer
    JOIN public.inventory_items i ON i.sku_internal = layer.sku_internal
    WHERE layer.ref_type = 'PURCHASE'
      AND layer.ref_id = doc.id
    LIMIT 1
  )
  WHERE doc.item_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.inventory_receipt_layers layer
      WHERE layer.ref_type = 'PURCHASE'
        AND layer.ref_id = doc.id
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    RAISE NOTICE 'Backfilled item_id for % existing stock in documents', v_updated;
  ELSE
    RAISE NOTICE 'No existing stock in documents needed backfill';
  END IF;
END $$;

-- ============================================
-- END OF MIGRATION 040
-- ============================================
