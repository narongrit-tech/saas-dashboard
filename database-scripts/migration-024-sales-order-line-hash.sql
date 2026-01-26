-- ============================================
-- Migration 024: Add order_line_hash to sales_orders
-- Purpose: Support idempotent imports (prevent duplicate line items)
-- Date: 2026-01-26
-- ============================================

-- ============================================
-- ADD order_line_hash COLUMN
-- ============================================

ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS order_line_hash TEXT;

COMMENT ON COLUMN public.sales_orders.order_line_hash IS
'Deterministic hash for deduplication: SHA256(created_by|source_platform|external_order_id|product_name|quantity|total_amount)';

-- ============================================
-- CREATE UNIQUE INDEX FOR UPSERT
-- ============================================

-- Drop existing index if it exists (for idempotent migration)
DROP INDEX IF EXISTS idx_sales_orders_order_line_hash_unique;

-- Create unique constraint: (created_by, order_line_hash)
-- This ensures one user cannot import the same line twice
CREATE UNIQUE INDEX idx_sales_orders_order_line_hash_unique
ON public.sales_orders(created_by, order_line_hash)
WHERE order_line_hash IS NOT NULL;

-- ============================================
-- BACKFILL EXISTING ROWS (Best Effort)
-- ============================================

-- Generate order_line_hash for existing imported rows
-- Manual rows (source='manual') can remain NULL (no deduplication needed)
UPDATE public.sales_orders
SET order_line_hash = encode(
  sha256(
    (created_by::text || '|' ||
     COALESCE(source_platform, marketplace, '') || '|' ||
     COALESCE(external_order_id, order_id, '') || '|' ||
     COALESCE(product_name, '') || '|' ||
     COALESCE(quantity, 0)::text || '|' ||
     COALESCE(total_amount, 0)::text
    )::bytea
  ),
  'hex'
)
WHERE order_line_hash IS NULL
  AND source = 'imported'
  AND product_name IS NOT NULL;

-- ============================================
-- VERIFICATION QUERY (Run manually after migration)
-- ============================================

-- Check NULL order_line_hash count for imported rows (should be 0)
-- SELECT
--   source,
--   COUNT(*) as total_rows,
--   COUNT(order_line_hash) as rows_with_hash,
--   COUNT(*) - COUNT(order_line_hash) as rows_without_hash
-- FROM public.sales_orders
-- WHERE source = 'imported'
-- GROUP BY source;

-- Check for potential duplicates (should return 0 rows)
-- SELECT
--   created_by,
--   order_line_hash,
--   COUNT(*) as duplicate_count
-- FROM public.sales_orders
-- WHERE order_line_hash IS NOT NULL
-- GROUP BY created_by, order_line_hash
-- HAVING COUNT(*) > 1;

-- ============================================
-- END OF MIGRATION
-- ============================================
