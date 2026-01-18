-- ============================================
-- Seed Data for SaaS Dashboard
-- Sample data for testing and development
-- ============================================

-- NOTE: This script assumes you have already run schema.sql
-- and have at least one authenticated user in auth.users

-- ============================================
-- Sample Sales Orders
-- ============================================

INSERT INTO public.sales_orders (
    order_id, marketplace, channel, product_name, sku,
    quantity, unit_price, total_amount, cost_per_unit,
    order_date, status, customer_name, notes
) VALUES
    ('SH-001', 'Shopee', 'Shopee TH', 'Wireless Mouse', 'SKU-MOUSE-001', 2, 299.00, 598.00, 150.00, '2024-01-15 10:30:00+07', 'completed', 'John Doe', 'Fast delivery requested'),
    ('LZ-002', 'Lazada', 'Lazada TH', 'Mechanical Keyboard', 'SKU-KB-001', 1, 1299.00, 1299.00, 800.00, '2024-01-16 14:20:00+07', 'completed', 'Jane Smith', NULL),
    ('SH-003', 'Shopee', 'Shopee TH', 'USB Cable', 'SKU-CABLE-001', 5, 49.00, 245.00, 20.00, '2024-01-17 09:15:00+07', 'pending', 'Bob Wilson', NULL),
    ('TT-004', 'TikTok Shop', 'TikTok TH', 'Phone Stand', 'SKU-STAND-001', 3, 159.00, 477.00, 80.00, '2024-01-17 16:45:00+07', 'processing', 'Alice Brown', 'Gift wrap requested'),
    ('LZ-005', 'Lazada', 'Lazada TH', 'Wireless Mouse', 'SKU-MOUSE-001', 1, 299.00, 299.00, 150.00, '2024-01-18 11:00:00+07', 'completed', 'Charlie Davis', NULL);

-- ============================================
-- Sample Expenses
-- ============================================

INSERT INTO public.expenses (
    category, sub_category, description, amount,
    expense_date, payment_method, vendor, notes
) VALUES
    ('Marketing', 'Social Media Ads', 'Facebook Ads Campaign - Jan 2024', 5000.00, '2024-01-10', 'Credit Card', 'Facebook', 'Campaign ID: FB-JAN-001'),
    ('Operations', 'Shipping', 'Shipping costs for Shopee orders', 850.00, '2024-01-15', 'Bank Transfer', 'Kerry Express', NULL),
    ('Operations', 'Packaging', 'Bubble wrap and boxes', 1200.00, '2024-01-12', 'Cash', 'Local Supplier', 'Bulk purchase'),
    ('Administrative', 'Software', 'Accounting software subscription', 990.00, '2024-01-01', 'Credit Card', 'QuickBooks', 'Annual subscription'),
    ('Marketing', 'Influencer', 'Product review by influencer', 3000.00, '2024-01-14', 'Bank Transfer', 'TikTok Influencer', 'Reach: 100K followers');

-- ============================================
-- Sample Inventory
-- ============================================

INSERT INTO public.inventory (
    sku, product_name, quantity, cost_per_unit,
    unit, min_stock_level, supplier, notes
) VALUES
    ('SKU-MOUSE-001', 'Wireless Mouse', 48, 150.00, 'pcs', 10, 'Tech Supplier Co.', 'Bestseller item'),
    ('SKU-KB-001', 'Mechanical Keyboard', 15, 800.00, 'pcs', 5, 'Tech Supplier Co.', 'Premium product'),
    ('SKU-CABLE-001', 'USB Cable', 95, 20.00, 'pcs', 20, 'Cable World', 'Fast-moving item'),
    ('SKU-STAND-001', 'Phone Stand', 27, 80.00, 'pcs', 10, 'Gadget Wholesale', NULL),
    ('SKU-CASE-001', 'Phone Case', 8, 120.00, 'pcs', 15, 'Case Master', 'Low stock - need to reorder');

-- ============================================
-- Sample Payables
-- ============================================

INSERT INTO public.payables (
    vendor, description, total_amount, paid_amount,
    remaining_amount, due_date, status,
    payment_history, notes
) VALUES
    ('Tech Supplier Co.', 'Inventory purchase - Dec 2023', 50000.00, 30000.00, 20000.00, '2024-01-25', 'partial',
     '[{"date": "2023-12-20", "amount": 30000.00, "method": "Bank Transfer"}]'::jsonb,
     'Payment plan: 30k upfront, 20k by Jan 25'),

    ('Facebook', 'Ad spend - January', 5000.00, 5000.00, 0.00, '2024-01-31', 'paid',
     '[{"date": "2024-01-10", "amount": 5000.00, "method": "Credit Card"}]'::jsonb,
     'Paid in full'),

    ('Gadget Wholesale', 'Phone stands and accessories', 15000.00, 0.00, 15000.00, '2024-02-01', 'pending',
     '[]'::jsonb,
     'Net 30 payment terms'),

    ('Warehouse Rent', 'Monthly warehouse rent - January', 12000.00, 12000.00, 0.00, '2024-01-05', 'paid',
     '[{"date": "2024-01-05", "amount": 12000.00, "method": "Bank Transfer"}]'::jsonb,
     NULL);

-- ============================================
-- Sample Tax Records
-- ============================================

INSERT INTO public.tax_records (
    tax_type, period, taxable_amount, tax_amount,
    status, due_date, filed_date, payment_date, notes
) VALUES
    ('VAT', '2023-Q4', 150000.00, 10500.00, 'paid', '2024-01-15', '2024-01-10', '2024-01-12', 'Q4 2023 VAT filing'),
    ('Corporate Income Tax', '2023', 500000.00, 100000.00, 'filed', '2024-03-31', '2024-01-20', NULL, 'Annual tax return filed, payment pending'),
    ('VAT', '2024-Q1', 80000.00, 5600.00, 'pending', '2024-04-15', NULL, NULL, 'Q1 2024 VAT - to be filed'),
    ('Withholding Tax', '2023-12', 25000.00, 750.00, 'paid', '2024-01-07', '2024-01-05', '2024-01-05', 'December 2023 withholding tax');

-- ============================================
-- Sample CEO Transactions
-- ============================================

INSERT INTO public.ceo_transactions (
    transaction_type, amount, transaction_date,
    description, reference, notes
) VALUES
    ('Withdrawal', 50000.00, '2024-01-05', 'Monthly personal allowance', 'TXN-2024-001', 'Regular monthly withdrawal'),
    ('Investment', 100000.00, '2024-01-10', 'Additional capital injection for inventory', 'TXN-2024-002', 'To support growth'),
    ('Withdrawal', 25000.00, '2024-01-15', 'Dividend payment', 'TXN-2024-003', 'Quarterly dividend'),
    ('Personal Expense', 15000.00, '2024-01-12', 'Personal credit card payment from business account', 'TXN-2024-004', 'To be reconciled');

-- ============================================
-- Verification Queries
-- ============================================

-- Count records in each table
-- SELECT 'sales_orders' as table_name, COUNT(*) as record_count FROM public.sales_orders
-- UNION ALL
-- SELECT 'expenses', COUNT(*) FROM public.expenses
-- UNION ALL
-- SELECT 'inventory', COUNT(*) FROM public.inventory
-- UNION ALL
-- SELECT 'payables', COUNT(*) FROM public.payables
-- UNION ALL
-- SELECT 'tax_records', COUNT(*) FROM public.tax_records
-- UNION ALL
-- SELECT 'ceo_transactions', COUNT(*) FROM public.ceo_transactions;

-- ============================================
-- END OF SEED DATA
-- ============================================
