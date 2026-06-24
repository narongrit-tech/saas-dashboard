-- migration-127: Cashflow Planner — Opening Balance
-- ──────────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   Add cashflow_opening_balance to app_settings so the /company-cashflow
--   Planner tab can store the user's current cash-on-hand as a starting point
--   for the 30-day rolling balance projection.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS cashflow_opening_balance NUMERIC(15,2) DEFAULT 0;

COMMENT ON COLUMN public.app_settings.cashflow_opening_balance
  IS 'Cash on hand today — starting balance for the cashflow planner projection';
