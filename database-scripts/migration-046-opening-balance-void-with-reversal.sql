-- ============================================
-- Migration 046: Opening Balance Void with COGS Reversal
-- Description: Add reversal tracking columns and rebuild function for safe voiding
-- Date: 2026-02-03
-- ============================================

-- ============================================
-- PART 1: ADD COLUMNS
-- ============================================

-- Add void_reason to inventory_receipt_layers
ALTER TABLE public.inventory_receipt_layers
ADD COLUMN IF NOT EXISTS void_reason TEXT;

COMMENT ON COLUMN public.inventory_receipt_layers.void_reason
IS 'User-provided reason for voiding this layer (required, min 10 chars)';

-- Add reversal tracking to inventory_cogs_allocations
ALTER TABLE public.inventory_cogs_allocations
ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.inventory_cogs_allocations
ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_cogs_allocations
ADD COLUMN IF NOT EXISTS reversed_reason TEXT;

COMMENT ON COLUMN public.inventory_cogs_allocations.reversed_at
IS 'Timestamp when this allocation was reversed (e.g., due to opening balance void)';

COMMENT ON COLUMN public.inventory_cogs_allocations.reversed_by
IS 'User who reversed this allocation';

COMMENT ON COLUMN public.inventory_cogs_allocations.reversed_reason
IS 'Reason for reversal (e.g., "Opening balance voided: duplicate entry")';

-- ============================================
-- PART 2: CREATE INDEXES
-- ============================================

-- Index for active (non-reversed) allocations by layer (FIFO lookups)
CREATE INDEX IF NOT EXISTS idx_cogs_allocations_layer_active
ON public.inventory_cogs_allocations(layer_id, reversed_at)
WHERE reversed_at IS NULL AND is_reversal = false;

-- Index for reversed allocations (audit queries)
CREATE INDEX IF NOT EXISTS idx_cogs_allocations_reversed
ON public.inventory_cogs_allocations(reversed_at, reversed_by)
WHERE reversed_at IS NOT NULL;

-- Index for daily COGS queries (exclude reversed)
CREATE INDEX IF NOT EXISTS idx_cogs_allocations_shipped_active
ON public.inventory_cogs_allocations(shipped_at, reversed_at)
WHERE reversed_at IS NULL;

-- ============================================
-- PART 3: REBUILD FUNCTION FOR INVENTORY SNAPSHOTS
-- ============================================

