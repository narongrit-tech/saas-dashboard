-- ============================================
-- Migration 033: Inventory Costing Engine (FIFO + Moving Average)
-- Description: Add tables for inventory costing, COGS calculation, bundles, and returns
-- Date: 2026-01-30
-- ============================================

-- ============================================
-- TABLE: inventory_items
-- Description: Master list of SKUs (internal) with base cost and bundle flag
-- ============================================

CREATE TABLE IF NOT EXISTS public.inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku_internal VARCHAR(100) UNIQUE NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    base_cost_per_unit DECIMAL(12, 2) NOT NULL DEFAULT 0,
    is_bundle BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT inventory_items_base_cost_non_negative CHECK (base_cost_per_unit >= 0)
);

COMMENT ON TABLE public.inventory_items IS 'Master product list for inventory costing';
COMMENT ON COLUMN public.inventory_items.sku_internal IS 'Internal SKU code (unique identifier)';
COMMENT ON COLUMN public.inventory_items.base_cost_per_unit IS 'Default/base cost per unit (used as fallback)';
COMMENT ON COLUMN public.inventory_items.is_bundle IS 'True if this SKU is a bundle of other SKUs';

-- Index
CREATE INDEX IF NOT EXISTS idx_inventory_items_sku_internal
ON public.inventory_items(sku_internal);

CREATE INDEX IF NOT EXISTS idx_inventory_items_is_bundle
ON public.inventory_items(is_bundle)
WHERE is_bundle = true;

-- ============================================
-- TABLE: inventory_bundle_components
-- Description: Define which SKUs are in a bundle and their quantities
-- ============================================

CREATE TABLE IF NOT EXISTS public.inventory_bundle_components (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bundle_sku VARCHAR(100) NOT NULL REFERENCES public.inventory_items(sku_internal) ON DELETE CASCADE,
    component_sku VARCHAR(100) NOT NULL REFERENCES public.inventory_items(sku_internal) ON DELETE CASCADE,
    quantity DECIMAL(12, 4) NOT NULL DEFAULT 1,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT inventory_bundle_components_quantity_positive CHECK (quantity > 0),
    CONSTRAINT inventory_bundle_components_no_self_reference CHECK (bundle_sku != component_sku)
);

COMMENT ON TABLE public.inventory_bundle_components IS 'Bundle recipe: which components make up a bundle';
COMMENT ON COLUMN public.inventory_bundle_components.bundle_sku IS 'The bundle SKU';
COMMENT ON COLUMN public.inventory_bundle_components.component_sku IS 'The component SKU (part of the bundle)';
COMMENT ON COLUMN public.inventory_bundle_components.quantity IS 'How many units of component per bundle unit';

-- Index
CREATE INDEX IF NOT EXISTS idx_bundle_components_bundle_sku
ON public.inventory_bundle_components(bundle_sku);

CREATE INDEX IF NOT EXISTS idx_bundle_components_component_sku
ON public.inventory_bundle_components(component_sku);

-- Unique constraint: one component per bundle only once
CREATE UNIQUE INDEX IF NOT EXISTS idx_bundle_components_unique
ON public.inventory_bundle_components(bundle_sku, component_sku);

-- ============================================
-- TABLE: inventory_receipt_layers (FIFO Method)
-- Description: Track inventory receipts as layers (FIFO allocation)
-- ============================================

CREATE TABLE IF NOT EXISTS public.inventory_receipt_layers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku_internal VARCHAR(100) NOT NULL REFERENCES public.inventory_items(sku_internal) ON DELETE CASCADE,
    received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    qty_received DECIMAL(12, 4) NOT NULL,
    qty_remaining DECIMAL(12, 4) NOT NULL,
    unit_cost DECIMAL(12, 2) NOT NULL,
    ref_type VARCHAR(50) NOT NULL, -- 'OPENING_BALANCE', 'PURCHASE', 'ADJUSTMENT', 'RETURN'
    ref_id UUID, -- Reference to source document (nullable)
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT receipt_layers_qty_received_positive CHECK (qty_received > 0),
    CONSTRAINT receipt_layers_qty_remaining_non_negative CHECK (qty_remaining >= 0),
    CONSTRAINT receipt_layers_qty_remaining_lte_received CHECK (qty_remaining <= qty_received),
    CONSTRAINT receipt_layers_unit_cost_non_negative CHECK (unit_cost >= 0)
);

