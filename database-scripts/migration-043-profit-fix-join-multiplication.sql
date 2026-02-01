-- ============================================
-- Migration 043: Profit Reports - Fix Join Multiplication + Order-Level Fields
-- Purpose: Fix ads/COGS join multiplication + add order-level columns from TikTok OrderSKUList
-- Date: 2026-02-02
--
-- Issues Fixed:
-- 1. Ads spend join multiplication: ad_daily_performance has multiple rows → multiplies spend
-- 2. COGS join multiplication: inventory_cogs_allocations has multiple rows → multiplies COGS
-- 3. Missing order-level columns: Order Amount, Shipping Fee, Taxes, Small Order Fee
-- 4. GMV should use order_amount (order-level), not total_amount (SKU-level)
--
-- Solution:
-- 1. Add order-level columns to sales_orders (if not exists)
-- 2. Update sales_orders_order_rollup view to use COALESCE(order_amount, total_amount)
-- 3. Fix rebuild_profit_summaries() to pre-aggregate ads and COGS before joining
-- ============================================

-- ============================================
-- 1) ADD ORDER-LEVEL COLUMNS TO sales_orders
-- ============================================

DO $$
BEGIN
  -- Order Amount (order-level total from TikTok)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_orders'
      AND column_name = 'order_amount'
  ) THEN
    ALTER TABLE public.sales_orders ADD COLUMN order_amount NUMERIC(10,2);
    COMMENT ON COLUMN public.sales_orders.order_amount IS 'Order-level total amount (from TikTok Order Amount column). Use this for GMV, not total_amount (SKU-level).';
  END IF;

  -- Shipping Fee After Discount
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_orders'
      AND column_name = 'shipping_fee_after_discount'
  ) THEN
    ALTER TABLE public.sales_orders ADD COLUMN shipping_fee_after_discount NUMERIC(10,2);
  END IF;

  -- Original Shipping Fee
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_orders'
      AND column_name = 'original_shipping_fee'
  ) THEN
    ALTER TABLE public.sales_orders ADD COLUMN original_shipping_fee NUMERIC(10,2);
  END IF;

  -- Shipping Fee Seller Discount
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_orders'
      AND column_name = 'shipping_fee_seller_discount'
  ) THEN
    ALTER TABLE public.sales_orders ADD COLUMN shipping_fee_seller_discount NUMERIC(10,2);
  END IF;

  -- Shipping Fee Platform Discount
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_orders'
      AND column_name = 'shipping_fee_platform_discount'
  ) THEN
    ALTER TABLE public.sales_orders ADD COLUMN shipping_fee_platform_discount NUMERIC(10,2);
  END IF;

  -- Payment Platform Discount
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_orders'
      AND column_name = 'payment_platform_discount'
  ) THEN
    ALTER TABLE public.sales_orders ADD COLUMN payment_platform_discount NUMERIC(10,2);
  END IF;

  -- Taxes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_orders'
      AND column_name = 'taxes'
  ) THEN
    ALTER TABLE public.sales_orders ADD COLUMN taxes NUMERIC(10,2);
  END IF;

  -- Small Order Fee
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_orders'
      AND column_name = 'small_order_fee'
  ) THEN
    ALTER TABLE public.sales_orders ADD COLUMN small_order_fee NUMERIC(10,2);
  END IF;
END $$;

-- ============================================
-- 2) UPDATE sales_orders_order_rollup VIEW
-- ============================================
-- FIX: Use 2-layer CTE to avoid GROUP BY issues with CASE expressions

