-- ============================================
-- Migration 038: Fix order_attribution UPSERT Constraint
-- Purpose: Ensure unique index exists for ON CONFLICT in Affiliate Import
-- Issue: Error 42P10 in production - constraint mismatch
-- Date: 2026-02-01
-- ============================================

-- ============================================
-- A) DROP OLD INDEX (if exists with wrong name)
-- ============================================

-- In case production has a differently-named index, drop it first
DROP INDEX IF EXISTS public.idx_order_attribution_created_by_order_id;
DROP INDEX IF EXISTS public.uq_order_attribution_created_by_order_id;

-- ============================================
-- B) CREATE/RECREATE UNIQUE INDEX (Idempotent)
-- ============================================

-- This is the canonical unique index for order_attribution
-- It ensures one attribution row per (user, order)
DROP INDEX IF EXISTS public.idx_order_attribution_unique;

CREATE UNIQUE INDEX idx_order_attribution_unique
ON public.order_attribution(created_by, order_id);

-- ============================================
-- C) VERIFY CONSTRAINT EXISTS
-- ============================================

-- Query to verify the index was created successfully
-- Run this to confirm:
SELECT
    i.indexname,
    i.tablename,
    pg_get_indexdef(idx.indexrelid) as definition,
    idx.indisunique as is_unique
FROM pg_indexes i
JOIN pg_class c ON c.relname = i.indexname
JOIN pg_index idx ON idx.indexrelid = c.oid
WHERE i.tablename = 'order_attribution'
  AND i.indexname = 'idx_order_attribution_unique';

-- Expected result:
-- indexname: idx_order_attribution_unique
-- tablename: order_attribution
-- definition: CREATE UNIQUE INDEX idx_order_attribution_unique ON public.order_attribution USING btree (created_by, order_id)
-- is_unique: true

-- ============================================
-- D) VERIFY NO DUPLICATE ROWS EXIST
-- ============================================

-- Check if there are any duplicate (created_by, order_id) pairs
-- This query should return 0 rows
SELECT
    created_by,
    order_id,
    COUNT(*) as duplicate_count
FROM public.order_attribution
GROUP BY created_by, order_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- If duplicates exist, you need to clean them up before running this migration:
-- Option 1: Keep the most recent row
-- DELETE FROM public.order_attribution a
-- WHERE a.id NOT IN (
--     SELECT DISTINCT ON (created_by, order_id) id
--     FROM public.order_attribution
--     ORDER BY created_by, order_id, created_at DESC
-- );

-- ============================================
-- E) COMMENTS
-- ============================================

COMMENT ON INDEX idx_order_attribution_unique IS 'Ensures one attribution row per (user, order). Required for UPSERT in Affiliate Import.';

-- ============================================
-- END OF MIGRATION 038
-- ============================================
