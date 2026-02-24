-- Migration 069: Add deduplication indexes for returns + receipt layers
-- Date: 2026-02-24

-- A) Partial unique index: prevent duplicate active returns for same note (marketplace order no) + sku
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_returns_note_sku_active
ON public.inventory_returns(created_by, note, sku)
WHERE action_type = 'RETURN'
  AND reversed_return_id IS NULL
  AND note IS NOT NULL
  AND note <> '';

COMMENT ON INDEX public.uq_inventory_returns_note_sku_active IS
  'Prevents duplicate RETURN_RECEIVED entries for the same marketplace order + SKU per user';

-- B) Partial unique index: prevent duplicate active receipt layer per return
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_receipt_layers_return_active
ON public.inventory_receipt_layers(ref_type, ref_id)
WHERE coalesce(is_voided, false) = false
  AND ref_type = 'RETURN';

COMMENT ON INDEX public.uq_inventory_receipt_layers_return_active IS
  'Prevents duplicate active receipt layers for a given return record';

-- Verification
DO $$
BEGIN
  RAISE NOTICE '=== Migration 069 Verification ===';
  RAISE NOTICE 'uq_inventory_returns_note_sku_active: created';
  RAISE NOTICE 'uq_inventory_receipt_layers_return_active: created';
  RAISE NOTICE '✓ Migration 069 complete';
END $$;
