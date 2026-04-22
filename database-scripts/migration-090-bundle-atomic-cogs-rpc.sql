-- migration-090: Atomic bundle COGS allocation RPC (FIFO)
-- ============================================================================
-- PROBLEM
--   _allocateBundleOrderCOGS calls allocate_cogs_fifo per-component sequentially.
--   Each call is its own transaction. If component 1 succeeds but component 2 fails,
--   component 1's allocation row stays committed — partial state (e.g. NEWONN001
--   allocated but NEWONN002 missing). No automatic rollback occurs.
--
-- SOLUTION
--   allocate_cogs_bundle_fifo: single plpgsql function = single Postgres transaction.
--   All component allocations write, or NONE write (automatic rollback on exception).
--
--   Steps inside the transaction:
--     1. Auth + order ownership guard
--     2. Full idempotency check — all components done → return already_allocated
--     3. Partial state cleanup — some done → restore qty_remaining + delete stale rows
--     4. Pre-validation — check each component has sufficient qty_remaining
--        so we surface a clear SKU-level error before any write occurs
--     5. FIFO allocation for all components (atomic)
--
-- CALLER
--   TypeScript _allocateBundleOrderCOGS (actions.ts) — FIFO path only.
--   AVG path continues using per-component allocate_cogs_avg (unchanged).
--
-- Run in Supabase SQL Editor as postgres/superuser.
-- ============================================================================


CREATE OR REPLACE FUNCTION public.allocate_cogs_bundle_fifo(
  p_order_id   uuid,
  p_components jsonb,        -- [{sku: text, qty: numeric}, ...]
  p_shipped_at timestamptz,
  p_user_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_comp         jsonb;
  v_sku          text;
  v_qty          numeric;
  v_remaining    numeric;
  v_layer        record;
  v_qty_to_alloc numeric;
  v_amount       numeric;
  v_layer_count  int;
  v_done_count   int := 0;
  v_total_count  int;
  v_available    numeric;
  v_allocated    jsonb := '[]'::jsonb;
BEGIN
  -- ── 1. Auth guard ─────────────────────────────────────────────────────────────
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden: caller mismatch';
  END IF;

  -- ── 2. Input guards ───────────────────────────────────────────────────────────
  IF p_components IS NULL OR jsonb_array_length(p_components) = 0 THEN
    RAISE EXCEPTION 'invalid_input: no components provided';
  END IF;

  v_total_count := jsonb_array_length(p_components);

  -- ── 3. Order ownership guard ──────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_orders
    WHERE id = p_order_id AND created_by = auth.uid()
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'forbidden: order not owned by caller';
  END IF;

  -- ── 4. Full idempotency check ─────────────────────────────────────────────────
  -- Count distinct component SKUs that already have a non-reversal allocation row.
  SELECT COUNT(DISTINCT sku_internal)
  INTO v_done_count
  FROM public.inventory_cogs_allocations
  WHERE order_id    = p_order_id
    AND is_reversal = false
    AND created_by  = auth.uid()
    AND sku_internal IN (
      SELECT elem->>'sku'
      FROM jsonb_array_elements(p_components) AS elem
    );

  IF v_done_count = v_total_count THEN
    RETURN jsonb_build_object('status', 'already_allocated');
  END IF;

  -- ── 5. Partial state cleanup ──────────────────────────────────────────────────
  -- A previous run may have committed some component rows before failing.
  -- Restore qty_remaining and delete those stale rows so step 7 starts clean.
  -- This happens atomically inside this same transaction.
  IF v_done_count > 0 THEN
    FOR v_comp IN SELECT * FROM jsonb_array_elements(p_components) LOOP
      v_sku := v_comp->>'sku';

      -- Restore qty_remaining on each receipt layer that was consumed by a stale row
      UPDATE public.inventory_receipt_layers rl
      SET qty_remaining = qty_remaining + ca.qty
      FROM public.inventory_cogs_allocations ca
      WHERE ca.order_id    = p_order_id
        AND ca.sku_internal = v_sku
        AND ca.is_reversal  = false
        AND ca.created_by   = auth.uid()
        AND ca.layer_id     IS NOT NULL
        AND rl.id           = ca.layer_id;

      -- Delete the stale partial allocation rows
      DELETE FROM public.inventory_cogs_allocations
      WHERE order_id    = p_order_id
        AND sku_internal = v_sku
        AND is_reversal  = false
        AND created_by   = auth.uid();
    END LOOP;
  END IF;

  -- ── 6. Pre-validation: all components must have sufficient stock ──────────────
  -- Checked BEFORE any writes so we get a clear per-SKU error with zero partial writes.
  FOR v_comp IN SELECT * FROM jsonb_array_elements(p_components) LOOP
    v_sku := v_comp->>'sku';
    v_qty := (v_comp->>'qty')::numeric;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'invalid_qty: component % qty must be > 0', v_sku;
    END IF;

    SELECT COALESCE(SUM(qty_remaining), 0)
    INTO v_available
    FROM public.inventory_receipt_layers
    WHERE sku_internal = v_sku
      AND created_by   = auth.uid()
      AND is_voided    = false
      AND qty_remaining > 0;

    IF v_available < v_qty THEN
      RAISE EXCEPTION 'insufficient_stock:% available=% required=%', v_sku, v_available, v_qty;
    END IF;
  END LOOP;

  -- ── 7. Allocate all components (atomic) ──────────────────────────────────────
  -- Any exception here rolls back all prior INSERTs/UPDATEs in this function.
  FOR v_comp IN SELECT * FROM jsonb_array_elements(p_components) LOOP
    v_sku         := v_comp->>'sku';
    v_qty         := (v_comp->>'qty')::numeric;
    v_remaining   := v_qty;
    v_layer_count := 0;

    FOR v_layer IN
      SELECT id, qty_remaining, unit_cost
      FROM public.inventory_receipt_layers
      WHERE sku_internal = v_sku
        AND created_by   = auth.uid()
        AND is_voided    = false
        AND qty_remaining > 0
      ORDER BY received_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_qty_to_alloc := LEAST(v_remaining, v_layer.qty_remaining);
      v_amount       := v_qty_to_alloc * v_layer.unit_cost;

      INSERT INTO public.inventory_cogs_allocations (
        order_id, sku_internal, shipped_at, method,
        qty, unit_cost_used, amount, layer_id, is_reversal, created_by
      ) VALUES (
        p_order_id, v_sku, p_shipped_at, 'FIFO',
        v_qty_to_alloc, v_layer.unit_cost, v_amount, v_layer.id, false, auth.uid()
      );

      UPDATE public.inventory_receipt_layers
      SET qty_remaining = qty_remaining - v_qty_to_alloc
      WHERE id = v_layer.id;

      v_remaining   := v_remaining - v_qty_to_alloc;
      v_layer_count := v_layer_count + 1;
    END LOOP;

    -- Belt-and-suspenders: pre-validation passed but a concurrent transaction may
    -- have drained layers between steps 6 and 7 (FOR UPDATE serializes them).
    -- Raising here triggers automatic rollback of all writes in this function.
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'insufficient_stock:% available=% required=%',
        v_sku, (v_qty - v_remaining), v_qty;
    END IF;

    v_allocated := v_allocated || jsonb_build_array(v_sku);
  END LOOP;

  RETURN jsonb_build_object(
    'status',              'success',
    'allocated_components', v_allocated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_cogs_bundle_fifo(uuid, jsonb, timestamptz, uuid)
  TO authenticated;


-- ── Verify ───────────────────────────────────────────────────────────────────────
SELECT
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  CASE p.prosecdef WHEN true THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'allocate_cogs_bundle_fifo';
