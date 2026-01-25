import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  parseBankStatementAuto,
  parseWithMappingDiagnostics,
  ParseDiagnostics,
} from '@/lib/parsers/bank-statement-parser'
import { BankColumnMapping, BankTransactionRow } from '@/types/bank'
import * as XLSX from 'xlsx'

/**
 * POST /api/bank/preview
 * Preview bank statement before import
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

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 })
    }

    if (!bankAccountId) {
      return NextResponse.json(
        { success: false, error: 'bank_account_id is required' },
        { status: 400 }
      )
    }

    // Read file buffer (ArrayBuffer)
    const arrayBuffer = await file.arrayBuffer()

    // Parse transactions
    let transactions: BankTransactionRow[]
    let diagnostics: ParseDiagnostics | undefined

    if (columnMappingStr) {
      // Manual mapping provided
      const columnMapping: BankColumnMapping = JSON.parse(columnMappingStr)

      // Parse file with manual mapping
      const buffer = Buffer.from(arrayBuffer)
      const isCSV = file.name.toLowerCase().endsWith('.csv')
      const workbook = isCSV
        ? XLSX.read(buffer, { type: 'buffer', raw: true })
        : XLSX.read(buffer, { type: 'buffer' })

      const firstSheetName = workbook.SheetNames[0]
      if (!firstSheetName) {
        return NextResponse.json({ success: false, error: 'Empty file' }, { status: 400 })
      }

      const worksheet = workbook.Sheets[firstSheetName]
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as any[][]

      if (rows.length < 2) {
        return NextResponse.json({ success: false, error: 'File has no data rows' }, { status: 400 })
      }

      const headerRow = rows[0] as string[]
      const dataRows = rows.slice(1)

      const result = parseWithMappingDiagnostics(dataRows, columnMapping, headerRow)
      transactions = result.transactions
      diagnostics = result.diagnostics
    } else {
      // Auto-detect and parse
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
      diagnostics = parseResult.diagnostics
    }

    if (transactions.length === 0) {
      // Build diagnostic message
      let debugInfo = ''
      if (diagnostics) {
        const reasons: string[] = []
        if (diagnostics.invalidDateCount > 0) {
          reasons.push(`${diagnostics.invalidDateCount} rows with invalid dates`)
        }
        if (diagnostics.invalidAmountCount > 0) {
          reasons.push(`${diagnostics.invalidAmountCount} rows with zero amounts`)
        }
        if (diagnostics.sampleBadRows.length > 0) {
          reasons.push(`Sample issues: ${diagnostics.sampleBadRows.map((r) => r.reason).join(', ')}`)
        }
        debugInfo = reasons.join('; ')
      }

      return NextResponse.json({
        success: false,
        error: `No valid transactions found in file. ${debugInfo || 'Check date and amount columns.'}`,
        diagnostics,
      })
    }

    // Calculate summary
    const totalDeposits = transactions.reduce((sum, t) => sum + t.deposit, 0)
    const totalWithdrawals = transactions.reduce((sum, t) => sum + t.withdrawal, 0)
    const net = totalDeposits - totalWithdrawals

    // Get date range
    const dates = transactions.map((t) => t.txn_date).sort()
    const startDate = dates[0]
    const endDate = dates[dates.length - 1]

    // Return preview data
    return NextResponse.json({
      success: true,
      data: {
        file_name: file.name,
        date_range: {
          start: startDate,
          end: endDate,
        },
        total_deposits: totalDeposits,
        total_withdrawals: totalWithdrawals,
        net,
        row_count: transactions.length,
        sample_rows: transactions.slice(0, 5), // First 5 rows
        errors: [],
        warnings: [],
      },
    })
  } catch (error) {
    console.error('[Bank Preview API] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
