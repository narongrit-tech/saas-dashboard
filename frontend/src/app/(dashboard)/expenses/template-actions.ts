'use server'

/**
 * Expense Template Server Actions
 * Phase C: Template Download + Import with Deduplication
 */

import { createClient } from '@/lib/supabase/server'
import { formatBangkok, getBangkokNow } from '@/lib/bangkok-time'
import * as XLSX from 'xlsx'
import crypto from 'crypto'

/**
 * Generate and download expense template (.xlsx)
 */
export async function downloadExpenseTemplate(): Promise<{
  success: boolean
  base64?: string
  filename?: string
  error?: string
}> {
  try {
    // Create workbook
    const wb = XLSX.utils.book_new()

    // Template sheet
    const templateData = [
      // Header row
      ['date', 'category', 'description', 'amount', 'payment_method', 'vendor', 'notes', 'reference_id'],
      // Example row
      ['2026-01-25', 'Advertising', 'Facebook Ads Campaign', '5000.00', 'Credit Card', 'Meta', 'Campaign Jan 2026', 'FB-2026-001'],
    ]

    const ws = XLSX.utils.aoa_to_sheet(templateData)

    // Set column widths
    ws['!cols'] = [
      { wch: 12 },  // date
      { wch: 15 },  // category
      { wch: 30 },  // description
      { wch: 12 },  // amount
      { wch: 18 },  // payment_method
      { wch: 20 },  // vendor
      { wch: 30 },  // notes
      { wch: 15 },  // reference_id
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'expenses_template')

    // Instructions sheet
    const instructionsData = [
      ['Expense Import Template - Instructions'],
      [''],
      ['Required Columns:'],
      ['date', 'วันที่ (YYYY-MM-DD เช่น 2026-01-25)'],
      ['category', 'หมวดหมู่ (Advertising, COGS, Operating เท่านั้น)'],
      ['description', 'รายละเอียด (ข้อความ)'],
      ['amount', 'จำนวนเงิน (ตัวเลข > 0)'],
      [''],
      ['Optional Columns:'],
      ['payment_method', 'วิธีการชำระเงิน (เช่น Credit Card, Bank Transfer)'],
      ['vendor', 'ผู้จำหน่าย/บริษัท'],
      ['notes', 'หมายเหตุเพิ่มเติม'],
      ['reference_id', 'เลขอ้างอิง/เอกสาร'],
      [''],
      ['Category Values (ต้องใช้คำเหล่านี้เท่านั้น):'],
      ['Advertising', 'ค่าโฆษณา (Ads, Marketing)'],
      ['COGS', 'ต้นทุนขาย (Product Cost, Packaging)'],
      ['Operating', 'ค่าดำเนินงาน (Utilities, Salary, Overhead)'],
      [''],
      ['Example (ดูใน expenses_template sheet):'],
      ['Row 2 แสดงตัวอย่างข้อมูลที่กรอกได้'],
      [''],
      ['Notes:'],
      ['- ลบ row 2 (example) ออกก่อนกรอกข้อมูลจริง'],
      ['- Amount ต้องเป็นตัวเลขเท่านั้น (ไม่ต้องใส่ ฿ หรือ ,)'],
      ['- Date ต้องเป็นรูปแบบ YYYY-MM-DD'],
      ['- Category ต้องตรงกับที่กำหนด (case-sensitive)'],
    ]

    const wsInstructions = XLSX.utils.aoa_to_sheet(instructionsData)
    wsInstructions['!cols'] = [{ wch: 20 }, { wch: 60 }]
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions')

    // Generate buffer and convert to base64 (Server Actions cannot return ArrayBuffer)
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const base64 = Buffer.from(buffer).toString('base64')

    // Generate filename
    const timestamp = formatBangkok(getBangkokNow(), 'yyyyMMdd')
    const filename = `expense-template-${timestamp}.xlsx`

    return {
      success: true,
      base64,
      filename,
    }
  } catch (error) {
    console.error('[Template Download] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการสร้าง template',
    }
  }
}

/**
 * Import expenses from template file
 */
