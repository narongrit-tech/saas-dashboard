-- Migration 077: Settings Module
-- Tables: app_settings, user_preferences, roles, permissions, role_permissions,
--         user_role_assignments, settings_audit_logs
-- Includes seed data for permissions and a helper function for default roles.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. app_settings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_name       TEXT NOT NULL DEFAULT 'My Workspace',
  timezone             TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  currency             TEXT NOT NULL DEFAULT 'THB',
  fiscal_year_start    INTEGER NOT NULL DEFAULT 1 CHECK (fiscal_year_start BETWEEN 1 AND 12),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (created_by)
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_select" ON app_settings;
DROP POLICY IF EXISTS "app_settings_insert" ON app_settings;
DROP POLICY IF EXISTS "app_settings_update" ON app_settings;
DROP POLICY IF EXISTS "app_settings_delete" ON app_settings;

CREATE POLICY "app_settings_select" ON app_settings FOR SELECT USING (created_by = auth.uid());
CREATE POLICY "app_settings_insert" ON app_settings FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "app_settings_update" ON app_settings FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "app_settings_delete" ON app_settings FOR DELETE USING (created_by = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. user_preferences
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_preferences (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  theme                       TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'system')),
  language                    TEXT NOT NULL DEFAULT 'th',
  notification_cogs_runs      BOOLEAN NOT NULL DEFAULT true,
  notification_import_complete BOOLEAN NOT NULL DEFAULT true,
  notification_low_balance    BOOLEAN NOT NULL DEFAULT false,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_preferences_select" ON user_preferences;
DROP POLICY IF EXISTS "user_preferences_insert" ON user_preferences;
DROP POLICY IF EXISTS "user_preferences_update" ON user_preferences;
DROP POLICY IF EXISTS "user_preferences_delete" ON user_preferences;

CREATE POLICY "user_preferences_select" ON user_preferences FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "user_preferences_insert" ON user_preferences FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "user_preferences_update" ON user_preferences FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "user_preferences_delete" ON user_preferences FOR DELETE USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. roles
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description  TEXT,
  is_system    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (created_by, name)
);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_select" ON roles;
DROP POLICY IF EXISTS "roles_insert" ON roles;
DROP POLICY IF EXISTS "roles_update" ON roles;
DROP POLICY IF EXISTS "roles_delete" ON roles;

CREATE POLICY "roles_select" ON roles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "roles_insert" ON roles FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "roles_update" ON roles FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "roles_delete" ON roles FOR DELETE USING (created_by = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. permissions (global seed data - no tenant isolation needed)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module       TEXT NOT NULL,
  action       TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (module, action)
);

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "permissions_select" ON permissions;

CREATE POLICY "permissions_select" ON permissions FOR SELECT USING (auth.uid() IS NOT NULL);

