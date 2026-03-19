-- migration-087: Register missing bundle SKUs and component recipes
-- ──────────────────────────────────────────────────────────────────────────────
-- ROOT CAUSE
--   COGS allocation loop (actions.ts line 1128):
--     const isBundle = sku && bundleSkuSet.has(sku)
--   bundleSkuSet is populated from inventory_items WHERE is_bundle=true.
--   Pack/bundle SKUs that are absent from inventory_items (or have is_bundle=false)
--   are treated as direct SKUs → allocate_cogs_fifo finds no receipt layers for
--   '#0007' / '#0008' / etc. → insufficient_stock error → ALLOCATION_FAILED.
--
-- REQUIRED MAPPINGS (business-defined)
--   #0007     → NEWONN001 ×1  +  NEWONN002 ×1
--   NEWONN003 → NEWONN001 ×1  +  NEWONN002 ×1
--   #0008     → NEWONN001 ×2
--   #0080     → NEWONN001 ×2
--   NEWONN011 → NEWONN001 ×2
--
-- WHAT THIS MIGRATION DOES
--   1. Verifies NEWONN001 and NEWONN002 exist (they are component SKUs — must be present).
--   2. Upserts the five bundle items into inventory_items with is_bundle=true.
--   3. Upserts seven rows into inventory_bundle_components (the recipes above).
--   4. Verifies the result.
--
-- IDEMPOTENT: Safe to re-run. Uses ON CONFLICT DO UPDATE.
-- RUN IN: Supabase SQL Editor (bypasses RLS — postgres superuser).
-- AFTER THIS MIGRATION: Run "Apply COGS (MTD)" from the Inventory UI to rebuild
--   allocations for all bundle orders. Migration-086 should be applied first
--   if you need a full clean rebuild.
-- ──────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Pre-flight: verify component SKUs exist
--    The bundle recipes reference NEWONN001 and NEWONN002. If these are missing
--    the FK constraints on inventory_bundle_components would fail.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_user_id   UUID;
  v_n001_ok   BOOLEAN;
  v_n002_ok   BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM inventory_items WHERE sku_internal = 'NEWONN001') INTO v_n001_ok;
  SELECT EXISTS(SELECT 1 FROM inventory_items WHERE sku_internal = 'NEWONN002') INTO v_n002_ok;

  IF NOT v_n001_ok THEN
    RAISE EXCEPTION 'ABORT: NEWONN001 not found in inventory_items. '
      'Create the component item before running this migration.';
  END IF;

  IF NOT v_n002_ok THEN
    RAISE EXCEPTION 'ABORT: NEWONN002 not found in inventory_items. '
      'Create the component item before running this migration.';
  END IF;

  SELECT created_by INTO v_user_id FROM inventory_items WHERE sku_internal = 'NEWONN001' LIMIT 1;

  RAISE NOTICE 'Pre-flight passed. Component SKUs NEWONN001 + NEWONN002 exist. created_by=%', v_user_id;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Upsert bundle items into inventory_items
--    • is_bundle = true  (critical — allocation code checks this flag)
--    • base_cost_per_unit = 0 (bundles have no own cost; cost comes from components)
--    • ON CONFLICT: update is_bundle flag in case the row already exists
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO inventory_items (sku_internal, product_name, base_cost_per_unit, is_bundle, created_by)
SELECT
  b.sku_internal,
  b.product_name,
  0,
  true,
  ii.created_by
FROM (VALUES
  ('#0007',     'Bundle #0007 — NEWONN001 ×1 + NEWONN002 ×1'),
  ('NEWONN003', 'Bundle NEWONN003 — NEWONN001 ×1 + NEWONN002 ×1'),
  ('#0008',     'Bundle #0008 — NEWONN001 ×2'),
  ('#0080',     'Bundle #0080 — NEWONN001 ×2'),
  ('NEWONN011', 'Bundle NEWONN011 — NEWONN001 ×2')
) AS b(sku_internal, product_name)
CROSS JOIN (
  SELECT created_by FROM inventory_items WHERE sku_internal = 'NEWONN001' LIMIT 1
) AS ii
ON CONFLICT (sku_internal) DO UPDATE
  SET is_bundle  = true,
      updated_at = NOW();

DO $$ BEGIN
  RAISE NOTICE 'Step 1 complete: upserted bundle items in inventory_items.';
END; $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Upsert component recipes into inventory_bundle_components
--    Unique index is on (bundle_sku, component_sku) — safe for ON CONFLICT.
--    Quantity column is named "quantity" (DECIMAL 12,4) — NOT qty_per_bundle.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO inventory_bundle_components (bundle_sku, component_sku, quantity, created_by)
SELECT
  r.bundle_sku,
  r.component_sku,
  r.qty,
  ii.created_by
