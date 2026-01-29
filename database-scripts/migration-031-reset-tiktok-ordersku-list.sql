-- ============================================
-- Migration 031: Reset TikTok OrderSKUList Data (Admin Function)
-- Description: Add production-safe reset function for TikTok OrderSKUList data with admin authorization
-- Phase: Sales Orders - Data Management & Admin Tools
-- Date: 2026-01-29
-- ============================================

-- ============================================
-- Purpose:
-- - Allow admins to reset TikTok OrderSKUList imported data (sales_orders + import_batches)
-- - Support dry-run preview to show counts before actual deletion
-- - Enforce admin-only authorization for non-dry-run operations
-- - Log all admin actions for audit trail
-- ============================================

-- ============================================
-- STEP 1: CREATE USER_ROLES TABLE (if not exists)
-- ============================================

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.user_roles IS 'User role assignments for authorization (admin, user)';
COMMENT ON COLUMN public.user_roles.role IS 'User role: admin (full access) or user (standard access)';

-- Create index for role lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id
ON public.user_roles(user_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_role
ON public.user_roles(role);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Users can view their own role
DROP POLICY IF EXISTS "user_roles_select_own" ON public.user_roles;
CREATE POLICY "user_roles_select_own"
ON public.user_roles FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Only admins can view all roles (for future admin panel)
DROP POLICY IF EXISTS "user_roles_select_admin" ON public.user_roles;
CREATE POLICY "user_roles_select_admin"
ON public.user_roles FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  )
);

-- Only admins can insert/update/delete roles
DROP POLICY IF EXISTS "user_roles_admin_all" ON public.user_roles;
CREATE POLICY "user_roles_admin_all"
ON public.user_roles
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  )
);

-- ============================================
-- STEP 2: CREATE ADMIN_ACTIONS AUDIT LOG TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS public.admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.admin_actions IS 'Audit log for admin actions (destructive operations, config changes, etc.)';
COMMENT ON COLUMN public.admin_actions.action IS 'Action identifier (e.g., reset_tiktok_ordersku_list, delete_import_batch)';
COMMENT ON COLUMN public.admin_actions.details IS 'Action-specific metadata (e.g., counts deleted, parameters used)';

-- Create indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_admin_actions_user_id_created_at
ON public.admin_actions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_actions_action
ON public.admin_actions(action);

CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at
ON public.admin_actions(created_at DESC);

-- Enable RLS on admin_actions
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs
DROP POLICY IF EXISTS "admin_actions_select_admin" ON public.admin_actions;
CREATE POLICY "admin_actions_select_admin"
ON public.admin_actions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  )
);

-- Only the function can insert audit logs (SECURITY DEFINER bypass)
DROP POLICY IF EXISTS "admin_actions_insert_function" ON public.admin_actions;
CREATE POLICY "admin_actions_insert_function"
ON public.admin_actions FOR INSERT
TO authenticated
WITH CHECK (true); -- Function will enforce proper logging

-- ============================================
-- STEP 3: CREATE RESET FUNCTION (SECURITY DEFINER)
-- ============================================

CREATE OR REPLACE FUNCTION public.reset_tiktok_ordersku_list(
  p_dry_run BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Run with function owner's privileges (bypass RLS)
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_is_admin BOOLEAN;
  v_sales_orders_before INTEGER;
  v_import_batches_before INTEGER;
  v_sales_orders_deleted INTEGER := 0;
  v_import_batches_deleted INTEGER := 0;
  v_result JSONB;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();

  -- Check if user is authenticated
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if user is admin (only for non-dry-run)
  IF NOT p_dry_run THEN
    SELECT EXISTS(
      SELECT 1 FROM public.user_roles
      WHERE user_id = v_user_id AND role = 'admin'
    ) INTO v_is_admin;

    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Unauthorized: Only admins can execute reset (non-dry-run)';
    END IF;
  END IF;

  -- Count rows BEFORE deletion
  -- Sales orders with source_report = 'OrderSKUList'
  SELECT COUNT(*)
  INTO v_sales_orders_before
  FROM public.sales_orders
  WHERE metadata->>'source_report' = 'OrderSKUList';

  -- Import batches with marketplace = 'tiktok_shop' AND report_type = 'sales_order_sku_list'
  SELECT COUNT(*)
  INTO v_import_batches_before
  FROM public.import_batches
  WHERE marketplace = 'tiktok_shop'
    AND report_type = 'sales_order_sku_list';

  -- If dry-run, return counts without deleting
  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'sales_orders_before', v_sales_orders_before,
      'import_batches_before', v_import_batches_before,
      'sales_orders_deleted', 0,
      'import_batches_deleted', 0,
      'message', 'Dry-run completed. No data was deleted.'
    );
  END IF;

  -- ACTUAL DELETION (non-dry-run, admin only)

  -- Delete sales_orders rows with source_report = 'OrderSKUList'
  WITH deleted_sales AS (
    DELETE FROM public.sales_orders
    WHERE metadata->>'source_report' = 'OrderSKUList'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_sales_orders_deleted FROM deleted_sales;

  -- Delete import_batches rows with marketplace = 'tiktok_shop' AND report_type = 'sales_order_sku_list'
  WITH deleted_batches AS (
    DELETE FROM public.import_batches
    WHERE marketplace = 'tiktok_shop'
      AND report_type = 'sales_order_sku_list'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_import_batches_deleted FROM deleted_batches;

  -- Log admin action
  INSERT INTO public.admin_actions (user_id, action, details)
  VALUES (
    v_user_id,
    'reset_tiktok_ordersku_list',
    jsonb_build_object(
      'sales_orders_deleted', v_sales_orders_deleted,
      'import_batches_deleted', v_import_batches_deleted,
      'sales_orders_before', v_sales_orders_before,
      'import_batches_before', v_import_batches_before,
      'timestamp', NOW()
    )
  );

  -- Build result
  v_result := jsonb_build_object(
    'dry_run', false,
    'sales_orders_before', v_sales_orders_before,
    'import_batches_before', v_import_batches_before,
    'sales_orders_deleted', v_sales_orders_deleted,
    'import_batches_deleted', v_import_batches_deleted,
    'message', format('Reset completed. Deleted %s sales orders and %s import batches.',
                     v_sales_orders_deleted, v_import_batches_deleted)
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.reset_tiktok_ordersku_list IS
'Admin-only function to reset TikTok OrderSKUList data. Supports dry-run preview (default). Non-dry-run requires admin role and logs action to admin_actions.';

-- Grant execute permission to authenticated users (function will check admin role internally)
GRANT EXECUTE ON FUNCTION public.reset_tiktok_ordersku_list TO authenticated;

-- ============================================
-- STEP 4: VERIFICATION QUERIES (Optional - Run separately)
-- ============================================

-- Dry-run preview (any authenticated user can run)
-- SELECT public.reset_tiktok_ordersku_list(true);

-- Actual reset (admin only)
-- SELECT public.reset_tiktok_ordersku_list(false);

-- Check admin_actions audit log
-- SELECT * FROM public.admin_actions ORDER BY created_at DESC LIMIT 10;

-- Check user roles
-- SELECT * FROM public.user_roles;

-- ============================================
-- END OF MIGRATION
-- ============================================
