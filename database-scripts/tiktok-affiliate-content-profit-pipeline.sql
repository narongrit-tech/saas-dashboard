\if :{?created_by}
SELECT *
FROM public.refresh_content_profit_layer(:'created_by'::uuid);

SELECT
  created_by,
  content_id,
  product_id,
  currency,
  total_orders,
  successful_orders,
  open_orders,
  lost_orders,
  commission_realized,
  total_cost,
  profit,
  roi
FROM public.content_profit_attribution_summary
WHERE created_by = :'created_by'::uuid
ORDER BY profit DESC, commission_realized DESC
LIMIT 50;
\else
SELECT *
FROM public.refresh_content_profit_layer();
\endif
