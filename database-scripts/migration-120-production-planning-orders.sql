-- migration-120: Production Planning — Production Orders
-- ──────────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   Track every procurement/production action: calling FG from factory,
--   starting a production run, ordering empty tubes, ordering essential oil.
--
-- ORDER TYPES
--   call_fg     Call finished goods from factory to our warehouse (lead: 1 day)
--   production  Start a production run (lead: 20-30 days, min 5,000/formula)
--   tubes       Order empty tubes (lead: 45 days, min 10,000/formula)
--   oil         Order essential oil in kg (lead: 45 days, min 10 kg)
--
-- VARIANCE HANDLING (±5% from factory)
--   ordered_qty  = what we requested
--   received_qty = what actually arrived (may differ by ±5%)
--   Payment is always based on received_qty, not ordered_qty.
--   For planning, the system uses 95% of ordered_qty as expected FG.
-- ──────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.prod_order_type AS ENUM (
    'call_fg',
    'production',
    'tubes',
    'oil'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.prod_order_status AS ENUM (
    'pending',
    'received',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.prod_production_orders (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_type    public.prod_order_type  NOT NULL,
  formula_id    UUID        REFERENCES public.prod_formula_config(id) ON DELETE RESTRICT,
  ordered_qty   DECIMAL(12,2) NOT NULL CHECK (ordered_qty > 0),
  ordered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expected_at   TIMESTAMPTZ,               -- ordered_at + lead time (calculated on insert)
  received_qty  DECIMAL(12,2) CHECK (received_qty >= 0), -- actual received
  received_at   TIMESTAMPTZ,
  status        public.prod_order_status NOT NULL DEFAULT 'pending',
  notes         TEXT,
  created_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prod_orders_status
  ON public.prod_production_orders (status) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_prod_orders_formula_type
  ON public.prod_production_orders (formula_id, order_type, ordered_at DESC);

-- RLS
ALTER TABLE public.prod_production_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prod_orders_select"
  ON public.prod_production_orders FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "prod_orders_insert"
  ON public.prod_production_orders FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "prod_orders_update"
  ON public.prod_production_orders FOR UPDATE
  USING (auth.role() = 'authenticated');

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER prod_orders_updated_at
  BEFORE UPDATE ON public.prod_production_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