export async function importExpensesFromTemplate(
  fileBuffer: ArrayBuffer,
  allowDuplicate: boolean = false
): Promise<{
  success: boolean
  inserted?: number
  errors?: number
  warnings?: string[]
  error?: string
  batchId?: string
}> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'Unauthorized' }
    }

    // Calculate file hash for deduplication
    const hash = crypto.createHash('sha256').update(Buffer.from(fileBuffer)).digest('hex')

    // Check for duplicate import
    if (!allowDuplicate) {
      const { data: existing } = await supabase
        .from('import_batches')
        .select('id, created_at')
        .eq('file_hash', hash)
        .eq('report_type', 'expenses_template')
        .single()

      if (existing) {
        return {
          success: false,
          error: `ไฟล์นี้เคยถูก import แล้ว (${new Date(existing.created_at).toLocaleString('th-TH')})`,
        }
      }
    }

    // Parse Excel file
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null }) as unknown[][]

    if (rawRows.length < 2) {
      return { success: false, error: 'ไฟล์ว่างเปล่าหรือไม่มีข้อมูล' }
    }

    // Get headers
    const headers = rawRows[0] as string[]
    const requiredColumns = ['date', 'category', 'description', 'amount']

    // Validate required columns
    const missingColumns = requiredColumns.filter((col) => !headers.includes(col))
    if (missingColumns.length > 0) {
      return {
        success: false,
        error: `ไฟล์ไม่ตรงกับ template - ขาดคอลัมน์: ${missingColumns.join(', ')}`,
      }
    }

    // Create import batch
    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        report_type: 'expenses_template',
        file_hash: hash,
        created_by: user.id,
        status: 'pending',
      })
      .select()
      .single()

    if (batchError || !batch) {
      return { success: false, error: 'ไม่สามารถสร้าง import batch ได้' }
    }

    // Parse data rows (skip header)
    const dataRows = rawRows.slice(1)
    const parsed: Array<Record<string, unknown>> = []
    const errors: string[] = []

    dataRows.forEach((row, idx) => {
      if (!row || row.every((cell) => !cell)) return // Skip empty rows

      const rowObj: Record<string, unknown> = {}
      headers.forEach((header, colIdx) => {
        rowObj[header] = row[colIdx]
      })

      // Validate required fields
      if (!rowObj.date || !rowObj.category || !rowObj.description || !rowObj.amount) {
        errors.push(`Row ${idx + 2}: ข้อมูลไม่ครบ (ต้องมี date, category, description, amount)`)
        return
      }

      // Validate category
      const category = String(rowObj.category).trim()
      if (!['Advertising', 'COGS', 'Operating'].includes(category)) {
        errors.push(`Row ${idx + 2}: Category ไม่ถูกต้อง (ต้องเป็น Advertising, COGS, หรือ Operating)`)
        return
      }

      // Validate amount
      const amount = parseFloat(String(rowObj.amount))
      if (isNaN(amount) || amount <= 0) {
        errors.push(`Row ${idx + 2}: Amount ต้องเป็นตัวเลข > 0`)
        return
      }

      // Validate date format
      const dateStr = String(rowObj.date).trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        errors.push(`Row ${idx + 2}: Date ต้องเป็นรูปแบบ YYYY-MM-DD`)
        return
      }

      parsed.push({
        ...rowObj,
        category,
        amount,
        expense_date: dateStr,
      })
    })

    // Insert parsed expenses
    let insertedCount = 0
    const insertErrors: string[] = []

    for (const row of parsed) {
      const { error: insertError } = await supabase
        .from('expenses')
        .insert({
          category: row.category as string,
          amount: row.amount as number,
          expense_date: row.expense_date as string,
          description: String(row.description).trim(),
          notes: row.notes ? String(row.notes).trim() : null,
          source: 'imported',
          import_batch_id: batch.id,
          created_by: user.id,
        })

      if (insertError) {
        insertErrors.push(insertError.message)
      } else {
        insertedCount++
      }
    }

    // Update batch status
    await supabase
      .from('import_batches')
      .update({
        status: insertErrors.length > 0 ? 'partial' : 'success',
        row_count: parsed.length,
        inserted_count: insertedCount,
        error_count: insertErrors.length + errors.length,
      })
      .eq('id', batch.id)

    return {
      success: true,
      inserted: insertedCount,
      errors: insertErrors.length + errors.length,
      warnings: [...errors, ...insertErrors],
      batchId: batch.id,
    }
  } catch (error) {
    console.error('[Expense Import] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการ import',
    }
  }
}
