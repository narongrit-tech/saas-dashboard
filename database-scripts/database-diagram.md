# Database Schema Diagram

## Entity Relationship Overview

```
┌─────────────────┐
│   auth.users    │ (Supabase Auth)
│                 │
│ - id (UUID)     │
│ - email         │
│ - ...           │
└────────┬────────┘
         │
         │ created_by (FK)
         │
         ├──────────────────────────────────┬──────────────────────┐
         │                                  │                      │
         ▼                                  ▼                      ▼
┌──────────────────┐              ┌─────────────────┐    ┌──────────────────┐
│  sales_orders    │              │    expenses     │    │    inventory     │
├──────────────────┤              ├─────────────────┤    ├──────────────────┤
│ id (PK)          │              │ id (PK)         │    │ id (PK)          │
│ order_id         │              │ category        │    │ sku (UNIQUE)     │
│ marketplace      │              │ sub_category    │    │ product_name     │
│ channel          │              │ description     │    │ quantity         │
│ product_name     │              │ amount          │    │ cost_per_unit    │
│ sku              │              │ expense_date    │    │ min_stock_level  │
│ quantity         │              │ payment_method  │    │ supplier         │
│ unit_price       │              │ vendor          │    │ last_updated     │
│ total_amount     │              │ receipt_url     │    │ created_at       │
│ cost_per_unit    │              │ created_at      │    │ created_by (FK)  │
│ order_date       │              │ updated_at      │    └──────────────────┘
│ status           │              │ created_by (FK) │
│ customer_name    │              └─────────────────┘
│ created_at       │
│ updated_at       │
│ created_by (FK)  │
└──────────────────┘
         │
         │ created_by (FK)
         │
         ├──────────────────────────────────┬──────────────────────┐
         │                                  │                      │
         ▼                                  ▼                      ▼
┌──────────────────┐              ┌─────────────────┐    ┌──────────────────┐
│    payables      │              │  tax_records    │    │ ceo_transactions │
├──────────────────┤              ├─────────────────┤    ├──────────────────┤
│ id (PK)          │              │ id (PK)         │    │ id (PK)          │
│ vendor           │              │ tax_type        │    │ transaction_type │
│ description      │              │ period          │    │ amount           │
│ total_amount     │              │ taxable_amount  │    │ transaction_date │
│ paid_amount      │              │ tax_amount      │    │ description      │
│ remaining_amount │              │ status          │    │ reference        │
│ due_date         │              │ due_date        │    │ created_at       │
│ status           │              │ filed_date      │    │ created_by (FK)  │
│ payment_history  │              │ payment_date    │    └──────────────────┘
│ created_at       │              │ created_at      │
│ updated_at       │              │ updated_at      │
│ created_by (FK)  │              │ created_by (FK) │
└──────────────────┘              └─────────────────┘
```

## Table Relationships

### Foreign Key Relationships
All tables have a `created_by` foreign key referencing `auth.users(id)`:
- `sales_orders.created_by` → `auth.users.id`
- `expenses.created_by` → `auth.users.id`
- `inventory.created_by` → `auth.users.id`
- `payables.created_by` → `auth.users.id`
- `tax_records.created_by` → `auth.users.id`
- `ceo_transactions.created_by` → `auth.users.id`

### Logical Relationships (Not enforced by FK)

#### Sales → Inventory
- `sales_orders.sku` relates to `inventory.sku`
- When sales are made, inventory should be reduced
- `sales_orders.cost_per_unit` can be populated from `inventory.cost_per_unit`

#### Expenses → Payables
- Some expenses may create payables (e.g., supplier invoices)
- `expenses.vendor` may match `payables.vendor`

#### Sales → Tax Records
- Sales generate taxable income
- `sales_orders` aggregate data feeds into `tax_records.taxable_amount`

## Table Details

### 1. sales_orders
**Purpose**: Track all sales transactions across multiple channels

