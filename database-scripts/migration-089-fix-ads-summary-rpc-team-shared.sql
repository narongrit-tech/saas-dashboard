-- migration-089-fix-ads-summary-rpc-team-shared.sql
-- ============================================================
-- PURPOSE : Fix get_ads_summary RPC for team-shared visibility
--
-- Problem: get_ads_summary was SECURITY DEFINER and filtered by
--          p_user_id → WHERE created_by = p_user_id, so only the
--          row creator ever saw data (team members always saw 0).
--
-- Fix:
--   1. Drop old function (signature change requires DROP first)
--   2. Re-create without p_user_id, as SECURITY INVOKER so RLS
--      (is_team_member() from migration-088) applies normally.
--
-- Run: psql $DATABASE_URL -f database-scripts/migration-089-fix-ads-summary-rpc-team-shared.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Step 1: Drop old function (signature: UUID, DATE, DATE, TEXT)
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_ads_summary(UUID, DATE, DATE, TEXT);

-- ─────────────────────────────────────────────────────────────
-- Step 2: Re-create without p_user_id, SECURITY INVOKER
--         so ad_daily_performance RLS (is_team_member()) applies
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_ads_summary(
    p_start_date DATE,
    p_end_date   DATE,
    p_campaign_type TEXT DEFAULT NULL
)
RETURNS TABLE(
    total_spend  NUMERIC,
    total_revenue NUMERIC,
    total_orders  BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER   -- RLS applies: is_team_member() enforced
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(spend),   0)::NUMERIC  AS total_spend,
        COALESCE(SUM(revenue), 0)::NUMERIC  AS total_revenue,
        COALESCE(SUM(orders),  0)::BIGINT   AS total_orders
    FROM public.ad_daily_performance
    WHERE ad_date >= p_start_date
      AND ad_date <= p_end_date
      AND (p_campaign_type IS NULL OR campaign_type = p_campaign_type);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- Step 3: Grant execute
-- ─────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_ads_summary(DATE, DATE, TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_ads_summary IS
  'Aggregate ads performance data for the calling user''s team (team-shared, migration-089)';

-- ─────────────────────────────────────────────────────────────
-- Verification
-- ─────────────────────────────────────────────────────────────
SELECT proname, prosecdef, pronargs
FROM pg_proc
WHERE proname = 'get_ads_summary'
  AND pronamespace = 'public'::regnamespace;
-- Should return: get_ads_summary | f (INVOKER) | 3 args (DATE, DATE, TEXT)
