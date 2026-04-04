-- ============================================
-- Migration 097: TikTok Affiliate Content Profit Layer
-- Scope:
--   - module-local profit layer on top of public.content_order_attribution
--   - module-local cost input table
--   - module-local cost allocation bridge
--   - module-local final profit attribution summary table
--   - helper refresh functions for the Phase 3 pipeline
-- Notes:
--   - isolated from existing SaaS sales / finance / wallet / reconciliation tables
--   - no UI objects in this migration
--   - attribution input comes from migration-096 public.content_order_attribution
-- ============================================

BEGIN;

-- ============================================
-- 1) COST INPUTS
-- Grain:
--   1 row per module-local cost input
-- Notes:
--   - profit refreshes read final attribution winners from public.content_order_attribution
--   - product_id is optional for direct exact-scope costs
-- ============================================

CREATE TABLE IF NOT EXISTS public.tt_content_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  content_id TEXT NOT NULL,
  product_id TEXT,
  cost_type TEXT NOT NULL CHECK (
    cost_type IN ('ads', 'creator', 'misc')
  ),
  amount NUMERIC(18, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL CHECK (
    BTRIM(currency) <> ''
    AND currency = UPPER(BTRIM(currency))
  ),
  cost_date DATE NOT NULL,
  notes TEXT,

  CONSTRAINT tt_content_costs_direct_scope_requires_content
    CHECK (BTRIM(content_id) <> '')
);

CREATE INDEX IF NOT EXISTS idx_tt_content_costs_scope_date
  ON public.tt_content_costs(created_by, content_id, cost_date DESC, cost_type);

CREATE INDEX IF NOT EXISTS idx_tt_content_costs_product_date
  ON public.tt_content_costs(created_by, product_id, cost_date DESC)
  WHERE product_id IS NOT NULL;

ALTER TABLE public.tt_content_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tt_content_costs_select ON public.tt_content_costs;
CREATE POLICY tt_content_costs_select
ON public.tt_content_costs
FOR SELECT
TO authenticated
USING (created_by = auth.uid());

DROP POLICY IF EXISTS tt_content_costs_insert ON public.tt_content_costs;
CREATE POLICY tt_content_costs_insert
ON public.tt_content_costs
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tt_content_costs_update ON public.tt_content_costs;
CREATE POLICY tt_content_costs_update
ON public.tt_content_costs
FOR UPDATE
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tt_content_costs_delete ON public.tt_content_costs;
CREATE POLICY tt_content_costs_delete
ON public.tt_content_costs
FOR DELETE
TO authenticated
USING (created_by = auth.uid());

DROP TRIGGER IF EXISTS trg_tt_content_costs_updated_at ON public.tt_content_costs;
CREATE TRIGGER trg_tt_content_costs_updated_at
BEFORE UPDATE ON public.tt_content_costs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.tt_content_costs IS
'Module-local Phase 3 cost inputs for the Content Ops profit layer. These costs remain isolated from SaaS finance, wallet, and reconciliation modules.';

COMMENT ON COLUMN public.tt_content_costs.product_id IS
'Optional direct exact-scope product key. When null, the cost is allocated across child product rows under the same content_id, cost_date, and currency.';

COMMENT ON COLUMN public.tt_content_costs.currency IS
'Required currency dimension for cost safety. Costs are never spread across different currencies.';

-- ============================================
-- 2) COST ALLOCATIONS
-- Grain:
--   1 row per allocated or explicitly unallocated child cost slice
-- Notes:
--   - direct product-scoped costs stay 100% direct
--   - content-only costs allocate by actual_commission_total share
--   - GMV is the only fallback denominator
--   - any remainder is preserved explicitly, not hidden
-- ============================================