**Key Features**:
- Multi-marketplace support (Shopee, Lazada, TikTok Shop, etc.)
- Profit calculation: `total_amount - (cost_per_unit * quantity)`
- Order status tracking
- Customer information

**Indexes**:
- `order_date` (DESC) - Fast date range queries
- `marketplace` - Filter by channel
- `status` - Order status filtering
- `sku` - Product lookup
- `order_id` - Unique order lookup

**Common Queries**:
```sql
-- Daily sales summary
SELECT DATE(order_date), SUM(total_amount), COUNT(*)
FROM sales_orders
WHERE order_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(order_date);

-- Sales by marketplace
SELECT marketplace, SUM(total_amount), COUNT(*)
FROM sales_orders
WHERE order_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY marketplace;

-- Profit analysis
SELECT
    product_name,
    SUM(total_amount) as revenue,
    SUM(cost_per_unit * quantity) as cost,
    SUM(total_amount - (cost_per_unit * quantity)) as profit
FROM sales_orders
WHERE cost_per_unit IS NOT NULL
GROUP BY product_name;
```

### 2. expenses
**Purpose**: Track all business expenses with categorization

**Key Features**:
- Two-level categorization (category + sub_category)
- Receipt URL storage
- Vendor tracking
- Payment method tracking

**Indexes**:
- `expense_date` (DESC) - Date range queries
- `category` - Category filtering
- `vendor` - Vendor lookup

**Common Queries**:
```sql
-- Monthly expenses by category
SELECT
    category,
    DATE_TRUNC('month', expense_date) as month,
    SUM(amount)
FROM expenses
GROUP BY category, month
ORDER BY month DESC, category;

-- Top vendors by spending
SELECT vendor, SUM(amount) as total_spent
FROM expenses
WHERE vendor IS NOT NULL
GROUP BY vendor
ORDER BY total_spent DESC
LIMIT 10;
```

### 3. inventory
**Purpose**: Manage product inventory and stock levels

**Key Features**:
- Unique SKU identification
- Low stock level alerts
- Supplier tracking
- Cost tracking

**Indexes**:
- `sku` (UNIQUE) - Fast SKU lookup
- `product_name` - Product search
- `quantity WHERE quantity <= min_stock_level` - Low stock alerts

**Common Queries**:
```sql
-- Low stock items
SELECT sku, product_name, quantity, min_stock_level
FROM inventory
WHERE quantity <= min_stock_level
ORDER BY quantity;

-- Inventory value
SELECT
    SUM(quantity * cost_per_unit) as total_inventory_value
FROM inventory
WHERE cost_per_unit IS NOT NULL;
```

### 4. payables
**Purpose**: Track accounts payable and payment schedules

**Key Features**:
- Payment tracking (total, paid, remaining)
- Payment history (JSONB)
- Due date management
- Status tracking

**Indexes**:
- `due_date` - Payment schedule
- `status` - Status filtering
- `vendor` - Vendor lookup

**JSONB Payment History Format**:
```json
[
  {
    "date": "2024-01-15",
    "amount": 10000.00,
    "method": "Bank Transfer",
    "reference": "TXN-001"
  }
]
```

**Common Queries**:
```sql
-- Overdue payables
SELECT vendor, description, total_amount, remaining_amount, due_date
FROM payables
WHERE due_date < CURRENT_DATE AND remaining_amount > 0
ORDER BY due_date;

-- Total outstanding payables
SELECT SUM(remaining_amount) as total_outstanding
FROM payables
WHERE remaining_amount > 0;
```

### 5. tax_records
**Purpose**: Track tax obligations, filings, and payments

**Key Features**:
- Multiple tax types (VAT, Income Tax, Withholding, etc.)
- Period tracking
- Filing status
- Payment tracking

**Indexes**:
- `period` - Period lookup
- `tax_type` - Tax type filtering
- `due_date` - Due date tracking
- `status` - Status filtering

