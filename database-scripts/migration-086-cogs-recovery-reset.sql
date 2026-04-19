-- migration-086: COGS Ledger Recovery Reset
-- ──────────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   Reset the COGS derived ledger (inventory_cogs_allocations,
--   inventory_cost_snapshots) back to a clean state and restore qty_remaining
--   on receipt layers so the MTD Apply COGS UI can rebuild from scratch.
--
-- WHAT THIS MIGRATION TOUCHES (derived / re-computable state only)
--   DELETE  inventory_cogs_allocations      — allocation rows (FIFO/AVG + reversals)
--   DELETE  inventory_cost_snapshots        — moving-average snapshots
--   UPDATE  inventory_receipt_layers        — qty_remaining reset to qty_received
--   REPLAY  inventory_adjustments           — ADJUST_OUT drains re-applied FIFO
--   UPDATE  cogs_allocation_runs            — stale 'running' rows marked 'failed'
--
-- WHAT THIS MIGRATION DOES NOT TOUCH (source-of-truth / immutable)
--   inventory_receipt_layers rows           — not deleted (stock receipts preserved)
--   inventory_adjustments rows              — not deleted (audit trail preserved)
--   inventory_items                         — not touched
--   inventory_bundle_components             — not touched
--   sales_orders                            — not touched
--   inventory_returns                       — not touched
--
-- PREREQUISITES
--   1. Backup tables must exist (this script verifies before proceeding):
--        backup_inventory_cogs_allocations_20260319
--        backup_inventory_cost_snapshots_20260319    (if table was non-empty)
--        backup_inventory_receipt_layers_20260319
--   2. Run in Supabase SQL Editor (bypasses RLS — runs as postgres superuser).
--   3. After this migration, rebuild COGS via the "Apply COGS (MTD)" UI in the
--      Inventory → Movements tab (select full date range, method = FIFO).
--
-- RUN ORDER
--   1. Apply this migration in Supabase SQL Editor
--   2. Rebuild allocations via Apply COGS (MTD) UI
--   3. Run cogs-recovery-validation.sql to confirm correctness
-- ──────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Backup existence guard
--    Abort if the safety backups are missing — do not proceed without them.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename  = 'backup_inventory_cogs_allocations_20260319'
  ) THEN
    RAISE EXCEPTION
      'ABORT: backup_inventory_cogs_allocations_20260319 not found. '
      'Create backups before running this migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename  = 'backup_inventory_receipt_layers_20260319'
  ) THEN
    RAISE EXCEPTION
      'ABORT: backup_inventory_receipt_layers_20260319 not found. '
      'Create backups before running this migration.';
  END IF;

  RAISE NOTICE 'Backup guard passed — proceeding with COGS ledger reset.';
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Pre-reset audit snapshot
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_alloc_count      BIGINT;
  v_reversal_count   BIGINT;
  v_snapshot_count   BIGINT;
  v_layers_total     BIGINT;
  v_layers_nonzero   BIGINT;
  v_adj_out_count    BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_alloc_count    FROM inventory_cogs_allocations WHERE is_reversal = false;
  SELECT COUNT(*) INTO v_reversal_count FROM inventory_cogs_allocations WHERE is_reversal = true;
  SELECT COUNT(*) INTO v_snapshot_count FROM inventory_cost_snapshots;
  SELECT COUNT(*) INTO v_layers_total   FROM inventory_receipt_layers WHERE is_voided = false;
  SELECT COUNT(*) INTO v_layers_nonzero FROM inventory_receipt_layers WHERE is_voided = false AND qty_remaining > 0;
  SELECT COUNT(*) INTO v_adj_out_count  FROM inventory_adjustments WHERE adjustment_type = 'ADJUST_OUT';

  RAISE NOTICE '── PRE-RESET AUDIT ──────────────────────────────────────────';
  RAISE NOTICE '  inventory_cogs_allocations (normal):   %', v_alloc_count;
  RAISE NOTICE '  inventory_cogs_allocations (reversal): %', v_reversal_count;
  RAISE NOTICE '  inventory_cost_snapshots:              %', v_snapshot_count;
  RAISE NOTICE '  inventory_receipt_layers (active):     %  total, % with qty_remaining > 0', v_layers_total, v_layers_nonzero;
  RAISE NOTICE '  inventory_adjustments ADJUST_OUT:      %', v_adj_out_count;
  RAISE NOTICE '─────────────────────────────────────────────────────────────';
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Delete all COGS allocation rows (normal + reversal)
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM inventory_cogs_allocations;

DO $$ BEGIN
  RAISE NOTICE 'Step 2 complete: inventory_cogs_allocations cleared.';
END; $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Delete all moving-average cost snapshots
--    (FIFO method does not use these; AVG method re-creates them on each run)
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM inventory_cost_snapshots;

DO $$ BEGIN
  RAISE NOTICE 'Step 3 complete: inventory_cost_snapshots cleared.';
END; $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Reset qty_remaining = qty_received on all non-voided receipt layers
--    This undoes all previous FIFO drains (from both COGS allocations and
--    ADJUST_OUT adjustments) so the ledger starts from full opening stock.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE inventory_receipt_layers
SET    qty_remaining = qty_received
WHERE  is_voided = false;