CREATE TABLE IF NOT EXISTS public.tt_content_cost_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cost_id UUID NOT NULL REFERENCES public.tt_content_costs(id) ON DELETE CASCADE,

  content_id TEXT NOT NULL,
  product_id TEXT,
  cost_type TEXT NOT NULL CHECK (
    cost_type IN ('ads', 'creator', 'misc')
  ),
  currency TEXT NOT NULL CHECK (
    BTRIM(currency) <> ''
    AND currency = UPPER(BTRIM(currency))
  ),
  cost_date DATE NOT NULL,

  allocation_status TEXT NOT NULL CHECK (
    allocation_status IN ('allocated', 'unallocated')
  ),
  allocation_method TEXT NOT NULL CHECK (
    allocation_method IN (
      'direct',
      'actual_commission_share',
      'gmv_share',
      'unallocated_no_basis',
      'rounding_remainder'
    )
  ),

  allocation_share NUMERIC(18, 10) NOT NULL DEFAULT 0 CHECK (allocation_share >= 0),
  basis_amount NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (basis_amount >= 0),
  basis_total_amount NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (basis_total_amount >= 0),
  allocated_amount NUMERIC(18, 2) NOT NULL CHECK (allocated_amount >= 0),

  CONSTRAINT tt_content_cost_allocations_shape_check
    CHECK (
      (
        allocation_status = 'allocated'
        AND product_id IS NOT NULL
        AND allocation_method IN ('direct', 'actual_commission_share', 'gmv_share')
      )
      OR
      (
        allocation_status = 'unallocated'
        AND product_id IS NULL
        AND allocation_method IN ('unallocated_no_basis', 'rounding_remainder')
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_tt_content_cost_allocations_cost
  ON public.tt_content_cost_allocations(created_by, cost_id, cost_date DESC);

CREATE INDEX IF NOT EXISTS idx_tt_content_cost_allocations_scope
  ON public.tt_content_cost_allocations(created_by, content_id, product_id, currency, cost_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tt_content_cost_allocations_allocated
  ON public.tt_content_cost_allocations(cost_id, product_id, currency)
  WHERE allocation_status = 'allocated' AND product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tt_content_cost_allocations_unallocated
  ON public.tt_content_cost_allocations(cost_id, currency, allocation_method)
  WHERE allocation_status = 'unallocated' AND product_id IS NULL;

ALTER TABLE public.tt_content_cost_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tt_content_cost_allocations_select ON public.tt_content_cost_allocations;
CREATE POLICY tt_content_cost_allocations_select
ON public.tt_content_cost_allocations
FOR SELECT
TO authenticated
USING (created_by = auth.uid());

DROP TRIGGER IF EXISTS trg_tt_content_cost_allocations_updated_at ON public.tt_content_cost_allocations;
CREATE TRIGGER trg_tt_content_cost_allocations_updated_at
BEFORE UPDATE ON public.tt_content_cost_allocations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.tt_content_cost_allocations IS
'Derived Phase 3 cost allocations for the Content Ops profit layer. Keeps original cost rows linked through cost_id and preserves unallocated remainders explicitly.';

COMMENT ON COLUMN public.tt_content_cost_allocations.allocation_method IS
'Allocation engine method. actual_commission_share is used first, GMV share is the only fallback, and missing-basis or rounding residuals are preserved as unallocated rows.';

-- ============================================
-- 3) FINAL PROFIT SUMMARY
-- Grain:
--   1 row per created_by + content_id + product_id + currency
-- Notes:
--   - money metrics stay currency-safe
--   - total_orders can exceed successful + open + lost when source rows remain unknown
--   - profit uses realized commission only
-- ============================================

CREATE TABLE IF NOT EXISTS public.content_profit_attribution_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  content_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (
    BTRIM(currency) <> ''
    AND currency = UPPER(BTRIM(currency))
  ),

  total_orders BIGINT NOT NULL DEFAULT 0 CHECK (total_orders >= 0),
  successful_orders BIGINT NOT NULL DEFAULT 0 CHECK (successful_orders >= 0),
  open_orders BIGINT NOT NULL DEFAULT 0 CHECK (open_orders >= 0),
  lost_orders BIGINT NOT NULL DEFAULT 0 CHECK (lost_orders >= 0),

  gmv_realized NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (gmv_realized >= 0),
  gmv_open NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (gmv_open >= 0),
  gmv_lost NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (gmv_lost >= 0),

  commission_realized NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (commission_realized >= 0),
  commission_open NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (commission_open >= 0),
  commission_lost NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (commission_lost >= 0),

  ads_cost NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (ads_cost >= 0),
  creator_cost NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (creator_cost >= 0),
  other_cost NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (other_cost >= 0),
  total_cost NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  profit NUMERIC(18, 2) NOT NULL DEFAULT 0,
  roi NUMERIC(18, 6),

  CONSTRAINT content_profit_attribution_summary_grain_unique
    UNIQUE (created_by, content_id, product_id, currency),

  CONSTRAINT content_profit_attribution_summary_order_check
    CHECK (successful_orders + open_orders + lost_orders <= total_orders),

  CONSTRAINT content_profit_attribution_summary_cost_check
    CHECK (total_cost = ads_cost + creator_cost + other_cost),

  CONSTRAINT content_profit_attribution_summary_roi_check
    CHECK (roi IS NULL OR total_cost > 0)
);

CREATE INDEX IF NOT EXISTS idx_content_profit_attribution_summary_content
  ON public.content_profit_attribution_summary(created_by, content_id, currency);

CREATE INDEX IF NOT EXISTS idx_content_profit_attribution_summary_product
  ON public.content_profit_attribution_summary(created_by, product_id, currency);

CREATE INDEX IF NOT EXISTS idx_content_profit_attribution_summary_profit
  ON public.content_profit_attribution_summary(created_by, profit DESC, commission_realized DESC);

ALTER TABLE public.content_profit_attribution_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_profit_attribution_summary_select ON public.content_profit_attribution_summary;
CREATE POLICY content_profit_attribution_summary_select
ON public.content_profit_attribution_summary
FOR SELECT
TO authenticated
USING (created_by = auth.uid());

DROP TRIGGER IF EXISTS trg_content_profit_attribution_summary_updated_at ON public.content_profit_attribution_summary;
CREATE TRIGGER trg_content_profit_attribution_summary_updated_at
BEFORE UPDATE ON public.content_profit_attribution_summary
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.content_profit_attribution_summary IS
'Final module-local Phase 3 profit attribution summary for Content Ops. Grain: created_by + content_id + product_id + currency.';

COMMENT ON COLUMN public.content_profit_attribution_summary.profit IS
'Realized commission minus allocated ads_cost, creator_cost, and other_cost. Open and lost commission stay visible separately and are not folded into profit.';

COMMENT ON COLUMN public.content_profit_attribution_summary.roi IS
'Profit divided by total_cost. Null when total_cost is zero.';

-- ============================================
-- 4) REFRESH FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION public.refresh_tt_content_cost_allocations(p_created_by UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope_created_by UUID;
  v_row_count INTEGER;
BEGIN
  v_scope_created_by := COALESCE(p_created_by, auth.uid());

  IF p_created_by IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM p_created_by THEN
    RAISE EXCEPTION 'Access denied for created_by: %', p_created_by;
  END IF;

  CREATE TEMP TABLE tmp_content_cost_basis ON COMMIT DROP AS
  SELECT
    coa.created_by,
    coa.content_id,
    coa.product_id,
    coa.currency,
    DATE(coa.order_date AT TIME ZONE 'Asia/Bangkok') AS business_date,
    ROUND(COALESCE(SUM(coa.actual_commission_total), 0), 2) AS actual_commission_total,
    ROUND(COALESCE(SUM(coa.gmv), 0), 2) AS gmv_total
  FROM public.content_order_attribution coa
  WHERE (v_scope_created_by IS NULL OR coa.created_by = v_scope_created_by)
    AND coa.order_date IS NOT NULL
  GROUP BY
    coa.created_by,
    coa.content_id,
    coa.product_id,
    coa.currency,
    DATE(coa.order_date AT TIME ZONE 'Asia/Bangkok');

  CREATE TEMP TABLE tmp_tt_content_cost_allocation_source ON COMMIT DROP AS
  WITH relevant_costs AS (
    SELECT
      c.created_by,
      c.id AS cost_id,
      c.content_id,
      c.product_id,
      c.cost_type,
      c.amount,
      c.currency,
      c.cost_date
    FROM public.tt_content_costs c
    WHERE v_scope_created_by IS NULL OR c.created_by = v_scope_created_by
  ),
  direct_rows AS (
    SELECT
      c.created_by,
      c.cost_id,
      c.content_id,
      c.product_id,
      c.cost_type,
      c.currency,
      c.cost_date,
      'allocated'::TEXT AS allocation_status,
      'direct'::TEXT AS allocation_method,
      1::NUMERIC(18, 10) AS allocation_share,
      c.amount::NUMERIC(18, 2) AS basis_amount,
      c.amount::NUMERIC(18, 2) AS basis_total_amount,
      c.amount::NUMERIC(18, 2) AS allocated_amount
    FROM relevant_costs c
    WHERE c.product_id IS NOT NULL
  ),
  content_only_ranked AS (
    SELECT
      c.created_by,
      c.cost_id,
      c.content_id,
      b.product_id,
      c.cost_type,
      c.currency,
      c.cost_date,
      c.amount,
      b.actual_commission_total,
      b.gmv_total,
      SUM(b.actual_commission_total) OVER (PARTITION BY c.cost_id) AS basis_total_commission,
      SUM(b.gmv_total) OVER (PARTITION BY c.cost_id) AS basis_total_gmv
    FROM relevant_costs c
    JOIN tmp_content_cost_basis b
      ON b.created_by = c.created_by
     AND b.content_id = c.content_id
     AND b.currency = c.currency
     AND b.business_date = c.cost_date
    WHERE c.product_id IS NULL
  ),
  content_only_allocated AS (
    SELECT
      r.created_by,
      r.cost_id,
      r.content_id,
      r.product_id,
      r.cost_type,
      r.currency,
      r.cost_date,
      'allocated'::TEXT AS allocation_status,
      CASE
        WHEN r.basis_total_commission > 0 THEN 'actual_commission_share'
        WHEN r.basis_total_gmv > 0 THEN 'gmv_share'
      END AS allocation_method,
      CASE
        WHEN r.basis_total_commission > 0 THEN ROUND(r.actual_commission_total / r.basis_total_commission, 10)
        WHEN r.basis_total_gmv > 0 THEN ROUND(r.gmv_total / r.basis_total_gmv, 10)
        ELSE 0::NUMERIC(18, 10)
      END AS allocation_share,
      CASE
        WHEN r.basis_total_commission > 0 THEN r.actual_commission_total
        WHEN r.basis_total_gmv > 0 THEN r.gmv_total
        ELSE 0::NUMERIC(18, 2)
      END AS basis_amount,
      CASE
        WHEN r.basis_total_commission > 0 THEN r.basis_total_commission
        WHEN r.basis_total_gmv > 0 THEN r.basis_total_gmv
        ELSE 0::NUMERIC(18, 2)
      END AS basis_total_amount,
      ROUND(
        r.amount
        * CASE
            WHEN r.basis_total_commission > 0 THEN r.actual_commission_total / r.basis_total_commission
            WHEN r.basis_total_gmv > 0 THEN r.gmv_total / r.basis_total_gmv
            ELSE 0
          END,
        2
      ) AS allocated_amount
    FROM content_only_ranked r
    WHERE r.basis_total_commission > 0 OR r.basis_total_gmv > 0
  ),
  rounding_remainders AS (
    SELECT
      a.created_by,
      a.cost_id,
      a.content_id,
      NULL::TEXT AS product_id,
      a.cost_type,
      a.currency,
      a.cost_date,
      'unallocated'::TEXT AS allocation_status,
      'rounding_remainder'::TEXT AS allocation_method,
      0::NUMERIC(18, 10) AS allocation_share,
      0::NUMERIC(18, 2) AS basis_amount,
      MAX(a.basis_total_amount)::NUMERIC(18, 2) AS basis_total_amount,
      ROUND(MAX(c.amount) - SUM(a.allocated_amount), 2) AS allocated_amount
    FROM content_only_allocated a
    JOIN public.tt_content_costs c
      ON c.id = a.cost_id
    GROUP BY
      a.created_by,
      a.cost_id,
      a.content_id,
      a.cost_type,
      a.currency,
      a.cost_date
    HAVING ROUND(MAX(c.amount) - SUM(a.allocated_amount), 2) > 0
  ),
  no_basis_rows AS (
    SELECT
      c.created_by,
      c.cost_id,
      c.content_id,
      NULL::TEXT AS product_id,
      c.cost_type,
      c.currency,
      c.cost_date,
      'unallocated'::TEXT AS allocation_status,
      'unallocated_no_basis'::TEXT AS allocation_method,
      0::NUMERIC(18, 10) AS allocation_share,
      0::NUMERIC(18, 2) AS basis_amount,
      0::NUMERIC(18, 2) AS basis_total_amount,
      c.amount::NUMERIC(18, 2) AS allocated_amount
    FROM relevant_costs c
    WHERE c.product_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM tmp_content_cost_basis b
        WHERE b.created_by = c.created_by
          AND b.content_id = c.content_id
          AND b.currency = c.currency
          AND b.business_date = c.cost_date
      )
  ),
  zero_denom_rows AS (
    SELECT
      r.created_by,
      r.cost_id,
      r.content_id,
      NULL::TEXT AS product_id,
      MAX(r.cost_type) AS cost_type,
      MAX(r.currency) AS currency,
      MAX(r.cost_date) AS cost_date,
      'unallocated'::TEXT AS allocation_status,
      'unallocated_no_basis'::TEXT AS allocation_method,
      0::NUMERIC(18, 10) AS allocation_share,
      0::NUMERIC(18, 2) AS basis_amount,
      0::NUMERIC(18, 2) AS basis_total_amount,
      MAX(r.amount)::NUMERIC(18, 2) AS allocated_amount
    FROM content_only_ranked r
    GROUP BY r.created_by, r.cost_id, r.content_id
    HAVING MAX(r.basis_total_commission) = 0
       AND MAX(r.basis_total_gmv) = 0
  )
  SELECT * FROM direct_rows
  UNION ALL
  SELECT * FROM content_only_allocated
  UNION ALL
  SELECT * FROM rounding_remainders
  UNION ALL
  SELECT * FROM no_basis_rows
  UNION ALL
  SELECT * FROM zero_denom_rows;

  DELETE FROM public.tt_content_cost_allocations tcca
  WHERE v_scope_created_by IS NULL OR tcca.created_by = v_scope_created_by;

  INSERT INTO public.tt_content_cost_allocations (
    created_by,
    cost_id,
    content_id,
    product_id,
    cost_type,
    currency,
    cost_date,
    allocation_status,
    allocation_method,
    allocation_share,
    basis_amount,
    basis_total_amount,
    allocated_amount
  )
  SELECT
    s.created_by,
    s.cost_id,
    s.content_id,
    s.product_id,
    s.cost_type,
    s.currency,
    s.cost_date,
    s.allocation_status,
    s.allocation_method,
    s.allocation_share,
    s.basis_amount,
    s.basis_total_amount,
    s.allocated_amount
  FROM tmp_tt_content_cost_allocation_source s;

  SELECT COUNT(*)
  INTO v_row_count
  FROM public.tt_content_cost_allocations tcca
  WHERE v_scope_created_by IS NULL OR tcca.created_by = v_scope_created_by;

  RETURN v_row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_content_profit_attribution_summary(p_created_by UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope_created_by UUID;
  v_row_count INTEGER;
BEGIN
  v_scope_created_by := COALESCE(p_created_by, auth.uid());

  IF p_created_by IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM p_created_by THEN
    RAISE EXCEPTION 'Access denied for created_by: %', p_created_by;
  END IF;

  DELETE FROM public.content_profit_attribution_summary cpas
  WHERE v_scope_created_by IS NULL OR cpas.created_by = v_scope_created_by;

  INSERT INTO public.content_profit_attribution_summary (
    created_by,
    content_id,
    product_id,
    currency,
    total_orders,
    successful_orders,
    open_orders,
    lost_orders,
    gmv_realized,
    gmv_open,
    gmv_lost,
    commission_realized,
    commission_open,
    commission_lost,
    ads_cost,
    creator_cost,
    other_cost,
    total_cost,
    profit,
    roi
  )
  WITH order_summary AS (
    SELECT
      coa.created_by,
      coa.content_id,
      coa.product_id,
      coa.currency,
      COUNT(*)::BIGINT AS total_orders,
      COUNT(*) FILTER (WHERE coa.is_realized)::BIGINT AS successful_orders,
      COUNT(*) FILTER (WHERE coa.is_open)::BIGINT AS open_orders,
      COUNT(*) FILTER (WHERE coa.is_lost)::BIGINT AS lost_orders,
      ROUND(COALESCE(SUM(CASE WHEN coa.is_realized THEN coa.gmv ELSE 0 END), 0), 2) AS gmv_realized,
      ROUND(COALESCE(SUM(CASE WHEN coa.is_open THEN coa.gmv ELSE 0 END), 0), 2) AS gmv_open,
      ROUND(COALESCE(SUM(CASE WHEN coa.is_lost THEN coa.gmv ELSE 0 END), 0), 2) AS gmv_lost,
      ROUND(COALESCE(SUM(CASE WHEN coa.is_realized THEN coa.actual_commission_total ELSE 0 END), 0), 2) AS commission_realized,
      ROUND(COALESCE(SUM(CASE WHEN coa.is_open THEN coa.actual_commission_total ELSE 0 END), 0), 2) AS commission_open,
      ROUND(COALESCE(SUM(CASE WHEN coa.is_lost THEN coa.actual_commission_total ELSE 0 END), 0), 2) AS commission_lost
    FROM public.content_order_attribution coa
    WHERE v_scope_created_by IS NULL OR coa.created_by = v_scope_created_by
    GROUP BY coa.created_by, coa.content_id, coa.product_id, coa.currency
  ),
  cost_summary AS (
    SELECT
      tcca.created_by,
      tcca.content_id,
      tcca.product_id,
      tcca.currency,
      ROUND(COALESCE(SUM(CASE WHEN tcca.cost_type = 'ads' AND tcca.allocation_status = 'allocated' THEN tcca.allocated_amount ELSE 0 END), 0), 2) AS ads_cost,
      ROUND(COALESCE(SUM(CASE WHEN tcca.cost_type = 'creator' AND tcca.allocation_status = 'allocated' THEN tcca.allocated_amount ELSE 0 END), 0), 2) AS creator_cost,
      ROUND(COALESCE(SUM(CASE WHEN tcca.cost_type = 'misc' AND tcca.allocation_status = 'allocated' THEN tcca.allocated_amount ELSE 0 END), 0), 2) AS other_cost
    FROM public.tt_content_cost_allocations tcca
    WHERE (v_scope_created_by IS NULL OR tcca.created_by = v_scope_created_by)
      AND tcca.allocation_status = 'allocated'
      AND tcca.product_id IS NOT NULL
    GROUP BY tcca.created_by, tcca.content_id, tcca.product_id, tcca.currency
  ),
  summary_keys AS (
    SELECT
      os.created_by,
      os.content_id,
      os.product_id,
      os.currency
    FROM order_summary os
    UNION
    SELECT
      cs.created_by,
      cs.content_id,
      cs.product_id,
      cs.currency
    FROM cost_summary cs
  )
  SELECT
    k.created_by,
    k.content_id,
    k.product_id,
    k.currency,
    COALESCE(os.total_orders, 0) AS total_orders,
    COALESCE(os.successful_orders, 0) AS successful_orders,
    COALESCE(os.open_orders, 0) AS open_orders,
    COALESCE(os.lost_orders, 0) AS lost_orders,
    COALESCE(os.gmv_realized, 0) AS gmv_realized,
    COALESCE(os.gmv_open, 0) AS gmv_open,
    COALESCE(os.gmv_lost, 0) AS gmv_lost,
    COALESCE(os.commission_realized, 0) AS commission_realized,
    COALESCE(os.commission_open, 0) AS commission_open,
    COALESCE(os.commission_lost, 0) AS commission_lost,
    COALESCE(cs.ads_cost, 0) AS ads_cost,
    COALESCE(cs.creator_cost, 0) AS creator_cost,
    COALESCE(cs.other_cost, 0) AS other_cost,
    ROUND(COALESCE(cs.ads_cost, 0) + COALESCE(cs.creator_cost, 0) + COALESCE(cs.other_cost, 0), 2) AS total_cost,
    ROUND(
      COALESCE(os.commission_realized, 0)
      - (
        COALESCE(cs.ads_cost, 0)
        + COALESCE(cs.creator_cost, 0)
        + COALESCE(cs.other_cost, 0)
      ),
      2
    ) AS profit,
    ROUND(
      (
        COALESCE(os.commission_realized, 0)
        - (
          COALESCE(cs.ads_cost, 0)
          + COALESCE(cs.creator_cost, 0)
          + COALESCE(cs.other_cost, 0)
        )
      ) / NULLIF(
        COALESCE(cs.ads_cost, 0)
        + COALESCE(cs.creator_cost, 0)
        + COALESCE(cs.other_cost, 0),
        0
      ),
      6
    ) AS roi
  FROM summary_keys k
  LEFT JOIN order_summary os
    ON os.created_by = k.created_by
   AND os.content_id = k.content_id
   AND os.product_id = k.product_id
   AND os.currency = k.currency
  LEFT JOIN cost_summary cs
    ON cs.created_by = k.created_by
   AND cs.content_id = k.content_id
   AND cs.product_id = k.product_id
   AND cs.currency = k.currency;

  SELECT COUNT(*)
  INTO v_row_count
  FROM public.content_profit_attribution_summary cpas
  WHERE v_scope_created_by IS NULL OR cpas.created_by = v_scope_created_by;

  RETURN v_row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_content_profit_layer(p_created_by UUID DEFAULT NULL)
RETURNS TABLE (
  attribution_row_count INTEGER,
  cost_allocation_row_count INTEGER,
  summary_row_count INTEGER,
  unallocated_cost_row_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope_created_by UUID;
  v_attribution_row_count INTEGER;
  v_cost_allocation_row_count INTEGER;
  v_summary_row_count INTEGER;
  v_unallocated_cost_row_count INTEGER;
BEGIN
  v_scope_created_by := COALESCE(p_created_by, auth.uid());

  SELECT COUNT(*)::INTEGER
  INTO v_attribution_row_count
  FROM public.content_order_attribution coa
  WHERE v_scope_created_by IS NULL OR coa.created_by = v_scope_created_by;

  v_cost_allocation_row_count := public.refresh_tt_content_cost_allocations(p_created_by);
  v_summary_row_count := public.refresh_content_profit_attribution_summary(p_created_by);

  SELECT COUNT(*)::INTEGER
  INTO v_unallocated_cost_row_count
  FROM public.tt_content_cost_allocations tcca
  WHERE (v_scope_created_by IS NULL OR tcca.created_by = v_scope_created_by)
    AND tcca.allocation_status = 'unallocated';

  RETURN QUERY
  SELECT
    v_attribution_row_count,
    v_cost_allocation_row_count,
    v_summary_row_count,
    v_unallocated_cost_row_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_tt_content_cost_allocations(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_tt_content_cost_allocations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_tt_content_cost_allocations(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.refresh_content_profit_attribution_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_content_profit_attribution_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_content_profit_attribution_summary(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.refresh_content_profit_layer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_content_profit_layer(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_content_profit_layer(UUID) TO service_role;

COMMIT;
