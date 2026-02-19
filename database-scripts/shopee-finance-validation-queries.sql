-- =============================================================================
-- Shopee Finance — Validation Queries
-- Run these in Supabase SQL Editor to verify imported data
-- =============================================================================
-- Replace 'YOUR_USER_ID' with your actual auth.uid() value before running.
-- =============================================================================

-- -----------------------------------------------------------------------
-- 0. Quick row count check (both tables)
-- -----------------------------------------------------------------------
SELECT
  'shopee_wallet_transactions'   AS table_name,
  COUNT(*)                       AS row_count
FROM shopee_wallet_transactions
WHERE created_by = auth.uid()

UNION ALL

SELECT
  'shopee_order_settlements',
  COUNT(*)
FROM shopee_order_settlements
WHERE created_by = auth.uid();


-- -----------------------------------------------------------------------
-- 1. Net Payout รวมตามช่วงวันที่ paid_out_date
--    เปลี่ยน '2026-01-01' / '2026-01-31' ตามต้องการ
-- -----------------------------------------------------------------------
SELECT
  paid_out_date,
  COUNT(*)                               AS order_count,
  SUM(net_payout)                        AS total_net_payout,
  SUM(commission)                        AS total_commission,
  SUM(service_fee)                       AS total_service_fee,
  SUM(payment_processing_fee)            AS total_payment_fee,
  SUM(platform_infra_fee)                AS total_infra_fee,
  SUM(shipping_buyer_paid)               AS total_shipping_buyer,
  SUM(refunds)                           AS total_refunds
FROM shopee_order_settlements
WHERE created_by = auth.uid()
  AND paid_out_date BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY paid_out_date
ORDER BY paid_out_date;

-- Monthly total (2026-01)
SELECT
  SUM(net_payout)   AS total_net_payout_jan2026,
  COUNT(*)          AS settled_orders_jan2026
FROM shopee_order_settlements
WHERE created_by = auth.uid()
  AND paid_out_date BETWEEN '2026-01-01' AND '2026-01-31';


-- -----------------------------------------------------------------------
-- 2. GMV จาก sales_orders เทียบกับ Settlement
--    (ยอดอาจต่างกันได้เพราะ GMV ≠ net_payout)
-- -----------------------------------------------------------------------
SELECT
  DATE_TRUNC('day', so.created_at AT TIME ZONE 'Asia/Bangkok') AS order_day,
  COUNT(DISTINCT so.external_order_id)                          AS so_order_count,
  SUM(so.total_amount)                                          AS so_gmv,
  COUNT(DISTINCT sos.external_order_id)                         AS settled_count,
  SUM(sos.net_payout)                                           AS settled_net_payout
FROM sales_orders so
LEFT JOIN shopee_order_settlements sos
  ON sos.external_order_id = so.external_order_id
  AND sos.created_by       = so.created_by
WHERE so.created_by        = auth.uid()
  AND so.source_platform   = 'shopee'
  AND so.created_at >= '2026-01-01'
  AND so.created_at  < '2026-02-01'
GROUP BY 1
ORDER BY 1;


-- -----------------------------------------------------------------------
-- 3a. Settlements ที่มีใน shopee_order_settlements แต่ไม่มีใน sales_orders
--     (top 20 mismatch)
-- -----------------------------------------------------------------------
SELECT
  sos.external_order_id,
  sos.paid_out_date,
  sos.order_date,
  sos.net_payout
FROM shopee_order_settlements sos
LEFT JOIN sales_orders so
  ON  so.external_order_id = sos.external_order_id
  AND so.source_platform   = 'shopee'
  AND so.created_by        = sos.created_by
WHERE sos.created_by = auth.uid()
  AND so.id IS NULL
ORDER BY sos.paid_out_date DESC
LIMIT 20;


-- -----------------------------------------------------------------------
-- 3b. sales_orders ที่มีใน Shopee แต่ไม่มีใน settlements
--     (order ที่ยังไม่ได้รับเงิน หรือไม่ได้ import settlement)
-- -----------------------------------------------------------------------
SELECT
  so.external_order_id,
  so.created_at AS order_created_at,
  so.order_status,
  SUM(so.total_amount) AS total_amount
FROM sales_orders so
LEFT JOIN shopee_order_settlements sos
  ON  sos.external_order_id = so.external_order_id
  AND sos.source_platform   = 'shopee'
  AND sos.created_by        = so.created_by
WHERE so.created_by      = auth.uid()
  AND so.source_platform = 'shopee'
  AND sos.id IS NULL
GROUP BY so.external_order_id, so.created_at, so.order_status
ORDER BY so.created_at DESC
LIMIT 20;


-- -----------------------------------------------------------------------
-- 4. Wallet transactions summary by type
-- -----------------------------------------------------------------------
SELECT
  transaction_type,
  transaction_mode,
  COUNT(*)          AS txn_count,
  SUM(amount)       AS total_amount,
  MIN(occurred_at)  AS earliest,
  MAX(occurred_at)  AS latest
FROM shopee_wallet_transactions
WHERE created_by = auth.uid()
GROUP BY transaction_type, transaction_mode
ORDER BY ABS(SUM(amount)) DESC;
