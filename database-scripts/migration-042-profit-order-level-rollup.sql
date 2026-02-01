-- ============================================
-- Migration 042: Profit Reports Order-Level Rollup
-- Purpose: Fix GMV inflation from SKU-level duplication + platform mapping for ads join
-- Date: 2026-02-01
--
-- Root Cause:
-- 1. TikTok OrderSKUList imports create multiple rows per order_id (SKU-level)
-- 2. sales_orders has duplicate order_id with varying total_amount per SKU
-- 3. Current rebuild aggregates SUM(total_amount) across all SKU rows → inflated GMV
-- 4. Ads join fails: source_platform="TikTok Shop" != ad_daily_performance.marketplace="tiktok"
--
-- Solution:
-- 1. Create view sales_orders_order_rollup: order-level rollup with normalized platform_key
-- 2. Update rebuild_profit_summaries() to use rollup view for order-level aggregation
-- 3. Ensure ads join uses normalized platform_key
-- ============================================

-- ============================================
-- 1) CREATE ORDER-LEVEL ROLLUP VIEW
-- ============================================

CREATE OR REPLACE VIEW public.sales_orders_order_rollup AS
SELECT
  -- User isolation
  created_by,

  -- Order identity
  order_id,

  -- Date (Bangkok timezone, date-only)
  DATE(order_date AT TIME ZONE 'Asia/Bangkok') as order_date_bkk,

  -- Platform (raw + normalized key)
  COALESCE(source_platform, 'unknown') as platform_raw,

  -- Platform normalization for ads join
  CASE
    WHEN COALESCE(source_platform, '') ILIKE '%tiktok%' THEN 'tiktok'
    WHEN COALESCE(source_platform, '') ILIKE '%shopee%' THEN 'shopee'
    WHEN COALESCE(source_platform, '') ILIKE '%lazada%' THEN 'lazada'
    WHEN COALESCE(source_platform, '') = '' THEN 'unknown'
    ELSE LOWER(REGEXP_REPLACE(COALESCE(source_platform, 'unknown'), '\s+', '', 'g'))
  END as platform_key,

  -- Order amount (MAX per order_id to handle SKU-level duplicates)
  MAX(total_amount) as order_amount,

  -- Platform status (MAX - assume consistent per order_id)
  MAX(platform_status) as platform_status,

  -- Order date (min timestamp for reference)
  MIN(order_date) as order_date_earliest

FROM sales_orders
GROUP BY
  created_by,
  order_id,
  DATE(order_date AT TIME ZONE 'Asia/Bangkok'),
  COALESCE(source_platform, 'unknown');

COMMENT ON VIEW public.sales_orders_order_rollup IS
'Order-level rollup view (1 row per order_id) with normalized platform_key for ads join.
GMV = MAX(total_amount) per order to handle SKU-level import duplicates.';

-- ============================================
-- 2) RECREATE rebuild_profit_summaries() WITH ORDER-LEVEL ROLLUP
-- ============================================

