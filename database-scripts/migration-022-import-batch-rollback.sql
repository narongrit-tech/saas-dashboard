-- Migration 022: Import Batch Rollback & Purge System
-- Date: 2026-01-26
-- Purpose: Add rollback/purge functionality for import batches with correct status constraints

-- ============================================================================
-- 1. Fix Status Constraint (allow 'rolled_back' and 'deleted')
-- ============================================================================

-- Drop existing constraint if exists
ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_status_valid;
ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_status_check;

-- Create new constraint with all allowed statuses
ALTER TABLE public.import_batches
ADD CONSTRAINT import_batches_status_check
CHECK (status IN ('processing', 'success', 'failed', 'rolled_back', 'deleted'));

COMMENT ON CONSTRAINT import_batches_status_check ON public.import_batches IS
'Valid status values: processing (active), success (completed), failed (error), rolled_back (data removed but batch kept), deleted (hard purged)';

-- ============================================================================
-- 2. Function 1: rollback_import_batch (for app usage with auth.uid())
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rollback_import_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_exists BOOLEAN;
  v_wallet_deleted INT := 0;
  v_ads_deleted INT := 0;
  v_batch_updated BOOLEAN := FALSE;
BEGIN
  -- Step 1: Verify batch exists and belongs to current user
  SELECT EXISTS(
    SELECT 1 FROM import_batches
    WHERE id = p_batch_id
    AND created_by = auth.uid()
  ) INTO v_batch_exists;

  IF NOT v_batch_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Batch not found or access denied'
    );
  END IF;

  -- Step 2: Delete wallet ledger entries
  WITH deleted_wallet AS (
    DELETE FROM wallet_ledger
    WHERE import_batch_id = p_batch_id
    AND created_by = auth.uid()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_wallet_deleted FROM deleted_wallet;

  -- Step 3: Delete ad performance entries
  WITH deleted_ads AS (
    DELETE FROM ad_daily_performance
    WHERE import_batch_id = p_batch_id
    AND created_by = auth.uid()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_ads_deleted FROM deleted_ads;

  -- Step 4: Update batch status
  UPDATE import_batches
  SET
    status = 'rolled_back',
    notes = COALESCE(notes || ' | ', '') || 'Rolled back at ' || NOW()::TEXT,
    updated_at = NOW()
  WHERE id = p_batch_id
  AND created_by = auth.uid();

  v_batch_updated := FOUND;

  -- Step 5: Return result
  RETURN jsonb_build_object(
    'success', true,
    'wallet_deleted', v_wallet_deleted,
    'ads_deleted', v_ads_deleted,
    'batch_updated', v_batch_updated
  );
END;
$$;

COMMENT ON FUNCTION public.rollback_import_batch(UUID) IS
'Rollback import batch for current authenticated user. Removes wallet_ledger and ad_daily_performance entries, marks batch as rolled_back.';

-- ============================================================================
-- 3. Function 2: rollback_import_batch_as_admin (for SQL editor usage)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rollback_import_batch_as_admin(
  p_batch_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_exists BOOLEAN;
  v_wallet_deleted INT := 0;
  v_ads_deleted INT := 0;
  v_batch_updated BOOLEAN := FALSE;
BEGIN
  -- Step 1: Verify batch exists and belongs to specified user
  SELECT EXISTS(
    SELECT 1 FROM import_batches
    WHERE id = p_batch_id
    AND created_by = p_user_id
  ) INTO v_batch_exists;

  IF NOT v_batch_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Batch not found or does not belong to specified user'
    );
  END IF;

  -- Step 2: Delete wallet ledger entries
  WITH deleted_wallet AS (
    DELETE FROM wallet_ledger
    WHERE import_batch_id = p_batch_id
    AND created_by = p_user_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_wallet_deleted FROM deleted_wallet;

  -- Step 3: Delete ad performance entries
  WITH deleted_ads AS (
    DELETE FROM ad_daily_performance
    WHERE import_batch_id = p_batch_id
    AND created_by = p_user_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_ads_deleted FROM deleted_ads;

  -- Step 4: Update batch status
  UPDATE import_batches
  SET
    status = 'rolled_back',
    notes = COALESCE(notes || ' | ', '') || 'Rolled back by admin at ' || NOW()::TEXT,
    updated_at = NOW()
  WHERE id = p_batch_id
  AND created_by = p_user_id;

  v_batch_updated := FOUND;

  -- Step 5: Return result
  RETURN jsonb_build_object(
    'success', true,
    'wallet_deleted', v_wallet_deleted,
    'ads_deleted', v_ads_deleted,
    'batch_updated', v_batch_updated
  );
END;
$$;

COMMENT ON FUNCTION public.rollback_import_batch_as_admin(UUID, UUID) IS
'Admin function to rollback import batch for specified user. For SQL editor use only.';

-- ============================================================================
-- 4. Function 3: purge_import_batch_as_admin (hard delete)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.purge_import_batch_as_admin(
  p_batch_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_exists BOOLEAN;
  v_wallet_deleted INT := 0;
  v_ads_deleted INT := 0;
  v_batch_deleted BOOLEAN := FALSE;
BEGIN
  -- Step 1: Verify batch exists and belongs to specified user
  SELECT EXISTS(
    SELECT 1 FROM import_batches
    WHERE id = p_batch_id
    AND created_by = p_user_id
  ) INTO v_batch_exists;

  IF NOT v_batch_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Batch not found or does not belong to specified user'
    );
  END IF;

  -- Step 2: Delete wallet ledger entries (cascading)
  WITH deleted_wallet AS (
    DELETE FROM wallet_ledger
    WHERE import_batch_id = p_batch_id
    AND created_by = p_user_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_wallet_deleted FROM deleted_wallet;

  -- Step 3: Delete ad performance entries (cascading)
  WITH deleted_ads AS (
    DELETE FROM ad_daily_performance
    WHERE import_batch_id = p_batch_id
    AND created_by = p_user_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_ads_deleted FROM deleted_ads;

  -- Step 4: Hard delete batch record
  DELETE FROM import_batches
  WHERE id = p_batch_id
  AND created_by = p_user_id;

  v_batch_deleted := FOUND;

  -- Step 5: Return result
  RETURN jsonb_build_object(
    'success', true,
    'wallet_deleted', v_wallet_deleted,
    'ads_deleted', v_ads_deleted,
    'batch_deleted', v_batch_deleted
  );
END;
$$;

COMMENT ON FUNCTION public.purge_import_batch_as_admin(UUID, UUID) IS
'Admin function to permanently delete import batch and all related data. For SQL editor use only.';

-- ============================================================================
-- 5. Grants
-- ============================================================================

-- Grant execute on user-facing function (requires authentication)
GRANT EXECUTE ON FUNCTION public.rollback_import_batch(UUID) TO authenticated;

-- Admin functions: No grant needed (postgres role has implicit access)

-- ============================================================================
-- Verification SQL (for testing)
-- ============================================================================

-- Test rollback_import_batch (must be called from app with authenticated user)
-- Example:
-- SELECT rollback_import_batch('00000000-0000-0000-0000-000000000000');

-- Test admin functions (from SQL editor as postgres role)
-- Example rollback:
-- SELECT rollback_import_batch_as_admin(
--   '00000000-0000-0000-0000-000000000000'::UUID,
--   '11111111-1111-1111-1111-111111111111'::UUID
-- );

-- Example purge:
-- SELECT purge_import_batch_as_admin(
--   '00000000-0000-0000-0000-000000000000'::UUID,
--   '11111111-1111-1111-1111-111111111111'::UUID
-- );

-- Check status constraint
-- SELECT constraint_name, check_clause
-- FROM information_schema.check_constraints
-- WHERE constraint_name LIKE '%import_batches_status%';

-- List all import batches with status
-- SELECT id, report_type, status, row_count, created_at, notes
-- FROM import_batches
-- ORDER BY created_at DESC
-- LIMIT 20;
