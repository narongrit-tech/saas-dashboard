-- Migration 112: Workspace owner consolidation
-- ============================================================================
-- PROBLEM (May 2026)
--   Multiple Supabase users (auth.users) operate as ONE business workspace.
--   When user A (Nawapan, assistant) runs an import, rows land with
--   created_by = A. When user B (Narongrit, primary) later runs COGS,
--   allocate_cogs_fifo / allocate_cogs_bundle_fifo raises
--     "forbidden: order not owned by caller"
--   because the ownership guard is created_by = auth.uid(). Result:
--   thousands of Mar–Apr 2026 orders silently failed allocation.
--
-- SOLUTION
--   (1) workspace_owner_map: maps each delegate user_id to the primary owner.
--   (2) BEFORE INSERT trigger on key writeable tables that rewrites
--       NEW.created_by from delegate → primary at write time, so all rows
--       always carry the primary owner regardless of which account inserted.
--
--   Existing mismatched data is fixed separately (one-time UPDATEs).
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================


-- ── 1. Mapping table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_owner_map (
  delegate_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  primary_user_id  uuid NOT NULL    REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at       timestamptz DEFAULT now(),
  notes            text
);

COMMENT ON TABLE  public.workspace_owner_map IS
  'Maps delegate auth users → primary workspace owner. INSERTs by a delegate are rewritten to primary via trigger so all rows in a workspace share one created_by.';

COMMENT ON COLUMN public.workspace_owner_map.delegate_user_id IS
  'auth.users.id of an assistant/team member who imports on behalf of the primary owner.';
COMMENT ON COLUMN public.workspace_owner_map.primary_user_id IS
  'auth.users.id that owns the workspace data (inventory, COGS, P&L).';

-- Seed: Nawapan → Narongrit (NIMITT MIND MARKETING)
INSERT INTO public.workspace_owner_map (delegate_user_id, primary_user_id, notes)
VALUES (
  'd610cdb5-508e-48d6-99bc-bd6f3fd7c535',  -- nawapan@nimittmind.com
  '2c4e254d-c779-4f8a-af93-603dc26e6af0',  -- narongrit@nimittmind.com
  'Nawapan = import assistant for Narongrit workspace'
)
ON CONFLICT (delegate_user_id) DO UPDATE
  SET primary_user_id = EXCLUDED.primary_user_id,
      notes           = EXCLUDED.notes;

-- Read-only by users; service role manages.
ALTER TABLE public.workspace_owner_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_owner_map_read ON public.workspace_owner_map;
CREATE POLICY workspace_owner_map_read
  ON public.workspace_owner_map
  FOR SELECT
  TO authenticated
  USING (
    delegate_user_id = auth.uid()
    OR primary_user_id  = auth.uid()
  );


-- ── 2. Helper: resolve primary owner for a given user ────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_primary_owner(p_user uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT primary_user_id
       FROM public.workspace_owner_map
      WHERE delegate_user_id = p_user
      LIMIT 1),
    p_user
  );
$$;

GRANT EXECUTE ON FUNCTION public.resolve_primary_owner(uuid) TO authenticated;


-- ── 3. Trigger function: rewrite NEW.created_by → primary on insert ──────────
CREATE OR REPLACE FUNCTION public.rewrite_created_by_to_primary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_primary uuid;
BEGIN
  IF NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT primary_user_id
    INTO v_primary
    FROM public.workspace_owner_map
   WHERE delegate_user_id = NEW.created_by
   LIMIT 1;

  IF v_primary IS NOT NULL AND v_primary <> NEW.created_by THEN
    NEW.created_by := v_primary;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.rewrite_created_by_to_primary() IS
  'BEFORE INSERT trigger: if NEW.created_by is a delegate, replace it with the primary workspace owner.';


-- ── 4. Attach trigger to tables that have created_by + multi-user import path
--     Add/remove tables here as the schema evolves. Idempotent via DROP IF EXISTS.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t_name text;
BEGIN
  FOREACH t_name IN ARRAY ARRAY[
    'sales_orders',
    'settlement_transactions',
    'import_batches',
    'expenses',
    'bank_transactions',
    'wallet_transactions',
    'wallet_topups',
    'ad_daily_performance',
    'inventory_items',
    'inventory_receipt_layers',
    'inventory_cogs_allocations',
    'inventory_bundle_recipes',
    'inventory_cost_snapshots',
    'inventory_cogs_runs',
    'inventory_adjustments',
    'returns',
    'return_items',
    'reconciliation_records',
    'video_master',
    'video_master_v2'
  ]
  LOOP
    -- Only attach if the table actually has a created_by column
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = t_name
         AND column_name  = 'created_by'
    ) THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_rewrite_owner_to_primary ON public.%I;', t_name
      );
      EXECUTE format($f$
        CREATE TRIGGER trg_rewrite_owner_to_primary
        BEFORE INSERT ON public.%I
        FOR EACH ROW
        EXECUTE FUNCTION public.rewrite_created_by_to_primary();
      $f$, t_name);
      RAISE NOTICE 'attached trigger to %', t_name;
    ELSE
      RAISE NOTICE 'skipped % (no created_by column)', t_name;
    END IF;
  END LOOP;
END $$;


-- ── 5. Verify ────────────────────────────────────────────────────────────────
-- Show triggers + mapping
SELECT event_object_table AS table_name, trigger_name
  FROM information_schema.triggers
 WHERE trigger_name = 'trg_rewrite_owner_to_primary'
   AND trigger_schema = 'public'
 ORDER BY event_object_table;

SELECT delegate_user_id, primary_user_id, notes
  FROM public.workspace_owner_map;
