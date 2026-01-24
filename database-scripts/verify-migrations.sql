-- ============================================
-- Verify Import Migrations Applied
-- Run this to check if required columns exist
-- ============================================

-- Check import_batches table exists
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'import_batches'
    ) THEN '✅ import_batches table EXISTS'
    ELSE '❌ import_batches table MISSING - Run migration-001-import-batches.sql'
  END AS import_batches_check;

-- Check sales_orders columns
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'sales_orders'
        AND column_name = 'source'
    ) THEN '✅ sales_orders.source EXISTS'
    ELSE '❌ sales_orders.source MISSING'
  END AS sales_source_check;

SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'sales_orders'
        AND column_name = 'import_batch_id'
    ) THEN '✅ sales_orders.import_batch_id EXISTS'
    ELSE '❌ sales_orders.import_batch_id MISSING - Run migration-007-import-sales-expenses.sql'
  END AS sales_import_batch_check;

SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'sales_orders'
        AND column_name = 'metadata'
    ) THEN '✅ sales_orders.metadata EXISTS'
    ELSE '❌ sales_orders.metadata MISSING'
  END AS sales_metadata_check;

-- Check expenses columns
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'expenses'
        AND column_name = 'source'
    ) THEN '✅ expenses.source EXISTS'
    ELSE '❌ expenses.source MISSING'
  END AS expenses_source_check;

SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'expenses'
        AND column_name = 'import_batch_id'
    ) THEN '✅ expenses.import_batch_id EXISTS'
    ELSE '❌ expenses.import_batch_id MISSING - Run migration-007-import-sales-expenses.sql'
  END AS expenses_import_batch_check;

-- Summary
SELECT '==========================' AS summary;
SELECT 'MIGRATION STATUS SUMMARY' AS summary;
SELECT '==========================' AS summary;

SELECT
  COUNT(*) FILTER (WHERE column_name IN ('source', 'import_batch_id', 'metadata')) AS sales_orders_columns_added,
  3 AS sales_orders_columns_required
FROM information_schema.columns
WHERE table_name = 'sales_orders';

SELECT
  COUNT(*) FILTER (WHERE column_name IN ('source', 'import_batch_id')) AS expenses_columns_added,
  2 AS expenses_columns_required
FROM information_schema.columns
WHERE table_name = 'expenses';

SELECT '==========================' AS instructions;
SELECT 'If any ❌ appear above:' AS instructions;
SELECT '1. Apply missing migrations in Supabase SQL Editor' AS instructions;
SELECT '2. Restart frontend dev server' AS instructions;
SELECT '3. Run this verification again' AS instructions;
SELECT '==========================' AS instructions;
