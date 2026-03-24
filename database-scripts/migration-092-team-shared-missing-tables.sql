-- migration-092-team-shared-missing-tables.sql
-- PURPOSE: Add is_team_member() SELECT RLS to tables missed in migration-088
-- Depends on: migration-088 (is_team_member function must exist)
-- Safe to apply after migration-088 is applied
--
-- RLS impact summary:
--   All SELECT policies changed from USING (created_by = auth.uid())
--   to USING (public.is_team_member()).
--   After this migration, any authenticated user whose uid appears in
--   team_members (is_active = TRUE) can read ALL rows in each table
--   regardless of which team member created the row.
--   INSERT / UPDATE / DELETE policies are NOT touched — write operations
--   remain scoped to the row creator.
--   Users who are not in team_members receive an empty result set on
--   SELECT; no error is raised and no data is exposed.
--
-- Table name note for cashflow_node_classifications:
--   The migration file is named migration-081-cashflow-sankey-classifications.sql
--   but the actual table created is public.cashflow_node_classifications.
--   This migration targets the real table name.
--
-- Table name note for import_mappings and affiliate_channels:
--   The task specification refers to these tables as affiliate_preset_mappings
--   and affiliate_commission_mapping. Neither name exists in any migration.
--   The closest matching tables are:
--     import_mappings       (migration-037): user affiliate column mapping presets
--     affiliate_channels    (migration-036): affiliate commission channel config
--   Those real table names are used below.
--
-- internal_affiliates and ceo_commission_sources:
--   SKIP — already covered by migration-091.
--   See migration-091-team-shared-affiliates-ceo-sources.sql.
-- ============================================================


-- ============================================================
-- 1. order_attribution
--    Origin: migration-036
--    Old SELECT policy: "Users can view own order attribution"
-- ============================================================

DROP POLICY IF EXISTS "Users can view own order attribution" ON public.order_attribution;

CREATE POLICY "order_attribution_select_team"
  ON public.order_attribution
  FOR SELECT
  USING (public.is_team_member());


-- ============================================================
-- 2. order_financials
--    Origin: migration-044
--    Old SELECT policies:
--      order_financials_select        (specific SELECT policy)
--      order_financials_admin_all     (ALL policy — also covers SELECT; dropped here
--                                      so it no longer shadow-overrides the new policy)
--    Note: order_financials_admin_all used a user_roles admin check. Dropping it
--    is safe because team-shared access supersedes per-admin overrides; admin
--    writes are still guarded by the existing order_financials_insert /
--    order_financials_update / order_financials_delete per-creator policies.
-- ============================================================

DROP POLICY IF EXISTS "order_financials_select"    ON public.order_financials;
DROP POLICY IF EXISTS "order_financials_admin_all" ON public.order_financials;

CREATE POLICY "order_financials_select_team"
  ON public.order_financials
  FOR SELECT
  USING (public.is_team_member());


-- ============================================================
-- 3. cashflow_node_classifications
--    Origin: migration-081
--    Old policy: "cnc_all_own" (FOR ALL — covers SELECT + writes)
--    Strategy: drop the ALL policy, recreate SELECT as team-shared,
--    then restore per-creator INSERT / UPDATE / DELETE so write
--    isolation is preserved.
-- ============================================================

DROP POLICY IF EXISTS "cnc_all_own" ON public.cashflow_node_classifications;

CREATE POLICY "cnc_select_team"
  ON public.cashflow_node_classifications
  FOR SELECT
  USING (public.is_team_member());

CREATE POLICY "cnc_insert_own"
  ON public.cashflow_node_classifications
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_team_member());

CREATE POLICY "cnc_update_own"
  ON public.cashflow_node_classifications
  FOR UPDATE
  TO authenticated
  USING  (created_by = auth.uid() AND public.is_team_member())
  WITH CHECK (created_by = auth.uid() AND public.is_team_member());

CREATE POLICY "cnc_delete_own"
  ON public.cashflow_node_classifications
  FOR DELETE
  TO authenticated
  USING (created_by = auth.uid() AND public.is_team_member());


-- ============================================================
-- 4. import_mappings  (task spec: "affiliate_preset_mappings")
--    Origin: migration-037
--    Old SELECT policy: "Users can view own import mappings"
--    Note: mapping_type values include 'tiktok_affiliate_th',
--    'shopee_affiliate', 'generic'. These are per-user column
--    mapping presets; making them team-shared lets any team
--    member reuse another member's saved mapping configuration.
-- ============================================================

DROP POLICY IF EXISTS "Users can view own import mappings" ON public.import_mappings;

CREATE POLICY "import_mappings_select_team"
  ON public.import_mappings
  FOR SELECT
  USING (public.is_team_member());


-- ============================================================
-- 5. affiliate_channels  (task spec: "affiliate_commission_mapping")
--    Origin: migration-036
--    Old SELECT policy: "Users can view own affiliate channels"
--    Note: affiliate_channels stores commission_pct per channel.
--    Team-shared SELECT lets all team members read the same
--    channel configuration when attributing orders.
-- ============================================================

DROP POLICY IF EXISTS "Users can view own affiliate channels" ON public.affiliate_channels;

CREATE POLICY "affiliate_channels_select_team"
  ON public.affiliate_channels
  FOR SELECT
  USING (public.is_team_member());


-- ============================================================
-- internal_affiliates  — SKIP (migration-091 already applied)
-- ceo_commission_sources — SKIP (migration-091 already applied)
-- ============================================================


-- ============================================================
-- Verification
-- Expected: all 5 target tables appear in results
-- ============================================================

SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'SELECT'
  AND qual ILIKE '%is_team_member%'
ORDER BY tablename;
