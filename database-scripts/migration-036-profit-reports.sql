-- ============================================
-- Migration 036: Profit Reports (D1 Suite)
-- Purpose: Affiliate Attribution + Pre-aggregated Profit Summary Tables
-- Date: 2026-01-30
-- ============================================

-- ============================================
-- A) AFFILIATE CHANNELS (CONFIG TABLE)
-- ============================================

CREATE TABLE IF NOT EXISTS public.affiliate_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_channel_id VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('internal', 'external')),
    commission_pct DECIMAL(5, 2),
    is_active BOOLEAN DEFAULT true,
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_affiliate_channels_created_by
ON affiliate_channels(created_by);

CREATE INDEX IF NOT EXISTS idx_affiliate_channels_type
ON affiliate_channels(type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_channels_id_user
ON affiliate_channels(created_by, affiliate_channel_id);

-- RLS Policies
ALTER TABLE affiliate_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own affiliate channels" ON affiliate_channels;
CREATE POLICY "Users can view own affiliate channels"
ON affiliate_channels
FOR SELECT
USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can insert own affiliate channels" ON affiliate_channels;
CREATE POLICY "Users can insert own affiliate channels"
ON affiliate_channels
FOR INSERT
WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can update own affiliate channels" ON affiliate_channels;
CREATE POLICY "Users can update own affiliate channels"
ON affiliate_channels
FOR UPDATE
USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can delete own affiliate channels" ON affiliate_channels;
CREATE POLICY "Users can delete own affiliate channels"
ON affiliate_channels
FOR DELETE
USING (auth.uid() = created_by);

-- ============================================
-- B) ORDER ATTRIBUTION (OVERLAY TABLE)
-- ============================================

CREATE TABLE IF NOT EXISTS public.order_attribution (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id VARCHAR(255) NOT NULL,
    attribution_type VARCHAR(50) NOT NULL CHECK (attribution_type IN ('internal_affiliate', 'external_affiliate', 'paid_ads', 'organic')),
    affiliate_channel_id VARCHAR(50),
    commission_amt DECIMAL(12, 2),
    commission_pct DECIMAL(5, 2),
    source_report VARCHAR(100),
    confidence_level VARCHAR(20) DEFAULT 'high' CHECK (confidence_level IN ('high', 'inferred')),
    import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_order_attribution_order_id
ON order_attribution(order_id);

CREATE INDEX IF NOT EXISTS idx_order_attribution_channel
ON order_attribution(affiliate_channel_id);

CREATE INDEX IF NOT EXISTS idx_order_attribution_type
ON order_attribution(attribution_type);

CREATE INDEX IF NOT EXISTS idx_order_attribution_created_by
ON order_attribution(created_by);

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_attribution_unique
ON order_attribution(created_by, order_id);

-- RLS Policies
ALTER TABLE order_attribution ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own order attribution" ON order_attribution;
CREATE POLICY "Users can view own order attribution"
ON order_attribution
FOR SELECT
USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can insert own order attribution" ON order_attribution;
CREATE POLICY "Users can insert own order attribution"
ON order_attribution
FOR INSERT
WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can update own order attribution" ON order_attribution;
CREATE POLICY "Users can update own order attribution"
ON order_attribution
FOR UPDATE
USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can delete own order attribution" ON order_attribution;
CREATE POLICY "Users can delete own order attribution"
ON order_attribution
FOR DELETE
USING (auth.uid() = created_by);

-- ============================================
-- C) PLATFORM NET PROFIT DAILY (SUMMARY TABLE)
-- ============================================

CREATE TABLE IF NOT EXISTS public.platform_net_profit_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    platform VARCHAR(50) NOT NULL,

    -- Revenue components
    gmv DECIMAL(14, 2) NOT NULL DEFAULT 0,
    platform_fees DECIMAL(14, 2) NOT NULL DEFAULT 0,
    commission DECIMAL(14, 2) NOT NULL DEFAULT 0,
    shipping_cost DECIMAL(14, 2) NOT NULL DEFAULT 0,
    program_fees DECIMAL(14, 2) NOT NULL DEFAULT 0,

    -- Cost components
    ads_spend DECIMAL(14, 2) NOT NULL DEFAULT 0,
    cogs DECIMAL(14, 2) NOT NULL DEFAULT 0,

    -- Calculated
    net_profit DECIMAL(14, 2) NOT NULL DEFAULT 0,

    -- Metadata
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(created_by, date, platform)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_platform_net_profit_date
ON platform_net_profit_daily(date DESC);

CREATE INDEX IF NOT EXISTS idx_platform_net_profit_platform
ON platform_net_profit_daily(platform);

CREATE INDEX IF NOT EXISTS idx_platform_net_profit_user_date
ON platform_net_profit_daily(created_by, date DESC);

CREATE INDEX IF NOT EXISTS idx_platform_net_profit_user_date_platform
ON platform_net_profit_daily(created_by, date DESC, platform);

-- RLS Policies
ALTER TABLE platform_net_profit_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own platform profit" ON platform_net_profit_daily;
CREATE POLICY "Users can view own platform profit"
ON platform_net_profit_daily
FOR SELECT
USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can insert own platform profit" ON platform_net_profit_daily;
CREATE POLICY "Users can insert own platform profit"
ON platform_net_profit_daily
FOR INSERT
WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can update own platform profit" ON platform_net_profit_daily;
CREATE POLICY "Users can update own platform profit"
ON platform_net_profit_daily
FOR UPDATE
USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can delete own platform profit" ON platform_net_profit_daily;
CREATE POLICY "Users can delete own platform profit"
ON platform_net_profit_daily
FOR DELETE
USING (auth.uid() = created_by);

