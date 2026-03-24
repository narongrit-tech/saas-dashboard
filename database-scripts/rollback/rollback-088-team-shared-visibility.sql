-- rollback-088-team-shared-visibility.sql
-- ============================================================
-- PURPOSE : Rollback migration-088 — revert team-shared SELECT policies
--           back to per-user isolation (created_by = auth.uid())
--
-- IMPORTANT: This rollback does NOT remove data from team_members.
--            After rollback, data that was created by other team members
--            while team-sharing was active will still exist in the DB,
--            but will no longer be visible to other users.
--
-- Run: psql $DATABASE_URL -f database-scripts/rollback/rollback-088-team-shared-visibility.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Step 1: Drop is_team_member() function
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.is_team_member();

-- ─────────────────────────────────────────────────────────────
-- Step 2: Restore SELECT policies (created_by = auth.uid())
-- ─────────────────────────────────────────────────────────────

-- sales_orders
DROP POLICY IF EXISTS "sales_orders_select_policy" ON public.sales_orders;
CREATE POLICY "sales_orders_select_policy" ON public.sales_orders
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- expenses
DROP POLICY IF EXISTS "expenses_select_policy" ON public.expenses;
CREATE POLICY "expenses_select_policy" ON public.expenses
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- inventory (legacy)
DROP POLICY IF EXISTS "inventory_select_policy" ON public.inventory;
CREATE POLICY "inventory_select_policy" ON public.inventory
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- payables
DROP POLICY IF EXISTS "payables_select_policy" ON public.payables;
CREATE POLICY "payables_select_policy" ON public.payables
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- tax_records
DROP POLICY IF EXISTS "tax_records_select_policy" ON public.tax_records;
CREATE POLICY "tax_records_select_policy" ON public.tax_records
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- ceo_transactions
DROP POLICY IF EXISTS "ceo_transactions_select_policy" ON public.ceo_transactions;
CREATE POLICY "ceo_transactions_select_policy" ON public.ceo_transactions
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- expense_attachments (restore combined ALL policy)
DROP POLICY IF EXISTS "expense_attachments_select_team"   ON public.expense_attachments;
DROP POLICY IF EXISTS "expense_attachments_insert_own"    ON public.expense_attachments;
DROP POLICY IF EXISTS "expense_attachments_update_own"    ON public.expense_attachments;
DROP POLICY IF EXISTS "expense_attachments_delete_own"    ON public.expense_attachments;
CREATE POLICY "Users manage own expense attachments"
  ON public.expense_attachments
  FOR ALL
  TO authenticated
  USING (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = expense_attachments.expense_id AND e.created_by = auth.uid())
  )
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = expense_attachments.expense_id AND e.created_by = auth.uid())
  );