CREATE OR REPLACE FUNCTION public.rebuild_profit_summaries(
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
  -- 2) REBUILD platform_net_profit_daily (ORDER-LEVEL)
  -- ============================================
  -- FIX: Use sales_orders_order_rollup for order-level GMV
  -- FIX: Use platform_key for ads join

  INSERT INTO platform_net_profit_daily (
    date, platform, gmv, ads_spend, cogs, net_profit, created_by
  )
  SELECT
    s.order_date_bkk as date,
    s.platform_key as platform,
    SUM(s.order_amount) as gmv,  -- ORDER-LEVEL: SUM of MAX(total_amount) per order
    COALESCE(SUM(ads.spend), 0) as ads_spend,
    COALESCE(SUM(cogs.amount), 0) as cogs,
    SUM(s.order_amount) - COALESCE(SUM(ads.spend), 0) - COALESCE(SUM(cogs.amount), 0) as net_profit,
    p_user_id
  FROM sales_orders_order_rollup s
  LEFT JOIN ad_daily_performance ads
    ON ads.ad_date = s.order_date_bkk
    AND ads.marketplace = s.platform_key  -- FIX: Use normalized platform_key
    AND ads.created_by = p_user_id
    AND ads.campaign_type != 'live'  -- Exclude live ads (not product-attributed)
  LEFT JOIN inventory_cogs_allocations cogs
    ON cogs.order_id = s.order_id
    AND cogs.created_by = p_user_id
    AND cogs.is_reversal = false
  WHERE s.created_by = p_user_id
    AND s.order_date_bkk BETWEEN p_start_date AND p_end_date
    AND s.platform_status NOT IN ('Cancelled', 'Refunded')
  GROUP BY s.order_date_bkk, s.platform_key
  ON CONFLICT (created_by, date, platform)
  DO UPDATE SET
    gmv = EXCLUDED.gmv,
    ads_spend = EXCLUDED.ads_spend,
    cogs = EXCLUDED.cogs,
    net_profit = EXCLUDED.net_profit,
    updated_at = NOW();

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  -- ============================================
  -- 3) REBUILD product_profit_daily (SKU-LEVEL REVENUE)
  -- ============================================
  -- KEEP: SKU-level revenue (from sales_orders directly)
  -- FIX: Use normalized platform_key for ads allocation
  -- FIX: Ensure unique keys (created_by, date, platform, product_id)

  INSERT INTO product_profit_daily (
    date, platform, product_id, product_name, revenue, allocated_ads, cogs, margin, margin_pct, created_by
  )
  WITH product_revenue AS (
    SELECT
      DATE(s.order_date AT TIME ZONE 'Asia/Bangkok') as date,
      -- FIX: Use normalized platform_key (same logic as rollup view)
      CASE
        WHEN COALESCE(s.source_platform, '') ILIKE '%tiktok%' THEN 'tiktok'
        WHEN COALESCE(s.source_platform, '') ILIKE '%shopee%' THEN 'shopee'
        WHEN COALESCE(s.source_platform, '') ILIKE '%lazada%' THEN 'lazada'
        WHEN COALESCE(s.source_platform, '') = '' THEN 'unknown'
        ELSE LOWER(REGEXP_REPLACE(COALESCE(s.source_platform, 'unknown'), '\s+', '', 'g'))
      END as platform,
      COALESCE(s.seller_sku, s.product_name) as product_id,
      MAX(s.product_name) as product_name,  -- Use MAX for deterministic product name
      SUM(s.total_amount) as revenue,       -- SKU-level revenue (not order-level)
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
      CASE
        WHEN COALESCE(s.source_platform, '') ILIKE '%tiktok%' THEN 'tiktok'
        WHEN COALESCE(s.source_platform, '') ILIKE '%shopee%' THEN 'shopee'
        WHEN COALESCE(s.source_platform, '') ILIKE '%lazada%' THEN 'lazada'
        WHEN COALESCE(s.source_platform, '') = '' THEN 'unknown'
        ELSE LOWER(REGEXP_REPLACE(COALESCE(s.source_platform, 'unknown'), '\s+', '', 'g'))
      END,
      COALESCE(s.seller_sku, s.product_name)
  ),
  daily_ads AS (
    SELECT
      ad_date as date,
      marketplace as platform,  -- Already normalized (tiktok, shopee, etc)
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
    -- Allocate ads spend proportionally by revenue share
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
  -- 4) REBUILD source_split_daily (ORDER-LEVEL)
  -- ============================================
  -- FIX: Use sales_orders_order_rollup for order-level GMV/orders

  INSERT INTO source_split_daily (
    date, platform, source_bucket, gmv, orders, cost, profit, created_by
  )
  SELECT
    s.order_date_bkk as date,
    s.platform_key as platform,
    CASE
      WHEN oa.attribution_type = 'internal_affiliate' THEN 'internal_affiliate'
      WHEN oa.attribution_type = 'external_affiliate' THEN 'external_affiliate'
      WHEN oa.attribution_type = 'paid_ads' THEN 'paid_ads'
      ELSE 'organic'
    END as source_bucket,
    SUM(s.order_amount) as gmv,  -- ORDER-LEVEL
    COUNT(DISTINCT s.order_id) as orders,
    COALESCE(SUM(oa.commission_amt), 0) as cost,
    SUM(s.order_amount) - COALESCE(SUM(oa.commission_amt), 0) - COALESCE(SUM(cogs.amount), 0) as profit,
    p_user_id
  FROM sales_orders_order_rollup s
  LEFT JOIN order_attribution oa
    ON oa.order_id = s.order_id
    AND oa.created_by = p_user_id
  LEFT JOIN inventory_cogs_allocations cogs
    ON cogs.order_id = s.order_id
    AND cogs.created_by = p_user_id
    AND cogs.is_reversal = false
  WHERE s.created_by = p_user_id
    AND s.order_date_bkk BETWEEN p_start_date AND p_end_date
    AND s.platform_status NOT IN ('Cancelled', 'Refunded')
  GROUP BY
    s.order_date_bkk,
    s.platform_key,
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

COMMENT ON FUNCTION public.rebuild_profit_summaries IS
'Rebuild all 3 profit summary tables for date range using order-level rollup view.
Fixes: GMV inflation from SKU duplicates, ads join platform mismatch.';

-- ============================================
-- END OF MIGRATION 042
-- ============================================
