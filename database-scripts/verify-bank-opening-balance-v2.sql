-- Verification Script: Check if bank_opening_balances v2 exists with correct constraint
-- Run this in Supabase SQL Editor to verify migration

-- ============================================================================
-- Check if table exists
-- ============================================================================

SELECT
  EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'bank_opening_balances'
  ) AS table_exists;

-- ============================================================================
-- Check table structure
-- ============================================================================

SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'bank_opening_balances'
ORDER BY ordinal_position;

-- ============================================================================
-- Check unique constraint exists
-- ============================================================================

SELECT
  conname AS constraint_name,
  contype AS constraint_type,
  array_agg(attname ORDER BY attnum) AS constraint_columns
FROM pg_constraint
JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
JOIN unnest(conkey) WITH ORDINALITY AS u(attnum, ord) ON true
JOIN pg_attribute ON pg_attribute.attrelid = pg_class.oid
  AND pg_attribute.attnum = u.attnum
WHERE pg_class.relname = 'bank_opening_balances'
  AND contype = 'u' -- unique constraint
GROUP BY conname, contype;

-- ============================================================================
-- Check indexes
-- ============================================================================

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'bank_opening_balances'
ORDER BY indexname;

-- ============================================================================
-- Check RLS policies
-- ============================================================================

SELECT
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'bank_opening_balances'
ORDER BY policyname;

-- ============================================================================
-- Sample data count
-- ============================================================================

SELECT COUNT(*) AS record_count
FROM public.bank_opening_balances;
