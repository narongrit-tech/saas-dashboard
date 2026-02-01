-- ============================================================================
-- Migration 025: Bank Import Enhancements (Import Modes + Rollback)
-- Date: 2026-01-29
-- Purpose: Add import mode tracking, rollback support, and improved metadata
-- Dependencies: migration-014 (bank module), migration-018 (bank txn dedup)
-- ============================================================================

-- ============================================================================
-- PART 1: Schema Changes
-- ============================================================================

-- 1.1: Add import_mode column to bank_statement_import_batches
ALTER TABLE public.bank_statement_import_batches
ADD COLUMN IF NOT EXISTS import_mode VARCHAR(20) DEFAULT 'append';

ALTER TABLE public.bank_statement_import_batches
ADD CONSTRAINT bank_import_mode_check
CHECK (import_mode IN ('append', 'replace_range', 'replace_all'));

COMMENT ON COLUMN public.bank_statement_import_batches.import_mode IS
'Import mode: append (add new only), replace_range (delete date range then insert), replace_all (delete all then insert)';

-- 1.2: Expand status constraint to support 'rolled_back'
ALTER TABLE public.bank_statement_import_batches
DROP CONSTRAINT IF EXISTS bank_statement_import_batches_status_check;

ALTER TABLE public.bank_statement_import_batches
ADD CONSTRAINT bank_statement_import_batches_status_check
CHECK (status IN ('pending', 'completed', 'failed', 'rolled_back'));

COMMENT ON CONSTRAINT bank_statement_import_batches_status_check
ON public.bank_statement_import_batches IS
'Valid status: pending (processing), completed (success), failed (error), rolled_back (transactions deleted)';

-- 1.3: Update metadata column comment with new fields
COMMENT ON COLUMN public.bank_statement_import_batches.metadata IS
'Import metadata (JSONB): format_type, column_mapping, duplicate_count, total_rows, date_range {start, end}, deleted_before_import, rollback_info {rolled_back_at, deleted_count}';

-- ============================================================================
-- PART 2: RLS Policies
-- ============================================================================

-- 2.1: Add UPDATE policy for bank_statement_import_batches (needed for rollback status update)
CREATE POLICY "Users can update own bank import batches"
  ON public.bank_statement_import_batches FOR UPDATE
  USING (imported_by = auth.uid());

COMMENT ON POLICY "Users can update own bank import batches"
ON public.bank_statement_import_batches IS
'Allow users to update their own import batches (for rollback status updates)';

-- ============================================================================
-- PART 3: Rollback RPC Function
-- ============================================================================

-- 3.1: Create rollback function for bank import batches
CREATE OR REPLACE FUNCTION public.rollback_bank_import_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_exists BOOLEAN;
  v_bank_account_id UUID;
  v_txn_deleted INT := 0;
  v_status TEXT;
  v_user_id UUID;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: no active session'
    );
  END IF;

  -- Step 1: Verify batch exists and belongs to current user
  -- Must verify bank_account ownership via join (RLS protection)
  SELECT
    b.bank_account_id,
    b.status
  INTO
    v_bank_account_id,
    v_status
  FROM bank_statement_import_batches b
  INNER JOIN bank_accounts a ON b.bank_account_id = a.id
  WHERE b.id = p_batch_id
    AND b.imported_by = v_user_id
    AND a.created_by = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Batch not found or access denied'
    );
  END IF;

  -- Step 2: Check if already rolled back
  IF v_status = 'rolled_back' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Batch already rolled back'
    );
  END IF;

  -- Step 3: Check if batch is completed (can't rollback pending/failed)
  IF v_status != 'completed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Can only rollback completed imports (current status: ' || v_status || ')'
    );
  END IF;

  -- Step 4: Delete all transactions from this batch
  -- RLS ensures user can only delete their own transactions
  WITH deleted_txns AS (
    DELETE FROM bank_transactions
    WHERE import_batch_id = p_batch_id
      AND created_by = v_user_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_txn_deleted FROM deleted_txns;

  -- Step 5: Update batch status to rolled_back
  -- Add rollback info to metadata
  UPDATE bank_statement_import_batches
  SET
    status = 'rolled_back',
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'rollback_info', jsonb_build_object(
        'rolled_back_at', NOW()::TEXT,
        'deleted_count', v_txn_deleted
      )
    )
  WHERE id = p_batch_id
    AND imported_by = v_user_id;

  -- Step 6: Return result
  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_txn_deleted
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Log error and return
    RAISE WARNING 'rollback_bank_import_batch error for batch %: % %', p_batch_id, SQLERRM, SQLSTATE;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Database error: ' || SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION public.rollback_bank_import_batch(UUID) IS
'Rollback bank import batch for authenticated user. Deletes all transactions from batch and marks batch as rolled_back. Returns {success, deleted_count} or {success: false, error}.';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.rollback_bank_import_batch(UUID) TO authenticated;

-- ============================================================================
-- PART 4: Verification Queries (for testing)
-- ============================================================================

-- 4.1: Verify import_mode column exists
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'bank_statement_import_batches'
--   AND column_name = 'import_mode';

-- 4.2: Verify status constraint includes 'rolled_back'
-- SELECT constraint_name, check_clause
-- FROM information_schema.check_constraints
-- WHERE constraint_schema = 'public'
--   AND constraint_name = 'bank_statement_import_batches_status_check';

-- 4.3: Verify RLS policies
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'bank_statement_import_batches'
-- ORDER BY policyname;

-- 4.4: Verify function exists and has correct permissions
-- SELECT proname, prosecdef, provolatile, prorettype::regtype, proargtypes::regtype[]
-- FROM pg_proc
-- WHERE proname = 'rollback_bank_import_batch'
--   AND pronamespace = 'public'::regnamespace;

-- 4.5: Test rollback function (requires active auth session)
-- SELECT rollback_bank_import_batch('00000000-0000-0000-0000-000000000000'::UUID);

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Summary:
-- ✅ Added import_mode column (append, replace_range, replace_all)
-- ✅ Updated status constraint to include 'rolled_back'
-- ✅ Added UPDATE policy for batch status changes
-- ✅ Created rollback_bank_import_batch RPC function
-- ✅ Granted execute permission to authenticated users
-- ✅ Added comprehensive comments and verification queries
