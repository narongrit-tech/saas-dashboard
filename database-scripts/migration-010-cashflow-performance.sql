-- Migration 010: Cashflow Performance Optimization
-- Purpose: Indexes + Pre-aggregated Daily Summary
-- Date: 2026-01-25

-- ============================================
-- A) INDEXES FOR DATE RANGE QUERIES
-- ============================================

-- Settlement transactions (actual income)
CREATE INDEX IF NOT EXISTS idx_settlement_transactions_user_date
ON settlement_transactions(created_by, settled_time)
WHERE settled_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_settlement_transactions_user_marketplace_date
ON settlement_transactions(created_by, marketplace, settled_time)
WHERE settled_time IS NOT NULL;

-- Unsettled transactions (forecast)
CREATE INDEX IF NOT EXISTS idx_unsettled_transactions_user_date
ON unsettled_transactions(created_by, estimated_settle_time)
WHERE estimated_settle_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unsettled_transactions_user_marketplace_date
ON unsettled_transactions(created_by, marketplace, estimated_settle_time)
WHERE estimated_settle_time IS NOT NULL;

-- Status index for filtering
CREATE INDEX IF NOT EXISTS idx_unsettled_transactions_status
ON unsettled_transactions(status);

-- ============================================
-- B) PRE-AGGREGATED DAILY SUMMARY TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS cashflow_daily_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,

  -- Forecast (unsettled)
  forecast_sum DECIMAL(15,2) NOT NULL DEFAULT 0,
  forecast_count INTEGER NOT NULL DEFAULT 0,

  -- Actual (settlement)
  actual_sum DECIMAL(15,2) NOT NULL DEFAULT 0,
  actual_count INTEGER NOT NULL DEFAULT 0,

  -- Gap
  gap_sum DECIMAL(15,2) NOT NULL DEFAULT 0,

  -- Status counts
  matched_count INTEGER NOT NULL DEFAULT 0,
  overdue_count INTEGER NOT NULL DEFAULT 0,
  forecast_only_count INTEGER NOT NULL DEFAULT 0,
  actual_only_count INTEGER NOT NULL DEFAULT 0,

  -- Metadata
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(created_by, date)
);

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_cashflow_daily_summary_user_date
ON cashflow_daily_summary(created_by, date);

-- RLS Policies
ALTER TABLE cashflow_daily_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cashflow summary"
ON cashflow_daily_summary
FOR SELECT
USING (auth.uid() = created_by);

CREATE POLICY "Users can insert own cashflow summary"
ON cashflow_daily_summary
FOR INSERT
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update own cashflow summary"
ON cashflow_daily_summary
FOR UPDATE
USING (auth.uid() = created_by);

-- ============================================
-- C) HELPER FUNCTION: REBUILD DAILY SUMMARY
-- ============================================

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
  -- Delete existing summary for date range
  DELETE FROM cashflow_daily_summary
  WHERE created_by = p_user_id
    AND date >= p_start_date
    AND date <= p_end_date;

  -- Rebuild from raw data
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
    p_user_id,
    d.date,
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
      WHEN f.forecast_sum IS NOT NULL AND a.actual_sum IS NULL AND d.date < CURRENT_DATE THEN 1
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
    generate_series(p_start_date, p_end_date, '1 day'::interval)::date AS d(date)
  LEFT JOIN (
    SELECT
      DATE(estimated_settle_time) AS date,
      SUM(estimated_settlement_amount) AS forecast_sum,
      COUNT(*) AS forecast_count
    FROM unsettled_transactions
    WHERE created_by = p_user_id
      AND estimated_settle_time IS NOT NULL
      AND DATE(estimated_settle_time) >= p_start_date
      AND DATE(estimated_settle_time) <= p_end_date
      AND status = 'unsettled'
    GROUP BY DATE(estimated_settle_time)
  ) f ON f.date = d.date
  LEFT JOIN (
    SELECT
      DATE(settled_time) AS date,
      SUM(settlement_amount) AS actual_sum,
      COUNT(*) AS actual_count
    FROM settlement_transactions
    WHERE created_by = p_user_id
      AND settled_time IS NOT NULL
      AND DATE(settled_time) >= p_start_date
      AND DATE(settled_time) <= p_end_date
    GROUP BY DATE(settled_time)
  ) a ON a.date = d.date
  WHERE f.forecast_sum IS NOT NULL OR a.actual_sum IS NOT NULL;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  RETURN v_rows_affected;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION rebuild_cashflow_daily_summary(UUID, DATE, DATE) TO authenticated;

-- ============================================
-- D) COMMENTS
-- ============================================

COMMENT ON TABLE cashflow_daily_summary IS 'Pre-aggregated daily cashflow summary for fast page loads';
COMMENT ON FUNCTION rebuild_cashflow_daily_summary IS 'Rebuild cashflow summary for a date range (called after import or on-demand)';

-- ============================================
-- E) VERIFY INDEXES
-- ============================================

-- Run EXPLAIN to verify index usage:
-- EXPLAIN ANALYZE
-- SELECT SUM(settlement_amount), COUNT(*)
-- FROM settlement_transactions
-- WHERE created_by = 'user-uuid'
--   AND settled_time >= '2026-01-01'
--   AND settled_time < '2026-02-01';