-- ============================================
-- D) PRODUCT PROFIT DAILY (SUMMARY TABLE)
-- ============================================

CREATE TABLE IF NOT EXISTS public.product_profit_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    platform VARCHAR(50) NOT NULL,
    product_id VARCHAR(100),
    product_name VARCHAR(255),

    -- Metrics
    revenue DECIMAL(14, 2) NOT NULL DEFAULT 0,
    allocated_ads DECIMAL(14, 2) NOT NULL DEFAULT 0,
    cogs DECIMAL(14, 2) NOT NULL DEFAULT 0,
    margin DECIMAL(14, 2) NOT NULL DEFAULT 0,
    margin_pct DECIMAL(5, 2),

    -- Metadata
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(created_by, date, platform, product_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_product_profit_date
ON product_profit_daily(date DESC);

CREATE INDEX IF NOT EXISTS idx_product_profit_platform
ON product_profit_daily(platform);

CREATE INDEX IF NOT EXISTS idx_product_profit_product
ON product_profit_daily(product_id);

CREATE INDEX IF NOT EXISTS idx_product_profit_user_date_platform
ON product_profit_daily(created_by, date DESC, platform);

-- RLS Policies
ALTER TABLE product_profit_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own product profit" ON product_profit_daily;
CREATE POLICY "Users can view own product profit"
ON product_profit_daily
FOR SELECT
USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can insert own product profit" ON product_profit_daily;
CREATE POLICY "Users can insert own product profit"
ON product_profit_daily
FOR INSERT
WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can update own product profit" ON product_profit_daily;
CREATE POLICY "Users can update own product profit"
ON product_profit_daily
FOR UPDATE
USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can delete own product profit" ON product_profit_daily;
CREATE POLICY "Users can delete own product profit"
ON product_profit_daily
FOR DELETE
USING (auth.uid() = created_by);

-- ============================================
-- E) SOURCE SPLIT DAILY (SUMMARY TABLE)
-- ============================================

CREATE TABLE IF NOT EXISTS public.source_split_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    platform VARCHAR(50) NOT NULL,
    source_bucket VARCHAR(50) NOT NULL,

    -- Metrics
    gmv DECIMAL(14, 2) NOT NULL DEFAULT 0,
    orders INTEGER NOT NULL DEFAULT 0,
    cost DECIMAL(14, 2) NOT NULL DEFAULT 0,
    profit DECIMAL(14, 2) NOT NULL DEFAULT 0,

    -- Metadata
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(created_by, date, platform, source_bucket)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_source_split_date
ON source_split_daily(date DESC);

CREATE INDEX IF NOT EXISTS idx_source_split_platform
ON source_split_daily(platform);

CREATE INDEX IF NOT EXISTS idx_source_split_bucket
ON source_split_daily(source_bucket);

CREATE INDEX IF NOT EXISTS idx_source_split_user_date_platform
ON source_split_daily(created_by, date DESC, platform);

-- RLS Policies
ALTER TABLE source_split_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own source split" ON source_split_daily;
CREATE POLICY "Users can view own source split"
ON source_split_daily
FOR SELECT
USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can insert own source split" ON source_split_daily;
CREATE POLICY "Users can insert own source split"
ON source_split_daily
FOR INSERT
WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can update own source split" ON source_split_daily;
CREATE POLICY "Users can update own source split"
ON source_split_daily
FOR UPDATE
USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can delete own source split" ON source_split_daily;
CREATE POLICY "Users can delete own source split"
ON source_split_daily
FOR DELETE
USING (auth.uid() = created_by);

-- ============================================
-- F) HELPER FUNCTION: REBUILD PROFIT SUMMARIES
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
  GROUP BY DATE(s.order_date AT TIME ZONE 'Asia/Bangkok'), s.source_platform;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  -- ============================================
  -- 3) REBUILD product_profit_daily
  -- ============================================

  INSERT INTO product_profit_daily (
    date, platform, product_id, product_name, revenue, allocated_ads, cogs, margin, margin_pct, created_by
  )
  WITH product_revenue AS (
    SELECT
      DATE(s.order_date AT TIME ZONE 'Asia/Bangkok') as date,
      COALESCE(s.source_platform, 'unknown') as platform,
      COALESCE(s.seller_sku, s.product_name) as product_id,
      s.product_name,
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
      COALESCE(s.seller_sku, s.product_name),
      s.product_name
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
  LEFT JOIN daily_ads da ON pr.date = da.date AND pr.platform = da.platform;

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
    END;

  RETURN v_rows_affected;
END;
$$;

-- ============================================
-- G) COMMENTS
-- ============================================

COMMENT ON TABLE affiliate_channels IS 'Affiliate channel configuration for attribution (internal/external partners)';
COMMENT ON TABLE order_attribution IS 'Order-level attribution overlay (affiliate, paid ads, organic)';
COMMENT ON TABLE platform_net_profit_daily IS 'Pre-aggregated daily platform net profit (D1-D report)';
COMMENT ON TABLE product_profit_daily IS 'Pre-aggregated daily product-level profit (D1-B report)';
COMMENT ON TABLE source_split_daily IS 'Pre-aggregated daily source split (D1-C report)';
COMMENT ON FUNCTION rebuild_profit_summaries IS 'Rebuild all 3 profit summary tables for a date range';

-- ============================================
-- END OF MIGRATION 036
-- ============================================
