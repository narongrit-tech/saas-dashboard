-- Verify Migration 053: Internal Affiliates
-- Checks table structure, constraints, indexes, and RLS policies

\echo '========================================='
\echo 'Verifying Migration 053: Internal Affiliates'
\echo '========================================='

-- 1. Check table exists
\echo '\n1. Checking table existence...'
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'internal_affiliates'
    )
    THEN '✅ Table internal_affiliates exists'
    ELSE '❌ Table internal_affiliates NOT FOUND'
  END AS status;

-- 2. Check columns
\echo '\n2. Checking columns...'
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'internal_affiliates'
ORDER BY ordinal_position;

-- 3. Check constraints
\echo '\n3. Checking constraints...'
SELECT
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = connamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'internal_affiliates'
ORDER BY con.conname;

-- 4. Check indexes
\echo '\n4. Checking indexes...'
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'internal_affiliates'
ORDER BY indexname;

-- 5. Check RLS is enabled
\echo '\n5. Checking RLS status...'
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'internal_affiliates';

-- 6. Check RLS policies
\echo '\n6. Checking RLS policies...'
SELECT
  policyname,
  cmd AS policy_type,
  qual AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'internal_affiliates'
ORDER BY policyname;

-- 7. Check triggers
\echo '\n7. Checking triggers...'
SELECT
  trigger_name,
  event_manipulation AS event,
  action_timing AS timing,
  action_statement AS action
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'internal_affiliates'
ORDER BY trigger_name;

-- 8. Sample data test (optional)
\echo '\n8. Testing sample insert (will rollback)...'
BEGIN;
  INSERT INTO internal_affiliates (channel_id, display_name, created_by)
  VALUES ('@test_affiliate', 'Test Affiliate', auth.uid());

  SELECT
    CASE
      WHEN COUNT(*) > 0
      THEN '✅ Sample insert successful'
      ELSE '❌ Sample insert failed'
    END AS status
  FROM internal_affiliates
  WHERE channel_id = '@test_affiliate';
ROLLBACK;

\echo '\n========================================='
\echo 'Verification Complete'
\echo '========================================='
