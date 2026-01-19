-- ============================================
-- Migration: Unsettled Transactions Table
-- Description: Track pending/unsettled transactions from TikTok and other platforms
-- Phase: 2A - Cashflow Forecast
-- Date: 2026-01-19
-- ============================================

-- ============================================
-- TABLE: unsettled_transactions
-- ============================================

CREATE TABLE IF NOT EXISTS public.unsettled_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    marketplace TEXT NOT NULL DEFAULT 'tiktok',
    txn_id TEXT NOT NULL,               -- Order/adjustment ID (unique per marketplace)
    related_order_id TEXT,
    type TEXT,                          -- Transaction type if provided

    currency TEXT NOT NULL DEFAULT 'THB',
    estimated_settle_time TIMESTAMP WITH TIME ZONE,
    estimated_settlement_amount NUMERIC(14, 2),
    unsettled_reason TEXT,

    import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE SET NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    status TEXT NOT NULL DEFAULT 'unsettled',  -- unsettled|settled|dropped
    settled_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT unsettled_txns_unique_per_marketplace UNIQUE (marketplace, txn_id),
    CONSTRAINT unsettled_txns_status_valid CHECK (status IN ('unsettled', 'settled', 'dropped'))
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_unsettled_txns_estimated_settle_time
    ON public.unsettled_transactions(estimated_settle_time)
    WHERE estimated_settle_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unsettled_txns_status
    ON public.unsettled_transactions(status);

CREATE INDEX IF NOT EXISTS idx_unsettled_txns_last_seen
    ON public.unsettled_transactions(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_unsettled_txns_marketplace_status
    ON public.unsettled_transactions(marketplace, status);

CREATE INDEX IF NOT EXISTS idx_unsettled_txns_created_by
    ON public.unsettled_transactions(created_by);

-- ============================================
-- TRIGGERS
-- ============================================

DROP TRIGGER IF EXISTS update_unsettled_transactions_updated_at ON public.unsettled_transactions;
CREATE TRIGGER update_unsettled_transactions_updated_at
    BEFORE UPDATE ON public.unsettled_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE public.unsettled_transactions ENABLE ROW LEVEL SECURITY;

-- Users can view their own unsettled transactions
DROP POLICY IF EXISTS "unsettled_txns_select_policy" ON public.unsettled_transactions;
CREATE POLICY "unsettled_txns_select_policy"
    ON public.unsettled_transactions FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

-- Users can insert their own unsettled transactions
DROP POLICY IF EXISTS "unsettled_txns_insert_policy" ON public.unsettled_transactions;
CREATE POLICY "unsettled_txns_insert_policy"
    ON public.unsettled_transactions FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

-- Users can update their own unsettled transactions
DROP POLICY IF EXISTS "unsettled_txns_update_policy" ON public.unsettled_transactions;
CREATE POLICY "unsettled_txns_update_policy"
    ON public.unsettled_transactions FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

-- Users can delete their own unsettled transactions
DROP POLICY IF EXISTS "unsettled_txns_delete_policy" ON public.unsettled_transactions;
CREATE POLICY "unsettled_txns_delete_policy"
    ON public.unsettled_transactions FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE public.unsettled_transactions IS 'Track pending/unsettled transactions for cashflow forecasting';
COMMENT ON COLUMN public.unsettled_transactions.txn_id IS 'Unique transaction ID from marketplace (Order/adjustment ID)';
COMMENT ON COLUMN public.unsettled_transactions.estimated_settle_time IS 'When the transaction is expected to settle';
COMMENT ON COLUMN public.unsettled_transactions.last_seen_at IS 'Last time this transaction was seen in an import file';
COMMENT ON COLUMN public.unsettled_transactions.status IS 'unsettled=pending settlement, settled=confirmed received, dropped=removed from forecast';

-- ============================================
-- END OF MIGRATION
-- ============================================
