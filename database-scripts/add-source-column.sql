-- ============================================
-- Migration: Add source column to sales_orders
-- Purpose: Distinguish manual orders from imported orders
-- Date: 2026-01-19
-- ============================================

-- Add source column with default 'imported'
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'imported';

-- Add index for source column (for filtering manual vs imported orders)
CREATE INDEX IF NOT EXISTS idx_sales_orders_source ON public.sales_orders(source);

-- Add comment
COMMENT ON COLUMN public.sales_orders.source IS 'Order source: manual (user-entered) or imported (from CSV/API)';

-- Display success message
DO $$
BEGIN
    RAISE NOTICE 'Migration completed: source column added to sales_orders';
END $$;
