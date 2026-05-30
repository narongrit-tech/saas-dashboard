-- =============================================================================
-- Migration 071: Returns undo fix — is_undone column + rebuilt unique index
-- Date: 2026-05-30
-- Description:
--   1. Add is_undone BOOLEAN to inventory_returns.
--      TRUE when a RETURN record has been fully reversed by an UNDO action.
--      Replaces the ambiguous `reversed_return_id IS NULL` check on RETURN rows
--      (which was never set on the original RETURN, only on the UNDO record).
--
--   2. Backfill is_undone=TRUE for existing returns that already have a
--      corresponding UNDO record (reversed_return_id → original.id).
--
--   3. Rebuild unique dedup index to use `NOT is_undone` instead of
--      `reversed_return_id IS NULL`.  This allows re-submitting a return
--      after an undo without hitting a 23505 unique violation.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1: Add is_undone column
-- -----------------------------------------------------------------------------

ALTER TABLE public.inventory_returns
  ADD COLUMN IF NOT EXISTS is_undone BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.inventory_returns.is_undone IS
  'TRUE when this RETURN record has been fully reversed by an UNDO action. '
  'Used by the dedup unique index and net qty_returned calculations.';


-- -----------------------------------------------------------------------------
-- STEP 2: Backfill is_undone = TRUE for already-undone returns
--
-- Identifies RETURN rows whose id is referenced by an UNDO record's
-- reversed_return_id, meaning they were undone under the old code.
-- -----------------------------------------------------------------------------

UPDATE public.inventory_returns
SET    is_undone = TRUE
WHERE  action_type = 'RETURN'
  AND  id IN (
         SELECT reversed_return_id
         FROM   public.inventory_returns
         WHERE  action_type          = 'UNDO'
           AND  reversed_return_id  IS NOT NULL
       );


-- -----------------------------------------------------------------------------
-- STEP 3: Rebuild unique index
--
-- Old index (migration-070): WHERE ... AND reversed_return_id IS NULL
--   Problem: original RETURN rows never had reversed_return_id set
--            (only UNDO rows set it), so this predicate never filtered undone
--            returns — re-submitting after undo still hit 23505.
--
-- New index: WHERE ... AND NOT is_undone
--   Correct: when an undo sets is_undone=TRUE on the original RETURN, it falls
--            out of the unique index, allowing a fresh RETURN for the same order+sku.
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS public.uq_inventory_returns_note_sku_internal_active;

CREATE UNIQUE INDEX uq_inventory_returns_note_sku_internal_active
  ON public.inventory_returns(created_by, note, sku_internal)
  WHERE action_type  = 'RETURN'
    AND NOT is_undone
    AND note         IS NOT NULL
    AND note         <> ''
    AND sku_internal IS NOT NULL;

COMMENT ON INDEX public.uq_inventory_returns_note_sku_internal_active IS
  'Prevents duplicate active RETURN rows for the same canonical SKU + order note per user. '
  'Undone returns (is_undone=TRUE) are excluded so re-returns are permitted after undo.';


-- -----------------------------------------------------------------------------
-- STEP 4: Verification
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  v_undone_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_undone_count
  FROM   public.inventory_returns
  WHERE  is_undone = TRUE;

  RAISE NOTICE '=== Migration 071 Verification ===';
  RAISE NOTICE 'inventory_returns.is_undone          : column added (DEFAULT FALSE)';
  RAISE NOTICE 'Backfilled is_undone=TRUE             : % rows', v_undone_count;
  RAISE NOTICE 'uq_inventory_returns_note_sku_internal_active: rebuilt with NOT is_undone';
  RAISE NOTICE '✓ Migration 071 complete';
END $$;
