-- migration-119: Production Planning — Stock Ledger
-- ──────────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   Append-only log of all stock snapshots across every inventory layer.
--   "Current stock" for each formula+type is always the most-recent row
--   (SELECT DISTINCT ON (formula_id, stock_type) … ORDER BY recorded_at DESC).
--
-- STOCK TYPES
--   fg_warehouse    FG at our warehouse — updated every day at 16:00 by packing staff
--   fg_factory      FG at factory — updated on demand (asked via LINE)
--   tubes_factory   Empty tubes at factory
--   tubes_warehouse Empty tubes at our warehouse (may be phased out in future)
--   oil_kg          Essential oil in kg — Fresh Up only (formula_id required)
--
-- DESIGN NOTES
--   quantity is always an absolute count (not a delta).
--   For oil_kg rows, formula_id must reference a formula with uses_oil = true.
--   snapshot_date is the Bangkok-calendar date the count was taken.
-- ──────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.prod_stock_type AS ENUM (
    'fg_warehouse',
    'fg_factory',
    'tubes_factory',
    'tubes_warehouse',
    'oil_kg'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.prod_stock_ledger (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  formula_id    UUID        REFERENCES public.prod_formula_config(id) ON DELETE RESTRICT,
  stock_type    public.prod_stock_type NOT NULL,
  quantity      DECIMAL(12,3) NOT NULL CHECK (quantity >= 0),
  snapshot_date DATE        NOT NULL,
  notes         TEXT,
  recorded_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast "latest per formula+type" lookups
CREATE INDEX IF NOT EXISTS idx_prod_stock_ledger_formula_type_date
  ON public.prod_stock_ledger (formula_id, stock_type, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_prod_stock_ledger_snapshot_date
  ON public.prod_stock_ledger (snapshot_date DESC);

-- RLS
ALTER TABLE public.prod_stock_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prod_stock_ledger_select"
  ON public.prod_stock_ledger FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "prod_stock_ledger_insert"
  ON public.prod_stock_ledger FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
