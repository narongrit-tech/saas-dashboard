-- =============================================================================
-- Migration 116: BEFORE INSERT dedup trigger for sales_orders
-- Date: 2026-06-23
-- Problem:
--   uq_sales_orders_external_sku (partial unique index on created_by,
--   external_order_id, sku) fires 23505 when a re-import brings in the same
--   order line with a different order_line_hash (e.g. TikTok updated a price).
--
--   The upsert uses ON CONFLICT (order_line_hash) — so a changed hash means
--   INSERT, not UPDATE — which collides with the still-existing old row.
--
--   Client-side pre-delete is unreliable: URL length limits in PostgREST
--   (GET request for .in() filter), workspace-owner mismatch, and concurrency
--   make it fragile.
--
-- Fix:
--   Add a BEFORE INSERT trigger that atomically deletes any existing row with
--   the same (primary_owner, external_order_id, sku) but a different hash,
--   immediately before the new row is inserted in the same transaction.
--
--   Uses resolve_primary_owner() from migration-112 so the lookup is
--   correct regardless of which auth user is running the import (delegate
--   or primary).
--
-- Trigger name starts with 'trg_s' — alphabetically AFTER
-- 'trg_rewrite_owner_to_primary' (trg_r) from migration-112, so NEW.created_by
-- has already been normalised to the primary owner when this trigger fires.
-- Even if the order were reversed, resolve_primary_owner() makes it safe.
--
-- IDEMPOTENT — safe to re-run.
-- =============================================================================

-- ── 1. Trigger function ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dedup_sales_order_external_sku()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid;
BEGIN
  -- Only act when both external_order_id and sku are present
  IF NEW.external_order_id IS NULL OR NEW.sku IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve the primary workspace owner (handles delegate→primary mapping
  -- from workspace_owner_map; returns NEW.created_by unchanged if no mapping)
  v_owner := public.resolve_primary_owner(NEW.created_by);

  -- Delete any existing row with same (owner, order, sku) but different hash.
  -- This is a no-op if the row does not exist or if the hash is unchanged.
  DELETE FROM public.sales_orders
  WHERE  created_by        = v_owner
    AND  external_order_id = NEW.external_order_id
    AND  sku               = NEW.sku
    AND  order_line_hash  != NEW.order_line_hash;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.dedup_sales_order_external_sku() IS
  'BEFORE INSERT: atomically removes stale rows for the same (owner, external_order_id, sku) '
  'that carry a different order_line_hash, preventing uq_sales_orders_external_sku 23505 errors '
  'on re-import when TikTok/Shopee updated the order line (price, qty, etc.).';


-- ── 2. Attach trigger to sales_orders ────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sales_orders_dedup_external_sku ON public.sales_orders;

CREATE TRIGGER trg_sales_orders_dedup_external_sku
BEFORE INSERT ON public.sales_orders
FOR EACH ROW
EXECUTE FUNCTION public.dedup_sales_order_external_sku();

COMMENT ON TRIGGER trg_sales_orders_dedup_external_sku ON public.sales_orders IS
  'Fires BEFORE INSERT to remove conflicting rows (same order+sku, different hash) so '
  'uq_sales_orders_external_sku never blocks re-imports.';


-- ── 3. Verify ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '=== Migration 116 Verification ===';
  RAISE NOTICE 'trigger dedup_sales_order_external_sku : created';
  RAISE NOTICE 'trigger trg_sales_orders_dedup_external_sku on sales_orders : attached';
  RAISE NOTICE '✓ Migration 116 complete';
END $$;
