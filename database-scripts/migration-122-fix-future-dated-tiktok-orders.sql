-- migration-122: Fix 570 future-dated TikTok orders from import batch c9f0c21f
-- Root cause: parseDate() in tiktok-sales-orders.ts used new Date("07/04/2026")
--   which JavaScript parsed as MM/DD (July 4) instead of DD/MM (April 7).
--   Only affected orders where the day component was ≤ 12 (ambiguous with month).
-- Fix: swap stored month ↔ day, then re-interpret the time as Bangkok local → correct UTC.
-- Applied 2026-06-23.

UPDATE sales_orders
SET order_date = MAKE_TIMESTAMPTZ(
    EXTRACT(YEAR   FROM order_date AT TIME ZONE 'UTC')::int,
    EXTRACT(DAY    FROM order_date AT TIME ZONE 'UTC')::int,   -- new month = stored day (was original MM)
    EXTRACT(MONTH  FROM order_date AT TIME ZONE 'UTC')::int,   -- new day   = stored month (was original DD)
    EXTRACT(HOUR   FROM order_date AT TIME ZONE 'UTC')::int,
    EXTRACT(MINUTE FROM order_date AT TIME ZONE 'UTC')::int,
    EXTRACT(SECOND FROM order_date AT TIME ZONE 'UTC')::float,
    'Asia/Bangkok'
),
updated_at = NOW()
WHERE import_batch_id = 'c9f0c21f-db78-4f7f-91d0-e5356354e48a'
  AND order_date > NOW();

-- Expected: 570 rows updated (0 remaining after fix)
