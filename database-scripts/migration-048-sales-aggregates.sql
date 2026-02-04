-- ============================================
-- Migration: Sales Summary Aggregate Functions
-- Description: Create RPC functions for efficient sales summary aggregation
-- Phase: Performance Optimization
-- Date: 2026-02-04
-- ============================================

-- ============================================
-- FUNCTION: get_sales_aggregates
-- Purpose: Aggregate sales data efficiently using PostgreSQL
-- Returns: All sales metrics with complex business logic
-- ============================================

CREATE OR REPLACE FUNCTION public.get_sales_aggregates(
    p_user_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_date_basis TEXT, -- 'order' or 'paid'
    p_source_platform TEXT DEFAULT NULL,
    p_status TEXT[] DEFAULT NULL,
    p_payment_status TEXT DEFAULT NULL
)
RETURNS TABLE(
    revenue_gross NUMERIC,
    revenue_net NUMERIC,
    cancelled_same_day_amount NUMERIC,
    cancel_rate_revenue_pct NUMERIC,
    orders_gross BIGINT,
    orders_net BIGINT,
    cancelled_same_day_orders BIGINT,
    cancel_rate_orders_pct NUMERIC,
    total_units BIGINT,
    aov_net NUMERIC,
    orders_distinct BIGINT,
    lines_total BIGINT
) AS $$
DECLARE
    v_revenue_gross NUMERIC := 0;
    v_cancelled_same_day_amount NUMERIC := 0;
    v_orders_gross BIGINT := 0;
    v_cancelled_same_day_orders BIGINT := 0;
    v_units_net BIGINT := 0;
    v_revenue_net NUMERIC := 0;
    v_orders_net BIGINT := 0;
    v_cancel_rate_revenue_pct NUMERIC := 0;
    v_cancel_rate_orders_pct NUMERIC := 0;
    v_aov_net NUMERIC := 0;
    v_orders_distinct BIGINT := 0;
    v_lines_total BIGINT := 0;
