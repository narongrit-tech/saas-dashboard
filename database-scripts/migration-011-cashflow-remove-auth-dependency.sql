-- Migration 011: Remove auth.uid() Dependency from Cashflow
-- Purpose: Allow service role imports to be visible to all authenticated users
-- Reason: Internal dashboard (single tenant) - all users should see all cashflow data
-- Date: 2026-01-25

-- ============================================
-- A) REMOVE RLS FROM CASHFLOW TABLES
-- ============================================
-- For internal dashboard, we disable RLS to allow all authenticated users to see all data
-- This fixes the issue where service role imports are not visible

-- 1. settlement_transactions
ALTER TABLE settlement_transactions DISABLE ROW LEVEL SECURITY;

-- 2. unsettled_transactions
ALTER TABLE unsettled_transactions DISABLE ROW LEVEL SECURITY;

-- 3. cashflow_daily_summary
ALTER TABLE cashflow_daily_summary DISABLE ROW LEVEL SECURITY;

-- Drop old policies (cleanup)
DROP POLICY IF EXISTS "Users can view own cashflow summary" ON cashflow_daily_summary;
DROP POLICY IF EXISTS "Users can insert own cashflow summary" ON cashflow_daily_summary;
DROP POLICY IF EXISTS "Users can update own cashflow summary" ON cashflow_daily_summary;

-- ============================================
-- B) BACKFILL NULL estimated_settle_time
-- ============================================
-- Fix rows where estimated_settle_time is NULL
-- Use fallback: created_at + 7 days (TikTok standard settlement window)

DO $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  -- Update NULL rows with fallback: created_at + 7 days
  UPDATE unsettled_transactions
  SET estimated_settle_time = created_at + interval '7 days'
  WHERE estimated_settle_time IS NULL
    AND marketplace = 'tiktok';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  -- Log result
  RAISE NOTICE '[Cashflow] Backfilled % rows with NULL estimated_settle_time', v_updated_count;
END $$;

-- ============================================
-- C) UPDATE rebuild_cashflow_daily_summary
-- ============================================
-- Remove created_by filter to support service role imports

