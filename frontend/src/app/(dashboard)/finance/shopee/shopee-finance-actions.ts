'use server'

/**
 * Shopee Finance Server Actions
 *
 * Handles importing:
 * 1. "My Balance Transaction Report" → shopee_wallet_transactions
 * 2. "Income / โอนเงินสำเร็จ"       → shopee_order_settlements
 *
 * Also exports summary query for the Finance > Shopee page.
 */

import { unstable_noStore as noStore } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { ShopeeBalanceTransaction } from '@/lib/importers/shopee-balance-parser'
import { ShopeeSettlementRow } from '@/lib/importers/shopee-settlement-parser'

// ============================================================
// Shared result types
// ============================================================

export interface ShopeeImportBatchResult {
  success: boolean
  status?: string
  batchId?: string
  error?: string
  fileName?: string
  importedAt?: string
  existingBatchId?: string
  existingRowCount?: number
  message?: string
}

export interface ShopeeImportChunkResult {
  success: boolean
  inserted: number
  skipped: number
  error?: string
}

export interface ShopeeImportFinalResult {
  success: boolean
  batchId?: string
  inserted: number
  skipped: number
  errors: number
  error?: string
}

// ============================================================
// SECTION A — shopee_wallet_transactions (Balance Report)
// ============================================================

export async function createShopeeBalanceBatch(formData: FormData): Promise<ShopeeImportBatchResult> {
  const supabase = createClient()
  try {
    const fileHash  = formData.get('fileHash')  as string
    const fileName  = formData.get('fileName')  as string
    const totalRows = parseInt(formData.get('totalRows') as string, 10)
    const dateRange = (formData.get('dateRange') as string) || ''
    const allowReimport = formData.get('allowReimport') === 'true'

    if (!fileHash || !fileName || isNaN(totalRows)) {
      return { success: false, error: 'Missing required fields' }
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Authentication required' }

    if (!allowReimport) {
      const { data: existing } = await supabase
        .from('import_batches')
        .select('id, file_name, created_at, inserted_count')
        .eq('file_hash', fileHash)
        .eq('marketplace', 'shopee')
        .eq('report_type', 'shopee_balance_transactions')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existing) {
        const { count } = await supabase
          .from('shopee_wallet_transactions')
          .select('*', { count: 'exact', head: true })
          .eq('import_batch_id', existing.id)

        const verifiedCount = count ?? 0
        if (verifiedCount > 0) {
          return {
            success: false,
            status: 'duplicate_file',
            fileName: existing.file_name ?? fileName,
            importedAt: existing.created_at,
            message: `ไฟล์นี้ถูก import ไปแล้ว (${verifiedCount} รายการในระบบ)`,
            existingBatchId: existing.id,
            existingRowCount: verifiedCount,
          }
        }
      }
    }

    // Prevent re-processing (30-min window)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: processing } = await supabase
      .from('import_batches')
      .select('id')
      .eq('file_hash', fileHash)
      .eq('marketplace', 'shopee')
      .eq('report_type', 'shopee_balance_transactions')
      .eq('created_by', user.id)
      .eq('status', 'processing')
      .gte('created_at', thirtyMinAgo)
      .limit(1)
      .maybeSingle()

    if (processing) {
      return { success: false, status: 'already_processing', batchId: processing.id, message: 'กำลัง import อยู่ กรุณารอสักครู่' }
    }

    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        file_hash: fileHash,
        marketplace: 'shopee',
        report_type: 'shopee_balance_transactions',
        period: dateRange,
        file_name: fileName,
        row_count: totalRows,
        inserted_count: 0,
        skipped_count: 0,
        error_count: 0,
        status: 'processing',
        created_by: user.id,
      })
      .select()
      .single()

    if (batchError || !batch) {
      console.error('[createShopeeBalanceBatch]', batchError)
      return { success: false, error: 'Failed to create import batch' }
    }

    return { success: true, status: 'created', batchId: batch.id }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function importShopeeBalanceChunk(formData: FormData): Promise<ShopeeImportChunkResult> {
  const supabase = createClient()
  try {
    const batchId       = formData.get('batchId')       as string
    const chunkDataJson = formData.get('chunkDataJson') as string
    const chunkIndex    = parseInt(formData.get('chunkIndex')    as string, 10)
    const totalChunks   = parseInt(formData.get('totalChunks')   as string, 10)

    if (!batchId || !chunkDataJson) {
      return { success: false, inserted: 0, skipped: 0, error: 'Missing required fields' }
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, inserted: 0, skipped: 0, error: 'Authentication required' }

    const chunk: ShopeeBalanceTransaction[] = JSON.parse(chunkDataJson)

    const rows = chunk.map((tx) => ({
      source_platform:  'shopee',
      occurred_at:      tx.occurred_at,
      transaction_type: tx.transaction_type,
      transaction_mode: tx.transaction_mode,
      ref_no:           tx.ref_no,
      status:           tx.status,
      amount:           tx.amount,
      balance:          tx.balance,
      raw:              tx.raw,
      import_batch_id:  batchId,
      created_by:       user.id,
    }))

    const { data: upserted, error: upsertError } = await supabase
      .from('shopee_wallet_transactions')
      .upsert(rows, {
        onConflict: 'source_platform,ref_no,occurred_at,amount',
        ignoreDuplicates: true,
      })
      .select('id')

    if (upsertError) {
      console.error(`[importShopeeBalanceChunk] chunk ${chunkIndex + 1}/${totalChunks}:`, upsertError)
      await supabase
        .from('import_batches')
        .update({ status: 'failed', notes: `Chunk ${chunkIndex + 1}/${totalChunks} failed: ${upsertError.message}` })
        .eq('id', batchId)
      return { success: false, inserted: 0, skipped: 0, error: upsertError.message }
    }

    const inserted = upserted?.length ?? 0
    const skipped  = chunk.length - inserted
    console.log(`[importShopeeBalanceChunk] ${inserted} inserted, ${skipped} skipped`)
    return { success: true, inserted, skipped }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    const batchId = formData.get('batchId') as string
    if (batchId) {
      const supabase2 = createClient()
      await supabase2.from('import_batches').update({ status: 'failed', notes: msg }).eq('id', batchId)
    }
    return { success: false, inserted: 0, skipped: 0, error: msg }
  }
}