**Common Queries**:
```sql
-- Upcoming tax obligations
SELECT tax_type, period, tax_amount, due_date, status
FROM tax_records
WHERE due_date >= CURRENT_DATE
  AND status != 'paid'
ORDER BY due_date;

-- Annual tax summary
SELECT
    tax_type,
    SUM(taxable_amount) as total_taxable,
    SUM(tax_amount) as total_tax
FROM tax_records
WHERE period LIKE '2024%'
GROUP BY tax_type;
```

### 6. ceo_transactions
**Purpose**: Track CEO personal transactions and capital movements

**Key Features**:
- Transaction type tracking (Withdrawal, Investment, etc.)
- Reference tracking
- Separation of business and personal finances

**Indexes**:
- `transaction_date` (DESC) - Date range queries
- `transaction_type` - Type filtering

**Common Queries**:
```sql
-- CEO withdrawals this year
SELECT SUM(amount)
FROM ceo_transactions
WHERE transaction_type = 'Withdrawal'
  AND EXTRACT(YEAR FROM transaction_date) = EXTRACT(YEAR FROM CURRENT_DATE);

-- Net CEO transactions
SELECT
    transaction_type,
    SUM(CASE
        WHEN transaction_type IN ('Withdrawal', 'Personal Expense') THEN -amount
        WHEN transaction_type = 'Investment' THEN amount
        ELSE 0
    END) as net_amount
FROM ceo_transactions
GROUP BY transaction_type;
```

## Data Integrity

### Constraints
- **CHECK constraints**: Ensure positive values for amounts and quantities
- **UNIQUE constraints**: Prevent duplicate SKUs in inventory
- **NOT NULL constraints**: Ensure required fields are populated
- **Foreign key constraints**: Maintain referential integrity with auth.users

### Triggers
All tables with `updated_at` column have automatic update triggers:
```sql
CREATE TRIGGER update_[table_name]_updated_at
    BEFORE UPDATE ON public.[table_name]
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

### Row Level Security (RLS)
All tables have RLS enabled with basic policies:
- Authenticated users can SELECT, INSERT, UPDATE, DELETE

**Can be customized for role-based access**:
```sql
-- Example: Read-only access for certain users
CREATE POLICY "readonly_users_select"
    ON public.sales_orders FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid()
            AND raw_user_meta_data->>'role' = 'readonly'
        )
    );
```

## Performance Considerations

### Indexes
- All date columns have indexes for fast date range queries
- Foreign keys are indexed automatically
- Composite indexes may be added for specific query patterns

### Partitioning (Future)
For large datasets, consider partitioning by date:
```sql
-- Example: Partition sales_orders by month
CREATE TABLE sales_orders_2024_01 PARTITION OF sales_orders
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

### Materialized Views (Future)
For complex aggregations, create materialized views:
```sql
-- Example: Daily sales summary
CREATE MATERIALIZED VIEW daily_sales_summary AS
SELECT
    DATE(order_date) as sale_date,
    marketplace,
    COUNT(*) as order_count,
    SUM(total_amount) as total_revenue
FROM sales_orders
GROUP BY DATE(order_date), marketplace;
```

## Backup & Maintenance

### Regular Backups
- Supabase provides automatic daily backups
- Manual backups can be created via dashboard

### Maintenance
- `VACUUM ANALYZE` is run automatically by Supabase
- Monitor slow queries via pg_stat_statements
- Review and update indexes based on query patterns

## Migration Strategy

### Adding New Columns
```sql
ALTER TABLE public.table_name
ADD COLUMN new_column_name TYPE DEFAULT VALUE;
```

### Modifying Columns
```sql
ALTER TABLE public.table_name
ALTER COLUMN column_name TYPE NEW_TYPE;
```

### Creating New Tables
Follow the same pattern:
1. Create table with UUID primary key
2. Add timestamps (created_at, updated_at)
3. Add created_by foreign key
4. Add indexes
5. Add triggers
6. Enable RLS
7. Create policies
