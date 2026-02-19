'use server'

/**
 * Shopee Orders Import Server Actions
 *
 * Handles creating import batches for Shopee orders.csv
 * Data insertion reuses importSalesChunk + finalizeImportBatch from sales-import-actions.ts
 * (both are platform-agnostic)
 */

import { createClient } from '@/lib/supabase/server'

// ============================================================
// Create Shopee Orders Import Batch
// ============================================================

/**
 * Create an import batch record for Shopee orders
 * @param formData - fileHash, fileName, totalRows, dateRange, allowReimport
 */
export async function createShopeeOrdersBatch(
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
    const dateRange = formData.get('dateRange') as string
    const allowReimport = formData.get('allowReimport') === 'true'

    if (!fileHash || !fileName || isNaN(totalRows)) {
      return { success: false, error: 'Missing required fields: fileHash, fileName, or totalRows' }
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Authentication required' }
    }

    // Dedup check
    if (!allowReimport) {
      const { data: existingBatch } = await supabase
        .from('import_batches')
        .select('id, file_name, created_at, status, inserted_count')
        .eq('file_hash', fileHash)
        .eq('marketplace', 'shopee')
        .eq('report_type', 'shopee_orders')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingBatch) {
        const { count: actualCount } = await supabase
          .from('sales_orders')
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

    // Check already processing
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: existingProcessing } = await supabase
      .from('import_batches')
      .select('id, created_at, file_name')
      .eq('file_hash', fileHash)
      .eq('marketplace', 'shopee')
      .eq('report_type', 'shopee_orders')
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
        fileName: existingProcessing.file_name ?? fileName,
        message: 'กำลัง import ไฟล์นี้อยู่ กรุณารอสักครู่',
      }
    }

    // Create batch
    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        file_hash: fileHash,
        marketplace: 'shopee',
        report_type: 'shopee_orders',
        period: dateRange,
        file_name: fileName,
        row_count: totalRows,
        inserted_count: 0,
        updated_count: 0,
        skipped_count: 0,
        error_count: 0,
        status: 'processing',
        created_by: user.id,
      })
      .select()
      .single()

    if (batchError || !batch) {
      console.error('[createShopeeOrdersBatch] Error:', batchError)
      return { success: false, error: 'Failed to create import batch' }
    }

    return { success: true, status: 'created', batchId: batch.id }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: msg }
  }
}

// ============================================================
// Replace Shopee Orders Batch
// ============================================================

/**
 * Delete rows for existing batch and mark it as replaced
 * @param formData - existingBatchId, fileHash
 */
export async function replaceShopeeOrdersBatch(
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

    // Verify batch ownership
    const { data: existingBatch } = await supabase
      .from('import_batches')
      .select('id, file_hash, inserted_count')
      .eq('id', existingBatchId)
      .eq('marketplace', 'shopee')
      .eq('report_type', 'shopee_orders')
      .eq('created_by', user.id)
      .single()

    if (!existingBatch || existingBatch.file_hash !== fileHash) {
      return { success: false, error: 'Batch not found or file hash mismatch' }
    }

    // Delete sales_orders
    const { error: deleteError, count: deletedCount } = await supabase
      .from('sales_orders')
      .delete({ count: 'exact' })
      .eq('import_batch_id', existingBatchId)
      .eq('created_by', user.id)

    if (deleteError) {
      return { success: false, error: `Delete failed: ${deleteError.message}` }
    }

    // Mark batch as replaced
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
