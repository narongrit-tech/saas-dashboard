-- ============================================
-- SaaS Dashboard - Database Schema
-- Multi-Channel E-Commerce Management System
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Helper Functions
-- ============================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TABLE: sales_orders
-- Description: Track sales orders from multiple marketplaces
-- ============================================

CREATE TABLE IF NOT EXISTS public.sales_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id VARCHAR(100) NOT NULL,
    marketplace VARCHAR(100) NOT NULL,
    channel VARCHAR(100),
    product_name VARCHAR(255) NOT NULL,
    sku VARCHAR(100),
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(12, 2) NOT NULL,
    total_amount DECIMAL(12, 2) NOT NULL,
    cost_per_unit DECIMAL(12, 2),
    order_date TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    customer_name VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    CONSTRAINT sales_orders_quantity_positive CHECK (quantity > 0),
    CONSTRAINT sales_orders_unit_price_positive CHECK (unit_price >= 0),
    CONSTRAINT sales_orders_total_amount_positive CHECK (total_amount >= 0)
);

-- ============================================
-- TABLE: expenses
-- Description: Track business expenses with categorization
-- ============================================

CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category VARCHAR(100) NOT NULL,
    sub_category VARCHAR(100),
    description TEXT NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    expense_date DATE NOT NULL,
    payment_method VARCHAR(50),
    vendor VARCHAR(255),
    receipt_url TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    CONSTRAINT expenses_amount_positive CHECK (amount >= 0)
);

-- ============================================
-- TABLE: inventory
-- Description: Track product inventory with stock levels
-- ============================================

CREATE TABLE IF NOT EXISTS public.inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku VARCHAR(100) UNIQUE NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    cost_per_unit DECIMAL(12, 2),
    unit VARCHAR(50) DEFAULT 'pcs',
    min_stock_level INTEGER DEFAULT 0,
    supplier VARCHAR(255),
    notes TEXT,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    CONSTRAINT inventory_quantity_non_negative CHECK (quantity >= 0),
    CONSTRAINT inventory_cost_non_negative CHECK (cost_per_unit IS NULL OR cost_per_unit >= 0),
    CONSTRAINT inventory_min_stock_non_negative CHECK (min_stock_level >= 0)
);

-- ============================================
-- TABLE: payables
-- Description: Track accounts payable and payment schedules
-- ============================================

CREATE TABLE IF NOT EXISTS public.payables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    total_amount DECIMAL(12, 2) NOT NULL,
    paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    remaining_amount DECIMAL(12, 2) NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    payment_history JSONB DEFAULT '[]'::jsonb,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    CONSTRAINT payables_total_amount_positive CHECK (total_amount >= 0),
    CONSTRAINT payables_paid_amount_non_negative CHECK (paid_amount >= 0),
    CONSTRAINT payables_remaining_amount_non_negative CHECK (remaining_amount >= 0),
    CONSTRAINT payables_paid_lte_total CHECK (paid_amount <= total_amount)
);

-- ============================================
-- TABLE: tax_records
-- Description: Track tax filings and payments
-- ============================================

CREATE TABLE IF NOT EXISTS public.tax_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tax_type VARCHAR(100) NOT NULL,
    period VARCHAR(50) NOT NULL,
    taxable_amount DECIMAL(12, 2) NOT NULL,
    tax_amount DECIMAL(12, 2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    due_date DATE NOT NULL,
    filed_date DATE,
    payment_date DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    CONSTRAINT tax_records_taxable_amount_non_negative CHECK (taxable_amount >= 0),
    CONSTRAINT tax_records_tax_amount_non_negative CHECK (tax_amount >= 0)
);

-- ============================================
-- TABLE: ceo_transactions
-- Description: Track CEO personal transactions and withdrawals
-- ============================================

CREATE TABLE IF NOT EXISTS public.ceo_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_type VARCHAR(50) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    transaction_date DATE NOT NULL,
    description TEXT NOT NULL,
    reference VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    CONSTRAINT ceo_transactions_amount_positive CHECK (amount >= 0)
);

-- ============================================
-- INDEXES
-- Create indexes for frequently queried columns
-- ============================================

-- sales_orders indexes
CREATE INDEX IF NOT EXISTS idx_sales_orders_order_date ON public.sales_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_orders_marketplace ON public.sales_orders(marketplace);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON public.sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_sales_orders_sku ON public.sales_orders(sku);
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_by ON public.sales_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_sales_orders_order_id ON public.sales_orders(order_id);

