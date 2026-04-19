-- migration-103: Fix statement timeout for normalize_tiktok_affiliate_order_batch
--
-- Problem: normalize_tiktok_affiliate_order_batch hits PostgreSQL's statement_timeout
-- for large import files (hundreds or thousands of rows). The function processes all
-- rows in one transaction which can exceed the default session-level timeout.
--
-- Fix: Set statement_timeout = 0 (unlimited) as a per-function GUC attribute.
-- PostgreSQL will apply this setting for the duration of the function call only,
-- then restore the original value — safe and scoped.

ALTER FUNCTION public.normalize_tiktok_affiliate_order_batch(UUID)
  SET statement_timeout TO 0;
