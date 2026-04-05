-- ============================================================
-- Verify: sales_orders unique constraint for ON CONFLICT
-- Purpose: Confirm that the correct unique index exists before
--          (or after) applying migration-099.
-- Run in: Supabase Dashboard > SQL Editor
-- ============================================================


-- ============================================================
-- CHECK 1: List all order_line_hash indexes on sales_orders
-- Expected after migration-099:
--   indexname = sales_orders_unique_order_line_hash
--   indexdef  = CREATE UNIQUE INDEX sales_orders_unique_order_line_hash
--               ON public.sales_orders USING btree (order_line_hash)
--   (NO "WHERE" clause, NO "created_by" in the index columns)
-- ============================================================
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename  = 'sales_orders'
  AND indexdef   LIKE '%order_line_hash%'
ORDER BY indexname;

-- ============================================================
-- CHECK 2: Confirm the EXACT index used by ON CONFLICT exists
-- Expected: 1 row with indisunique = true and no indpred (no WHERE)
-- ============================================================
SELECT
  i.relname                                   AS index_name,
  ix.indisunique                              AS is_unique,
  ix.indpred IS NULL                          AS is_full_index,   -- true = no WHERE clause
  array_agg(a.attname ORDER BY k.ordinality) AS columns
FROM pg_index ix
JOIN pg_class  i  ON i.oid  = ix.indexrelid
JOIN pg_class  t  ON t.oid  = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality)
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
WHERE n.nspname = 'public'
  AND t.relname = 'sales_orders'
  AND i.relname = 'sales_orders_unique_order_line_hash'
GROUP BY i.relname, ix.indisunique, ix.indpred;

-- ============================================================
-- CHECK 3: Confirm OLD composite index is gone
-- Expected: 0 rows (index was dropped by migration-099)
-- ============================================================
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename  = 'sales_orders'
  AND indexname  = 'sales_orders_unique_created_by_order_line_hash';

-- ============================================================
-- CHECK 4: Duplicate hash scan — must be 0 rows before and after
-- If rows are returned, the new unique index cannot be created.
-- (Should always be 0 because hash includes created_by in input.)
-- ============================================================
SELECT
  order_line_hash,
  COUNT(*)            AS duplicate_count,
  array_agg(id)       AS row_ids,
  array_agg(created_by::text) AS owners
FROM public.sales_orders
WHERE order_line_hash IS NOT NULL
GROUP BY order_line_hash
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 10;

-- ============================================================
-- INTERPRETATION
-- ============================================================
-- CHECK 1: Should show exactly 1 row, with "order_line_hash" only
--          (not "created_by, order_line_hash")
-- CHECK 2: is_unique=true, is_full_index=true, columns={"order_line_hash"}
-- CHECK 3: Should return 0 rows (old index gone)
-- CHECK 4: Should return 0 rows (no hash duplicates)
--
-- If CHECK 3 returns 1 row and CHECK 1 shows the composite index:
--   → migration-099 has NOT been applied yet.
--   → Apply: database-scripts/migration-099-fix-sales-orders-conflict-target.sql
-- ============================================================
