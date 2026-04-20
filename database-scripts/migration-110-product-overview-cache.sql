-- ============================================================
-- Migration 110: product_overview_cache
-- Pre-aggregated all-time stats per product.
-- Bypasses PostgREST 1000-row default cap for products with many orders.
-- Rebuilt by master-refresh.ts; read by getProductDetail with graceful fallback.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.product_overview_cache (
  created_by        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id        TEXT        NOT NULL,
  total_order_items INTEGER     NOT NULL DEFAULT 0,
  total_gmv         NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_commission  NUMERIC(14,2) NOT NULL DEFAULT 0,
  cancel_count      INTEGER     NOT NULL DEFAULT 0,
  cancel_rate       NUMERIC(5,2) NOT NULL DEFAULT 0,
  settled_count     INTEGER     NOT NULL DEFAULT 0,
  settled_percent   NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- [{ contentId: string, orders: number, gmv: number }] top 20 sorted by orders desc
  top_content_json  JSONB,
  -- [{ shopCode: string, shopName: string|null, orders: number, gmv: number }] top 10
  top_shops_json    JSONB,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (created_by, product_id)
);

CREATE INDEX IF NOT EXISTS idx_poc_created_by_updated
  ON public.product_overview_cache (created_by, updated_at DESC);

ALTER TABLE public.product_overview_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS poc_all ON public.product_overview_cache;
CREATE POLICY poc_all ON public.product_overview_cache
  FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

COMMIT;
