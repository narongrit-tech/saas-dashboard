-- =============================================================================
-- Migration 072: Add stable dedup constraint to sales_orders
-- Date: 2026-05-30
-- Problem:
--   order_line_hash includes total_amount in its formula.
--   When TikTok updates price/amount between report exports, the hash changes
--   and the unique index misses the collision → duplicate rows are inserted.
--
-- Fix:
--   Add a real unique constraint on (created_by, external_order_id, sku) —
--   the stable identifiers that will NEVER change for the same order line.
--   This acts as a hard dedup guard independent of the hash value.
-- =============================================================================

-- Add stable unique constraint: one row per (user, TikTok order, SKU variant)
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_orders_external_sku
  ON public.sales_orders(created_by, external_order_id, sku)
  WHERE external_order_id IS NOT NULL
    AND sku               IS NOT NULL;

COMMENT ON INDEX public.uq_sales_orders_external_sku IS
  'Prevents duplicate sales_orders rows for the same TikTok order line '
  '(external_order_id + sku), independent of order_line_hash value. '
  'Catches re-imports where total_amount or other hash inputs changed.';

-- Verification
DO $$
BEGIN
  RAISE NOTICE '=== Migration 072 Verification ===';
  RAISE NOTICE 'uq_sales_orders_external_sku : created (external_order_id + sku per user)';
  RAISE NOTICE '✓ Migration 072 complete';
END $$;
