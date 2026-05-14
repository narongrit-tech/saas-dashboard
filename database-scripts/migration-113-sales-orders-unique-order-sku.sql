-- ============================================================
-- Migration 113: UNIQUE (order_id, seller_sku) on sales_orders
-- ============================================================
-- PURPOSE
--   Defense in depth — guarantee that no two rows can share the same
--   (order_id, seller_sku) pair, regardless of what order_line_hash
--   evaluates to.
--
-- ROOT CAUSE (May 2026)
--   generateOrderLineHash() in sales-import-actions.ts included `userId`
--   as the first input. When two users in the same workspace
--   (delegate + primary, per migration-112) imported overlapping files,
--   the same business order produced two different hashes, so the
--   migration-099 single-column unique on order_line_hash never fired.
--   Result: 4,139 duplicate (order_id, seller_sku) groups → over-allocated
--   COGS by 5,439 NEWONN001 + 1,619 NEWONN002 units.
--
-- CODE FIX (paired)
--   sales-import-actions.ts:
--     1. generateOrderLineHash() — removed userId from hash input.
--     2. upsert(...).onConflict — switched from 'order_line_hash' to
--        'order_id,seller_sku' (this index).
--
-- IDEMPOTENT — safe to re-run. DROPS/RECREATES the unique index.
--
-- PRECHECK (must return 0 rows before this migration runs):
--   SELECT order_id, seller_sku, COUNT(*) AS cnt
--   FROM public.sales_orders
--   WHERE order_id IS NOT NULL AND seller_sku IS NOT NULL
--   GROUP BY order_id, seller_sku
--   HAVING COUNT(*) > 1;
--
--   Data was deduplicated by a one-time service-role script on 2026-05-14
--   (4,139 newer copies removed, allocation rows reversed, layer
--   qty_remaining restored).
--
-- DATE: 2026-05-14
-- ============================================================


-- ── 1. Drop any prior variant of this index (safe no-op if absent) ──────────
DROP INDEX IF EXISTS public.sales_orders_unique_order_sku;
DROP INDEX IF EXISTS public.sales_orders_unique_order_id_seller_sku;

-- ── 2. Create the unique index ──────────────────────────────────────────────
-- PostgreSQL treats NULLs in unique indexes as distinct by default, so manual
-- entries with NULL order_id remain allowed. Both columns are non-null in
-- imports from external marketplaces.
CREATE UNIQUE INDEX sales_orders_unique_order_sku
  ON public.sales_orders (order_id, seller_sku)
  WHERE order_id IS NOT NULL AND seller_sku IS NOT NULL;

COMMENT ON INDEX public.sales_orders_unique_order_sku IS
  'Defense-in-depth uniqueness for marketplace orders. Code uses this index as ON CONFLICT target. Combined with migration-099 (order_line_hash) for backward compatibility.';


-- ── 3. Verify ──────────────────────────────────────────────────────────────
SELECT
  schemaname,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'sales_orders'
  AND indexname IN ('sales_orders_unique_order_sku', 'sales_orders_unique_order_line_hash')
ORDER BY indexname;

-- Confirm no duplicates remain (should return 0 rows)
SELECT order_id, seller_sku, COUNT(*) AS cnt
FROM public.sales_orders
WHERE order_id IS NOT NULL AND seller_sku IS NOT NULL
GROUP BY order_id, seller_sku
HAVING COUNT(*) > 1
LIMIT 5;
