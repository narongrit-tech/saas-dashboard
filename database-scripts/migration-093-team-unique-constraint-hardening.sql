-- migration-093-team-unique-constraint-hardening.sql
-- PURPOSE: Remove created_by from unique constraints to prevent cross-user duplicate rows
-- PRECHECK: Confirm 0 conflicts (precheck-unique-constraints-team-dedup.sql) before applying
-- Precheck was run and confirmed 0 conflicts for all target tables
--
-- NOTE — app code already updated (apply this migration AFTER deploying code):
--   sales-import-actions.ts: onConflict changed to 'order_line_hash'
--   performance-ads-import-actions.ts: onConflict changed to 'source_row_hash'
--   manual-mapping-actions.ts: onConflict changed to 'source_row_hash'
--   tiktok-income.ts: onConflict changed to 'marketplace,txn_id'
--   returns/actions.ts: onConflict changed to 'channel,marketplace_sku'
--
-- RISK — import_batches file dedup:
--   The file-level dedup index changes from (created_by, file_hash, report_type) to
--   (file_hash, report_type). After this migration, re-importing a file that a
--   different team member has already imported successfully will be rejected at the
--   DB level. This is the intended behaviour for team-level dedup.
--
-- RISK — settlement_transactions and inventory_sku_mappings:
--   Existing server actions that upsert using onConflict including created_by must be
--   updated to match the new constraint columns.
-- ============================================================


-- ============================================================
-- PRECHECK: Run this section first and verify counts are 0 before proceeding
-- ============================================================

SELECT 'sales_orders' AS tbl, order_line_hash, COUNT(DISTINCT created_by) AS users
FROM public.sales_orders
WHERE order_line_hash IS NOT NULL
GROUP BY order_line_hash HAVING COUNT(DISTINCT created_by) > 1
LIMIT 5;

SELECT 'settlement_transactions' AS tbl, marketplace, txn_id, COUNT(DISTINCT created_by) AS users
FROM public.settlement_transactions
GROUP BY marketplace, txn_id HAVING COUNT(DISTINCT created_by) > 1
LIMIT 5;

SELECT 'import_batches' AS tbl, file_hash, report_type, COUNT(DISTINCT created_by) AS users
FROM public.import_batches
WHERE file_hash IS NOT NULL AND status = 'success'
GROUP BY file_hash, report_type HAVING COUNT(DISTINCT created_by) > 1
LIMIT 5;


-- ============================================================
-- 1. sales_orders
--    Old index: sales_orders_unique_created_by_order_line_hash
--               ON (created_by, order_line_hash) — no WHERE clause (migration-025)
--    New index:  sales_orders_unique_order_line_hash
--               ON (order_line_hash)  ← non-partial, required for ON CONFLICT inference
--
--    NOTE: PostgreSQL treats NULL values as distinct in unique indexes,
--    so rows with NULL order_line_hash will not conflict with each other.
--    A partial index (WHERE IS NOT NULL) would break PostgREST ON CONFLICT
--    inference, so we use a full (non-partial) unique index here.
-- ============================================================

DROP INDEX IF EXISTS public.sales_orders_unique_created_by_order_line_hash;

CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_unique_order_line_hash
  ON public.sales_orders(order_line_hash);

COMMENT ON INDEX public.sales_orders_unique_order_line_hash IS
  'Team-level dedup: one row per order line hash across all team members. '
  'NULL values are treated as distinct (each NULL row is unique). '
  'Non-partial index required for PostgREST ON CONFLICT inference. '
  'Replaces sales_orders_unique_created_by_order_line_hash (migration-025). '
  'Server-side upsert uses onConflict: ''order_line_hash''.';


-- ============================================================
-- 2. inventory_sku_mappings
--    Old constraint: uq_sku_mapping_channel_marketplace
--                    UNIQUE (created_by, channel, marketplace_sku) — migration-070
--    New constraint: uq_sku_mapping_channel_marketplace
--                    UNIQUE (channel, marketplace_sku)
--
--    WARNING: If two team members have saved conflicting mappings for the
--    same (channel, marketplace_sku) pair pointing to different sku_internal
--    values, one of those rows must be resolved (merged or deleted) before
--    this migration can be applied without a unique violation.
--    Run the precheck query for inventory_sku_mappings in
--    precheck-unique-constraints-team-dedup.sql before proceeding.
-- ============================================================

