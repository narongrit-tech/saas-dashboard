-- ============================================
-- Verification: TikTok Affiliate Content Attribution Foundation
-- Run after staging + normalization.
-- ============================================

-- 1) Batch summary
SELECT
  id,
  created_at,
  created_by,
  source_file_name,
  source_sheet_name,
  status,
  raw_row_count,
  staged_row_count,
  normalized_row_count,
  skipped_row_count,
  error_count,
  metadata
FROM public.tiktok_affiliate_import_batches
ORDER BY created_at DESC
LIMIT 20;

-- 2) Duplicate raw row identity inside a batch
SELECT
  created_by,
  import_batch_id,
  source_file_name,
  source_sheet_name,
  source_row_number,
  COUNT(*) AS dup_count
FROM public.tiktok_affiliate_order_raw_staging
GROUP BY created_by, import_batch_id, source_file_name, source_sheet_name, source_row_number
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, import_batch_id DESC;

-- 3) Missing join-key checks in staging
SELECT
  import_batch_id,
  COUNT(*) FILTER (WHERE public.tiktok_affiliate_trim_null(order_id) IS NULL) AS missing_order_id,
  COUNT(*) FILTER (WHERE public.tiktok_affiliate_trim_null(sku_id) IS NULL) AS missing_sku_id,
  COUNT(*) FILTER (WHERE public.tiktok_affiliate_trim_null(product_id) IS NULL) AS missing_product_id,
  COUNT(*) FILTER (WHERE public.tiktok_affiliate_trim_null(content_id) IS NULL) AS missing_content_id
FROM public.tiktok_affiliate_order_raw_staging
GROUP BY import_batch_id
ORDER BY import_batch_id DESC;

-- 4) Malformed money / rate / count fields in staging using the full normalization matrix
WITH invalid_rows AS (
  SELECT
    s.import_batch_id,
    s.id AS staging_row_id,
    s.source_row_number,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN public.tiktok_affiliate_trim_null(s.price_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.price_text) IS NULL THEN 'price' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.items_sold_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_count(s.items_sold_text) IS NULL THEN 'items_sold' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.items_refunded_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_count(s.items_refunded_text) IS NULL THEN 'items_refunded' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.gmv_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.gmv_text) IS NULL THEN 'gmv' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.standard_rate_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_rate(s.standard_rate_text) IS NULL THEN 'standard_rate' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.shop_ads_rate_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_rate(s.shop_ads_rate_text) IS NULL THEN 'shop_ads_rate' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.tiktok_bonus_rate_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_rate(s.tiktok_bonus_rate_text) IS NULL THEN 'tiktok_bonus_rate' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.partner_bonus_rate_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_rate(s.partner_bonus_rate_text) IS NULL THEN 'partner_bonus_rate' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.revenue_sharing_portion_rate_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_rate(s.revenue_sharing_portion_rate_text) IS NULL THEN 'revenue_sharing_portion_rate' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.est_commission_base_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_commission_base_text) IS NULL THEN 'est_commission_base' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.est_standard_commission_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_standard_commission_text) IS NULL THEN 'est_standard_commission' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.est_shop_ads_commission_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_shop_ads_commission_text) IS NULL THEN 'est_shop_ads_commission' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.est_bonus_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_bonus_text) IS NULL THEN 'est_bonus' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.est_affiliate_partner_bonus_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_affiliate_partner_bonus_text) IS NULL THEN 'est_affiliate_partner_bonus' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.est_iva_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_iva_text) IS NULL THEN 'est_iva' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.est_isr_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_isr_text) IS NULL THEN 'est_isr' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.est_pit_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_pit_text) IS NULL THEN 'est_pit' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.est_revenue_sharing_portion_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.est_revenue_sharing_portion_text) IS NULL THEN 'est_revenue_sharing_portion' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.actual_commission_base_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.actual_commission_base_text) IS NULL THEN 'actual_commission_base' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.standard_commission_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.standard_commission_text) IS NULL THEN 'standard_commission' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.shop_ads_commission_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.shop_ads_commission_text) IS NULL THEN 'shop_ads_commission' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.bonus_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.bonus_text) IS NULL THEN 'bonus' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.affiliate_partner_bonus_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.affiliate_partner_bonus_text) IS NULL THEN 'affiliate_partner_bonus' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.shared_with_partner_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.shared_with_partner_text) IS NULL THEN 'shared_with_partner' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.tax_isr_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.tax_isr_text) IS NULL THEN 'tax_isr' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.tax_iva_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.tax_iva_text) IS NULL THEN 'tax_iva' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.tax_pit_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.tax_pit_text) IS NULL THEN 'tax_pit' END,
      CASE WHEN public.tiktok_affiliate_trim_null(s.total_final_earned_amount_text) IS NOT NULL
        AND public.tiktok_affiliate_parse_money(s.total_final_earned_amount_text) IS NULL THEN 'total_final_earned_amount' END
    ], NULL) AS invalid_fields
  FROM public.tiktok_affiliate_order_raw_staging s
),
invalid_field_counts AS (
  SELECT
    import_batch_id,
    invalid_field,
    COUNT(*) AS field_count
  FROM invalid_rows
  CROSS JOIN LATERAL unnest(invalid_fields) AS invalid_field
  WHERE array_length(invalid_fields, 1) > 0
  GROUP BY import_batch_id, invalid_field
),
malformed_rows AS (
  SELECT *
  FROM invalid_rows
  WHERE array_length(invalid_fields, 1) > 0
)
SELECT
  r.import_batch_id,
  COUNT(*) AS malformed_row_count,
  COALESCE(
    (
      SELECT jsonb_object_agg(f.invalid_field, f.field_count)
      FROM invalid_field_counts f
      WHERE f.import_batch_id = r.import_batch_id
    ),
    '{}'::jsonb
  ) AS invalid_field_counts,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'staging_row_id', sample_rows.staging_row_id,
          'source_row_number', sample_rows.source_row_number,
          'invalid_fields', to_jsonb(sample_rows.invalid_fields)
        )
        ORDER BY sample_rows.source_row_number, sample_rows.staging_row_id
      )
      FROM (
        SELECT staging_row_id, source_row_number, invalid_fields
        FROM malformed_rows
        WHERE import_batch_id = r.import_batch_id
        ORDER BY source_row_number, staging_row_id
        LIMIT 25
      ) sample_rows
    ),
    '[]'::jsonb
  ) AS sample_rows
