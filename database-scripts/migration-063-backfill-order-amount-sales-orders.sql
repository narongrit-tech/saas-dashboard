-- ============================================================
-- Migration 063: Backfill order_amount in sales_orders
-- Purpose: Populate sales_orders.order_amount for existing rows
--          where it is NULL so GMV cards show correct totals.
--
-- Strategy (per order_id, per user):
--   1. If order_financials has a non-null order_amount → use it.
--   2. Otherwise compute SUM(unit_price * quantity) from sales_orders
--      lines for that order (same as total_amount sum).
--
-- Safe to re-run: uses UPDATE ... WHERE order_amount IS NULL.
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- Step 1: Backfill from order_financials (preferred source)
-- Covers TikTok rows where metadata.order_amount was captured.
-- ----------------------------------------------------------------
UPDATE public.sales_orders so
SET
  order_amount = of_src.order_amount,
  updated_at   = NOW()
FROM (
  SELECT created_by, order_id, order_amount
  FROM   public.order_financials
  WHERE  order_amount IS NOT NULL
    AND  order_amount > 0
) of_src
WHERE so.created_by    = of_src.created_by
  AND so.order_id      = of_src.order_id
  AND so.order_amount  IS NULL;

-- ----------------------------------------------------------------
-- Step 2: Backfill remaining NULLs using SUM(total_amount) per order
-- Correct for:
--   - Shopee single-SKU orders (total_amount = order_amount)
--   - TikTok multi-SKU orders  (sum of line totals = order total)
-- ----------------------------------------------------------------
UPDATE public.sales_orders so
SET
  order_amount = line_sums.computed_amount,
  updated_at   = NOW()
FROM (
  SELECT
    created_by,
    order_id,
    SUM(total_amount) AS computed_amount
  FROM public.sales_orders
  WHERE order_amount IS NULL
    AND total_amount  IS NOT NULL
    AND total_amount  > 0
  GROUP BY created_by, order_id
  HAVING SUM(total_amount) > 0
) line_sums
WHERE so.created_by   = line_sums.created_by
  AND so.order_id     = line_sums.order_id
  AND so.order_amount IS NULL;

-- ----------------------------------------------------------------
-- Verification (informational — does not affect the migration)
-- ----------------------------------------------------------------
-- Run this after applying the migration to check results:
--
-- SELECT
--   source_platform,
--   COUNT(*) FILTER (WHERE order_amount IS NOT NULL) AS rows_with_order_amount,
--   COUNT(*) FILTER (WHERE order_amount IS NULL)     AS rows_still_null,
--   COUNT(DISTINCT order_id)                         AS total_orders
-- FROM public.sales_orders
-- WHERE created_by = '<your-user-id>'
-- GROUP BY source_platform;
-- ----------------------------------------------------------------

COMMIT;
