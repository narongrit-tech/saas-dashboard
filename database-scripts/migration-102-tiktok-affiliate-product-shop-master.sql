-- ============================================
-- Migration 102: TikTok Affiliate Product & Shop Master
-- Scope:
--   - tt_product_master: deduplicated product registry from content_order_facts
--   - tt_shop_master: deduplicated shop registry from content_order_facts
--   - both populated via REFRESH function
--   - security: RLS enabled, created_by scoped
-- Notes:
--   - Source of truth is content_order_facts (affiliate import data)
--   - These are derived tables, not authoritative records
--   - Showcase enrichment (images, prices, stock) will be added later via UPDATE
--   - No dependency on showcase scraper for initial population
-- ============================================

BEGIN;

-- ============================================
-- 1) PRODUCT MASTER
-- ============================================

CREATE TABLE IF NOT EXISTS public.tt_product_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  product_id TEXT NOT NULL,
  product_name TEXT,

  -- Shop linkage (one product may appear in one shop in affiliate data)
  shop_code TEXT,
  shop_name TEXT,

  -- First/last seen via affiliate imports
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,

  -- Aggregate stats from facts (updated on refresh)
  total_order_items INTEGER NOT NULL DEFAULT 0,
  settled_order_items INTEGER NOT NULL DEFAULT 0,
  total_gmv NUMERIC(18, 2),
  total_commission NUMERIC(18, 2),
  currency TEXT,

  -- Showcase enrichment (empty until showcase pipeline is built)
  product_image_url TEXT,
  current_price NUMERIC(18, 2),
  current_commission_rate NUMERIC(9, 6),
  stock_status TEXT,
  showcase_last_synced_at TIMESTAMPTZ,

  CONSTRAINT tt_product_master_grain_unique
    UNIQUE (created_by, product_id)
);

CREATE INDEX IF NOT EXISTS idx_tt_product_master_created_by
  ON public.tt_product_master(created_by);

CREATE INDEX IF NOT EXISTS idx_tt_product_master_shop_code
  ON public.tt_product_master(created_by, shop_code);

ALTER TABLE public.tt_product_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tt_product_master_select ON public.tt_product_master;
CREATE POLICY tt_product_master_select ON public.tt_product_master
FOR SELECT TO authenticated USING (created_by = auth.uid());

DROP POLICY IF EXISTS tt_product_master_insert ON public.tt_product_master;
CREATE POLICY tt_product_master_insert ON public.tt_product_master
FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tt_product_master_update ON public.tt_product_master;
CREATE POLICY tt_product_master_update ON public.tt_product_master
FOR UPDATE TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tt_product_master_delete ON public.tt_product_master;
CREATE POLICY tt_product_master_delete ON public.tt_product_master
FOR DELETE TO authenticated USING (created_by = auth.uid());

CREATE TRIGGER trg_tt_product_master_updated_at
BEFORE UPDATE ON public.tt_product_master
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.tt_product_master IS
'Deduplicated product registry derived from content_order_facts affiliate import data. Refreshed via refresh_tt_product_shop_master(). Showcase fields populated separately.';

-- ============================================
-- 2) SHOP MASTER
-- ============================================

CREATE TABLE IF NOT EXISTS public.tt_shop_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  shop_code TEXT NOT NULL,
  shop_name TEXT,

  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,

  -- Aggregate stats
  total_products INTEGER NOT NULL DEFAULT 0,
  total_order_items INTEGER NOT NULL DEFAULT 0,
  settled_order_items INTEGER NOT NULL DEFAULT 0,
  total_gmv NUMERIC(18, 2),
  total_commission NUMERIC(18, 2),
  currency TEXT,

  CONSTRAINT tt_shop_master_grain_unique
    UNIQUE (created_by, shop_code)
);

CREATE INDEX IF NOT EXISTS idx_tt_shop_master_created_by
  ON public.tt_shop_master(created_by);

ALTER TABLE public.tt_shop_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tt_shop_master_select ON public.tt_shop_master;
CREATE POLICY tt_shop_master_select ON public.tt_shop_master
FOR SELECT TO authenticated USING (created_by = auth.uid());

DROP POLICY IF EXISTS tt_shop_master_insert ON public.tt_shop_master;
CREATE POLICY tt_shop_master_insert ON public.tt_shop_master
FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tt_shop_master_update ON public.tt_shop_master;
CREATE POLICY tt_shop_master_update ON public.tt_shop_master
FOR UPDATE TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tt_shop_master_delete ON public.tt_shop_master;
CREATE POLICY tt_shop_master_delete ON public.tt_shop_master
FOR DELETE TO authenticated USING (created_by = auth.uid());

CREATE TRIGGER trg_tt_shop_master_updated_at
BEFORE UPDATE ON public.tt_shop_master
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.tt_shop_master IS
'Deduplicated shop registry derived from content_order_facts affiliate import data.';

