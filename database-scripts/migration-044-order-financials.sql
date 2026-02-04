-- ============================================
-- Migration 044: Order Financials Table
-- Purpose: Stabilize GMV/Sales by separating
--          order-level financials from SKU-level data
-- Date: 2026-02-03
--
-- KEY PRINCIPLE
-- - GMV = SUM(order_amount) WHERE shipped_at IS NOT NULL
-- - 1 row per order_id (order-level truth)
-- ============================================

BEGIN;

-- ============================================
-- 1) CREATE TABLE: order_financials
-- ============================================

CREATE TABLE IF NOT EXISTS public.order_financials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Identification
  source_platform TEXT NOT NULL DEFAULT 'tiktok_shop',
  marketplace TEXT,
  channel TEXT,
  order_id TEXT NOT NULL,
  external_order_id TEXT,

  -- Status
  platform_status TEXT,
  platform_substatus TEXT,
  payment_status TEXT,

  -- Critical timestamps
  shipped_at TIMESTAMPTZ,        -- ✅ GMV recognition
  cancelled_time TIMESTAMPTZ,

  -- Order-level financials
  order_amount NUMERIC(18,2),

  -- Shipping
  shipping_fee_original NUMERIC(18,2),
  shipping_fee_seller_discount NUMERIC(18,2),
  shipping_fee_platform_discount NUMERIC(18,2),
  shipping_fee_after_discount NUMERIC(18,2),

  -- Other fees
  taxes NUMERIC(18,2),
  small_order_fee NUMERIC(18,2),
  payment_platform_discount NUMERIC(18,2),

  -- Metadata
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE SET NULL,

  CONSTRAINT order_financials_unique UNIQUE (created_by, order_id)
);

-- ============================================
-- 2) INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_order_financials_order_id
  ON public.order_financials(order_id);

CREATE INDEX IF NOT EXISTS idx_order_financials_created_by
  ON public.order_financials(created_by);

CREATE INDEX IF NOT EXISTS idx_order_financials_shipped_at
  ON public.order_financials(shipped_at)
  WHERE shipped_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_financials_platform_shipped
  ON public.order_financials(source_platform, shipped_at)
  WHERE shipped_at IS NOT NULL;

-- ============================================
-- 3) UPDATED_AT TRIGGER
-- ============================================

DROP TRIGGER IF EXISTS trg_order_financials_updated_at ON public.order_financials;

CREATE TRIGGER trg_order_financials_updated_at
BEFORE UPDATE ON public.order_financials
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 4) ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE public.order_financials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_financials_select ON public.order_financials;
CREATE POLICY order_financials_select
ON public.order_financials
FOR SELECT
TO authenticated
USING (created_by = auth.uid());

DROP POLICY IF EXISTS order_financials_insert ON public.order_financials;
CREATE POLICY order_financials_insert
ON public.order_financials
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS order_financials_update ON public.order_financials;
CREATE POLICY order_financials_update
ON public.order_financials
FOR UPDATE
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS order_financials_delete ON public.order_financials;
CREATE POLICY order_financials_delete
ON public.order_financials
FOR DELETE
TO authenticated
USING (created_by = auth.uid());

-- Admin override
DROP POLICY IF EXISTS order_financials_admin_all ON public.order_financials;
CREATE POLICY order_financials_admin_all
ON public.order_financials
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
      AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
      AND role = 'admin'
  )
);

-- ============================================
-- 5) BACKFILL FROM sales_orders (LEGACY DATA)
-- ============================================

INSERT INTO public.order_financials (
  created_by,
  source_platform,
  marketplace,
  channel,
  order_id,
  external_order_id,
  platform_status,
  platform_substatus,
  payment_status,
  shipped_at,
  cancelled_time,
  order_amount,
  shipping_fee_original,
  shipping_fee_seller_discount,
  shipping_fee_platform_discount,
  shipping_fee_after_discount,
  taxes,
  small_order_fee,
  payment_platform_discount,
  metadata,
  import_batch_id
)
SELECT DISTINCT ON (s.created_by, s.order_id)
  s.created_by,
  COALESCE(s.source_platform, 'unknown'),
  s.marketplace,
  s.channel,
  s.order_id,
  s.external_order_id,
  s.platform_status,
  s.platform_substatus,
  s.payment_status,

  MAX(s.shipped_at) OVER w,
  MAX(s.cancelled_time) OVER w,

  COALESCE(
    MAX(s.order_amount) OVER w,
    MAX(s.total_amount) OVER w
  ),

  MAX(s.shipping_fee_original) OVER w,
  MAX(s.shipping_fee_seller) OVER w,
  MAX(s.shipping_fee_platform) OVER w,

  (
    MAX(s.shipping_fee_original) OVER w
    - COALESCE(MAX(s.shipping_fee_seller) OVER w, 0)
    - COALESCE(MAX(s.shipping_fee_platform) OVER w, 0)
  ),

  MAX(s.taxes) OVER w,
  MAX(s.small_order_fee) OVER w,
  NULL::numeric,

  jsonb_build_object(
    'backfilled_from', 'sales_orders',
    'amount_source',
      CASE
        WHEN MAX(s.order_amount) OVER w IS NOT NULL
        THEN 'order_amount'
        ELSE 'total_amount_fallback'
      END
  ),

  (
    SELECT s2.import_batch_id
    FROM sales_orders s2
    WHERE s2.created_by = s.created_by
      AND s2.order_id = s.order_id
      AND s2.import_batch_id IS NOT NULL
    LIMIT 1
  )
FROM sales_orders s
WHERE s.order_id IS NOT NULL
  AND s.order_id <> ''
WINDOW w AS (PARTITION BY s.created_by, s.order_id)
ON CONFLICT (created_by, order_id) DO NOTHING;

-- ============================================
-- 6) COMMENTS
-- ============================================

COMMENT ON TABLE public.order_financials IS
'Order-level financials (1 row per order_id).
GMV = SUM(order_amount) WHERE shipped_at IS NOT NULL.
Source of truth for revenue recognition.';

COMMENT ON COLUMN public.order_financials.shipped_at IS
'Revenue recognition timestamp. GMV counts when shipped_at IS NOT NULL.';

COMMENT ON COLUMN public.order_financials.order_amount IS
'Buyer paid amount (TikTok Order Amount). Primary GMV field.';

COMMIT;
