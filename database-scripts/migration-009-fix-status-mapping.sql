-- ============================================
-- Migration 009: Fix Sales Status Mapping
-- Description: Add status_group column and fix TikTok status mapping
-- Phase: 6B (Bug Fix)
-- Date: 2026-01-25
-- ============================================

-- ============================================
-- ADD status_group COLUMN
-- ============================================

ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS status_group TEXT;

COMMENT ON COLUMN public.sales_orders.status_group IS 'High-level status group from platform (e.g., TikTok Order Status: ที่จัดส่ง, ชำระเงินแล้ว, ยกเลิกแล้ว)';

-- ============================================
-- ADD INDEXES FOR PERFORMANCE
-- ============================================

-- Index on status for filtering (if not exists)
CREATE INDEX IF NOT EXISTS idx_sales_orders_status
ON public.sales_orders(status);

-- Index on status_group for filtering
CREATE INDEX IF NOT EXISTS idx_sales_orders_status_group
ON public.sales_orders(status_group);

-- Composite index for status filters
CREATE INDEX IF NOT EXISTS idx_sales_orders_status_filters
ON public.sales_orders(status, status_group, payment_status);

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

-- Verify new column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'sales_orders'
  AND column_name IN ('status', 'status_group')
ORDER BY column_name;