FROM (VALUES
  ('#0007',     'NEWONN001', 1::NUMERIC),
  ('#0007',     'NEWONN002', 1::NUMERIC),
  ('NEWONN003', 'NEWONN001', 1::NUMERIC),
  ('NEWONN003', 'NEWONN002', 1::NUMERIC),
  ('#0008',     'NEWONN001', 2::NUMERIC),
  ('#0080',     'NEWONN001', 2::NUMERIC),
  ('NEWONN011', 'NEWONN001', 2::NUMERIC)
) AS r(bundle_sku, component_sku, qty)
CROSS JOIN (
  SELECT created_by FROM inventory_items WHERE sku_internal = 'NEWONN001' LIMIT 1
) AS ii
ON CONFLICT (bundle_sku, component_sku) DO UPDATE
  SET quantity   = EXCLUDED.quantity,
      updated_at = NOW();

DO $$ BEGIN
  RAISE NOTICE 'Step 2 complete: upserted component recipes in inventory_bundle_components.';
END; $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Verify: list all bundle items and their recipes
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  ii.sku_internal                         AS bundle_sku,
  ii.is_bundle,
  ii.product_name,
  bc.component_sku,
  bc.quantity                             AS qty_per_bundle
FROM inventory_items ii
JOIN inventory_bundle_components bc ON bc.bundle_sku = ii.sku_internal
WHERE ii.sku_internal IN ('#0007', 'NEWONN003', '#0008', '#0080', 'NEWONN011')
ORDER BY ii.sku_internal, bc.component_sku;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Expected sold vs current allocated (pre-rebuild view)
--    Run this to confirm the gap this migration is designed to close.
--    After Apply COGS (MTD) the allocated column should match expected.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'NEWONN001'::text                                                   AS component_sku,
  (
    SELECT COALESCE(SUM(quantity), 0)
    FROM sales_orders
    WHERE seller_sku = 'NEWONN001'
      AND shipped_at IS NOT NULL
      AND quantity   > 0
  ) +
  (
    SELECT COALESCE(SUM(so.quantity * bc.quantity), 0)
    FROM sales_orders so
    JOIN inventory_bundle_components bc ON bc.bundle_sku = so.seller_sku
    WHERE bc.component_sku = 'NEWONN001'
      AND so.shipped_at IS NOT NULL
      AND so.quantity   > 0
  )                                                                   AS expected_demand,
  (
    SELECT COALESCE(SUM(qty), 0)
    FROM inventory_cogs_allocations
    WHERE sku_internal = 'NEWONN001'
      AND is_reversal  = false
  )                                                                   AS currently_allocated

UNION ALL

SELECT
  'NEWONN002'::text,
  (
    SELECT COALESCE(SUM(quantity), 0)
    FROM sales_orders
    WHERE seller_sku = 'NEWONN002'
      AND shipped_at IS NOT NULL
      AND quantity   > 0
  ) +
  (
    SELECT COALESCE(SUM(so.quantity * bc.quantity), 0)
    FROM sales_orders so
    JOIN inventory_bundle_components bc ON bc.bundle_sku = so.seller_sku
    WHERE bc.component_sku = 'NEWONN002'
      AND so.shipped_at IS NOT NULL
      AND so.quantity   > 0
  ),
  (
    SELECT COALESCE(SUM(qty), 0)
    FROM inventory_cogs_allocations
    WHERE sku_internal = 'NEWONN002'
      AND is_reversal  = false
  );

COMMIT;

-- ──────────────────────────────────────────────────────────────────────────────
-- NEXT STEPS
-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Apply migration-086 first if doing a full clean rebuild:
--    This resets the COGS ledger so the MTD run starts from scratch.
--
-- 2. Run "Apply COGS (MTD)" from Inventory → Movements:
--    - Date range: full history (e.g. 2024-01-01 to today)
--    - Method: FIFO
--    - The UI will auto-retry on timeout (up to 20 times)
--
-- 3. Run cogs-recovery-validation.sql to verify:
--    - Section 2: unallocated orders (should drop to near 0)
--    - Section 7: drain reconciliation (discrepancy should be 0)
--    - The in-migration query (Step 4) should show expected_demand ≈ allocated
--
-- After rebuild, expected component allocations (Jan–Mar):
--   NEWONN001: 7222 units  (5480 direct + 1742 from bundles)
--   NEWONN002: 2502 units  ( 982 direct + 1520 from bundles)
-- ──────────────────────────────────────────────────────────────────────────────
