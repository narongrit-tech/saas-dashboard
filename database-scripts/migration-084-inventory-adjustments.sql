-- Migration 084: Manual Stock Adjustments
-- ──────────────────────────────────────────────────────────────────────────────
-- Adds inventory_adjustments table for audit-safe up/down stock corrections.
--
-- ADJUST_IN:  creates a new inventory_receipt_layers row (ref_type='ADJUST_IN',
--             unit_cost=0) AND an inventory_adjustments row (layer_id set).
-- ADJUST_OUT: drains existing FIFO receipt layers by reducing qty_remaining,
--             then inserts an inventory_adjustments row (layer_id=NULL because
--             multiple layers may be drained).
--
-- The table is immutable: no UPDATE/DELETE RLS policies → full audit trail.
-- ──────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- 1. Create table
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inventory_adjustments (
  id              UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku_internal    VARCHAR(100)  NOT NULL
                    REFERENCES public.inventory_items(sku_internal),
  adjustment_type VARCHAR(20)   NOT NULL,
  quantity        NUMERIC(12,4) NOT NULL,
  reason          TEXT          NOT NULL,
  adjusted_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  layer_id        UUID
                    REFERENCES public.inventory_receipt_layers(id) ON DELETE SET NULL,
  created_by      UUID          NOT NULL
                    REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT inventory_adjustments_type_valid
    CHECK (adjustment_type IN ('ADJUST_IN', 'ADJUST_OUT')),

  CONSTRAINT inventory_adjustments_quantity_positive
    CHECK (quantity > 0),

  CONSTRAINT inventory_adjustments_reason_nonempty
    CHECK (length(trim(reason)) > 0)
);

COMMENT ON TABLE public.inventory_adjustments IS
  'Audit trail for manual ADJUST_IN / ADJUST_OUT stock corrections. Immutable — no UPDATE/DELETE allowed.';

COMMENT ON COLUMN public.inventory_adjustments.layer_id IS
  'Set for ADJUST_IN (points to the receipt layer created). NULL for ADJUST_OUT (may span multiple layers).';

-- ─────────────────────────────────────────────
-- 2. Row-level security
-- ─────────────────────────────────────────────

ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;

-- Users can see their own adjustments only
CREATE POLICY "Users can view own adjustments"
  ON public.inventory_adjustments
  FOR SELECT
  USING (created_by = auth.uid());

-- Users can create their own adjustments
CREATE POLICY "Users can insert own adjustments"
  ON public.inventory_adjustments
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- No UPDATE or DELETE policies → records are immutable once written

-- ─────────────────────────────────────────────
-- 3. Indexes
-- ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_sku_user
  ON public.inventory_adjustments (created_by, sku_internal, adjusted_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_created
  ON public.inventory_adjustments (created_by, created_at DESC);

-- ─────────────────────────────────────────────
-- 4. Verify
-- ─────────────────────────────────────────────

SELECT
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'inventory_adjustments';
