-- migration-088-team-shared-visibility.sql
-- ============================================================
-- PURPOSE : Convert per-user data isolation to team-shared visibility
--           using a whitelist-based team_members table (Approach B-lite).
--
-- STRATEGY:
--   1. Create public.team_members (whitelist)
--   2. Create public.is_team_member() SECURITY DEFINER helper
--   3. Seed team_members from existing users in import_batches / expenses / sales_orders
--   4. Change SELECT RLS on all business tables:
--        BEFORE: USING (created_by = auth.uid())
--        AFTER : USING (public.is_team_member())
--   5. INSERT / UPDATE / DELETE RLS left unchanged (still per-creator)
--
-- EXCEPTIONS (not changed — intentionally per-user):
--   - notifications            : personal inbox
--   - user_preferences         : personal display settings
--   - app_settings             : per-user config (UNIQUE(created_by) constraint)
--   - bank_opening_balances    : personal per-account balance anchor (user_id column)
--   - bank_reported_balances   : personal record (user_id column)
--
-- DEDUP NOTE (phase-2 tech debt):
--   - import_batches file_hash UNIQUE is still per (file_hash + created_by)
--   - sales_orders UNIQUE still scoped to (created_by, order_line_hash)
--   - inventory_sku_mappings UNIQUE still scoped to (created_by, channel, marketplace_sku)
--   These must be migrated separately to enable true team-level dedup constraints.
--
-- CONCURRENT COGS NOTE (phase-2 tech debt):
--   - After this migration, getActiveCogsRun() checks team-wide running jobs.
--   - Two users triggering COGS simultaneously may still create duplicate allocations
--     since each writes created_by = their own uid. Distributed lock is future work.
--
-- Run:      psql $DATABASE_URL -f database-scripts/migration-088-team-shared-visibility.sql
-- Rollback: psql $DATABASE_URL -f database-scripts/rollback/rollback-088-team-shared-visibility.sql
-- Verify:   run verification queries at bottom of this file
-- ============================================================

-- ============================================================
-- PART 0: team_members table + is_team_member() helper
-- ============================================================

CREATE TABLE IF NOT EXISTS public.team_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by UUID        REFERENCES auth.users(id),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user may read membership list
--         (must not use is_team_member() here — would be circular)
DROP POLICY IF EXISTS "team_members_select_authenticated" ON public.team_members;
CREATE POLICY "team_members_select_authenticated"
  ON public.team_members
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- INSERT: existing team member may add others; a user may add themselves (self-register)
DROP POLICY IF EXISTS "team_members_insert" ON public.team_members;
CREATE POLICY "team_members_insert"
  ON public.team_members
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_team_member());

-- UPDATE: only existing team members may update membership rows (e.g. deactivate)
DROP POLICY IF EXISTS "team_members_update" ON public.team_members;
CREATE POLICY "team_members_update"
  ON public.team_members
  FOR UPDATE
  TO authenticated
  USING (public.is_team_member())
  WITH CHECK (public.is_team_member());

-- DELETE: no RLS DELETE policy — set is_active = FALSE via UPDATE instead
--         Hard deletes require service-role access

-- ─────────────────────────────────────────────────────────────
-- is_team_member() helper function
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_team_member()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members
    WHERE user_id = auth.uid()
      AND is_active = TRUE
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_team_member() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- Seed team_members from existing users
-- Priority: import_batches → expenses → sales_orders
-- ─────────────────────────────────────────────────────────────

INSERT INTO public.team_members (user_id)
SELECT DISTINCT created_by
FROM public.import_batches
WHERE created_by IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.team_members (user_id)
SELECT DISTINCT created_by
FROM public.expenses
WHERE created_by IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.team_members (user_id)
SELECT DISTINCT created_by
FROM public.sales_orders
WHERE created_by IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- PART A: Core tables fixed in migration-066 (schema.sql origin)
-- ============================================================

