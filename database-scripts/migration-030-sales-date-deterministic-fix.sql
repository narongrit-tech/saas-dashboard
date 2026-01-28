-- ============================================
-- Migration 030: Deterministic Date Filtering for Sales Orders
-- Description: Fix date mismatch by using COALESCE(created_time, order_date)
-- Root Cause: UI filters by created_time >= startDate which excludes NULL created_time rows
-- Solution: Use effective_date = COALESCE(created_time, order_date) for all date operations
-- Date: 2026-01-28
-- ============================================

-- ============================================
-- Purpose:
-- TikTok OrderSKUList provides created_time (business timestamp)
-- But some orders may have NULL created_time due to:
-- 1. Legacy data before migration-029
-- 2. Manual entries
-- 3. Import errors
--
-- Current bug: getSalesAggregates() uses "WHERE created_time >= startDate"
-- → Rows with created_time=NULL are excluded at DB level
-- → Client-side fallback never runs (rows not fetched)
-- → UI shows 920 orders instead of 1386
--
-- Fix: Use COALESCE(created_time, order_date) everywhere for date filtering
-- ============================================

-- ============================================
-- HELPER FUNCTION: Get effective order date
-- ============================================

CREATE OR REPLACE FUNCTION public.get_effective_order_date(
  p_created_time TIMESTAMP WITH TIME ZONE,
  p_order_date TIMESTAMP WITH TIME ZONE
) RETURNS TIMESTAMP WITH TIME ZONE AS $$
BEGIN
  RETURN COALESCE(p_created_time, p_order_date);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION public.get_effective_order_date IS
'Returns created_time if not NULL, otherwise order_date. Used for deterministic date filtering in sales_orders queries.';

-- ============================================
-- CREATE INDEX ON COALESCE(created_time, order_date)
-- ============================================

-- Drop existing index if exists
DROP INDEX IF EXISTS idx_sales_orders_effective_order_date;

-- Create functional index for fast filtering
CREATE INDEX idx_sales_orders_effective_order_date
ON public.sales_orders(COALESCE(created_time, order_date))
WHERE COALESCE(created_time, order_date) IS NOT NULL;

COMMENT ON INDEX idx_sales_orders_effective_order_date IS
'Functional index for date filtering using COALESCE(created_time, order_date). Ensures rows with NULL created_time are not excluded from date range queries.';

-- ============================================
-- CREATE INDEX ON Bangkok date (for date-only filters)
-- ============================================

-- Drop existing index if exists
DROP INDEX IF EXISTS idx_sales_orders_bangkok_date;

-- Create functional index for Bangkok date filtering
CREATE INDEX idx_sales_orders_bangkok_date
ON public.sales_orders(DATE(COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok'))
WHERE COALESCE(created_time, order_date) IS NOT NULL;

COMMENT ON INDEX idx_sales_orders_bangkok_date IS
'Functional index for date-only filtering in Bangkok timezone. Used by UI date range picker (startDate/endDate as YYYY-MM-DD).';

-- ============================================
-- VERIFICATION QUERY (Run after migration)
-- ============================================

-- Check how many orders have NULL created_time in Jan 2026
-- SELECT
--   COUNT(*) as rows_total,
--   COUNT(created_time) as rows_with_created_time,
--   COUNT(*) - COUNT(created_time) as rows_without_created_time,
--   COUNT(DISTINCT external_order_id) as orders_distinct
-- FROM sales_orders
-- WHERE DATE(COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok') >= '2026-01-01'
--   AND DATE(COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok') <= '2026-01-28'
--   AND source_platform = 'tiktok_shop';
--
-- Expected: rows_without_created_time should match (1386 - 920) = 466

-- ============================================
-- END OF MIGRATION
-- ============================================