BEGIN
    -- Build aggregation with CTE for order-level grouping
    WITH filtered_lines AS (
        SELECT
            COALESCE(external_order_id, order_id) AS order_key,
            total_amount,
            quantity,
            COALESCE(created_time, order_date) AS effective_created_time,
            paid_time,
            cancelled_time
        FROM public.sales_orders
        WHERE created_by = p_user_id
            -- Platform filter
            AND (p_source_platform IS NULL OR p_source_platform = 'all' OR source_platform = p_source_platform)
            -- Status filter
            AND (p_status IS NULL OR platform_status = ANY(p_status))
            -- Payment status filter
            AND (p_payment_status IS NULL OR p_payment_status = 'all' OR payment_status = p_payment_status)
            -- Date basis filtering
            AND (
                CASE
                    WHEN p_date_basis = 'paid' THEN
                        -- Paid basis: Use paid_time
                        paid_time IS NOT NULL
                        AND paid_time::DATE >= p_start_date
                        AND paid_time::DATE <= p_end_date
                    ELSE
                        -- Order basis: Use COALESCE(created_time, order_date)
                        -- Note: We fetch broader range by order_date and filter client-side in client code
                        -- But here in SQL we can filter directly on effective date
                        (COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok')::DATE >= p_start_date
                        AND (COALESCE(created_time, order_date) AT TIME ZONE 'Asia/Bangkok')::DATE <= p_end_date
                END
            )
    ),
    order_aggregates AS (
        SELECT
            order_key,
            MAX(total_amount) AS order_amount, -- Use MAX for safety (should be same across SKU lines)
            SUM(quantity) AS total_units_for_order,
            MAX(effective_created_time) AS created_time,
            MAX(cancelled_time) AS cancelled_time,
            -- Same-day cancel check: DATE(cancelled_time) = DATE(created_time) in Bangkok timezone
            CASE
                WHEN MAX(cancelled_time) IS NOT NULL AND MAX(effective_created_time) IS NOT NULL
                    AND (MAX(cancelled_time) AT TIME ZONE 'Asia/Bangkok')::DATE = (MAX(effective_created_time) AT TIME ZONE 'Asia/Bangkok')::DATE
                THEN TRUE
                ELSE FALSE
            END AS is_cancelled_same_day
        FROM filtered_lines
        GROUP BY order_key
    )
    SELECT
        COALESCE(SUM(order_amount), 0)::NUMERIC,
        COALESCE(SUM(CASE WHEN NOT is_cancelled_same_day THEN order_amount ELSE 0 END), 0)::NUMERIC,
        COALESCE(SUM(CASE WHEN is_cancelled_same_day THEN order_amount ELSE 0 END), 0)::NUMERIC,
        CASE
            WHEN SUM(order_amount) > 0 THEN
                ROUND((SUM(CASE WHEN is_cancelled_same_day THEN order_amount ELSE 0 END) / SUM(order_amount) * 100)::NUMERIC, 2)
            ELSE 0
        END,
        COUNT(*)::BIGINT,
        COALESCE(SUM(CASE WHEN NOT is_cancelled_same_day THEN 1 ELSE 0 END), 0)::BIGINT,
        COALESCE(SUM(CASE WHEN is_cancelled_same_day THEN 1 ELSE 0 END), 0)::BIGINT,
        CASE
            WHEN COUNT(*) > 0 THEN
                ROUND((SUM(CASE WHEN is_cancelled_same_day THEN 1 ELSE 0 END)::NUMERIC / COUNT(*) * 100)::NUMERIC, 2)
            ELSE 0
        END,
        COALESCE(SUM(CASE WHEN NOT is_cancelled_same_day THEN total_units_for_order ELSE 0 END), 0)::BIGINT,
        CASE
            WHEN SUM(CASE WHEN NOT is_cancelled_same_day THEN 1 ELSE 0 END) > 0 THEN
                ROUND((SUM(CASE WHEN NOT is_cancelled_same_day THEN order_amount ELSE 0 END) / SUM(CASE WHEN NOT is_cancelled_same_day THEN 1 ELSE 0 END))::NUMERIC, 2)
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

    -- Return result
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FUNCTION: get_sales_aggregates_tiktok_like
-- Purpose: TikTok-style aggregates (created_at-based filtering)
-- Returns: Total created orders and cancelled orders with cancel rate
-- ============================================

CREATE OR REPLACE FUNCTION public.get_sales_aggregates_tiktok_like(
    p_user_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_source_platform TEXT DEFAULT NULL,
    p_status TEXT[] DEFAULT NULL,
    p_payment_status TEXT DEFAULT NULL
)
RETURNS TABLE(
    total_created_orders BIGINT,
    cancelled_created_orders BIGINT,
    cancel_rate NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH order_aggregates AS (
        SELECT
            COALESCE(external_order_id, order_id) AS order_key,
            MAX(
                CASE
                    WHEN status_group IS NOT NULL AND LOWER(status_group) LIKE '%ยกเลิก%' THEN TRUE
                    WHEN platform_status IS NOT NULL AND LOWER(platform_status) LIKE '%ยกเลิก%' THEN TRUE
                    ELSE FALSE
                END
            ) AS is_cancelled
        FROM public.sales_orders
        WHERE created_by = p_user_id
            -- Platform filter
            AND (p_source_platform IS NULL OR p_source_platform = 'all' OR source_platform = p_source_platform)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FUNCTION: get_sales_story_aggregates
-- Purpose: Sales Story aggregates (created_at-based, same-day cancel)
-- Returns: Gross vs Net revenue/orders with same-day cancel metrics
-- ============================================

CREATE OR REPLACE FUNCTION public.get_sales_story_aggregates(
    p_user_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_source_platform TEXT DEFAULT NULL,
    p_status TEXT[] DEFAULT NULL,
    p_payment_status TEXT DEFAULT NULL
)
RETURNS TABLE(
    gross_revenue_created NUMERIC,
    total_created_orders BIGINT,
    same_day_cancel_orders BIGINT,
    same_day_cancel_revenue NUMERIC,
    net_revenue_after_same_day_cancel NUMERIC,
    net_orders_after_same_day_cancel BIGINT,
    cancel_rate_same_day NUMERIC,
    has_cancelled_at BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    WITH order_aggregates AS (
        SELECT
            COALESCE(external_order_id, order_id) AS order_key,
            MAX(total_amount) AS order_amount,
            MAX(created_at) AS created_at,
            -- Check if cancelled (FALLBACK: No cancelled_at field, use status)
            MAX(
                CASE
                    WHEN status_group IS NOT NULL AND LOWER(status_group) LIKE '%ยกเลิก%' THEN TRUE
                    WHEN platform_status IS NOT NULL AND LOWER(platform_status) LIKE '%ยกเลิก%' THEN TRUE
                    ELSE FALSE
                END
            ) AS is_cancelled
        FROM public.sales_orders
        WHERE created_by = p_user_id
            -- Platform filter
            AND (p_source_platform IS NULL OR p_source_platform = 'all' OR source_platform = p_source_platform)
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
        ROUND(COALESCE(SUM(order_amount), 0), 2) AS gross_revenue_created,
        COUNT(*)::BIGINT AS total_created_orders,
        -- FALLBACK MODE: Since no cancelled_at field exists, treat all cancelled orders as "same-day cancel"
        SUM(CASE WHEN is_cancelled THEN 1 ELSE 0 END)::BIGINT AS same_day_cancel_orders,
        ROUND(COALESCE(SUM(CASE WHEN is_cancelled THEN order_amount ELSE 0 END), 0), 2) AS same_day_cancel_revenue,
        ROUND(COALESCE(SUM(CASE WHEN NOT is_cancelled THEN order_amount ELSE 0 END), 0), 2) AS net_revenue_after_same_day_cancel,
        SUM(CASE WHEN NOT is_cancelled THEN 1 ELSE 0 END)::BIGINT AS net_orders_after_same_day_cancel,
        CASE
            WHEN COUNT(*) > 0 THEN
                ROUND((SUM(CASE WHEN is_cancelled THEN 1 ELSE 0 END)::NUMERIC / COUNT(*) * 100), 2)
            ELSE 0
        END AS cancel_rate_same_day,
        FALSE AS has_cancelled_at -- FALLBACK MODE indicator
    FROM order_aggregates;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- SECURITY
-- Grant execute permission to authenticated users
-- RLS is enforced via created_by filter in functions
-- ============================================

GRANT EXECUTE ON FUNCTION public.get_sales_aggregates(UUID, DATE, DATE, TEXT, TEXT, TEXT[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_aggregates_tiktok_like(UUID, DATE, DATE, TEXT, TEXT[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_story_aggregates(UUID, DATE, DATE, TEXT, TEXT[], TEXT) TO authenticated;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON FUNCTION public.get_sales_aggregates IS 'Efficiently aggregate sales summary data with complex business logic (same-day cancel, gross/net metrics, order-level grouping)';
COMMENT ON FUNCTION public.get_sales_aggregates_tiktok_like IS 'TikTok-style sales aggregates using created_at-based filtering for reference/comparison';
COMMENT ON FUNCTION public.get_sales_story_aggregates IS 'Sales Story aggregates with created_at-based filtering and same-day cancel metrics';

-- ============================================
-- INDEXES
-- Add indexes to optimize aggregate queries
-- ============================================

-- Index for created_time filtering (order basis)
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_time_user
ON public.sales_orders(created_by, created_time)
WHERE created_time IS NOT NULL;

-- Index for paid_time filtering (paid basis)
CREATE INDEX IF NOT EXISTS idx_sales_orders_paid_time_user
ON public.sales_orders(created_by, paid_time)
WHERE paid_time IS NOT NULL;

-- Index for created_at filtering (TikTok/Story basis)
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_at_user
ON public.sales_orders(created_by, created_at)
WHERE created_at IS NOT NULL;

-- Index for cancelled_time (same-day cancel checks)
CREATE INDEX IF NOT EXISTS idx_sales_orders_cancelled_time_user
ON public.sales_orders(created_by, cancelled_time)
WHERE cancelled_time IS NOT NULL;

-- Composite index for platform filtering
CREATE INDEX IF NOT EXISTS idx_sales_orders_user_platform_dates
ON public.sales_orders(created_by, source_platform, created_time, paid_time, created_at);

-- ============================================
-- END OF MIGRATION
-- ============================================
