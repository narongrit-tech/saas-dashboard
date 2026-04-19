-- precheck-unique-constraints-team-dedup.sql
-- ============================================================
-- PURPOSE : Detect cross-user duplicate key conflicts BEFORE
--           altering unique constraints to drop the created_by
--           column (phase-2 team dedup, noted as tech debt in
--           migration-088).
--
-- These are SELECT-only queries. No data is modified.
--
-- HOW TO READ THE OUTPUT
-- ----------------------
-- Each query returns rows where the same business key exists
-- under more than one created_by value.
--
-- count > 0  =>  CONFLICT EXISTS.
--               You must reconcile duplicates before changing the
--               unique constraint, or the ALTER / CREATE UNIQUE
--               INDEX will fail with a unique-violation error.
--               Typical remediation options:
--                 a) Delete the duplicate rows that are redundant
--                    (e.g. keep only the canonical owner's rows).
--                 b) Merge created_by values into one team owner
--                    and delete the others.
--                 c) Keep the per-user constraint (accept tech debt
--                    until a proper dedup strategy is defined).
--
-- count = 0  =>  No conflicts. Safe to proceed with constraint change.
--
-- Run: psql $DATABASE_URL -f database-scripts/precheck-unique-constraints-team-dedup.sql
-- ============================================================


-- ============================================================
-- CHECK 1: sales_orders — duplicate order_line_hash across users
--
-- Current constraint: UNIQUE(created_by, order_line_hash)
-- Target constraint:  UNIQUE(order_line_hash)
--
-- A conflict row means two or more users imported the same order
-- line (same hash) independently. Dropping created_by from the
-- constraint would violate uniqueness on those hashes.
-- ============================================================

SELECT
    order_line_hash,
    COUNT(DISTINCT created_by)  AS user_count,
    COUNT(*)                    AS total_rows,
    array_agg(DISTINCT created_by::TEXT) AS conflicting_users
FROM public.sales_orders
WHERE order_line_hash IS NOT NULL
GROUP BY order_line_hash
HAVING COUNT(DISTINCT created_by) > 1
ORDER BY total_rows DESC;
-- count = 0 rows  => safe to change UNIQUE to (order_line_hash) alone
-- count > 0 rows  => conflicts exist; do NOT drop created_by from constraint


-- ============================================================
-- CHECK 2: inventory_sku_mappings — duplicate (channel, marketplace_sku)
--          across users
--
-- Current constraint: UNIQUE(created_by, channel, marketplace_sku)
-- Target constraint:  UNIQUE(channel, marketplace_sku)
--
-- A conflict row means two users created a mapping for the same
-- channel + marketplace_sku pair, possibly pointing to different
-- sku_internal values. This is a data-integrity problem that must
-- be resolved before removing created_by from the constraint.
-- ============================================================

SELECT
    channel,
    marketplace_sku,
    COUNT(DISTINCT created_by)              AS user_count,
    COUNT(*)                                AS total_rows,
    array_agg(DISTINCT created_by::TEXT)    AS conflicting_users,
    array_agg(DISTINCT sku_internal)        AS mapped_sku_internals
FROM public.inventory_sku_mappings
GROUP BY channel, marketplace_sku
HAVING COUNT(DISTINCT created_by) > 1
ORDER BY channel, marketplace_sku;
-- count = 0 rows  => safe to change UNIQUE to (channel, marketplace_sku) alone
-- count > 0 rows  => conflicts exist; resolve before constraint change
--                    Pay special attention when sku_internal values differ
--                    across users — those are mapping disagreements that
--                    require a business decision on the canonical mapping.


-- ============================================================
-- CHECK 3: ad_daily_performance — duplicate source_row_hash
--          across users
--
-- Current constraint: UNIQUE(source_row_hash, created_by)  [or similar]
-- Target constraint:  UNIQUE(source_row_hash)
--
-- A conflict row means two users imported the same ad report row
-- (same content hash). Dropping created_by from the constraint
-- would fail on those hashes.
-- ============================================================

SELECT
    source_row_hash,
    COUNT(DISTINCT created_by)              AS user_count,
    COUNT(*)                                AS total_rows,
    array_agg(DISTINCT created_by::TEXT)    AS conflicting_users
FROM public.ad_daily_performance
WHERE source_row_hash IS NOT NULL
GROUP BY source_row_hash
HAVING COUNT(DISTINCT created_by) > 1
ORDER BY total_rows DESC;
-- count = 0 rows  => safe to change UNIQUE to (source_row_hash) alone
-- count > 0 rows  => conflicts exist; do NOT drop created_by from constraint


-- ============================================================
-- SUMMARY HELPER
-- Returns a one-row-per-table conflict count to read at a glance.
-- ============================================================

SELECT 'sales_orders.order_line_hash' AS constraint_target,
       COUNT(*) AS conflicting_hashes
FROM (
    SELECT order_line_hash
    FROM public.sales_orders
    WHERE order_line_hash IS NOT NULL
    GROUP BY order_line_hash
    HAVING COUNT(DISTINCT created_by) > 1
) s

UNION ALL

SELECT 'inventory_sku_mappings.(channel,marketplace_sku)' AS constraint_target,
       COUNT(*) AS conflicting_hashes
FROM (
    SELECT channel, marketplace_sku
    FROM public.inventory_sku_mappings
    GROUP BY channel, marketplace_sku
    HAVING COUNT(DISTINCT created_by) > 1
) s

UNION ALL

SELECT 'ad_daily_performance.source_row_hash' AS constraint_target,
       COUNT(*) AS conflicting_hashes
FROM (
    SELECT source_row_hash
    FROM public.ad_daily_performance
    WHERE source_row_hash IS NOT NULL
    GROUP BY source_row_hash
    HAVING COUNT(DISTINCT created_by) > 1
) s

ORDER BY constraint_target;
-- All three values must be 0 before proceeding with phase-2 dedup migrations.