FROM malformed_rows r
GROUP BY r.import_batch_id
ORDER BY r.import_batch_id DESC;

-- 5) Duplicate fact grain check
SELECT
  created_by,
  order_id,
  sku_id,
  product_id,
  content_id,
  COUNT(*) AS dup_count
FROM public.content_order_facts
GROUP BY created_by, order_id, sku_id, product_id, content_id
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, order_id;

-- 6) Null or unknown settlement statuses in facts
SELECT
  import_batch_id,
  order_settlement_status,
  COUNT(*) AS row_count
FROM public.content_order_facts
WHERE order_settlement_status IS NULL
   OR order_settlement_status = 'unknown'
GROUP BY import_batch_id, order_settlement_status
ORDER BY import_batch_id DESC, order_settlement_status;

-- 7) Negative-value safety check
SELECT
  COUNT(*) AS negative_value_rows
FROM public.content_order_facts
WHERE price < 0
   OR gmv < 0
   OR items_sold < 0
   OR items_refunded < 0
   OR total_commission_amount < 0
   OR total_earned_amount < 0;

-- 8) Rejected-row accounting and batch metadata reconciliation
WITH normalized_source AS (
  SELECT
    s.id AS staging_row_id,
    s.import_batch_id,
    s.created_by,
    s.source_row_number,
    public.tiktok_affiliate_trim_null(s.order_id) AS order_id,
    public.tiktok_affiliate_trim_null(s.sku_id) AS sku_id,
    public.tiktok_affiliate_trim_null(s.product_id) AS product_id,
    public.tiktok_affiliate_trim_null(s.content_id) AS content_id,
    public.tiktok_affiliate_normalize_status(s.order_settlement_status) AS order_settlement_status,
    public.tiktok_affiliate_parse_timestamp(s.commission_settlement_date_text) AS commission_settlement_date,
    s.created_at,
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
),
classified AS (
  SELECT
    n.*,
    n.order_id IS NULL
      OR n.sku_id IS NULL
      OR n.product_id IS NULL
      OR n.content_id IS NULL AS missing_required_key,
    (
      n.price_invalid
      OR n.items_sold_invalid
      OR n.items_refunded_invalid
      OR n.gmv_invalid
      OR n.standard_rate_invalid
      OR n.shop_ads_rate_invalid
      OR n.tiktok_bonus_rate_invalid
      OR n.partner_bonus_rate_invalid
      OR n.revenue_share_rate_invalid
      OR n.est_commission_base_invalid
      OR n.est_standard_invalid
      OR n.est_shop_ads_invalid
      OR n.est_bonus_invalid
      OR n.est_partner_bonus_invalid
      OR n.est_iva_invalid
      OR n.est_isr_invalid
      OR n.est_pit_invalid
      OR n.est_revenue_share_invalid
      OR n.actual_commission_base_invalid
      OR n.actual_standard_invalid
      OR n.actual_shop_ads_invalid
      OR n.actual_bonus_invalid
      OR n.actual_partner_bonus_invalid
      OR n.shared_with_partner_invalid
      OR n.tax_isr_invalid
      OR n.tax_iva_invalid
      OR n.tax_pit_invalid
      OR n.total_earned_invalid
    ) AS invalid_numeric_fields
  FROM normalized_source n
),
winners AS (
  SELECT *
  FROM (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        PARTITION BY c.created_by, c.order_id, c.sku_id, c.product_id, c.content_id
        ORDER BY
          c.created_at DESC,
          public.tiktok_affiliate_status_rank(c.order_settlement_status) DESC,
          (c.commission_settlement_date IS NOT NULL) DESC,
          c.staging_row_id DESC
      ) AS winner_rank
    FROM classified c
    WHERE NOT c.missing_required_key
      AND NOT c.invalid_numeric_fields
  ) ranked
  WHERE winner_rank = 1
),
duplicate_non_winners AS (
  SELECT c.*
  FROM classified c
  LEFT JOIN winners w
    ON w.staging_row_id = c.staging_row_id
  WHERE NOT c.missing_required_key
    AND NOT c.invalid_numeric_fields
    AND w.staging_row_id IS NULL
)
SELECT
  b.id AS import_batch_id,
  COALESCE(stats.staging_row_count, 0) AS computed_staging_row_count,
  COALESCE(stats.valid_candidate_row_count, 0) AS computed_valid_candidate_row_count,
  COALESCE(stats.winner_row_count, 0) AS computed_winner_row_count,
  COALESCE(stats.missing_key_row_count, 0) AS computed_missing_key_row_count,
  COALESCE(stats.invalid_value_row_count, 0) AS computed_invalid_value_row_count,
  COALESCE(stats.duplicate_non_winner_row_count, 0) AS computed_duplicate_non_winner_row_count,
  COALESCE(stats.staging_row_count, 0)
    - COALESCE(stats.winner_row_count, 0)
    - COALESCE(stats.missing_key_row_count, 0)
    - COALESCE(stats.invalid_value_row_count, 0)
    - COALESCE(stats.duplicate_non_winner_row_count, 0) AS computed_unaccounted_rows,
  b.normalized_row_count AS batch_normalized_row_count,
  b.skipped_row_count AS batch_skipped_row_count,
  b.error_count AS batch_error_count,
  (b.metadata ->> 'winner_row_count')::INTEGER AS metadata_winner_row_count,
  (b.metadata ->> 'missing_key_row_count')::INTEGER AS metadata_missing_key_row_count,
  (b.metadata ->> 'invalid_value_row_count')::INTEGER AS metadata_invalid_value_row_count,
  (b.metadata ->> 'duplicate_non_winner_row_count')::INTEGER AS metadata_duplicate_non_winner_row_count
