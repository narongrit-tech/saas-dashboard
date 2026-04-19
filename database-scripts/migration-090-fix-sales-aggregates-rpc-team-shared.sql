-- migration-090-fix-sales-aggregates-rpc-team-shared.sql
-- ============================================================
-- PURPOSE : Fix 3 sales aggregate RPC functions for team-shared visibility
--
-- Problem: All three functions were SECURITY DEFINER and filtered by
--          p_user_id → WHERE created_by = p_user_id, so only the row
--          creator ever saw data; team members always received 0.
--
-- Affected functions (old signatures):
--   get_sales_aggregates(UUID, DATE, DATE, TEXT, TEXT, TEXT[], TEXT)
--   get_sales_aggregates_tiktok_like(UUID, DATE, DATE, TEXT, TEXT[], TEXT)
--   get_sales_story_aggregates(UUID, DATE, DATE, TEXT, TEXT[], TEXT)
--
-- Fix (same pattern as migration-089 for get_ads_summary):
--   1. DROP old function first (signature changes require DROP, not just REPLACE)
--   2. Re-create WITHOUT p_user_id as SECURITY INVOKER so RLS
--      (is_team_member() from migration-088) applies to sales_orders reads.
--   3. Remove AND created_by = p_user_id from all WHERE clauses.
--   4. All other filters (date, platform, status, payment_status) are unchanged.
--
-- RLS impact:
--   SECURITY INVOKER means the function body runs with the calling user's
--   RLS context. sales_orders.SELECT policy (migration-088) uses
--   public.is_team_member(), so any authenticated team member sees the full
--   team dataset — exactly matching the intent of migration-088.
--   Non-team users receive empty result sets (RLS blocks all rows).
--
-- Caller change required:
--   Remove the p_user_id argument from all call sites in server actions.
--
-- Run:    psql $DATABASE_URL -f database-scripts/migration-090-fix-sales-aggregates-rpc-team-shared.sql
-- Verify: run verification SELECT at the bottom of this file
-- ============================================================


-- ============================================================
-- FUNCTION 1: get_sales_aggregates
-- Old signature: (UUID, DATE, DATE, TEXT, TEXT, TEXT[], TEXT)
-- New signature: (DATE, DATE, TEXT, TEXT, TEXT[], TEXT)
-- ============================================================

-- Step 1a: Drop old signature (UUID as first param)
DROP FUNCTION IF EXISTS public.get_sales_aggregates(UUID, DATE, DATE, TEXT, TEXT, TEXT[], TEXT);

