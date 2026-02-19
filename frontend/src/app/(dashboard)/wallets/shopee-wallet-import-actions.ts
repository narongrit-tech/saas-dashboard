'use server'

/**
 * Shopee Wallet Transaction Import Server Actions
 *
 * Handles importing Shopee Transaction Report CSV into
 * marketplace_wallet_transactions table.
 */

import { createClient } from '@/lib/supabase/server'
import { ShopeeWalletTransaction } from '@/lib/importers/shopee-wallet-parser'

// ============================================================
// Types
// ============================================================

export interface ShopeeWalletImportResult {
  success: boolean
  batchId?: string
  inserted: number
  skipped: number
  errors: number
  error?: string
  summary?: {
    totalCredit: number
    totalDebit: number
    netAmount: number
  }
}

// ============================================================
// Create Shopee Wallet Import Batch
// ============================================================

/**
 * Create import batch for Shopee wallet transactions
 * @param formData - fileHash, fileName, totalRows, dateRange, allowReimport
 */
export async function createShopeeWalletBatch(
  formData: FormData
): Promise<{
  success: boolean
  status?: string
  batchId?: string
  error?: string
  fileName?: string
  importedAt?: string
  existingBatchId?: string
  existingRowCount?: number
  message?: string
}> {
  const supabase = createClient()

  try {
    const fileHash = formData.get('fileHash') as string
    const fileName = formData.get('fileName') as string
    const totalRows = parseInt(formData.get('totalRows') as string, 10)
    const dateRange = (formData.get('dateRange') as string) || ''
    const allowReimport = formData.get('allowReimport') === 'true'

    if (!fileHash || !fileName || isNaN(totalRows)) {
      return { success: false, error: 'Missing required fields' }
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Authentication required' }
    }

    if (!allowReimport) {
      const { data: existingBatch } = await supabase
        .from('import_batches')
        .select('id, file_name, created_at, inserted_count')
        .eq('file_hash', fileHash)
        .eq('marketplace', 'shopee')
        .eq('report_type', 'shopee_wallet_transactions')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingBatch) {
        const { count: actualCount } = await supabase
          .from('marketplace_wallet_transactions')
          .select('*', { count: 'exact', head: true })
          .eq('import_batch_id', existingBatch.id)

        const verifiedCount = actualCount ?? 0
        if (verifiedCount > 0) {
          return {
            success: false,
            status: 'duplicate_file',
            fileName: existingBatch.file_name ?? fileName,
            importedAt: existingBatch.created_at,
            message: `ไฟล์นี้ถูก import ไปแล้ว (${verifiedCount} รายการในระบบ)`,
            existingBatchId: existingBatch.id,
            existingRowCount: verifiedCount,
          }
        }
      }
    }

    // Check processing
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: existingProcessing } = await supabase
      .from('import_batches')
      .select('id, file_name')
      .eq('file_hash', fileHash)
      .eq('marketplace', 'shopee')
      .eq('report_type', 'shopee_wallet_transactions')
      .eq('created_by', user.id)
      .eq('status', 'processing')
      .gte('created_at', thirtyMinAgo)
      .limit(1)
      .maybeSingle()

    if (existingProcessing) {
      return {
        success: false,
        status: 'already_processing',
        batchId: existingProcessing.id,
        message: 'กำลัง import ไฟล์นี้อยู่ กรุณารอสักครู่',
      }
    }

    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        file_hash: fileHash,
        marketplace: 'shopee',
        report_type: 'shopee_wallet_transactions',
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
      console.error('[createShopeeWalletBatch] Error:', batchError)
      return { success: false, error: 'Failed to create import batch' }
    }

    return { success: true, status: 'created', batchId: batch.id }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: msg }
  }
}

// ============================================================
// Import Shopee Wallet Chunk
// ============================================================

/**
 * Insert a chunk of Shopee wallet transactions
 * @param formData - batchId, chunkDataJson, chunkIndex, totalChunks
 */
