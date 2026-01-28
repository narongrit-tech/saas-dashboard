-- ============================================
-- Debug Script: Sales Import Mystery
-- Purpose: Investigate why import_batches shows success but sales_orders is empty
-- Date: 2026-01-27
-- ============================================

-- STEP 1: Check Supabase project info
SELECT
    current_database() as database_name,
    current_user as current_user,
    inet_server_addr() as server_ip,
    version() as postgres_version;

-- STEP 2: Check import_batches for successful sales imports
SELECT
    id,
    file_name,
    marketplace,
    report_type,
    status,
    inserted_count,
    updated_count,
    error_count,
    row_count,
    notes,
    created_by,
    created_at,
    updated_at
FROM import_batches
WHERE report_type = 'sales_order_sku_list'
    AND status = 'success'
ORDER BY created_at DESC
LIMIT 10;

-- STEP 3: Check total rows in sales_orders
SELECT
    COUNT(*) as total_rows,
    COUNT(DISTINCT import_batch_id) as unique_batches,
    COUNT(DISTINCT created_by) as unique_users,
    MIN(created_at) as oldest_row,
    MAX(created_at) as newest_row
FROM sales_orders;

-- STEP 4: Cross-check: For each successful batch, count actual rows
WITH successful_batches AS (
    SELECT
        id as batch_id,
        file_name,
        inserted_count as claimed_count,
        created_at as batch_created_at
    FROM import_batches
    WHERE report_type = 'sales_order_sku_list'
        AND status = 'success'
    ORDER BY created_at DESC
    LIMIT 5
)
SELECT
    sb.batch_id,
    sb.file_name,
    sb.claimed_count,
    sb.batch_created_at,
    COUNT(so.id) as actual_count,
    CASE
        WHEN COUNT(so.id) = 0 AND sb.claimed_count > 0 THEN '❌ MISMATCH'
        WHEN COUNT(so.id) = sb.claimed_count THEN '✅ MATCH'
        ELSE '⚠️ PARTIAL'
    END as status
FROM successful_batches sb
LEFT JOIN sales_orders so ON so.import_batch_id = sb.batch_id
GROUP BY sb.batch_id, sb.file_name, sb.claimed_count, sb.batch_created_at
ORDER BY sb.batch_created_at DESC;

-- STEP 5: Check RLS policies
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'sales_orders';

-- STEP 6: Check if RLS is enabled
SELECT
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename IN ('sales_orders', 'import_batches');

-- STEP 7: Check for any triggers that might delete data
SELECT
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement,
    action_timing
FROM information_schema.triggers
WHERE event_object_table IN ('sales_orders', 'import_batches');

-- STEP 8: Check for scheduled jobs (if pg_cron is installed)
-- Uncomment if pg_cron extension exists
/*
SELECT
    jobid,
    schedule,
    command,
    nodename,
    active
FROM cron.job
WHERE command LIKE '%sales_orders%'
   OR command LIKE '%DELETE%'
   OR command LIKE '%TRUNCATE%';
*/

-- STEP 9: Sample some sales_orders data (if any exist)
SELECT
    id,
    order_id,
    external_order_id,
    source_platform,
    product_name,
    total_amount,
    import_batch_id,
    created_by,
    created_at
FROM sales_orders
ORDER BY created_at DESC
LIMIT 10;

-- STEP 10: Check for orphaned import_batches (success but no rows)
SELECT
    ib.id as batch_id,
    ib.file_name,
    ib.inserted_count as claimed_count,
    ib.status,
    ib.notes,
    ib.created_at as batch_created_at,
    COUNT(so.id) as actual_count
FROM import_batches ib
LEFT JOIN sales_orders so ON so.import_batch_id = ib.id
WHERE ib.report_type = 'sales_order_sku_list'
    AND ib.status = 'success'
GROUP BY ib.id, ib.file_name, ib.inserted_count, ib.status, ib.notes, ib.created_at
HAVING COUNT(so.id) = 0 AND ib.inserted_count > 0
ORDER BY ib.created_at DESC;

-- STEP 11: Check auth.users to verify user exists
SELECT
    id,
    email,
    created_at,
    last_sign_in_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- STEP 12: Verify the unique constraint exists
SELECT
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'sales_orders'::regclass
    AND conname LIKE '%order_line_hash%';

-- ============================================
-- DIAGNOSTIC SUMMARY
-- ============================================

-- Expected Results:
-- 1. If STEP 4 shows ❌ MISMATCH: Success batch exists but no rows in sales_orders
--    → Possible causes:
--      a) Wrong Supabase project (check NEXT_PUBLIC_SUPABASE_URL)
--      b) Data was deleted after import
--      c) RLS is blocking SELECT (but RLS shows USING(true) so unlikely)
--
-- 2. If STEP 10 shows rows: These are orphaned batches that need investigation
--
-- 3. If STEP 5 shows restrictive RLS: That's the cause (but current schema shows USING(true))
--
-- 4. If STEP 7 shows DELETE triggers: That could be deleting data after import
--
-- NEXT STEPS:
-- - Copy STEP 4 results and compare with import_batches.inserted_count
-- - Check application logs for "[finalizeImportBatch]" messages
-- - Verify .env.local has correct NEXT_PUBLIC_SUPABASE_URL
-- - Run: SELECT current_database(); in both dev and prod to confirm project

-- ============================================
-- END OF DIAGNOSTIC SCRIPT
-- ============================================
