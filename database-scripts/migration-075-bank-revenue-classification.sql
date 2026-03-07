-- migration-075-bank-revenue-classification.sql
-- Stores per-transaction classifications for "bank inflow revenue" on the Performance Dashboard.
-- Allows users to mark specific bank inflow rows as revenue (TikTok/Shopee/Other).
-- Selection persists in DB (not URL) so it survives page refreshes indefinitely.

-- ─── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bank_txn_classifications (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_transaction_id UUID        NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  include_as_revenue  BOOLEAN     NOT NULL DEFAULT TRUE,
  revenue_channel     VARCHAR(20) CHECK (revenue_channel IN ('tiktok', 'shopee', 'other')),
  revenue_type        TEXT,          -- free-text label for sub-classification
  note                TEXT,
  created_by          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One classification row per (transaction, user)
  UNIQUE (bank_transaction_id, created_by)
);

COMMENT ON TABLE public.bank_txn_classifications IS
  'Per-transaction revenue classification for the Performance Dashboard bank-inflows revenue basis.';

-- ─── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.bank_txn_classifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own bank txn classifications" ON public.bank_txn_classifications;
CREATE POLICY "Users can manage own bank txn classifications"
  ON public.bank_txn_classifications FOR ALL
  USING  (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- ─── Indexes ───────────────────────────────────────────────────────────────────

-- Look up classifications by transaction id (used in join)
CREATE INDEX IF NOT EXISTS idx_bank_txn_cls_txn
  ON public.bank_txn_classifications (bank_transaction_id);

-- Efficient query for "all rows I've included as revenue" (used by getBankInflowRevenueTotal)
CREATE INDEX IF NOT EXISTS idx_bank_txn_cls_user_include
  ON public.bank_txn_classifications (created_by, include_as_revenue)
  WHERE include_as_revenue = TRUE;

-- Channel breakdown query
CREATE INDEX IF NOT EXISTS idx_bank_txn_cls_channel
  ON public.bank_txn_classifications (created_by, revenue_channel)
  WHERE include_as_revenue = TRUE;

-- ─── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at_bank_txn_cls()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_txn_cls_updated_at ON public.bank_txn_classifications;
CREATE TRIGGER trg_bank_txn_cls_updated_at
  BEFORE UPDATE ON public.bank_txn_classifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_bank_txn_cls();
