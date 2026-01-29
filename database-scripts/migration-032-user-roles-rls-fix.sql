-- ============================================
-- Migration 032: Fix user_roles RLS Policies (Remove Recursive Check)
-- Description: Fix RLS policies on user_roles table to prevent recursive admin check
-- Phase: Sales Orders - Admin Tools - RLS Fix
-- Date: 2026-01-29
-- ============================================

-- ============================================
-- Problem:
-- - Migration-031 created RLS policies on user_roles table
-- - "user_roles_select_admin" policy has RECURSIVE check:
--   - To check if user is admin, it queries user_roles table
--   - But querying user_roles requires passing RLS policy first
--   - = Circular dependency causes query to fail
-- - This prevents server-side admin check from working
-- ============================================

-- ============================================
-- Solution:
-- - Keep only "user_roles_select_own" policy (users can read their own role)
-- - Drop "user_roles_select_admin" policy (no longer needed for basic admin check)
-- - Drop "user_roles_admin_all" policy (use service role for admin operations)
-- - Admin operations (INSERT/UPDATE/DELETE roles) should use service_role or SECURITY DEFINER functions
-- ============================================

-- ============================================
-- STEP 1: DROP PROBLEMATIC POLICIES
-- ============================================

-- Drop admin-only SELECT policy (recursive check)
DROP POLICY IF EXISTS "user_roles_select_admin" ON public.user_roles;

-- Drop admin-only INSERT/UPDATE/DELETE policy (recursive check)
DROP POLICY IF EXISTS "user_roles_admin_all" ON public.user_roles;

-- ============================================
-- STEP 2: VERIFY "user_roles_select_own" POLICY EXISTS
-- (Should already exist from migration-031, but recreate for safety)
-- ============================================

DROP POLICY IF EXISTS "user_roles_select_own" ON public.user_roles;
CREATE POLICY "user_roles_select_own"
ON public.user_roles FOR SELECT
TO authenticated
USING (user_id = auth.uid());

COMMENT ON POLICY "user_roles_select_own" ON public.user_roles IS
'Allow authenticated users to read their own role (no recursive check)';

-- ============================================
-- STEP 3: ENSURE RLS IS ENABLED
-- ============================================

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 4: FIX admin_actions RLS (If needed)
-- ============================================

-- Ensure admin_actions table has correct policies
-- (Insert should work via SECURITY DEFINER function, not via policy)

-- Drop existing policies on admin_actions to simplify
DROP POLICY IF EXISTS "admin_actions_select_admin" ON public.admin_actions;
DROP POLICY IF EXISTS "admin_actions_insert_function" ON public.admin_actions;

-- For now, keep admin_actions fully locked down via RLS
-- INSERT happens only via reset_tiktok_ordersku_list() SECURITY DEFINER function
-- SELECT can be allowed for admins ONLY (no recursive check needed since function bypasses RLS)

-- No SELECT policy = no one can read admin_actions via client
-- Admins can query via service_role or dedicated SECURITY DEFINER function if needed later

-- ============================================
-- VERIFICATION QUERIES (Run after migration)
-- ============================================

-- Test 1: Check RLS is enabled
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_roles';
-- Expected: rowsecurity = true

-- Test 2: Check policies on user_roles
-- SELECT policyname, cmd, qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_roles';
-- Expected: Only 1 policy "user_roles_select_own" with cmd = 'SELECT'

-- Test 3: Test SELECT as authenticated user (should work)
-- SET ROLE authenticated;
-- SET request.jwt.claims.sub TO '<your-user-id>';
-- SELECT * FROM public.user_roles WHERE user_id = '<your-user-id>';
-- Expected: Returns your role row (if exists)

-- Test 4: Test SELECT from server-side (via Supabase server client)
-- Should work now without recursive check error

-- ============================================
-- NOTES FOR FUTURE ADMIN OPERATIONS
-- ============================================

-- To manage roles (INSERT/UPDATE/DELETE), use one of these approaches:
-- 1. Use service_role key (bypasses RLS) - ONLY for trusted backend operations
-- 2. Create SECURITY DEFINER functions for role management (recommended)
-- 3. Use Supabase Dashboard with postgres role (bypasses RLS)

-- Example: Seed admin user (run as postgres or service_role)
-- INSERT INTO public.user_roles (user_id, role)
-- VALUES ('<user-id>', 'admin')
-- ON CONFLICT (user_id) DO UPDATE SET role = 'admin';

-- ============================================
-- END OF MIGRATION
-- ============================================
