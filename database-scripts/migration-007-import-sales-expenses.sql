-- ============================================
-- Migration 007: Add Import Support to Sales & Expenses
-- Phase 6: CSV/Excel Import Infrastructure
-- ============================================

-- Purpose:
-- 1. Link sales_orders and expenses to import_batches (dedup + traceability)
-- 2. Add source tracking (manual vs imported)
-- 3. Add metadata field to sales_orders for rich TikTok data

-- ============================================
-- ALTER sales_orders
-- ============================================

-- Add source column (manual or imported)
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual';

-- Add import_batch_id to link to import_batches table
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE SET NULL;

-- Add metadata JSONB column for marketplace-specific rich data (TikTok, Shopee, etc.)
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Add index for import_batch_id lookups
CREATE INDEX IF NOT EXISTS idx_sales_orders_import_batch_id
ON public.sales_orders(import_batch_id);

-- Add index for source lookups
CREATE INDEX IF NOT EXISTS idx_sales_orders_source
ON public.sales_orders(source);

-- ============================================
-- ALTER expenses
-- ============================================

-- Add source column (manual or imported)
ALTER TABLE public.expenses
ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual';

-- Add import_batch_id to link to import_batches table
ALTER TABLE public.expenses
ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE SET NULL;

-- Add index for import_batch_id lookups
CREATE INDEX IF NOT EXISTS idx_expenses_import_batch_id
ON public.expenses(import_batch_id);

-- Add index for source lookups
CREATE INDEX IF NOT EXISTS idx_expenses_source
ON public.expenses(source);

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN public.sales_orders.source IS 'Source of record: manual (user entry) or imported (file upload)';
COMMENT ON COLUMN public.sales_orders.import_batch_id IS 'Links to import_batches table for traceability and deduplication';
COMMENT ON COLUMN public.sales_orders.metadata IS 'Marketplace-specific metadata (TikTok order status, Shopee logistics, etc.) stored as JSONB';

COMMENT ON COLUMN public.expenses.source IS 'Source of record: manual (user entry) or imported (file upload)';
COMMENT ON COLUMN public.expenses.import_batch_id IS 'Links to import_batches table for traceability and deduplication';

-- ============================================
-- END OF MIGRATION 007
-- ============================================