-- ────────────────────────────────
-- sales_orders
-- ────────────────────────────────
DROP POLICY IF EXISTS "sales_orders_select_policy" ON public.sales_orders;
CREATE POLICY "sales_orders_select_policy"
  ON public.sales_orders
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- expenses
-- ────────────────────────────────
DROP POLICY IF EXISTS "expenses_select_policy" ON public.expenses;
CREATE POLICY "expenses_select_policy"
  ON public.expenses
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- inventory (legacy table from schema.sql)
-- ────────────────────────────────
DROP POLICY IF EXISTS "inventory_select_policy" ON public.inventory;
CREATE POLICY "inventory_select_policy"
  ON public.inventory
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- payables
-- ────────────────────────────────
DROP POLICY IF EXISTS "payables_select_policy" ON public.payables;
CREATE POLICY "payables_select_policy"
  ON public.payables
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- tax_records
-- ────────────────────────────────
DROP POLICY IF EXISTS "tax_records_select_policy" ON public.tax_records;
CREATE POLICY "tax_records_select_policy"
  ON public.tax_records
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- ceo_transactions
-- ────────────────────────────────
DROP POLICY IF EXISTS "ceo_transactions_select_policy" ON public.ceo_transactions;
CREATE POLICY "ceo_transactions_select_policy"
  ON public.ceo_transactions
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ============================================================
-- PART B: expense_attachments — split ALL policy into SELECT + write
--         Old: "Users manage own expense attachments" (ALL policy, double-guard)
--         New SELECT: any team member can view attachments of team expenses
--         New INSERT/UPDATE/DELETE: creator guard preserved
-- ============================================================

DROP POLICY IF EXISTS "Users manage own expense attachments" ON public.expense_attachments;

CREATE POLICY "expense_attachments_select_team"
  ON public.expense_attachments
  FOR SELECT
  TO authenticated
  USING (
    public.is_team_member()
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_attachments.expense_id
    )
  );

CREATE POLICY "expense_attachments_insert_own"
  ON public.expense_attachments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_attachments.expense_id
        AND e.created_by = auth.uid()
    )
  );

CREATE POLICY "expense_attachments_update_own"
  ON public.expense_attachments
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "expense_attachments_delete_own"
  ON public.expense_attachments
  FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

-- ============================================================
-- PART C: inventory_stock_in_documents (fixed in migration-066)
-- ============================================================

DROP POLICY IF EXISTS "inventory_stock_in_documents_select_policy" ON public.inventory_stock_in_documents;
CREATE POLICY "inventory_stock_in_documents_select_policy"
  ON public.inventory_stock_in_documents
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ============================================================
-- PART D: inventory costing tables (fixed in migration-066)
-- ============================================================

-- ────────────────────────────────
-- inventory_items
-- ────────────────────────────────
DROP POLICY IF EXISTS "inventory_items_select_policy" ON public.inventory_items;
CREATE POLICY "inventory_items_select_policy"
  ON public.inventory_items
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- inventory_bundle_components
-- ────────────────────────────────
DROP POLICY IF EXISTS "inventory_bundle_components_select_policy" ON public.inventory_bundle_components;
CREATE POLICY "inventory_bundle_components_select_policy"
  ON public.inventory_bundle_components
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- inventory_receipt_layers
-- ────────────────────────────────
DROP POLICY IF EXISTS "inventory_receipt_layers_select_policy" ON public.inventory_receipt_layers;
CREATE POLICY "inventory_receipt_layers_select_policy"
  ON public.inventory_receipt_layers
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- inventory_cost_snapshots
-- ────────────────────────────────
DROP POLICY IF EXISTS "inventory_cost_snapshots_select_policy" ON public.inventory_cost_snapshots;
CREATE POLICY "inventory_cost_snapshots_select_policy"
  ON public.inventory_cost_snapshots
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- inventory_cogs_allocations
-- ────────────────────────────────
DROP POLICY IF EXISTS "inventory_cogs_allocations_select_policy" ON public.inventory_cogs_allocations;
CREATE POLICY "inventory_cogs_allocations_select_policy"
  ON public.inventory_cogs_allocations
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ============================================================
-- PART E: import_batches
-- ============================================================

DROP POLICY IF EXISTS "import_batches_select_policy" ON public.import_batches;
CREATE POLICY "import_batches_select_policy"
  ON public.import_batches
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ============================================================
-- PART F: ad_daily_performance
-- ============================================================

