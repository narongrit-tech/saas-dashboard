-- ============================================
-- Verify Migration 039: Check for Duplicates
-- ============================================

-- 1) Check if rebuild_profit_summaries function was updated
SELECT
  routine_name,
  routine_definition LIKE '%MAX(s.product_name)%' as has_fix
FROM information_schema.routines
WHERE routine_name = 'rebuild_profit_summaries'
  AND routine_schema = 'public';

-- 2) Check for duplicate keys in product_profit_daily (should be 0)
-- This query identifies any rows that violate the unique constraint
SELECT
  created_by,
  date,
  platform,
  product_id,
  COUNT(*) as duplicate_count,
  STRING_AGG(DISTINCT product_name, ', ') as different_names
FROM product_profit_daily
GROUP BY created_by, date, platform, product_id
HAVING COUNT(*) > 1;

-- 3) Check row counts in summary tables
SELECT
  'platform_net_profit_daily' as table_name,
  COUNT(*) as row_count,
  MIN(date) as earliest_date,
  MAX(date) as latest_date
FROM platform_net_profit_daily
UNION ALL
SELECT
  'product_profit_daily',
  COUNT(*),
  MIN(date),
  MAX(date)
FROM product_profit_daily
UNION ALL
SELECT
  'source_split_daily',
  COUNT(*),
  MIN(date),
  MAX(date)
FROM source_split_daily;

-- 4) Sample data from product_profit_daily (top 10 by revenue)
SELECT
  date,
  platform,
  product_id,
  product_name,
  revenue,
  allocated_ads,
  cogs,
  margin,
  ROUND(margin_pct::numeric, 2) as margin_pct
FROM product_profit_daily
ORDER BY revenue DESC
LIMIT 10;

-- ============================================
-- Expected Results:
-- 1) has_fix should be TRUE
-- 2) No rows returned (0 duplicates)
-- 3) Row counts > 0 if rebuild was successful
-- 4) Sample data showing product profit breakdown
-- ============================================
