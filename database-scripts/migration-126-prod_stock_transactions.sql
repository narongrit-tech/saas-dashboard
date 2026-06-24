-- migration-126: Stock ledger transactions
-- Replaces point-in-time snapshots with a running ledger.
-- FG balance  = transactions(fg_*) + production_orders.received_qty − sales_orders.qty (all computed at query time)
-- Tubes/Oil   = transactions(tubes_* / oil_kg) — all manual, backdatable

CREATE TABLE IF NOT EXISTS prod_stock_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_id       uuid NOT NULL REFERENCES prod_formula_config(id) ON DELETE CASCADE,
  stock_type       text NOT NULL CHECK (stock_type IN (
                     'fg_warehouse','fg_factory',
                     'tubes_warehouse','tubes_factory',
                     'oil_kg'
                   )),
  entry_type       text NOT NULL CHECK (entry_type IN (
                     'opening',       -- ยอดยกมา (starting balance)
                     'purchase_in',   -- รับ raw mat เข้า (tubes/oil)
                     'transfer_in',   -- โยก FG/หลอด เข้า location นี้
                     'transfer_out',  -- โยก FG/หลอด ออกจาก location นี้
                     'adjustment'     -- แก้ไขยอด (positive or negative)
                   )),
  quantity_delta   numeric(12,3) NOT NULL,  -- positive = in, negative = out
  transaction_date date NOT NULL,
  notes            text,
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- fast range scan for dashboard queries
CREATE INDEX IF NOT EXISTS idx_pst_formula_type_date
  ON prod_stock_transactions(formula_id, stock_type, transaction_date);

-- RLS
ALTER TABLE prod_stock_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_rw" ON prod_stock_transactions
  FOR ALL USING (auth.uid() IS NOT NULL);
