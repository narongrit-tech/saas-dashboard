-- ============================================
-- Verify Import Batches Status
-- Use this to check for failed imports
-- ============================================

-- Check all import batches with their status
SELECT
  id,
  created_at,
  marketplace,
  report_type,
  file_name,
  status,
  row_count,
  inserted_count,
  error_count,
  notes
FROM public.import_batches
ORDER BY created_at DESC
LIMIT 20;

-- ============================================
-- Find Failed Imports (0 rows inserted)
-- ============================================

SELECT
  id,
  created_at,
  marketplace,
  report_type,
  file_name,
  status,
  row_count,
  inserted_count,
  notes AS error_message
FROM public.import_batches
WHERE status = 'failed' OR inserted_count = 0
ORDER BY created_at DESC;

-- ============================================
-- Check Import Batch vs Actual Rows
-- Verify that inserted_count matches actual rows
-- ============================================

-- For Sales Orders
SELECT
  ib.id AS batch_id,
  ib.file_name,
  ib.status,
  ib.inserted_count AS claimed_count,
  COUNT(so.id) AS actual_count,
  CASE
    WHEN ib.inserted_count = COUNT(so.id) THEN '✅ MATCH'
    ELSE '❌ MISMATCH'
  END AS verification
FROM public.import_batches ib
LEFT JOIN public.sales_orders so ON so.import_batch_id = ib.id
WHERE ib.marketplace = 'tiktok_shop'
GROUP BY ib.id, ib.file_name, ib.status, ib.inserted_count
ORDER BY ib.created_at DESC
LIMIT 10;

-- For Expenses
SELECT
  ib.id AS batch_id,
  ib.file_name,
  ib.status,
  ib.inserted_count AS claimed_count,
  COUNT(e.id) AS actual_count,
  CASE
    WHEN ib.inserted_count = COUNT(e.id) THEN '✅ MATCH'
    ELSE '❌ MISMATCH'
  END AS verification
FROM public.import_batches ib
LEFT JOIN public.expenses e ON e.import_batch_id = ib.id
WHERE ib.report_type = 'expenses'
GROUP BY ib.id, ib.file_name, ib.status, ib.inserted_count
ORDER BY ib.created_at DESC
LIMIT 10;

-- ============================================
-- Clean Up Failed Batches (OPTIONAL)
-- Use this if you want to delete failed batches
-- to allow re-import after fixing the issue
-- ============================================

-- CAUTION: This will delete failed batches
-- Uncomment and run only if you want to clean up

-- DELETE FROM public.import_batches
-- WHERE status = 'failed' AND inserted_count = 0;