FROM public.tiktok_affiliate_import_batches b
LEFT JOIN (
  SELECT
    import_batch_id,
    COUNT(*)::INTEGER AS staging_row_count,
    COUNT(*) FILTER (
      WHERE NOT missing_required_key
        AND NOT invalid_numeric_fields
    )::INTEGER AS valid_candidate_row_count,
    (SELECT COUNT(*)::INTEGER FROM winners w WHERE w.import_batch_id = c.import_batch_id) AS winner_row_count,
    COUNT(*) FILTER (WHERE missing_required_key)::INTEGER AS missing_key_row_count,
    COUNT(*) FILTER (WHERE NOT missing_required_key AND invalid_numeric_fields)::INTEGER AS invalid_value_row_count,
    (SELECT COUNT(*)::INTEGER FROM duplicate_non_winners d WHERE d.import_batch_id = c.import_batch_id) AS duplicate_non_winner_row_count
  FROM classified c
  GROUP BY import_batch_id
) stats
  ON stats.import_batch_id = b.id
ORDER BY b.created_at DESC
LIMIT 20;

-- 9) Staging-to-fact reconciliation using the full winner logic
WITH normalized_source AS (
  SELECT
    s.id AS staging_row_id,
    s.import_batch_id,
    s.created_by,
    public.tiktok_affiliate_trim_null(s.order_id) AS order_id,
    public.tiktok_affiliate_trim_null(s.sku_id) AS sku_id,
    public.tiktok_affiliate_trim_null(s.product_id) AS product_id,
    public.tiktok_affiliate_trim_null(s.content_id) AS content_id,
    public.tiktok_affiliate_normalize_status(s.order_settlement_status) AS order_settlement_status,
    public.tiktok_affiliate_parse_timestamp(s.commission_settlement_date_text) AS commission_settlement_date,
    s.created_at,
    public.tiktok_affiliate_parse_money(s.gmv_text) AS gmv,
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
),
classified AS (
  SELECT
    n.*,
    n.order_id IS NULL
      OR n.sku_id IS NULL
      OR n.product_id IS NULL
      OR n.content_id IS NULL AS missing_required_key,
    (
      n.price_invalid
      OR n.items_sold_invalid
      OR n.items_refunded_invalid
      OR n.gmv_invalid
      OR n.standard_rate_invalid
      OR n.shop_ads_rate_invalid
      OR n.tiktok_bonus_rate_invalid
      OR n.partner_bonus_rate_invalid
      OR n.revenue_share_rate_invalid
      OR n.est_commission_base_invalid
      OR n.est_standard_invalid
      OR n.est_shop_ads_invalid
      OR n.est_bonus_invalid
      OR n.est_partner_bonus_invalid
      OR n.est_iva_invalid
      OR n.est_isr_invalid
      OR n.est_pit_invalid
      OR n.est_revenue_share_invalid
      OR n.actual_commission_base_invalid
      OR n.actual_standard_invalid
      OR n.actual_shop_ads_invalid
      OR n.actual_bonus_invalid
      OR n.actual_partner_bonus_invalid
      OR n.shared_with_partner_invalid
      OR n.tax_isr_invalid
      OR n.tax_iva_invalid
      OR n.tax_pit_invalid
      OR n.total_earned_invalid
    ) AS invalid_numeric_fields
  FROM normalized_source n
),
winners AS (
  SELECT *
  FROM (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        PARTITION BY c.created_by, c.order_id, c.sku_id, c.product_id, c.content_id
        ORDER BY
          c.created_at DESC,
          public.tiktok_affiliate_status_rank(c.order_settlement_status) DESC,
          (c.commission_settlement_date IS NOT NULL) DESC,
          c.staging_row_id DESC
      ) AS winner_rank
    FROM classified c
    WHERE NOT c.missing_required_key
      AND NOT c.invalid_numeric_fields
  ) ranked
  WHERE winner_rank = 1
)
SELECT
  w.import_batch_id,
  COUNT(*) AS winning_staging_rows,
  ROUND(SUM(w.gmv), 2) AS winning_staging_gmv,
  ROUND(SUM(w.total_earned_amount), 2) AS winning_staging_earned,
  COUNT(f.id) AS current_fact_rows,
  ROUND(SUM(f.gmv), 2) AS current_fact_gmv,
  ROUND(SUM(f.total_earned_amount), 2) AS current_fact_earned
FROM winners w
LEFT JOIN public.content_order_facts f
  ON f.created_by = w.created_by
 AND f.order_id = w.order_id
 AND f.sku_id = w.sku_id
 AND f.product_id = w.product_id
 AND f.content_id = w.content_id
GROUP BY w.import_batch_id
ORDER BY w.import_batch_id DESC;
