-- verify-rls-policies.sql
-- ============================================
-- Run after migration-066-fix-rls-policies.sql to confirm the security posture.
-- Usage: psql $DATABASE_URL -f database-scripts/verify/verify-rls-policies.sql
-- ============================================

-- 1. List all tables with RLS enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = true
ORDER BY tablename;

-- 2. List ALL policies — show permissive ones that might be too broad
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
WHERE schemaname = 'public'
ORDER BY tablename, cmd;

-- 3. Find any remaining USING(true) policies (should be EMPTY after migration)
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND qual = 'true'
ORDER BY tablename;

-- 4. Verify core tables have created_by = auth.uid() isolation
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
      'sales_orders',
      'expenses',
      'inventory',
      'payables',
      'tax_records',
      'ceo_transactions'
  )
ORDER BY tablename, cmd;

-- 5. Tables with RLS enabled but NO policies defined (dangerous - blocks all access)
SELECT t.tablename
FROM pg_tables t
WHERE t.schemaname = 'public' AND t.rowsecurity = true
  AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.tablename
  );
