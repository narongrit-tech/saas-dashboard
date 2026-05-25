-- Migration 115: Service-role COGS allocation RPCs
-- ============================================================================
-- PROBLEM
--   allocate_cogs_fifo and allocate_cogs_bundle_fifo check auth.uid() for
--   the caller guard. When called via service role key (e.g. from a CLI
--   import script), auth.uid() returns NULL → 'forbidden: caller mismatch'.
--
-- SOLUTION
--   Admin variants that accept p_user_id and skip the auth.uid() check.
--   These are ONLY granted to service_role (never to authenticated).
--   All ownership checks and idempotency guards still use p_user_id.
-- ============================================================================


-- ── 1. allocate_cogs_fifo_admin ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allocate_cogs_fifo_admin(
  p_order_id   uuid,
  p_sku        text,
  p_qty        numeric,
  p_shipped_at timestamptz,
  p_user_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_layer        record;
  v_remaining    numeric;
  v_qty_to_alloc numeric;
  v_amount       numeric;
  v_layer_count  int := 0;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'invalid_qty: qty must be > 0';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sales_orders
    WHERE id = p_order_id AND created_by = p_user_id
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'forbidden: order not owned by user %', p_user_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_cogs_allocations
    WHERE order_id     = p_order_id
      AND sku_internal = p_sku
      AND is_reversal  = false
      AND created_by   = p_user_id
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('status', 'already_allocated');
  END IF;

  v_remaining := p_qty;

  FOR v_layer IN
    SELECT id, qty_remaining, unit_cost
    FROM public.inventory_receipt_layers
    WHERE sku_internal = p_sku
      AND created_by   = p_user_id
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
      p_order_id, p_sku, p_shipped_at, 'FIFO',
      v_qty_to_alloc, v_layer.unit_cost, v_amount, v_layer.id, false, p_user_id
    );

    UPDATE public.inventory_receipt_layers
    SET qty_remaining = qty_remaining - v_qty_to_alloc
    WHERE id = v_layer.id;

    v_remaining   := v_remaining - v_qty_to_alloc;
    v_layer_count := v_layer_count + 1;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'insufficient_stock: SKU % still needs % units', p_sku, v_remaining;
  END IF;

  RETURN jsonb_build_object('status', 'success', 'layer_count', v_layer_count);
END;
$$;

-- Only service_role may call this — never expose to authenticated users
GRANT EXECUTE ON FUNCTION public.allocate_cogs_fifo_admin(uuid, text, numeric, timestamptz, uuid)
  TO service_role;


-- ── 2. allocate_cogs_bundle_fifo_admin ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allocate_cogs_bundle_fifo_admin(
  p_order_id   uuid,
  p_components jsonb,        -- [{sku: text, qty: numeric}, ...]
  p_shipped_at timestamptz,
  p_user_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  IF p_components IS NULL OR jsonb_array_length(p_components) = 0 THEN
    RAISE EXCEPTION 'invalid_input: no components provided';
  END IF;

  v_total_count := jsonb_array_length(p_components);

  IF NOT EXISTS (
    SELECT 1 FROM public.sales_orders
    WHERE id = p_order_id AND created_by = p_user_id
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'forbidden: order not owned by user %', p_user_id;
  END IF;

  -- Full idempotency check
  SELECT COUNT(DISTINCT sku_internal)
  INTO v_done_count
  FROM public.inventory_cogs_allocations
  WHERE order_id    = p_order_id
    AND is_reversal = false
    AND created_by  = p_user_id
    AND sku_internal IN (
      SELECT elem->>'sku'
      FROM jsonb_array_elements(p_components) AS elem
    );

  IF v_done_count = v_total_count THEN
    RETURN jsonb_build_object('status', 'already_allocated');
  END IF;

  -- Partial state cleanup
  IF v_done_count > 0 THEN
    FOR v_comp IN SELECT * FROM jsonb_array_elements(p_components) LOOP
      v_sku := v_comp->>'sku';

      UPDATE public.inventory_receipt_layers rl
      SET qty_remaining = qty_remaining + ca.qty
      FROM public.inventory_cogs_allocations ca
      WHERE ca.order_id    = p_order_id
        AND ca.sku_internal = v_sku
        AND ca.is_reversal  = false
        AND ca.created_by   = p_user_id
        AND ca.layer_id     IS NOT NULL
        AND rl.id           = ca.layer_id;

      DELETE FROM public.inventory_cogs_allocations
      WHERE order_id    = p_order_id
        AND sku_internal = v_sku
        AND is_reversal  = false
        AND created_by   = p_user_id;
    END LOOP;
  END IF;

  -- Pre-validation
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
      AND created_by   = p_user_id
      AND is_voided    = false
      AND qty_remaining > 0;

    IF v_available < v_qty THEN
      RAISE EXCEPTION 'insufficient_stock:% available=% required=%', v_sku, v_available, v_qty;
    END IF;
  END LOOP;

  -- Allocate all components (atomic)
  FOR v_comp IN SELECT * FROM jsonb_array_elements(p_components) LOOP
    v_sku         := v_comp->>'sku';
    v_qty         := (v_comp->>'qty')::numeric;
    v_remaining   := v_qty;
    v_layer_count := 0;

    FOR v_layer IN
      SELECT id, qty_remaining, unit_cost
      FROM public.inventory_receipt_layers
      WHERE sku_internal = v_sku
        AND created_by   = p_user_id
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
        v_qty_to_alloc, v_layer.unit_cost, v_amount, v_layer.id, false, p_user_id
      );

      UPDATE public.inventory_receipt_layers
      SET qty_remaining = qty_remaining - v_qty_to_alloc
      WHERE id = v_layer.id;

      v_remaining   := v_remaining - v_qty_to_alloc;
      v_layer_count := v_layer_count + 1;
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'insufficient_stock:% available=% required=%',
        v_sku, (v_qty - v_remaining), v_qty;
    END IF;

    v_allocated := v_allocated || jsonb_build_array(v_sku);
  END LOOP;

  RETURN jsonb_build_object(
    'status',               'success',
    'allocated_components', v_allocated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_cogs_bundle_fifo_admin(uuid, jsonb, timestamptz, uuid)
  TO service_role;


-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  CASE p.prosecdef WHEN true THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('allocate_cogs_fifo_admin', 'allocate_cogs_bundle_fifo_admin')
ORDER BY p.proname;
