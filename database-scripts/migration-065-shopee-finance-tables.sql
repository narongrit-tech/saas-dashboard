-- =============================================================================
-- Migration 065: Shopee Finance Tables (MVP)
-- Tables: shopee_wallet_transactions, shopee_order_settlements
-- =============================================================================

-- -----------------------------------------------------------------------
-- 1. shopee_wallet_transactions
--    Source: "My Balance Transaction Report" CSV (skiprows ≈ 16)
--    Columns: วันที่ทำธุรกรรม, ประเภทการทำธุรกรรม, หมายเลขอ้างอิง,
--             รูปแบบธุรกรรม, สถานะ, จำนวนเงิน, คงเหลือ
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shopee_wallet_transactions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_platform   TEXT        NOT NULL DEFAULT 'shopee',

  occurred_at       TIMESTAMPTZ NOT NULL,                       -- วันที่ทำธุรกรรม
  transaction_type  TEXT        NOT NULL,                       -- ประเภทการทำธุรกรรม
  transaction_mode  TEXT,                                       -- รูปแบบธุรกรรม (e.g. เงินเข้า/เงินออก)
  ref_no            TEXT,                                       -- หมายเลขอ้างอิง (order / withdrawal ref)
  status            TEXT,                                       -- สถานะ
  amount            NUMERIC     NOT NULL,                       -- จำนวนเงิน (signed; negative = debit)
  balance           NUMERIC,                                    -- คงเหลือ

  raw               JSONB,                                      -- full row stored as-is for audit
  import_batch_id   UUID        REFERENCES import_batches(id),
  created_by        UUID        NOT NULL REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Dedup: treat NULL ref_no as equal (NULLS NOT DISTINCT — PostgreSQL 15+)
  UNIQUE NULLS NOT DISTINCT (source_platform, ref_no, occurred_at, amount)
);

-- Indexes for shopee_wallet_transactions
CREATE INDEX IF NOT EXISTS idx_swt_created_by
  ON shopee_wallet_transactions(created_by);

CREATE INDEX IF NOT EXISTS idx_swt_occurred_at
  ON shopee_wallet_transactions(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_swt_import_batch
  ON shopee_wallet_transactions(import_batch_id);

CREATE INDEX IF NOT EXISTS idx_swt_ref_no
  ON shopee_wallet_transactions(ref_no) WHERE ref_no IS NOT NULL;

-- RLS
ALTER TABLE shopee_wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "swt_select_own"  ON shopee_wallet_transactions FOR SELECT USING (created_by = auth.uid());
CREATE POLICY "swt_insert_own"  ON shopee_wallet_transactions FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "swt_update_own"  ON shopee_wallet_transactions FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "swt_delete_own"  ON shopee_wallet_transactions FOR DELETE USING (created_by = auth.uid());


-- -----------------------------------------------------------------------
-- 2. shopee_order_settlements
--    Source: "Income / โอนเงินสำเร็จ" report (header row ≈ index 5)
--    ~44 columns; we store key financial fields + full raw JSON
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shopee_order_settlements (
  id                        UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  source_platform           TEXT      NOT NULL DEFAULT 'shopee',

  external_order_id         TEXT      NOT NULL,                 -- หมายเลขคำสั่งซื้อ
  order_date                DATE,                               -- วันที่ทำการสั่งซื้อ
  paid_out_date             DATE,                               -- วันที่โอนชำระเงินสำเร็จ

  net_payout                NUMERIC,                           -- จำนวนเงินทั้งหมดที่โอนแล้ว (฿)
  commission                NUMERIC   DEFAULT 0,               -- ค่าคอมมิชชั่น
  service_fee               NUMERIC   DEFAULT 0,               -- ค่าบริการ
  payment_processing_fee    NUMERIC   DEFAULT 0,               -- ค่าธรรมเนียมการชำระเงิน
  platform_infra_fee        NUMERIC   DEFAULT 0,               -- ค่าโครงสร้างพื้นฐานแพลตฟอร์ม
  shipping_buyer_paid       NUMERIC   DEFAULT 0,               -- ค่าจัดส่งที่ผู้ซื้อชำระ
  refunds                   NUMERIC   DEFAULT 0,               -- เงินที่คืนให้ผู้ซื้อ

  raw                       JSONB,                             -- full row for audit / future fields
  import_batch_id           UUID      REFERENCES import_batches(id),
  created_by                UUID      NOT NULL REFERENCES auth.users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source_platform, external_order_id, paid_out_date)
);

-- Indexes for shopee_order_settlements
CREATE INDEX IF NOT EXISTS idx_sos_created_by
  ON shopee_order_settlements(created_by);

CREATE INDEX IF NOT EXISTS idx_sos_paid_out_date
  ON shopee_order_settlements(paid_out_date DESC);

CREATE INDEX IF NOT EXISTS idx_sos_order_date
  ON shopee_order_settlements(order_date DESC);

CREATE INDEX IF NOT EXISTS idx_sos_external_order_id
  ON shopee_order_settlements(external_order_id);

CREATE INDEX IF NOT EXISTS idx_sos_import_batch
  ON shopee_order_settlements(import_batch_id);

-- RLS
ALTER TABLE shopee_order_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sos_select_own"  ON shopee_order_settlements FOR SELECT USING (created_by = auth.uid());
CREATE POLICY "sos_insert_own"  ON shopee_order_settlements FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "sos_update_own"  ON shopee_order_settlements FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "sos_delete_own"  ON shopee_order_settlements FOR DELETE USING (created_by = auth.uid());
