import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'
import { detectHeaderRow, suggestColumnMapping } from '@/lib/parsers/header-detector'

/**
 * POST /api/bank/columns
 * Get available columns from bank statement file (for manual mapping)
 * Now with smart header detection to handle meta rows
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
    const headerRowIndexStr = formData.get('header_row_index') as string | null

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 })
    }

    // Read file buffer
    const buffer = Buffer.from(await file.arrayBuffer())

    // Detect file type
    const isCSV = file.name.toLowerCase().endsWith('.csv')
    const isExcel =
      file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')

    if (!isCSV && !isExcel) {
      return NextResponse.json(
        { success: false, error: 'Unsupported file type. Only .csv and .xlsx files are allowed.' },
        { status: 400 }
      )
    }

    let rows: any[][] = []

    if (isCSV) {
      // Parse CSV
      const text = buffer.toString('utf-8')
      const lines = text.split('\n').filter((line) => line.trim())
      if (lines.length === 0) {
        return NextResponse.json({ success: false, error: 'Empty CSV file' }, { status: 400 })
      }
      rows = lines.map((line) => line.split(',').map((col) => col.trim().replace(/^"|"$/g, '')))
    } else {
      // Parse Excel
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      const firstSheetName = workbook.SheetNames[0]
      if (!firstSheetName) {
        return NextResponse.json({ success: false, error: 'Empty Excel file' }, { status: 400 })
      }

      const worksheet = workbook.Sheets[firstSheetName]
      rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as any[][]

      if (rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Empty worksheet' }, { status: 400 })
      }
    }

    // Detect header row (or use provided index)
    let detectedHeaderRowIndex: number
    let detectedDataStartRowIndex: number
    let columns: string[]
    let confidence: number

    if (headerRowIndexStr !== null) {
      // Manual override
      detectedHeaderRowIndex = parseInt(headerRowIndexStr, 10)
      detectedDataStartRowIndex = detectedHeaderRowIndex + 1
      columns = rows[detectedHeaderRowIndex]
        ?.map((cell) => String(cell || '').trim())
        .filter((col) => col.length > 0) || []
      confidence = 1.0 // User-specified
    } else {
      // Auto-detect
      const detection = detectHeaderRow(rows, 30)
      detectedHeaderRowIndex = detection.headerRowIndex ?? 0
      detectedDataStartRowIndex = detection.dataStartRowIndex ?? 1
      columns = detection.columns
      confidence = detection.confidence
    }

    if (columns.length === 0) {
      return NextResponse.json({ success: false, error: 'No columns found' }, { status: 400 })
    }

    // Generate suggested column mapping
    const suggestedMapping = suggestColumnMapping(columns)

    // Get preview rows (first 10 rows from data start)
    const previewRows = rows
      .slice(detectedDataStartRowIndex, detectedDataStartRowIndex + 10)
      .map((row) => row.map((cell) => String(cell || '')))

    return NextResponse.json({
      success: true,
      columns,
      header_row_index: detectedHeaderRowIndex,
      data_start_row_index: detectedDataStartRowIndex,
      total_rows: rows.length,
      confidence,
      suggested_mapping: suggestedMapping,
      preview_rows: previewRows,
    })
  } catch (error) {
    console.error('[Bank Columns API] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
