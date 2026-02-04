-- ============================================
-- Migration 041: Add quantity and item_id to Stock In Documents
-- Purpose: Fix Stock In flow to store quantity and item reference
-- Date: 2026-02-01
-- Root Cause: Original schema missing quantity and item_id columns
-- ============================================

-- ============================================
-- 1) ADD COLUMNS (if not exists)
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

  -- Add quantity column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inventory_stock_in_documents'
      AND column_name = 'quantity'
  ) THEN
    ALTER TABLE public.inventory_stock_in_documents
      ADD COLUMN quantity DECIMAL(12, 4);

    RAISE NOTICE 'Added quantity column to inventory_stock_in_documents';
  ELSE
    RAISE NOTICE 'quantity column already exists in inventory_stock_in_documents';
  END IF;

  -- Add unit_cost column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inventory_stock_in_documents'
      AND column_name = 'unit_cost'
  ) THEN
    ALTER TABLE public.inventory_stock_in_documents
      ADD COLUMN unit_cost DECIMAL(12, 2);

    RAISE NOTICE 'Added unit_cost column to inventory_stock_in_documents';
  ELSE
    RAISE NOTICE 'unit_cost column already exists in inventory_stock_in_documents';
  END IF;
END $$;

-- ============================================
-- 2) ADD INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_stock_in_documents_item_id
  ON public.inventory_stock_in_documents(item_id);

-- ============================================
-- 3) ADD CONSTRAINTS
-- ============================================

DO $$
BEGIN
  -- Add CHECK constraint for quantity > 0 (if not exists)
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'stock_in_quantity_positive'
      AND table_name = 'inventory_stock_in_documents'
  ) THEN
    ALTER TABLE public.inventory_stock_in_documents
      ADD CONSTRAINT stock_in_quantity_positive CHECK (quantity > 0);

    RAISE NOTICE 'Added CHECK constraint: quantity > 0';
  END IF;

  -- Add CHECK constraint for unit_cost >= 0 (if not exists)
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'stock_in_unit_cost_non_negative'
      AND table_name = 'inventory_stock_in_documents'
  ) THEN
    ALTER TABLE public.inventory_stock_in_documents
      ADD CONSTRAINT stock_in_unit_cost_non_negative CHECK (unit_cost >= 0);

    RAISE NOTICE 'Added CHECK constraint: unit_cost >= 0';
  END IF;
END $$;

-- ============================================
-- 4) UPDATE COMMENTS
-- ============================================

COMMENT ON COLUMN public.inventory_stock_in_documents.item_id IS
  'Reference to inventory_items table (which SKU was received)';

COMMENT ON COLUMN public.inventory_stock_in_documents.quantity IS
  'Quantity received in this stock in transaction';

COMMENT ON COLUMN public.inventory_stock_in_documents.unit_cost IS
  'Unit cost for this stock in (for reference and audit)';

-- ============================================
-- 5) BACKFILL item_id and quantity from receipt layers
-- ============================================

DO $$
DECLARE
  v_updated INT := 0;
BEGIN
  -- Update documents that have a matching receipt layer
  UPDATE public.inventory_stock_in_documents doc
  SET
    item_id = (
      SELECT i.id
      FROM public.inventory_receipt_layers layer
      JOIN public.inventory_items i ON i.sku_internal = layer.sku_internal
      WHERE layer.ref_type IN ('PURCHASE', 'STOCK_IN')
        AND layer.ref_id = doc.id
      LIMIT 1
    ),
    quantity = (
      SELECT layer.qty_received
      FROM public.inventory_receipt_layers layer
      WHERE layer.ref_type IN ('PURCHASE', 'STOCK_IN')
        AND layer.ref_id = doc.id
      LIMIT 1
    ),
    unit_cost = (
      SELECT layer.unit_cost
      FROM public.inventory_receipt_layers layer
      WHERE layer.ref_type IN ('PURCHASE', 'STOCK_IN')
        AND layer.ref_id = doc.id
      LIMIT 1
    )
  WHERE doc.item_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.inventory_receipt_layers layer
      WHERE layer.ref_type IN ('PURCHASE', 'STOCK_IN')
        AND layer.ref_id = doc.id
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    RAISE NOTICE 'Backfilled item_id, quantity, unit_cost for % existing stock in documents', v_updated;
  ELSE
    RAISE NOTICE 'No existing stock in documents needed backfill';
  END IF;
END $$;

-- ============================================
-- END OF MIGRATION 041
-- ============================================
