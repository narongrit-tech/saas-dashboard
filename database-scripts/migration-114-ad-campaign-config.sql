-- migration-114: ad_campaign_config table
-- Purpose: Classify TikTok ad campaigns for P&L inclusion.
-- Bot imports all campaigns as 'unclassified'; user tags them via saas-dashboard UI.
-- P&L queries JOIN this table filtering include_in_pnl = true.

CREATE TABLE IF NOT EXISTS ad_campaign_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  marketplace       TEXT NOT NULL DEFAULT 'tiktok',
  campaign_id       TEXT NOT NULL,          -- TikTok campaign ID (from ad_daily_performance)
  campaign_name     TEXT,                   -- Display name (synced from import, may be null)
  campaign_type     TEXT,                   -- 'product' | 'live' (from import)
  label             TEXT,                   -- User-defined label (e.g. 'ยาสีฟัน', 'นายหน้า')
  include_in_pnl    BOOLEAN NOT NULL DEFAULT false,  -- false = excluded until user classifies

  UNIQUE (created_by, marketplace, campaign_id)
);

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION update_ad_campaign_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER ad_campaign_config_updated_at
  BEFORE UPDATE ON ad_campaign_config
  FOR EACH ROW EXECUTE FUNCTION update_ad_campaign_config_updated_at();

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_ad_campaign_config_created_by      ON ad_campaign_config (created_by);
CREATE INDEX IF NOT EXISTS idx_ad_campaign_config_campaign_id      ON ad_campaign_config (campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_campaign_config_include_in_pnl  ON ad_campaign_config (created_by, include_in_pnl);
CREATE INDEX IF NOT EXISTS idx_ad_campaign_config_marketplace      ON ad_campaign_config (marketplace, campaign_id);

-- RLS: users see and manage only their own campaign configs
ALTER TABLE ad_campaign_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own campaign configs"
  ON ad_campaign_config
  FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- View: campaigns not yet classified (for LINE alert + UI badge count)
CREATE OR REPLACE VIEW unclassified_campaigns AS
SELECT
  adp.created_by,
  adp.marketplace,
  adp.campaign_id,
  adp.campaign_name,
  adp.campaign_type,
  MAX(adp.ad_date)  AS last_seen_date,
  SUM(adp.spend)    AS total_spend,
  SUM(adp.revenue)  AS total_revenue,
  SUM(adp.orders)   AS total_orders
FROM ad_daily_performance adp
LEFT JOIN ad_campaign_config cfg
  ON cfg.created_by   = adp.created_by
 AND cfg.marketplace  = adp.marketplace
 AND cfg.campaign_id  = adp.campaign_id
WHERE cfg.id IS NULL
  AND adp.campaign_id IS NOT NULL
  AND adp.campaign_id <> ''
GROUP BY adp.created_by, adp.marketplace, adp.campaign_id, adp.campaign_name, adp.campaign_type;

COMMENT ON TABLE  ad_campaign_config IS 'User classification of TikTok ad campaigns for P&L inclusion';
COMMENT ON COLUMN ad_campaign_config.include_in_pnl IS 'Only campaigns with include_in_pnl=true are counted in P&L ad spend';
COMMENT ON COLUMN ad_campaign_config.label IS 'User-defined product/business label (e.g. ยาสีฟัน, นายหน้า)';