-- ============================================
-- 3) REFRESH FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION public.refresh_tt_product_shop_master(p_created_by UUID)
RETURNS TABLE (
  products_upserted INTEGER,
  shops_upserted INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_products_upserted INTEGER := 0;
  v_shops_upserted INTEGER := 0;
BEGIN
  -- ── PRODUCT MASTER ──────────────────────────────────────────────────────

  INSERT INTO public.tt_product_master (
    created_by,
    product_id,
    product_name,
    shop_code,
    shop_name,
    first_seen_at,
    last_seen_at,
    total_order_items,
    settled_order_items,
    total_gmv,
    total_commission,
    currency
  )
  SELECT
    p_created_by,
    f.product_id,
    -- Most recent non-null product_name wins
    (SELECT product_name FROM public.content_order_facts
     WHERE created_by = p_created_by AND product_id = f.product_id
       AND product_name IS NOT NULL
     ORDER BY order_date DESC NULLS LAST LIMIT 1),
    -- Most recent shop_code
    (SELECT shop_code FROM public.content_order_facts
     WHERE created_by = p_created_by AND product_id = f.product_id
       AND shop_code IS NOT NULL
     ORDER BY order_date DESC NULLS LAST LIMIT 1),
    -- Most recent shop_name
    (SELECT shop_name FROM public.content_order_facts
     WHERE created_by = p_created_by AND product_id = f.product_id
       AND shop_name IS NOT NULL
     ORDER BY order_date DESC NULLS LAST LIMIT 1),
    MIN(f.order_date),
    MAX(f.order_date),
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE f.is_successful)::INTEGER,
    SUM(f.gmv),
    SUM(f.total_earned_amount),
    MAX(f.currency)
  FROM public.content_order_facts f
  WHERE f.created_by = p_created_by
    AND f.product_id IS NOT NULL
    AND f.product_id NOT IN ('PROD-001')  -- exclude test rows
  GROUP BY f.product_id
  ON CONFLICT (created_by, product_id)
  DO UPDATE SET
    product_name = COALESCE(EXCLUDED.product_name, tt_product_master.product_name),
    shop_code = COALESCE(EXCLUDED.shop_code, tt_product_master.shop_code),
    shop_name = COALESCE(EXCLUDED.shop_name, tt_product_master.shop_name),
    first_seen_at = LEAST(EXCLUDED.first_seen_at, tt_product_master.first_seen_at),
    last_seen_at = GREATEST(EXCLUDED.last_seen_at, tt_product_master.last_seen_at),
    total_order_items = EXCLUDED.total_order_items,
    settled_order_items = EXCLUDED.settled_order_items,
    total_gmv = EXCLUDED.total_gmv,
    total_commission = EXCLUDED.total_commission,
    currency = COALESCE(EXCLUDED.currency, tt_product_master.currency),
    updated_at = NOW();

  GET DIAGNOSTICS v_products_upserted = ROW_COUNT;

  -- ── SHOP MASTER ──────────────────────────────────────────────────────────

  INSERT INTO public.tt_shop_master (
    created_by,
    shop_code,
    shop_name,
    first_seen_at,
    last_seen_at,
    total_products,
    total_order_items,
    settled_order_items,
    total_gmv,
    total_commission,
    currency
  )
  SELECT
    p_created_by,
    f.shop_code,
    MAX(f.shop_name),
    MIN(f.order_date),
    MAX(f.order_date),
    COUNT(DISTINCT f.product_id)::INTEGER,
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE f.is_successful)::INTEGER,
    SUM(f.gmv),
    SUM(f.total_earned_amount),
    MAX(f.currency)
  FROM public.content_order_facts f
  WHERE f.created_by = p_created_by
    AND f.shop_code IS NOT NULL
    AND f.shop_code NOT IN ('SHOP-001')  -- exclude test rows
  GROUP BY f.shop_code
  ON CONFLICT (created_by, shop_code)
  DO UPDATE SET
    shop_name = COALESCE(EXCLUDED.shop_name, tt_shop_master.shop_name),
    first_seen_at = LEAST(EXCLUDED.first_seen_at, tt_shop_master.first_seen_at),
    last_seen_at = GREATEST(EXCLUDED.last_seen_at, tt_shop_master.last_seen_at),
    total_products = EXCLUDED.total_products,
    total_order_items = EXCLUDED.total_order_items,
    settled_order_items = EXCLUDED.settled_order_items,
    total_gmv = EXCLUDED.total_gmv,
    total_commission = EXCLUDED.total_commission,
    currency = COALESCE(EXCLUDED.currency, tt_shop_master.currency),
    updated_at = NOW();

  GET DIAGNOSTICS v_shops_upserted = ROW_COUNT;

  RETURN QUERY SELECT v_products_upserted, v_shops_upserted;
END;
$$;

COMMENT ON FUNCTION public.refresh_tt_product_shop_master(UUID) IS
'Rebuilds tt_product_master and tt_shop_master from content_order_facts for a given user. Safe to call multiple times (idempotent upsert).';

COMMIT;
