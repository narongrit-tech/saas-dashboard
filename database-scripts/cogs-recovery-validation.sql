-- cogs-recovery-validation.sql
-- ──────────────────────────────────────────────────────────────────────────────
-- Run this AFTER applying migration-086 and AFTER running Apply COGS (MTD)
-- from the dashboard UI.
--
-- Purpose: verify that the COGS ledger rebuild is complete and correct.
--
-- Run each section independently in the Supabase SQL Editor.
-- All sections are SELECT-only (read-only, safe to run at any time).
-- ──────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- Section 1: Overall summary
--   Quick health check — all three counts should be > 0 after rebuild.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM inventory_cogs_allocations WHERE is_reversal = false)  AS normal_allocations,
  (SELECT COUNT(*) FROM inventory_cogs_allocations WHERE is_reversal = true)   AS reversal_allocations,
  (SELECT COUNT(*) FROM inventory_cost_snapshots)                               AS cost_snapshots,
  (SELECT COUNT(*) FROM inventory_receipt_layers WHERE is_voided = false AND qty_remaining > 0) AS layers_with_stock,
  (SELECT COUNT(*) FROM cogs_allocation_runs WHERE status = 'running')          AS stale_running_runs;


-- ─────────────────────────────────────────────────────────────────────────────
-- Section 2: Shipped orders with NO COGS allocation (unallocated orders)
--   After a full MTD rebuild, this should return 0 rows for orders with a
--   non-null seller_sku that maps to an inventory item.
--
--   Rows in this result indicate:
--     - Orders with seller_sku = NULL (never mapped — expected skips)
--     - Orders whose SKU has no receipt layers (stock not yet imported)
--     - COGS run did not reach these orders (check run history)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  so.id                                                          AS order_id,
  so.order_id                                                    AS external_order_id,
  so.seller_sku,
  so.quantity,
  so.shipped_at                                                  AT TIME ZONE 'Asia/Bangkok' AS shipped_at_bkk,
  so.source_platform,
  so.created_by
FROM sales_orders so
WHERE so.shipped_at IS NOT NULL
  AND so.quantity   > 0
  AND NOT EXISTS (
    SELECT 1
    FROM inventory_cogs_allocations ca
    WHERE ca.order_id    = so.id::text
      AND ca.is_reversal = false
      AND ca.created_by  = so.created_by
  )
ORDER BY so.shipped_at DESC
LIMIT 200;


-- ─────────────────────────────────────────────────────────────────────────────
-- Section 3: Per-SKU on-hand after rebuild
--   Compare qty_remaining (FIFO layer balance) against physical count.
--   Computed on-hand = SUM(qty_remaining) across all active layers for the SKU.
--   Also shows total COGS amount allocated per SKU.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  rl.created_by,
  rl.sku_internal,
  SUM(rl.qty_remaining)                                          AS computed_on_hand,
  SUM(rl.qty_received)                                           AS total_received,
  SUM(rl.qty_received - rl.qty_remaining)                        AS total_drained,
  COALESCE(ca.total_cogs_qty,    0)                              AS cogs_allocated_qty,
  COALESCE(ca.total_cogs_amount, 0)                              AS cogs_allocated_amount,
  COALESCE(adj.total_adj_out_qty, 0)                             AS adjust_out_qty
FROM inventory_receipt_layers rl
LEFT JOIN (
  SELECT sku_internal, created_by,
         SUM(qty)    AS total_cogs_qty,
         SUM(amount) AS total_cogs_amount
    FROM inventory_cogs_allocations
   WHERE is_reversal = false
   GROUP BY sku_internal, created_by
) ca ON ca.sku_internal = rl.sku_internal AND ca.created_by = rl.created_by
LEFT JOIN (
  SELECT sku_internal, created_by,
         SUM(quantity) AS total_adj_out_qty
    FROM inventory_adjustments
   WHERE adjustment_type = 'ADJUST_OUT'
   GROUP BY sku_internal, created_by
) adj ON adj.sku_internal = rl.sku_internal AND adj.created_by = rl.created_by
WHERE rl.is_voided = false
GROUP BY rl.created_by, rl.sku_internal,
         ca.total_cogs_qty, ca.total_cogs_amount, adj.total_adj_out_qty
ORDER BY rl.sku_internal;


-- ─────────────────────────────────────────────────────────────────────────────
-- Section 4: COGS allocation run history (most recent first)
--   Shows the last 20 runs. After rebuild you should see at least one
--   'success' run with a non-null summary_json.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  id,
  trigger_source,
  import_batch_id,
  status,
  summary_json ->> 'successful'   AS successful_orders,
  summary_json ->> 'skipped'      AS skipped_orders,
  summary_json ->> 'failed'       AS failed_orders,
  error_message,
  created_at                      AT TIME ZONE 'Asia/Bangkok' AS created_at_bkk,
  updated_at                      AT TIME ZONE 'Asia/Bangkok' AS updated_at_bkk