export async function finalizeShopeeBalanceBatch(formData: FormData): Promise<ShopeeImportFinalResult> {
  const supabase = createClient()
  try {
    const batchId      = formData.get('batchId')      as string
    const totalInserted = parseInt(formData.get('totalInserted') as string, 10)
    const totalSkipped  = parseInt(formData.get('totalSkipped')  as string, 10)

    if (!batchId) return { success: false, inserted: 0, skipped: 0, errors: 0, error: 'Missing batchId' }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, inserted: 0, skipped: 0, errors: 0, error: 'Authentication required' }

    await supabase
      .from('import_batches')
      .update({
        status: 'success',
        inserted_count: totalInserted,
        skipped_count: totalSkipped,
        updated_at: new Date().toISOString(),
      })
      .eq('id', batchId)
      .eq('created_by', user.id)

    return { success: true, batchId, inserted: totalInserted, skipped: totalSkipped, errors: 0 }
  } catch (err: unknown) {
    return { success: false, inserted: 0, skipped: 0, errors: 0, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ============================================================
// SECTION B — shopee_order_settlements (Income Report)
// ============================================================

export async function createShopeeSettlementBatch(formData: FormData): Promise<ShopeeImportBatchResult> {
  const supabase = createClient()
  try {
    const fileHash  = formData.get('fileHash')  as string
    const fileName  = formData.get('fileName')  as string
    const totalRows = parseInt(formData.get('totalRows') as string, 10)
    const dateRange = (formData.get('dateRange') as string) || ''
    const allowReimport = formData.get('allowReimport') === 'true'

    if (!fileHash || !fileName || isNaN(totalRows)) {
      return { success: false, error: 'Missing required fields' }
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Authentication required' }

    if (!allowReimport) {
      const { data: existing } = await supabase
        .from('import_batches')
        .select('id, file_name, created_at, inserted_count')
        .eq('file_hash', fileHash)
        .eq('marketplace', 'shopee')
        .eq('report_type', 'shopee_order_settlements')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existing) {
        const { count } = await supabase
          .from('shopee_order_settlements')
          .select('*', { count: 'exact', head: true })
          .eq('import_batch_id', existing.id)

        const verifiedCount = count ?? 0
        if (verifiedCount > 0) {
          return {
            success: false,
            status: 'duplicate_file',
            fileName: existing.file_name ?? fileName,
            importedAt: existing.created_at,
            message: `ไฟล์นี้ถูก import ไปแล้ว (${verifiedCount} รายการในระบบ)`,
            existingBatchId: existing.id,
            existingRowCount: verifiedCount,
          }
        }
      }
    }

    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: processing } = await supabase
      .from('import_batches')
      .select('id')
      .eq('file_hash', fileHash)
      .eq('marketplace', 'shopee')
      .eq('report_type', 'shopee_order_settlements')
      .eq('created_by', user.id)
      .eq('status', 'processing')
      .gte('created_at', thirtyMinAgo)
      .limit(1)
      .maybeSingle()

    if (processing) {
      return { success: false, status: 'already_processing', batchId: processing.id, message: 'กำลัง import อยู่ กรุณารอสักครู่' }
    }

    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        file_hash: fileHash,
        marketplace: 'shopee',
        report_type: 'shopee_order_settlements',
        period: dateRange,
        file_name: fileName,
        row_count: totalRows,
        inserted_count: 0,
        skipped_count: 0,
        error_count: 0,
        status: 'processing',
        created_by: user.id,
      })
      .select()
      .single()

    if (batchError || !batch) {
      console.error('[createShopeeSettlementBatch]', batchError)
      return { success: false, error: 'Failed to create import batch' }
    }

    return { success: true, status: 'created', batchId: batch.id }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function importShopeeSettlementChunk(formData: FormData): Promise<ShopeeImportChunkResult> {
  const supabase = createClient()
  try {
    const batchId       = formData.get('batchId')       as string
    const chunkDataJson = formData.get('chunkDataJson') as string
    const chunkIndex    = parseInt(formData.get('chunkIndex')    as string, 10)
    const totalChunks   = parseInt(formData.get('totalChunks')   as string, 10)

    if (!batchId || !chunkDataJson) {
      return { success: false, inserted: 0, skipped: 0, error: 'Missing required fields' }
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, inserted: 0, skipped: 0, error: 'Authentication required' }

    const chunk: ShopeeSettlementRow[] = JSON.parse(chunkDataJson)

    const rows = chunk.map((s) => ({
      source_platform:          'shopee',
      external_order_id:        s.external_order_id,
      order_date:               s.order_date,
      paid_out_date:            s.paid_out_date,
      net_payout:               s.net_payout,
      commission:               s.commission,
      service_fee:              s.service_fee,
      payment_processing_fee:   s.payment_processing_fee,
      platform_infra_fee:       s.platform_infra_fee,
      shipping_buyer_paid:      s.shipping_buyer_paid,
      refunds:                  s.refunds,
      raw:                      s.raw,
      import_batch_id:          batchId,
      created_by:               user.id,
    }))

    const { data: upserted, error: upsertError } = await supabase
      .from('shopee_order_settlements')
      .upsert(rows, {
        onConflict: 'source_platform,external_order_id,paid_out_date',
        ignoreDuplicates: true,
      })
      .select('id')

    if (upsertError) {
      console.error(`[importShopeeSettlementChunk] chunk ${chunkIndex + 1}/${totalChunks}:`, upsertError)
      await supabase
        .from('import_batches')
        .update({ status: 'failed', notes: `Chunk ${chunkIndex + 1}/${totalChunks} failed: ${upsertError.message}` })
        .eq('id', batchId)
      return { success: false, inserted: 0, skipped: 0, error: upsertError.message }
    }

    const inserted = upserted?.length ?? 0
    const skipped  = chunk.length - inserted
    console.log(`[importShopeeSettlementChunk] ${inserted} inserted, ${skipped} skipped`)
    return { success: true, inserted, skipped }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    const batchId = formData.get('batchId') as string
    if (batchId) {
      const supabase2 = createClient()
      await supabase2.from('import_batches').update({ status: 'failed', notes: msg }).eq('id', batchId)
    }
    return { success: false, inserted: 0, skipped: 0, error: msg }
  }
}

export async function finalizeShopeeSettlementBatch(formData: FormData): Promise<ShopeeImportFinalResult> {
  const supabase = createClient()
  try {
    const batchId       = formData.get('batchId')       as string
    const totalInserted = parseInt(formData.get('totalInserted') as string, 10)
    const totalSkipped  = parseInt(formData.get('totalSkipped')  as string, 10)
    const summaryJson   = formData.get('summaryJson') as string | null

    if (!batchId) return { success: false, inserted: 0, skipped: 0, errors: 0, error: 'Missing batchId' }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, inserted: 0, skipped: 0, errors: 0, error: 'Authentication required' }

    const summary = summaryJson ? JSON.parse(summaryJson) : null

    await supabase
      .from('import_batches')
      .update({
        status: 'success',
        inserted_count: totalInserted,
        skipped_count: totalSkipped,
        metadata: summary ? { settlementSummary: summary } : {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', batchId)
      .eq('created_by', user.id)

    return { success: true, batchId, inserted: totalInserted, skipped: totalSkipped, errors: 0 }
  } catch (err: unknown) {
    return { success: false, inserted: 0, skipped: 0, errors: 0, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ============================================================
// SECTION C — Summary Query for Finance > Shopee page
// ============================================================

export interface ShopeeFinanceSummary {
  netOrderSettlement: number  // SUM(net_payout) from settlements
  walletNetChange: number     // SUM(amount) from wallet txns (signed)
  bankTransferOut: number     // SUM(ABS(amount)) for withdrawal rows
  settledOrderCount: number
  walletTxnCount: number
}

export interface ShopeeFinanceSettlementRow {
  id: string
  external_order_id: string
  paid_out_date: string | null
  order_date: string | null
  net_payout: number
  commission: number
  service_fee: number
  payment_processing_fee: number
  platform_infra_fee: number
  shipping_buyer_paid: number
  refunds: number
}

export interface ShopeeFinanceWalletRow {
  id: string
  occurred_at: string
  transaction_type: string
  transaction_mode: string | null
  ref_no: string | null
  status: string | null
  amount: number
  balance: number | null
}

export async function getShopeeFinanceSummary(params?: {
  startDate?: string
  endDate?: string
}): Promise<{
  summary: ShopeeFinanceSummary
  settlements: ShopeeFinanceSettlementRow[]
  walletTxns: ShopeeFinanceWalletRow[]
}> {
  noStore()
  const supabase = createClient()

  const emptySummary: ShopeeFinanceSummary = {
    netOrderSettlement: 0,
    walletNetChange: 0,
    bankTransferOut: 0,
    settledOrderCount: 0,
    walletTxnCount: 0,
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { summary: emptySummary, settlements: [], walletTxns: [] }
  }

  const { startDate, endDate } = params ?? {}

  // ── Aggregate queries (all rows, minimal columns) ──────────────
  let settleAggQ = supabase
    .from('shopee_order_settlements')
    .select('net_payout')
    .eq('created_by', user.id)

  let walletAggQ = supabase
    .from('shopee_wallet_transactions')
    .select('amount, transaction_type, status')
    .eq('created_by', user.id)

  if (startDate) {
    settleAggQ = settleAggQ.gte('paid_out_date', startDate)
    walletAggQ = walletAggQ.gte('occurred_at', `${startDate}T00:00:00+07:00`)
  }
  if (endDate) {
    settleAggQ = settleAggQ.lte('paid_out_date', endDate)
    walletAggQ = walletAggQ.lte('occurred_at', `${endDate}T23:59:59+07:00`)
  }

  // ── Display queries (200 most recent rows, all columns) ─────────
  let settleDispQ = supabase
    .from('shopee_order_settlements')
    .select('id, external_order_id, paid_out_date, order_date, net_payout, commission, service_fee, payment_processing_fee, platform_infra_fee, shipping_buyer_paid, refunds')
    .eq('created_by', user.id)
    .order('paid_out_date', { ascending: false })
    .limit(200)

  let walletDispQ = supabase
    .from('shopee_wallet_transactions')
    .select('id, occurred_at, transaction_type, transaction_mode, ref_no, status, amount, balance')
    .eq('created_by', user.id)
    .order('occurred_at', { ascending: false })
    .limit(200)

  if (startDate) {
    settleDispQ = settleDispQ.gte('paid_out_date', startDate)
    walletDispQ = walletDispQ.gte('occurred_at', `${startDate}T00:00:00+07:00`)
  }
  if (endDate) {
    settleDispQ = settleDispQ.lte('paid_out_date', endDate)
    walletDispQ = walletDispQ.lte('occurred_at', `${endDate}T23:59:59+07:00`)
  }

  const [
    { data: allSettlements },
    { data: allWalletTxns },
    { data: settlements },
    { data: walletTxns },
  ] = await Promise.all([settleAggQ, walletAggQ, settleDispQ, walletDispQ])

  // ── Compute metrics ────────────────────────────────────────────
  const netOrderSettlement = (allSettlements ?? []).reduce((s, r) => s + (r.net_payout ?? 0), 0)
  const walletNetChange    = (allWalletTxns ?? []).reduce((s, r) => s + (r.amount ?? 0), 0)
  const bankTransferOut    = (allWalletTxns ?? [])
    .filter((r) => r.transaction_type?.includes('การถอนเงิน') && r.status?.includes('สำเร็จ'))
    .reduce((s, r) => s + Math.abs(r.amount ?? 0), 0)

  return {
    summary: {
      netOrderSettlement,
      walletNetChange,
      bankTransferOut,
      settledOrderCount: (allSettlements ?? []).length,
      walletTxnCount: (allWalletTxns ?? []).length,
    },
    settlements: (settlements ?? []) as ShopeeFinanceSettlementRow[],
    walletTxns: (walletTxns ?? []) as ShopeeFinanceWalletRow[],
  }
}
