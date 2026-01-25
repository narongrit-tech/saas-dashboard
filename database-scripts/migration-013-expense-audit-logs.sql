-- Migration 013: Expense Audit Logs
-- Creates audit trail table for tracking expense changes
-- Supports future permission system

-- ============================================
-- EXPENSE AUDIT LOGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS public.expense_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Audit metadata
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE')),
  performed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Changed data (JSON)
  changes JSONB NOT NULL, -- { before: {...}, after: {...} } or { created: {...} } or { deleted: {...} }

  -- Context
  ip_address INET,
  user_agent TEXT,
  notes TEXT, -- Optional admin notes

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by expense
CREATE INDEX idx_expense_audit_logs_expense_id ON public.expense_audit_logs(expense_id);

-- Index for fast lookup by user
CREATE INDEX idx_expense_audit_logs_performed_by ON public.expense_audit_logs(performed_by);

-- Index for time-based queries
CREATE INDEX idx_expense_audit_logs_performed_at ON public.expense_audit_logs(performed_at DESC);

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE public.expense_audit_logs ENABLE ROW LEVEL SECURITY;

-- Read: Users can view audit logs for their own expenses
CREATE POLICY expense_audit_logs_select_policy ON public.expense_audit_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE expenses.id = expense_audit_logs.expense_id
        AND expenses.created_by = auth.uid()
    )
  );

-- Insert: System only (triggers will handle inserts)
-- No direct INSERT policy for users

-- No UPDATE or DELETE for audit logs (immutable)

-- ============================================
-- HELPER FUNCTION FOR AUDIT LOG CREATION
-- ============================================

CREATE OR REPLACE FUNCTION public.create_expense_audit_log(
  p_expense_id UUID,
  p_action VARCHAR(20),
  p_performed_by UUID,
  p_changes JSONB,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO public.expense_audit_logs (
    expense_id,
    action,
    performed_by,
    changes,
    ip_address,
    user_agent,
    notes
  ) VALUES (
    p_expense_id,
    p_action,
    p_performed_by,
    p_changes,
    p_ip_address,
    p_user_agent,
    p_notes
  ) RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.create_expense_audit_log TO authenticated;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE public.expense_audit_logs IS 'Audit trail for expense CREATE/UPDATE/DELETE operations';
COMMENT ON COLUMN public.expense_audit_logs.changes IS 'JSON structure: { before: {...}, after: {...} } for UPDATE, { created: {...} } for CREATE, { deleted: {...} } for DELETE';
COMMENT ON FUNCTION public.create_expense_audit_log IS 'Helper function to create audit log entries from server actions';