-- inventory_stock_in_documents
DROP POLICY IF EXISTS "inventory_stock_in_documents_select_policy" ON public.inventory_stock_in_documents;
CREATE POLICY "inventory_stock_in_documents_select_policy" ON public.inventory_stock_in_documents
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- inventory_items
DROP POLICY IF EXISTS "inventory_items_select_policy" ON public.inventory_items;
CREATE POLICY "inventory_items_select_policy" ON public.inventory_items
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- inventory_bundle_components
DROP POLICY IF EXISTS "inventory_bundle_components_select_policy" ON public.inventory_bundle_components;
CREATE POLICY "inventory_bundle_components_select_policy" ON public.inventory_bundle_components
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- inventory_receipt_layers
DROP POLICY IF EXISTS "inventory_receipt_layers_select_policy" ON public.inventory_receipt_layers;
CREATE POLICY "inventory_receipt_layers_select_policy" ON public.inventory_receipt_layers
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- inventory_cost_snapshots
DROP POLICY IF EXISTS "inventory_cost_snapshots_select_policy" ON public.inventory_cost_snapshots;
CREATE POLICY "inventory_cost_snapshots_select_policy" ON public.inventory_cost_snapshots
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- inventory_cogs_allocations
DROP POLICY IF EXISTS "inventory_cogs_allocations_select_policy" ON public.inventory_cogs_allocations;
CREATE POLICY "inventory_cogs_allocations_select_policy" ON public.inventory_cogs_allocations
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- import_batches
DROP POLICY IF EXISTS "import_batches_select_policy" ON public.import_batches;
CREATE POLICY "import_batches_select_policy" ON public.import_batches
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- ad_daily_performance
DROP POLICY IF EXISTS "ad_daily_perf_select_policy" ON public.ad_daily_performance;
CREATE POLICY "ad_daily_perf_select_policy" ON public.ad_daily_performance
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- wallets
DROP POLICY IF EXISTS "wallets_select_policy" ON public.wallets;
CREATE POLICY "wallets_select_policy" ON public.wallets
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- wallet_ledger
DROP POLICY IF EXISTS "wallet_ledger_select_policy" ON public.wallet_ledger;
CREATE POLICY "wallet_ledger_select_policy" ON public.wallet_ledger
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- unsettled_transactions
DROP POLICY IF EXISTS "unsettled_txns_select_policy" ON public.unsettled_transactions;
CREATE POLICY "unsettled_txns_select_policy" ON public.unsettled_transactions
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- settlement_transactions
DROP POLICY IF EXISTS "settlement_txns_select_policy" ON public.settlement_transactions;
CREATE POLICY "settlement_txns_select_policy" ON public.settlement_transactions
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- shopee_wallet_transactions
DROP POLICY IF EXISTS "swt_select_team" ON public.shopee_wallet_transactions;
CREATE POLICY "swt_select_own" ON public.shopee_wallet_transactions
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- shopee_order_settlements
DROP POLICY IF EXISTS "sos_select_team" ON public.shopee_order_settlements;
CREATE POLICY "sos_select_own" ON public.shopee_order_settlements
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- marketplace_wallet_transactions
DROP POLICY IF EXISTS "marketplace_wallet_transactions_select_team" ON public.marketplace_wallet_transactions;
CREATE POLICY "Users can view own marketplace wallet transactions" ON public.marketplace_wallet_transactions
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- bank_accounts
DROP POLICY IF EXISTS "bank_accounts_select_team" ON public.bank_accounts;
CREATE POLICY "Users can view own bank accounts" ON public.bank_accounts
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- bank_transactions
DROP POLICY IF EXISTS "bank_transactions_select_team" ON public.bank_transactions;
CREATE POLICY "Users can view own bank transactions" ON public.bank_transactions
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- bank_txn_classifications (restore combined ALL policy)
DROP POLICY IF EXISTS "bank_txn_cls_select_team"  ON public.bank_txn_classifications;
DROP POLICY IF EXISTS "bank_txn_cls_insert_own"   ON public.bank_txn_classifications;
DROP POLICY IF EXISTS "bank_txn_cls_update_own"   ON public.bank_txn_classifications;
DROP POLICY IF EXISTS "bank_txn_cls_delete_own"   ON public.bank_txn_classifications;
CREATE POLICY "Users can manage own bank txn classifications"
  ON public.bank_txn_classifications
  FOR ALL
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- inventory_returns
DROP POLICY IF EXISTS "inventory_returns_select_policy" ON public.inventory_returns;
CREATE POLICY "inventory_returns_select_policy" ON public.inventory_returns
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- inventory_sku_mappings
DROP POLICY IF EXISTS "sku_mappings_select" ON public.inventory_sku_mappings;
CREATE POLICY "sku_mappings_select" ON public.inventory_sku_mappings
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- ceo_commission_receipts
DROP POLICY IF EXISTS "ceo_commission_select_team" ON public.ceo_commission_receipts;
CREATE POLICY "ceo_commission_select_own" ON public.ceo_commission_receipts
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- cogs_allocation_runs
DROP POLICY IF EXISTS "cogs_allocation_runs_select_team" ON public.cogs_allocation_runs;
CREATE POLICY "cogs_allocation_runs_select_own" ON public.cogs_allocation_runs
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- inventory_adjustments
DROP POLICY IF EXISTS "inventory_adjustments_select_team" ON public.inventory_adjustments;
CREATE POLICY "Users can view own adjustments" ON public.inventory_adjustments
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- inventory_cogs_apply_runs
DROP POLICY IF EXISTS "inventory_cogs_apply_runs_select_team" ON public.inventory_cogs_apply_runs;
CREATE POLICY "Users can view their own runs" ON public.inventory_cogs_apply_runs
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- inventory_cogs_apply_run_items
DROP POLICY IF EXISTS "inventory_cogs_apply_run_items_select_team" ON public.inventory_cogs_apply_run_items;
CREATE POLICY "Users can view their run items" ON public.inventory_cogs_apply_run_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.inventory_cogs_apply_runs r
    WHERE r.id = inventory_cogs_apply_run_items.run_id
      AND r.created_by = auth.uid()
  ));

-- ─────────────────────────────────────────────────────────────
-- Step 3: Drop team_members table (optional — data preserved)
-- Uncomment if you want to fully remove the table:
-- DROP TABLE IF EXISTS public.team_members CASCADE;
-- ─────────────────────────────────────────────────────────────

-- Verification
SELECT COUNT(*) AS remaining_team_policies
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'SELECT'
  AND qual ILIKE '%is_team_member%';
-- Should return 0 after rollback
