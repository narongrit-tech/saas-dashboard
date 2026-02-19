-- migration-062-shopee-wallet-transactions.sql
-- Add marketplace_wallet_transactions table for Shopee (and future marketplaces) wallet data
-- Compatible with existing TikTok wallet_ledger structure; this is a separate log per platform

-- ============================================================
-- Table: marketplace_wallet_transactions
-- Stores raw wallet/cashflow transactions imported from
-- marketplace platforms (Shopee Transaction Report, etc.)
-- ============================================================

create table if not exists marketplace_wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),

  -- Platform identification
  platform text not null,                         -- 'shopee' | 'tiktok' | 'lazada'
  occurred_at timestamptz not null,               -- Transaction datetime (Bangkok→UTC)
  transaction_type text not null,                 -- 'รายรับจากคำสั่งซื้อ' | 'การถอนเงิน' | etc.
  direction text not null,                        -- 'credit' | 'debit'
  amount numeric(12,2) not null,                  -- Always positive; use direction for sign
  currency text not null default 'THB',

  -- Reference linking
  ref_type text,                                  -- 'shopee_order' | 'shopee_withdrawal' | 'shopee_other'
  ref_id text,                                    -- Order ID / withdrawal ref (null → '-')
  description text,                               -- Transaction description (คำอธิบาย)
  status text,                                    -- Transaction status (สถานะ)
  balance_after numeric(12,2),                    -- Running balance after transaction

  -- Import tracking
  import_batch_id uuid references import_batches(id),
  source_file_name text,
  source_row_number int,
  txn_hash text not null,                         -- SHA1 dedup hash

  -- Deduplication: one transaction per platform per hash
  constraint marketplace_wallet_transactions_platform_txn_hash_key unique (platform, txn_hash)
);

-- Indexes for common query patterns
create index if not exists idx_mwtx_created_by
  on marketplace_wallet_transactions(created_by);

create index if not exists idx_mwtx_platform_occurred_at
  on marketplace_wallet_transactions(platform, occurred_at);

create index if not exists idx_mwtx_platform_ref_id
  on marketplace_wallet_transactions(platform, ref_id)
  where ref_id is not null;

create index if not exists idx_mwtx_import_batch_id
  on marketplace_wallet_transactions(import_batch_id)
  where import_batch_id is not null;

-- ============================================================
-- RLS Policies
-- ============================================================

alter table marketplace_wallet_transactions enable row level security;

-- Users can only see their own transactions
create policy "Users can view own marketplace wallet transactions"
  on marketplace_wallet_transactions
  for select
  using (created_by = auth.uid());

-- Users can insert their own transactions
create policy "Users can insert own marketplace wallet transactions"
  on marketplace_wallet_transactions
  for insert
  with check (created_by = auth.uid());

-- Users can update their own transactions
create policy "Users can update own marketplace wallet transactions"
  on marketplace_wallet_transactions
  for update
  using (created_by = auth.uid());

-- Users can delete their own transactions
create policy "Users can delete own marketplace wallet transactions"
  on marketplace_wallet_transactions
  for delete
  using (created_by = auth.uid());

-- ============================================================
-- Auto-update updated_at trigger
-- ============================================================

create or replace function update_marketplace_wallet_transactions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger marketplace_wallet_transactions_updated_at
  before update on marketplace_wallet_transactions
  for each row
  execute function update_marketplace_wallet_transactions_updated_at();

-- ============================================================
-- Comments for documentation
-- ============================================================

comment on table marketplace_wallet_transactions is
  'Raw wallet/cashflow transactions imported from marketplace platforms (Shopee, TikTok, etc.)';

comment on column marketplace_wallet_transactions.platform is
  'Source platform: shopee | tiktok | lazada';

comment on column marketplace_wallet_transactions.direction is
  'credit = money in (เงินเข้า), debit = money out (เงินออก)';

comment on column marketplace_wallet_transactions.ref_type is
  'shopee_order = linked to order, shopee_withdrawal = cash withdrawal, shopee_other = misc';

comment on column marketplace_wallet_transactions.txn_hash is
  'SHA256(platform|occurred_at|transaction_type|direction|amount|ref_id|balance_after) for dedup';
