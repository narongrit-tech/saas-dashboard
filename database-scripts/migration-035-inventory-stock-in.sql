-- Migration 035: Inventory Stock In Documents
--
-- Purpose: Track inbound stock receipts (purchases, returns from customers, adjustments)
--
-- Changes:
-- 1. Create inventory_stock_in_documents table
-- 2. Enable RLS with same pattern as other inventory tables
-- 3. Add updated_at trigger
--
-- Note: inventory_receipt_layers already has ref_type/ref_id columns to link to this table

-- ============================================================================
-- 1. Create inventory_stock_in_documents table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inventory_stock_in_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  received_at TIMESTAMPTZ NOT NULL,
  reference TEXT NOT NULL,
  supplier TEXT,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_stock_in_documents_received_at
  ON public.inventory_stock_in_documents(received_at);

CREATE INDEX IF NOT EXISTS idx_stock_in_documents_created_by
  ON public.inventory_stock_in_documents(created_by);

-- ============================================================================
-- 2. Enable RLS
-- ============================================================================

ALTER TABLE public.inventory_stock_in_documents ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view stock in documents
CREATE POLICY "Users can view stock in documents"
  ON public.inventory_stock_in_documents
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Policy: Users can insert stock in documents
CREATE POLICY "Users can insert stock in documents"
  ON public.inventory_stock_in_documents
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Policy: Users can update their own stock in documents
CREATE POLICY "Users can update own stock in documents"
  ON public.inventory_stock_in_documents
  FOR UPDATE
  USING (created_by = auth.uid());

-- Policy: Users can delete their own stock in documents
CREATE POLICY "Users can delete own stock in documents"
  ON public.inventory_stock_in_documents
  FOR DELETE
  USING (created_by = auth.uid());

-- ============================================================================
-- 3. Add updated_at trigger
-- ============================================================================

-- Reuse existing trigger function (assumes it already exists)
CREATE TRIGGER set_updated_at_inventory_stock_in_documents
  BEFORE UPDATE ON public.inventory_stock_in_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.inventory_stock_in_documents IS
  'Stock in documents for tracking inbound receipts (purchases, returns, adjustments)';

COMMENT ON COLUMN public.inventory_stock_in_documents.received_at IS
  'Date/time when stock was received (Bangkok timezone)';

COMMENT ON COLUMN public.inventory_stock_in_documents.reference IS
  'Reference number (e.g., PO number, invoice number, adjustment ID)';

COMMENT ON COLUMN public.inventory_stock_in_documents.supplier IS
  'Supplier name (optional)';

COMMENT ON COLUMN public.inventory_stock_in_documents.note IS
  'Additional notes or remarks';

COMMENT ON COLUMN public.inventory_stock_in_documents.created_by IS
  'User who created this stock in document';
