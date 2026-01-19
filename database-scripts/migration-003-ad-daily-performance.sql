-- ============================================
-- Migration: Ad Daily Performance Table
-- Description: Track daily ad performance from TikTok and other platforms
-- Phase: 2A - Ads Tracking
-- Date: 2026-01-19
-- ============================================

-- ============================================
-- TABLE: ad_daily_performance
-- ============================================

CREATE TABLE IF NOT EXISTS public.ad_daily_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    marketplace TEXT NOT NULL DEFAULT 'tiktok',
    ad_date DATE NOT NULL,

    campaign_type TEXT,         -- 'product' | 'live'
    campaign_name TEXT,

    spend NUMERIC(14, 2) NOT NULL DEFAULT 0,
    orders INTEGER NOT NULL DEFAULT 0,
    revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
    roi NUMERIC(14, 4),         -- ROI calculated or imported

    source TEXT NOT NULL DEFAULT 'imported',
    import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE SET NULL,

    CONSTRAINT ad_daily_perf_unique_per_campaign UNIQUE (marketplace, ad_date, campaign_type, campaign_name, created_by),
    CONSTRAINT ad_daily_perf_spend_non_negative CHECK (spend >= 0),
    CONSTRAINT ad_daily_perf_orders_non_negative CHECK (orders >= 0),
    CONSTRAINT ad_daily_perf_revenue_non_negative CHECK (revenue >= 0)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_ad_daily_perf_date
    ON public.ad_daily_performance(ad_date DESC);

CREATE INDEX IF NOT EXISTS idx_ad_daily_perf_marketplace_date
    ON public.ad_daily_performance(marketplace, ad_date DESC);

CREATE INDEX IF NOT EXISTS idx_ad_daily_perf_campaign_type
    ON public.ad_daily_performance(campaign_type)
    WHERE campaign_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_daily_perf_created_by
    ON public.ad_daily_performance(created_by);

-- ============================================
-- TRIGGERS
-- ============================================

DROP TRIGGER IF EXISTS update_ad_daily_performance_updated_at ON public.ad_daily_performance;
CREATE TRIGGER update_ad_daily_performance_updated_at
    BEFORE UPDATE ON public.ad_daily_performance
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Auto-calculate ROI if not provided
CREATE OR REPLACE FUNCTION calculate_ad_roi()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.roi IS NULL AND NEW.spend > 0 THEN
        NEW.roi = NEW.revenue / NEW.spend;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calculate_ad_roi_trigger ON public.ad_daily_performance;
CREATE TRIGGER calculate_ad_roi_trigger
    BEFORE INSERT OR UPDATE ON public.ad_daily_performance
    FOR EACH ROW
    EXECUTE FUNCTION calculate_ad_roi();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE public.ad_daily_performance ENABLE ROW LEVEL SECURITY;

-- Users can view their own ad performance data
DROP POLICY IF EXISTS "ad_daily_perf_select_policy" ON public.ad_daily_performance;
CREATE POLICY "ad_daily_perf_select_policy"
    ON public.ad_daily_performance FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

-- Users can insert their own ad performance data
DROP POLICY IF EXISTS "ad_daily_perf_insert_policy" ON public.ad_daily_performance;
CREATE POLICY "ad_daily_perf_insert_policy"
    ON public.ad_daily_performance FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

-- Users can update their own ad performance data
DROP POLICY IF EXISTS "ad_daily_perf_update_policy" ON public.ad_daily_performance;
CREATE POLICY "ad_daily_perf_update_policy"
    ON public.ad_daily_performance FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

-- Users can delete their own ad performance data
DROP POLICY IF EXISTS "ad_daily_perf_delete_policy" ON public.ad_daily_performance;
CREATE POLICY "ad_daily_perf_delete_policy"
    ON public.ad_daily_performance FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE public.ad_daily_performance IS 'Daily ad performance metrics from advertising platforms';
COMMENT ON COLUMN public.ad_daily_performance.campaign_type IS 'Type of campaign: product (creative) or live (livestream)';
COMMENT ON COLUMN public.ad_daily_performance.roi IS 'Return on Investment (revenue/spend)';
COMMENT ON COLUMN public.ad_daily_performance.source IS 'Data source: imported from file or manually entered';

-- ============================================
-- END OF MIGRATION
-- ============================================
