-- ============================================
-- Migration 060: COGS Apply Run Log
-- Description: Add persistent logging for Apply COGS operations
-- Date: 2026-02-19
-- Purpose: Track apply COGS runs for auditing and export
-- ============================================

BEGIN;

-- ============================================
-- TABLE: inventory_cogs_apply_runs
-- Description: Master log of each Apply COGS run
-- ============================================

CREATE TABLE IF NOT EXISTS public.inventory_cogs_apply_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Date range
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    -- Method used
    method VARCHAR(10) NOT NULL CHECK (method IN ('FIFO', 'AVG')),

    -- Summary counts
    total INTEGER NOT NULL DEFAULT 0,
    eligible INTEGER NOT NULL DEFAULT 0,
    successful INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,

    -- Audit
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT cogs_apply_runs_dates_valid CHECK (start_date <= end_date),
    CONSTRAINT cogs_apply_runs_counts_non_negative CHECK (
        total >= 0 AND eligible >= 0 AND successful >= 0 AND skipped >= 0 AND failed >= 0
    )
);

COMMENT ON TABLE public.inventory_cogs_apply_runs IS 'Log of Apply COGS runs for auditing and export';
COMMENT ON COLUMN public.inventory_cogs_apply_runs.start_date IS 'Start date of date range (Bangkok timezone)';
COMMENT ON COLUMN public.inventory_cogs_apply_runs.end_date IS 'End date of date range (Bangkok timezone)';
COMMENT ON COLUMN public.inventory_cogs_apply_runs.method IS 'Costing method: FIFO or AVG';
COMMENT ON COLUMN public.inventory_cogs_apply_runs.total IS 'Total orders processed';
COMMENT ON COLUMN public.inventory_cogs_apply_runs.successful IS 'Successfully allocated orders';
COMMENT ON COLUMN public.inventory_cogs_apply_runs.skipped IS 'Skipped orders (already allocated, etc.)';
COMMENT ON COLUMN public.inventory_cogs_apply_runs.failed IS 'Failed orders (no stock, missing SKU, etc.)';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cogs_apply_runs_created_at
ON public.inventory_cogs_apply_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cogs_apply_runs_created_by
ON public.inventory_cogs_apply_runs(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cogs_apply_runs_date_range
ON public.inventory_cogs_apply_runs(start_date, end_date);

-- ============================================
-- TABLE: inventory_cogs_apply_run_items
-- Description: Detailed items for each run (order-level)
-- ============================================

CREATE TABLE IF NOT EXISTS public.inventory_cogs_apply_run_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Reference to run
    run_id UUID NOT NULL REFERENCES public.inventory_cogs_apply_runs(id) ON DELETE CASCADE,

    -- Order details
    order_id VARCHAR(100) NOT NULL,
    sku VARCHAR(100),
    qty NUMERIC(12, 4),

    -- Result
    status VARCHAR(20) NOT NULL CHECK (status IN ('successful', 'skipped', 'failed')),
    reason TEXT,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.inventory_cogs_apply_run_items IS 'Detailed items for each Apply COGS run';
COMMENT ON COLUMN public.inventory_cogs_apply_run_items.run_id IS 'Reference to parent run';
COMMENT ON COLUMN public.inventory_cogs_apply_run_items.order_id IS 'Order ID from sales_orders';
COMMENT ON COLUMN public.inventory_cogs_apply_run_items.sku IS 'SKU from order (seller_sku)';
COMMENT ON COLUMN public.inventory_cogs_apply_run_items.qty IS 'Quantity from order';
COMMENT ON COLUMN public.inventory_cogs_apply_run_items.status IS 'Result: successful, skipped, or failed';
COMMENT ON COLUMN public.inventory_cogs_apply_run_items.reason IS 'Skip/failure reason (if applicable)';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cogs_apply_run_items_run_id
ON public.inventory_cogs_apply_run_items(run_id);

CREATE INDEX IF NOT EXISTS idx_cogs_apply_run_items_order_id
ON public.inventory_cogs_apply_run_items(order_id);

CREATE INDEX IF NOT EXISTS idx_cogs_apply_run_items_status
ON public.inventory_cogs_apply_run_items(run_id, status);

CREATE INDEX IF NOT EXISTS idx_cogs_apply_run_items_sku
ON public.inventory_cogs_apply_run_items(sku);

-- ============================================
-- RLS POLICIES
-- ============================================

-- Enable RLS
ALTER TABLE public.inventory_cogs_apply_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_cogs_apply_run_items ENABLE ROW LEVEL SECURITY;

-- Runs: Users can view runs they created
DROP POLICY IF EXISTS "Users can view their own runs" ON public.inventory_cogs_apply_runs;
CREATE POLICY "Users can view their own runs"
ON public.inventory_cogs_apply_runs
FOR SELECT
USING (created_by = auth.uid());

-- Runs: Users can insert their own runs
DROP POLICY IF EXISTS "Users can create runs" ON public.inventory_cogs_apply_runs;
CREATE POLICY "Users can create runs"
ON public.inventory_cogs_apply_runs
FOR INSERT
WITH CHECK (created_by = auth.uid());

-- Runs: Users can update their own runs
DROP POLICY IF EXISTS "Users can update their own runs" ON public.inventory_cogs_apply_runs;
CREATE POLICY "Users can update their own runs"
ON public.inventory_cogs_apply_runs
FOR UPDATE
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

-- Run Items: Users can view items for runs they created
DROP POLICY IF EXISTS "Users can view their run items" ON public.inventory_cogs_apply_run_items;
CREATE POLICY "Users can view their run items"
ON public.inventory_cogs_apply_run_items
FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.inventory_cogs_apply_runs
        WHERE id = run_id AND created_by = auth.uid()
    )
);