DO $$ BEGIN
  RAISE NOTICE 'Step 4 complete: qty_remaining reset to qty_received on all active layers.';
END; $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Replay ADJUST_OUT drains in chronological FIFO order
--    ADJUST_OUT adjustments drain qty_remaining directly (not via cogs_allocations).
--    Since step 4 zeroed all drains, we must re-apply each ADJUST_OUT in the
--    exact same FIFO order the application would have used.
--
--    NOTE: If a replay encounters a layer with insufficient remaining stock it
--    logs a WARNING and continues (does not abort). This can happen if ADJUST_OUT
--    quantity exceeded available stock at time of adjustment — a pre-existing data
--    issue, not introduced by this migration. Inspect WARNING lines in the output.
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
  -- Process every ADJUST_OUT in chronological order (oldest first) per user+SKU.
  -- This matches the FIFO order the application used when the adjustment was saved.
  FOR v_adj IN
    SELECT id, sku_internal, quantity, adjusted_at, created_by
      FROM inventory_adjustments
     WHERE adjustment_type = 'ADJUST_OUT'
     ORDER BY created_by, sku_internal, adjusted_at ASC
  LOOP
    v_remaining := v_adj.quantity;

    -- Drain FIFO layers (oldest received_at first, same order as allocate_cogs_fifo)
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

    -- Log a warning if we could not fully drain (stock was already short)
    IF v_remaining > 0 THEN
      v_warn_count := v_warn_count + 1;
      RAISE WARNING
        'ADJUST_OUT id=% SKU=% user=% adjusted_at=% — still needed % units '
        'after exhausting all layers. Layers drained to 0; deficit carried as-is.',
        v_adj.id, v_adj.sku_internal, v_adj.created_by, v_adj.adjusted_at, v_remaining;
    END IF;

    v_adj_count := v_adj_count + 1;
  END LOOP;

  RAISE NOTICE 'Step 5 complete: ADJUST_OUT replay — % adjustments, % layer updates, % warnings',
    v_adj_count, v_layer_touches, v_warn_count;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Mark stale 'running' cogs_allocation_runs rows as 'failed'
--    Any run stuck in 'running' status blocks the UI from starting a new run.
--    After the ledger reset all prior runs are moot — mark them failed so the
--    UI shows a clean slate.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE cogs_allocation_runs
SET
  status        = 'failed',
  error_message = 'Retroactively failed by migration-086: COGS ledger was reset. '
                  'All prior allocations were cleared; this run''s results no longer apply.',
  updated_at    = now()
WHERE status = 'running';

DO $$ BEGIN
  RAISE NOTICE 'Step 6 complete: stale running cogs_allocation_runs rows marked failed.';
END; $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Post-reset audit snapshot
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_alloc_count    BIGINT;
  v_snapshot_count BIGINT;
  v_layers_zero    BIGINT;
  v_layers_nonzero BIGINT;
  v_stale_runs     BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_alloc_count    FROM inventory_cogs_allocations;
  SELECT COUNT(*) INTO v_snapshot_count FROM inventory_cost_snapshots;
  SELECT COUNT(*) INTO v_layers_zero    FROM inventory_receipt_layers WHERE is_voided = false AND qty_remaining = 0;
  SELECT COUNT(*) INTO v_layers_nonzero FROM inventory_receipt_layers WHERE is_voided = false AND qty_remaining > 0;
  SELECT COUNT(*) INTO v_stale_runs     FROM cogs_allocation_runs WHERE status = 'running';

  RAISE NOTICE '── POST-RESET AUDIT ─────────────────────────────────────────';
  RAISE NOTICE '  inventory_cogs_allocations (should be 0): %', v_alloc_count;
  RAISE NOTICE '  inventory_cost_snapshots   (should be 0): %', v_snapshot_count;
  RAISE NOTICE '  receipt layers with qty_remaining > 0:    %', v_layers_nonzero;
  RAISE NOTICE '  receipt layers with qty_remaining = 0:    %', v_layers_zero;
  RAISE NOTICE '  stale running runs         (should be 0): %', v_stale_runs;
  RAISE NOTICE '─────────────────────────────────────────────────────────────';

  IF v_alloc_count > 0 THEN
    RAISE EXCEPTION 'POST-RESET FAILED: inventory_cogs_allocations still has % rows', v_alloc_count;
  END IF;
  IF v_snapshot_count > 0 THEN
    RAISE EXCEPTION 'POST-RESET FAILED: inventory_cost_snapshots still has % rows', v_snapshot_count;
  END IF;
END;
$$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- NEXT STEPS (after running this migration)
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Go to Inventory → Movements tab in the dashboard.
-- 2. Set the date range to cover ALL orders (e.g., 2024-01-01 to today).
-- 3. Click "Apply COGS (MTD)" — method = FIFO.
--    The UI will auto-resume if it times out (up to 20 retries).
-- 4. Once the run completes, run cogs-recovery-validation.sql to verify:
--    - All shipped orders are allocated
--    - Per-SKU on-hand qty matches your physical count
--    - Return reversals are present where expected
-- ─────────────────────────────────────────────────────────────────────────────
