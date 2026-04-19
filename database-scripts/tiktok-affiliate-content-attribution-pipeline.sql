\if :{?batch_id}
SELECT *
FROM public.normalize_tiktok_affiliate_order_batch(:'batch_id'::uuid);

SELECT
  id,
  created_by,
  source_file_name,
  status,
  raw_row_count,
  staged_row_count,
  normalized_row_count,
  skipped_row_count,
  error_count,
  metadata
FROM public.tiktok_affiliate_import_batches
WHERE id = :'batch_id'::uuid;
\else
\echo Usage: psql $env:DATABASE_URL -v batch_id="'<batch_uuid>'" -f database-scripts/tiktok-affiliate-content-attribution-pipeline.sql
\quit 1
\endif
