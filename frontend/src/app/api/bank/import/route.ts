import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  parseBankStatementAuto,
  parseWithMapping,
  parseWithMappingDiagnostics,
  parseBangkokDate,
} from '@/lib/parsers/bank-statement-parser'
import crypto from 'crypto'
import { formatBangkok } from '@/lib/bangkok-time'
import * as XLSX from 'xlsx'
import { BankColumnMapping, BankTransactionRow } from '@/types/bank'
import { revalidatePath } from 'next/cache'

/**
 * POST /api/bank/import
 * Import bank statement transactions
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    // Parse multipart form data
    const formData = await request.formData()
    const file = formData.get('file') as File
    const bankAccountId = formData.get('bank_account_id') as string
    const columnMappingStr = formData.get('column_mapping') as string | null
    const headerRowIndexStr = formData.get('header_row_index') as string | null
    const dataStartRowIndexStr = formData.get('data_start_row_index') as string | null
    const importMode = (formData.get('import_mode') as string) || 'replace_range'

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 })
    }

    if (!bankAccountId) {
      return NextResponse.json(
        { success: false, error: 'bank_account_id is required' },
        { status: 400 }
      )
    }

    // Validate file type
    const isCSV = file.name.toLowerCase().endsWith('.csv')
    const isExcel =
      file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')

    if (!isCSV && !isExcel) {
      return NextResponse.json(
        { success: false, error: 'Unsupported file type. Only .csv and .xlsx files are allowed.' },
        { status: 400 }
      )
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Calculate file hash for deduplication
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex')

    // Check for existing batch (for all modes)
    const { data: existingBatch, error: dupCheckError } = await supabase
      .from('bank_statement_import_batches')
      .select('id, imported_at, status, inserted_count, import_mode')
      .eq('bank_account_id', bankAccountId)
      .eq('file_hash', fileHash)
      .maybeSingle()

    if (dupCheckError) {
      console.error('Duplicate check error:', dupCheckError)
    }

    // For append mode: reject if batch exists and completed
    if (importMode === 'append' && existingBatch && existingBatch.status === 'completed') {
      return NextResponse.json(
        {
          success: false,
          error: 'This file has already been imported',
          details: `Previously imported at ${formatBangkok(existingBatch.imported_at, 'yyyy-MM-dd HH:mm:ss')}. Use Import History to rollback if needed.`,
        },
        { status: 409 }
      )
    }

    // Parse transactions
    let transactions: BankTransactionRow[]
    let format = 'unknown'

    if (columnMappingStr) {
      // Manual mapping provided
      const columnMapping: BankColumnMapping = JSON.parse(columnMappingStr)

      // Parse file with manual mapping
      const workbook = isCSV
        ? XLSX.read(buffer, { type: 'buffer', raw: true })
        : XLSX.read(buffer, { type: 'buffer' })

      const firstSheetName = workbook.SheetNames[0]
      if (!firstSheetName) {
        return NextResponse.json({ success: false, error: 'Empty file' }, { status: 400 })
      }

      const worksheet = workbook.Sheets[firstSheetName]
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as any[][]

      // Use provided header row index or default to 0
      const headerRowIndex = headerRowIndexStr !== null ? parseInt(headerRowIndexStr, 10) : 0
      const dataStartRowIndex = dataStartRowIndexStr !== null ? parseInt(dataStartRowIndexStr, 10) : headerRowIndex + 1

      if (rows.length <= headerRowIndex) {
        return NextResponse.json({ success: false, error: 'Header row index out of range' }, { status: 400 })
      }

      if (rows.length <= dataStartRowIndex) {
        return NextResponse.json({ success: false, error: 'No data rows found after header' }, { status: 400 })
      }

      const headerRow = rows[headerRowIndex] as string[]
      const dataRows = rows.slice(dataStartRowIndex)

      // Use diagnostics version for better error reporting
      const parseResult = parseWithMappingDiagnostics(dataRows, columnMapping, headerRow)
      transactions = parseResult.transactions
      format = 'manual'

      // If no transactions found, return diagnostics
      if (transactions.length === 0) {
        let debugInfo = ''
        const diag = parseResult.diagnostics
        const reasons: string[] = []
        if (diag.invalidDateCount > 0) {
          reasons.push(`${diag.invalidDateCount} rows with invalid dates`)
        }
        if (diag.invalidAmountCount > 0) {
          reasons.push(`${diag.invalidAmountCount} rows with zero amounts`)
        }
        debugInfo = reasons.join('; ')

        return NextResponse.json(
          {
            success: false,
            error: `No valid transactions found in file. ${debugInfo || 'Check date and amount columns.'}`,
            diagnostics: {
              totalRows: diag.totalRows,
              parsedRows: diag.parsedRows,
              invalidDateCount: diag.invalidDateCount,
              invalidAmountCount: diag.invalidAmountCount,
              sampleBadRows: diag.sampleBadRows,
            },
          },
          { status: 400 }
        )
      }
    } else {
      // Auto-detect
      const parseResult = parseBankStatementAuto(arrayBuffer, file.name)

      if (parseResult.requires_manual_mapping) {
        return NextResponse.json({
          success: false,
          error: 'Auto-parse failed. Manual mapping required.',
          requires_manual_mapping: true,
          errors: parseResult.errors,
        })
      }

      transactions = parseResult.transactions
      format = parseResult.format_type || 'auto'

      // If no transactions found, return diagnostics
      if (transactions.length === 0 && parseResult.diagnostics) {
        let debugInfo = ''
        const diag = parseResult.diagnostics
        const reasons: string[] = []
        if (diag.invalidDateCount > 0) {
          reasons.push(`${diag.invalidDateCount} rows with invalid dates`)
        }
        if (diag.invalidAmountCount > 0) {
          reasons.push(`${diag.invalidAmountCount} rows with zero amounts`)
        }
        debugInfo = reasons.join('; ')

        return NextResponse.json(
          {
            success: false,
            error: `No valid transactions found in file. ${debugInfo || 'Check date and amount columns.'}`,
            diagnostics: diag,
          },
          { status: 400 }
        )
      }
    }

    // Final safety check (should not reach here if diagnostics worked above)
    if (transactions.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No valid transactions found in file. Check date and amount columns.',
        },
        { status: 400 }
      )
    }

    // Get date range
    const dates = transactions.map((t) => t.txn_date).sort()
    const dateRange = dates.length > 0 ? { start: dates[0], end: dates[dates.length - 1] } : null

    // Delete existing transactions based on import mode
    let deletedCount = 0

    console.log(`[Bank Import API] Import mode: ${importMode}`)

    if (importMode === 'replace_range' && dateRange) {
      console.log(`[Replace Range] Deleting transactions from ${dateRange.start} to ${dateRange.end}`)

      // Delete transactions in the file's date range
      // Include rows with created_by = user.id OR created_by IS NULL (legacy data cleanup)
      const { count, error: deleteError } = await supabase
        .from('bank_transactions')
        .delete({ count: 'exact' })
        .eq('bank_account_id', bankAccountId)
        .or(`created_by.eq.${user.id},created_by.is.null`)
        .gte('txn_date', dateRange.start)
        .lte('txn_date', dateRange.end)

      if (deleteError) {
        console.error('Delete transactions (replace_range) error:', deleteError)
        return NextResponse.json(
          {
            success: false,
            error: `Failed to delete existing transactions: ${deleteError.message}`,
          },
          { status: 500 }
        )
      }

      deletedCount = count || 0
      console.log(`[Replace Range] ✓ Deleted ${deletedCount} transactions from ${dateRange.start} to ${dateRange.end}`)
    } else if (importMode === 'replace_all') {
      console.log(`[Replace All] Deleting ALL transactions for bank account ${bankAccountId}`)

      // Delete all transactions for this bank account
      // Include rows with created_by = user.id OR created_by IS NULL (legacy data cleanup)
      const { count, error: deleteError } = await supabase
        .from('bank_transactions')
        .delete({ count: 'exact' })
        .eq('bank_account_id', bankAccountId)
        .or(`created_by.eq.${user.id},created_by.is.null`)

      if (deleteError) {
        console.error('Delete transactions (replace_all) error:', deleteError)
        return NextResponse.json(
          {
            success: false,
            error: `Failed to delete existing transactions: ${deleteError.message}`,
          },
          { status: 500 }
        )
      }

      deletedCount = count || 0
      console.log(`[Replace All] ✓ Deleted ${deletedCount} transactions for bank account ${bankAccountId}`)
    } else if (importMode === 'append') {
      console.log(`[Append] No deletion required (append mode)`)
    }

    // Create or reuse import batch (idempotent)
    let batch

    if (existingBatch) {
      console.log(`[Batch] Reusing existing batch ${existingBatch.id} (status: ${existingBatch.status})`)

      // Reuse existing batch - reset status to pending and update metadata
      const { data: updatedBatch, error: updateError } = await supabase
        .from('bank_statement_import_batches')
        .update({
          status: 'pending',
          row_count: transactions.length,
          inserted_count: 0,
          import_mode: importMode,
          imported_at: new Date().toISOString(), // Update timestamp for re-import
          metadata: {
            format,
            file_size: file.size,
            date_range: dateRange,
            deleted_before_import: deletedCount,
            previous_status: existingBatch.status, // Track that this was a re-import
          },
        })
        .eq('id', existingBatch.id)
        .select('id')
        .single()

      if (updateError || !updatedBatch) {
        console.error('Update existing batch error:', updateError)
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to reuse existing batch',
            details: updateError?.message,
          },
          { status: 500 }
        )
      }

      batch = updatedBatch
    } else {
      console.log(`[Batch] Creating new batch`)

      // Create new batch
      const { data: newBatch, error: batchError } = await supabase
        .from('bank_statement_import_batches')
        .insert({
          bank_account_id: bankAccountId,
          file_name: file.name,
          file_hash: fileHash,
          imported_by: user.id,
          row_count: transactions.length,
          inserted_count: 0, // Will update after insert
          status: 'pending',
          import_mode: importMode,
          metadata: {
            format,
            file_size: file.size,
            date_range: dateRange,
            deleted_before_import: deletedCount,
          },
        })
        .select('id')
        .single()

      if (batchError || !newBatch) {
        console.error('Batch insert error:', batchError)

        // Check if it's a race condition (another process created the batch)
        const isDuplicate = batchError?.code === '23505' || batchError?.message?.includes('duplicate')

        return NextResponse.json(
          {
            success: false,
            error: isDuplicate
              ? 'This file is currently being imported by another process. Please wait and try again.'
              : 'Failed to create import batch record',
            details: batchError?.message,
          },
          { status: isDuplicate ? 409 : 500 }
        )
      }

      batch = newBatch
    }

    // Insert transactions
    // Wrapped in try-finally to ensure batch status is ALWAYS finalized
    const transactionsToInsert = transactions.map((txn) => ({
      bank_account_id: bankAccountId,
      import_batch_id: batch.id,
      txn_date: txn.txn_date,
      description: txn.description || '',
      withdrawal: txn.withdrawal || 0,
      deposit: txn.deposit || 0,
      balance: txn.balance || null,
      channel: txn.channel || null,
      reference_id: txn.reference_id || null,
      raw: {}, // Store empty object for now (can be enhanced later)
      created_by: user.id,
    }))

    let insertedCount = 0
    let importError: Error | null = null

    try {
      const { data: insertedTxns, error: insertError } = await supabase
        .from('bank_transactions')
        .insert(transactionsToInsert)
        .select('id')

      if (insertError) {
        console.error('Transactions insert error:', insertError)
        importError = insertError
      } else {
        insertedCount = insertedTxns?.length || 0
      }
    } finally {
      // CRITICAL: Always finalize batch status based on actual results
      const finalStatus = importError && insertedCount === 0 ? 'failed' : 'completed'

      await supabase
        .from('bank_statement_import_batches')
        .update({
          inserted_count: insertedCount,
          status: finalStatus,
        })
        .eq('id', batch.id)

      console.log(`[Import Finalized] Batch ${batch.id}: status=${finalStatus}, inserted=${insertedCount}, deleted=${deletedCount}`)
    }

    // If import failed completely, return error
    if (importError && insertedCount === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to insert transactions',
          details: importError.message,
        },
        { status: 500 }
      )
    }

    // Revalidate all related paths (data changed)
    revalidatePath('/bank')
    revalidatePath('/company-cashflow')
    revalidatePath('/bank-reconciliation')
    revalidatePath('/reconciliation')

    // Build message with deleted count
    let message = `Successfully imported ${insertedCount} transactions`
    if (deletedCount > 0) {
      message += ` (deleted ${deletedCount} existing)`
    }

    return NextResponse.json({
      success: true,
      batch_id: batch.id,
      inserted_count: insertedCount,
      message,
    })
  } catch (error) {
    console.error('[Bank Import API] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
