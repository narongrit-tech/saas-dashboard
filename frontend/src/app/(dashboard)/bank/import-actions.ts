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
  columnMapping?: BankColumnMapping
): Promise<ImportBankStatementResponse> {
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

    // Check for duplicate file hash
    const { data: existingBatch } = await supabase
      .from('bank_statement_import_batches')
      .select('id, imported_at')
      .eq('bank_account_id', bankAccountId)
      .eq('file_hash', fileHash)
      .single();

    if (existingBatch) {
      const importedAt = new Date(existingBatch.imported_at).toLocaleString('th-TH');
      return {
        success: false,
        error: `This file has already been imported on ${importedAt}`,
      };
    }

    // Create import batch
    const { data: batch, error: batchError } = await supabase
      .from('bank_statement_import_batches')
      .insert({
        bank_account_id: bankAccountId,
        file_name: fileName,
        file_hash: fileHash,
        imported_by: user.id,
        row_count: parsed.transactions.length,
        inserted_count: 0,
        status: 'pending',
        metadata: {
          format_type: parsed.format_type,
          column_mapping: parsed.auto_mapping || columnMapping,
        },
      })
      .select()
      .single();

    if (batchError || !batch) {
      console.error('Create import batch error:', batchError);
      return { success: false, error: 'Failed to create import batch' };
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
    // Note: Supabase doesn't support ON CONFLICT in JS client, so we handle errors
    let insertedCount = 0;
    let duplicateCount = 0;

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
        // Other error - fail the import
        console.error('Insert bank transactions error:', insertError);
        await supabase
          .from('bank_statement_import_batches')
          .update({ status: 'failed' })
          .eq('id', batch.id);

        return { success: false, error: `Failed to insert transactions: ${insertError.message}` };
      }
    } else {
      // Bulk insert succeeded - no duplicates
      insertedCount = insertedTxns?.length || 0;
    }

    // Update batch status to completed
    await supabase
      .from('bank_statement_import_batches')
      .update({
        status: 'completed',
        inserted_count: insertedCount,
        metadata: {
          format_type: parsed.format_type,
          column_mapping: parsed.auto_mapping || columnMapping,
          duplicate_count: duplicateCount,
          total_rows: parsed.transactions.length,
        },
      })
      .eq('id', batch.id);

    revalidatePath('/bank');
    revalidatePath('/company-cashflow');
    revalidatePath('/bank-reconciliation');
    revalidatePath('/reconciliation');

    const message =
      duplicateCount > 0
        ? `Imported ${insertedCount} transactions (${duplicateCount} duplicates skipped)`
        : `Imported ${insertedCount} transactions`;

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