-- Run Items: Users can insert items for their runs
DROP POLICY IF EXISTS "Users can insert run items" ON public.inventory_cogs_apply_run_items;
CREATE POLICY "Users can insert run items"
ON public.inventory_cogs_apply_run_items
FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.inventory_cogs_apply_runs
        WHERE id = run_id AND created_by = auth.uid()
    )
);

-- ============================================
-- VERIFICATION
-- ============================================

DO $$
BEGIN
    -- Check tables exist
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_cogs_apply_runs') THEN
        RAISE NOTICE 'Table inventory_cogs_apply_runs created successfully';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_cogs_apply_run_items') THEN
        RAISE NOTICE 'Table inventory_cogs_apply_run_items created successfully';
    END IF;

    -- Check RLS enabled
    IF (SELECT relrowsecurity FROM pg_class WHERE relname = 'inventory_cogs_apply_runs') THEN
        RAISE NOTICE 'RLS enabled on inventory_cogs_apply_runs';
    END IF;

    IF (SELECT relrowsecurity FROM pg_class WHERE relname = 'inventory_cogs_apply_run_items') THEN
        RAISE NOTICE 'RLS enabled on inventory_cogs_apply_run_items';
    END IF;

    RAISE NOTICE 'Migration 059 completed successfully!';
END $$;

COMMIT;

-- ============================================
-- USAGE EXAMPLES
-- ============================================

-- Example: Create a run
-- INSERT INTO inventory_cogs_apply_runs (start_date, end_date, method, total, successful, skipped, failed, created_by)
-- VALUES ('2026-02-01', '2026-02-28', 'FIFO', 100, 80, 15, 5, auth.uid())
-- RETURNING id;

-- Example: Add run items
-- INSERT INTO inventory_cogs_apply_run_items (run_id, order_id, sku, qty, status, reason)
-- VALUES
--   ('run-uuid-here', 'ORDER001', 'SKU001', 5, 'successful', NULL),
--   ('run-uuid-here', 'ORDER002', 'SKU002', 3, 'skipped', 'ALREADY_ALLOCATED'),
--   ('run-uuid-here', 'ORDER003', 'SKU003', 10, 'failed', 'NO_STOCK_LAYERS');

-- Example: Query run history
-- SELECT id, start_date, end_date, method, total, successful, skipped, failed, created_at
-- FROM inventory_cogs_apply_runs
-- WHERE created_by = auth.uid()
-- ORDER BY created_at DESC
-- LIMIT 20;

-- Example: Query run details
-- SELECT order_id, sku, qty, status, reason
-- FROM inventory_cogs_apply_run_items
-- WHERE run_id = 'run-uuid-here'
-- AND status = 'failed'
-- ORDER BY order_id;

-- Example: Export run items to CSV (use server action)
-- SELECT order_id, sku, qty, status, reason
-- FROM inventory_cogs_apply_run_items
-- WHERE run_id = 'run-uuid-here'
-- ORDER BY status, order_id;