CREATE OR REPLACE FUNCTION rebuild_inventory_snapshots(
  p_user_id UUID,
  p_sku_internal VARCHAR(100),
  p_start_date DATE,
  p_end_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows_affected INTEGER := 0;
  v_current_date DATE;
  v_prev_qty DECIMAL(12, 4);
  v_prev_value DECIMAL(12, 2);
BEGIN
  -- ============================================
  -- 1) DELETE EXISTING SNAPSHOTS FOR DATE RANGE
  -- ============================================
  DELETE FROM public.inventory_cost_snapshots
  WHERE created_by = p_user_id
    AND sku_internal = p_sku_internal
    AND as_of_date BETWEEN p_start_date AND p_end_date;

  RAISE NOTICE 'Deleted existing snapshots for SKU % from % to %',
    p_sku_internal, p_start_date, p_end_date;

  -- ============================================
  -- 2) GET STARTING POINT (DAY BEFORE START)
  -- ============================================
  SELECT
    COALESCE(on_hand_qty, 0),
    COALESCE(on_hand_value, 0)
  INTO v_prev_qty, v_prev_value
  FROM public.inventory_cost_snapshots
  WHERE created_by = p_user_id
    AND sku_internal = p_sku_internal
    AND as_of_date < p_start_date
  ORDER BY as_of_date DESC
  LIMIT 1;

  -- If no previous snapshot, start from zero
  v_prev_qty := COALESCE(v_prev_qty, 0);
  v_prev_value := COALESCE(v_prev_value, 0);

  RAISE NOTICE 'Starting point: qty=%, value=%', v_prev_qty, v_prev_value;

  -- ============================================
  -- 3) REBUILD SNAPSHOTS DAY BY DAY
  -- ============================================
  v_current_date := p_start_date;

  WHILE v_current_date <= p_end_date LOOP
    -- Calculate receipts for this day (non-voided layers only)
    WITH daily_receipts AS (
      SELECT
        COALESCE(SUM(qty_received), 0) as receipt_qty,
        COALESCE(SUM(qty_received * unit_cost), 0) as receipt_value
      FROM public.inventory_receipt_layers
      WHERE created_by = p_user_id
        AND sku_internal = p_sku_internal
        AND DATE(received_at AT TIME ZONE 'Asia/Bangkok') = v_current_date
        AND is_voided = false  -- Exclude voided layers
    ),
    -- Calculate COGS for this day (non-reversed allocations, AVG method only)
    daily_cogs AS (
      SELECT
        COALESCE(SUM(qty), 0) as cogs_qty,
        COALESCE(SUM(amount), 0) as cogs_value
      FROM public.inventory_cogs_allocations
      WHERE created_by = p_user_id
        AND sku_internal = p_sku_internal
        AND DATE(shipped_at AT TIME ZONE 'Asia/Bangkok') = v_current_date
        AND method = 'AVG'
        AND is_reversal = false
        AND reversed_at IS NULL  -- ⭐ CRITICAL: Exclude reversed allocations
    )
    SELECT
      v_prev_qty + r.receipt_qty - c.cogs_qty,
      v_prev_value + r.receipt_value - c.cogs_value
    INTO v_prev_qty, v_prev_value
    FROM daily_receipts r, daily_cogs c;

    -- Insert snapshot for this day
    INSERT INTO public.inventory_cost_snapshots (
      sku_internal,
      as_of_date,
      on_hand_qty,
      on_hand_value,
      avg_unit_cost,
      created_by,
      created_at,
      updated_at
    ) VALUES (
      p_sku_internal,
      v_current_date,
      v_prev_qty,
      v_prev_value,
      CASE WHEN v_prev_qty > 0 THEN v_prev_value / v_prev_qty ELSE 0 END,
      p_user_id,
      NOW(),
      NOW()
    )
    ON CONFLICT (sku_internal, as_of_date, created_by)
    DO UPDATE SET
      on_hand_qty = EXCLUDED.on_hand_qty,
      on_hand_value = EXCLUDED.on_hand_value,
      avg_unit_cost = EXCLUDED.avg_unit_cost,
      updated_at = NOW();

    v_rows_affected := v_rows_affected + 1;
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  RAISE NOTICE 'Rebuilt % snapshot rows for SKU %', v_rows_affected, p_sku_internal;

  RETURN v_rows_affected;
END;
$$;

COMMENT ON FUNCTION rebuild_inventory_snapshots IS
'Rebuilds inventory_cost_snapshots for a specific SKU and date range (AVG method).
Excludes voided layers and reversed allocations.
Used after voiding opening balance layers to ensure accurate COGS reporting.';

-- ============================================
-- VERIFICATION QUERIES (RUN AFTER MIGRATION)
-- ============================================

-- Check if columns exist
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'inventory_receipt_layers'
--   AND column_name = 'void_reason';

-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'inventory_cogs_allocations'
--   AND column_name IN ('reversed_at', 'reversed_by', 'reversed_reason');

-- Check if indexes exist
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'inventory_cogs_allocations'
--   AND indexname LIKE 'idx_cogs_allocations_%';

-- Test rebuild function (example - replace with actual data)
-- SELECT rebuild_inventory_snapshots(
--   '00000000-0000-0000-0000-000000000000'::UUID,  -- Replace with actual user_id
--   'TEST-SKU',
--   '2026-01-01'::DATE,
--   '2026-01-31'::DATE
-- );

-- ============================================
-- END OF MIGRATION
-- ============================================