DROP POLICY IF EXISTS "ad_daily_perf_select_policy" ON public.ad_daily_performance;
CREATE POLICY "ad_daily_perf_select_policy"
  ON public.ad_daily_performance
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ============================================================
-- PART G: wallets + wallet_ledger + settlement tables
-- ============================================================

-- ────────────────────────────────
-- wallets
-- ────────────────────────────────
DROP POLICY IF EXISTS "wallets_select_policy" ON public.wallets;
CREATE POLICY "wallets_select_policy"
  ON public.wallets
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- wallet_ledger
-- ────────────────────────────────
DROP POLICY IF EXISTS "wallet_ledger_select_policy" ON public.wallet_ledger;
CREATE POLICY "wallet_ledger_select_policy"
  ON public.wallet_ledger
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- unsettled_transactions
-- ────────────────────────────────
DROP POLICY IF EXISTS "unsettled_txns_select_policy" ON public.unsettled_transactions;
CREATE POLICY "unsettled_txns_select_policy"
  ON public.unsettled_transactions
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- settlement_transactions
-- ────────────────────────────────
DROP POLICY IF EXISTS "settlement_txns_select_policy" ON public.settlement_transactions;
CREATE POLICY "settlement_txns_select_policy"
  ON public.settlement_transactions
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ============================================================
-- PART H: Shopee finance tables
-- ============================================================

-- ────────────────────────────────
-- shopee_wallet_transactions
-- ────────────────────────────────
DROP POLICY IF EXISTS "swt_select_own" ON public.shopee_wallet_transactions;
CREATE POLICY "swt_select_team"
  ON public.shopee_wallet_transactions
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- shopee_order_settlements
-- ────────────────────────────────
DROP POLICY IF EXISTS "sos_select_own" ON public.shopee_order_settlements;
CREATE POLICY "sos_select_team"
  ON public.shopee_order_settlements
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- marketplace_wallet_transactions (migration-062)
-- ────────────────────────────────
DROP POLICY IF EXISTS "Users can view own marketplace wallet transactions" ON public.marketplace_wallet_transactions;
CREATE POLICY "marketplace_wallet_transactions_select_team"
  ON public.marketplace_wallet_transactions
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ============================================================
-- PART I: Bank tables
-- ============================================================

-- ────────────────────────────────
-- bank_accounts
-- ────────────────────────────────
DROP POLICY IF EXISTS "Users can view own bank accounts" ON public.bank_accounts;
CREATE POLICY "bank_accounts_select_team"
  ON public.bank_accounts
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- bank_transactions
-- ────────────────────────────────
DROP POLICY IF EXISTS "Users can view own bank transactions" ON public.bank_transactions;
CREATE POLICY "bank_transactions_select_team"
  ON public.bank_transactions
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- bank_txn_classifications — split ALL policy into SELECT + writes
--   Old: "Users can manage own bank txn classifications" (ALL)
--   Note: UNIQUE(bank_transaction_id, created_by) — two users may have
--         separate classifications for the same transaction (phase-2 tech debt)
-- ────────────────────────────────
DROP POLICY IF EXISTS "Users can manage own bank txn classifications" ON public.bank_txn_classifications;

CREATE POLICY "bank_txn_cls_select_team"
  ON public.bank_txn_classifications
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

CREATE POLICY "bank_txn_cls_insert_own"
  ON public.bank_txn_classifications
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_team_member());

CREATE POLICY "bank_txn_cls_update_own"
  ON public.bank_txn_classifications
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid() AND public.is_team_member())
  WITH CHECK (created_by = auth.uid() AND public.is_team_member());

CREATE POLICY "bank_txn_cls_delete_own"
  ON public.bank_txn_classifications
  FOR DELETE
  TO authenticated
  USING (created_by = auth.uid() AND public.is_team_member());

-- ============================================================
-- PART J: inventory_returns + inventory_sku_mappings
-- ============================================================