FROM cogs_allocation_runs
ORDER BY created_at DESC
LIMIT 20;


-- ─────────────────────────────────────────────────────────────────────────────
-- Section 5: Return reversals — which returns have COGS reversals vs. missing
--   is_reversal=true rows represent stock return corrections.
--   Returns with sku_internal set should each have a matching reversal row.
--
--   'has_reversal' = true  → return was reversed correctly in COGS
--   'has_reversal' = false → return has no reversal (may be normal if the
--                            original order was never allocated, or may indicate
--                            a gap that needs manual review)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  r.id                                                           AS return_id,
  r.order_id                                                     AS sales_order_uuid,
  r.marketplace_sku,
  r.sku_internal,
  r.is_active,
  r.created_by,
  EXISTS (
    SELECT 1
    FROM inventory_cogs_allocations ca
    WHERE ca.order_id    = r.order_id::text
      AND ca.sku_internal = r.sku_internal
      AND ca.is_reversal  = true
      AND ca.created_by   = r.created_by
  )                                                              AS has_reversal,
  EXISTS (
    SELECT 1
    FROM inventory_cogs_allocations ca
    WHERE ca.order_id    = r.order_id::text
      AND ca.sku_internal = r.sku_internal
      AND ca.is_reversal  = false
      AND ca.created_by   = r.created_by
  )                                                              AS original_order_allocated
FROM inventory_returns r
WHERE r.sku_internal IS NOT NULL
  AND r.is_active    = true
ORDER BY r.created_by, r.sku_internal;


-- ─────────────────────────────────────────────────────────────────────────────
-- Section 6: Bundle COGS check (NEWONN003 and any other bundles)
--   Bundles allocate COGS per component, not per bundle SKU.
--   This query shows whether bundle orders have component-level allocations.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  bc.bundle_sku,
  bc.component_sku,
  bc.qty_per_bundle,
  COUNT(DISTINCT ca.order_id)                                    AS allocated_order_count,
  SUM(ca.qty)                                                    AS total_qty_allocated,
  SUM(ca.amount)                                                 AS total_cogs_amount
FROM inventory_bundle_components bc
LEFT JOIN inventory_cogs_allocations ca
  ON  ca.sku_internal = bc.component_sku
  AND ca.is_reversal  = false
GROUP BY bc.bundle_sku, bc.component_sku, bc.qty_per_bundle
ORDER BY bc.bundle_sku, bc.component_sku;


-- ─────────────────────────────────────────────────────────────────────────────
-- Section 7: Receipt layer drain reconciliation (spot-check)
--   For each SKU: total_drained should equal total_cogs_allocated + total_adj_out.
--   Discrepancies indicate orphaned drains or missing allocations.
-- ─────────────────────────────────────────────────────────────────────────────
WITH layer_summary AS (
  SELECT
    created_by,
    sku_internal,
    SUM(qty_received - qty_remaining) AS total_drained_from_layers
  FROM inventory_receipt_layers
  WHERE is_voided = false
  GROUP BY created_by, sku_internal
),
cogs_summary AS (
  SELECT
    created_by,
    sku_internal,
    SUM(qty) AS total_cogs_qty
  FROM inventory_cogs_allocations
  WHERE is_reversal = false
  GROUP BY created_by, sku_internal
),
adj_summary AS (
  SELECT
    created_by,
    sku_internal,
    SUM(quantity) AS total_adj_out_qty
  FROM inventory_adjustments
  WHERE adjustment_type = 'ADJUST_OUT'
  GROUP BY created_by, sku_internal
)
SELECT
  ls.created_by,
  ls.sku_internal,
  ls.total_drained_from_layers,
  COALESCE(cs.total_cogs_qty,   0)   AS cogs_allocated_qty,
  COALESCE(adj.total_adj_out_qty, 0) AS adj_out_qty,
  COALESCE(cs.total_cogs_qty, 0) + COALESCE(adj.total_adj_out_qty, 0) AS expected_drain,
  ls.total_drained_from_layers
    - COALESCE(cs.total_cogs_qty, 0)
    - COALESCE(adj.total_adj_out_qty, 0)                               AS discrepancy
FROM layer_summary ls
LEFT JOIN cogs_summary  cs  ON cs.sku_internal  = ls.sku_internal AND cs.created_by  = ls.created_by
LEFT JOIN adj_summary   adj ON adj.sku_internal = ls.sku_internal AND adj.created_by = ls.created_by
ORDER BY ABS(
  ls.total_drained_from_layers
    - COALESCE(cs.total_cogs_qty, 0)
    - COALESCE(adj.total_adj_out_qty, 0)
) DESC NULLS LAST;
