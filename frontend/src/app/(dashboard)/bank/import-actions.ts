'use server';

// Bank Statement Import Actions
// Handle file upload, parsing, preview, and import execution
// Created: 2026-01-25

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';
import {
  BankColumnMapping,
  BankStatementPreview,
  ImportBankStatementResponse,
  ParseBankStatementResponse,
} from '@/types/bank';
import {
  parseBankStatementAuto,
  parseWithMapping,
  parseBangkokDate,
} from '@/lib/parsers/bank-statement-parser';

// ============================================================================
// Transaction Hash Generation (for deduplication)
// ============================================================================

/**
 * Generate SHA256 hash for bank transaction deduplication
 * Matches PostgreSQL function: public.generate_bank_txn_hash
 * @param bankAccountId - Bank account UUID
 * @param txnDate - Transaction date (YYYY-MM-DD)
 * @param withdrawal - Withdrawal amount
 * @param deposit - Deposit amount
 * @param description - Transaction description
 */
function generateBankTxnHash(
  bankAccountId: string,
  txnDate: string,
  withdrawal: number,
  deposit: number,
  description: string | null
): string {
  // Format: bank_account_id|txn_date|withdrawal|deposit|description
  const hashInput = [
    bankAccountId,
    txnDate,
    (withdrawal || 0).toString(),
    (deposit || 0).toString(),
    description || '',
  ].join('|');

  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

// ============================================================================
// Client-side Parse (Preview)
// ============================================================================

export async function parseBankStatementForPreview(
  fileBuffer: ArrayBuffer,
  fileName: string,
  columnMapping?: BankColumnMapping
): Promise<ParseBankStatementResponse> {
  try {
    // Auto-parse or use provided mapping
    const parsed = columnMapping
      ? parseWithCustomMapping(fileBuffer, fileName, columnMapping)
      : parseBankStatementAuto(fileBuffer, fileName);

    if (parsed.requires_manual_mapping) {
      return {
        success: false,
        errors: parsed.errors,
      };
    }

    if (parsed.transactions.length === 0) {
      return {
        success: false,
        errors: ['No valid transactions found in file'],
      };
    }

    // Calculate file hash
    const buffer = Buffer.from(fileBuffer);
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Calculate summary
    const totalDeposits = parsed.transactions.reduce((sum, txn) => sum + txn.deposit, 0);
    const totalWithdrawals = parsed.transactions.reduce((sum, txn) => sum + txn.withdrawal, 0);
    const net = totalDeposits - totalWithdrawals;

    // Get date range
    const dates = parsed.transactions.map((t) => t.txn_date).sort();
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];

    // Sample rows (first 5)
    const sampleRows = parsed.transactions.slice(0, 5);

    const preview: BankStatementPreview = {
      file_name: fileName,
      file_hash: fileHash,
      date_range: {
        start: startDate,
        end: endDate,
      },
      total_deposits: totalDeposits,
      total_withdrawals: totalWithdrawals,
      net,
      row_count: parsed.transactions.length,
      sample_rows: sampleRows,
      errors: [],
      warnings: [],
    };

    return { success: true, data: preview };
  } catch (error) {
    console.error('parseBankStatementForPreview exception:', error);
    return {
      success: false,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

function parseWithCustomMapping(
  buffer: ArrayBuffer,
  fileName: string,
  mapping: BankColumnMapping
): ReturnType<typeof parseBankStatementAuto> {
  try {
    const XLSX = require('xlsx');
    const isCSV = fileName.toLowerCase().endsWith('.csv');
    const workbook = isCSV
      ? XLSX.read(buffer, { type: 'array', raw: true, codepage: 65001 })
      : XLSX.read(buffer, { type: 'array', raw: true });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });

    if (jsonData.length < 2) {
      return {
        transactions: [],
        format_type: 'generic',
        detected_columns: [],
        auto_mapping: null,
        requires_manual_mapping: true,
        errors: ['File has no data rows'],
      };
    }

    const headerRow = jsonData[0] as string[];
    const transactions = parseWithMapping(jsonData.slice(1), mapping, headerRow);

    return {
      transactions,
      format_type: 'generic',
      detected_columns: headerRow,
      auto_mapping: mapping,
      requires_manual_mapping: false,
      errors: transactions.length === 0 ? ['No valid transactions parsed'] : [],
    };
  } catch (error) {
    return {
      transactions: [],
      format_type: 'unknown',
      detected_columns: [],
      auto_mapping: null,
      requires_manual_mapping: true,
      errors: [error instanceof Error ? error.message : 'Parse error'],
    };
  }
}

// ============================================================================
// Server-side Import Execution
// ============================================================================

export async function importBankStatement(
  bankAccountId: string,
  fileBuffer: ArrayBuffer,
  fileName: string,
  columnMapping?: BankColumnMapping,
  importMode: 'append' | 'replace_range' | 'replace_all' = 'replace_range'
): Promise<ImportBankStatementResponse> {
  // Validate import mode
  if (!['append', 'replace_range', 'replace_all'].includes(importMode)) {
    return { success: false, error: `Invalid import mode: ${importMode}` };
  }

  console.log(`[Bank Import] Starting import with mode: ${importMode}`);

  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Verify bank account ownership
    const { data: account, error: accountError } = await supabase
      .from('bank_accounts')
      .select('id')
      .eq('id', bankAccountId)
      .eq('created_by', user.id)
      .single();

    if (accountError || !account) {
      return { success: false, error: 'Bank account not found or unauthorized' };
    }

    // Parse file
    const parsed = columnMapping
      ? parseWithCustomMapping(fileBuffer, fileName, columnMapping)
      : parseBankStatementAuto(fileBuffer, fileName);

    if (parsed.requires_manual_mapping) {
      return {
        success: false,
        error: 'Cannot auto-detect format. Please use manual column mapping.',
      };
    }

    if (parsed.transactions.length === 0) {
      return { success: false, error: 'No valid transactions found in file' };
    }

    // Calculate file hash
    const buffer = Buffer.from(fileBuffer);
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Check for existing batch (for all modes)
    const { data: existingBatch } = await supabase
      .from('bank_statement_import_batches')
      .select('id, imported_at, status, inserted_count, import_mode')
      .eq('bank_account_id', bankAccountId)
      .eq('file_hash', fileHash)
      .maybeSingle();

    // For append mode: reject if batch exists and completed
    if (importMode === 'append' && existingBatch && existingBatch.status === 'completed') {
      const importedAt = new Date(existingBatch.imported_at).toLocaleString('th-TH');
      return {
        success: false,
        error: `This file has already been imported on ${importedAt}. Use Import History to rollback if needed.`,
      };
    }

    // Get date range from parsed transactions
    const dates = parsed.transactions.map((t) => t.txn_date).sort();
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];

    // Delete existing transactions based on import mode
    let deletedCount = 0;

    if (importMode === 'replace_range') {
      console.log(`[Replace Range] Deleting transactions from ${startDate} to ${endDate}`);

      // Delete transactions in the file's date range
      // Include rows with created_by = user.id OR created_by IS NULL (legacy data cleanup)
      const { count, error: deleteError } = await supabase
        .from('bank_transactions')
        .delete({ count: 'exact' })
        .eq('bank_account_id', bankAccountId)
        .or(`created_by.eq.${user.id},created_by.is.null`)
        .gte('txn_date', startDate)
        .lte('txn_date', endDate);

      if (deleteError) {
        console.error('Delete transactions (replace_range) error:', deleteError);
        return {
          success: false,
          error: `Failed to delete existing transactions: ${deleteError.message}`,
        };
      }

      deletedCount = count || 0;
      console.log(`[Replace Range] ✓ Deleted ${deletedCount} transactions from ${startDate} to ${endDate}`);
    } else if (importMode === 'replace_all') {
      console.log(`[Replace All] Deleting ALL transactions for bank account ${bankAccountId}`);

      // Delete all transactions for this bank account
      // Include rows with created_by = user.id OR created_by IS NULL (legacy data cleanup)
      const { count, error: deleteError } = await supabase
        .from('bank_transactions')
        .delete({ count: 'exact' })
        .eq('bank_account_id', bankAccountId)
        .or(`created_by.eq.${user.id},created_by.is.null`);

      if (deleteError) {
        console.error('Delete transactions (replace_all) error:', deleteError);
        return {
          success: false,
          error: `Failed to delete existing transactions: ${deleteError.message}`,
        };
      }

      deletedCount = count || 0;
      console.log(`[Replace All] ✓ Deleted ${deletedCount} transactions for bank account ${bankAccountId}`);
    } else if (importMode === 'append') {
      console.log(`[Append] No deletion required (append mode)`);
    }

    // Create or reuse import batch (idempotent)
    let batch;

    if (existingBatch) {
      console.log(`[Batch] Reusing existing batch ${existingBatch.id} (status: ${existingBatch.status})`);

      // Reuse existing batch - reset status to pending and update metadata
      const { data: updatedBatch, error: updateError } = await supabase
        .from('bank_statement_import_batches')
        .update({
          status: 'pending',
          row_count: parsed.transactions.length,
          inserted_count: 0,
          import_mode: importMode,
          imported_at: new Date().toISOString(), // Update timestamp for re-import
          metadata: {
            format_type: parsed.format_type,
            column_mapping: parsed.auto_mapping || columnMapping,
            date_range: {
              start: startDate,
              end: endDate,
            },
            deleted_before_import: deletedCount,
            previous_status: existingBatch.status, // Track that this was a re-import
          },
        })
        .eq('id', existingBatch.id)
        .select()
        .single();

      if (updateError || !updatedBatch) {
        console.error('Update existing batch error:', updateError);
        return { success: false, error: 'Failed to reuse existing batch' };
      }

      batch = updatedBatch;
    } else {
      console.log(`[Batch] Creating new batch`);

      // Create new batch
      const { data: newBatch, error: batchError } = await supabase
        .from('bank_statement_import_batches')
        .insert({
          bank_account_id: bankAccountId,
          file_name: fileName,
          file_hash: fileHash,
          imported_by: user.id,
          row_count: parsed.transactions.length,
          inserted_count: 0,
          status: 'pending',
          import_mode: importMode,
          metadata: {
            format_type: parsed.format_type,
            column_mapping: parsed.auto_mapping || columnMapping,
            date_range: {
              start: startDate,
              end: endDate,
            },
            deleted_before_import: deletedCount,
          },
        })
        .select()
        .single();

      if (batchError || !newBatch) {
        console.error('Create import batch error:', batchError);

        // Check if it's a race condition (another process created the batch)
        if (batchError?.code === '23505' || batchError?.message?.includes('duplicate')) {
          return {
            success: false,
            error: 'This file is currently being imported by another process. Please wait and try again.',
          };
        }

        return { success: false, error: 'Failed to create import batch' };
      }

      batch = newBatch;
    }

    // Prepare transactions for insert (with txn_hash for deduplication)
    const transactionsToInsert = parsed.transactions.map((txn) => {
      const txnHash = generateBankTxnHash(
        bankAccountId,
        txn.txn_date,
        txn.withdrawal,
        txn.deposit,
        txn.description || null
      );

      return {
        bank_account_id: bankAccountId,
        import_batch_id: batch.id,
        txn_date: txn.txn_date,
        description: txn.description || null,
        withdrawal: txn.withdrawal,
        deposit: txn.deposit,
        balance: txn.balance,
        channel: txn.channel || null,
        reference_id: txn.reference_id || null,
        txn_hash: txnHash,
        raw: txn,
        created_by: user.id,
      };
    });

    // Bulk insert transactions with ON CONFLICT handling
    // Wrapped in try-finally to ensure batch status is ALWAYS updated
    let insertedCount = 0;
    let duplicateCount = 0;
    let importError: string | null = null;

    try {
      // Try bulk insert first
      const { data: insertedTxns, error: insertError } = await supabase
        .from('bank_transactions')
        .insert(transactionsToInsert)
        .select();

      if (insertError) {
        // Check if it's a duplicate key error (unique constraint violation)
        if (insertError.code === '23505' || insertError.message.includes('duplicate')) {
          // Some transactions are duplicates - insert one by one to identify which
          console.log('Duplicate transactions detected, inserting individually...');

          for (const txn of transactionsToInsert) {
            const { data: singleInsert, error: singleError } = await supabase
              .from('bank_transactions')
              .insert(txn)
              .select();

            if (singleError) {
              if (singleError.code === '23505' || singleError.message.includes('duplicate')) {
                duplicateCount++;
              } else {
                console.error('Insert transaction error:', singleError);
                // Continue with other transactions instead of failing completely
              }
            } else if (singleInsert && singleInsert.length > 0) {
              insertedCount++;
            }
          }
        } else {
          // Other error - record it but continue to finalize batch
          console.error('Insert bank transactions error:', insertError);
          importError = insertError.message;
        }
      } else {
        // Bulk insert succeeded - no duplicates
        insertedCount = insertedTxns?.length || 0;
      }
    } finally {
      // CRITICAL: Always finalize batch status based on actual results
      const finalStatus = importError && insertedCount === 0 ? 'failed' : 'completed';

      await supabase
        .from('bank_statement_import_batches')
        .update({
          status: finalStatus,
          inserted_count: insertedCount,
          metadata: {
            format_type: parsed.format_type,
            column_mapping: parsed.auto_mapping || columnMapping,
            duplicate_count: duplicateCount,
            total_rows: parsed.transactions.length,
            date_range: {
              start: startDate,
              end: endDate,
            },
            deleted_before_import: deletedCount,
            ...(importError ? { import_error: importError } : {}),
          },
        })
        .eq('id', batch.id);

      console.log(`[Import Finalized] Batch ${batch.id}: status=${finalStatus}, inserted=${insertedCount}, deleted=${deletedCount}`);
    }

    // If import failed and no transactions were inserted, return error
    if (importError && insertedCount === 0) {
      return { success: false, error: `Failed to insert transactions: ${importError}` };
    }

    revalidatePath('/bank');
    revalidatePath('/company-cashflow');
    revalidatePath('/bank-reconciliation');
    revalidatePath('/reconciliation');

    // Build message with deleted count and duplicate count
    let message = `Imported ${insertedCount} transactions`;
    const details: string[] = [];

    if (deletedCount > 0) {
      details.push(`deleted ${deletedCount} existing`);
    }
    if (duplicateCount > 0) {
      details.push(`${duplicateCount} duplicates skipped`);
    }

    if (details.length > 0) {
      message += ` (${details.join(', ')})`;
    }

    return {
      success: true,
      batchId: batch.id,
      insertedCount,
      message,
    };
  } catch (error) {
    console.error('importBankStatement exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Get Available Columns (for manual mapping)
// ============================================================================

export async function getBankStatementColumns(
  fileBuffer: ArrayBuffer,
  fileName: string
): Promise<{ success: boolean; columns?: string[]; error?: string }> {
  try {
    const XLSX = require('xlsx');
    const isCSV = fileName.toLowerCase().endsWith('.csv');
    const workbook = isCSV
      ? XLSX.read(fileBuffer, { type: 'array', raw: true, codepage: 65001 })
      : XLSX.read(fileBuffer, { type: 'array', raw: true });

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return { success: false, error: 'No worksheet found in file' };
    }

    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });

    if (jsonData.length === 0) {
      return { success: false, error: 'No data found in file' };
    }

    const headerRow = jsonData[0] as string[];
    const columns = headerRow.filter(Boolean);

    return { success: true, columns };
  } catch (error) {
    console.error('getBankStatementColumns exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Overlap Detection
// ============================================================================

/**
 * Check for overlapping transactions before import
 * Returns count of existing transactions in file's date range
 */
export async function checkImportOverlap(
  bankAccountId: string,
  fileBuffer: ArrayBuffer,
  fileName: string,
  columnMapping?: BankColumnMapping
): Promise<{
  success: boolean;
  overlap?: {
    existing_count: number;
    date_range: { start: string; end: string };
    file_count: number;
  };
  error?: string;
}> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Parse file to get date range
    const parsed = columnMapping
      ? parseWithCustomMapping(fileBuffer, fileName, columnMapping)
      : parseBankStatementAuto(fileBuffer, fileName);

    if (parsed.requires_manual_mapping) {
      return { success: false, error: 'Cannot parse file for overlap detection' };
    }

    if (parsed.transactions.length === 0) {
      return { success: false, error: 'No transactions found in file' };
    }

    // Get date range from file
    const dates = parsed.transactions.map((t) => t.txn_date).sort();
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];

    // Query existing transactions in this range
    const { count, error } = await supabase
      .from('bank_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('bank_account_id', bankAccountId)
      .eq('created_by', user.id)
      .gte('txn_date', startDate)
      .lte('txn_date', endDate);

    if (error) {
      console.error('checkImportOverlap query error:', error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      overlap: {
        existing_count: count || 0,
        date_range: { start: startDate, end: endDate },
        file_count: parsed.transactions.length,
      },
    };
  } catch (error) {
    console.error('checkImportOverlap exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Import History
// ============================================================================

/**
 * Get import history for a bank account
 * Returns list of past imports with metadata
 */
export async function getBankImportHistory(
  bankAccountId: string
): Promise<{
  success: boolean;
  data?: any[];
  error?: string;
}> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { data, error } = await supabase
      .from('bank_statement_import_batches')
      .select('*')
      .eq('bank_account_id', bankAccountId)
      .eq('imported_by', user.id)
      .order('imported_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('getBankImportHistory query error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (error) {
    console.error('getBankImportHistory exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Repair Utilities
// ============================================================================

/**
 * Repair pending import batches
 * Automatically marks batches as 'completed' if they have inserted rows but status is still 'pending'
 * This is a safety mechanism to fix batches that were interrupted before finalization
 */
export async function repairPendingBatches(
  bankAccountId: string
): Promise<{
  success: boolean;
  repaired_count?: number;
  message?: string;
  error?: string;
}> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Find pending batches with inserted rows
    const { data: pendingBatches, error: fetchError } = await supabase
      .from('bank_statement_import_batches')
      .select('id, inserted_count')
      .eq('bank_account_id', bankAccountId)
      .eq('imported_by', user.id)
      .eq('status', 'pending');

    if (fetchError) {
      console.error('repairPendingBatches fetch error:', fetchError);
      return { success: false, error: fetchError.message };
    }

    if (!pendingBatches || pendingBatches.length === 0) {
      return { success: true, repaired_count: 0, message: 'No pending batches to repair' };
    }

    let repairedCount = 0;

    // For each pending batch, check actual transaction count and update status
    for (const batch of pendingBatches) {
      // Query actual transaction count
      const { count: actualCount, error: countError } = await supabase
        .from('bank_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('import_batch_id', batch.id)
        .eq('created_by', user.id);

      if (countError) {
        console.error(`Error counting transactions for batch ${batch.id}:`, countError);
        continue;
      }

      // If batch has transactions, mark as completed
      if (actualCount && actualCount > 0) {
        const { error: updateError } = await supabase
          .from('bank_statement_import_batches')
          .update({
            status: 'completed',
            inserted_count: actualCount,
          })
          .eq('id', batch.id);

        if (updateError) {
          console.error(`Error updating batch ${batch.id}:`, updateError);
        } else {
          repairedCount++;
          console.log(`[Repaired] Batch ${batch.id}: ${actualCount} transactions found, marked as completed`);
        }
      } else {
        // No transactions found, mark as failed
        const { error: updateError } = await supabase
          .from('bank_statement_import_batches')
          .update({
            status: 'failed',
            inserted_count: 0,
          })
          .eq('id', batch.id);

        if (!updateError) {
          repairedCount++;
          console.log(`[Repaired] Batch ${batch.id}: No transactions found, marked as failed`);
        }
      }
    }

    return {
      success: true,
      repaired_count: repairedCount,
      message: `Repaired ${repairedCount} pending batches`,
    };
  } catch (error) {
    console.error('repairPendingBatches exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Rollback
// ============================================================================

/**
 * Rollback a bank import batch
 * Calls RPC function: rollback_bank_import_batch
 * Deletes transactions and marks batch as 'rolled_back'
 */
export async function rollbackBankImport(
  batchId: string
): Promise<{
  success: boolean;
  deleted_count?: number;
  message?: string;
  error?: string;
}> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Call RPC function
    const { data, error } = await supabase.rpc('rollback_bank_import_batch', {
      p_batch_id: batchId,
    });

    if (error) {
      console.error('rollbackBankImport RPC error:', error);
      return { success: false, error: error.message };
    }

    const result = data as { success: boolean; deleted_count?: number; error?: string };

    if (!result.success) {
      return { success: false, error: result.error || 'Rollback failed' };
    }

    // Revalidate affected paths
    revalidatePath('/bank');
    revalidatePath('/company-cashflow');
    revalidatePath('/bank-reconciliation');
    revalidatePath('/reconciliation');

    return {
      success: true,
      deleted_count: result.deleted_count,
      message: `Rollback successful: ${result.deleted_count} transactions deleted`,
    };
  } catch (error) {
    console.error('rollbackBankImport exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
