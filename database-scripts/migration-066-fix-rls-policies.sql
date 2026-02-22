-- migration-066-fix-rls-policies.sql
-- ============================================
-- Purpose : Replace dangerously permissive RLS policies (USING(true) / WITH CHECK(true)
--           / USING(auth.uid() IS NOT NULL)) with per-user isolation based on
--           created_by = auth.uid() across all affected tables.
--
-- Security audit finding: CRITICAL
-- All authenticated users could read and write every other user's data because
-- every table-level policy evaluated to unconditional true.
--
-- Approach:
--   - DROP POLICY IF EXISTS  (idempotent — safe to re-run)
--   - CREATE POLICY with     created_by = auth.uid()
--   - Tables that already have correct policies are left untouched (see bottom comment)
--   - Tables without a created_by column are left untouched (shared company-wide data)
--
-- Run:   psql $DATABASE_URL -f database-scripts/migration-066-fix-rls-policies.sql
-- Verify: psql $DATABASE_URL -f database-scripts/verify/verify-rls-policies.sql
-- ============================================

-- ============================================
-- PART A: Fix 6 Core Tables from schema.sql
--         All had USING(true) / WITH CHECK(true)
-- ============================================

-- --------------------------------------------
-- Table: sales_orders
-- Old policies: all USING(true) / WITH CHECK(true)
-- --------------------------------------------

DROP POLICY IF EXISTS "sales_orders_select_policy" ON public.sales_orders;
DROP POLICY IF EXISTS "sales_orders_insert_policy" ON public.sales_orders;
DROP POLICY IF EXISTS "sales_orders_update_policy" ON public.sales_orders;
DROP POLICY IF EXISTS "sales_orders_delete_policy" ON public.sales_orders;

CREATE POLICY "sales_orders_select_policy"
    ON public.sales_orders
    FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "sales_orders_insert_policy"
    ON public.sales_orders
    FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "sales_orders_update_policy"
    ON public.sales_orders
    FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "sales_orders_delete_policy"
    ON public.sales_orders
    FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- --------------------------------------------
-- Table: expenses
-- Old policies: all USING(true) / WITH CHECK(true)
-- --------------------------------------------

DROP POLICY IF EXISTS "expenses_select_policy" ON public.expenses;
DROP POLICY IF EXISTS "expenses_insert_policy" ON public.expenses;
DROP POLICY IF EXISTS "expenses_update_policy" ON public.expenses;
DROP POLICY IF EXISTS "expenses_delete_policy" ON public.expenses;

CREATE POLICY "expenses_select_policy"
    ON public.expenses
    FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "expenses_insert_policy"
    ON public.expenses
    FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "expenses_update_policy"
    ON public.expenses
    FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "expenses_delete_policy"
    ON public.expenses
    FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- --------------------------------------------
-- Table: inventory
-- Old policies: all USING(true) / WITH CHECK(true)
-- --------------------------------------------

DROP POLICY IF EXISTS "inventory_select_policy" ON public.inventory;
DROP POLICY IF EXISTS "inventory_insert_policy" ON public.inventory;
DROP POLICY IF EXISTS "inventory_update_policy" ON public.inventory;
DROP POLICY IF EXISTS "inventory_delete_policy" ON public.inventory;

CREATE POLICY "inventory_select_policy"
    ON public.inventory
    FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "inventory_insert_policy"
    ON public.inventory
    FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "inventory_update_policy"
    ON public.inventory
    FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "inventory_delete_policy"
    ON public.inventory
    FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- --------------------------------------------
-- Table: payables
-- Old policies: all USING(true) / WITH CHECK(true)
-- --------------------------------------------

DROP POLICY IF EXISTS "payables_select_policy" ON public.payables;
DROP POLICY IF EXISTS "payables_insert_policy" ON public.payables;
DROP POLICY IF EXISTS "payables_update_policy" ON public.payables;
DROP POLICY IF EXISTS "payables_delete_policy" ON public.payables;

CREATE POLICY "payables_select_policy"
    ON public.payables
    FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "payables_insert_policy"
    ON public.payables
    FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "payables_update_policy"
    ON public.payables
    FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "payables_delete_policy"
    ON public.payables
    FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- --------------------------------------------
-- Table: tax_records
-- Old policies: all USING(true) / WITH CHECK(true)
-- --------------------------------------------

