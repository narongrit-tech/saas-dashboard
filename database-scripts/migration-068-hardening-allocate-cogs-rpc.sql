-- migration-068-hardening-allocate-cogs-rpc.sql

CREATE OR REPLACE FUNCTION public.allocate_cogs_fifo(
  p_order_id uuid,
  p_sku text,
  p_qty numeric,
  p_shipped_at timestamptz,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_layer        record;
  v_remaining    numeric;
  v_qty_to_alloc numeric;
  v_amount       numeric;
  v_layer_count  int := 0;
BEGIN
  -- ✅ Caller guard
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden: caller mismatch';
  END IF;

  -- ✅ Basic input guard
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'invalid_qty: qty must be > 0';
  END IF;

  -- ✅ Order ownership guard (เลือก table ที่เป็น source of truth ของ order ในระบบคุณ)
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_orders
    WHERE order_id = p_order_id AND created_by = auth.uid()
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'forbidden: order not owned by caller';
  END IF;

  -- Idempotency guard (ยังโอเค)
  IF EXISTS (
    SELECT 1
    FROM public.inventory_cogs_allocations
    WHERE order_id = p_order_id
      AND sku_internal = p_sku
      AND is_reversal = false
      AND created_by = auth.uid()
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('status', 'already_allocated');
  END IF;

  v_remaining := p_qty;

  FOR v_layer IN
    SELECT id, qty_remaining, unit_cost
    FROM public.inventory_receipt_layers
    WHERE sku_internal = p_sku
      AND created_by = auth.uid()
      AND is_voided = false
      AND qty_remaining > 0
    ORDER BY received_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_qty_to_alloc := LEAST(v_remaining, v_layer.qty_remaining);
    v_amount := v_qty_to_alloc * v_layer.unit_cost;

    INSERT INTO public.inventory_cogs_allocations (
      order_id, sku_internal, shipped_at, method,
      qty, unit_cost_used, amount, layer_id, is_reversal, created_by
    ) VALUES (
      p_order_id, p_sku, p_shipped_at, 'FIFO',
      v_qty_to_alloc, v_layer.unit_cost, v_amount, v_layer.id, false, auth.uid()
    );

    UPDATE public.inventory_receipt_layers
    SET qty_remaining = qty_remaining - v_qty_to_alloc
    WHERE id = v_layer.id;

    v_remaining := v_remaining - v_qty_to_alloc;
    v_layer_count := v_layer_count + 1;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'insufficient_stock: SKU % still needs %', p_sku, v_remaining;
  END IF;

  RETURN jsonb_build_object('status','success','layer_count',v_layer_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_cogs_avg(
  p_order_id uuid,
  p_sku text,
  p_qty numeric,
  p_shipped_at timestamptz,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
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
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden: caller mismatch';
  END IF;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'invalid_qty: qty must be > 0';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sales_orders
    WHERE order_id = p_order_id AND created_by = auth.uid()
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'forbidden: order not owned by caller';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_cogs_allocations
    WHERE order_id = p_order_id
      AND sku_internal = p_sku
      AND is_reversal = false
      AND created_by = auth.uid()
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('status', 'already_allocated');
  END IF;

  v_date_bkk := (p_shipped_at AT TIME ZONE 'Asia/Bangkok')::date;

  -- ✅ Lock snapshot row to avoid concurrent update races
  SELECT *
  INTO v_snapshot
  FROM public.inventory_cost_snapshots
  WHERE sku_internal = p_sku
    AND created_by = auth.uid()
    AND as_of_date <= v_date_bkk
  ORDER BY as_of_date DESC
  LIMIT 1
  FOR UPDATE;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'no_snapshot: SKU % on/before %', p_sku, v_date_bkk;
  END IF;

  IF v_snapshot.on_hand_qty < p_qty THEN
    RAISE EXCEPTION 'insufficient_stock: SKU % has % need %',
      p_sku, v_snapshot.on_hand_qty, p_qty;
  END IF;

  v_unit_cost := v_snapshot.avg_unit_cost;
  v_amount := p_qty * v_unit_cost;
  v_new_qty := v_snapshot.on_hand_qty - p_qty;
  v_new_value := v_snapshot.on_hand_value - v_amount;
  v_new_avg := CASE WHEN v_new_qty > 0 THEN v_new_value / v_new_qty ELSE 0 END;

  INSERT INTO public.inventory_cogs_allocations (
    order_id, sku_internal, shipped_at, method,
    qty, unit_cost_used, amount, layer_id, is_reversal, created_by
  ) VALUES (
    p_order_id, p_sku, p_shipped_at, 'AVG',
    p_qty, v_unit_cost, v_amount, NULL, false, auth.uid()
  );

  UPDATE public.inventory_cost_snapshots
  SET on_hand_qty = v_new_qty,
      on_hand_value = v_new_value,
      avg_unit_cost = v_new_avg
  WHERE id = v_snapshot.id;

  RETURN jsonb_build_object('status','success','unit_cost',v_unit_cost,'amount',v_amount);
END;
$$;