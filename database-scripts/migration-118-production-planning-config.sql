-- migration-118: Production Planning — Formula Config
-- ──────────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   Define per-formula lead times, minimum order quantities, and alert thresholds
--   for the production planning module (FG, empty tubes, essential oil).
--
-- FORMULAS SEEDED
--   NEWONN001  Fresh Up   uses_oil=true   oil_per_1000_tubes_kg=0.53
--   NEWONN002  Wind Down  uses_oil=false
--
-- LEAD TIMES (days, configurable per formula)
--   fg_factory → warehouse: 1 day
--   production (tubes → FG): 20-30 days  min 5,000 / formula
--   tubes ordering:          45 days     min 10,000 / formula
--   essential oil ordering:  45 days     min 10 kg
--
-- ALERT THRESHOLDS (days of supply remaining before alert fires)
--   alert_fg_days         = 7   → call FG from factory
--   alert_production_days = 40  → plan production run
--   alert_tubes_days      = 55  → order empty tubes
--   alert_oil_days        = 55  → order essential oil
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.prod_formula_config (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku_internal                TEXT NOT NULL REFERENCES public.inventory_items(sku_internal) ON UPDATE CASCADE,
  formula_name                TEXT NOT NULL,
  uses_oil                    BOOLEAN NOT NULL DEFAULT false,
  oil_per_1000_tubes_kg       DECIMAL(8,4) NOT NULL DEFAULT 0.53,

  -- Lead times (calendar days)
  lead_time_fg_days           INT NOT NULL DEFAULT 1,
  lead_time_production_min_days INT NOT NULL DEFAULT 20,
  lead_time_production_max_days INT NOT NULL DEFAULT 30,
  lead_time_tubes_days        INT NOT NULL DEFAULT 45,
  lead_time_oil_days          INT NOT NULL DEFAULT 45,

  -- Minimum order quantities
  min_production_qty          INT NOT NULL DEFAULT 5000,
  min_tubes_qty               INT NOT NULL DEFAULT 10000,
  min_oil_kg                  DECIMAL(8,2) NOT NULL DEFAULT 10,

  -- Days-of-supply thresholds that trigger alerts
  alert_fg_days               INT NOT NULL DEFAULT 7,
  alert_production_days       INT NOT NULL DEFAULT 40,
  alert_tubes_days            INT NOT NULL DEFAULT 55,
  alert_oil_days              INT NOT NULL DEFAULT 55,

  active                      BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT prod_formula_config_sku_unique UNIQUE (sku_internal)
);

-- RLS
ALTER TABLE public.prod_formula_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prod_formula_config_select"
  ON public.prod_formula_config FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "prod_formula_config_insert"
  ON public.prod_formula_config FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "prod_formula_config_update"
  ON public.prod_formula_config FOR UPDATE
  USING (auth.role() = 'authenticated');

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER prod_formula_config_updated_at
  BEFORE UPDATE ON public.prod_formula_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Seed data ────────────────────────────────────────────────────────────────
INSERT INTO public.prod_formula_config (
  sku_internal, formula_name, uses_oil, oil_per_1000_tubes_kg,
  lead_time_fg_days, lead_time_production_min_days, lead_time_production_max_days,
  lead_time_tubes_days, lead_time_oil_days,
  min_production_qty, min_tubes_qty, min_oil_kg,
  alert_fg_days, alert_production_days, alert_tubes_days, alert_oil_days
) VALUES
  ('NEWONN001', 'Fresh Up', true,  0.53, 1, 20, 30, 45, 45, 5000, 10000, 10, 7, 40, 55, 55),
  ('NEWONN002', 'Wind Down', false, 0.53, 1, 20, 30, 45, 45, 5000, 10000, 10, 7, 40, 55, 55)
ON CONFLICT (sku_internal) DO NOTHING;
