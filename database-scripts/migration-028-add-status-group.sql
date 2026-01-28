-- ============================================
-- Migration 028: Add status_group column to sales_orders
-- Description: Add Order Status field (ที่จัดส่ง, ชำระเงินแล้ว, ยกเลิกแล้ว)
-- Phase: Order View/Line View Feature
-- Date: 2026-01-28
-- ============================================

-- Add status_group column (Order Status from TikTok, distinct from platform_status which is Order Substatus)
ALTER TABLE public.sales_orders
ADD COLUMN IF NOT EXISTS status_group TEXT;

COMMENT ON COLUMN public.sales_orders.status_group IS 'Order Status group from platform (e.g., TikTok "ที่จัดส่ง", "ชำระเงินแล้ว", "ยกเลิกแล้ว") - used for broader grouping/filtering';

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_sales_orders_status_group
ON public.sales_orders(status_group)
WHERE status_group IS NOT NULL;

-- Backfill status_group from platform_status for existing data (best effort)
-- Map platform_status (substatus) to broader status_group
UPDATE public.sales_orders
SET status_group = CASE
  WHEN platform_status IS NOT NULL AND platform_status ILIKE '%ยกเลิก%' THEN 'ยกเลิกแล้ว'
  WHEN platform_status IS NOT NULL AND (platform_status ILIKE '%จัดส่ง%' OR platform_status ILIKE '%ส่งสำเร็จ%') THEN 'ที่จัดส่ง'
  WHEN payment_status = 'paid' THEN 'ชำระเงินแล้ว'
  ELSE NULL
END
WHERE status_group IS NULL;

-- ============================================
-- END OF MIGRATION
-- ============================================
