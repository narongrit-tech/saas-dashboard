-- ============================================
-- Migration: Multi-Wallet Foundation
-- Description: Add wallets and wallet_ledger tables
-- Phase: 3 - Multi-Wallet
-- Date: 2026-01-23
-- ============================================

-- ============================================
-- TABLE: wallets
-- Description: Wallet definitions (TikTok Ads, Subscriptions, etc.)
-- ============================================

CREATE TABLE IF NOT EXISTS public.wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    wallet_type TEXT NOT NULL,  -- 'ADS' | 'SUBSCRIPTION' | 'OTHER'
    currency TEXT NOT NULL DEFAULT 'THB',
    is_active BOOLEAN NOT NULL DEFAULT true,
    description TEXT,

    CONSTRAINT wallets_name_not_empty CHECK (char_length(name) > 0),
    CONSTRAINT wallets_wallet_type_valid CHECK (wallet_type IN ('ADS', 'SUBSCRIPTION', 'OTHER')),
    CONSTRAINT wallets_currency_valid CHECK (char_length(currency) = 3)
);

-- ============================================
-- TABLE: wallet_ledger
-- Description: Transaction log for all wallet movements
-- ============================================

CREATE TABLE IF NOT EXISTS public.wallet_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
    date DATE NOT NULL,  -- Bangkok business date
    entry_type TEXT NOT NULL,  -- 'TOP_UP' | 'SPEND' | 'REFUND' | 'ADJUSTMENT'
    direction TEXT NOT NULL,  -- 'IN' | 'OUT'
    amount NUMERIC(12, 2) NOT NULL,

    source TEXT NOT NULL DEFAULT 'MANUAL',  -- 'MANUAL' | 'IMPORTED'
    import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE SET NULL,

    reference_id TEXT,  -- External reference (e.g., transaction ID from ads platform)
    note TEXT,

    CONSTRAINT wallet_ledger_amount_positive CHECK (amount > 0),
    CONSTRAINT wallet_ledger_entry_type_valid CHECK (entry_type IN ('TOP_UP', 'SPEND', 'REFUND', 'ADJUSTMENT')),
    CONSTRAINT wallet_ledger_direction_valid CHECK (direction IN ('IN', 'OUT')),
    CONSTRAINT wallet_ledger_source_valid CHECK (source IN ('MANUAL', 'IMPORTED'))
);

-- ============================================
-- INDEXES
-- ============================================

-- Wallets indexes
CREATE INDEX IF NOT EXISTS idx_wallets_created_by
    ON public.wallets(created_by);

CREATE INDEX IF NOT EXISTS idx_wallets_wallet_type
    ON public.wallets(wallet_type)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_wallets_is_active
    ON public.wallets(is_active);

-- Wallet ledger indexes
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_wallet_date
    ON public.wallet_ledger(wallet_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_date
    ON public.wallet_ledger(date DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_entry_type
    ON public.wallet_ledger(entry_type);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_source
    ON public.wallet_ledger(source);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_import_batch
    ON public.wallet_ledger(import_batch_id)
    WHERE import_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_created_by
    ON public.wallet_ledger(created_by);

-- ============================================
-- TRIGGERS
-- ============================================

DROP TRIGGER IF EXISTS update_wallets_updated_at ON public.wallets;
CREATE TRIGGER update_wallets_updated_at
    BEFORE UPDATE ON public.wallets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_wallet_ledger_updated_at ON public.wallet_ledger;
CREATE TRIGGER update_wallet_ledger_updated_at
    BEFORE UPDATE ON public.wallet_ledger
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY (RLS) - WALLETS
-- ============================================

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

-- Users can view their own wallets
DROP POLICY IF EXISTS "wallets_select_policy" ON public.wallets;
CREATE POLICY "wallets_select_policy"
    ON public.wallets FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

-- Users can insert their own wallets
DROP POLICY IF EXISTS "wallets_insert_policy" ON public.wallets;
CREATE POLICY "wallets_insert_policy"
    ON public.wallets FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

-- Users can update their own wallets
DROP POLICY IF EXISTS "wallets_update_policy" ON public.wallets;
CREATE POLICY "wallets_update_policy"
    ON public.wallets FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

-- Users can delete their own wallets (restrict if has ledger entries)
DROP POLICY IF EXISTS "wallets_delete_policy" ON public.wallets;
CREATE POLICY "wallets_delete_policy"
    ON public.wallets FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- ============================================
-- ROW LEVEL SECURITY (RLS) - WALLET_LEDGER
-- ============================================

ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;

-- Users can view their own wallet ledger entries
DROP POLICY IF EXISTS "wallet_ledger_select_policy" ON public.wallet_ledger;
CREATE POLICY "wallet_ledger_select_policy"
    ON public.wallet_ledger FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

-- Users can insert their own wallet ledger entries
DROP POLICY IF EXISTS "wallet_ledger_insert_policy" ON public.wallet_ledger;
CREATE POLICY "wallet_ledger_insert_policy"
    ON public.wallet_ledger FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

-- Users can update their own wallet ledger entries
DROP POLICY IF EXISTS "wallet_ledger_update_policy" ON public.wallet_ledger;
CREATE POLICY "wallet_ledger_update_policy"
    ON public.wallet_ledger FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

-- Users can delete their own wallet ledger entries
DROP POLICY IF EXISTS "wallet_ledger_delete_policy" ON public.wallet_ledger;
CREATE POLICY "wallet_ledger_delete_policy"
    ON public.wallet_ledger FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE public.wallets IS 'Wallet definitions for different payment sources (Ads, Subscriptions, etc.)';
COMMENT ON COLUMN public.wallets.wallet_type IS 'Type: ADS (advertising wallet), SUBSCRIPTION (foreign subscriptions), OTHER';
COMMENT ON COLUMN public.wallets.is_active IS 'Whether this wallet is currently active';

COMMENT ON TABLE public.wallet_ledger IS 'Transaction log for all wallet movements (top-ups, spends, refunds)';
COMMENT ON COLUMN public.wallet_ledger.entry_type IS 'TOP_UP (add money), SPEND (use money), REFUND (money back), ADJUSTMENT (corrections)';
COMMENT ON COLUMN public.wallet_ledger.direction IS 'IN (increases balance), OUT (decreases balance)';
COMMENT ON COLUMN public.wallet_ledger.source IS 'MANUAL (user entry) or IMPORTED (from report/bank)';
COMMENT ON COLUMN public.wallet_ledger.import_batch_id IS 'Link to import batch if this was imported from a file';

-- ============================================
-- END OF MIGRATION
-- ============================================
