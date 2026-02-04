-- ============================================
-- Migration 050: Populate order_financials.order_amount
-- Purpose: Backfill NULL order_amount and create trigger for auto-population
-- Type: Data Migration + Schema Enhancement
-- Date: 2026-02-04
-- ============================================

-- ============================================
-- STEP 1: Create Function for Auto-Population
-- ============================================

CREATE OR REPLACE FUNCTION public.auto_populate_order_amount()
RETURNS TRIGGER AS $$
BEGIN
  -- Only populate if order_amount is NULL
  IF NEW.order_amount IS NULL THEN
    -- Try to get amount from sales_orders
    SELECT
      COALESCE(so.order_amount, so.total_amount)
    INTO NEW.order_amount
    FROM sales_orders so
    WHERE so.order_id = NEW.order_id
      AND so.created_by = NEW.created_by
    LIMIT 1;

    -- If still NULL (no matching sales_order), log warning but don't fail
    IF NEW.order_amount IS NULL THEN
      RAISE WARNING 'Could not populate order_amount for order_id: %, created_by: %',
        NEW.order_id, NEW.created_by;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION public.auto_populate_order_amount() IS
  'Trigger function to auto-populate order_amount from sales_orders when NULL';

-- ============================================
-- STEP 2: Create Trigger
-- ============================================

DROP TRIGGER IF EXISTS trg_populate_order_amount ON public.order_financials;

CREATE TRIGGER trg_populate_order_amount
  BEFORE INSERT OR UPDATE ON public.order_financials
  FOR EACH ROW
  WHEN (NEW.order_amount IS NULL)
  EXECUTE FUNCTION public.auto_populate_order_amount();

-- Add comment
COMMENT ON TRIGGER trg_populate_order_amount ON public.order_financials IS
  'Auto-populate order_amount from sales_orders when NULL on INSERT/UPDATE';

-- ============================================
-- STEP 3: Backfill Existing NULL Values
-- ============================================

DO $$
DECLARE
  v_updated_count INTEGER;
  v_total_null_count INTEGER;
BEGIN
  -- Count NULL values before update
  SELECT COUNT(*) INTO v_total_null_count
  FROM order_financials
  WHERE order_amount IS NULL;

  RAISE NOTICE 'Found % records with NULL order_amount', v_total_null_count;

  -- Backfill from sales_orders
  WITH updated AS (
    UPDATE order_financials of
    SET order_amount = COALESCE(so.order_amount, so.total_amount)
    FROM sales_orders so
    WHERE of.order_id = so.order_id
      AND of.created_by = so.created_by
      AND of.order_amount IS NULL
      AND (so.order_amount IS NOT NULL OR so.total_amount IS NOT NULL)
    RETURNING of.order_id
  )
  SELECT COUNT(*) INTO v_updated_count FROM updated;

  RAISE NOTICE 'Successfully updated % records', v_updated_count;

  -- Check remaining NULLs
  SELECT COUNT(*) INTO v_total_null_count
  FROM order_financials
  WHERE order_amount IS NULL;

  IF v_total_null_count > 0 THEN
    RAISE WARNING '% records still have NULL order_amount (no matching sales_orders)',
      v_total_null_count;
  ELSE
    RAISE NOTICE 'All records successfully populated!';
  END IF;
END $$;

-- ============================================
-- STEP 4: Create Index for Performance
-- ============================================

-- Index to speed up trigger lookups (if not exists)
CREATE INDEX IF NOT EXISTS idx_sales_orders_order_id_created_by
  ON sales_orders(order_id, created_by);

CREATE INDEX IF NOT EXISTS idx_order_financials_order_id_created_by
  ON order_financials(order_id, created_by);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- 1. Check backfill results
-- SELECT
--   COUNT(*) as total_records,
--   COUNT(order_amount) as has_amount,
--   COUNT(*) - COUNT(order_amount) as still_null,
--   SUM(order_amount) as total_amount
-- FROM order_financials;

-- 2. Verify trigger function exists
-- SELECT proname, prosrc
-- FROM pg_proc
-- WHERE proname = 'auto_populate_order_amount';

-- 3. Verify trigger exists
-- SELECT tgname, tgtype, tgenabled
-- FROM pg_trigger
-- WHERE tgname = 'trg_populate_order_amount';

-- 4. Test trigger with sample insert (optional)
-- INSERT INTO order_financials (order_id, created_by, created_time)
-- SELECT order_id, created_by, created_time
-- FROM sales_orders
-- WHERE order_id NOT IN (SELECT order_id FROM order_financials LIMIT 1)
-- LIMIT 1;
-- -- Check if order_amount was auto-populated

-- ============================================
-- ROLLBACK (if needed)
-- ============================================

-- To rollback this migration:
-- 1. Drop trigger
-- DROP TRIGGER IF EXISTS trg_populate_order_amount ON public.order_financials;
--
-- 2. Drop function
-- DROP FUNCTION IF EXISTS public.auto_populate_order_amount();
--
-- 3. Optional: Reset order_amount to NULL (not recommended)
-- UPDATE order_financials SET order_amount = NULL;

-- ============================================
-- END OF MIGRATION
-- ============================================
