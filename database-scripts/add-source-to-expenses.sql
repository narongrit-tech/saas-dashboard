-- ============================================
-- Migration: Add source column to expenses
-- Purpose: Distinguish manual expenses from imported expenses
-- Date: 2026-01-19
-- ============================================

-- Add source column with default 'manual'
ALTER TABLE public.expenses
ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual';

-- Add index for source column (for filtering manual vs imported expenses)
CREATE INDEX IF NOT EXISTS idx_expenses_source ON public.expenses(source);

-- Add comment
COMMENT ON COLUMN public.expenses.source IS 'Expense source: manual (user-entered) or imported (from CSV/API)';

-- Display success message
DO $$
BEGIN
    RAISE NOTICE 'Migration completed: source column added to expenses';
END $$;