-- Seed permissions
INSERT INTO permissions (module, action, display_name) VALUES
  -- dashboard
  ('dashboard',            'view',    'ดู Dashboard'),
  -- sales_orders
  ('sales_orders',         'view',    'ดู Sales Orders'),
  ('sales_orders',         'create',  'สร้าง Sales Orders'),
  ('sales_orders',         'edit',    'แก้ไข Sales Orders'),
  ('sales_orders',         'delete',  'ลบ Sales Orders'),
  ('sales_orders',         'export',  'Export Sales Orders'),
  -- expenses
  ('expenses',             'view',    'ดู Expenses'),
  ('expenses',             'create',  'สร้าง Expenses'),
  ('expenses',             'edit',    'แก้ไข Expenses'),
  ('expenses',             'delete',  'ลบ Expenses'),
  ('expenses',             'export',  'Export Expenses'),
  -- inventory
  ('inventory',            'view',    'ดู Inventory'),
  ('inventory',            'create',  'สร้าง Inventory'),
  ('inventory',            'edit',    'แก้ไข Inventory'),
  ('inventory',            'delete',  'ลบ Inventory'),
  ('inventory',            'manage',  'จัดการ Inventory'),
  -- daily_pnl
  ('daily_pnl',            'view',    'ดู Daily P&L'),
  ('daily_pnl',            'export',  'Export Daily P&L'),
  -- marketplace_cashflow
  ('marketplace_cashflow', 'view',    'ดู Marketplace Cashflow'),
  -- wallets
  ('wallets',              'view',    'ดู Wallets'),
  ('wallets',              'manage',  'จัดการ Wallets'),
  -- bank
  ('bank',                 'view',    'ดู Bank'),
  ('bank',                 'import',  'Import Bank'),
  ('bank',                 'manage',  'จัดการ Bank'),
  -- reconciliation
  ('reconciliation',       'view',    'ดู Reconciliation'),
  -- payables
  ('payables',             'view',    'ดู Payables'),
  ('payables',             'create',  'สร้าง Payables'),
  ('payables',             'edit',    'แก้ไข Payables'),
  ('payables',             'delete',  'ลบ Payables'),
  -- tax_records
  ('tax_records',          'view',    'ดู Tax Records'),
  ('tax_records',          'manage',  'จัดการ Tax Records'),
  -- ceo_transactions
  ('ceo_transactions',     'view',    'ดู CEO Transactions'),
  ('ceo_transactions',     'manage',  'จัดการ CEO Transactions'),
  -- imports
  ('imports',              'view',    'ดู Imports'),
  ('imports',              'create',  'สร้าง Imports'),
  ('imports',              'delete',  'ลบ Imports'),
  -- settings
  ('settings',             'view',    'ดู Settings'),
  ('settings',             'manage',  'จัดการ Settings'),
  -- users
  ('users',                'view',    'ดู Users'),
  ('users',                'manage',  'จัดการ Users'),
  -- roles
  ('roles',                'view',    'ดู Roles'),
  ('roles',                'manage',  'จัดการ Roles'),
  -- permissions
  ('permissions',          'view',    'ดู Permissions'),
  ('permissions',          'manage',  'จัดการ Permissions'),
  -- audit_logs
  ('audit_logs',           'view',    'ดู Audit Logs'),
  -- notifications
  ('notifications',        'view',    'ดู Notifications'),
  ('notifications',        'manage',  'จัดการ Notifications'),
  -- master_data
  ('master_data',          'view',    'ดู Master Data'),
  ('master_data',          'manage',  'จัดการ Master Data')
ON CONFLICT (module, action) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. role_permissions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_id)
);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_select" ON role_permissions;
DROP POLICY IF EXISTS "role_permissions_insert" ON role_permissions;
DROP POLICY IF EXISTS "role_permissions_update" ON role_permissions;
DROP POLICY IF EXISTS "role_permissions_delete" ON role_permissions;

CREATE POLICY "role_permissions_select" ON role_permissions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "role_permissions_insert" ON role_permissions FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "role_permissions_update" ON role_permissions FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "role_permissions_delete" ON role_permissions FOR DELETE USING (created_by = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. user_role_assignments
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_role_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_id)
);

ALTER TABLE user_role_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_role_assignments_select" ON user_role_assignments;
DROP POLICY IF EXISTS "user_role_assignments_insert" ON user_role_assignments;
DROP POLICY IF EXISTS "user_role_assignments_update" ON user_role_assignments;
DROP POLICY IF EXISTS "user_role_assignments_delete" ON user_role_assignments;

