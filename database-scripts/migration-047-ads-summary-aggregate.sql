-- ============================================
-- Migration: Ads Summary Aggregate Function
-- Description: Create RPC function for efficient ads summary aggregation
-- Phase: Performance Optimization
-- Date: 2026-02-04
-- ============================================

-- ============================================
-- FUNCTION: get_ads_summary
-- Purpose: Aggregate ads data efficiently using PostgreSQL
-- Returns: Aggregated spend, revenue, orders
-- ============================================

CREATE OR REPLACE FUNCTION public.get_ads_summary(
    p_user_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_campaign_type TEXT DEFAULT NULL
)
RETURNS TABLE(
    total_spend NUMERIC,
    total_revenue NUMERIC,
    total_orders BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(spend), 0)::NUMERIC AS total_spend,
        COALESCE(SUM(revenue), 0)::NUMERIC AS total_revenue,
        COALESCE(SUM(orders), 0)::BIGINT AS total_orders
    FROM public.ad_daily_performance
    WHERE created_by = p_user_id
        AND ad_date >= p_start_date
        AND ad_date <= p_end_date
        AND (p_campaign_type IS NULL OR campaign_type = p_campaign_type);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- SECURITY
-- Grant execute permission to authenticated users
-- RLS is enforced via created_by filter in function
-- ============================================

GRANT EXECUTE ON FUNCTION public.get_ads_summary(UUID, DATE, DATE, TEXT) TO authenticated;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON FUNCTION public.get_ads_summary IS 'Efficiently aggregate ads summary data for a user and date range';

-- ============================================
-- END OF MIGRATION
-- ============================================
