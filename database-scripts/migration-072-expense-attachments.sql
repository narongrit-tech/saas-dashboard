-- Migration 072: Expense Attachments
-- Creates expense_attachments table for payment slip storage (Phase A)
-- Uses Supabase Storage bucket 'expense-attachments' (private, RLS enforced)
-- Client uploads directly to Storage; server action saves metadata to this table

-- ============================================================
-- 1. Create expense_attachments table
-- ============================================================
CREATE TABLE expense_attachments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id  UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  -- file_path: Storage path format: user_id/expense_id/timestamp-filename
  file_path   TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  file_type   TEXT,
  file_size   BIGINT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  created_by  UUID NOT NULL DEFAULT auth.uid()
);

-- ============================================================
-- 2. RLS
-- Double-guard: row must be owned by user AND the parent expense must also be owned by user
-- ============================================================
ALTER TABLE expense_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own expense attachments"
  ON expense_attachments FOR ALL
  USING (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = expense_id
        AND e.created_by = auth.uid()
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = expense_id
        AND e.created_by = auth.uid()
    )
  );

-- ============================================================
-- 3. Indexes
-- ============================================================
CREATE INDEX idx_expense_attachments_expense_id ON expense_attachments(expense_id);
CREATE INDEX idx_expense_attachments_created_by ON expense_attachments(created_by);

-- ============================================================
-- 4. Supabase Storage bucket (private, 10 MB limit)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-attachments',
  'expense-attachments',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 5. Storage RLS: each user owns their own folder prefix (user_id/...)
-- Drop before create for idempotency
-- ============================================================
DROP POLICY IF EXISTS "Users upload own expense attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users read own expense attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own expense attachments" ON storage.objects;

CREATE POLICY "Users upload own expense attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'expense-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users read own expense attachments"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'expense-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users delete own expense attachments"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'expense-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- Verify:
--   SELECT * FROM expense_attachments LIMIT 1;
--   SELECT id, name, public FROM storage.buckets WHERE id = 'expense-attachments';
--   SELECT policyname FROM pg_policies WHERE tablename = 'expense_attachments';
-- ============================================================
