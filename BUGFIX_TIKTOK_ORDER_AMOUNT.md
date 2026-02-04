# TikTok OrderSKUList - order_financials Order Amount Verification

Use the snippet below to validate a batch import:

```sql
-- Replace :batch with the import_batches.id
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE order_amount IS NULL) AS null_order_amount_rows,
  SUM(COALESCE(order_amount, 0)) AS sum_order_amount
FROM order_financials
WHERE import_batch_id = :batch;
```
