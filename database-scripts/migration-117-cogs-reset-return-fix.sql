-- =============================================================================
-- Migration 117: COGS reset + return receipt layer fixes
-- Date: 2026-06-23
-- Purpose:
--   1. Full COGS reset — delete all non-reversal allocations, restore
--      qty_remaining on all layers for a clean YTD re-run.
--   2. Fix RETURN receipt layer unit_costs that were saved as 0 (created
--      before the original orders had been COGS-allocated).
--   3. Create 18 missing RETURN receipt layers (active returns that never
--      got a layer because the returns-processor had no COGS data at the time).
-- =============================================================================

BEGIN;

-- ── 1. Delete non-reversal COGS allocations ───────────────────────────────────
DELETE FROM public.inventory_cogs_allocations
WHERE  created_by  = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
  AND  is_reversal = false;

-- ── 2. Restore qty_remaining for ALL non-voided receipt layers ────────────────
--    (STOCK_IN, OPENING_BALANCE, RETURN — all need to start fresh)
UPDATE public.inventory_receipt_layers
SET    qty_remaining = qty_received
WHERE  created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
  AND  is_voided  = false;

-- ── 3. Fix RETURN layer unit_cost = 0 → weighted avg of STOCK_IN layers ──────
--    NEWONN001 weighted avg: 46.01 (45–48 baht range across batches)
--    NEWONN002 weighted avg: 70.00 (single batch, constant cost)
UPDATE public.inventory_receipt_layers
SET    unit_cost = CASE sku_internal
                     WHEN 'NEWONN001' THEN 46.01
                     WHEN 'NEWONN002' THEN 70.00
                     ELSE unit_cost
                   END
WHERE  created_by  = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
  AND  ref_type    = 'RETURN'
  AND  unit_cost   = 0
  AND  sku_internal IN ('NEWONN001', 'NEWONN002');

-- ── 4. Create missing return receipt layers ───────────────────────────────────
--    18 inventory_returns rows (all Feb 24 2026, NEWONN001/002) that were
--    processed as RETURN_RECEIVED but never got a receipt layer because the
--    original orders had no COGS data at that time.
INSERT INTO public.inventory_receipt_layers (
  sku_internal, received_at, qty_received, qty_remaining, unit_cost,
  ref_type, ref_id, created_by
)
SELECT
  ir.sku_internal,
  ir.returned_at,
  ir.qty,
  ir.qty,   -- starts fully available for re-allocation
  CASE ir.sku_internal
    WHEN 'NEWONN001' THEN 46.01
    WHEN 'NEWONN002' THEN 70.00
    ELSE 0
  END,
  'RETURN',
  ir.id,
  ir.created_by
FROM  public.inventory_returns ir
LEFT  JOIN public.inventory_receipt_layers irl
      ON  irl.ref_type = 'RETURN'
      AND irl.ref_id   = ir.id
WHERE  ir.created_by  = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
  AND  ir.is_undone   = false
  AND  irl.id         IS NULL;

COMMIT;

-- ── Verify ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_alloc_count int;
  v_return_layers int;
  v_zero_cost int;
BEGIN
  SELECT COUNT(*) INTO v_alloc_count
  FROM public.inventory_cogs_allocations
  WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
    AND is_reversal = false;

  SELECT COUNT(*) INTO v_return_layers
  FROM public.inventory_receipt_layers
  WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
    AND ref_type = 'RETURN'
    AND is_voided = false;

  SELECT COUNT(*) INTO v_zero_cost
  FROM public.inventory_receipt_layers
  WHERE created_by = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
    AND ref_type = 'RETURN'
    AND unit_cost = 0
    AND sku_internal IN ('NEWONN001', 'NEWONN002');

  RAISE NOTICE '=== Migration 117 Verification ===';
  RAISE NOTICE 'Non-reversal allocations remaining: % (expect 0)', v_alloc_count;
  RAISE NOTICE 'Total RETURN receipt layers: % (expect 66+)', v_return_layers;
  RAISE NOTICE 'RETURN layers with zero cost for NEWONN001/002: % (expect 0)', v_zero_cost;
  RAISE NOTICE '✓ Migration 117 complete';
END $$;