CREATE POLICY "user_role_assignments_select" ON user_role_assignments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "user_role_assignments_insert" ON user_role_assignments FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "user_role_assignments_update" ON user_role_assignments FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "user_role_assignments_delete" ON user_role_assignments FOR DELETE USING (created_by = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. settings_audit_logs (immutable — no UPDATE/DELETE policies)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings_audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  table_name     TEXT NOT NULL,
  record_id      TEXT,
  action         TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_values     JSONB,
  new_values     JSONB,
  changed_fields TEXT[],
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE settings_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_audit_logs_select" ON settings_audit_logs;
DROP POLICY IF EXISTS "settings_audit_logs_insert" ON settings_audit_logs;

CREATE POLICY "settings_audit_logs_select" ON settings_audit_logs FOR SELECT USING (created_by = auth.uid());
CREATE POLICY "settings_audit_logs_insert" ON settings_audit_logs FOR INSERT WITH CHECK (created_by = auth.uid());
-- No UPDATE or DELETE policies — audit logs are immutable

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Helper: seed_default_roles_for_user
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION seed_default_roles_for_user(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner_id    UUID;
  v_admin_id    UUID;
  v_operator_id UUID;
  v_viewer_id   UUID;
BEGIN
  -- ── Create 4 system roles (idempotent via ON CONFLICT) ──────────────────────
  INSERT INTO roles (created_by, name, display_name, description, is_system)
  VALUES (p_user_id, 'owner', 'Owner', 'เจ้าของระบบ มีสิทธิ์เต็มรูปแบบ', true)
  ON CONFLICT (created_by, name) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_owner_id;

  IF v_owner_id IS NULL THEN
    SELECT id INTO v_owner_id FROM roles WHERE created_by = p_user_id AND name = 'owner';
  END IF;

  INSERT INTO roles (created_by, name, display_name, description, is_system)
  VALUES (p_user_id, 'admin', 'Admin', 'ผู้ดูแลระบบ มีสิทธิ์เกือบทั้งหมด', true)
  ON CONFLICT (created_by, name) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_admin_id;

  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM roles WHERE created_by = p_user_id AND name = 'admin';
  END IF;

  INSERT INTO roles (created_by, name, display_name, description, is_system)
  VALUES (p_user_id, 'operator', 'Operator', 'ผู้ดำเนินงาน สามารถสร้างและแก้ไขข้อมูลหลัก', true)
  ON CONFLICT (created_by, name) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_operator_id;

  IF v_operator_id IS NULL THEN
    SELECT id INTO v_operator_id FROM roles WHERE created_by = p_user_id AND name = 'operator';
  END IF;

  INSERT INTO roles (created_by, name, display_name, description, is_system)
  VALUES (p_user_id, 'viewer', 'Viewer', 'ดูข้อมูลได้อย่างเดียว ไม่สามารถแก้ไขได้', true)
  ON CONFLICT (created_by, name) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_viewer_id;

  IF v_viewer_id IS NULL THEN
    SELECT id INTO v_viewer_id FROM roles WHERE created_by = p_user_id AND name = 'viewer';
  END IF;

  -- ── Owner & Admin: all permissions ──────────────────────────────────────────
  INSERT INTO role_permissions (role_id, permission_id, created_by)
  SELECT v_owner_id, p.id, p_user_id FROM permissions p
  ON CONFLICT (role_id, permission_id) DO NOTHING;

  INSERT INTO role_permissions (role_id, permission_id, created_by)
  SELECT v_admin_id, p.id, p_user_id FROM permissions p
  ON CONFLICT (role_id, permission_id) DO NOTHING;

  -- ── Operator permissions ─────────────────────────────────────────────────────
  INSERT INTO role_permissions (role_id, permission_id, created_by)
  SELECT v_operator_id, p.id, p_user_id
  FROM permissions p
  WHERE (p.module = 'sales_orders'         AND p.action IN ('view','create','edit'))
     OR (p.module = 'expenses'             AND p.action IN ('view','create','edit'))
     OR (p.module = 'inventory'            AND p.action IN ('view','create','edit'))
     OR (p.module = 'wallets'              AND p.action IN ('view','manage'))
     OR (p.module = 'bank'                 AND p.action IN ('view','import'))
     OR (p.module = 'imports'              AND p.action IN ('view','create'))
     OR (p.module = 'marketplace_cashflow' AND p.action = 'view')
     OR (p.module = 'payables'             AND p.action IN ('view','create','edit'))
     OR (p.module = 'reconciliation'       AND p.action = 'view')
     OR (p.module = 'daily_pnl'            AND p.action = 'view')
     OR (p.module = 'ceo_transactions'     AND p.action = 'view')
     OR (p.module = 'notifications'        AND p.action = 'view')
  ON CONFLICT (role_id, permission_id) DO NOTHING;

  -- ── Viewer permissions ───────────────────────────────────────────────────────
  INSERT INTO role_permissions (role_id, permission_id, created_by)
  SELECT v_viewer_id, p.id, p_user_id
  FROM permissions p
  WHERE (p.module = 'dashboard'            AND p.action = 'view')
     OR (p.module = 'sales_orders'         AND p.action IN ('view','export'))
     OR (p.module = 'expenses'             AND p.action IN ('view','export'))
     OR (p.module = 'inventory'            AND p.action = 'view')
     OR (p.module = 'daily_pnl'            AND p.action IN ('view','export'))
     OR (p.module = 'marketplace_cashflow' AND p.action = 'view')
     OR (p.module = 'bank'                 AND p.action = 'view')
     OR (p.module = 'reconciliation'       AND p.action = 'view')
  ON CONFLICT (role_id, permission_id) DO NOTHING;
END;
$$;

-- Grant execute to authenticated users (they call via RPC with their own user id)
REVOKE EXECUTE ON FUNCTION seed_default_roles_for_user(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION seed_default_roles_for_user(UUID) TO authenticated;
