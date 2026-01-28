-- ============================================
-- Migration 029: Extract TikTok Business Timestamps from metadata
-- Description: Add created_time, paid_time, cancelled_time columns for order-level aggregation
-- Phase: Sales Orders - TikTok Semantics & Import Verification
-- Date: 2026-01-28
-- ============================================

-- ============================================
-- Purpose:
-- TikTok OrderSKUList export provides business timestamps:
-- - created_time: When customer placed order (Create Time / Created Time)
-- - paid_time: When payment was confirmed (Paid Time)
-- - cancelled_time: When order was cancelled (Cancelled Time)
-- These are currently in metadata JSONB. Extract to direct columns for:
-- 1. Fast filtering by created_time or paid_time (dateBasis toggle)
-- 2. Same-day cancel calculation: DATE(cancelled_time) = DATE(created_time)
-- 3. Order-level aggregation (1 row per order_id)
-- ============================================

-- ============================================
-- ADD COLUMNS
-- ============================================

-- Add created_time (when customer placed order)
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS created_time TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.sales_orders.created_time IS
'TikTok business timestamp: When customer placed order (from OrderSKUList Create Time / Created Time). Used for created_at-based metrics and same-day cancel calculation.';

-- Add paid_time (when payment confirmed)
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS paid_time TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.sales_orders.paid_time IS
'TikTok business timestamp: When payment was confirmed (from OrderSKUList Paid Time). Used for paid-based dateBasis filtering.';

-- Add cancelled_time (when order was cancelled)
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS cancelled_time TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.sales_orders.cancelled_time IS
'TikTok business timestamp: When order was cancelled (from OrderSKUList Cancelled Time). Used for same-day cancel calculation: DATE(cancelled_time) = DATE(created_time).';

-- ============================================
-- CREATE INDEXES FOR FILTERING
-- ============================================

-- Index for dateBasis="order" (filter by created_time)
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_time
ON public.sales_orders(created_time)
WHERE created_time IS NOT NULL;

-- Index for dateBasis="paid" (filter by paid_time)
CREATE INDEX IF NOT EXISTS idx_sales_orders_paid_time
ON public.sales_orders(paid_time)
WHERE paid_time IS NOT NULL;

-- Index for cancelled_time (used for same-day cancel logic)
CREATE INDEX IF NOT EXISTS idx_sales_orders_cancelled_time
ON public.sales_orders(cancelled_time)
WHERE cancelled_time IS NOT NULL;

-- Composite index for same-day cancel queries (created_time + cancelled_time)
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_cancelled
ON public.sales_orders(created_time, cancelled_time)
WHERE cancelled_time IS NOT NULL;

-- ============================================
-- BACKFILL EXISTING DATA FROM METADATA
-- ============================================

-- Extract created_time from metadata->>'created_time'
UPDATE public.sales_orders
SET created_time = (metadata->>'created_time')::timestamp with time zone
WHERE created_time IS NULL
  AND metadata ? 'created_time'
  AND metadata->>'created_time' IS NOT NULL
  AND metadata->>'created_time' != '';

-- Extract paid_time from metadata->>'paid_time'
UPDATE public.sales_orders
SET paid_time = (metadata->>'paid_time')::timestamp with time zone
WHERE paid_time IS NULL
  AND metadata ? 'paid_time'
  AND metadata->>'paid_time' IS NOT NULL
  AND metadata->>'paid_time' != '';

-- Extract cancelled_time from metadata->>'cancelled_time'
UPDATE public.sales_orders
SET cancelled_time = (metadata->>'cancelled_time')::timestamp with time zone
WHERE cancelled_time IS NULL
  AND metadata ? 'cancelled_time'
  AND metadata->>'cancelled_time' IS NOT NULL
  AND metadata->>'cancelled_time' != '';

-- ============================================
-- FALLBACK 1: Use paid_at for paid_time if missing
-- ============================================

-- If paid_time is still NULL but paid_at exists, use paid_at as fallback
UPDATE public.sales_orders
SET paid_time = paid_at
WHERE paid_time IS NULL
  AND paid_at IS NOT NULL;

-- ============================================
-- FALLBACK 2: Use order_date for created_time if missing
-- ============================================

-- If created_time is still NULL but order_date exists, use order_date as fallback
-- This handles legacy data imported before created_time extraction
UPDATE public.sales_orders
SET created_time = order_date
WHERE created_time IS NULL
  AND order_date IS NOT NULL;

-- ============================================
-- FALLBACK 3: Safe parsing of cancelled_time from metadata string
-- ============================================

-- Some imports may store cancelled_time as formatted string in metadata
-- Format: "YYYY-MM-DD HH:MI:SS" (without timezone indicator)
-- Assume Asia/Bangkok timezone (+07) and parse safely

