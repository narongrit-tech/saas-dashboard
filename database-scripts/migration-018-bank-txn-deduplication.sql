-- Migration 018: Bank Transaction Deduplication
-- Purpose: Add txn_hash for preventing duplicate imports
-- Created: 2026-01-25

-- ============================================================================
-- Add txn_hash column to bank_transactions
-- ============================================================================

ALTER TABLE public.bank_transactions
ADD COLUMN IF NOT EXISTS txn_hash VARCHAR(64);

-- ============================================================================
-- Create unique index for deduplication
-- ============================================================================

-- Drop existing index if it exists (for idempotency)
DROP INDEX IF EXISTS idx_bank_transactions_unique_hash;

-- Create unique index: one transaction per user per bank account per hash
CREATE UNIQUE INDEX idx_bank_transactions_unique_hash
  ON public.bank_transactions(created_by, bank_account_id, txn_hash)
  WHERE txn_hash IS NOT NULL;

-- ============================================================================
-- Create index for faster hash lookups
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_bank_transactions_hash
  ON public.bank_transactions(txn_hash)
  WHERE txn_hash IS NOT NULL;

-- ============================================================================
-- Function: Generate transaction hash
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_bank_txn_hash(
  p_bank_account_id UUID,
  p_txn_date DATE,
  p_withdrawal NUMERIC,
  p_deposit NUMERIC,
  p_description TEXT
) RETURNS VARCHAR(64) AS $$
BEGIN
  -- Generate SHA256 hash from transaction key fields
  -- Format: bank_account_id|txn_date|withdrawal|deposit|description
  RETURN encode(
    digest(
      p_bank_account_id::TEXT || '|' ||
      p_txn_date::TEXT || '|' ||
      COALESCE(p_withdrawal, 0)::TEXT || '|' ||
      COALESCE(p_deposit, 0)::TEXT || '|' ||
      COALESCE(p_description, ''),
      'sha256'
    ),
    'hex'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- Backfill txn_hash for existing records (optional)
-- ============================================================================

-- Uncomment to backfill (run once after migration)
-- UPDATE public.bank_transactions
-- SET txn_hash = public.generate_bank_txn_hash(
--   bank_account_id,
--   txn_date,
--   withdrawal,
--   deposit,
--   description
-- )
-- WHERE txn_hash IS NULL;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON COLUMN public.bank_transactions.txn_hash IS
  'SHA256 hash for deduplication. Generated from: bank_account_id|txn_date|withdrawal|deposit|description';

COMMENT ON FUNCTION public.generate_bank_txn_hash IS
  'Generates SHA256 hash for bank transaction deduplication';
