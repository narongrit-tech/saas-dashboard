-- ============================================
-- Migration 056: Fix Tracking Number Search
-- Description: Ensure tracking_number column exists and has proper indexes
-- Date: 2026-02-17
-- Related Issue: Returns search not finding tracking numbers
-- ============================================

-- This migration ensures the schema is correct (idempotent)
-- Migration-055 already created these, but we verify here

-- ============================================
-- 1) Verify tracking_number column exists
-- ============================================

-- Add column if not exists (migration-055 should have already done this)
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS tracking_number TEXT;

COMMENT ON COLUMN public.sales_orders.tracking_number IS 'Shipping tracking number for order fulfillment lookup (from Tracking ID in import)';

-- ============================================
-- 2) Verify search indexes exist
-- ============================================

-- Index for tracking number search (partial index for better performance)
CREATE INDEX IF NOT EXISTS idx_sales_orders_tracking_number
ON public.sales_orders(created_by, tracking_number)
WHERE tracking_number IS NOT NULL;

-- Index for external_order_id search (should already exist from migration-055)
CREATE INDEX IF NOT EXISTS idx_sales_orders_search_external_order_id
ON public.sales_orders(created_by, external_order_id)
WHERE external_order_id IS NOT NULL;

-- ============================================
-- 3) Verify migration status
-- ============================================

-- Check if column exists
DO $$
DECLARE
  column_exists BOOLEAN;
  index_tracking_exists BOOLEAN;
  index_external_order_exists BOOLEAN;
BEGIN
  -- Check tracking_number column
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_orders'
      AND column_name = 'tracking_number'
  ) INTO column_exists;

  -- Check tracking_number index
  SELECT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'sales_orders'
      AND indexname = 'idx_sales_orders_tracking_number'
  ) INTO index_tracking_exists;

  -- Check external_order_id index
  SELECT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'sales_orders'
      AND indexname = 'idx_sales_orders_search_external_order_id'
  ) INTO index_external_order_exists;

  -- Raise notice with results
  RAISE NOTICE '=== Migration 056 Verification ===';
  RAISE NOTICE 'tracking_number column exists: %', column_exists;
  RAISE NOTICE 'idx_sales_orders_tracking_number index exists: %', index_tracking_exists;
  RAISE NOTICE 'idx_sales_orders_search_external_order_id index exists: %', index_external_order_exists;

  IF NOT column_exists THEN
    RAISE EXCEPTION 'tracking_number column does not exist!';
  END IF;

  IF NOT index_tracking_exists THEN
    RAISE EXCEPTION 'idx_sales_orders_tracking_number index does not exist!';
  END IF;

  IF NOT index_external_order_exists THEN
    RAISE EXCEPTION 'idx_sales_orders_search_external_order_id index does not exist!';
  END IF;

  RAISE NOTICE '✓ All checks passed';
END $$;

-- ============================================
-- 4) Sample data check
-- ============================================

-- Check if any orders have tracking_number populated
SELECT
  COUNT(*) as total_orders,
  COUNT(tracking_number) as orders_with_tracking,
  ROUND(COUNT(tracking_number)::numeric / NULLIF(COUNT(*), 0)::numeric * 100, 2) as percent_with_tracking
FROM public.sales_orders;

-- Show sample orders with tracking_number
SELECT
  id,
  external_order_id,
  tracking_number,
  source_platform,
  order_date
FROM public.sales_orders
WHERE tracking_number IS NOT NULL
ORDER BY order_date DESC
LIMIT 5;

-- ============================================
-- END OF MIGRATION 056
-- ============================================