COMMENT ON TABLE public.inventory_receipt_layers IS 'FIFO layers: track inventory receipts and remaining qty';
COMMENT ON COLUMN public.inventory_receipt_layers.received_at IS 'Timestamp when inventory was received (Bangkok TZ)';
COMMENT ON COLUMN public.inventory_receipt_layers.qty_remaining IS 'Quantity still available for allocation (reduced as sold)';
COMMENT ON COLUMN public.inventory_receipt_layers.ref_type IS 'Source type: OPENING_BALANCE, PURCHASE, ADJUSTMENT, RETURN';

-- Indexes for FIFO allocation (order by received_at)
CREATE INDEX IF NOT EXISTS idx_receipt_layers_sku_received
ON public.inventory_receipt_layers(sku_internal, received_at);

CREATE INDEX IF NOT EXISTS idx_receipt_layers_ref
ON public.inventory_receipt_layers(ref_type, ref_id)
WHERE ref_id IS NOT NULL;

-- ============================================
-- TABLE: inventory_cost_snapshots (Moving Average Method)
-- Description: Track average cost per SKU as of specific dates
-- ============================================

CREATE TABLE IF NOT EXISTS public.inventory_cost_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku_internal VARCHAR(100) NOT NULL REFERENCES public.inventory_items(sku_internal) ON DELETE CASCADE,
    as_of_date DATE NOT NULL,
    on_hand_qty DECIMAL(12, 4) NOT NULL DEFAULT 0,
    on_hand_value DECIMAL(12, 2) NOT NULL DEFAULT 0,
    avg_unit_cost DECIMAL(12, 2) NOT NULL DEFAULT 0,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT cost_snapshots_qty_non_negative CHECK (on_hand_qty >= 0),
    CONSTRAINT cost_snapshots_value_non_negative CHECK (on_hand_value >= 0),
    CONSTRAINT cost_snapshots_avg_non_negative CHECK (avg_unit_cost >= 0)
);

COMMENT ON TABLE public.inventory_cost_snapshots IS 'Moving average snapshots: track average cost per SKU per date';
COMMENT ON COLUMN public.inventory_cost_snapshots.on_hand_qty IS 'Quantity on hand as of date';
COMMENT ON COLUMN public.inventory_cost_snapshots.on_hand_value IS 'Total value on hand as of date';
COMMENT ON COLUMN public.inventory_cost_snapshots.avg_unit_cost IS 'Average unit cost (on_hand_value / on_hand_qty)';

-- Index
CREATE INDEX IF NOT EXISTS idx_cost_snapshots_sku_date
ON public.inventory_cost_snapshots(sku_internal, as_of_date DESC);

-- Unique constraint: one snapshot per SKU per date
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_snapshots_unique
ON public.inventory_cost_snapshots(sku_internal, as_of_date);

-- ============================================
-- TABLE: inventory_cogs_allocations
-- Description: Record COGS allocations (sales and returns)
-- ============================================

