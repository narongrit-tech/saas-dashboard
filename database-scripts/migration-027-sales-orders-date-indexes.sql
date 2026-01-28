-- ============================================
-- Migration 027: Sales Orders Date Indexes
-- Description: Add indexes for order_date filtering to support date basis selector
-- Date: 2026-01-27
-- ============================================

-- Add index for order_date (for filtering when basis=order_date)
CREATE INDEX IF NOT EXISTS idx_sales_orders_order_date
    ON public.sales_orders(order_date DESC NULLS LAST)
    WHERE order_date IS NOT NULL;

-- Add composite index for created_by + order_date (RLS-friendly)
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_by_order_date
    ON public.sales_orders(created_by, order_date DESC NULLS LAST)
    WHERE order_date IS NOT NULL;

-- Add composite index for created_by + paid_at (RLS-friendly)
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_by_paid_at
    ON public.sales_orders(created_by, paid_at DESC NULLS LAST)
    WHERE paid_at IS NOT NULL;

-- Add comment
COMMENT ON INDEX public.idx_sales_orders_order_date IS 'Index for order_date filtering (date basis selector)';
COMMENT ON INDEX public.idx_sales_orders_created_by_order_date IS 'Composite index for RLS-friendly order_date filtering';
COMMENT ON INDEX public.idx_sales_orders_created_by_paid_at IS 'Composite index for RLS-friendly paid_at filtering';

-- ============================================
-- END OF MIGRATION
-- ============================================
