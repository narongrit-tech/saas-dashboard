-- ============================================
-- Migration 008: Sales Orders UX v2 - Platform Status & Pagination
-- Description: Add platform-specific status tracking and fulfillment fields
-- Phase: 6B (UX Enhancement)
-- Date: 2026-01-25
-- ============================================

-- ============================================
-- ADD NEW COLUMNS TO sales_orders
-- ============================================

-- Platform identification
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS source_platform TEXT;

COMMENT ON COLUMN public.sales_orders.source_platform IS 'Platform identifier: tiktok_shop, shopee, lazada, etc. (normalized)';

-- External order tracking
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS external_order_id TEXT;

COMMENT ON COLUMN public.sales_orders.external_order_id IS 'Original order ID from platform (e.g., TikTok Order ID)';

-- Platform-specific status
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS platform_status TEXT;

ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS platform_substatus TEXT;

COMMENT ON COLUMN public.sales_orders.platform_status IS 'Raw status from platform (e.g., "Unpaid", "To Ship", "Delivered")';
COMMENT ON COLUMN public.sales_orders.platform_substatus IS 'Platform sub-status for detailed tracking';

-- Payment tracking
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS payment_status TEXT;

ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.sales_orders.payment_status IS 'Payment state: paid, unpaid, refunded, partial';
COMMENT ON COLUMN public.sales_orders.paid_at IS 'Timestamp when payment was received (Bangkok timezone)';

-- Fulfillment tracking
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.sales_orders.shipped_at IS 'Timestamp when order was shipped (Bangkok timezone)';
COMMENT ON COLUMN public.sales_orders.delivered_at IS 'Timestamp when order was delivered (Bangkok timezone)';

-- SKU details (for future inventory integration)
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS seller_sku TEXT;

ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS sku_id TEXT;

COMMENT ON COLUMN public.sales_orders.seller_sku IS 'Seller-defined SKU code';
COMMENT ON COLUMN public.sales_orders.sku_id IS 'Platform SKU identifier';

-- ============================================
-- CREATE INDEXES FOR FAST FILTERING
-- ============================================

-- Platform filtering (important for multi-marketplace)
CREATE INDEX IF NOT EXISTS idx_sales_orders_source_platform
ON public.sales_orders(source_platform)
WHERE source_platform IS NOT NULL;

-- Platform status filtering
CREATE INDEX IF NOT EXISTS idx_sales_orders_platform_status
ON public.sales_orders(platform_status)
WHERE platform_status IS NOT NULL;

-- Payment status filtering
CREATE INDEX IF NOT EXISTS idx_sales_orders_payment_status
ON public.sales_orders(payment_status)
WHERE payment_status IS NOT NULL;

-- External order ID lookup
CREATE INDEX IF NOT EXISTS idx_sales_orders_external_order_id
ON public.sales_orders(external_order_id)
WHERE external_order_id IS NOT NULL;

-- Seller SKU lookup (for inventory)
CREATE INDEX IF NOT EXISTS idx_sales_orders_seller_sku
ON public.sales_orders(seller_sku)
WHERE seller_sku IS NOT NULL;

-- ============================================
-- BACKFILL EXISTING DATA (Best Effort)
-- ============================================

-- Backfill source_platform from marketplace
-- Normalize to consistent values (lowercase with underscore)
UPDATE public.sales_orders
SET source_platform = CASE
  WHEN LOWER(marketplace) IN ('tiktok', 'tiktok shop', 'tiktok_shop') THEN 'tiktok_shop'
  WHEN LOWER(marketplace) = 'shopee' THEN 'shopee'
  WHEN LOWER(marketplace) = 'lazada' THEN 'lazada'
  WHEN LOWER(marketplace) = 'line' THEN 'line'
  WHEN LOWER(marketplace) = 'facebook' THEN 'facebook'
  ELSE LOWER(REPLACE(marketplace, ' ', '_'))
END
WHERE source_platform IS NULL;

-- Backfill payment_status from status
-- Simple rule: completed orders are likely paid
UPDATE public.sales_orders
SET payment_status = CASE
  WHEN status = 'completed' THEN 'paid'
  WHEN status = 'cancelled' THEN 'unpaid'
  ELSE 'unpaid'
END
WHERE payment_status IS NULL;

-- Backfill platform_status from internal status (basic mapping)
UPDATE public.sales_orders
SET platform_status = CASE
  WHEN status = 'completed' THEN 'Delivered'
  WHEN status = 'cancelled' THEN 'Cancelled'
  WHEN status = 'pending' THEN 'To Ship'
  ELSE 'Unknown'
END
WHERE platform_status IS NULL;

-- Backfill external_order_id from order_id for imported records
-- (Manual records start with 'MAN-', those are internal IDs)
UPDATE public.sales_orders
SET external_order_id = order_id
WHERE external_order_id IS NULL
  AND source = 'imported'
  AND order_id NOT LIKE 'MAN-%';

-- ============================================
-- DATA VALIDATION (Optional Constraints)
-- ============================================

-- Add check constraint for payment_status values
ALTER TABLE public.sales_orders
DROP CONSTRAINT IF EXISTS sales_orders_payment_status_valid;

ALTER TABLE public.sales_orders
ADD CONSTRAINT sales_orders_payment_status_valid
CHECK (
  payment_status IS NULL OR
  payment_status IN ('paid', 'unpaid', 'partial', 'refunded', 'pending')
);

-- ============================================
-- UPDATE RLS POLICIES (No changes needed)
-- ============================================
-- Existing RLS policies cover new columns automatically
-- Users can only access their own created_by records

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE public.sales_orders IS
'Sales orders table with platform-specific status tracking (UX v2).
Supports multi-marketplace with payment and fulfillment tracking.
Line-level storage: each SKU = separate row.';

-- ============================================
-- END OF MIGRATION
-- ============================================