-- ────────────────────────────────
-- inventory_returns
-- ────────────────────────────────
DROP POLICY IF EXISTS "inventory_returns_select_policy" ON public.inventory_returns;
CREATE POLICY "inventory_returns_select_policy"
  ON public.inventory_returns
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- inventory_sku_mappings
-- Note: UNIQUE(created_by, channel, marketplace_sku) — conflicting team mappings
--       are possible (phase-2 tech debt: change UNIQUE to drop created_by)
-- ────────────────────────────────
DROP POLICY IF EXISTS "sku_mappings_select" ON public.inventory_sku_mappings;
CREATE POLICY "sku_mappings_select"
  ON public.inventory_sku_mappings
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ============================================================
-- PART K: ceo_commission_receipts
-- ============================================================

DROP POLICY IF EXISTS "ceo_commission_select_own" ON public.ceo_commission_receipts;
CREATE POLICY "ceo_commission_select_team"
  ON public.ceo_commission_receipts
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ============================================================
-- PART L: cogs_allocation_runs — team-wide run visibility
--         notifications remain personal (not changed)
-- ============================================================

DROP POLICY IF EXISTS "cogs_allocation_runs_select_own" ON public.cogs_allocation_runs;
CREATE POLICY "cogs_allocation_runs_select_team"
  ON public.cogs_allocation_runs
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- notifications: intentionally NOT changed (personal inbox)
-- notifications_select_own stays: created_by = auth.uid()

-- ============================================================
-- PART M: inventory_adjustments + legacy COGS run logs
-- ============================================================

-- ────────────────────────────────
-- inventory_adjustments (migration-084)
-- ────────────────────────────────
DROP POLICY IF EXISTS "Users can view own adjustments" ON public.inventory_adjustments;
CREATE POLICY "inventory_adjustments_select_team"
  ON public.inventory_adjustments
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- inventory_cogs_apply_runs (migration-060 — legacy run log)
-- ────────────────────────────────
DROP POLICY IF EXISTS "Users can view their own runs" ON public.inventory_cogs_apply_runs;
CREATE POLICY "inventory_cogs_apply_runs_select_team"
  ON public.inventory_cogs_apply_runs
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

-- ────────────────────────────────
-- inventory_cogs_apply_run_items (migration-060)
-- ────────────────────────────────
DROP POLICY IF EXISTS "Users can view their run items" ON public.inventory_cogs_apply_run_items;
CREATE POLICY "inventory_cogs_apply_run_items_select_team"
  ON public.inventory_cogs_apply_run_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_cogs_apply_runs r
      WHERE r.id = inventory_cogs_apply_run_items.run_id
    )
  );

-- ============================================================
-- PART N: Verification queries
-- Run these after applying — all should return expected results
-- ============================================================

-- 1. Count team members seeded (should be ≥ 1)
SELECT COUNT(*) AS seeded_members FROM public.team_members;

-- 2. Confirm is_team_member() function exists
SELECT proname, prosecdef FROM pg_proc
WHERE proname = 'is_team_member' AND pronamespace = 'public'::regnamespace;

-- 3. List all SELECT policies now using is_team_member() (should be ≥ 28)
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'SELECT'
  AND qual ILIKE '%is_team_member%'
ORDER BY tablename;

-- 4. Confirm notifications SELECT policy is unchanged (should still say created_by = auth.uid())
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'notifications'
  AND cmd = 'SELECT';

-- 5. Confirm no business table SELECT policy is USING(true)
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'SELECT'
  AND qual = 'true'
ORDER BY tablename;

-- ============================================================
-- ROLLBACK SCRIPT PREVIEW
-- Full rollback: database-scripts/rollback/rollback-088-team-shared-visibility.sql
-- ============================================================
-- To revert this migration:
--   1. For each table: DROP the new SELECT policy, re-create with created_by = auth.uid()
--   2. DROP FUNCTION public.is_team_member()
--   3. DROP TABLE public.team_members CASCADE
--
-- Example for sales_orders:
--   DROP POLICY IF EXISTS "sales_orders_select_policy" ON public.sales_orders;
--   CREATE POLICY "sales_orders_select_policy" ON public.sales_orders
--     FOR SELECT TO authenticated USING (created_by = auth.uid());
-- ============================================================
