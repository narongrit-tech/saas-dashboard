-- ============================================
-- Migration 057: Returns Queue + Undo
-- Description: Add Queue workflow and Undo functionality for returns
-- Date: 2026-02-17
-- ============================================

-- ============================================
-- 1) ADD reversed_return_id and action_type to inventory_returns
-- ============================================

-- Add action_type column to distinguish between RETURN and UNDO actions
ALTER TABLE public.inventory_returns
ADD COLUMN IF NOT EXISTS action_type TEXT DEFAULT 'RETURN'
CHECK (action_type IN ('RETURN', 'UNDO'));

COMMENT ON COLUMN public.inventory_returns.action_type IS 'Action type: RETURN (normal return) | UNDO (reversal of a return)';

-- Add reversed_return_id to link undo actions to original return
ALTER TABLE public.inventory_returns
ADD COLUMN IF NOT EXISTS reversed_return_id UUID
REFERENCES public.inventory_returns(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.inventory_returns.reversed_return_id IS 'References original return ID when action_type = UNDO';

-- Create index for finding undone returns
CREATE INDEX IF NOT EXISTS idx_inventory_returns_reversed_return_id
ON public.inventory_returns(reversed_return_id)
WHERE reversed_return_id IS NOT NULL;

-- Create index for action_type filtering
CREATE INDEX IF NOT EXISTS idx_inventory_returns_action_type
ON public.inventory_returns(created_by, action_type, returned_at);

-- ============================================
-- 2) ADD payment_status to sales_orders for queue filtering
-- ============================================

-- Add payment_status column if not exists (for refund detection)
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS payment_status TEXT;

COMMENT ON COLUMN public.sales_orders.payment_status IS 'Payment status (e.g., paid, refunded, partial_refund) for queue filtering';

-- Create index for queue query performance
CREATE INDEX IF NOT EXISTS idx_sales_orders_queue_filter
ON public.sales_orders(created_by, status_group, shipped_at)
WHERE shipped_at IS NOT NULL;

-- ============================================
-- 3) VERIFICATION
-- ============================================

DO $$
DECLARE
  action_type_exists BOOLEAN;
  reversed_return_id_exists BOOLEAN;
  payment_status_exists BOOLEAN;
BEGIN
  -- Check action_type column
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inventory_returns'
      AND column_name = 'action_type'
  ) INTO action_type_exists;

  -- Check reversed_return_id column
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inventory_returns'
      AND column_name = 'reversed_return_id'
  ) INTO reversed_return_id_exists;

  -- Check payment_status column
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_orders'
      AND column_name = 'payment_status'
  ) INTO payment_status_exists;

  RAISE NOTICE '=== Migration 057 Verification ===';
  RAISE NOTICE 'inventory_returns.action_type exists: %', action_type_exists;
  RAISE NOTICE 'inventory_returns.reversed_return_id exists: %', reversed_return_id_exists;
  RAISE NOTICE 'sales_orders.payment_status exists: %', payment_status_exists;

  IF NOT action_type_exists THEN
    RAISE EXCEPTION 'action_type column does not exist!';
  END IF;

  IF NOT reversed_return_id_exists THEN
    RAISE EXCEPTION 'reversed_return_id column does not exist!';
  END IF;

  IF NOT payment_status_exists THEN
    RAISE EXCEPTION 'payment_status column does not exist!';
  END IF;

  RAISE NOTICE '✓ All checks passed';
END $$;

-- ============================================
-- END OF MIGRATION 057
-- ============================================