-- expenses indexes
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON public.expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON public.expenses(created_by);
CREATE INDEX IF NOT EXISTS idx_expenses_vendor ON public.expenses(vendor);

-- inventory indexes
CREATE INDEX IF NOT EXISTS idx_inventory_sku ON public.inventory(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_product_name ON public.inventory(product_name);
CREATE INDEX IF NOT EXISTS idx_inventory_created_by ON public.inventory(created_by);
CREATE INDEX IF NOT EXISTS idx_inventory_low_stock ON public.inventory(quantity) WHERE quantity <= min_stock_level;

-- payables indexes
CREATE INDEX IF NOT EXISTS idx_payables_due_date ON public.payables(due_date);
CREATE INDEX IF NOT EXISTS idx_payables_status ON public.payables(status);
CREATE INDEX IF NOT EXISTS idx_payables_vendor ON public.payables(vendor);
CREATE INDEX IF NOT EXISTS idx_payables_created_by ON public.payables(created_by);

-- tax_records indexes
CREATE INDEX IF NOT EXISTS idx_tax_records_period ON public.tax_records(period);
CREATE INDEX IF NOT EXISTS idx_tax_records_tax_type ON public.tax_records(tax_type);
CREATE INDEX IF NOT EXISTS idx_tax_records_due_date ON public.tax_records(due_date);
CREATE INDEX IF NOT EXISTS idx_tax_records_status ON public.tax_records(status);
CREATE INDEX IF NOT EXISTS idx_tax_records_created_by ON public.tax_records(created_by);

-- ceo_transactions indexes
CREATE INDEX IF NOT EXISTS idx_ceo_transactions_transaction_date ON public.ceo_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_ceo_transactions_transaction_type ON public.ceo_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_ceo_transactions_created_by ON public.ceo_transactions(created_by);

-- ============================================
-- TRIGGERS
-- Auto-update updated_at timestamp on record update
-- ============================================

-- sales_orders trigger
DROP TRIGGER IF EXISTS update_sales_orders_updated_at ON public.sales_orders;
CREATE TRIGGER update_sales_orders_updated_at
    BEFORE UPDATE ON public.sales_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- expenses trigger
DROP TRIGGER IF EXISTS update_expenses_updated_at ON public.expenses;
CREATE TRIGGER update_expenses_updated_at
    BEFORE UPDATE ON public.expenses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- inventory trigger (updates last_updated as well)
DROP TRIGGER IF EXISTS update_inventory_updated_at ON public.inventory;
CREATE TRIGGER update_inventory_updated_at
    BEFORE UPDATE ON public.inventory
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION update_inventory_last_updated()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_inventory_last_updated_trigger ON public.inventory;
CREATE TRIGGER update_inventory_last_updated_trigger
    BEFORE UPDATE ON public.inventory
    FOR EACH ROW
    EXECUTE FUNCTION update_inventory_last_updated();

-- payables trigger
DROP TRIGGER IF EXISTS update_payables_updated_at ON public.payables;
CREATE TRIGGER update_payables_updated_at
    BEFORE UPDATE ON public.payables
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- tax_records trigger
DROP TRIGGER IF EXISTS update_tax_records_updated_at ON public.tax_records;
CREATE TRIGGER update_tax_records_updated_at
    BEFORE UPDATE ON public.tax_records
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- Enable RLS and create policies for all tables
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ceo_transactions ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES: sales_orders
-- ============================================

-- Allow authenticated users to view all sales orders
DROP POLICY IF EXISTS "sales_orders_select_policy" ON public.sales_orders;
CREATE POLICY "sales_orders_select_policy"
    ON public.sales_orders FOR SELECT
    TO authenticated
    USING (true);

-- Allow authenticated users to insert sales orders
DROP POLICY IF EXISTS "sales_orders_insert_policy" ON public.sales_orders;
CREATE POLICY "sales_orders_insert_policy"
    ON public.sales_orders FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Allow authenticated users to update sales orders
DROP POLICY IF EXISTS "sales_orders_update_policy" ON public.sales_orders;
CREATE POLICY "sales_orders_update_policy"
    ON public.sales_orders FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Allow authenticated users to delete sales orders
DROP POLICY IF EXISTS "sales_orders_delete_policy" ON public.sales_orders;
CREATE POLICY "sales_orders_delete_policy"
    ON public.sales_orders FOR DELETE
    TO authenticated
    USING (true);

-- ============================================
-- RLS POLICIES: expenses
-- ============================================

DROP POLICY IF EXISTS "expenses_select_policy" ON public.expenses;
CREATE POLICY "expenses_select_policy"
    ON public.expenses FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "expenses_insert_policy" ON public.expenses;
CREATE POLICY "expenses_insert_policy"
    ON public.expenses FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "expenses_update_policy" ON public.expenses;
CREATE POLICY "expenses_update_policy"
    ON public.expenses FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "expenses_delete_policy" ON public.expenses;
CREATE POLICY "expenses_delete_policy"
    ON public.expenses FOR DELETE
    TO authenticated
    USING (true);

-- ============================================
-- RLS POLICIES: inventory
-- ============================================

DROP POLICY IF EXISTS "inventory_select_policy" ON public.inventory;
CREATE POLICY "inventory_select_policy"
    ON public.inventory FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "inventory_insert_policy" ON public.inventory;
CREATE POLICY "inventory_insert_policy"
    ON public.inventory FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_update_policy" ON public.inventory;
CREATE POLICY "inventory_update_policy"
    ON public.inventory FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_delete_policy" ON public.inventory;
CREATE POLICY "inventory_delete_policy"
    ON public.inventory FOR DELETE
    TO authenticated
    USING (true);

-- ============================================
-- RLS POLICIES: payables
-- ============================================

DROP POLICY IF EXISTS "payables_select_policy" ON public.payables;
CREATE POLICY "payables_select_policy"
    ON public.payables FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "payables_insert_policy" ON public.payables;
CREATE POLICY "payables_insert_policy"
    ON public.payables FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "payables_update_policy" ON public.payables;
CREATE POLICY "payables_update_policy"
    ON public.payables FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "payables_delete_policy" ON public.payables;
CREATE POLICY "payables_delete_policy"
    ON public.payables FOR DELETE
    TO authenticated
    USING (true);

-- ============================================
-- RLS POLICIES: tax_records
-- ============================================

DROP POLICY IF EXISTS "tax_records_select_policy" ON public.tax_records;
CREATE POLICY "tax_records_select_policy"
    ON public.tax_records FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "tax_records_insert_policy" ON public.tax_records;
CREATE POLICY "tax_records_insert_policy"
    ON public.tax_records FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "tax_records_update_policy" ON public.tax_records;
CREATE POLICY "tax_records_update_policy"
    ON public.tax_records FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "tax_records_delete_policy" ON public.tax_records;
CREATE POLICY "tax_records_delete_policy"
    ON public.tax_records FOR DELETE
    TO authenticated
    USING (true);

-- ============================================
-- RLS POLICIES: ceo_transactions
-- ============================================

DROP POLICY IF EXISTS "ceo_transactions_select_policy" ON public.ceo_transactions;
CREATE POLICY "ceo_transactions_select_policy"
    ON public.ceo_transactions FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "ceo_transactions_insert_policy" ON public.ceo_transactions;
CREATE POLICY "ceo_transactions_insert_policy"
    ON public.ceo_transactions FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "ceo_transactions_update_policy" ON public.ceo_transactions;
CREATE POLICY "ceo_transactions_update_policy"
    ON public.ceo_transactions FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "ceo_transactions_delete_policy" ON public.ceo_transactions;
CREATE POLICY "ceo_transactions_delete_policy"
    ON public.ceo_transactions FOR DELETE
    TO authenticated
    USING (true);

-- ============================================
-- COMMENTS
-- Add helpful descriptions to tables and columns
-- ============================================

COMMENT ON TABLE public.sales_orders IS 'Sales orders from multiple marketplaces and channels';
COMMENT ON TABLE public.expenses IS 'Business expenses with categorization and tracking';
COMMENT ON TABLE public.inventory IS 'Product inventory with stock level management';
COMMENT ON TABLE public.payables IS 'Accounts payable and payment tracking';
COMMENT ON TABLE public.tax_records IS 'Tax filings and payment records';
COMMENT ON TABLE public.ceo_transactions IS 'CEO personal transactions and withdrawals';

-- ============================================
-- END OF SCHEMA
-- ============================================
