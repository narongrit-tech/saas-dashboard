-- ============================================
-- Verification Queries: order_attribution Constraint
-- Purpose: Diagnose and verify UPSERT constraint fix
-- Use: Run these in production to debug error 42P10
-- ============================================

-- ============================================
-- 1) CHECK IF UNIQUE INDEX EXISTS
-- ============================================

-- Expected: 1 row with indexname = 'idx_order_attribution_unique'
-- If 0 rows: Index is missing → Run migration-038
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

-- ============================================
-- 2) LIST ALL INDEXES ON order_attribution
-- ============================================

-- Check what indexes actually exist
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'order_attribution'
ORDER BY indexname;

-- ============================================
-- 3) CHECK FOR DUPLICATE ROWS
-- ============================================

-- This should return 0 rows if data is clean
-- If duplicates exist, they will prevent unique index creation
SELECT
    created_by,
    order_id,
    COUNT(*) as duplicate_count,
    STRING_AGG(id::text, ', ') as duplicate_ids
FROM order_attribution
GROUP BY created_by, order_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 10;

-- ============================================
-- 4) CHECK RECENT IMPORT BATCHES
-- ============================================

-- See if any imports failed with constraint errors
SELECT
    id,
    file_name,
    status,
    row_count,
    inserted_count,
    created_at,
    notes
FROM import_batches
WHERE marketplace = 'affiliate'
  AND report_type = 'affiliate_sales_th'
ORDER BY created_at DESC
LIMIT 10;

-- ============================================
-- 5) COUNT order_attribution ROWS BY BATCH
-- ============================================

-- Verify which batches actually inserted data
SELECT
    ib.id as batch_id,
    ib.file_name,
    ib.status,
    ib.inserted_count as expected_count,
    COUNT(oa.id) as actual_count,
    ib.created_at
FROM import_batches ib
LEFT JOIN order_attribution oa ON oa.import_batch_id = ib.id
WHERE ib.marketplace = 'affiliate'
GROUP BY ib.id, ib.file_name, ib.status, ib.inserted_count, ib.created_at
ORDER BY ib.created_at DESC
LIMIT 10;

-- ============================================
-- 6) TEST UPSERT QUERY (DRY RUN)
-- ============================================

-- Test if constraint works with a sample UPSERT
-- Replace <your_user_id> and <sample_order_id> with real values
-- This should succeed if constraint exists
/*
INSERT INTO order_attribution (
    created_by,
    order_id,
    attribution_type,
    commission_amt,
    commission_amt_organic,
    commission_amt_shop_ad,
    commission_type
)
VALUES (
    '<your_user_id>'::uuid,
    '<sample_order_id>',
    'external_affiliate',
    100.00,
    100.00,
    0.00,
    'organic'
)
ON CONFLICT (created_by, order_id)
DO UPDATE SET
    commission_amt = EXCLUDED.commission_amt,
    commission_amt_organic = EXCLUDED.commission_amt_organic,
    commission_amt_shop_ad = EXCLUDED.commission_amt_shop_ad,
    commission_type = EXCLUDED.commission_type,
    updated_at = NOW()
RETURNING id, created_by, order_id;
*/

-- ============================================
-- 7) AFTER SUCCESSFUL IMPORT: VERIFY INSERTS
-- ============================================

-- Run this after import to confirm rows were inserted
-- Replace <batch_id> with the returned batchId from import
/*
SELECT
    COUNT(*) as total_rows,
    COUNT(DISTINCT order_id) as distinct_orders,
    SUM(commission_amt) as total_commission,
    SUM(commission_amt_organic) as total_organic,
    SUM(commission_amt_shop_ad) as total_shop_ad,
    MIN(created_at) as oldest_row,
    MAX(created_at) as newest_row
FROM order_attribution
WHERE import_batch_id = '<batch_id>'::uuid;
*/

-- ============================================
-- 8) QUICK FIX: CLEAN UP DUPLICATES (IF NEEDED)
-- ============================================

-- DANGEROUS: Only run this if you have duplicates preventing index creation
-- This keeps the most recent row for each (created_by, order_id) pair
/*
DELETE FROM order_attribution a
WHERE a.id NOT IN (
    SELECT DISTINCT ON (created_by, order_id) id
    FROM order_attribution
    ORDER BY created_by, order_id, created_at DESC
);
*/

-- ============================================
-- END OF VERIFICATION QUERIES
-- ============================================
