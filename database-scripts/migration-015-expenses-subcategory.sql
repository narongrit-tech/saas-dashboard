-- Migration 015: Expenses Subcategory
-- Purpose: Add subcategory field to expenses table for detailed expense tracking
-- Created: 2026-01-25
-- Business Rule: Main category still required (affects P&L), subcategory is optional (for reporting only)

-- ============================================================================
-- ALTER TABLE: expenses
-- ============================================================================

-- Add subcategory column (nullable, free text)
ALTER TABLE public.expenses
ADD COLUMN IF NOT EXISTS subcategory VARCHAR(100);

COMMENT ON COLUMN public.expenses.subcategory IS 'Optional subcategory for detailed expense tracking (does not affect P&L formula)';

-- ============================================================================
-- INDEX
-- ============================================================================

-- Index for filtering by subcategory
CREATE INDEX IF NOT EXISTS idx_expenses_subcategory ON public.expenses(subcategory) WHERE subcategory IS NOT NULL;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify P&L formula unchanged (Daily P&L still uses main category only)
DO $$
BEGIN
  -- This is just a documentation check
  -- P&L formula: Revenue - Advertising - COGS - Operating
  -- Advertising = expenses WHERE category = 'Advertising'
  -- COGS = expenses WHERE category = 'COGS'
  -- Operating = expenses WHERE category = 'Operating'
  -- Subcategory does NOT affect this formula
  RAISE NOTICE 'Migration 015 completed: subcategory field added to expenses table';
  RAISE NOTICE 'P&L formula unchanged: still uses main category (Advertising, COGS, Operating)';
  RAISE NOTICE 'Subcategory is optional and used for detailed reporting only';
END $$;

-- ============================================================================
-- END OF MIGRATION 015
-- ============================================================================
