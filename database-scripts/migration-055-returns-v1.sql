-- ============================================
-- Migration 055: Returns v1 with Barcode Search
-- Description: Add returns tracking with COGS reversal support
-- Date: 2026-02-17
-- ============================================

-- ============================================
-- 1) ADD tracking_number to sales_orders
-- ============================================

ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS tracking_number TEXT;

COMMENT ON COLUMN public.sales_orders.tracking_number IS 'Shipping tracking number for order fulfillment lookup';

-- Create index for fast tracking number search
CREATE INDEX IF NOT EXISTS idx_sales_orders_tracking_number
ON public.sales_orders(created_by, tracking_number)
WHERE tracking_number IS NOT NULL;

-- Create composite index for search performance (external_order_id)
CREATE INDEX IF NOT EXISTS idx_sales_orders_search_external_order_id
ON public.sales_orders(created_by, external_order_id)
WHERE external_order_id IS NOT NULL;

-- Add status_group column if not exists (for order status filtering)
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS status_group TEXT;

COMMENT ON COLUMN public.sales_orders.status_group IS 'Order status group (ที่จัดส่ง, ชำระเงินแล้ว, ยกเลิกแล้ว)';

-- ============================================
-- 2) CREATE inventory_returns table
-- ============================================

CREATE TABLE IF NOT EXISTS public.inventory_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) NOT NULL,

  -- Order reference
  order_id UUID REFERENCES public.sales_orders(id) ON DELETE CASCADE NOT NULL,

  -- Return details
  sku TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  return_type TEXT NOT NULL CHECK (return_type IN ('RETURN_RECEIVED', 'REFUND_ONLY', 'CANCEL_BEFORE_SHIP')),
  note TEXT,

  -- Timestamp
  returned_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.inventory_returns IS 'Return transactions: track customer returns with COGS reversal';
COMMENT ON COLUMN public.inventory_returns.order_id IS 'Reference to sales_orders.id (not order_id string)';
COMMENT ON COLUMN public.inventory_returns.sku IS 'SKU returned (matches sales_orders.sku or seller_sku)';
COMMENT ON COLUMN public.inventory_returns.qty IS 'Quantity returned (positive integer)';
COMMENT ON COLUMN public.inventory_returns.return_type IS 'RETURN_RECEIVED: stock + COGS reversal | REFUND_ONLY: no stock change | CANCEL_BEFORE_SHIP: reverse allocation';
COMMENT ON COLUMN public.inventory_returns.returned_at IS 'Timestamp when return was processed (Bangkok timezone)';

-- ============================================
-- 3) CREATE indexes for performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_inventory_returns_order_id
ON public.inventory_returns(order_id);

CREATE INDEX IF NOT EXISTS idx_inventory_returns_created_by
ON public.inventory_returns(created_by);

CREATE INDEX IF NOT EXISTS idx_inventory_returns_returned_at
ON public.inventory_returns(returned_at);

CREATE INDEX IF NOT EXISTS idx_inventory_returns_order_sku
ON public.inventory_returns(order_id, sku);

-- ============================================
-- 4) ENABLE RLS
-- ============================================

ALTER TABLE public.inventory_returns ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 5) RLS POLICIES
-- ============================================

DROP POLICY IF EXISTS "inventory_returns_select_policy" ON public.inventory_returns;
CREATE POLICY "inventory_returns_select_policy"
ON public.inventory_returns FOR SELECT
TO authenticated
USING (created_by = auth.uid());

DROP POLICY IF EXISTS "inventory_returns_insert_policy" ON public.inventory_returns;
CREATE POLICY "inventory_returns_insert_policy"
ON public.inventory_returns FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "inventory_returns_update_policy" ON public.inventory_returns;
CREATE POLICY "inventory_returns_update_policy"
ON public.inventory_returns FOR UPDATE
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "inventory_returns_delete_policy" ON public.inventory_returns;
CREATE POLICY "inventory_returns_delete_policy"
ON public.inventory_returns FOR DELETE
TO authenticated
USING (created_by = auth.uid());

-- ============================================
-- 6) AUTO-UPDATE updated_at trigger
-- ============================================

-- Add updated_at column to inventory_returns
ALTER TABLE public.inventory_returns
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DROP TRIGGER IF EXISTS update_inventory_returns_updated_at ON public.inventory_returns;
CREATE TRIGGER update_inventory_returns_updated_at
    BEFORE UPDATE ON public.inventory_returns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- END OF MIGRATION
-- ============================================
