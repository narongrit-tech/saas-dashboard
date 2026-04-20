-- ============================================================
-- Migration 111: shop_image_url column on tt_shop_master
-- Safe to add: code already handles null gracefully (EntityAvatar falls back to initials).
-- ============================================================

ALTER TABLE public.tt_shop_master
  ADD COLUMN IF NOT EXISTS shop_image_url TEXT;
