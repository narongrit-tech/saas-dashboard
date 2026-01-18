# Database Schema Setup Guide

## Overview
This directory contains SQL scripts for setting up the database schema for the Multi-Channel E-Commerce Management SaaS Dashboard.

## Files
- `schema.sql` - Complete database schema with all tables, indexes, triggers, and RLS policies
- `add-source-column.sql` - Migration to add source column to sales_orders table
- `add-source-to-expenses.sql` - Migration to add source column to expenses table

## Database Tables

### 1. sales_orders
Track sales orders from multiple marketplaces and channels
- **Key Fields**: order_id, marketplace, channel, product_name, sku, quantity, unit_price, total_amount
- **Features**: Order tracking, marketplace management, profit calculation

### 2. expenses
Business expense tracking with categorization
- **Key Fields**: category, sub_category, description, amount, expense_date, vendor
- **Features**: Expense categorization, receipt storage, vendor tracking

### 3. inventory
Product inventory management with stock levels
- **Key Fields**: sku (unique), product_name, quantity, cost_per_unit, min_stock_level
- **Features**: Stock level tracking, low stock alerts, supplier management

### 4. payables
Accounts payable and payment schedules
- **Key Fields**: vendor, total_amount, paid_amount, remaining_amount, due_date, status
- **Features**: Payment tracking, due date management, payment history (JSONB)

### 5. tax_records
Tax filing and payment tracking
- **Key Fields**: tax_type, period, taxable_amount, tax_amount, status, due_date
- **Features**: Tax calculation, filing status, payment tracking

### 6. ceo_transactions
CEO personal transactions and withdrawals
- **Key Fields**: transaction_type, amount, transaction_date, description
- **Features**: Personal transaction tracking, business-personal separation

## How to Run Migrations

### Migration Scripts
If you've already applied the main schema, you may need to run migration scripts to add new columns:

**To add source column to expenses table:**
1. Go to Supabase Dashboard > SQL Editor
2. Copy and paste the contents of `add-source-to-expenses.sql`
3. Click **Run** to execute

**To add source column to sales_orders table:**
1. Go to Supabase Dashboard > SQL Editor
2. Copy and paste the contents of `add-source-column.sql`
3. Click **Run** to execute

## How to Apply Schema

### Option 1: Supabase Dashboard (Recommended)
1. Go to your Supabase project: https://supabase.com/dashboard
2. Navigate to **SQL Editor**
3. Create a new query
4. Copy and paste the entire contents of `schema.sql`
5. Click **Run** to execute the script

### Option 2: Supabase CLI
```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Login to Supabase
supabase login

# Link your project
supabase link --project-ref YOUR_PROJECT_REF

# Run the migration
supabase db push
```

### Option 3: psql Command Line
```bash
psql "postgresql://postgres:[YOUR-PASSWORD]@[YOUR-PROJECT-REF].supabase.co:5432/postgres" -f schema.sql
```

## Features Included

### ✅ UUID Primary Keys
All tables use UUID v4 as primary keys for better scalability and security

### ✅ Timestamps
- `created_at`: Automatically set when record is created
- `updated_at`: Automatically updated via triggers when record is modified

### ✅ User Tracking
- `created_by`: References auth.users(id) to track who created each record
- Set to NULL if user is deleted (ON DELETE SET NULL)

### ✅ Data Validation
- CHECK constraints for positive values (amounts, quantities)
- NOT NULL constraints for required fields
- UNIQUE constraints (e.g., inventory.sku)

### ✅ Indexes
Indexes created on frequently queried columns:
- Date fields (for date range queries)
- Status fields (for filtering)
- Foreign keys (for joins)
- Lookup fields (marketplace, category, vendor, etc.)

### ✅ Triggers
Auto-update triggers for `updated_at` columns on all applicable tables

### ✅ Row Level Security (RLS)
All tables have RLS enabled with policies allowing:
- Authenticated users can SELECT, INSERT, UPDATE, DELETE all records
- Can be customized later for role-based access control

## Next Steps

After applying the schema:

1. **Verify Tables Created**
   - Check Supabase Dashboard > Table Editor
   - Verify all 6 tables appear

2. **Test RLS Policies**
   - Try querying data through the API
   - Ensure authenticated users can access data

3. **Generate TypeScript Types**
   ```bash
   cd frontend
   npx supabase gen types typescript --project-id YOUR_PROJECT_REF > src/types/database.types.ts
   ```

4. **Insert Sample Data** (Optional)
   - Use Supabase Dashboard > Table Editor
   - Or create a seed-data.sql file

## Customization

### Modify RLS Policies
To restrict access by user or role, edit the policies in schema.sql:
```sql
-- Example: Users can only see their own records
CREATE POLICY "users_select_own_records"
    ON public.sales_orders FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());
```

### Add Additional Fields
Simply add new columns using ALTER TABLE:
```sql
ALTER TABLE public.sales_orders
ADD COLUMN shipping_cost DECIMAL(12, 2) DEFAULT 0;
```

### Add Custom Indexes
```sql
CREATE INDEX idx_custom ON public.table_name(column_name);
```

## Troubleshooting

### Error: "extension uuid-ossp does not exist"
The schema will automatically create it. If you see this error, ensure you have proper permissions.

### Error: "relation already exists"
The schema uses `IF NOT EXISTS` and `DROP POLICY IF EXISTS`, so it's safe to run multiple times.

### RLS Blocking Queries
If you can't query data:
1. Verify you're authenticated
2. Check RLS policies in Supabase Dashboard > Authentication > Policies
3. Temporarily disable RLS for testing: `ALTER TABLE table_name DISABLE ROW LEVEL SECURITY;`

## Support
For issues or questions, refer to:
- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
