-- Migration 019: Global Import Deduplication Framework
-- Purpose: Add row-level deduplication for all import entities
-- Created: 2026-01-25

-- ============================================================================
-- PART 1: Expenses Deduplication
-- ============================================================================

-- Add expense_hash column
ALTER TABLE public.expenses
ADD COLUMN IF NOT EXISTS expense_hash VARCHAR(64);

-- Create unique index for deduplication
DROP INDEX IF EXISTS idx_expenses_unique_hash;

CREATE UNIQUE INDEX idx_expenses_unique_hash
  ON public.expenses(created_by, expense_hash)
  WHERE expense_hash IS NOT NULL;

-- Create index for faster hash lookups
CREATE INDEX IF NOT EXISTS idx_expenses_hash
  ON public.expenses(expense_hash)
  WHERE expense_hash IS NOT NULL;

-- Function: Generate expense hash
CREATE OR REPLACE FUNCTION public.generate_expense_hash(
  p_created_by UUID,
  p_expense_date DATE,
  p_category VARCHAR(50),
  p_amount NUMERIC,
  p_description TEXT
) RETURNS VARCHAR(64) AS $$
BEGIN
  -- Generate SHA256 hash from expense key fields
  -- Format: created_by|expense_date|category|amount|description
  RETURN encode(
    digest(
      p_created_by::TEXT || '|' ||
      p_expense_date::TEXT || '|' ||
      p_category || '|' ||
      p_amount::TEXT || '|' ||
      COALESCE(p_description, ''),
      'sha256'
    ),
    'hex'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON COLUMN public.expenses.expense_hash IS
  'SHA256 hash for deduplication. Generated from: created_by|expense_date|category|amount|description';

COMMENT ON FUNCTION public.generate_expense_hash IS
  'Generates SHA256 hash for expense deduplication';

-- ============================================================================
-- PART 2: Sales Orders Deduplication
-- ============================================================================

-- Add order_line_hash column
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS order_line_hash VARCHAR(64);

-- Create unique index for deduplication
DROP INDEX IF EXISTS idx_sales_orders_unique_hash;

CREATE UNIQUE INDEX idx_sales_orders_unique_hash
  ON public.sales_orders(created_by, order_line_hash)
  WHERE order_line_hash IS NOT NULL;

-- Create index for faster hash lookups
CREATE INDEX IF NOT EXISTS idx_sales_orders_hash
  ON public.sales_orders(order_line_hash)
  WHERE order_line_hash IS NOT NULL;

-- Function: Generate order line hash
CREATE OR REPLACE FUNCTION public.generate_order_line_hash(
  p_created_by UUID,
  p_source_platform VARCHAR(50),
  p_external_order_id VARCHAR(255),
  p_product_name TEXT,
  p_quantity INTEGER,
  p_total_amount NUMERIC
) RETURNS VARCHAR(64) AS $$
BEGIN
  -- Generate SHA256 hash from order line key fields
  -- Format: created_by|source_platform|external_order_id|product_name|quantity|total_amount
  RETURN encode(
    digest(
      p_created_by::TEXT || '|' ||
      COALESCE(p_source_platform, '') || '|' ||
      COALESCE(p_external_order_id, '') || '|' ||
      COALESCE(p_product_name, '') || '|' ||
      COALESCE(p_quantity, 0)::TEXT || '|' ||
      COALESCE(p_total_amount, 0)::TEXT,
      'sha256'
    ),
    'hex'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON COLUMN public.sales_orders.order_line_hash IS
  'SHA256 hash for deduplication. Generated from: created_by|source_platform|external_order_id|product_name|quantity|total_amount';

COMMENT ON FUNCTION public.generate_order_line_hash IS
  'Generates SHA256 hash for sales order line deduplication';

-- ============================================================================
-- PART 3: Import Batches File Hash Constraint (System-Wide)
-- ============================================================================

-- Add unique constraint for file_hash per user per report_type
-- This prevents uploading the same file twice

DROP INDEX IF EXISTS idx_import_batches_unique_file;

CREATE UNIQUE INDEX idx_import_batches_unique_file
  ON public.import_batches(created_by, file_hash, report_type)
  WHERE file_hash IS NOT NULL AND status = 'success';

COMMENT ON INDEX idx_import_batches_unique_file IS
  'Prevents duplicate file imports per user per report type. Only applies to successful imports.';

-- ============================================================================
-- PART 4: Backfill Hashes (Optional - Run After Migration)
-- ============================================================================

-- Uncomment to backfill expense_hash for existing records
-- UPDATE public.expenses
-- SET expense_hash = public.generate_expense_hash(
--   created_by,
--   expense_date,
--   category,
--   amount,
--   description
-- )
-- WHERE expense_hash IS NULL;

-- Uncomment to backfill order_line_hash for existing records
-- UPDATE public.sales_orders
-- SET order_line_hash = public.generate_order_line_hash(
--   created_by,
--   source_platform,
--   external_order_id,
--   product_name,
--   quantity,
--   total_amount
-- )
-- WHERE order_line_hash IS NULL;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
