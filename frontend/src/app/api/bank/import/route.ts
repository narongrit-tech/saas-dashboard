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

    // Check for duplicate import
    const { data: existingBatch, error: dupCheckError } = await supabase
      .from('bank_statement_import_batches')
      .select('id, imported_at')
      .eq('bank_account_id', bankAccountId)
      .eq('file_hash', fileHash)
      .maybeSingle()

    if (dupCheckError) {
      console.error('Duplicate check error:', dupCheckError)
    }

    if (existingBatch) {
      return NextResponse.json(
        {
          success: false,
          error: 'This file has already been imported',
          details: `Previously imported at ${formatBangkok(existingBatch.imported_at, 'yyyy-MM-dd HH:mm:ss')}`,
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

    // Create import batch record
    const { data: batch, error: batchError } = await supabase
      .from('bank_statement_import_batches')
      .insert({
        bank_account_id: bankAccountId,
        file_name: file.name,
        file_hash: fileHash,
        imported_by: user.id,
        row_count: transactions.length,
        inserted_count: 0, // Will update after insert
        status: 'pending',
        metadata: {
          format,
          file_size: file.size,
          date_range: dateRange,
        },
      })
      .select('id')
      .single()

    if (batchError || !batch) {
      console.error('Batch insert error:', batchError)
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to create import batch',
          details: batchError?.message,
        },
        { status: 500 }
      )
    }

    // Insert transactions
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

    const { data: insertedTxns, error: insertError } = await supabase
      .from('bank_transactions')
      .insert(transactionsToInsert)
      .select('id')

    if (insertError) {
      console.error('Transactions insert error:', insertError)
      // Update batch status to failed
      await supabase
        .from('bank_statement_import_batches')
        .update({ status: 'failed' })
        .eq('id', batch.id)

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to insert transactions',
          details: insertError.message,
        },
        { status: 500 }
      )
    }

    const insertedCount = insertedTxns?.length || 0

    // Update batch with success
    await supabase
      .from('bank_statement_import_batches')
      .update({
        inserted_count: insertedCount,
        status: 'completed',
      })
      .eq('id', batch.id)

    // Revalidate all related paths (data changed)
    revalidatePath('/bank')
    revalidatePath('/company-cashflow')
    revalidatePath('/bank-reconciliation')
    revalidatePath('/reconciliation')

    return NextResponse.json({
      success: true,
      batch_id: batch.id,
      inserted_count: insertedCount,
      message: `Successfully imported ${insertedCount} transactions`,
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