CREATE TABLE IF NOT EXISTS public.inventory_cogs_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id VARCHAR(100) NOT NULL, -- From sales_orders.order_id
    sku_internal VARCHAR(100) NOT NULL REFERENCES public.inventory_items(sku_internal) ON DELETE CASCADE,
    shipped_at TIMESTAMP WITH TIME ZONE NOT NULL,
    method VARCHAR(10) NOT NULL, -- 'FIFO' or 'AVG'
    qty DECIMAL(12, 4) NOT NULL,
    unit_cost_used DECIMAL(12, 2) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL, -- qty * unit_cost_used
    layer_id UUID REFERENCES public.inventory_receipt_layers(id) ON DELETE SET NULL, -- For FIFO traceability
    is_reversal BOOLEAN NOT NULL DEFAULT false, -- True for returns (reverse COGS)
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT cogs_allocations_qty_not_zero CHECK (qty != 0),
    CONSTRAINT cogs_allocations_unit_cost_non_negative CHECK (unit_cost_used >= 0),
    CONSTRAINT cogs_allocations_method_valid CHECK (method IN ('FIFO', 'AVG'))
);

COMMENT ON TABLE public.inventory_cogs_allocations IS 'COGS allocations: track cost of goods sold and returns';
COMMENT ON COLUMN public.inventory_cogs_allocations.order_id IS 'Reference to sales_orders.order_id';
COMMENT ON COLUMN public.inventory_cogs_allocations.shipped_at IS 'When COGS was recognized (Bangkok TZ)';
COMMENT ON COLUMN public.inventory_cogs_allocations.method IS 'Costing method used: FIFO or AVG';
COMMENT ON COLUMN public.inventory_cogs_allocations.is_reversal IS 'True for returns (negative qty, reverses COGS)';
COMMENT ON COLUMN public.inventory_cogs_allocations.layer_id IS 'FIFO only: which receipt layer was consumed';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cogs_allocations_order_sku
ON public.inventory_cogs_allocations(order_id, sku_internal);

CREATE INDEX IF NOT EXISTS idx_cogs_allocations_shipped_at
ON public.inventory_cogs_allocations(shipped_at);

CREATE INDEX IF NOT EXISTS idx_cogs_allocations_sku
ON public.inventory_cogs_allocations(sku_internal);

-- Index for daily P&L queries (bucket by Bangkok date)
CREATE INDEX IF NOT EXISTS idx_cogs_allocations_shipped_date
ON public.inventory_cogs_allocations(DATE(shipped_at AT TIME ZONE 'Asia/Bangkok'));

-- ============================================
-- TRIGGERS: Auto-update updated_at
-- ============================================

DROP TRIGGER IF EXISTS update_inventory_items_updated_at ON public.inventory_items;
CREATE TRIGGER update_inventory_items_updated_at
    BEFORE UPDATE ON public.inventory_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_inventory_bundle_components_updated_at ON public.inventory_bundle_components;
CREATE TRIGGER update_inventory_bundle_components_updated_at
    BEFORE UPDATE ON public.inventory_bundle_components
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_inventory_receipt_layers_updated_at ON public.inventory_receipt_layers;
CREATE TRIGGER update_inventory_receipt_layers_updated_at
    BEFORE UPDATE ON public.inventory_receipt_layers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_inventory_cost_snapshots_updated_at ON public.inventory_cost_snapshots;
CREATE TRIGGER update_inventory_cost_snapshots_updated_at
    BEFORE UPDATE ON public.inventory_cost_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_inventory_cogs_allocations_updated_at ON public.inventory_cogs_allocations;
CREATE TRIGGER update_inventory_cogs_allocations_updated_at
    BEFORE UPDATE ON public.inventory_cogs_allocations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_bundle_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_receipt_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_cost_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_cogs_allocations ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES: inventory_items
-- ============================================

DROP POLICY IF EXISTS "inventory_items_select_policy" ON public.inventory_items;
CREATE POLICY "inventory_items_select_policy"
    ON public.inventory_items FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "inventory_items_insert_policy" ON public.inventory_items;
CREATE POLICY "inventory_items_insert_policy"
    ON public.inventory_items FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_items_update_policy" ON public.inventory_items;
CREATE POLICY "inventory_items_update_policy"
    ON public.inventory_items FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_items_delete_policy" ON public.inventory_items;
CREATE POLICY "inventory_items_delete_policy"
    ON public.inventory_items FOR DELETE
    TO authenticated
    USING (true);