CREATE OR REPLACE VIEW public.sales_orders_order_rollup AS
WITH base AS (
  -- Layer 1: Aggregate by raw source_platform value
  SELECT
    created_by,
    order_id,
    DATE(order_date AT TIME ZONE 'Asia/Bangkok') as order_date_bkk,
    COALESCE(source_platform, '') as sp,
    COALESCE(MAX(order_amount), MAX(total_amount)) as order_amount,
    MAX(platform_status) as platform_status,
    MIN(order_date) as order_date_earliest
  FROM sales_orders
  GROUP BY
    created_by,
    order_id,
    DATE(order_date AT TIME ZONE 'Asia/Bangkok'),
    COALESCE(source_platform, '')
)
-- Layer 2: Apply platform normalization (no re-aggregation)
SELECT
  created_by,
  order_id,
  order_date_bkk,

  -- Platform raw (restore 'unknown' for empty string)
  CASE WHEN sp = '' THEN 'unknown' ELSE sp END as platform_raw,

  -- Platform normalization for ads join
  CASE
    WHEN sp ILIKE '%tiktok%' THEN 'tiktok'
    WHEN sp ILIKE '%shopee%' THEN 'shopee'
    WHEN sp ILIKE '%lazada%' THEN 'lazada'
    WHEN sp = '' THEN 'unknown'
    ELSE LOWER(REGEXP_REPLACE(sp, '\s+', '', 'g'))
  END as platform_key,

  order_amount,
  platform_status,
  order_date_earliest
FROM base;

COMMENT ON VIEW public.sales_orders_order_rollup IS
'Order-level rollup view (1 row per order_id) with normalized platform_key for ads join.
GMV = COALESCE(MAX(order_amount), MAX(total_amount)) - prioritizes order_amount for accurate order-level aggregation.
Handles SKU-level import duplicates safely. Uses 2-layer CTE for proper GROUP BY handling.';