DROP POLICY IF EXISTS "tax_records_select_policy" ON public.tax_records;
DROP POLICY IF EXISTS "tax_records_insert_policy" ON public.tax_records;
DROP POLICY IF EXISTS "tax_records_update_policy" ON public.tax_records;
DROP POLICY IF EXISTS "tax_records_delete_policy" ON public.tax_records;

CREATE POLICY "tax_records_select_policy"
    ON public.tax_records
    FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "tax_records_insert_policy"
    ON public.tax_records
    FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "tax_records_update_policy"
    ON public.tax_records
    FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "tax_records_delete_policy"
    ON public.tax_records
    FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- --------------------------------------------
-- Table: ceo_transactions
-- Old policies: all USING(true) / WITH CHECK(true)
-- --------------------------------------------

DROP POLICY IF EXISTS "ceo_transactions_select_policy" ON public.ceo_transactions;
DROP POLICY IF EXISTS "ceo_transactions_insert_policy" ON public.ceo_transactions;
DROP POLICY IF EXISTS "ceo_transactions_update_policy" ON public.ceo_transactions;
DROP POLICY IF EXISTS "ceo_transactions_delete_policy" ON public.ceo_transactions;

CREATE POLICY "ceo_transactions_select_policy"
    ON public.ceo_transactions
    FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "ceo_transactions_insert_policy"
    ON public.ceo_transactions
    FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "ceo_transactions_update_policy"
    ON public.ceo_transactions
    FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "ceo_transactions_delete_policy"
    ON public.ceo_transactions
    FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- ============================================
-- PART B: Fix inventory_stock_in_documents
--         SELECT used auth.uid() IS NOT NULL (any authenticated user could read all rows)
--         INSERT used auth.uid() IS NOT NULL (any authenticated user could insert)
--         UPDATE/DELETE were already correct (created_by = auth.uid())
-- ============================================

-- Drop all four policies for a clean, consistent set
DROP POLICY IF EXISTS "Users can view stock in documents"      ON public.inventory_stock_in_documents;
DROP POLICY IF EXISTS "Users can insert stock in documents"    ON public.inventory_stock_in_documents;
DROP POLICY IF EXISTS "Users can update own stock in documents" ON public.inventory_stock_in_documents;
DROP POLICY IF EXISTS "Users can delete own stock in documents" ON public.inventory_stock_in_documents;

CREATE POLICY "inventory_stock_in_documents_select_policy"
    ON public.inventory_stock_in_documents
    FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "inventory_stock_in_documents_insert_policy"
    ON public.inventory_stock_in_documents
    FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "inventory_stock_in_documents_update_policy"
    ON public.inventory_stock_in_documents
    FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "inventory_stock_in_documents_delete_policy"
    ON public.inventory_stock_in_documents
    FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- ============================================
-- PART C: Fix inventory costing tables from migration-033
--         All had USING(true) / WITH CHECK(true)
--         All have a created_by column.
-- ============================================

-- --------------------------------------------
-- Table: inventory_items
-- --------------------------------------------

DROP POLICY IF EXISTS "inventory_items_select_policy" ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_insert_policy" ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_update_policy" ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_delete_policy" ON public.inventory_items;

CREATE POLICY "inventory_items_select_policy"
    ON public.inventory_items
    FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "inventory_items_insert_policy"
    ON public.inventory_items
    FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "inventory_items_update_policy"
    ON public.inventory_items
    FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "inventory_items_delete_policy"
    ON public.inventory_items
    FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- --------------------------------------------
-- Table: inventory_bundle_components
-- has created_by; bundles are defined per user
-- --------------------------------------------

DROP POLICY IF EXISTS "inventory_bundle_components_select_policy" ON public.inventory_bundle_components;
DROP POLICY IF EXISTS "inventory_bundle_components_insert_policy" ON public.inventory_bundle_components;
DROP POLICY IF EXISTS "inventory_bundle_components_update_policy" ON public.inventory_bundle_components;
DROP POLICY IF EXISTS "inventory_bundle_components_delete_policy" ON public.inventory_bundle_components;

CREATE POLICY "inventory_bundle_components_select_policy"
    ON public.inventory_bundle_components
    FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "inventory_bundle_components_insert_policy"
    ON public.inventory_bundle_components
    FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "inventory_bundle_components_update_policy"
    ON public.inventory_bundle_components
    FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "inventory_bundle_components_delete_policy"
    ON public.inventory_bundle_components
    FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- --------------------------------------------
