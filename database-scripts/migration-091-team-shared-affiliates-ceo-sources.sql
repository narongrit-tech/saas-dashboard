-- migration-091-team-shared-affiliates-ceo-sources.sql
-- ============================================================
-- PURPOSE : Open team-shared SELECT access for two tables that were
--           missed in migration-088.
--
-- Tables:
--   1. internal_affiliates      — affiliate/influencer master list
--   2. ceo_commission_sources   — commission source definitions
--
-- Both tables currently have SELECT policy: created_by = auth.uid()
-- which means team members cannot read each other's records.
--
-- Fix:
--   DROP old per-user SELECT policy.
--   CREATE new SELECT policy: USING (public.is_team_member())
--   INSERT / UPDATE / DELETE policies are NOT touched.
--
-- RLS impact:
--   After this migration, any authenticated user who is an active
--   team member (is_active = TRUE in team_members, migration-088)
--   can read all rows in both tables regardless of created_by.
--   Write policies remain per-creator, so only the row owner can
--   modify or delete their own records.
--   Users who are NOT in team_members (is_active = FALSE or absent)
--   receive empty result sets on SELECT — no data leakage.
--
-- Seed check:
--   migration-088 already seeded team_members from import_batches,
--   expenses, and sales_orders. The SELECT below verifies that
--   users who have data in these tables are already members.
--   No INSERT is performed here.
--
-- Run:    psql $DATABASE_URL -f database-scripts/migration-091-team-shared-affiliates-ceo-sources.sql
-- Verify: run verification queries at the bottom of this file
-- ============================================================


-- ============================================================
-- PART 1: internal_affiliates
-- ============================================================

-- Drop the old per-user SELECT policy (exact name may vary; cover common names)
DROP POLICY IF EXISTS "internal_affiliates_select_own"    ON public.internal_affiliates;
DROP POLICY IF EXISTS "internal_affiliates_select_policy" ON public.internal_affiliates;
DROP POLICY IF EXISTS "Users can view own affiliates"     ON public.internal_affiliates;

-- New team-shared SELECT policy
CREATE POLICY "internal_affiliates_select_team"
  ON public.internal_affiliates
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());


-- ============================================================
-- PART 2: ceo_commission_sources
-- ============================================================

-- Drop the old per-user SELECT policy
DROP POLICY IF EXISTS "ceo_commission_sources_select_own"    ON public.ceo_commission_sources;
DROP POLICY IF EXISTS "ceo_commission_sources_select_policy" ON public.ceo_commission_sources;
DROP POLICY IF EXISTS "Users can view own commission sources" ON public.ceo_commission_sources;

-- New team-shared SELECT policy
CREATE POLICY "ceo_commission_sources_select_team"
  ON public.ceo_commission_sources
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());


-- ============================================================
-- PART 3: Seed check (read-only — no INSERTs)
-- Confirms that users who have rows in these tables are already
-- in team_members (seeded by migration-088).
-- If this query returns rows, those users are NOT yet team members
-- and should be added manually via:
--   INSERT INTO public.team_members (user_id) VALUES ('<uuid>') ON CONFLICT DO NOTHING;
-- ============================================================

-- Users with internal_affiliates rows who are NOT yet team members
SELECT
    'internal_affiliates' AS source_table,
    a.created_by,
    COUNT(*)              AS row_count
FROM public.internal_affiliates a
WHERE NOT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.user_id = a.created_by
      AND tm.is_active = TRUE
)
GROUP BY a.created_by

UNION ALL

-- Users with ceo_commission_sources rows who are NOT yet team members
SELECT
    'ceo_commission_sources' AS source_table,
    s.created_by,
    COUNT(*)                 AS row_count
FROM public.ceo_commission_sources s
WHERE NOT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.user_id = s.created_by
      AND tm.is_active = TRUE
)
GROUP BY s.created_by;
-- Expected: 0 rows (all existing users already seeded by migration-088).
-- If rows appear, add those user_ids to team_members before relying on
-- this migration for access.


-- ============================================================
-- Verification
-- ============================================================

-- 1. Confirm new SELECT policies exist and reference is_team_member()
SELECT
    tablename,
    policyname,
    cmd,
    qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('internal_affiliates', 'ceo_commission_sources')
  AND cmd = 'SELECT'
ORDER BY tablename;
-- Expected:
--   internal_affiliates    | internal_affiliates_select_team    | SELECT | (public.is_team_member())
--   ceo_commission_sources | ceo_commission_sources_select_team | SELECT | (public.is_team_member())

-- 2. Confirm old per-user SELECT policies are gone
SELECT
    tablename,
    policyname,
    cmd,
    qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('internal_affiliates', 'ceo_commission_sources')
  AND cmd = 'SELECT'
  AND qual ILIKE '%auth.uid()%';
-- Expected: 0 rows (old created_by = auth.uid() SELECT policies dropped)

-- 3. Confirm INSERT/UPDATE/DELETE policies are untouched
SELECT
    tablename,
    policyname,
    cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('internal_affiliates', 'ceo_commission_sources')
  AND cmd != 'SELECT'
ORDER BY tablename, cmd;
-- Expected: existing write policies still listed here (no changes to them)