-- ============================================
-- 3) FIX rebuild_profit_summaries() WITH PRE-AGGREGATED CTEs
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
  -- FIX: Pre-aggregate ads and COGS to avoid join multiplication

  INSERT INTO platform_net_profit_daily (
    date, platform, gmv, ads_spend, cogs, net_profit, created_by
  )
  WITH daily_ads AS (
    -- Pre-aggregate ads to daily level (CRITICAL: prevents multiplication)
    SELECT
      created_by,
      ad_date as date,
      marketplace as platform,
      SUM(spend) as spend
    FROM ad_daily_performance
    WHERE created_by = p_user_id
      AND ad_date BETWEEN p_start_date AND p_end_date
      AND campaign_type != 'live'
    GROUP BY created_by, ad_date, marketplace
  ),
  cogs_by_order AS (
    -- Pre-aggregate COGS to order level (CRITICAL: prevents multiplication)
    SELECT
      created_by,
      order_id,
      SUM(amount) as cogs
    FROM inventory_cogs_allocations
    WHERE created_by = p_user_id
      AND is_reversal = false
    GROUP BY created_by, order_id
  )
  SELECT
    s.order_date_bkk as date,
    s.platform_key as platform,
    SUM(s.order_amount) as gmv,
    COALESCE(SUM(ads.spend), 0) as ads_spend,
    COALESCE(SUM(cogs.cogs), 0) as cogs,
    SUM(s.order_amount) - COALESCE(SUM(ads.spend), 0) - COALESCE(SUM(cogs.cogs), 0) as net_profit,
    p_user_id
  FROM sales_orders_order_rollup s
  LEFT JOIN daily_ads ads
    ON ads.date = s.order_date_bkk
    AND ads.platform = s.platform_key
    AND ads.created_by = p_user_id
  LEFT JOIN cogs_by_order cogs
    ON cogs.order_id = s.order_id
    AND cogs.created_by = p_user_id
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
  -- FIX: Pre-aggregate ads and use cogs_by_sku to avoid multiplication

  INSERT INTO product_profit_daily (
    date, platform, product_id, product_name, revenue, allocated_ads, cogs, margin, margin_pct, created_by
  )
  WITH product_revenue AS (
    SELECT
      DATE(s.order_date AT TIME ZONE 'Asia/Bangkok') as date,
      CASE
        WHEN COALESCE(s.source_platform, '') ILIKE '%tiktok%' THEN 'tiktok'
        WHEN COALESCE(s.source_platform, '') ILIKE '%shopee%' THEN 'shopee'
        WHEN COALESCE(s.source_platform, '') ILIKE '%lazada%' THEN 'lazada'
        WHEN COALESCE(s.source_platform, '') = '' THEN 'unknown'
        ELSE LOWER(REGEXP_REPLACE(COALESCE(s.source_platform, 'unknown'), '\s+', '', 'g'))
      END as platform,
      COALESCE(s.seller_sku, s.product_name) as product_id,
      MAX(s.product_name) as product_name,
      SUM(s.total_amount) as revenue  -- SKU-level revenue (correct for product breakdown)
    FROM sales_orders s
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
  cogs_by_sku AS (
    -- Aggregate COGS per SKU (join back to sales_orders to get SKU)
    SELECT
      DATE(s.order_date AT TIME ZONE 'Asia/Bangkok') as date,
      CASE
        WHEN COALESCE(s.source_platform, '') ILIKE '%tiktok%' THEN 'tiktok'
        WHEN COALESCE(s.source_platform, '') ILIKE '%shopee%' THEN 'shopee'
        WHEN COALESCE(s.source_platform, '') ILIKE '%lazada%' THEN 'lazada'
        WHEN COALESCE(s.source_platform, '') = '' THEN 'unknown'
        ELSE LOWER(REGEXP_REPLACE(COALESCE(s.source_platform, 'unknown'), '\s+', '', 'g'))
      END as platform,
      COALESCE(s.seller_sku, s.product_name) as product_id,
      SUM(c.amount) as cogs
    FROM inventory_cogs_allocations c
    JOIN sales_orders s ON s.order_id = c.order_id AND s.created_by = c.created_by
    WHERE c.created_by = p_user_id
      AND c.is_reversal = false
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
    -- Allocate ads spend proportionally by revenue share
    CASE
      WHEN drt.total_revenue > 0 THEN (pr.revenue / drt.total_revenue) * COALESCE(da.total_spend, 0)
      ELSE 0
    END as allocated_ads,
    COALESCE(cogs.cogs, 0) as cogs,
    pr.revenue -
      CASE
        WHEN drt.total_revenue > 0 THEN (pr.revenue / drt.total_revenue) * COALESCE(da.total_spend, 0)
        ELSE 0
      END - COALESCE(cogs.cogs, 0) as margin,
    CASE
      WHEN pr.revenue > 0 THEN
        ((pr.revenue -
          CASE
            WHEN drt.total_revenue > 0 THEN (pr.revenue / drt.total_revenue) * COALESCE(da.total_spend, 0)
            ELSE 0
          END - COALESCE(cogs.cogs, 0)) / pr.revenue) * 100
      ELSE NULL
    END as margin_pct,
    p_user_id
  FROM product_revenue pr
  LEFT JOIN daily_revenue_totals drt ON pr.date = drt.date AND pr.platform = drt.platform
  LEFT JOIN daily_ads da ON pr.date = da.date AND pr.platform = da.platform
  LEFT JOIN cogs_by_sku cogs ON pr.date = cogs.date AND pr.platform = cogs.platform AND pr.product_id = cogs.product_id
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
  -- FIX: Use pre-aggregated COGS

  INSERT INTO source_split_daily (
    date, platform, source_bucket, gmv, orders, cost, profit, created_by
  )
  WITH cogs_by_order AS (
    SELECT
      created_by,
      order_id,
      SUM(amount) as cogs
    FROM inventory_cogs_allocations
    WHERE created_by = p_user_id
      AND is_reversal = false
    GROUP BY created_by, order_id
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
    SUM(s.order_amount) as gmv,
    COUNT(DISTINCT s.order_id) as orders,
    COALESCE(SUM(oa.commission_amt), 0) as cost,
    SUM(s.order_amount) - COALESCE(SUM(oa.commission_amt), 0) - COALESCE(SUM(cogs.cogs), 0) as profit,
    p_user_id
  FROM sales_orders_order_rollup s
  LEFT JOIN order_attribution oa
    ON oa.order_id = s.order_id
    AND oa.created_by = p_user_id
  LEFT JOIN cogs_by_order cogs
    ON cogs.order_id = s.order_id
    AND cogs.created_by = p_user_id
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
Fixes: GMV inflation from SKU duplicates, ads join platform mismatch, ads/COGS join multiplication.
Uses pre-aggregated CTEs for ads and COGS to ensure 1:1 joins with no multiplication.';

-- ============================================
-- SANITY QUERIES (For QA Manual Testing)
-- ============================================

/*
-- 1. Verify rollup view GMV matches manual calculation
-- Replace YOUR_USER_ID with actual UUID
-- Replace date range as needed

WITH manual_gmv AS (
  SELECT SUM(order_gmv) as expected_gmv
  FROM (
    SELECT
      order_id,
      COALESCE(MAX(order_amount), MAX(total_amount)) as order_gmv
    FROM sales_orders
    WHERE created_by = 'YOUR_USER_ID'
      AND DATE(order_date AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
      AND platform_status NOT IN ('Cancelled', 'Refunded')
    GROUP BY order_id
  ) t
),
rollup_gmv AS (
  SELECT SUM(order_amount) as rollup_gmv
  FROM sales_orders_order_rollup
  WHERE created_by = 'YOUR_USER_ID'
    AND order_date_bkk BETWEEN '2026-01-01' AND '2026-01-31'
    AND platform_status NOT IN ('Cancelled', 'Refunded')
)
SELECT
  m.expected_gmv,
  r.rollup_gmv,
  CASE
    WHEN ABS(m.expected_gmv - r.rollup_gmv) < 0.01 THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as test_result
FROM manual_gmv m, rollup_gmv r;

-- Expected: expected_gmv = rollup_gmv (within 0.01 rounding error)


-- 2. Verify ads spend sum (no multiplication)
-- Should match between source table and summary table

WITH ads_source AS (
  SELECT
    marketplace,
    SUM(spend) as source_ads_spend
  FROM ad_daily_performance
  WHERE created_by = 'YOUR_USER_ID'
    AND ad_date BETWEEN '2026-01-01' AND '2026-01-31'
    AND campaign_type != 'live'
  GROUP BY marketplace
),
ads_summary AS (
  SELECT
    platform,
    SUM(ads_spend) as summary_ads_spend
  FROM platform_net_profit_daily
  WHERE created_by = 'YOUR_USER_ID'
    AND date BETWEEN '2026-01-01' AND '2026-01-31'
  GROUP BY platform
)
SELECT
  COALESCE(src.marketplace, summ.platform) as platform,
  src.source_ads_spend,
  summ.summary_ads_spend,
  CASE
    WHEN ABS(COALESCE(src.source_ads_spend, 0) - COALESCE(summ.summary_ads_spend, 0)) < 0.01 THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as test_result
FROM ads_source src
FULL OUTER JOIN ads_summary summ ON src.marketplace = summ.platform;

-- Expected: source_ads_spend = summary_ads_spend for each platform


-- 3. Verify COGS sum (no multiplication)

WITH cogs_source AS (
  SELECT SUM(amount) as source_cogs
  FROM inventory_cogs_allocations
  WHERE created_by = 'YOUR_USER_ID'
    AND is_reversal = false
    AND order_id IN (
      SELECT order_id
      FROM sales_orders
      WHERE created_by = 'YOUR_USER_ID'
        AND DATE(order_date AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
        AND platform_status NOT IN ('Cancelled', 'Refunded')
    )
),
cogs_summary AS (
  SELECT SUM(cogs) as summary_cogs
  FROM platform_net_profit_daily
  WHERE created_by = 'YOUR_USER_ID'
    AND date BETWEEN '2026-01-01' AND '2026-01-31'
)
SELECT
  src.source_cogs,
  summ.summary_cogs,
  CASE
    WHEN ABS(src.source_cogs - summ.summary_cogs) < 0.01 THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as test_result
FROM cogs_source src, cogs_summary summ;

-- Expected: source_cogs = summary_cogs


-- 4. Verify order_amount column populated (after re-import)

SELECT
  COUNT(*) as total_rows,
  COUNT(order_amount) as with_order_amount,
  COUNT(order_amount) * 100.0 / COUNT(*) as populate_pct
FROM sales_orders
WHERE created_by = 'YOUR_USER_ID'
  AND DATE(order_date AT TIME ZONE 'Asia/Bangkok') BETWEEN '2026-01-01' AND '2026-01-31'
  AND source_platform ILIKE '%tiktok%';

-- Expected: populate_pct > 90% (after re-import)
-- If 0%, need to re-import TikTok OrderSKUList
*/

-- ============================================
-- END OF MIGRATION 043
-- ============================================
