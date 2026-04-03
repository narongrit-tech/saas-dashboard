-- ============================================
-- Migration 094: TikTok Affiliate Content Attribution Foundation
-- Scope:
--   - module-local import batches
--   - append-only raw staging
--   - normalized content_order_facts
--   - normalization helper functions
--   - module-local normalization RPC
-- Notes:
--   - isolated from existing SaaS sales / finance / wallet / reconciliation tables
--   - no UI objects in this migration
-- ============================================

BEGIN;

-- ============================================
-- 1) MODULE-LOCAL IMPORT BATCHES
-- ============================================

CREATE TABLE IF NOT EXISTS public.tiktok_affiliate_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  source_platform TEXT NOT NULL DEFAULT 'tiktok_affiliate',
  source_report_type TEXT NOT NULL DEFAULT 'affiliate_orders',
  source_file_name TEXT NOT NULL,
  source_sheet_name TEXT NOT NULL DEFAULT 'Sheet1',
  source_file_hash TEXT,

  status TEXT NOT NULL DEFAULT 'processing' CHECK (
    status IN ('processing', 'staged', 'normalized', 'failed')
  ),
  raw_row_count INTEGER NOT NULL DEFAULT 0 CHECK (raw_row_count >= 0),
  staged_row_count INTEGER NOT NULL DEFAULT 0 CHECK (staged_row_count >= 0),
  normalized_row_count INTEGER NOT NULL DEFAULT 0 CHECK (normalized_row_count >= 0),
  skipped_row_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_row_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tiktok_affiliate_import_batches_created_by_date
  ON public.tiktok_affiliate_import_batches(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tiktok_affiliate_import_batches_status
  ON public.tiktok_affiliate_import_batches(created_by, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tiktok_affiliate_import_batches_file_hash
  ON public.tiktok_affiliate_import_batches(created_by, source_file_hash, created_at DESC)
  WHERE source_file_hash IS NOT NULL;

ALTER TABLE public.tiktok_affiliate_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tiktok_affiliate_import_batches_select ON public.tiktok_affiliate_import_batches;
CREATE POLICY tiktok_affiliate_import_batches_select
ON public.tiktok_affiliate_import_batches
FOR SELECT
TO authenticated
USING (created_by = auth.uid());

DROP POLICY IF EXISTS tiktok_affiliate_import_batches_insert ON public.tiktok_affiliate_import_batches;
CREATE POLICY tiktok_affiliate_import_batches_insert
ON public.tiktok_affiliate_import_batches
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tiktok_affiliate_import_batches_update ON public.tiktok_affiliate_import_batches;
CREATE POLICY tiktok_affiliate_import_batches_update
ON public.tiktok_affiliate_import_batches
FOR UPDATE
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tiktok_affiliate_import_batches_delete ON public.tiktok_affiliate_import_batches;
CREATE POLICY tiktok_affiliate_import_batches_delete
ON public.tiktok_affiliate_import_batches
FOR DELETE
TO authenticated
USING (created_by = auth.uid());

DROP TRIGGER IF EXISTS trg_tiktok_affiliate_import_batches_updated_at ON public.tiktok_affiliate_import_batches;
CREATE TRIGGER trg_tiktok_affiliate_import_batches_updated_at
BEFORE UPDATE ON public.tiktok_affiliate_import_batches
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.tiktok_affiliate_import_batches IS
'Module-local import batches for Content Ops / Content Attribution TikTok affiliate Excel imports.';

-- ============================================
-- 2) RAW STAGING
-- Grain:
--   1 row per raw Excel row
-- ============================================

CREATE TABLE IF NOT EXISTS public.tiktok_affiliate_order_raw_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_batch_id UUID NOT NULL REFERENCES public.tiktok_affiliate_import_batches(id) ON DELETE CASCADE,

  source_file_name TEXT NOT NULL,
  source_sheet_name TEXT NOT NULL,
  source_row_number INTEGER NOT NULL CHECK (source_row_number > 0),
  source_file_hash TEXT,

  order_id TEXT,
  sku_id TEXT,
  product_name TEXT,
  product_id TEXT,
  price_text TEXT,
  items_sold_text TEXT,
  items_refunded_text TEXT,
  shop_name TEXT,
  shop_code TEXT,
  affiliate_partner TEXT,
  agency TEXT,
  currency TEXT,
  order_type TEXT,
  order_settlement_status TEXT,
  indirect_flag TEXT,
  commission_type TEXT,
  content_type TEXT,
  content_id TEXT,
  standard_rate_text TEXT,
  shop_ads_rate_text TEXT,
  tiktok_bonus_rate_text TEXT,
  partner_bonus_rate_text TEXT,
  revenue_sharing_portion_rate_text TEXT,
  gmv_text TEXT,
  est_commission_base_text TEXT,
  est_standard_commission_text TEXT,
  est_shop_ads_commission_text TEXT,
  est_bonus_text TEXT,
  est_affiliate_partner_bonus_text TEXT,
  est_iva_text TEXT,
  est_isr_text TEXT,
  est_pit_text TEXT,
  est_revenue_sharing_portion_text TEXT,
  actual_commission_base_text TEXT,
  standard_commission_text TEXT,
  shop_ads_commission_text TEXT,
  bonus_text TEXT,
  affiliate_partner_bonus_text TEXT,
  tax_isr_text TEXT,
  tax_iva_text TEXT,
  tax_pit_text TEXT,
  shared_with_partner_text TEXT,
  total_final_earned_amount_text TEXT,
  order_date_text TEXT,
  commission_settlement_date_text TEXT,

  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT tiktok_affiliate_raw_row_identity_unique
    UNIQUE (created_by, import_batch_id, source_file_name, source_sheet_name, source_row_number)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_affiliate_raw_batch
  ON public.tiktok_affiliate_order_raw_staging(created_by, import_batch_id, source_row_number);

CREATE INDEX IF NOT EXISTS idx_tiktok_affiliate_raw_grain_keys
  ON public.tiktok_affiliate_order_raw_staging(created_by, order_id, sku_id, product_id, content_id);

CREATE INDEX IF NOT EXISTS idx_tiktok_affiliate_raw_created_at
  ON public.tiktok_affiliate_order_raw_staging(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tiktok_affiliate_raw_payload
  ON public.tiktok_affiliate_order_raw_staging USING gin(raw_payload);

ALTER TABLE public.tiktok_affiliate_order_raw_staging ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tiktok_affiliate_raw_select ON public.tiktok_affiliate_order_raw_staging;
CREATE POLICY tiktok_affiliate_raw_select
ON public.tiktok_affiliate_order_raw_staging
FOR SELECT
TO authenticated
USING (created_by = auth.uid());

DROP POLICY IF EXISTS tiktok_affiliate_raw_insert ON public.tiktok_affiliate_order_raw_staging;
CREATE POLICY tiktok_affiliate_raw_insert
ON public.tiktok_affiliate_order_raw_staging
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tiktok_affiliate_raw_update ON public.tiktok_affiliate_order_raw_staging;
DROP POLICY IF EXISTS tiktok_affiliate_raw_delete ON public.tiktok_affiliate_order_raw_staging;

DROP TRIGGER IF EXISTS trg_tiktok_affiliate_raw_updated_at ON public.tiktok_affiliate_order_raw_staging;

COMMENT ON TABLE public.tiktok_affiliate_order_raw_staging IS
'Append-only raw staging rows for TikTok affiliate Excel imports in the Content Attribution module.';

COMMENT ON COLUMN public.tiktok_affiliate_order_raw_staging.raw_payload IS
'Original row payload keyed by exported Excel headers for audit recovery and header drift handling without importer-side trim normalization.';

-- ============================================
-- 3) NORMALIZED FACTS
-- Grain:
--   1 current winner row per created_by + order_id + sku_id + product_id + content_id
-- ============================================

CREATE TABLE IF NOT EXISTS public.content_order_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_batch_id UUID REFERENCES public.tiktok_affiliate_import_batches(id) ON DELETE SET NULL,
  staging_row_id UUID REFERENCES public.tiktok_affiliate_order_raw_staging(id) ON DELETE SET NULL,
  normalized_row_version_hash TEXT NOT NULL,

  source_platform TEXT NOT NULL DEFAULT 'tiktok_affiliate',

  order_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  content_id TEXT NOT NULL,

  content_type TEXT CHECK (content_type IN ('live', 'video', 'showcase', 'other')),
  content_type_raw TEXT,
  product_name TEXT,
  shop_name TEXT,
  shop_code TEXT,
  affiliate_partner TEXT,
  agency TEXT,
  currency TEXT,
  currency_raw TEXT,

  order_date TIMESTAMPTZ,
  commission_settlement_date TIMESTAMPTZ,

  order_settlement_status TEXT NOT NULL CHECK (
    order_settlement_status IN ('settled', 'pending', 'awaiting_payment', 'ineligible', 'unknown')
  ),
  order_settlement_status_raw TEXT,
  is_successful BOOLEAN NOT NULL DEFAULT FALSE,
  is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  is_eligible_for_commission BOOLEAN NOT NULL DEFAULT FALSE,

  attribution_type TEXT NOT NULL CHECK (
    attribution_type IN ('affiliate', 'shop_ads', 'indirect', 'unknown')
  ),
  order_type_raw TEXT,
  is_indirect BOOLEAN NOT NULL DEFAULT FALSE,
  commission_type_raw TEXT,

  price NUMERIC(18, 2),
  items_sold INTEGER,
  items_refunded INTEGER,
  gmv NUMERIC(18, 2),

  commission_rate_standard NUMERIC(9, 6),
  commission_rate_shop_ads NUMERIC(9, 6),
  commission_rate_tiktok_bonus NUMERIC(9, 6),
  commission_rate_partner_bonus NUMERIC(9, 6),
  commission_rate_revenue_share NUMERIC(9, 6),

  commission_base_est NUMERIC(18, 2),
  commission_est_standard NUMERIC(18, 2),
  commission_est_shop_ads NUMERIC(18, 2),
  commission_est_bonus NUMERIC(18, 2),
  commission_est_affiliate_partner_bonus NUMERIC(18, 2),
  commission_est_iva NUMERIC(18, 2),
  commission_est_isr NUMERIC(18, 2),
  commission_est_pit NUMERIC(18, 2),
  commission_est_revenue_share NUMERIC(18, 2),

  commission_base_actual NUMERIC(18, 2),
  commission_actual_standard NUMERIC(18, 2),
  commission_actual_shop_ads NUMERIC(18, 2),
  commission_actual_bonus NUMERIC(18, 2),
  commission_actual_affiliate_partner_bonus NUMERIC(18, 2),
  shared_with_partner_amount NUMERIC(18, 2),
  tax_isr_amount NUMERIC(18, 2),
  tax_iva_amount NUMERIC(18, 2),
  tax_pit_amount NUMERIC(18, 2),
  total_commission_amount NUMERIC(18, 2),
  total_earned_amount NUMERIC(18, 2),

  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT content_order_facts_grain_unique
    UNIQUE (created_by, order_id, sku_id, product_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_content_order_facts_batch
  ON public.content_order_facts(created_by, import_batch_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_order_facts_content_date
  ON public.content_order_facts(created_by, content_id, order_date DESC);

CREATE INDEX IF NOT EXISTS idx_content_order_facts_product_date
  ON public.content_order_facts(created_by, product_id, sku_id, order_date DESC);

CREATE INDEX IF NOT EXISTS idx_content_order_facts_settlement
  ON public.content_order_facts(created_by, order_settlement_status, commission_settlement_date DESC);

CREATE INDEX IF NOT EXISTS idx_content_order_facts_version_hash
  ON public.content_order_facts(created_by, normalized_row_version_hash);

ALTER TABLE public.content_order_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_order_facts_select ON public.content_order_facts;
CREATE POLICY content_order_facts_select
ON public.content_order_facts
FOR SELECT
TO authenticated
USING (created_by = auth.uid());

DROP POLICY IF EXISTS content_order_facts_insert ON public.content_order_facts;
CREATE POLICY content_order_facts_insert
ON public.content_order_facts
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS content_order_facts_update ON public.content_order_facts;
CREATE POLICY content_order_facts_update
ON public.content_order_facts
FOR UPDATE
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS content_order_facts_delete ON public.content_order_facts;
CREATE POLICY content_order_facts_delete
ON public.content_order_facts
FOR DELETE
TO authenticated
USING (created_by = auth.uid());

DROP TRIGGER IF EXISTS trg_content_order_facts_updated_at ON public.content_order_facts;
CREATE TRIGGER trg_content_order_facts_updated_at
BEFORE UPDATE ON public.content_order_facts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.content_order_facts IS
'Current normalized order-line-content attribution facts for the Content Attribution module only.';

COMMENT ON COLUMN public.content_order_facts.total_commission_amount IS
'V1 inferred as the sum of actual commission component fields before taxes and partner-share deductions.';

-- ============================================
-- 4) HELPER FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION public.tiktok_affiliate_trim_null(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN BTRIM(p_value) IN ('', '-', '--', 'N/A', 'n/a', 'NULL', 'null') THEN NULL
    ELSE BTRIM(p_value)
  END
$$;

CREATE OR REPLACE FUNCTION public.tiktok_affiliate_parse_money(p_value TEXT)
RETURNS NUMERIC(18, 2)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cleaned TEXT;
  parsed NUMERIC;
BEGIN
  cleaned := public.tiktok_affiliate_trim_null(p_value);

  IF cleaned IS NULL THEN
    RETURN NULL;
  END IF;

  cleaned := regexp_replace(cleaned, '\s+', '', 'g');
  cleaned := replace(cleaned, ',', '');
  cleaned := regexp_replace(cleaned, '^[฿$€£¥]', '');

  IF cleaned !~ '^-?\d+(\.\d+)?$' THEN
    RETURN NULL;
  END IF;

  parsed := cleaned::NUMERIC;

  IF parsed < 0 THEN
    RETURN NULL;
  END IF;

  RETURN ROUND(parsed, 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.tiktok_affiliate_parse_rate(p_value TEXT)
RETURNS NUMERIC(9, 6)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cleaned TEXT;
  parsed NUMERIC;
  has_percent BOOLEAN := FALSE;
BEGIN
  cleaned := public.tiktok_affiliate_trim_null(p_value);

  IF cleaned IS NULL THEN
    RETURN NULL;
  END IF;

  cleaned := regexp_replace(cleaned, '\s+', '', 'g');
  cleaned := replace(cleaned, ',', '');

  IF RIGHT(cleaned, 1) = '%' THEN
    has_percent := TRUE;
    cleaned := LEFT(cleaned, LENGTH(cleaned) - 1);
  END IF;

  IF cleaned !~ '^-?\d+(\.\d+)?$' THEN
    RETURN NULL;
  END IF;

  parsed := cleaned::NUMERIC;

  IF has_percent THEN
    parsed := parsed / 100.0;
  ELSIF parsed >= 0 AND parsed <= 1 THEN
    parsed := parsed;
  ELSIF parsed > 1 AND parsed <= 100 THEN
    parsed := parsed / 100.0;
  ELSE
    RETURN NULL;
  END IF;

  IF parsed < 0 OR parsed > 1 THEN
    RETURN NULL;
  END IF;

  RETURN ROUND(parsed, 6);
END;
$$;

CREATE OR REPLACE FUNCTION public.tiktok_affiliate_parse_count(p_value TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cleaned TEXT;
BEGIN
  cleaned := public.tiktok_affiliate_trim_null(p_value);

  IF cleaned IS NULL THEN
    RETURN NULL;
  END IF;

  cleaned := regexp_replace(cleaned, '\s+', '', 'g');
  cleaned := replace(cleaned, ',', '');

  IF cleaned !~ '^\d+$' THEN
    RETURN NULL;
  END IF;

  RETURN cleaned::INTEGER;
END;
$$;

CREATE OR REPLACE FUNCTION public.tiktok_affiliate_parse_timestamp(p_value TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cleaned TEXT;
BEGIN
  cleaned := public.tiktok_affiliate_trim_null(p_value);

  IF cleaned IS NULL OR cleaned = '/' THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN to_timestamp(cleaned, 'DD/MM/YYYY HH24:MI:SS');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    RETURN to_timestamp(cleaned, 'DD/MM/YYYY HH24:MI');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    RETURN (to_date(cleaned, 'DD/MM/YYYY'))::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    RETURN cleaned::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.tiktok_affiliate_normalize_status(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE regexp_replace(lower(COALESCE(public.tiktok_affiliate_trim_null(p_value), '')), '\s+', '', 'g')
    WHEN 'settled' THEN 'settled'
    WHEN 'pending' THEN 'pending'
    WHEN 'awaitingpayment' THEN 'awaiting_payment'
    WHEN 'ineligible' THEN 'ineligible'
    ELSE 'unknown'
  END
$$;

CREATE OR REPLACE FUNCTION public.tiktok_affiliate_status_rank(p_value TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_value
    WHEN 'settled' THEN 3
    WHEN 'ineligible' THEN 3
    WHEN 'pending' THEN 2
    WHEN 'awaiting_payment' THEN 1
    ELSE 0
  END
$$;

CREATE OR REPLACE FUNCTION public.tiktok_affiliate_normalize_content_type(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(COALESCE(public.tiktok_affiliate_trim_null(p_value), ''))
    WHEN 'live' THEN 'live'
    WHEN 'video' THEN 'video'
    WHEN 'showcase' THEN 'showcase'
    ELSE 'other'
  END
$$;

CREATE OR REPLACE FUNCTION public.tiktok_affiliate_normalize_attribution_type(
  p_order_type TEXT,
  p_indirect_flag TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN regexp_replace(lower(COALESCE(public.tiktok_affiliate_trim_null(p_indirect_flag), '')), '\s+', '', 'g') = 'indirect'
      THEN 'indirect'
    WHEN regexp_replace(lower(COALESCE(public.tiktok_affiliate_trim_null(p_order_type), '')), '\s+', '', 'g') = 'shopadsorder'
      THEN 'shop_ads'
    WHEN regexp_replace(lower(COALESCE(public.tiktok_affiliate_trim_null(p_order_type), '')), '\s+', '', 'g') = 'affiliateorder'
      THEN 'affiliate'
    ELSE 'unknown'
  END
$$;

-- ============================================
-- 5) NORMALIZATION FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION public.normalize_tiktok_affiliate_order_batch(p_import_batch_id UUID)
RETURNS TABLE (
  staging_row_count INTEGER,
  valid_candidate_row_count INTEGER,
  winner_row_count INTEGER,
  missing_key_row_count INTEGER,
  invalid_value_row_count INTEGER,
  duplicate_non_winner_row_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by UUID;
BEGIN
  SELECT created_by
  INTO v_created_by
  FROM public.tiktok_affiliate_import_batches
  WHERE id = p_import_batch_id;

  IF v_created_by IS NULL THEN
    RAISE EXCEPTION 'Unknown tiktok_affiliate_import_batches.id: %', p_import_batch_id;
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM v_created_by THEN
    RAISE EXCEPTION 'Access denied for tiktok_affiliate_import_batches.id: %', p_import_batch_id;
  END IF;

  CREATE TEMP TABLE tmp_tiktok_affiliate_normalized_source ON COMMIT DROP AS
  WITH staged AS (
    SELECT
      s.id AS staging_row_id,
      s.created_at,
      s.created_by,
      s.import_batch_id,
      s.source_row_number,
      s.raw_payload,
      s.product_name,
      s.shop_name,
      s.shop_code,
      s.affiliate_partner,
      s.agency,
      public.tiktok_affiliate_trim_null(s.order_id) AS order_id,
      public.tiktok_affiliate_trim_null(s.sku_id) AS sku_id,
      public.tiktok_affiliate_trim_null(s.product_id) AS product_id,
      public.tiktok_affiliate_trim_null(s.content_id) AS content_id,
      public.tiktok_affiliate_trim_null(s.content_type) AS content_type_raw,
      public.tiktok_affiliate_normalize_content_type(s.content_type) AS content_type,
      public.tiktok_affiliate_trim_null(s.currency) AS currency_raw,
      UPPER(public.tiktok_affiliate_trim_null(s.currency)) AS currency,
      public.tiktok_affiliate_parse_timestamp(s.order_date_text) AS order_date,
      public.tiktok_affiliate_parse_timestamp(s.commission_settlement_date_text) AS commission_settlement_date,
      public.tiktok_affiliate_normalize_status(s.order_settlement_status) AS order_settlement_status,
      s.order_settlement_status AS order_settlement_status_raw,
      public.tiktok_affiliate_normalize_attribution_type(s.order_type, s.indirect_flag) AS attribution_type,
      s.order_type AS order_type_raw,
      regexp_replace(lower(COALESCE(public.tiktok_affiliate_trim_null(s.indirect_flag), '')), '\s+', '', 'g') = 'indirect' AS is_indirect,
      s.commission_type AS commission_type_raw,

      public.tiktok_affiliate_parse_money(s.price_text) AS price,
      public.tiktok_affiliate_parse_count(s.items_sold_text) AS items_sold,
      public.tiktok_affiliate_parse_count(s.items_refunded_text) AS items_refunded,
      public.tiktok_affiliate_parse_money(s.gmv_text) AS gmv,

      public.tiktok_affiliate_parse_rate(s.standard_rate_text) AS commission_rate_standard,
      public.tiktok_affiliate_parse_rate(s.shop_ads_rate_text) AS commission_rate_shop_ads,
      public.tiktok_affiliate_parse_rate(s.tiktok_bonus_rate_text) AS commission_rate_tiktok_bonus,
      public.tiktok_affiliate_parse_rate(s.partner_bonus_rate_text) AS commission_rate_partner_bonus,
      public.tiktok_affiliate_parse_rate(s.revenue_sharing_portion_rate_text) AS commission_rate_revenue_share,

      public.tiktok_affiliate_parse_money(s.est_commission_base_text) AS commission_base_est,
      public.tiktok_affiliate_parse_money(s.est_standard_commission_text) AS commission_est_standard,
      public.tiktok_affiliate_parse_money(s.est_shop_ads_commission_text) AS commission_est_shop_ads,
      public.tiktok_affiliate_parse_money(s.est_bonus_text) AS commission_est_bonus,
      public.tiktok_affiliate_parse_money(s.est_affiliate_partner_bonus_text) AS commission_est_affiliate_partner_bonus,
      public.tiktok_affiliate_parse_money(s.est_iva_text) AS commission_est_iva,
      public.tiktok_affiliate_parse_money(s.est_isr_text) AS commission_est_isr,
      public.tiktok_affiliate_parse_money(s.est_pit_text) AS commission_est_pit,
      public.tiktok_affiliate_parse_money(s.est_revenue_sharing_portion_text) AS commission_est_revenue_share,

      public.tiktok_affiliate_parse_money(s.actual_commission_base_text) AS commission_base_actual,
      public.tiktok_affiliate_parse_money(s.standard_commission_text) AS commission_actual_standard,
      public.tiktok_affiliate_parse_money(s.shop_ads_commission_text) AS commission_actual_shop_ads,
      public.tiktok_affiliate_parse_money(s.bonus_text) AS commission_actual_bonus,
      public.tiktok_affiliate_parse_money(s.affiliate_partner_bonus_text) AS commission_actual_affiliate_partner_bonus,
      public.tiktok_affiliate_parse_money(s.shared_with_partner_text) AS shared_with_partner_amount,
      public.tiktok_affiliate_parse_money(s.tax_isr_text) AS tax_isr_amount,
      public.tiktok_affiliate_parse_money(s.tax_iva_text) AS tax_iva_amount,
      public.tiktok_affiliate_parse_money(s.tax_pit_text) AS tax_pit_amount,
      public.tiktok_affiliate_parse_money(s.total_final_earned_amount_text) AS total_earned_amount,

      public.tiktok_affiliate_trim_null(s.price_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.price_text) IS NULL AS price_invalid,
      public.tiktok_affiliate_trim_null(s.items_sold_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_count(s.items_sold_text) IS NULL AS items_sold_invalid,
      public.tiktok_affiliate_trim_null(s.items_refunded_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_count(s.items_refunded_text) IS NULL AS items_refunded_invalid,
      public.tiktok_affiliate_trim_null(s.gmv_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.gmv_text) IS NULL AS gmv_invalid,
      public.tiktok_affiliate_trim_null(s.standard_rate_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_rate(s.standard_rate_text) IS NULL AS standard_rate_invalid,
      public.tiktok_affiliate_trim_null(s.shop_ads_rate_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_rate(s.shop_ads_rate_text) IS NULL AS shop_ads_rate_invalid,
      public.tiktok_affiliate_trim_null(s.tiktok_bonus_rate_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_rate(s.tiktok_bonus_rate_text) IS NULL AS tiktok_bonus_rate_invalid,
      public.tiktok_affiliate_trim_null(s.partner_bonus_rate_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_rate(s.partner_bonus_rate_text) IS NULL AS partner_bonus_rate_invalid,
      public.tiktok_affiliate_trim_null(s.revenue_sharing_portion_rate_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_rate(s.revenue_sharing_portion_rate_text) IS NULL AS revenue_share_rate_invalid,
      public.tiktok_affiliate_trim_null(s.est_commission_base_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_commission_base_text) IS NULL AS est_commission_base_invalid,
      public.tiktok_affiliate_trim_null(s.est_standard_commission_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_standard_commission_text) IS NULL AS est_standard_invalid,
      public.tiktok_affiliate_trim_null(s.est_shop_ads_commission_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_shop_ads_commission_text) IS NULL AS est_shop_ads_invalid,
      public.tiktok_affiliate_trim_null(s.est_bonus_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_bonus_text) IS NULL AS est_bonus_invalid,
      public.tiktok_affiliate_trim_null(s.est_affiliate_partner_bonus_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_affiliate_partner_bonus_text) IS NULL AS est_partner_bonus_invalid,
      public.tiktok_affiliate_trim_null(s.est_iva_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_iva_text) IS NULL AS est_iva_invalid,
      public.tiktok_affiliate_trim_null(s.est_isr_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_isr_text) IS NULL AS est_isr_invalid,
      public.tiktok_affiliate_trim_null(s.est_pit_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_pit_text) IS NULL AS est_pit_invalid,
      public.tiktok_affiliate_trim_null(s.est_revenue_sharing_portion_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_revenue_sharing_portion_text) IS NULL AS est_revenue_share_invalid,
      public.tiktok_affiliate_trim_null(s.actual_commission_base_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.actual_commission_base_text) IS NULL AS actual_commission_base_invalid,
      public.tiktok_affiliate_trim_null(s.standard_commission_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.standard_commission_text) IS NULL AS actual_standard_invalid,
      public.tiktok_affiliate_trim_null(s.shop_ads_commission_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.shop_ads_commission_text) IS NULL AS actual_shop_ads_invalid,
      public.tiktok_affiliate_trim_null(s.bonus_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.bonus_text) IS NULL AS actual_bonus_invalid,
      public.tiktok_affiliate_trim_null(s.affiliate_partner_bonus_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.affiliate_partner_bonus_text) IS NULL AS actual_partner_bonus_invalid,
      public.tiktok_affiliate_trim_null(s.shared_with_partner_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.shared_with_partner_text) IS NULL AS shared_with_partner_invalid,
      public.tiktok_affiliate_trim_null(s.tax_isr_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.tax_isr_text) IS NULL AS tax_isr_invalid,
      public.tiktok_affiliate_trim_null(s.tax_iva_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.tax_iva_text) IS NULL AS tax_iva_invalid,
      public.tiktok_affiliate_trim_null(s.tax_pit_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.tax_pit_text) IS NULL AS tax_pit_invalid,
      public.tiktok_affiliate_trim_null(s.total_final_earned_amount_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.total_final_earned_amount_text) IS NULL AS total_earned_invalid
    FROM public.tiktok_affiliate_order_raw_staging s
    WHERE s.import_batch_id = p_import_batch_id
  )
  SELECT
    staged.*,
    staged.order_id IS NULL
      OR staged.sku_id IS NULL
      OR staged.product_id IS NULL
      OR staged.content_id IS NULL AS missing_required_key,
    (
      staged.price_invalid
      OR staged.items_sold_invalid
      OR staged.items_refunded_invalid
      OR staged.gmv_invalid
      OR staged.standard_rate_invalid
      OR staged.shop_ads_rate_invalid
      OR staged.tiktok_bonus_rate_invalid
      OR staged.partner_bonus_rate_invalid
      OR staged.revenue_share_rate_invalid
      OR staged.est_commission_base_invalid
      OR staged.est_standard_invalid
      OR staged.est_shop_ads_invalid
      OR staged.est_bonus_invalid
      OR staged.est_partner_bonus_invalid
      OR staged.est_iva_invalid
      OR staged.est_isr_invalid
      OR staged.est_pit_invalid
      OR staged.est_revenue_share_invalid
      OR staged.actual_commission_base_invalid
      OR staged.actual_standard_invalid
      OR staged.actual_shop_ads_invalid
      OR staged.actual_bonus_invalid
      OR staged.actual_partner_bonus_invalid
      OR staged.shared_with_partner_invalid
      OR staged.tax_isr_invalid
      OR staged.tax_iva_invalid
      OR staged.tax_pit_invalid
      OR staged.total_earned_invalid
    ) AS invalid_numeric_fields,
    CASE staged.order_settlement_status
      WHEN 'settled' THEN TRUE
      ELSE FALSE
    END AS is_successful,
    CASE staged.order_settlement_status
      WHEN 'ineligible' THEN TRUE
      ELSE FALSE
    END AS is_cancelled,
    CASE staged.order_settlement_status
      WHEN 'settled' THEN TRUE
      WHEN 'pending' THEN TRUE
      ELSE FALSE
    END AS is_eligible_for_commission,
    COALESCE(staged.commission_actual_standard, 0)
      + COALESCE(staged.commission_actual_shop_ads, 0)
      + COALESCE(staged.commission_actual_bonus, 0)
      + COALESCE(staged.commission_actual_affiliate_partner_bonus, 0) AS total_commission_amount,
    md5(
      concat_ws(
        '|',
        COALESCE(staged.order_id, ''),
        COALESCE(staged.sku_id, ''),
        COALESCE(staged.product_id, ''),
        COALESCE(staged.content_id, ''),
        COALESCE(staged.content_type, ''),
        COALESCE(staged.product_name, ''),
        COALESCE(staged.shop_name, ''),
        COALESCE(staged.shop_code, ''),
        COALESCE(staged.affiliate_partner, ''),
        COALESCE(staged.agency, ''),
        COALESCE(staged.currency, ''),
        COALESCE(staged.currency_raw, ''),
        COALESCE(staged.order_date::TEXT, ''),
        COALESCE(staged.commission_settlement_date::TEXT, ''),
        COALESCE(staged.order_settlement_status, ''),
        COALESCE(staged.order_settlement_status_raw, ''),
        COALESCE(staged.order_type_raw, ''),
        COALESCE(staged.attribution_type, ''),
        COALESCE(staged.is_indirect::TEXT, ''),
        COALESCE(staged.commission_type_raw, ''),
        COALESCE(staged.price::TEXT, ''),
        COALESCE(staged.items_sold::TEXT, ''),
        COALESCE(staged.items_refunded::TEXT, ''),
        COALESCE(staged.gmv::TEXT, ''),
        COALESCE(staged.commission_rate_standard::TEXT, ''),
        COALESCE(staged.commission_rate_shop_ads::TEXT, ''),
        COALESCE(staged.commission_rate_tiktok_bonus::TEXT, ''),
        COALESCE(staged.commission_rate_partner_bonus::TEXT, ''),
        COALESCE(staged.commission_rate_revenue_share::TEXT, ''),
        COALESCE(staged.commission_base_est::TEXT, ''),
        COALESCE(staged.commission_est_standard::TEXT, ''),
        COALESCE(staged.commission_est_shop_ads::TEXT, ''),
        COALESCE(staged.commission_est_bonus::TEXT, ''),
        COALESCE(staged.commission_est_affiliate_partner_bonus::TEXT, ''),
        COALESCE(staged.commission_est_iva::TEXT, ''),
        COALESCE(staged.commission_est_isr::TEXT, ''),
        COALESCE(staged.commission_est_pit::TEXT, ''),
        COALESCE(staged.commission_est_revenue_share::TEXT, ''),
        COALESCE(staged.commission_base_actual::TEXT, ''),
        COALESCE(staged.commission_actual_standard::TEXT, ''),
        COALESCE(staged.commission_actual_shop_ads::TEXT, ''),
        COALESCE(staged.commission_actual_bonus::TEXT, ''),
        COALESCE(staged.commission_actual_affiliate_partner_bonus::TEXT, ''),
        COALESCE(staged.shared_with_partner_amount::TEXT, ''),
        COALESCE(staged.tax_isr_amount::TEXT, ''),
        COALESCE(staged.tax_iva_amount::TEXT, ''),
        COALESCE(staged.tax_pit_amount::TEXT, ''),
        COALESCE((COALESCE(staged.commission_actual_standard, 0)
          + COALESCE(staged.commission_actual_shop_ads, 0)
          + COALESCE(staged.commission_actual_bonus, 0)
          + COALESCE(staged.commission_actual_affiliate_partner_bonus, 0))::TEXT, ''),
        COALESCE(staged.total_earned_amount::TEXT, '')
      )
    ) AS normalized_row_version_hash
  FROM staged;

  CREATE TEMP TABLE tmp_tiktok_affiliate_winners ON COMMIT DROP AS
  SELECT *
  FROM (
    SELECT
      n.*,
      ROW_NUMBER() OVER (
        PARTITION BY n.created_by, n.order_id, n.sku_id, n.product_id, n.content_id
        ORDER BY
          n.created_at DESC,
          public.tiktok_affiliate_status_rank(n.order_settlement_status) DESC,
          (n.commission_settlement_date IS NOT NULL) DESC,
          n.staging_row_id DESC
      ) AS winner_rank
    FROM tmp_tiktok_affiliate_normalized_source n
    WHERE NOT n.missing_required_key
      AND NOT n.invalid_numeric_fields
  ) ranked
  WHERE ranked.winner_rank = 1;

  CREATE TEMP TABLE tmp_tiktok_affiliate_batch_stats ON COMMIT DROP AS
  WITH missing_key_rows AS (
    SELECT
      n.staging_row_id,
      n.source_row_number,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN n.order_id IS NULL THEN 'order_id' END,
        CASE WHEN n.sku_id IS NULL THEN 'sku_id' END,
        CASE WHEN n.product_id IS NULL THEN 'product_id' END,
        CASE WHEN n.content_id IS NULL THEN 'content_id' END
      ], NULL) AS failed_fields
    FROM tmp_tiktok_affiliate_normalized_source n
    WHERE n.missing_required_key
  ),
  invalid_value_rows AS (
    SELECT
      n.staging_row_id,
      n.source_row_number,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN n.price_invalid THEN 'price' END,
        CASE WHEN n.items_sold_invalid THEN 'items_sold' END,
        CASE WHEN n.items_refunded_invalid THEN 'items_refunded' END,
        CASE WHEN n.gmv_invalid THEN 'gmv' END,
        CASE WHEN n.standard_rate_invalid THEN 'standard_rate' END,
        CASE WHEN n.shop_ads_rate_invalid THEN 'shop_ads_rate' END,
        CASE WHEN n.tiktok_bonus_rate_invalid THEN 'tiktok_bonus_rate' END,
        CASE WHEN n.partner_bonus_rate_invalid THEN 'partner_bonus_rate' END,
        CASE WHEN n.revenue_share_rate_invalid THEN 'revenue_sharing_portion_rate' END,
        CASE WHEN n.est_commission_base_invalid THEN 'est_commission_base' END,
        CASE WHEN n.est_standard_invalid THEN 'est_standard_commission' END,
        CASE WHEN n.est_shop_ads_invalid THEN 'est_shop_ads_commission' END,
        CASE WHEN n.est_bonus_invalid THEN 'est_bonus' END,
        CASE WHEN n.est_partner_bonus_invalid THEN 'est_affiliate_partner_bonus' END,
        CASE WHEN n.est_iva_invalid THEN 'est_iva' END,
        CASE WHEN n.est_isr_invalid THEN 'est_isr' END,
        CASE WHEN n.est_pit_invalid THEN 'est_pit' END,
        CASE WHEN n.est_revenue_share_invalid THEN 'est_revenue_sharing_portion' END,
        CASE WHEN n.actual_commission_base_invalid THEN 'actual_commission_base' END,
        CASE WHEN n.actual_standard_invalid THEN 'standard_commission' END,
        CASE WHEN n.actual_shop_ads_invalid THEN 'shop_ads_commission' END,
        CASE WHEN n.actual_bonus_invalid THEN 'bonus' END,
        CASE WHEN n.actual_partner_bonus_invalid THEN 'affiliate_partner_bonus' END,
        CASE WHEN n.shared_with_partner_invalid THEN 'shared_with_partner' END,
        CASE WHEN n.tax_isr_invalid THEN 'tax_isr' END,
        CASE WHEN n.tax_iva_invalid THEN 'tax_iva' END,
        CASE WHEN n.tax_pit_invalid THEN 'tax_pit' END,
        CASE WHEN n.total_earned_invalid THEN 'total_final_earned_amount' END
      ], NULL) AS failed_fields
    FROM tmp_tiktok_affiliate_normalized_source n
    WHERE NOT n.missing_required_key
      AND n.invalid_numeric_fields
  ),
  duplicate_non_winner_rows AS (
    SELECT
      n.staging_row_id,
      n.source_row_number,
      n.order_id,
      n.sku_id,
      n.product_id,
      n.content_id,
      n.normalized_row_version_hash
    FROM tmp_tiktok_affiliate_normalized_source n
    LEFT JOIN tmp_tiktok_affiliate_winners w
      ON w.staging_row_id = n.staging_row_id
    WHERE NOT n.missing_required_key
      AND NOT n.invalid_numeric_fields
      AND w.staging_row_id IS NULL
  ),
  invalid_value_field_counts AS (
    SELECT
      failed_field,
      COUNT(*)::INTEGER AS field_count
    FROM invalid_value_rows r
    CROSS JOIN LATERAL unnest(r.failed_fields) AS failed_field
    GROUP BY failed_field
  )
  SELECT
    COUNT(*)::INTEGER AS staging_row_count,
    COUNT(*) FILTER (
      WHERE NOT missing_required_key
        AND NOT invalid_numeric_fields
    )::INTEGER AS valid_candidate_row_count,
    (SELECT COUNT(*)::INTEGER FROM tmp_tiktok_affiliate_winners) AS winner_row_count,
    COUNT(*) FILTER (WHERE missing_required_key)::INTEGER AS missing_key_row_count,
    COUNT(*) FILTER (WHERE NOT missing_required_key AND invalid_numeric_fields)::INTEGER AS invalid_value_row_count,
    (
      COUNT(*) FILTER (
        WHERE NOT missing_required_key
          AND NOT invalid_numeric_fields
      ) - (SELECT COUNT(*)::INTEGER FROM tmp_tiktok_affiliate_winners)
    )::INTEGER AS duplicate_non_winner_row_count,
    COALESCE(
      (
        SELECT jsonb_strip_nulls(
          jsonb_build_object(
            'order_id', CASE WHEN COUNT(*) FILTER (WHERE order_id IS NULL) > 0 THEN COUNT(*) FILTER (WHERE order_id IS NULL) END,
            'sku_id', CASE WHEN COUNT(*) FILTER (WHERE sku_id IS NULL) > 0 THEN COUNT(*) FILTER (WHERE sku_id IS NULL) END,
            'product_id', CASE WHEN COUNT(*) FILTER (WHERE product_id IS NULL) > 0 THEN COUNT(*) FILTER (WHERE product_id IS NULL) END,
            'content_id', CASE WHEN COUNT(*) FILTER (WHERE content_id IS NULL) > 0 THEN COUNT(*) FILTER (WHERE content_id IS NULL) END
          )
        )
        FROM tmp_tiktok_affiliate_normalized_source
        WHERE missing_required_key
      ),
      '{}'::jsonb
    ) AS missing_key_field_counts,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'staging_row_id', staging_row_id,
            'source_row_number', source_row_number,
            'failed_fields', to_jsonb(failed_fields)
          )
          ORDER BY source_row_number, staging_row_id
        )
        FROM (
          SELECT *
          FROM missing_key_rows
          ORDER BY source_row_number, staging_row_id
          LIMIT 25
        ) samples
      ),
      '[]'::jsonb
    ) AS missing_key_sample_rows,
    COALESCE(
      (
        SELECT jsonb_object_agg(failed_field, field_count)
        FROM invalid_value_field_counts
      ),
      '{}'::jsonb
    ) AS invalid_value_field_counts,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'staging_row_id', staging_row_id,
            'source_row_number', source_row_number,
            'failed_fields', to_jsonb(failed_fields)
          )
          ORDER BY source_row_number, staging_row_id
        )
        FROM (
          SELECT *
          FROM invalid_value_rows
          ORDER BY source_row_number, staging_row_id
          LIMIT 25
        ) samples
      ),
      '[]'::jsonb
    ) AS invalid_value_sample_rows,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'staging_row_id', staging_row_id,
            'source_row_number', source_row_number,
            'order_id', order_id,
            'sku_id', sku_id,
            'product_id', product_id,
            'content_id', content_id,
            'normalized_row_version_hash', normalized_row_version_hash
          )
          ORDER BY source_row_number, staging_row_id
        )
        FROM (
          SELECT *
          FROM duplicate_non_winner_rows
          ORDER BY source_row_number, staging_row_id
          LIMIT 25
        ) samples
      ),
      '[]'::jsonb
    ) AS duplicate_non_winner_sample_rows
  FROM tmp_tiktok_affiliate_normalized_source;

  INSERT INTO public.content_order_facts (
    created_by,
    import_batch_id,
    staging_row_id,
    normalized_row_version_hash,
    source_platform,
    order_id,
    sku_id,
    product_id,
    content_id,
    content_type,
    content_type_raw,
    product_name,
    shop_name,
    shop_code,
    affiliate_partner,
    agency,
    currency,
    currency_raw,
    order_date,
    commission_settlement_date,
    order_settlement_status,
    order_settlement_status_raw,
    is_successful,
    is_cancelled,
    is_eligible_for_commission,
    attribution_type,
    order_type_raw,
    is_indirect,
    commission_type_raw,
    price,
    items_sold,
    items_refunded,
    gmv,
    commission_rate_standard,
    commission_rate_shop_ads,
    commission_rate_tiktok_bonus,
    commission_rate_partner_bonus,
    commission_rate_revenue_share,
    commission_base_est,
    commission_est_standard,
    commission_est_shop_ads,
    commission_est_bonus,
    commission_est_affiliate_partner_bonus,
    commission_est_iva,
    commission_est_isr,
    commission_est_pit,
    commission_est_revenue_share,
    commission_base_actual,
    commission_actual_standard,
    commission_actual_shop_ads,
    commission_actual_bonus,
    commission_actual_affiliate_partner_bonus,
    shared_with_partner_amount,
    tax_isr_amount,
    tax_iva_amount,
    tax_pit_amount,
    total_commission_amount,
    total_earned_amount,
    raw_payload
  )
  SELECT
    w.created_by,
    w.import_batch_id,
    w.staging_row_id,
    w.normalized_row_version_hash,
    'tiktok_affiliate',
    w.order_id,
    w.sku_id,
    w.product_id,
    w.content_id,
    w.content_type,
    w.content_type_raw,
    w.product_name,
    w.shop_name,
    w.shop_code,
    w.affiliate_partner,
    w.agency,
    w.currency,
    w.currency_raw,
    w.order_date,
    w.commission_settlement_date,
    w.order_settlement_status,
    w.order_settlement_status_raw,
    w.is_successful,
    w.is_cancelled,
    w.is_eligible_for_commission,
    w.attribution_type,
    w.order_type_raw,
    w.is_indirect,
    w.commission_type_raw,
    w.price,
    w.items_sold,
    w.items_refunded,
    w.gmv,
    w.commission_rate_standard,
    w.commission_rate_shop_ads,
    w.commission_rate_tiktok_bonus,
    w.commission_rate_partner_bonus,
    w.commission_rate_revenue_share,
    w.commission_base_est,
    w.commission_est_standard,
    w.commission_est_shop_ads,
    w.commission_est_bonus,
    w.commission_est_affiliate_partner_bonus,
    w.commission_est_iva,
    w.commission_est_isr,
    w.commission_est_pit,
    w.commission_est_revenue_share,
    w.commission_base_actual,
    w.commission_actual_standard,
    w.commission_actual_shop_ads,
    w.commission_actual_bonus,
    w.commission_actual_affiliate_partner_bonus,
    w.shared_with_partner_amount,
    w.tax_isr_amount,
    w.tax_iva_amount,
    w.tax_pit_amount,
    w.total_commission_amount,
    w.total_earned_amount,
    w.raw_payload
  FROM tmp_tiktok_affiliate_winners w
  ON CONFLICT (created_by, order_id, sku_id, product_id, content_id)
  DO UPDATE SET
    import_batch_id = EXCLUDED.import_batch_id,
    staging_row_id = EXCLUDED.staging_row_id,
    normalized_row_version_hash = EXCLUDED.normalized_row_version_hash,
    source_platform = EXCLUDED.source_platform,
    content_type = EXCLUDED.content_type,
    content_type_raw = EXCLUDED.content_type_raw,
    product_name = EXCLUDED.product_name,
    shop_name = EXCLUDED.shop_name,
    shop_code = EXCLUDED.shop_code,
    affiliate_partner = EXCLUDED.affiliate_partner,
    agency = EXCLUDED.agency,
    currency = EXCLUDED.currency,
    currency_raw = EXCLUDED.currency_raw,
    order_date = EXCLUDED.order_date,
    commission_settlement_date = EXCLUDED.commission_settlement_date,
    order_settlement_status = EXCLUDED.order_settlement_status,
    order_settlement_status_raw = EXCLUDED.order_settlement_status_raw,
    is_successful = EXCLUDED.is_successful,
    is_cancelled = EXCLUDED.is_cancelled,
    is_eligible_for_commission = EXCLUDED.is_eligible_for_commission,
    attribution_type = EXCLUDED.attribution_type,
    order_type_raw = EXCLUDED.order_type_raw,
    is_indirect = EXCLUDED.is_indirect,
    commission_type_raw = EXCLUDED.commission_type_raw,
    price = EXCLUDED.price,
    items_sold = EXCLUDED.items_sold,
    items_refunded = EXCLUDED.items_refunded,
    gmv = EXCLUDED.gmv,
    commission_rate_standard = EXCLUDED.commission_rate_standard,
    commission_rate_shop_ads = EXCLUDED.commission_rate_shop_ads,
    commission_rate_tiktok_bonus = EXCLUDED.commission_rate_tiktok_bonus,
    commission_rate_partner_bonus = EXCLUDED.commission_rate_partner_bonus,
    commission_rate_revenue_share = EXCLUDED.commission_rate_revenue_share,
    commission_base_est = EXCLUDED.commission_base_est,
    commission_est_standard = EXCLUDED.commission_est_standard,
    commission_est_shop_ads = EXCLUDED.commission_est_shop_ads,
    commission_est_bonus = EXCLUDED.commission_est_bonus,
    commission_est_affiliate_partner_bonus = EXCLUDED.commission_est_affiliate_partner_bonus,
    commission_est_iva = EXCLUDED.commission_est_iva,
    commission_est_isr = EXCLUDED.commission_est_isr,
    commission_est_pit = EXCLUDED.commission_est_pit,
    commission_est_revenue_share = EXCLUDED.commission_est_revenue_share,
    commission_base_actual = EXCLUDED.commission_base_actual,
    commission_actual_standard = EXCLUDED.commission_actual_standard,
    commission_actual_shop_ads = EXCLUDED.commission_actual_shop_ads,
    commission_actual_bonus = EXCLUDED.commission_actual_bonus,
    commission_actual_affiliate_partner_bonus = EXCLUDED.commission_actual_affiliate_partner_bonus,
    shared_with_partner_amount = EXCLUDED.shared_with_partner_amount,
    tax_isr_amount = EXCLUDED.tax_isr_amount,
    tax_iva_amount = EXCLUDED.tax_iva_amount,
    tax_pit_amount = EXCLUDED.tax_pit_amount,
    total_commission_amount = EXCLUDED.total_commission_amount,
    total_earned_amount = EXCLUDED.total_earned_amount,
    raw_payload = EXCLUDED.raw_payload,
    updated_at = NOW()
  WHERE
    EXCLUDED.staging_row_id = public.content_order_facts.staging_row_id
    OR COALESCE(
      (SELECT s.created_at
       FROM public.tiktok_affiliate_order_raw_staging s
       WHERE s.id = EXCLUDED.staging_row_id),
      '-infinity'::timestamptz
    ) > COALESCE(
      (SELECT s.created_at
       FROM public.tiktok_affiliate_order_raw_staging s
       WHERE s.id = public.content_order_facts.staging_row_id),
      '-infinity'::timestamptz
    )
    OR (
      COALESCE(
        (SELECT s.created_at
         FROM public.tiktok_affiliate_order_raw_staging s
         WHERE s.id = EXCLUDED.staging_row_id),
        '-infinity'::timestamptz
      ) = COALESCE(
        (SELECT s.created_at
         FROM public.tiktok_affiliate_order_raw_staging s
         WHERE s.id = public.content_order_facts.staging_row_id),
        '-infinity'::timestamptz
      )
      AND public.tiktok_affiliate_status_rank(EXCLUDED.order_settlement_status)
        > public.tiktok_affiliate_status_rank(public.content_order_facts.order_settlement_status)
    )
    OR (
      COALESCE(
        (SELECT s.created_at
         FROM public.tiktok_affiliate_order_raw_staging s
         WHERE s.id = EXCLUDED.staging_row_id),
        '-infinity'::timestamptz
      ) = COALESCE(
        (SELECT s.created_at
         FROM public.tiktok_affiliate_order_raw_staging s
         WHERE s.id = public.content_order_facts.staging_row_id),
        '-infinity'::timestamptz
      )
      AND public.tiktok_affiliate_status_rank(EXCLUDED.order_settlement_status)
        = public.tiktok_affiliate_status_rank(public.content_order_facts.order_settlement_status)
      AND (EXCLUDED.commission_settlement_date IS NOT NULL)
      AND (public.content_order_facts.commission_settlement_date IS NULL)
    )
    OR (
      COALESCE(
        (SELECT s.created_at
         FROM public.tiktok_affiliate_order_raw_staging s
         WHERE s.id = EXCLUDED.staging_row_id),
        '-infinity'::timestamptz
      ) = COALESCE(
        (SELECT s.created_at
         FROM public.tiktok_affiliate_order_raw_staging s
         WHERE s.id = public.content_order_facts.staging_row_id),
        '-infinity'::timestamptz
      )
      AND public.tiktok_affiliate_status_rank(EXCLUDED.order_settlement_status)
        = public.tiktok_affiliate_status_rank(public.content_order_facts.order_settlement_status)
      AND ((EXCLUDED.commission_settlement_date IS NOT NULL)::INT)
        = ((public.content_order_facts.commission_settlement_date IS NOT NULL)::INT)
      AND COALESCE(EXCLUDED.staging_row_id::TEXT, '')
        > COALESCE(public.content_order_facts.staging_row_id::TEXT, '')
    );

  UPDATE public.tiktok_affiliate_import_batches b
  SET
    status = 'normalized',
    normalized_row_count = COALESCE(stats.winner_row_count, 0),
    skipped_row_count = COALESCE(stats.missing_key_row_count, 0)
      + COALESCE(stats.invalid_value_row_count, 0)
      + COALESCE(stats.duplicate_non_winner_row_count, 0),
    error_count = COALESCE(stats.missing_key_row_count, 0)
      + COALESCE(stats.invalid_value_row_count, 0),
    metadata = COALESCE(b.metadata, '{}'::jsonb) || jsonb_build_object(
      'normalization_completed_at', NOW(),
      'staging_row_count', COALESCE(stats.staging_row_count, 0),
      'valid_candidate_row_count', COALESCE(stats.valid_candidate_row_count, 0),
      'winner_row_count', COALESCE(stats.winner_row_count, 0),
      'missing_key_row_count', COALESCE(stats.missing_key_row_count, 0),
      'invalid_value_row_count', COALESCE(stats.invalid_value_row_count, 0),
      'duplicate_non_winner_row_count', COALESCE(stats.duplicate_non_winner_row_count, 0),
      'missing_key_field_counts', COALESCE(stats.missing_key_field_counts, '{}'::jsonb),
      'missing_key_sample_rows', COALESCE(stats.missing_key_sample_rows, '[]'::jsonb),
      'invalid_value_field_counts', COALESCE(stats.invalid_value_field_counts, '{}'::jsonb),
      'invalid_value_sample_rows', COALESCE(stats.invalid_value_sample_rows, '[]'::jsonb),
      'duplicate_non_winner_sample_rows', COALESCE(stats.duplicate_non_winner_sample_rows, '[]'::jsonb)
    )
  FROM tmp_tiktok_affiliate_batch_stats stats
  WHERE b.id = p_import_batch_id;

  RETURN QUERY
  SELECT
    stats.staging_row_count,
    stats.valid_candidate_row_count,
    stats.winner_row_count,
    stats.missing_key_row_count,
    stats.invalid_value_row_count,
    stats.duplicate_non_winner_row_count
  FROM tmp_tiktok_affiliate_batch_stats stats;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_tiktok_affiliate_order_batch(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_tiktok_affiliate_order_batch(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_tiktok_affiliate_order_batch(UUID) TO service_role;

COMMIT;
