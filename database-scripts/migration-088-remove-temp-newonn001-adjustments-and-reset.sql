-- migration-088: Remove temporary NEWONN001 manual adjustments + full COGS ledger reset
-- ──────────────────────────────────────────────────────────────────────────────
-- CONTEXT
--   The user created 4 manual adjustments on NEWONN001 in order to manually
--   shift stock across March/April so that the allocation engine could pass.
--   These adjustments are no longer needed and distort the layer state.
--   Removing them plus resetting the ledger produces a clean source-of-truth.
--
-- THE 4 TEMPORARY ADJUSTMENTS TO REMOVE
--   1) 01/03/2026  ADJUST_IN  qty=1000  reason contains "โยกมาตัดสต๊อก"
--   2) 06/04/2026  ADJUST_OUT qty=1000  reason contains "โยกไปลงสต๊อกเดือนเมษา"
--   3) 31/03/2026  ADJUST_IN  qty=898   reason contains "ยกเลิกโยกจำนวนนี้"
--   4) 31/03/2026  ADJUST_OUT qty=898   reason contains "ยกจำนวนไปได้ในเดือน"
--
-- WHAT THIS MIGRATION DOES
--   Step 0: Identify the 4 target adjustment rows (preview — verify before proceeding)
--   Step 1: Create safety backups of all three affected tables
--   Step 2: For each ADJUST_IN row → void the associated receipt layer
--   Step 3: Delete the 4 adjustment rows (superuser bypasses immutable RLS)
--   Step 4: Full COGS ledger reset (mirrors migration-086):
--             a) Delete all inventory_cogs_allocations
--             b) Delete all inventory_cost_snapshots
--             c) Restore qty_remaining = qty_received on all active layers
--             d) Replay remaining ADJUST_OUT drains (FIFO)
--             e) Mark stale 'running' cogs_allocation_runs as 'failed'
--   Step 5: Post-reset validation
--
-- HOW TO RUN
--   Run in Supabase SQL Editor (requires postgres superuser — bypasses RLS).
--   Run section by section. Read NOTICE output before proceeding to the next section.
--
-- AFTER THIS MIGRATION
--   Go to Inventory → Apply COGS (MTD) with full date range, method = FIFO.
--   The new run will use bundle-first ordering (two-pass, deployed in code).
-- ──────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 0: Preview — identify the 4 rows before touching anything
--         Run this block FIRST and verify the output matches expectations.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  id,
  adjustment_type,
  quantity,
  reason,
  adjusted_at AT TIME ZONE 'Asia/Bangkok' AS adjusted_at_bkk,
  layer_id,
  created_by
FROM inventory_adjustments
WHERE sku_internal = 'NEWONN001'
  AND (
    reason ILIKE '%โยกมาตัดสต๊อก%'
    OR reason ILIKE '%โยกไปลงสต๊อกเดือนเมษา%'
    OR reason ILIKE '%ยกเลิกโยกจำนวนนี้%'
    OR reason ILIKE '%ยกจำนวนไปได้ในเดือน%'
  )
ORDER BY adjusted_at;

-- ⚠ STOP HERE — verify the query above returns exactly 4 rows before proceeding.
-- ⚠ If it returns 0 rows the reasons may differ — check and update the ILIKE patterns.


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Create safety backups
--         Drop existing same-date backups first if re-running.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

DROP TABLE IF EXISTS backup_inventory_cogs_allocations_20260421;
DROP TABLE IF EXISTS backup_inventory_cost_snapshots_20260421;
DROP TABLE IF EXISTS backup_inventory_receipt_layers_20260421;
DROP TABLE IF EXISTS backup_inventory_adjustments_20260421;

CREATE TABLE backup_inventory_cogs_allocations_20260421 AS
  SELECT * FROM inventory_cogs_allocations;

CREATE TABLE backup_inventory_cost_snapshots_20260421 AS
  SELECT * FROM inventory_cost_snapshots;

CREATE TABLE backup_inventory_receipt_layers_20260421 AS
  SELECT * FROM inventory_receipt_layers;

CREATE TABLE backup_inventory_adjustments_20260421 AS
  SELECT * FROM inventory_adjustments;

DO $$ BEGIN
  RAISE NOTICE 'Step 1 complete: safety backups created (suffix _20260421).';
END; $$;

COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Void the receipt layers created by the two ADJUST_IN rows.
--         ADJUST_IN rows have layer_id set → that layer must be voided so its
--         qty_remaining is excluded from future allocations.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

UPDATE inventory_receipt_layers
SET
  is_voided   = true,
  voided_at   = now(),
  void_reason = 'Voided by migration-088: temporary adjustment removed'
