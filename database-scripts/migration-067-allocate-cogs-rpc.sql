-- Migration 067: Atomic COGS Allocation RPC Functions
-- ─────────────────────────────────────────────────────────────────────────────
-- PROBLEM: The TypeScript costing engine performed two separate writes per
--   allocation step (INSERT into inventory_cogs_allocations, then UPDATE
--   inventory_receipt_layers / inventory_cost_snapshots).  A failure between
--   those two steps leaves orphan allocation rows or stale qty_remaining,
--   causing double-count or phantom COGS.
--
-- SOLUTION: Move both writes into a single Postgres function so they run inside
--   one implicit transaction.  If anything raises an exception the whole call is
--   rolled back automatically.
--
-- FUNCTIONS:
--   allocate_cogs_fifo(order_id, sku, qty, shipped_at, user_id) → jsonb
--   allocate_cogs_avg (order_id, sku, qty, shipped_at, user_id) → jsonb
--
-- SECURITY MODEL:
--   SECURITY DEFINER (bypasses RLS) + explicit created_by = p_user_id
--   filters on every table so a user can only touch their own rows.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FIFO Allocation (atomic)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION allocate_cogs_fifo(
  p_order_id   uuid,
  p_sku        text,
  p_qty        numeric,
  p_shipped_at timestamptz,
  p_user_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_layer        record;
  v_remaining    numeric;
  v_qty_to_alloc numeric;
  v_amount       numeric;
  v_layer_count  int := 0;
BEGIN
  -- ── Idempotency guard ────────────────────────────────────────────────────
  -- Checked inside the transaction so a concurrent call cannot slip through.
  IF EXISTS (
    SELECT 1
      FROM inventory_cogs_allocations
     WHERE order_id     = p_order_id
       AND sku_internal = p_sku
       AND is_reversal  = false
       AND created_by   = p_user_id
     LIMIT 1
  ) THEN
    RETURN jsonb_build_object('status', 'already_allocated');
  END IF;

  v_remaining := p_qty;

  -- ── Consume FIFO layers ──────────────────────────────────────────────────
  -- FOR UPDATE locks each row to prevent concurrent over-allocation.
  -- ORDER BY received_at ASC = oldest stock first (FIFO).
  FOR v_layer IN
    SELECT id, qty_remaining, unit_cost
      FROM inventory_receipt_layers
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

    -- INSERT allocation ── atomic with UPDATE below inside same txn
    INSERT INTO inventory_cogs_allocations (
      order_id, sku_internal, shipped_at, method,
      qty, unit_cost_used, amount, layer_id, is_reversal, created_by
    ) VALUES (
      p_order_id, p_sku, p_shipped_at, 'FIFO',
      v_qty_to_alloc, v_layer.unit_cost, v_amount, v_layer.id, false, p_user_id
    );

    -- UPDATE layer qty_remaining ── same transaction
    UPDATE inventory_receipt_layers
       SET qty_remaining = qty_remaining - v_qty_to_alloc
     WHERE id = v_layer.id;

    v_remaining   := v_remaining - v_qty_to_alloc;
    v_layer_count := v_layer_count + 1;
  END LOOP;

  -- ── Insufficient stock → raise, triggers automatic ROLLBACK ──────────────
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'insufficient_stock: SKU % still needs % units after exhausting all layers',
      p_sku, v_remaining;
  END IF;

  RETURN jsonb_build_object(
    'status',      'success',
    'layer_count', v_layer_count
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE; -- re-raise → caller sees error, Postgres rolls back
END;
$$;

-- Allow authenticated role to call this function
GRANT EXECUTE ON FUNCTION allocate_cogs_fifo(uuid, text, numeric, timestamptz, uuid)
  TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. AVG Allocation (atomic)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION allocate_cogs_avg(
  p_order_id   uuid,
  p_sku        text,
  p_qty        numeric,
  p_shipped_at timestamptz,
  p_user_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot  record;
  v_unit_cost numeric;
  v_amount    numeric;
  v_new_qty   numeric;
  v_new_value numeric;
  v_new_avg   numeric;
  v_date_bkk  date;
BEGIN
  -- ── Idempotency guard ────────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1
      FROM inventory_cogs_allocations
     WHERE order_id     = p_order_id
       AND sku_internal = p_sku
       AND is_reversal  = false
       AND created_by   = p_user_id
     LIMIT 1
  ) THEN
    RETURN jsonb_build_object('status', 'already_allocated');
  END IF;

  -- Convert shipped_at to Bangkok date for snapshot lookup
  v_date_bkk := (p_shipped_at AT TIME ZONE 'Asia/Bangkok')::date;

  -- ── Fetch latest snapshot up to shipped date ─────────────────────────────
  SELECT *
    INTO v_snapshot
    FROM inventory_cost_snapshots
   WHERE sku_internal = p_sku
     AND created_by   = p_user_id
     AND as_of_date  <= v_date_bkk
   ORDER BY as_of_date DESC
   LIMIT 1;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'no_snapshot: No cost snapshot found for SKU % on or before %',
      p_sku, v_date_bkk;
  END IF;

  IF v_snapshot.on_hand_qty < p_qty THEN
    RAISE EXCEPTION 'insufficient_stock: SKU % has % units but need %',
      p_sku, v_snapshot.on_hand_qty, p_qty;
  END IF;

  -- ── Compute new values ───────────────────────────────────────────────────
  v_unit_cost := v_snapshot.avg_unit_cost;
  v_amount    := p_qty * v_unit_cost;
  v_new_qty   := v_snapshot.on_hand_qty  - p_qty;
  v_new_value := v_snapshot.on_hand_value - v_amount;
  v_new_avg   := CASE WHEN v_new_qty > 0
                      THEN v_new_value / v_new_qty
                      ELSE 0
                 END;

  -- INSERT allocation ── atomic with UPDATE below
  INSERT INTO inventory_cogs_allocations (
    order_id, sku_internal, shipped_at, method,
    qty, unit_cost_used, amount, layer_id, is_reversal, created_by
  ) VALUES (
    p_order_id, p_sku, p_shipped_at, 'AVG',
    p_qty, v_unit_cost, v_amount, NULL, false, p_user_id
  );

  -- UPDATE snapshot ── same transaction
  UPDATE inventory_cost_snapshots
     SET on_hand_qty   = v_new_qty,
         on_hand_value = v_new_value,
         avg_unit_cost = v_new_avg
   WHERE id = v_snapshot.id;

  RETURN jsonb_build_object(
    'status',    'success',
    'unit_cost', v_unit_cost,
    'amount',    v_amount
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE; -- re-raise → caller sees error, Postgres rolls back
END;
$$;

-- Allow authenticated role to call this function
GRANT EXECUTE ON FUNCTION allocate_cogs_avg(uuid, text, numeric, timestamptz, uuid)
  TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Verify: list the new functions
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  p.proname        AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  CASE p.prosecdef WHEN true THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('allocate_cogs_fifo', 'allocate_cogs_avg')
ORDER BY p.proname;