-- Step 1b: Re-create without p_user_id, SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.get_sales_aggregates(
    p_start_date       DATE,
    p_end_date         DATE,
    p_date_basis       TEXT,            -- 'order' or 'paid'
    p_source_platform  TEXT    DEFAULT NULL,
    p_status           TEXT[]  DEFAULT NULL,
    p_payment_status   TEXT    DEFAULT NULL
)
RETURNS TABLE(
    revenue_gross                NUMERIC,
    revenue_net                  NUMERIC,
    cancelled_same_day_amount    NUMERIC,
    cancel_rate_revenue_pct      NUMERIC,
    orders_gross                 BIGINT,
    orders_net                   BIGINT,
    cancelled_same_day_orders    BIGINT,
    cancel_rate_orders_pct       NUMERIC,
    total_units                  BIGINT,
    aov_net                      NUMERIC,
    orders_distinct              BIGINT,
    lines_total                  BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER   -- RLS applies: sales_orders SELECT uses is_team_member()
STABLE
AS $$
DECLARE
    v_revenue_gross               NUMERIC := 0;
    v_cancelled_same_day_amount   NUMERIC := 0;
    v_orders_gross                BIGINT  := 0;
    v_cancelled_same_day_orders   BIGINT  := 0;
    v_units_net                   BIGINT  := 0;
    v_revenue_net                 NUMERIC := 0;
    v_orders_net                  BIGINT  := 0;
    v_cancel_rate_revenue_pct     NUMERIC := 0;
    v_cancel_rate_orders_pct      NUMERIC := 0;
    v_aov_net                     NUMERIC := 0;
    v_orders_distinct             BIGINT  := 0;
    v_lines_total                 BIGINT  := 0;
BEGIN
    -- Build aggregation with CTE for order-level grouping.
    -- No created_by filter here; RLS on sales_orders enforces team scope.
    WITH filtered_lines AS (
        SELECT
            COALESCE(external_order_id, order_id) AS order_key,
            total_amount,
            quantity,
            COALESCE(created_time, order_date) AS effective_created_time,
            paid_time,
            cancelled_time
        FROM public.sales_orders
        WHERE
            -- Platform filter
            (p_source_platform IS NULL OR p_source_platform = 'all' OR source_platform = p_source_platform)
            -- Status filter
            AND (p_status IS NULL OR platform_status = ANY(p_status))
            -- Payment status filter
            AND (p_payment_status IS NULL OR p_payment_status = 'all' OR payment_status = p_payment_status)
            -- Date basis filtering
            AND (
                CASE
                    WHEN p_date_basis = 'paid' THEN
                        paid_time IS NOT NULL
                        AND paid_time::DATE >= p_start_date
                        AND paid_time::DATE <= p_end_date
                    ELSE
                        (COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok')::DATE >= p_start_date
                        AND (COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok')::DATE <= p_end_date
                END
            )
    ),
    order_aggregates AS (
        SELECT
            order_key,
            MAX(total_amount)                   AS order_amount,
            SUM(quantity)                       AS total_units_for_order,
            MAX(effective_created_time)         AS created_time,
            MAX(cancelled_time)                 AS cancelled_time,
            CASE
                WHEN MAX(cancelled_time) IS NOT NULL AND MAX(effective_created_time) IS NOT NULL
                    AND (MAX(cancelled_time) AT TIME ZONE 'Asia/Bangkok')::DATE
                        = (MAX(effective_created_time) AT TIME ZONE 'Asia/Bangkok')::DATE
                THEN TRUE
                ELSE FALSE
            END AS is_cancelled_same_day
        FROM filtered_lines
        GROUP BY order_key
    )
    SELECT
        COALESCE(SUM(order_amount), 0)::NUMERIC,
        COALESCE(SUM(CASE WHEN NOT is_cancelled_same_day THEN order_amount ELSE 0 END), 0)::NUMERIC,
        COALESCE(SUM(CASE WHEN is_cancelled_same_day     THEN order_amount ELSE 0 END), 0)::NUMERIC,
        CASE
            WHEN SUM(order_amount) > 0 THEN
                ROUND((SUM(CASE WHEN is_cancelled_same_day THEN order_amount ELSE 0 END)
                       / SUM(order_amount) * 100)::NUMERIC, 2)
            ELSE 0
        END,
        COUNT(*)::BIGINT,
        COALESCE(SUM(CASE WHEN NOT is_cancelled_same_day THEN 1 ELSE 0 END), 0)::BIGINT,
        COALESCE(SUM(CASE WHEN is_cancelled_same_day     THEN 1 ELSE 0 END), 0)::BIGINT,
        CASE
            WHEN COUNT(*) > 0 THEN
                ROUND((SUM(CASE WHEN is_cancelled_same_day THEN 1 ELSE 0 END)::NUMERIC
                       / COUNT(*) * 100)::NUMERIC, 2)
            ELSE 0
        END,
        COALESCE(SUM(CASE WHEN NOT is_cancelled_same_day THEN total_units_for_order ELSE 0 END), 0)::BIGINT,
        CASE
            WHEN SUM(CASE WHEN NOT is_cancelled_same_day THEN 1 ELSE 0 END) > 0 THEN
                ROUND((SUM(CASE WHEN NOT is_cancelled_same_day THEN order_amount ELSE 0 END)
                       / SUM(CASE WHEN NOT is_cancelled_same_day THEN 1 ELSE 0 END))::NUMERIC, 2)
            ELSE 0
        END,
        COUNT(*)::BIGINT,
        (SELECT COUNT(*) FROM filtered_lines)::BIGINT
    INTO
        v_revenue_gross,
        v_revenue_net,
        v_cancelled_same_day_amount,
        v_cancel_rate_revenue_pct,
        v_orders_gross,
        v_orders_net,
        v_cancelled_same_day_orders,
        v_cancel_rate_orders_pct,
        v_units_net,
        v_aov_net,
        v_orders_distinct,
        v_lines_total
    FROM order_aggregates;

    RETURN QUERY SELECT
        ROUND(v_revenue_gross, 2),
        ROUND(v_revenue_net, 2),
        ROUND(v_cancelled_same_day_amount, 2),
        v_cancel_rate_revenue_pct,
        v_orders_gross,
        v_orders_net,
        v_cancelled_same_day_orders,
        v_cancel_rate_orders_pct,
        v_units_net,
        v_aov_net,
        v_orders_distinct,
        v_lines_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_aggregates(DATE, DATE, TEXT, TEXT, TEXT[], TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_sales_aggregates IS
  'Aggregate sales summary data (gross/net, same-day cancel, AOV). '
  'Team-shared via SECURITY INVOKER + is_team_member() RLS (migration-090). '
  'p_user_id removed; call sites must be updated to drop that argument.';


-- ============================================================
-- FUNCTION 2: get_sales_aggregates_tiktok_like
-- Old signature: (UUID, DATE, DATE, TEXT, TEXT[], TEXT)
-- New signature: (DATE, DATE, TEXT, TEXT[], TEXT)
-- ============================================================

-- Step 2a: Drop old signature
DROP FUNCTION IF EXISTS public.get_sales_aggregates_tiktok_like(UUID, DATE, DATE, TEXT, TEXT[], TEXT);

-- Step 2b: Re-create without p_user_id, SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.get_sales_aggregates_tiktok_like(
    p_start_date       DATE,
    p_end_date         DATE,
    p_source_platform  TEXT    DEFAULT NULL,
    p_status           TEXT[]  DEFAULT NULL,
    p_payment_status   TEXT    DEFAULT NULL
)
RETURNS TABLE(
    total_created_orders      BIGINT,
    cancelled_created_orders  BIGINT,
    cancel_rate               NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER   -- RLS applies: sales_orders SELECT uses is_team_member()
STABLE
AS $$
BEGIN
    RETURN QUERY
    WITH order_aggregates AS (
        SELECT
            COALESCE(external_order_id, order_id) AS order_key,
            MAX(
                CASE
                    WHEN status_group IS NOT NULL   AND LOWER(status_group)   LIKE '%ยกเลิก%' THEN TRUE
                    WHEN platform_status IS NOT NULL AND LOWER(platform_status) LIKE '%ยกเลิก%' THEN TRUE
                    ELSE FALSE
                END
            ) AS is_cancelled
        FROM public.sales_orders
        WHERE
            -- Platform filter
            (p_source_platform IS NULL OR p_source_platform = 'all' OR source_platform = p_source_platform)
            -- Status filter
            AND (p_status IS NULL OR platform_status = ANY(p_status))
            -- Payment status filter
            AND (p_payment_status IS NULL OR p_payment_status = 'all' OR payment_status = p_payment_status)
            -- Date filtering: ALWAYS use created_at (TikTok semantics)
            AND created_at IS NOT NULL
            AND created_at::DATE >= p_start_date
            AND created_at::DATE <= p_end_date
        GROUP BY order_key
    )
    SELECT
        COUNT(*)::BIGINT AS total_created_orders,
        SUM(CASE WHEN is_cancelled THEN 1 ELSE 0 END)::BIGINT AS cancelled_created_orders,
        CASE
            WHEN COUNT(*) > 0 THEN
                ROUND((SUM(CASE WHEN is_cancelled THEN 1 ELSE 0 END)::NUMERIC / COUNT(*) * 100), 2)
            ELSE 0
        END AS cancel_rate
    FROM order_aggregates;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_aggregates_tiktok_like(DATE, DATE, TEXT, TEXT[], TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_sales_aggregates_tiktok_like IS
  'TikTok-style sales aggregates using created_at-based filtering. '
  'Team-shared via SECURITY INVOKER + is_team_member() RLS (migration-090). '
  'p_user_id removed; call sites must be updated to drop that argument.';


-- ============================================================
-- FUNCTION 3: get_sales_story_aggregates
-- Old signature: (UUID, DATE, DATE, TEXT, TEXT[], TEXT)
-- New signature: (DATE, DATE, TEXT, TEXT[], TEXT)
-- ============================================================

-- Step 3a: Drop old signature
DROP FUNCTION IF EXISTS public.get_sales_story_aggregates(UUID, DATE, DATE, TEXT, TEXT[], TEXT);

-- Step 3b: Re-create without p_user_id, SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.get_sales_story_aggregates(
    p_start_date       DATE,
    p_end_date         DATE,
    p_source_platform  TEXT    DEFAULT NULL,
    p_status           TEXT[]  DEFAULT NULL,
    p_payment_status   TEXT    DEFAULT NULL
)
RETURNS TABLE(
    gross_revenue_created             NUMERIC,
    total_created_orders              BIGINT,
    same_day_cancel_orders            BIGINT,
    same_day_cancel_revenue           NUMERIC,
    net_revenue_after_same_day_cancel NUMERIC,
    net_orders_after_same_day_cancel  BIGINT,
    cancel_rate_same_day              NUMERIC,
    has_cancelled_at                  BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER   -- RLS applies: sales_orders SELECT uses is_team_member()
STABLE
AS $$
BEGIN
    RETURN QUERY
    WITH order_aggregates AS (
        SELECT
            COALESCE(external_order_id, order_id) AS order_key,
            MAX(total_amount) AS order_amount,
            MAX(created_at)   AS created_at,
            -- FALLBACK: no cancelled_at field, derive from status text
            MAX(
                CASE
                    WHEN status_group IS NOT NULL   AND LOWER(status_group)   LIKE '%ยกเลิก%' THEN TRUE
                    WHEN platform_status IS NOT NULL AND LOWER(platform_status) LIKE '%ยกเลิก%' THEN TRUE
                    ELSE FALSE
                END
            ) AS is_cancelled
        FROM public.sales_orders
        WHERE
            -- Platform filter
            (p_source_platform IS NULL OR p_source_platform = 'all' OR source_platform = p_source_platform)
            -- Status filter
            AND (p_status IS NULL OR platform_status = ANY(p_status))
            -- Payment status filter
            AND (p_payment_status IS NULL OR p_payment_status = 'all' OR payment_status = p_payment_status)
            -- Date filtering: ALWAYS use created_at (Story semantics)
            AND created_at IS NOT NULL
            AND created_at::DATE >= p_start_date
            AND created_at::DATE <= p_end_date
        GROUP BY order_key
    )
    SELECT
        ROUND(COALESCE(SUM(order_amount), 0), 2)                                                AS gross_revenue_created,
        COUNT(*)::BIGINT                                                                        AS total_created_orders,
        -- FALLBACK MODE: treat all cancelled orders as "same-day cancel" (no cancelled_at column)
        SUM(CASE WHEN is_cancelled THEN 1 ELSE 0 END)::BIGINT                                  AS same_day_cancel_orders,
        ROUND(COALESCE(SUM(CASE WHEN is_cancelled     THEN order_amount ELSE 0 END), 0), 2)    AS same_day_cancel_revenue,
        ROUND(COALESCE(SUM(CASE WHEN NOT is_cancelled THEN order_amount ELSE 0 END), 0), 2)    AS net_revenue_after_same_day_cancel,
        SUM(CASE WHEN NOT is_cancelled THEN 1 ELSE 0 END)::BIGINT                              AS net_orders_after_same_day_cancel,
        CASE
            WHEN COUNT(*) > 0 THEN
                ROUND((SUM(CASE WHEN is_cancelled THEN 1 ELSE 0 END)::NUMERIC / COUNT(*) * 100), 2)
            ELSE 0
        END                                                                                     AS cancel_rate_same_day,
        FALSE                                                                                   AS has_cancelled_at  -- FALLBACK MODE indicator
    FROM order_aggregates;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_story_aggregates(DATE, DATE, TEXT, TEXT[], TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_sales_story_aggregates IS
  'Sales Story aggregates (created_at-based, same-day cancel via status text fallback). '
  'Team-shared via SECURITY INVOKER + is_team_member() RLS (migration-090). '
  'p_user_id removed; call sites must be updated to drop that argument.';


-- ============================================================
-- Verification
-- All three should show: prosecdef = f (INVOKER), pronargs as listed
-- ============================================================
SELECT
    proname,
    prosecdef  AS is_security_definer,  -- must be FALSE (f) for INVOKER
    pronargs   AS arg_count
FROM pg_proc
WHERE proname IN (
    'get_sales_aggregates',
    'get_sales_aggregates_tiktok_like',
    'get_sales_story_aggregates'
)
  AND pronamespace = 'public'::regnamespace
ORDER BY proname;
-- Expected:
--   get_sales_aggregates              | f | 6
--   get_sales_aggregates_tiktok_like  | f | 5
--   get_sales_story_aggregates        | f | 5