WHERE id IN (
  SELECT layer_id
  FROM inventory_adjustments
  WHERE sku_internal = 'NEWONN001'
    AND adjustment_type = 'ADJUST_IN'
    AND layer_id IS NOT NULL
    AND (
      reason ILIKE '%โยกมาตัดสต๊อก%'
      OR reason ILIKE '%ยกเลิกโยกจำนวนนี้%'
    )
)
AND is_voided = false;  -- idempotent: skip already-voided

DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM inventory_receipt_layers
  WHERE is_voided = true
    AND void_reason LIKE 'Voided by migration-088%';
  RAISE NOTICE 'Step 2 complete: % receipt layer(s) voided.', v_count;
END;
$$;

COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Delete the 4 temporary adjustment rows.
--         inventory_adjustments has no DELETE RLS policy — only superuser can do this.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

DO $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM inventory_adjustments
  WHERE sku_internal = 'NEWONN001'
    AND (
      reason ILIKE '%โยกมาตัดสต๊อก%'
      OR reason ILIKE '%โยกไปลงสต๊อกเดือนเมษา%'
      OR reason ILIKE '%ยกเลิกโยกจำนวนนี้%'
      OR reason ILIKE '%ยกจำนวนไปได้ในเดือน%'
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted <> 4 THEN
    RAISE EXCEPTION
      'Expected to delete exactly 4 adjustment rows, but deleted %. '
      'Check reason text patterns in Step 0 and adjust ILIKE patterns.',
      v_deleted;
  END IF;

  RAISE NOTICE 'Step 3 complete: % temporary adjustment rows deleted.', v_deleted;
END;
$$;

COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4a: Delete all COGS allocation rows (re-computable from source of truth)
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;
DELETE FROM inventory_cogs_allocations;
DO $$ BEGIN RAISE NOTICE 'Step 4a complete: inventory_cogs_allocations cleared.'; END; $$;
COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4b: Delete all cost snapshots (AVG method will rebuild on next run)
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;
DELETE FROM inventory_cost_snapshots;
DO $$ BEGIN RAISE NOTICE 'Step 4b complete: inventory_cost_snapshots cleared.'; END; $$;
COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4c: Restore qty_remaining = qty_received on all non-voided receipt layers
--          This undoes all previous FIFO drains so the ledger starts from full stock.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

UPDATE inventory_receipt_layers
SET qty_remaining = qty_received
WHERE is_voided = false;

DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM inventory_receipt_layers
  WHERE is_voided = false;
  RAISE NOTICE 'Step 4c complete: qty_remaining restored to qty_received on % active layers.', v_count;
END;
$$;

COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4d: Replay remaining ADJUST_OUT drains in chronological FIFO order.
--          (The 4 deleted adjustments are gone; only legitimate ADJUST_OUTs remain.)
--          Matches the logic in allocate_cogs_fifo: oldest received_at first.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_adj           RECORD;
  v_layer         RECORD;
  v_remaining     NUMERIC;
  v_drain         NUMERIC;
  v_adj_count     INT := 0;
  v_layer_touches INT := 0;
  v_warn_count    INT := 0;
BEGIN
  FOR v_adj IN
    SELECT id, sku_internal, quantity, adjusted_at, created_by
    FROM inventory_adjustments
    WHERE adjustment_type = 'ADJUST_OUT'
    ORDER BY created_by, sku_internal, adjusted_at ASC
  LOOP
    v_remaining := v_adj.quantity;

    FOR v_layer IN
      SELECT id, qty_remaining
      FROM inventory_receipt_layers
      WHERE sku_internal  = v_adj.sku_internal
        AND created_by    = v_adj.created_by
        AND is_voided     = false
        AND qty_remaining > 0
      ORDER BY received_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_drain := LEAST(v_remaining, v_layer.qty_remaining);

      UPDATE inventory_receipt_layers
      SET qty_remaining = qty_remaining - v_drain
      WHERE id = v_layer.id;

      v_remaining     := v_remaining - v_drain;
      v_layer_touches := v_layer_touches + 1;
    END LOOP;

    IF v_remaining > 0 THEN
      v_warn_count := v_warn_count + 1;
      RAISE WARNING
        'ADJUST_OUT id=% SKU=% adjusted_at=% — still needed % units after all layers.',
        v_adj.id, v_adj.sku_internal, v_adj.adjusted_at, v_remaining;
    END IF;

    v_adj_count := v_adj_count + 1;
  END LOOP;

  RAISE NOTICE 'Step 4d complete: ADJUST_OUT replay — % adjustments, % layer updates, % warnings',
    v_adj_count, v_layer_touches, v_warn_count;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4e: Mark stale 'running' cogs_allocation_runs as 'failed'
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

UPDATE cogs_allocation_runs
SET
  status        = 'failed',
  error_message = 'Retroactively failed by migration-088: COGS ledger was reset.',
  updated_at    = now()
WHERE status = 'running';

DO $$ BEGIN
  RAISE NOTICE 'Step 4e complete: stale running runs marked failed.';
END; $$;

COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: Post-reset validation
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_alloc_count    BIGINT;
  v_snap_count     BIGINT;
  v_layers_zero    BIGINT;
  v_layers_nonzero BIGINT;
  v_adj_remaining  BIGINT;
  v_stale_runs     BIGINT;
  v_negative_qty   BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_alloc_count    FROM inventory_cogs_allocations;
  SELECT COUNT(*) INTO v_snap_count     FROM inventory_cost_snapshots;
  SELECT COUNT(*) INTO v_layers_zero    FROM inventory_receipt_layers WHERE is_voided = false AND qty_remaining = 0;
  SELECT COUNT(*) INTO v_layers_nonzero FROM inventory_receipt_layers WHERE is_voided = false AND qty_remaining > 0;
  SELECT COUNT(*) INTO v_adj_remaining  FROM inventory_adjustments WHERE adjustment_type IN ('ADJUST_IN','ADJUST_OUT');
  SELECT COUNT(*) INTO v_stale_runs     FROM cogs_allocation_runs WHERE status = 'running';
  SELECT COUNT(*) INTO v_negative_qty   FROM inventory_receipt_layers WHERE is_voided = false AND qty_remaining < 0;

  RAISE NOTICE '── POST-RESET VALIDATION ────────────────────────────────────';
  RAISE NOTICE '  inventory_cogs_allocations (should be 0):      %', v_alloc_count;
  RAISE NOTICE '  inventory_cost_snapshots   (should be 0):      %', v_snap_count;
  RAISE NOTICE '  receipt layers qty_remaining > 0:              %', v_layers_nonzero;
  RAISE NOTICE '  receipt layers qty_remaining = 0:              %', v_layers_zero;
  RAISE NOTICE '  receipt layers qty_remaining < 0 (MUST be 0):  %', v_negative_qty;
  RAISE NOTICE '  inventory_adjustments remaining:               %', v_adj_remaining;
  RAISE NOTICE '  stale running runs (should be 0):              %', v_stale_runs;
  RAISE NOTICE '─────────────────────────────────────────────────────────────';

  IF v_alloc_count > 0 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: inventory_cogs_allocations still has % rows', v_alloc_count;
  END IF;
  IF v_negative_qty > 0 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: % receipt layers have qty_remaining < 0 — check ADJUST_OUT replay', v_negative_qty;
  END IF;

  RAISE NOTICE 'Validation PASSED. Run Apply COGS (MTD) from the Inventory UI to rebuild.';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5b: Confirm the 4 adjustments are gone + remaining NEWONN001 adjustments
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  id,
  adjustment_type,
  quantity,
  reason,
  adjusted_at AT TIME ZONE 'Asia/Bangkok' AS adjusted_at_bkk
FROM inventory_adjustments
WHERE sku_internal = 'NEWONN001'
ORDER BY adjusted_at;
-- Expected: 0 rows if no other NEWONN001 adjustments exist, or only legitimate ones.

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5c: NEWONN001 + NEWONN002 receipt layer state after reset
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  sku_internal,
  ref_type,
  received_at AT TIME ZONE 'Asia/Bangkok' AS received_at_bkk,
  qty_received,
  qty_remaining,
  is_voided,
  void_reason
FROM inventory_receipt_layers
WHERE sku_internal IN ('NEWONN001', 'NEWONN002')
ORDER BY sku_internal, received_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- NEXT STEPS
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Confirm Step 5 validation passed (0 allocations, no negative qty_remaining).
-- 2. Confirm Step 5c shows NEWONN001 layers without the two ADJUST_IN rows.
-- 3. Go to Inventory → Apply COGS (MTD) in the dashboard:
--      - Date range: full history (earliest date to today)
--      - Method: FIFO
--    The new code processes bundle orders FIRST (Pass 1), then non-bundle (Pass 2).
-- 4. After the run completes, check:
--      - Run History: should show mostly 'successful' with fewer 'failed'
--      - Bundles tab: NEWONN003 max_sellable should now reflect correctly
--      - Any remaining 'failed' = genuine stock data gaps (real short stock)
-- ─────────────────────────────────────────────────────────────────────────────
