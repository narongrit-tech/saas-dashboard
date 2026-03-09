-- migration-081-cashflow-sankey-classifications.sql
-- ============================================
-- Purpose : Store per-transaction Sankey/cashflow node classifications.
--           Each bank_transaction row can be tagged with either an inflow_source
--           (for deposits: tiktok_settlement, shopee_settlement, director_loan,
--           other_income) or an outflow_category (for withdrawals: operating,
--           inventory_supplier, tax, wallet_topup, ceo_withdrawal,
--           loan_repayment, other_outflow) — never both at once.
--           An optional outflow_sub (vendor name, tax type, etc.) refines the
--           outflow node label.  Classifications are per-user (created_by) and
--           persist indefinitely in the DB — not stored in URL or localStorage.
--
-- RLS impact: ALL operations are guarded by created_by = auth.uid().
--             Users can only see and modify their own classification rows.
--             Cross-user leakage is impossible even if bank_transaction ids are
--             known, because the policy rejects any row where created_by ≠ the
--             authenticated user's UID.
--
-- Run:   psql $DATABASE_URL -f database-scripts/migration-081-cashflow-sankey-classifications.sql
-- ============================================

-- ─── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cashflow_node_classifications (
  id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_transaction_id  UUID        NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  -- inflow_source is set for deposit rows; outflow_category for withdrawal rows.
  -- The chk_cnc_one_direction constraint enforces mutual exclusivity once either
  -- field is non-null.
  inflow_source        VARCHAR(50)  NULL,
  outflow_category     VARCHAR(50)  NULL,
  outflow_sub          VARCHAR(100) NULL,   -- optional sub-label (vendor name, tax type, etc.)
  note                 TEXT         NULL,
  created_by           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One classification row per (transaction, user)
  UNIQUE (bank_transaction_id, created_by),
  -- Exactly one of inflow_source / outflow_category must be non-null once set.
  -- Both being NULL is allowed (unclassified row created optimistically).
  CONSTRAINT chk_cnc_one_direction CHECK (
    (inflow_source IS NULL) != (outflow_category IS NULL)
    OR (inflow_source IS NULL AND outflow_category IS NULL)
  ),
  CONSTRAINT chk_cnc_inflow_source CHECK (inflow_source IS NULL OR inflow_source IN (
    'tiktok_settlement', 'shopee_settlement', 'director_loan', 'other_income'
  )),
  CONSTRAINT chk_cnc_outflow_category CHECK (outflow_category IS NULL OR outflow_category IN (
    'operating', 'inventory_supplier', 'tax', 'wallet_topup',
    'ceo_withdrawal', 'loan_repayment', 'other_outflow'
  ))
);

COMMENT ON TABLE public.cashflow_node_classifications IS
  'Per-transaction Sankey node classifications for the Cashflow page. '
  'Tags each bank transaction as a specific inflow source or outflow category. '
  'Exactly one direction (inflow_source XOR outflow_category) may be set per row.';

COMMENT ON COLUMN public.cashflow_node_classifications.inflow_source IS
  'Set for deposit-side rows. Allowed values: tiktok_settlement, shopee_settlement, director_loan, other_income.';

COMMENT ON COLUMN public.cashflow_node_classifications.outflow_category IS
  'Set for withdrawal-side rows. Allowed values: operating, inventory_supplier, tax, wallet_topup, ceo_withdrawal, loan_repayment, other_outflow.';

COMMENT ON COLUMN public.cashflow_node_classifications.outflow_sub IS
  'Optional free-text sub-label refining the outflow node (e.g. vendor name, tax type). Only meaningful when outflow_category is non-null.';

-- ─── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.cashflow_node_classifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cnc_all_own" ON public.cashflow_node_classifications;
CREATE POLICY "cnc_all_own"
  ON public.cashflow_node_classifications FOR ALL
  USING  (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- ─── Indexes ───────────────────────────────────────────────────────────────────

-- Look up classifications by transaction id (foreign-key join in queries)
CREATE INDEX IF NOT EXISTS idx_cnc_txn
  ON public.cashflow_node_classifications (bank_transaction_id);

-- Fast per-user query including both direction columns (avoids heap fetch for
-- the common "list all my classifications" read path)
CREATE INDEX IF NOT EXISTS idx_cnc_user_date
  ON public.cashflow_node_classifications (created_by)
  INCLUDE (inflow_source, outflow_category);

-- Partial index for inflow aggregations (Sankey left-side nodes)
CREATE INDEX IF NOT EXISTS idx_cnc_inflow
  ON public.cashflow_node_classifications (created_by, inflow_source)
  WHERE inflow_source IS NOT NULL;

-- Partial index for outflow aggregations (Sankey right-side nodes)
CREATE INDEX IF NOT EXISTS idx_cnc_outflow
  ON public.cashflow_node_classifications (created_by, outflow_category)
  WHERE outflow_category IS NOT NULL;

-- ─── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at_cashflow_node_cls()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cnc_updated_at ON public.cashflow_node_classifications;
CREATE TRIGGER trg_cnc_updated_at
  BEFORE UPDATE ON public.cashflow_node_classifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_cashflow_node_cls();

-- ─── Grants ────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.cashflow_node_classifications
  TO authenticated;

-- ─── Verification queries (run manually to confirm correctness) ────────────────
--
-- 1. Constraint: valid inflow row
-- INSERT INTO public.cashflow_node_classifications
--   (bank_transaction_id, inflow_source, created_by)
-- VALUES ('<deposit-txn-uuid>', 'tiktok_settlement', auth.uid());
-- → should succeed.
--
-- 2. Constraint: valid outflow row with sub-label
-- INSERT INTO public.cashflow_node_classifications
--   (bank_transaction_id, outflow_category, outflow_sub, created_by)
-- VALUES ('<withdrawal-txn-uuid>', 'tax', 'VAT 7%', auth.uid());
-- → should succeed.
--
-- 3. Constraint: both directions set — must FAIL
-- INSERT INTO public.cashflow_node_classifications
--   (bank_transaction_id, inflow_source, outflow_category, created_by)
-- VALUES ('<any-uuid>', 'other_income', 'operating', auth.uid());
-- → ERROR: new row violates check constraint "chk_cnc_one_direction"
--
-- 4. Constraint: invalid enum value — must FAIL
-- INSERT INTO public.cashflow_node_classifications
--   (bank_transaction_id, inflow_source, created_by)
-- VALUES ('<any-uuid>', 'unknown_value', auth.uid());
-- → ERROR: new row violates check constraint "chk_cnc_inflow_source"
--
-- 5. RLS cross-user block: as user B, attempt to read user A's row
-- SELECT * FROM public.cashflow_node_classifications
-- WHERE created_by = '<user-A-uuid>';
-- → 0 rows returned (RLS filters to current user's rows only; no error raised,
--   which is standard Postgres RLS behaviour for SELECT).
--
-- 6. Indexes present
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'cashflow_node_classifications';
-- → idx_cnc_txn, idx_cnc_user_date, idx_cnc_inflow, idx_cnc_outflow