-- Helper: Try to parse cancelled_time from metadata string format
-- Only update rows where:
-- 1. cancelled_time is NULL
-- 2. metadata has 'cancelled_time' key with non-empty value
-- 3. Value matches timestamp pattern (safe guard against invalid data)
UPDATE public.sales_orders
SET cancelled_time = (
  CASE
    -- Try to parse as timestamp with timezone
    WHEN metadata->>'cancelled_time' ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$' THEN
      (metadata->>'cancelled_time' || ' +07')::timestamp with time zone
    -- If already has timezone info, parse directly
    WHEN metadata->>'cancelled_time' ~ '^\d{4}-\d{2}-\d{2}' THEN
      (metadata->>'cancelled_time')::timestamp with time zone
    ELSE
      NULL
  END
)
WHERE cancelled_time IS NULL
  AND metadata ? 'cancelled_time'
  AND metadata->>'cancelled_time' IS NOT NULL
  AND metadata->>'cancelled_time' != ''
  -- Guard: only process if looks like timestamp format
  AND metadata->>'cancelled_time' ~ '^\d{4}-\d{2}-\d{2}';

-- ============================================
-- VERIFICATION QUERIES (Auto-run after migration)
-- ============================================

-- Check extraction coverage by source
DO $$
DECLARE
  v_total_rows INTEGER;
  v_created_time_count INTEGER;
  v_paid_time_count INTEGER;
  v_cancelled_time_count INTEGER;
  v_created_time_pct NUMERIC;
  v_paid_time_pct NUMERIC;
  v_cancelled_time_pct NUMERIC;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'MIGRATION 029 VERIFICATION RESULTS';
  RAISE NOTICE '========================================';

  -- Overall coverage
  SELECT
    COUNT(*),
    COUNT(created_time),
    COUNT(paid_time),
    COUNT(cancelled_time),
    ROUND(100.0 * COUNT(created_time) / NULLIF(COUNT(*), 0), 2),
    ROUND(100.0 * COUNT(paid_time) / NULLIF(COUNT(*), 0), 2),
    ROUND(100.0 * COUNT(cancelled_time) / NULLIF(COUNT(*), 0), 2)
  INTO v_total_rows, v_created_time_count, v_paid_time_count, v_cancelled_time_count,
       v_created_time_pct, v_paid_time_pct, v_cancelled_time_pct
  FROM public.sales_orders;

  RAISE NOTICE 'Total Rows: %', v_total_rows;
  RAISE NOTICE 'Rows with created_time: % (% %%)', v_created_time_count, v_created_time_pct;
  RAISE NOTICE 'Rows with paid_time: % (% %%)', v_paid_time_count, v_paid_time_pct;
  RAISE NOTICE 'Rows with cancelled_time: % (% %%)', v_cancelled_time_count, v_cancelled_time_pct;
  RAISE NOTICE '----------------------------------------';

  -- Check rows where created_time is still NULL (should be minimal)
  SELECT COUNT(*)
  INTO v_total_rows
  FROM public.sales_orders
  WHERE created_time IS NULL;

  IF v_total_rows > 0 THEN
    RAISE WARNING 'Found % rows with NULL created_time (manual entries or edge cases)', v_total_rows;
  ELSE
    RAISE NOTICE 'All rows have created_time populated (expected for imported data)';
  END IF;

  RAISE NOTICE '========================================';
END $$;

-- Sample 20 rows with NULL created_time (should be empty or only manual entries)
DO $$
DECLARE
  rec RECORD;
  counter INTEGER := 0;
BEGIN
  RAISE NOTICE 'Sample rows with NULL created_time (max 20):';

  FOR rec IN
    SELECT order_id, source, order_date, created_at
    FROM public.sales_orders
    WHERE created_time IS NULL
    ORDER BY created_at DESC
    LIMIT 20
  LOOP
    counter := counter + 1;
    RAISE NOTICE '  %: order_id=%, source=%, order_date=%, created_at=%',
      counter, rec.order_id, rec.source, rec.order_date, rec.created_at;
  END LOOP;

  IF counter = 0 THEN
    RAISE NOTICE '  (No rows with NULL created_time - excellent!)';
  END IF;
END $$;

-- ============================================
-- MANUAL VERIFICATION (Optional - Run separately)
-- ============================================

-- Coverage by source type
-- SELECT
--   source,
--   COUNT(*) as total_rows,
--   COUNT(created_time) as rows_with_created_time,
--   COUNT(paid_time) as rows_with_paid_time,
--   COUNT(cancelled_time) as rows_with_cancelled_time,
--   ROUND(100.0 * COUNT(created_time) / COUNT(*), 2) as created_time_pct,
--   ROUND(100.0 * COUNT(paid_time) / COUNT(*), 2) as paid_time_pct,
--   ROUND(100.0 * COUNT(cancelled_time) / COUNT(*), 2) as cancelled_time_pct
-- FROM public.sales_orders
-- GROUP BY source
-- ORDER BY source;

-- Sample imported data with timestamps
-- SELECT
--   order_id,
--   external_order_id,
--   created_time,
--   paid_time,
--   cancelled_time,
--   platform_status,
--   order_date,
--   metadata->>'created_time' as metadata_created,
--   metadata->>'paid_time' as metadata_paid,
--   metadata->>'cancelled_time' as metadata_cancelled
-- FROM public.sales_orders
-- WHERE source = 'imported'
-- ORDER BY created_at DESC
-- LIMIT 10;

-- ============================================
-- END OF MIGRATION
-- ============================================