export async function importShopeeWalletChunk(
  formData: FormData
): Promise<{ success: boolean; inserted: number; skipped: number; error?: string }> {
  const supabase = createClient()

  try {
    const batchId = formData.get('batchId') as string
    const chunkDataJson = formData.get('chunkDataJson') as string
    const chunkIndex = parseInt(formData.get('chunkIndex') as string, 10)
    const totalChunks = parseInt(formData.get('totalChunks') as string, 10)
    const sourceFileName = (formData.get('sourceFileName') as string) ?? ''

    if (!batchId || !chunkDataJson) {
      return { success: false, inserted: 0, skipped: 0, error: 'Missing required fields' }
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, inserted: 0, skipped: 0, error: 'Authentication required' }
    }

    const chunkData: ShopeeWalletTransaction[] = JSON.parse(chunkDataJson)

    const rows = chunkData.map((tx) => ({
      platform: 'shopee',
      occurred_at: tx.occurred_at,
      transaction_type: tx.transaction_type,
      direction: tx.direction,
      amount: tx.amount,
      currency: 'THB',
      ref_type: tx.ref_type,
      ref_id: tx.ref_id,
      description: tx.description,
      status: tx.status,
      balance_after: tx.balance_after,
      import_batch_id: batchId,
      source_file_name: sourceFileName,
      source_row_number: tx.source_row_number,
      txn_hash: tx.txn_hash,
      created_by: user.id,
    }))

    // Use upsert with onConflict = (platform, txn_hash) for idempotency
    const { data: upserted, error: upsertError } = await supabase
      .from('marketplace_wallet_transactions')
      .upsert(rows, {
        onConflict: 'platform,txn_hash',
        ignoreDuplicates: true, // Skip duplicates (count as skipped)
      })
      .select('id')

    if (upsertError) {
      console.error(`[importShopeeWalletChunk] Upsert error (chunk ${chunkIndex + 1}/${totalChunks}):`, upsertError)
      await supabase
        .from('import_batches')
        .update({ status: 'failed', notes: `Chunk ${chunkIndex + 1}/${totalChunks} failed: ${upsertError.message}` })
        .eq('id', batchId)

      return { success: false, inserted: 0, skipped: 0, error: upsertError.message }
    }

    const inserted = upserted?.length ?? 0
    const skipped = chunkData.length - inserted

    console.log(`[importShopeeWalletChunk] Chunk ${chunkIndex + 1}/${totalChunks}: ${inserted} inserted, ${skipped} skipped`)

    return { success: true, inserted, skipped }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    const batchId = formData.get('batchId') as string
    if (batchId) {
      await supabase
        .from('import_batches')
        .update({ status: 'failed', notes: `Chunk import error: ${msg}` })
        .eq('id', batchId)
    }
    return { success: false, inserted: 0, skipped: 0, error: msg }
  }
}

// ============================================================
// Finalize Shopee Wallet Batch
// ============================================================

/**
 * Finalize the import batch with final counts
 * @param formData - batchId, totalInserted, totalSkipped, summaryJson
 */
export async function finalizeShopeeWalletBatch(
  formData: FormData
): Promise<ShopeeWalletImportResult> {
  const supabase = createClient()

  try {
    const batchId = formData.get('batchId') as string
    const totalInserted = parseInt(formData.get('totalInserted') as string, 10)
    const totalSkipped = parseInt(formData.get('totalSkipped') as string, 10)
    const summaryJson = formData.get('summaryJson') as string

    if (!batchId) {
      return { success: false, inserted: 0, skipped: 0, errors: 0, error: 'Missing batchId' }
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, inserted: 0, skipped: 0, errors: 0, error: 'Authentication required' }
    }

    const summary = summaryJson ? JSON.parse(summaryJson) : null

    // Update batch status
    await supabase
      .from('import_batches')
      .update({
        status: 'success',
        inserted_count: totalInserted,
        skipped_count: totalSkipped,
        metadata: summary ? { walletSummary: summary } : {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', batchId)
      .eq('created_by', user.id)

    console.log(`[finalizeShopeeWalletBatch] ✓ Batch ${batchId}: ${totalInserted} inserted, ${totalSkipped} skipped`)

    return {
      success: true,
      batchId,
      inserted: totalInserted,
      skipped: totalSkipped,
      errors: 0,
      summary: summary ?? undefined,
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, inserted: 0, skipped: 0, errors: 0, error: msg }
  }
}

// ============================================================
// Delete Shopee Wallet Batch
// ============================================================

/**
 * Delete all transactions for an existing batch and mark it as replaced
 */
export async function replaceShopeeWalletBatch(
  formData: FormData
): Promise<{ success: boolean; error?: string; deletedCount?: number }> {
  const supabase = createClient()

  try {
    const existingBatchId = formData.get('existingBatchId') as string
    const fileHash = formData.get('fileHash') as string

    if (!existingBatchId || !fileHash) {
      return { success: false, error: 'Missing required fields' }
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Authentication required' }
    }

    const { data: existingBatch } = await supabase
      .from('import_batches')
      .select('id, file_hash')
      .eq('id', existingBatchId)
      .eq('marketplace', 'shopee')
      .eq('report_type', 'shopee_wallet_transactions')
      .eq('created_by', user.id)
      .single()

    if (!existingBatch || existingBatch.file_hash !== fileHash) {
      return { success: false, error: 'Batch not found or file hash mismatch' }
    }

    const { error: deleteError, count: deletedCount } = await supabase
      .from('marketplace_wallet_transactions')
      .delete({ count: 'exact' })
      .eq('import_batch_id', existingBatchId)
      .eq('created_by', user.id)

    if (deleteError) {
      return { success: false, error: `Delete failed: ${deleteError.message}` }
    }

    await supabase
      .from('import_batches')
      .update({ status: 'replaced', notes: `Replaced at ${new Date().toISOString()}` })
      .eq('id', existingBatchId)

    return { success: true, deletedCount: deletedCount ?? 0 }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: msg }
  }
}
