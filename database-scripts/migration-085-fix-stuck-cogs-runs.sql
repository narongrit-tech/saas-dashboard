-- migration-085: Fix stuck cogs_allocation_runs rows
--
-- Any row with status='running' and no progress written in >10 minutes is considered stale.
-- This migration marks the specific stuck run and any other stale runs as failed
-- so they no longer block new runs or confuse the observability UI.
--
-- IMPORTANT: This is a one-time repair migration. Run via Supabase SQL Editor.
-- The application code (applyCOGSForBatch, applyCOGSMTD) now includes a stale-run
-- auto-fail guard so this situation cannot recur going forward.

-- 1. Fix the specific stuck run identified in the incident report
UPDATE cogs_allocation_runs
SET
  status        = 'failed',
  error_message = 'Retroactively failed by migration-085: run was stuck in status=running with null summary_json and null error_message (likely killed by Vercel function timeout before catch block could execute). New code prevents this by pre-validating orders before creating the run row.',
  updated_at    = now()
WHERE
  id = '197083d1-9a57-4536-b24a-44b549c5836c'
  AND status = 'running';

-- 2. Mark ALL other stale running rows as failed (defensive cleanup)
-- Stale = no activity for >10 minutes (updated_at or created_at older than 10 min)
UPDATE cogs_allocation_runs
SET
  status        = 'failed',
  error_message = 'Retroactively failed by migration-085: stale run with no progress after >10 minutes — likely killed by Vercel function timeout. Run ID and import_batch_id were distinct; run was never completed.',
  updated_at    = now()
WHERE
  status = 'running'
  AND GREATEST(updated_at, created_at) < now() - interval '10 minutes';

-- Verify: should return 0 rows after migration
SELECT id, trigger_source, import_batch_id, status, summary_json, error_message, created_at, updated_at
FROM cogs_allocation_runs
WHERE status = 'running'
ORDER BY created_at DESC;
