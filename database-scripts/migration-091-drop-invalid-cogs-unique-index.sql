-- migration-091: Drop invalid unique index on inventory_cogs_allocations
-- ============================================================================
-- PROBLEM
--   A unique index CREATE UNIQUE INDEX uniq_cogs_order ON
--   inventory_cogs_allocations(order_id) was manually applied to production
--   outside the migration chain.
--
--   This index is WRONG because one order legitimately produces MULTIPLE rows:
--   - Bundle orders: one row per component SKU (e.g. NEWONN001 + NEWONN002)
--   - FIFO spanning multiple layers: one order may consume N receipt layers
--     → N rows with the same order_id but different layer_id
--   - Reversal rows: is_reversal=true rows coexist with is_reversal=false rows
--
--   The correct idempotency model is RPC-level:
--     allocate_cogs_fifo:        checks (order_id, sku_internal, is_reversal=false)
--     allocate_cogs_bundle_fifo: checks (order_id, all component SKUs, is_reversal=false)
--   No DB unique constraint at order_id grain is needed or correct.
--
-- ACTION
--   Drop the bad index and any variant names it might carry.
--   Confirm correct non-unique performance indexes exist.
--
-- Run in Supabase SQL Editor (postgres/superuser). Safe to run multiple times.
-- ============================================================================

-- Drop the invalid index — silently succeeds if already absent
DROP INDEX IF EXISTS public.uniq_cogs_order;

-- Protect against alternate names
DROP INDEX IF EXISTS public.inventory_cogs_allocations_order_id_key;
DROP INDEX IF EXISTS public.idx_cogs_allocations_order_unique;

-- Ensure correct non-unique performance index exists
CREATE INDEX IF NOT EXISTS idx_cogs_allocations_order_sku
  ON public.inventory_cogs_allocations(order_id, sku_internal)
  WHERE is_reversal = false;

-- ── Verify: list all indexes on inventory_cogs_allocations ───────────────────
SELECT
  indexname,
  CASE WHEN indexdef ILIKE '%unique%' THEN '⚠️  UNIQUE' ELSE '   regular' END AS index_type,
  indexdef
FROM pg_indexes
WHERE tablename = 'inventory_cogs_allocations'
ORDER BY indexname;
-- Expected: NO rows with index_type = '⚠️  UNIQUE' on order_id alone