-- ============================================
-- RLS POLICIES: inventory_bundle_components
-- ============================================

DROP POLICY IF EXISTS "inventory_bundle_components_select_policy" ON public.inventory_bundle_components;
CREATE POLICY "inventory_bundle_components_select_policy"
    ON public.inventory_bundle_components FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "inventory_bundle_components_insert_policy" ON public.inventory_bundle_components;
CREATE POLICY "inventory_bundle_components_insert_policy"
    ON public.inventory_bundle_components FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_bundle_components_update_policy" ON public.inventory_bundle_components;
CREATE POLICY "inventory_bundle_components_update_policy"
    ON public.inventory_bundle_components FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_bundle_components_delete_policy" ON public.inventory_bundle_components;
CREATE POLICY "inventory_bundle_components_delete_policy"
    ON public.inventory_bundle_components FOR DELETE
    TO authenticated
    USING (true);

-- ============================================
-- RLS POLICIES: inventory_receipt_layers
-- ============================================

DROP POLICY IF EXISTS "inventory_receipt_layers_select_policy" ON public.inventory_receipt_layers;
CREATE POLICY "inventory_receipt_layers_select_policy"
    ON public.inventory_receipt_layers FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "inventory_receipt_layers_insert_policy" ON public.inventory_receipt_layers;
CREATE POLICY "inventory_receipt_layers_insert_policy"
    ON public.inventory_receipt_layers FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_receipt_layers_update_policy" ON public.inventory_receipt_layers;
CREATE POLICY "inventory_receipt_layers_update_policy"
    ON public.inventory_receipt_layers FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_receipt_layers_delete_policy" ON public.inventory_receipt_layers;
CREATE POLICY "inventory_receipt_layers_delete_policy"
    ON public.inventory_receipt_layers FOR DELETE
    TO authenticated
    USING (true);

-- ============================================
-- RLS POLICIES: inventory_cost_snapshots
-- ============================================

DROP POLICY IF EXISTS "inventory_cost_snapshots_select_policy" ON public.inventory_cost_snapshots;
CREATE POLICY "inventory_cost_snapshots_select_policy"
    ON public.inventory_cost_snapshots FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "inventory_cost_snapshots_insert_policy" ON public.inventory_cost_snapshots;
CREATE POLICY "inventory_cost_snapshots_insert_policy"
    ON public.inventory_cost_snapshots FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_cost_snapshots_update_policy" ON public.inventory_cost_snapshots;
CREATE POLICY "inventory_cost_snapshots_update_policy"
    ON public.inventory_cost_snapshots FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_cost_snapshots_delete_policy" ON public.inventory_cost_snapshots;
CREATE POLICY "inventory_cost_snapshots_delete_policy"
    ON public.inventory_cost_snapshots FOR DELETE
    TO authenticated
    USING (true);

-- ============================================
-- RLS POLICIES: inventory_cogs_allocations
-- ============================================

DROP POLICY IF EXISTS "inventory_cogs_allocations_select_policy" ON public.inventory_cogs_allocations;
CREATE POLICY "inventory_cogs_allocations_select_policy"
    ON public.inventory_cogs_allocations FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "inventory_cogs_allocations_insert_policy" ON public.inventory_cogs_allocations;
CREATE POLICY "inventory_cogs_allocations_insert_policy"
    ON public.inventory_cogs_allocations FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_cogs_allocations_update_policy" ON public.inventory_cogs_allocations;
CREATE POLICY "inventory_cogs_allocations_update_policy"
    ON public.inventory_cogs_allocations FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_cogs_allocations_delete_policy" ON public.inventory_cogs_allocations;
CREATE POLICY "inventory_cogs_allocations_delete_policy"
    ON public.inventory_cogs_allocations FOR DELETE
    TO authenticated
    USING (true);

-- ============================================
-- END OF MIGRATION
-- ============================================