-- Table: inventory_receipt_layers
-- has created_by; FIFO layers are per user
-- --------------------------------------------

DROP POLICY IF EXISTS "inventory_receipt_layers_select_policy" ON public.inventory_receipt_layers;
DROP POLICY IF EXISTS "inventory_receipt_layers_insert_policy" ON public.inventory_receipt_layers;
DROP POLICY IF EXISTS "inventory_receipt_layers_update_policy" ON public.inventory_receipt_layers;
DROP POLICY IF EXISTS "inventory_receipt_layers_delete_policy" ON public.inventory_receipt_layers;

CREATE POLICY "inventory_receipt_layers_select_policy"
    ON public.inventory_receipt_layers
    FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "inventory_receipt_layers_insert_policy"
    ON public.inventory_receipt_layers
    FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "inventory_receipt_layers_update_policy"
    ON public.inventory_receipt_layers
    FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "inventory_receipt_layers_delete_policy"
    ON public.inventory_receipt_layers
    FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- --------------------------------------------
-- Table: inventory_cost_snapshots
-- has created_by; moving-average snapshots are per user
-- --------------------------------------------

DROP POLICY IF EXISTS "inventory_cost_snapshots_select_policy" ON public.inventory_cost_snapshots;
DROP POLICY IF EXISTS "inventory_cost_snapshots_insert_policy" ON public.inventory_cost_snapshots;
DROP POLICY IF EXISTS "inventory_cost_snapshots_update_policy" ON public.inventory_cost_snapshots;
DROP POLICY IF EXISTS "inventory_cost_snapshots_delete_policy" ON public.inventory_cost_snapshots;

CREATE POLICY "inventory_cost_snapshots_select_policy"
    ON public.inventory_cost_snapshots
    FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "inventory_cost_snapshots_insert_policy"
    ON public.inventory_cost_snapshots
    FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "inventory_cost_snapshots_update_policy"
    ON public.inventory_cost_snapshots
    FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "inventory_cost_snapshots_delete_policy"
    ON public.inventory_cost_snapshots
    FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- --------------------------------------------
-- Table: inventory_cogs_allocations
-- has created_by; COGS allocations are per user
-- --------------------------------------------

DROP POLICY IF EXISTS "inventory_cogs_allocations_select_policy" ON public.inventory_cogs_allocations;
DROP POLICY IF EXISTS "inventory_cogs_allocations_insert_policy" ON public.inventory_cogs_allocations;
DROP POLICY IF EXISTS "inventory_cogs_allocations_update_policy" ON public.inventory_cogs_allocations;
DROP POLICY IF EXISTS "inventory_cogs_allocations_delete_policy" ON public.inventory_cogs_allocations;

CREATE POLICY "inventory_cogs_allocations_select_policy"
    ON public.inventory_cogs_allocations
    FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "inventory_cogs_allocations_insert_policy"
    ON public.inventory_cogs_allocations
    FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "inventory_cogs_allocations_update_policy"
    ON public.inventory_cogs_allocations
    FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "inventory_cogs_allocations_delete_policy"
    ON public.inventory_cogs_allocations
    FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- ============================================
-- Tables intentionally left unchanged
-- ============================================
--
-- order_financials (migration-044):
--   Already uses created_by = auth.uid() for all 4 operations.
--   Also has an admin override policy using user_roles. No change needed.
--
-- user_roles (migration-031 / migration-032):
--   Already has only "user_roles_select_own" (user_id = auth.uid()).
--   INSERT/UPDATE/DELETE locked down; managed via service_role / SECURITY DEFINER.
--   No change needed.
--
-- import_batches, ad_daily_performance, wallets, bank_*, cashflow_*, etc.:
--   These tables do not appear in scope of this audit or already have correct policies.
--   They should be audited separately.
--
-- Shared lookup / derived tables with NO created_by column:
--   These tables hold company-wide reference data and do not carry a per-user owner.
--   Forcing created_by = auth.uid() on them would be incorrect and break functionality.
--   They retain their existing policies.

-- ============================================
-- Post-run verification
-- Lists any remaining USING(true) policies — should return ZERO rows after this migration.
-- ============================================

SELECT
    tablename,
    policyname,
    cmd,
    qual
FROM pg_policies
WHERE schemaname = 'public'
  AND qual = 'true'
ORDER BY tablename, cmd;