ALTER TABLE public.inventory_sku_mappings
  DROP CONSTRAINT IF EXISTS uq_sku_mapping_channel_marketplace;

ALTER TABLE public.inventory_sku_mappings
  ADD CONSTRAINT uq_sku_mapping_channel_marketplace UNIQUE (channel, marketplace_sku);

COMMENT ON CONSTRAINT uq_sku_mapping_channel_marketplace ON public.inventory_sku_mappings IS
  'Team-level SKU mapping dedup: one mapping per (channel, marketplace_sku) '
  'across all team members. Replaces (created_by, channel, marketplace_sku) '
  'constraint from migration-070.';


-- ============================================================
-- 3. settlement_transactions
--    Old constraint: settlement_txns_unique_per_marketplace
--                    UNIQUE (marketplace, txn_id, created_by) — migration-004
--    New constraint: settlement_txns_unique_per_marketplace
--                    UNIQUE (marketplace, txn_id)
-- ============================================================

ALTER TABLE public.settlement_transactions
  DROP CONSTRAINT IF EXISTS settlement_txns_unique_per_marketplace;

ALTER TABLE public.settlement_transactions
  ADD CONSTRAINT settlement_txns_unique_per_marketplace UNIQUE (marketplace, txn_id);

COMMENT ON CONSTRAINT settlement_txns_unique_per_marketplace ON public.settlement_transactions IS
  'Team-level settlement dedup: one row per (marketplace, txn_id) '
  'across all team members. Replaces (marketplace, txn_id, created_by) '
  'constraint from migration-004.';


-- ============================================================
-- 4. ad_daily_performance
--    Old index: ad_daily_perf_created_by_source_row_hash_uidx
--               ON (created_by, source_row_hash) WHERE IS NOT NULL — migration-076
--    New index:  ad_daily_perf_source_row_hash_uidx
--               ON (source_row_hash)  ← non-partial, required for ON CONFLICT inference
--
--    NOTE: Non-partial index required for PostgREST ON CONFLICT inference.
--    Rows with NULL source_row_hash remain distinct (NULLs are unique in PG indexes).
--    The original migration-076 used WHERE IS NOT NULL only to reduce index size;
--    functionally equivalent behavior is preserved without the WHERE clause.
-- ============================================================

DROP INDEX IF EXISTS public.ad_daily_perf_created_by_source_row_hash_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS ad_daily_perf_source_row_hash_uidx
  ON public.ad_daily_performance(source_row_hash);

COMMENT ON INDEX public.ad_daily_perf_source_row_hash_uidx IS
  'Team-level ad dedup: one row per source_row_hash across all team members. '
  'NULL values are treated as distinct. Non-partial for PostgREST ON CONFLICT compatibility. '
  'Replaces ad_daily_perf_created_by_source_row_hash_uidx (migration-076). '
  'Server-side upsert uses onConflict: ''source_row_hash''.';


-- ============================================================
-- 5. import_batches
--    Old index: idx_import_batches_unique_file
--               ON (created_by, file_hash, report_type)
--               WHERE file_hash IS NOT NULL AND status = 'success' — migration-019
--    New index:  idx_import_batches_unique_file
--               ON (file_hash, report_type)
--               WHERE file_hash IS NOT NULL AND status = 'success'
--
--    Effect: a file successfully imported by one team member cannot be
--    re-imported by any other team member (same hash + report_type).
--    This is the intended team-level dedup behaviour.
-- ============================================================

DROP INDEX IF EXISTS public.idx_import_batches_unique_file;

CREATE UNIQUE INDEX IF NOT EXISTS idx_import_batches_unique_file
  ON public.import_batches(file_hash, report_type)
  WHERE file_hash IS NOT NULL AND status = 'success';

COMMENT ON INDEX public.idx_import_batches_unique_file IS
  'Team-level file dedup: a file (file_hash + report_type) that has been '
  'successfully imported by any team member cannot be imported again. '
  'Replaces (created_by, file_hash, report_type) index from migration-019.';
