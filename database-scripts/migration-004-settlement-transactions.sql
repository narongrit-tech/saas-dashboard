-- ============================================
-- Migration: Settlement Transactions Table
-- Description: Track actual settled transactions from TikTok Income reports
-- Phase: 2B - Settlement Reconciliation
-- Date: 2026-01-19
-- ============================================

-- ============================================
-- TABLE: settlement_transactions
-- ============================================

CREATE TABLE IF NOT EXISTS public.settlement_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    marketplace TEXT NOT NULL DEFAULT 'tiktok',
    txn_id TEXT NOT NULL,               -- Order/adjustment ID (must match unsettled)
    order_id TEXT,                      -- Optional Order ID if different from txn_id
    type TEXT,                          -- order/adjustment/refund/etc

    currency TEXT NOT NULL DEFAULT 'THB',
    settled_time TIMESTAMP WITH TIME ZONE,    -- Actual settlement timestamp (UTC+7)
    settlement_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,  -- Total settlement amount
    gross_revenue NUMERIC(14, 2),       -- Total Revenue if available
    fees_total NUMERIC(14, 2),          -- Aggregated fees if available

    source TEXT NOT NULL DEFAULT 'imported',
    import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE SET NULL,

    CONSTRAINT settlement_txns_unique_per_marketplace UNIQUE (marketplace, txn_id, created_by),
    CONSTRAINT settlement_txns_amount_check CHECK (settlement_amount IS NOT NULL)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_settlement_txns_settled_time
    ON public.settlement_transactions(settled_time DESC)
    WHERE settled_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_settlement_txns_marketplace_settled_time
    ON public.settlement_transactions(marketplace, settled_time DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_txns_created_by_settled_time
    ON public.settlement_transactions(created_by, settled_time DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_txns_txn_id
    ON public.settlement_transactions(marketplace, txn_id);

CREATE INDEX IF NOT EXISTS idx_settlement_txns_batch_id
    ON public.settlement_transactions(import_batch_id)
    WHERE import_batch_id IS NOT NULL;

-- ============================================
-- TRIGGERS
-- ============================================

DROP TRIGGER IF EXISTS update_settlement_transactions_updated_at ON public.settlement_transactions;
CREATE TRIGGER update_settlement_transactions_updated_at
    BEFORE UPDATE ON public.settlement_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE public.settlement_transactions ENABLE ROW LEVEL SECURITY;

-- Users can view their own settlement transactions
DROP POLICY IF EXISTS "settlement_txns_select_policy" ON public.settlement_transactions;
CREATE POLICY "settlement_txns_select_policy"
    ON public.settlement_transactions FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

-- Users can insert their own settlement transactions
DROP POLICY IF EXISTS "settlement_txns_insert_policy" ON public.settlement_transactions;
CREATE POLICY "settlement_txns_insert_policy"
    ON public.settlement_transactions FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

-- Users can update their own settlement transactions
DROP POLICY IF EXISTS "settlement_txns_update_policy" ON public.settlement_transactions;
CREATE POLICY "settlement_txns_update_policy"
    ON public.settlement_transactions FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

-- Users can delete their own settlement transactions
DROP POLICY IF EXISTS "settlement_txns_delete_policy" ON public.settlement_transactions;
CREATE POLICY "settlement_txns_delete_policy"
    ON public.settlement_transactions FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE public.settlement_transactions IS 'Track actual settled transactions from TikTok Income reports for reconciliation';
COMMENT ON COLUMN public.settlement_transactions.txn_id IS 'Unique transaction ID from marketplace (Order/adjustment ID)';
COMMENT ON COLUMN public.settlement_transactions.settled_time IS 'Actual settlement timestamp from income report (Asia/Bangkok)';
COMMENT ON COLUMN public.settlement_transactions.settlement_amount IS 'Total settlement amount received';

-- ============================================
-- END OF MIGRATION
-- ============================================