CREATE OR REPLACE FUNCTION rebuild_cashflow_daily_summary(
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
  -- Delete existing summary for date range (ALL users - not just p_user_id)
  -- This allows service role imports to rebuild for everyone
  DELETE FROM cashflow_daily_summary
  WHERE date >= p_start_date
    AND date <= p_end_date;

  -- Rebuild from raw data (aggregate ALL data, not filtered by user)
  INSERT INTO cashflow_daily_summary (
    created_by,
    date,
    forecast_sum,
    forecast_count,
    actual_sum,
    actual_count,
    gap_sum,
    matched_count,
    overdue_count,
    forecast_only_count,
    actual_only_count
  )
  SELECT
    p_user_id, -- Use provided user_id for ownership (but data is from all sources)
    date_gen::date,
    COALESCE(f.forecast_sum, 0) AS forecast_sum,
    COALESCE(f.forecast_count, 0) AS forecast_count,
    COALESCE(a.actual_sum, 0) AS actual_sum,
    COALESCE(a.actual_count, 0) AS actual_count,
    COALESCE(a.actual_sum, 0) - COALESCE(f.forecast_sum, 0) AS gap_sum,
    CASE
      WHEN f.forecast_sum IS NOT NULL AND a.actual_sum IS NOT NULL THEN 1
      ELSE 0
    END AS matched_count,
    CASE
      WHEN f.forecast_sum IS NOT NULL AND a.actual_sum IS NULL AND date_gen::date < CURRENT_DATE THEN 1
      ELSE 0
    END AS overdue_count,
    CASE
      WHEN f.forecast_sum IS NOT NULL AND a.actual_sum IS NULL THEN 1
      ELSE 0
    END AS forecast_only_count,
    CASE
      WHEN f.forecast_sum IS NULL AND a.actual_sum IS NOT NULL THEN 1
      ELSE 0
    END AS actual_only_count
  FROM
    generate_series(p_start_date, p_end_date, '1 day'::interval) AS date_gen
  LEFT JOIN (
    SELECT
      (estimated_settle_time AT TIME ZONE 'Asia/Bangkok')::date AS date,
      SUM(estimated_settlement_amount) AS forecast_sum,
      COUNT(*) AS forecast_count
    FROM unsettled_transactions
    WHERE estimated_settle_time IS NOT NULL
      AND (estimated_settle_time AT TIME ZONE 'Asia/Bangkok')::date >= p_start_date
      AND (estimated_settle_time AT TIME ZONE 'Asia/Bangkok')::date <= p_end_date
      AND status = 'unsettled'
      -- REMOVED: created_by filter
    GROUP BY (estimated_settle_time AT TIME ZONE 'Asia/Bangkok')::date
  ) f ON f.date = date_gen::date
  LEFT JOIN (
    SELECT
      (settled_time AT TIME ZONE 'Asia/Bangkok')::date AS date,
      SUM(settlement_amount) AS actual_sum,
      COUNT(*) AS actual_count
    FROM settlement_transactions
    WHERE settled_time IS NOT NULL
      AND (settled_time AT TIME ZONE 'Asia/Bangkok')::date >= p_start_date
      AND (settled_time AT TIME ZONE 'Asia/Bangkok')::date <= p_end_date
      -- REMOVED: created_by filter
    GROUP BY (settled_time AT TIME ZONE 'Asia/Bangkok')::date
  ) a ON a.date = date_gen::date
  WHERE f.forecast_sum IS NOT NULL OR a.actual_sum IS NOT NULL;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  -- Log rebuild success
  RAISE NOTICE '[Cashflow] Summary rebuilt: start=%, end=%, rows=%', p_start_date, p_end_date, v_rows_affected;

  RETURN v_rows_affected;
END;
$$;

-- ============================================
-- D) ADD INDEXES (if not exists)
-- ============================================

-- Marketplace + date indexes (for filtering without created_by)
-- Note: Use CAST() syntax for expression indexes
CREATE INDEX IF NOT EXISTS idx_settlement_transactions_marketplace_date
ON settlement_transactions(marketplace, CAST((settled_time AT TIME ZONE 'Asia/Bangkok') AS date))
WHERE settled_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unsettled_transactions_marketplace_date
ON unsettled_transactions(marketplace, CAST((estimated_settle_time AT TIME ZONE 'Asia/Bangkok') AS date))
WHERE estimated_settle_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cashflow_daily_summary_date
ON cashflow_daily_summary(date);

-- ============================================
-- E) GRANT PERMISSIONS
-- ============================================

-- Ensure authenticated users can access all tables
GRANT SELECT, INSERT, UPDATE ON settlement_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON unsettled_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cashflow_daily_summary TO authenticated;

-- ============================================
-- F) COMMENTS
-- ============================================

COMMENT ON TABLE settlement_transactions IS 'Actual settlements (income) - visible to all authenticated users';
COMMENT ON TABLE unsettled_transactions IS 'Forecast transactions (onhold) - visible to all authenticated users';
COMMENT ON TABLE cashflow_daily_summary IS 'Pre-aggregated daily summary - visible to all authenticated users';

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Run after migration to verify:

-- 1. Check NULL estimated_settle_time (should be 0)
-- SELECT COUNT(*) FILTER (WHERE estimated_settle_time IS NULL) as null_count
-- FROM unsettled_transactions WHERE marketplace = 'tiktok';

-- 2. Check RLS is disabled
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('settlement_transactions', 'unsettled_transactions', 'cashflow_daily_summary');
-- Expected: rowsecurity = false for all 3 tables

-- 3. Test rebuild function
-- SELECT rebuild_cashflow_daily_summary(
--   (SELECT id FROM auth.users LIMIT 1),
--   '2026-01-01'::date,
--   '2026-01-31'::date
-- );
