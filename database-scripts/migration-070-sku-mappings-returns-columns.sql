-- =============================================================================
-- Migration 070: SKU mappings table + inventory_returns columns backfill
-- Date: 2026-02-25
-- Description:
--   1. Create public.inventory_sku_mappings — cross-channel marketplace SKU →
--      internal SKU lookup table with RLS and updated_at trigger.
--   2. Add marketplace_sku and sku_internal columns to public.inventory_returns.
--      NOTE: No FK from inventory_returns.sku_internal → inventory_items because
--      production data contains unmapped rows; constraint would block insert.
--   3. Backfill inventory_returns.marketplace_sku from existing sku column.
--   4. Replace old dedup index (uses raw marketplace sku) with new index that
--      uses sku_internal (canonical) for reliable deduplication.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1: Create inventory_sku_mappings table
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inventory_sku_mappings (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_sku text        NOT NULL,
  channel        text        NOT NULL DEFAULT 'tiktok',
  sku_internal   text        NOT NULL REFERENCES public.inventory_items(sku_internal) ON UPDATE CASCADE,
  created_by     uuid        REFERENCES auth.users(id),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  CONSTRAINT uq_sku_mapping_channel_marketplace UNIQUE (created_by, channel, marketplace_sku)
);

COMMENT ON TABLE public.inventory_sku_mappings IS
  'Maps marketplace-specific SKU identifiers to canonical internal SKUs per channel.';

COMMENT ON COLUMN public.inventory_sku_mappings.marketplace_sku IS
  'Raw SKU string as it appears in marketplace CSV exports (TikTok, Shopee, etc.).';

COMMENT ON COLUMN public.inventory_sku_mappings.channel IS
  'Sales channel identifier: tiktok | shopee | lazada | manual, etc.';

COMMENT ON COLUMN public.inventory_sku_mappings.sku_internal IS
  'Canonical SKU referencing inventory_items.sku_internal.';


-- -----------------------------------------------------------------------------
-- STEP 2: Indexes on inventory_sku_mappings
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_sku_mappings_marketplace
  ON public.inventory_sku_mappings(channel, marketplace_sku);

CREATE INDEX IF NOT EXISTS idx_sku_mappings_sku_internal
  ON public.inventory_sku_mappings(sku_internal);

CREATE INDEX IF NOT EXISTS idx_sku_mappings_created_by
  ON public.inventory_sku_mappings(created_by);


-- -----------------------------------------------------------------------------
-- STEP 3: Enable RLS on inventory_sku_mappings
-- -----------------------------------------------------------------------------

ALTER TABLE public.inventory_sku_mappings ENABLE ROW LEVEL SECURITY;

-- SELECT: owner only
CREATE POLICY sku_mappings_select
  ON public.inventory_sku_mappings
  FOR SELECT
  USING (created_by = auth.uid());

-- INSERT: owner only (WITH CHECK enforces created_by on new rows)
CREATE POLICY sku_mappings_insert
  ON public.inventory_sku_mappings
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- UPDATE: owner only
CREATE POLICY sku_mappings_update
  ON public.inventory_sku_mappings
  FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- DELETE: owner only
CREATE POLICY sku_mappings_delete
  ON public.inventory_sku_mappings
  FOR DELETE
  USING (created_by = auth.uid());


-- -----------------------------------------------------------------------------
-- STEP 4: updated_at trigger
-- -----------------------------------------------------------------------------

-- Function is idempotent (CREATE OR REPLACE); shared across tables.
CREATE OR REPLACE FUNCTION public.set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Drop before recreate to avoid "already exists" error on re-run.
DROP TRIGGER IF EXISTS trg_sku_mappings_updated_at ON public.inventory_sku_mappings;

CREATE TRIGGER trg_sku_mappings_updated_at
  BEFORE UPDATE ON public.inventory_sku_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- -----------------------------------------------------------------------------
-- STEP 5: Add columns to inventory_returns
--
-- marketplace_sku : raw SKU from marketplace export (backfilled from sku).
-- sku_internal    : resolved canonical SKU; nullable — unmapped rows stay NULL.
--
-- No FK to inventory_items on sku_internal because existing production rows
-- may reference SKUs that have not yet been mapped or have been deleted.
-- The application layer resolves the mapping at import time.
-- -----------------------------------------------------------------------------

ALTER TABLE public.inventory_returns
  ADD COLUMN IF NOT EXISTS marketplace_sku text,
  ADD COLUMN IF NOT EXISTS sku_internal    text;

COMMENT ON COLUMN public.inventory_returns.marketplace_sku IS
  'Raw SKU as received from the marketplace return event (backfilled from sku).';

COMMENT ON COLUMN public.inventory_returns.sku_internal IS
  'Resolved canonical SKU from inventory_sku_mappings; NULL if not yet mapped.';


-- -----------------------------------------------------------------------------
-- STEP 6: Backfill marketplace_sku from existing sku column
--
-- Safe for all rows: sku already holds the raw marketplace value.
-- Only touches rows where marketplace_sku is still NULL to be idempotent.
-- -----------------------------------------------------------------------------

UPDATE public.inventory_returns
SET    marketplace_sku = sku
WHERE  marketplace_sku IS NULL;


-- -----------------------------------------------------------------------------
-- STEP 7: Drop old dedup index (keyed on raw marketplace sku)
--
-- This index was created in migration-069.  It uses the raw sku column which
-- is a marketplace variant id, not a canonical identifier.  Replacing it with
-- a sku_internal-based index gives stable dedup across channel SKU variations.
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS public.uq_inventory_returns_note_sku_active;


-- -----------------------------------------------------------------------------
-- STEP 8: New dedup index using sku_internal (canonical)
--
-- Partial index: only active (non-reversed) RETURN rows where sku_internal is
-- already resolved.  Rows with sku_internal IS NULL are excluded deliberately
-- so unmapped returns can be inserted without violating uniqueness.
-- -----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_returns_note_sku_internal_active
  ON public.inventory_returns(created_by, note, sku_internal)
  WHERE action_type         = 'RETURN'
    AND reversed_return_id  IS NULL
    AND note                IS NOT NULL
    AND note                <> ''
    AND sku_internal        IS NOT NULL;

COMMENT ON INDEX public.uq_inventory_returns_note_sku_internal_active IS
  'Prevents duplicate active RETURN rows for the same canonical SKU + order note per user. '
  'Only enforced once sku_internal is resolved; unmapped rows (sku_internal IS NULL) bypass this guard.';


-- -----------------------------------------------------------------------------
-- STEP 9: Verification
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  RAISE NOTICE '=== Migration 070 Verification ===';
  RAISE NOTICE 'inventory_sku_mappings          : table created with RLS + trigger';
  RAISE NOTICE 'idx_sku_mappings_marketplace    : index created';
  RAISE NOTICE 'idx_sku_mappings_sku_internal   : index created';
  RAISE NOTICE 'idx_sku_mappings_created_by     : index created';
  RAISE NOTICE 'inventory_returns.marketplace_sku: column added + backfilled from sku';
  RAISE NOTICE 'inventory_returns.sku_internal  : column added (nullable, no FK)';
  RAISE NOTICE 'uq_inventory_returns_note_sku_active        : dropped (migration-069 index)';
  RAISE NOTICE 'uq_inventory_returns_note_sku_internal_active: created';
  RAISE NOTICE 'Migration 070 complete';
END $$;
