-- ============================================
-- Verify Ads Import
-- Purpose: Verify ads import data consistency
-- Date: 2026-01-26
-- ============================================

-- ============================================
-- 1. VERIFY IMPORT BATCHES
-- ============================================

SELECT
  id,
  report_type,
  file_hash,
  status,
  row_count,
  inserted_count,
  updated_count,
  error_count,
  metadata,
  created_at,
  file_name
FROM import_batches
WHERE report_type = 'tiktok_ads_daily'
  AND created_by = auth.uid()
ORDER BY created_at DESC
LIMIT 5;

-- ============================================
-- 2. VERIFY AD_DAILY_PERFORMANCE
-- ============================================

-- Latest records
SELECT
  ad_date,
  campaign_type,
  campaign_name,
  spend,
  revenue,
  orders,
  roi,
  import_batch_id,
  created_at
FROM ad_daily_performance
WHERE created_by = auth.uid()
ORDER BY created_at DESC
LIMIT 10;

-- Check spend sum by date
SELECT
  ad_date,
  campaign_type,
  COUNT(*) as row_count,
  SUM(spend) as total_spend,
  SUM(revenue) as total_revenue,
  SUM(orders) as total_orders,
  ROUND(AVG(roi), 2) as avg_roi
FROM ad_daily_performance
WHERE created_by = auth.uid()
GROUP BY ad_date, campaign_type
ORDER BY ad_date DESC
LIMIT 10;

-- ============================================
-- 3. VERIFY WALLET_LEDGER (ADS SPEND)
-- ============================================

SELECT
  date,
  entry_type,
  direction,
  amount,
  source,
  reference_id,
  wallet_id,
  note,
  created_at
FROM wallet_ledger
WHERE source = 'IMPORTED'
  AND entry_type = 'SPEND'
  AND created_by = auth.uid()
ORDER BY created_at DESC
LIMIT 10;

-- Check daily aggregation
SELECT
  date,
  COUNT(*) as entry_count,
  SUM(amount) as total_spend
FROM wallet_ledger
WHERE source = 'IMPORTED'
  AND entry_type = 'SPEND'
  AND created_by = auth.uid()
GROUP BY date
ORDER BY date DESC
LIMIT 10;

-- ============================================
-- 4. VERIFY WALLET BALANCE INTEGRITY
-- ============================================

SELECT
  w.name as wallet_name,
  COUNT(wl.id) as ledger_entries,
  SUM(CASE WHEN wl.direction = 'IN' THEN wl.amount ELSE 0 END) as total_in,
  SUM(CASE WHEN wl.direction = 'OUT' THEN wl.amount ELSE 0 END) as total_out,
  SUM(CASE WHEN wl.direction = 'IN' THEN wl.amount ELSE -wl.amount END) as net_balance
FROM wallets w
LEFT JOIN wallet_ledger wl ON w.id = wl.wallet_id
WHERE w.name = 'TikTok Ads'
  AND w.created_by = auth.uid()
GROUP BY w.id, w.name;

-- ============================================
-- 5. VERIFY DATA CONSISTENCY
-- (ad_daily_performance vs wallet_ledger)
-- ============================================

WITH ads_spend AS (
  SELECT
    import_batch_id,
    ad_date,
    SUM(spend) as total_spend,
    COUNT(*) as row_count
  FROM ad_daily_performance
  WHERE created_by = auth.uid()
  GROUP BY import_batch_id, ad_date
),
wallet_spend AS (
  SELECT
    reference_id as import_batch_id,
    date,
    SUM(amount) as total_wallet_spend,
    COUNT(*) as entry_count
  FROM wallet_ledger
  WHERE source = 'IMPORTED'
    AND entry_type = 'SPEND'
    AND created_by = auth.uid()
  GROUP BY reference_id, date
)
SELECT
  a.import_batch_id,
  a.ad_date,
  a.total_spend as ads_spend,
  a.row_count as ads_row_count,
  COALESCE(w.total_wallet_spend, 0) as wallet_spend,
  COALESCE(w.entry_count, 0) as wallet_entry_count,
  ABS(a.total_spend - COALESCE(w.total_wallet_spend, 0)) as difference
FROM ads_spend a
LEFT JOIN wallet_spend w ON a.import_batch_id = w.import_batch_id AND a.ad_date = w.date
ORDER BY difference DESC, a.ad_date DESC
LIMIT 20;

-- ============================================
-- 6. CHECK METADATA COLUMN
-- ============================================

SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'import_batches'
  AND column_name = 'metadata';

-- ============================================
-- 7. RECENT IMPORT ERRORS
-- ============================================

SELECT
  id,
  report_type,
  status,
  notes,
  error_count,
  created_at
FROM import_batches
WHERE status = 'failed'
  AND created_by = auth.uid()
ORDER BY created_at DESC
LIMIT 5;

-- ============================================
-- END OF VERIFY
-- ============================================
