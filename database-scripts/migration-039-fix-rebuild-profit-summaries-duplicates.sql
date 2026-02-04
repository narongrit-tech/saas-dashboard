-- ============================================
-- Migration 039: Fix rebuild_profit_summaries() Duplicate Key Error
-- Purpose: Fix product_profit_daily unique constraint violation
-- Date: 2026-02-01
-- Root Cause: product_revenue CTE grouped by both product_id AND product_name,
--             causing multiple rows per (date, platform, product_id)
-- ============================================

-- ============================================
-- RECREATE rebuild_profit_summaries WITH FIX
-- ============================================

CREATE OR REPLACE FUNCTION rebuild_profit_summaries(
  p_user_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows_affected INTEGER := 0;
BEGIN
  -- ============================================
  -- 1) DELETE EXISTING SUMMARIES FOR DATE RANGE
  -- ============================================

  DELETE FROM platform_net_profit_daily
  WHERE created_by = p_user_id
    AND date BETWEEN p_start_date AND p_end_date;

  DELETE FROM product_profit_daily
  WHERE created_by = p_user_id
    AND date BETWEEN p_start_date AND p_end_date;

  DELETE FROM source_split_daily
  WHERE created_by = p_user_id
    AND date BETWEEN p_start_date AND p_end_date;

  -- ============================================
  -- 2) REBUILD platform_net_profit_daily
  -- ============================================

  INSERT INTO platform_net_profit_daily (
    date, platform, gmv, ads_spend, cogs, net_profit, created_by
  )
  SELECT
    DATE(s.order_date AT TIME ZONE 'Asia/Bangkok') as date,
    COALESCE(s.source_platform, 'unknown') as platform,
    SUM(s.total_amount) as gmv,
    COALESCE(SUM(ads.spend), 0) as ads_spend,
    COALESCE(SUM(cogs.amount), 0) as cogs,
    SUM(s.total_amount) - COALESCE(SUM(ads.spend), 0) - COALESCE(SUM(cogs.amount), 0) as net_profit,
    p_user_id
  FROM sales_orders s
  LEFT JOIN ad_daily_performance ads
    ON ads.ad_date = DATE(s.order_date AT TIME ZONE 'Asia/Bangkok')
    AND ads.marketplace = s.source_platform
    AND ads.created_by = p_user_id
  LEFT JOIN inventory_cogs_allocations cogs
    ON cogs.order_id = s.order_id
    AND cogs.created_by = p_user_id
    AND cogs.is_reversal = false
  WHERE s.created_by = p_user_id
    AND DATE(s.order_date AT TIME ZONE 'Asia/Bangkok') BETWEEN p_start_date AND p_end_date
    AND s.platform_status NOT IN ('Cancelled', 'Refunded')
  GROUP BY DATE(s.order_date AT TIME ZONE 'Asia/Bangkok'), s.source_platform
  ON CONFLICT (created_by, date, platform)
  DO UPDATE SET
    gmv = EXCLUDED.gmv,
    ads_spend = EXCLUDED.ads_spend,
    cogs = EXCLUDED.cogs,
    net_profit = EXCLUDED.net_profit,
    updated_at = NOW();

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  -- ============================================
  -- 3) REBUILD product_profit_daily (FIXED)
  -- ============================================
  -- FIX: Remove product_name from GROUP BY
  -- Use MAX(product_name) to get a single name per product_id

  INSERT INTO product_profit_daily (
    date, platform, product_id, product_name, revenue, allocated_ads, cogs, margin, margin_pct, created_by
  )
  WITH product_revenue AS (
    SELECT
      DATE(s.order_date AT TIME ZONE 'Asia/Bangkok') as date,
      COALESCE(s.source_platform, 'unknown') as platform,
      COALESCE(s.seller_sku, s.product_name) as product_id,
      MAX(s.product_name) as product_name,  -- FIX: Use MAX instead of including in GROUP BY
      SUM(s.total_amount) as revenue,
      COALESCE(SUM(cogs.amount), 0) as cogs
    FROM sales_orders s
    LEFT JOIN inventory_cogs_allocations cogs
      ON cogs.order_id = s.order_id
      AND cogs.created_by = p_user_id
      AND cogs.is_reversal = false
    WHERE s.created_by = p_user_id
      AND DATE(s.order_date AT TIME ZONE 'Asia/Bangkok') BETWEEN p_start_date AND p_end_date
      AND s.platform_status NOT IN ('Cancelled', 'Refunded')
    GROUP BY
      DATE(s.order_date AT TIME ZONE 'Asia/Bangkok'),
      s.source_platform,
      COALESCE(s.seller_sku, s.product_name)
      -- REMOVED: s.product_name from GROUP BY
  ),
  daily_ads AS (
    SELECT
      ad_date as date,
      marketplace as platform,
      SUM(spend) as total_spend
    FROM ad_daily_performance
    WHERE created_by = p_user_id
      AND ad_date BETWEEN p_start_date AND p_end_date
      AND campaign_type != 'live'
    GROUP BY ad_date, marketplace
  ),
  daily_revenue_totals AS (
    SELECT
      date,
      platform,
      SUM(revenue) as total_revenue
    FROM product_revenue
    GROUP BY date, platform
  )
  SELECT
    pr.date,
    pr.platform,
    pr.product_id,
    pr.product_name,
    pr.revenue,
    CASE
      WHEN drt.total_revenue > 0 THEN (pr.revenue / drt.total_revenue) * COALESCE(da.total_spend, 0)
      ELSE 0
    END as allocated_ads,
    pr.cogs,
    pr.revenue -
      CASE
        WHEN drt.total_revenue > 0 THEN (pr.revenue / drt.total_revenue) * COALESCE(da.total_spend, 0)
        ELSE 0
      END - pr.cogs as margin,
    CASE
      WHEN pr.revenue > 0 THEN
        ((pr.revenue -
          CASE
            WHEN drt.total_revenue > 0 THEN (pr.revenue / drt.total_revenue) * COALESCE(da.total_spend, 0)
            ELSE 0
          END - pr.cogs) / pr.revenue) * 100
      ELSE NULL
    END as margin_pct,
    p_user_id
  FROM product_revenue pr
  LEFT JOIN daily_revenue_totals drt ON pr.date = drt.date AND pr.platform = drt.platform
  LEFT JOIN daily_ads da ON pr.date = da.date AND pr.platform = da.platform
  ON CONFLICT (created_by, date, platform, product_id)
  DO UPDATE SET
    product_name = EXCLUDED.product_name,
    revenue = EXCLUDED.revenue,
    allocated_ads = EXCLUDED.allocated_ads,
    cogs = EXCLUDED.cogs,
    margin = EXCLUDED.margin,
    margin_pct = EXCLUDED.margin_pct,
    updated_at = NOW();

  -- ============================================
  -- 4) REBUILD source_split_daily
  -- ============================================

  INSERT INTO source_split_daily (
    date, platform, source_bucket, gmv, orders, cost, profit, created_by
  )
  SELECT
    DATE(s.order_date AT TIME ZONE 'Asia/Bangkok') as date,
    COALESCE(s.source_platform, 'unknown') as platform,
    CASE
      WHEN oa.attribution_type = 'internal_affiliate' THEN 'internal_affiliate'
      WHEN oa.attribution_type = 'external_affiliate' THEN 'external_affiliate'
      WHEN oa.attribution_type = 'paid_ads' THEN 'paid_ads'
      ELSE 'organic'
    END as source_bucket,
    SUM(s.total_amount) as gmv,
    COUNT(DISTINCT s.order_id) as orders,
    COALESCE(SUM(oa.commission_amt), 0) as cost,
    SUM(s.total_amount) - COALESCE(SUM(oa.commission_amt), 0) - COALESCE(SUM(cogs.amount), 0) as profit,
    p_user_id
  FROM sales_orders s
  LEFT JOIN order_attribution oa
    ON oa.order_id = s.order_id
    AND oa.created_by = p_user_id
  LEFT JOIN inventory_cogs_allocations cogs
    ON cogs.order_id = s.order_id
    AND cogs.created_by = p_user_id
    AND cogs.is_reversal = false
  WHERE s.created_by = p_user_id
    AND DATE(s.order_date AT TIME ZONE 'Asia/Bangkok') BETWEEN p_start_date AND p_end_date
    AND s.platform_status NOT IN ('Cancelled', 'Refunded')
  GROUP BY
    DATE(s.order_date AT TIME ZONE 'Asia/Bangkok'),
    s.source_platform,
    CASE
      WHEN oa.attribution_type = 'internal_affiliate' THEN 'internal_affiliate'
      WHEN oa.attribution_type = 'external_affiliate' THEN 'external_affiliate'
      WHEN oa.attribution_type = 'paid_ads' THEN 'paid_ads'
      ELSE 'organic'
    END
  ON CONFLICT (created_by, date, platform, source_bucket)
  DO UPDATE SET
    gmv = EXCLUDED.gmv,
    orders = EXCLUDED.orders,
    cost = EXCLUDED.cost,
    profit = EXCLUDED.profit,
    updated_at = NOW();

  RETURN v_rows_affected;
END;
$$;

-- ============================================
-- UPDATE COMMENT
-- ============================================

COMMENT ON FUNCTION rebuild_profit_summaries IS 'Rebuild all 3 profit summary tables for a date range (fixed duplicate key issue)';

-- ============================================
-- END OF MIGRATION 039
-- ============================================
