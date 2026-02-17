'use server'

import { createClient } from '@/lib/supabase/server'
import {
  CashInClassificationPayload,
  CashInSelectionSummary,
  GetCashInSelectionSummaryResponse,
  ApplyCashInTypeResponse,
  GetCashInTransactionsResponse,
  BankTransaction,
  CASH_IN_TYPES,
  CashInType,
} from '@/types/bank'
import { formatBangkok, getBangkokNow } from '@/lib/bangkok-time'
import * as XLSX from 'xlsx'

interface CashInFilters {
  bankAccountId: string | null;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  search: string | null;
  showClassified: boolean;
}

interface SelectionMode {
  mode: 'ids' | 'filtered';
  ids?: string[];
}

// ============================================================================
// Get Cash In Transactions (for table display)
// ============================================================================

export async function getCashInTransactions(
  filters: CashInFilters,
  page: number = 1,
  pageSize: number = 50
): Promise<GetCashInTransactionsResponse> {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    // Build query
    let query = supabase
      .from('bank_transactions')
      .select('*', { count: 'exact' })
      .eq('created_by', user.id)
      .gt('deposit', 0) // Only inflows (deposit > 0)

    // Apply filters
    if (filters.bankAccountId) {
      query = query.eq('bank_account_id', filters.bankAccountId)
    }

    if (filters.startDate) {
      query = query.gte('txn_date', filters.startDate)
    }

    if (filters.endDate) {
      query = query.lte('txn_date', filters.endDate)
    }

    if (filters.search) {
      query = query.ilike('description', `%${filters.search}%`)
    }

    if (!filters.showClassified) {
      query = query.is('cash_in_type', null)
    }

    // Pagination
    const offset = (page - 1) * pageSize
    query = query.order('txn_date', { ascending: false }).range(offset, offset + pageSize - 1)

    const { data, error, count } = await query

    if (error) {
      console.error('Error fetching cash in transactions:', error)
      return { success: false, error: 'ไม่สามารถโหลดข้อมูลได้' }
    }

    return {
      success: true,
      data: {
        transactions: data as BankTransaction[],
        total: count || 0,
      },
    }
  } catch (error) {
    console.error('Unexpected error in getCashInTransactions:', error)
    return { success: false, error: 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

// ============================================================================
// Get Selection Summary (for confirmation UI)
// ============================================================================

export async function getCashInSelectionSummary(
  filters: CashInFilters,
  selection: SelectionMode
): Promise<GetCashInSelectionSummaryResponse> {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    // Build query
    let query = supabase
      .from('bank_transactions')
      .select('id, deposit')
      .eq('created_by', user.id)
      .gt('deposit', 0)

    // Apply filters
    if (filters.bankAccountId) {
      query = query.eq('bank_account_id', filters.bankAccountId)
    }

    if (filters.startDate) {
      query = query.gte('txn_date', filters.startDate)
    }

    if (filters.endDate) {
      query = query.lte('txn_date', filters.endDate)
    }

    if (filters.search) {
      query = query.ilike('description', `%${filters.search}%`)
    }

    if (!filters.showClassified) {
      query = query.is('cash_in_type', null)
    }

    // Selection mode
    if (selection.mode === 'ids' && selection.ids && selection.ids.length > 0) {
      query = query.in('id', selection.ids)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error getting selection summary:', error)
      return { success: false, error: 'ไม่สามารถโหลดข้อมูลได้' }
    }

    const count = data.length
    const sum_amount = data.reduce((sum, txn) => sum + txn.deposit, 0)

    const summary: CashInSelectionSummary = {
      count,
      sum_amount,
      total_matching: count,
    }

    return { success: true, data: summary }
  } catch (error) {
    console.error('Unexpected error in getCashInSelectionSummary:', error)
    return { success: false, error: 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

// ============================================================================
// Apply Cash In Type (bulk operation)
// ============================================================================

export async function applyCashInType(
  filters: CashInFilters,
  selection: SelectionMode,
  payload: CashInClassificationPayload
): Promise<ApplyCashInTypeResponse> {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    // Validation: note required for OTHER and OTHER_INCOME
    if (
      (payload.cash_in_type === 'OTHER' || payload.cash_in_type === 'OTHER_INCOME') &&
      !payload.note
    ) {
      return {
        success: false,
        error: 'กรุณาระบุหมายเหตุสำหรับประเภท "อื่นๆ" หรือ "รายได้อื่นๆ"',
      }
    }

    // Build base query to get matching IDs
    let baseQuery = supabase
      .from('bank_transactions')
      .select('id')
      .eq('created_by', user.id)
      .gt('deposit', 0)

    // Apply filters
    if (filters.bankAccountId) {
      baseQuery = baseQuery.eq('bank_account_id', filters.bankAccountId)
    }

    if (filters.startDate) {
      baseQuery = baseQuery.gte('txn_date', filters.startDate)
    }

    if (filters.endDate) {
      baseQuery = baseQuery.lte('txn_date', filters.endDate)
    }

    if (filters.search) {
      baseQuery = baseQuery.ilike('description', `%${filters.search}%`)
    }

    if (!filters.showClassified) {
      baseQuery = baseQuery.is('cash_in_type', null)
    }

    // Selection mode
    if (selection.mode === 'ids' && selection.ids && selection.ids.length > 0) {
      baseQuery = baseQuery.in('id', selection.ids)
    }

    const { data: matchingRows, error: selectError } = await baseQuery

    if (selectError) {
      console.error('Error fetching matching rows:', selectError)
      return { success: false, error: 'ไม่สามารถดึงข้อมูลได้' }
    }

    if (!matchingRows || matchingRows.length === 0) {
      return { success: false, error: 'ไม่พบรายการที่ตรงเงื่อนไข' }
    }

    const idsToUpdate = matchingRows.map((row) => row.id)

    // Perform bulk update
    const { data: updateData, error: updateError } = await supabase
      .from('bank_transactions')
      .update({
        cash_in_type: payload.cash_in_type,
        cash_in_ref_type: payload.cash_in_ref_type || null,
        cash_in_ref_id: payload.cash_in_ref_id || null,
        classified_at: new Date().toISOString(),
        classified_by: user.id,
      })
      .in('id', idsToUpdate)
      .eq('created_by', user.id) // RLS safety
      .select('id')

    if (updateError) {
      console.error('Error updating cash in type:', updateError)
      return { success: false, error: 'ไม่สามารถอัปเดตข้อมูลได้' }
    }

    const affected_rows = updateData?.length || 0

    return {
      success: true,
      affected_rows,
      message: `จัดประเภท ${affected_rows} รายการสำเร็จ`,
    }
  } catch (error) {
    console.error('Unexpected error in applyCashInType:', error)
    return { success: false, error: 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

// ============================================================================
// Clear Cash In Type (reset classification)
// ============================================================================

export async function clearCashInType(
  filters: CashInFilters,
  selection: SelectionMode
): Promise<ApplyCashInTypeResponse> {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    // Build base query to get matching IDs
    let baseQuery = supabase
      .from('bank_transactions')
      .select('id')
      .eq('created_by', user.id)
      .gt('deposit', 0)

    // Apply filters
    if (filters.bankAccountId) {
      baseQuery = baseQuery.eq('bank_account_id', filters.bankAccountId)
    }

    if (filters.startDate) {
      baseQuery = baseQuery.gte('txn_date', filters.startDate)
    }

    if (filters.endDate) {
      baseQuery = baseQuery.lte('txn_date', filters.endDate)
    }

    if (filters.search) {
      baseQuery = baseQuery.ilike('description', `%${filters.search}%`)
    }

    // Only clear classified rows
    baseQuery = baseQuery.not('cash_in_type', 'is', null)

    // Selection mode
    if (selection.mode === 'ids' && selection.ids && selection.ids.length > 0) {
      baseQuery = baseQuery.in('id', selection.ids)
    }

    const { data: matchingRows, error: selectError } = await baseQuery

    if (selectError) {
      console.error('Error fetching matching rows:', selectError)
      return { success: false, error: 'ไม่สามารถดึงข้อมูลได้' }
    }

    if (!matchingRows || matchingRows.length === 0) {
      return { success: false, error: 'ไม่พบรายการที่ตรงเงื่อนไข' }
    }

    const idsToUpdate = matchingRows.map((row) => row.id)

    // Perform bulk clear
    const { data: updateData, error: updateError } = await supabase
      .from('bank_transactions')
      .update({
        cash_in_type: null,
        cash_in_ref_type: null,
        cash_in_ref_id: null,
        classified_at: null,
        classified_by: null,
      })
      .in('id', idsToUpdate)
      .eq('created_by', user.id) // RLS safety
      .select('id')

    if (updateError) {
      console.error('Error clearing cash in type:', updateError)
      return { success: false, error: 'ไม่สามารถอัปเดตข้อมูลได้' }
    }

    const affected_rows = updateData?.length || 0

    return {
      success: true,
      affected_rows,
      message: `ล้างการจัดประเภท ${affected_rows} รายการสำเร็จ`,
    }
  } catch (error) {
    console.error('Unexpected error in clearCashInType:', error)
    return { success: false, error: 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

// ============================================================================
// Cash In Import Template Features
// ============================================================================

export interface CashInImportRow {
  bank_account: string
  txn_datetime: string // YYYY-MM-DD HH:mm:ss
  amount: number
  description: string
  cash_in_type: string
  bank_txn_id?: string
  note?: string
}

export interface CashInImportPreviewRow {
  row_index: number
  status: 'MATCHED' | 'UNMATCHED' | 'INVALID' | 'CONFLICT'
  reason?: string
  matched_txn_id?: string
  input_data: CashInImportRow
  current_cash_in_type?: string | null
  conflict_details?: {
    current_type: string
    new_type: string
  }
}

export interface CashInImportPreview {
  total_rows: number
  matched: number
  unmatched: number
  invalid: number
  conflicts: number
  rows: CashInImportPreviewRow[]
}

export interface DownloadCashInTemplateResponse {
  success: boolean
  base64?: string
  filename?: string
  error?: string
}

export interface ParseCashInImportResponse {
  success: boolean
  data?: CashInImportPreview
  error?: string
}

export interface ApplyCashInImportResponse {
  success: boolean
  updated_count?: number
  message?: string
  error?: string
}

/**
 * Download Cash In Classification Template (CSV format)
 */
export async function downloadCashInTemplate(): Promise<DownloadCashInTemplateResponse> {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    // Get user's bank accounts for sample data
    const { data: accounts } = await supabase
      .from('bank_accounts')
      .select('bank_name, account_number')
      .eq('created_by', user.id)
      .limit(1)

    const sampleBankAccount = accounts?.[0]
      ? `${accounts[0].bank_name} - ${accounts[0].account_number}`
      : 'กสิกรไทย - 1234567890'

    // Create workbook
    const wb = XLSX.utils.book_new()

    // Template sheet with sample data
    const templateData = [
      // Header row
      [
        'bank_account',
        'txn_datetime',
        'amount',
        'description',
        'cash_in_type',
        'bank_txn_id',
        'note',
      ],
      // Example row 1
      [
        sampleBankAccount,
        formatBangkok(getBangkokNow(), 'yyyy-MM-dd HH:mm:ss'),
        '50000.00',
        'โอนจาก TikTok Settlement',
        'SALES_SETTLEMENT',
        'TXN-2026-001',
        '',
      ],
      // Example row 2
      [
        sampleBankAccount,
        formatBangkok(getBangkokNow(), 'yyyy-MM-dd HH:mm:ss'),
        '100000.00',
        'เงินกู้จากกรรมการ',
        'DIRECTOR_LOAN',
        'TXN-2026-002',
        'เงินกู้ระยะสั้น',
      ],
      // Example row 3 (OTHER requires note)
      [
        sampleBankAccount,
        formatBangkok(getBangkokNow(), 'yyyy-MM-dd HH:mm:ss'),
        '5000.00',
        'รายได้อื่นๆ',
        'OTHER_INCOME',
        '',
        'รายได้จากดอกเบี้ยเงินฝาก',
      ],
    ]

    const ws = XLSX.utils.aoa_to_sheet(templateData)

    // Set column widths
    ws['!cols'] = [
      { wch: 30 }, // bank_account
      { wch: 20 }, // txn_datetime
      { wch: 15 }, // amount
      { wch: 40 }, // description
      { wch: 25 }, // cash_in_type
      { wch: 20 }, // bank_txn_id
      { wch: 40 }, // note
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'cash_in_classification')

    // Instructions sheet
    const instructionsData = [
      ['Cash In Classification Import Template - คำแนะนำ'],
      [''],
      ['คอลัมน์ที่จำเป็น (REQUIRED):'],
      ['bank_account', 'ชื่อบัญชีธนาคาร (ต้องตรงกับที่มีในระบบ)'],
      ['txn_datetime', 'วันเวลา (รูปแบบ: YYYY-MM-DD HH:mm:ss เช่น 2026-02-17 14:30:00)'],
      ['amount', 'จำนวนเงิน (ต้อง > 0, เงินเข้าเท่านั้น)'],
      ['description', 'รายละเอียดธุรกรรม'],
      ['cash_in_type', 'ประเภทเงินเข้า (ดูรายการด้านล่าง)'],
      [''],
      ['คอลัมน์เสริม (OPTIONAL):'],
      ['bank_txn_id', 'เลขอ้างอิงธุรกรรมจากธนาคาร (แนะนำให้ใส่เพื่อความแม่นยำ)'],
      ['note', 'หมายเหตุ (จำเป็นเมื่อใช้ cash_in_type = OTHER หรือ OTHER_INCOME)'],
      [''],
      ['ประเภทเงินเข้า (cash_in_type) ที่รองรับ:'],
      ['SALES_SETTLEMENT', 'เงินจากการขาย (Settlement)'],
      ['SALES_PAYOUT_ADJUSTMENT', 'ปรับยอด Settlement'],
      ['DIRECTOR_LOAN', 'เงินกู้จากผู้ถือหุ้น/กรรมการ'],
      ['CAPITAL_INJECTION', 'เงินลงทุนเพิ่ม'],
      ['LOAN_PROCEEDS', 'เงินกู้จากสถาบันการเงิน'],
      ['REFUND_IN', 'เงินคืนจากลูกค้า'],
      ['VENDOR_REFUND', 'เงินคืนจากซัพพลายเออร์'],
      ['TAX_REFUND', 'เงินคืนภาษี'],
      ['INTERNAL_TRANSFER_IN', 'โอนเงินภายในบริษัท (เข้า)'],
      ['WALLET_WITHDRAWAL', 'ถอนเงินจาก Wallet'],
      ['REBATE_CASHBACK', 'Rebate/Cashback'],
      ['OTHER_INCOME', 'รายได้อื่นๆ (ต้องระบุ note)'],
      ['REVERSAL_CORRECTION_IN', 'ปรับปรุง/ยกเลิกรายการ (เข้า)'],
      ['OTHER', 'อื่นๆ (ต้องระบุ note)'],
      [''],
      ['กลไกการจับคู่รายการ (Matching Logic):'],
      ['1. ถ้ามี bank_txn_id: จะจับคู่จาก bank_txn_id โดยตรง'],
      [
        '2. ถ้าไม่มี bank_txn_id: จะจับคู่จาก bank_account + txn_datetime (±5 นาที) + amount + description',
      ],
      ['3. ถ้าพบหลายรายการที่ตรงกัน: จะแสดงสถานะ UNMATCHED (ambiguous)'],
      ['4. ถ้ารายการจัดประเภทแล้ว: จะแสดงสถานะ CONFLICT (ถ้าประเภทต่างกัน)'],
      [''],
      ['สถานะในตารางพรีวิว:'],
      ['MATCHED ✅', 'พบรายการตรงกัน พร้อม update'],
      ['UNMATCHED ❌', 'ไม่พบรายการตรงกัน (ไม่มี หรือ มีหลายรายการ)'],
      ['INVALID ⚠️', 'ข้อมูลไม่ถูกต้อง (amount ≤ 0, cash_in_type ผิด, etc.)'],
      ['CONFLICT 🔄', 'มีการจัดประเภทอยู่แล้ว แต่ต่างจากที่ import (skip by default)'],
      [''],
      ['หมายเหตุสำคัญ:'],
      ['- ลบ row 2-4 (ข้อมูลตัวอย่าง) ออกก่อนกรอกข้อมูลจริง'],
      ['- amount ต้องเป็นตัวเลขเท่านั้น (ไม่ต้องใส่ ฿ หรือ ,)'],
      ['- txn_datetime ต้องเป็นรูปแบบ YYYY-MM-DD HH:mm:ss (เวลาแบงค็อก)'],
      ['- cash_in_type ต้องตรงกับรายการด้านบน (case-sensitive)'],
      ['- bank_account ต้องตรงกับชื่อบัญชีที่มีในระบบ (รูปแบบ: ธนาคาร - เลขที่บัญชี)'],
      [
        '- note จำเป็นเมื่อ cash_in_type = OTHER หรือ OTHER_INCOME (ถ้าไม่ใส่จะแสดงสถานะ INVALID)',
      ],
      ['- ระบบจะ skip รายการที่จัดประเภทแล้ว (CONFLICT) โดยอัตโนมัติ'],
    ]

    const wsInstructions = XLSX.utils.aoa_to_sheet(instructionsData)
    wsInstructions['!cols'] = [{ wch: 30 }, { wch: 70 }]
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions')

    // Generate buffer and convert to base64
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const base64 = Buffer.from(buffer).toString('base64')

    // Generate filename
    const timestamp = formatBangkok(getBangkokNow(), 'yyyyMMdd')
    const filename = `cash-in-classification-template-${timestamp}.xlsx`

    return {
      success: true,
      base64,
      filename,
    }
  } catch (error) {
    console.error('[Cash In Template Download] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการสร้าง template',
    }
  }
}

/**
 * Parse and match cash in import file (preview before applying)
 */
export async function parseAndMatchCashInImport(
  fileBuffer: ArrayBuffer
): Promise<ParseCashInImportResponse> {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    // Parse Excel file
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const rawRows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      raw: false,
    }) as unknown[][]

    if (rawRows.length < 2) {
      return { success: false, error: 'ไฟล์ว่างเปล่าหรือไม่มีข้อมูล' }
    }

    // Get headers
    const headers = rawRows[0] as string[]
    const requiredColumns = ['bank_account', 'txn_datetime', 'amount', 'description', 'cash_in_type']

    // Validate required columns
    const missingColumns = requiredColumns.filter((col) => !headers.includes(col))
    if (missingColumns.length > 0) {
      return {
        success: false,
        error: `ไฟล์ไม่ตรงกับ template - ขาดคอลัมน์: ${missingColumns.join(', ')}`,
      }
    }

    // Get user's bank accounts
    const { data: accounts } = await supabase
      .from('bank_accounts')
      .select('id, bank_name, account_number')
      .eq('created_by', user.id)

    if (!accounts || accounts.length === 0) {
      return { success: false, error: 'ไม่พบบัญชีธนาคารในระบบ' }
    }

    // Create bank account lookup map
    const accountMap = new Map<string, string>()
    accounts.forEach((acc) => {
      const key = `${acc.bank_name} - ${acc.account_number}`
      accountMap.set(key.toLowerCase(), acc.id)
    })

    // Parse data rows (skip header)
    const dataRows = rawRows.slice(1)
    const previewRows: CashInImportPreviewRow[] = []

    let matchedCount = 0
    let unmatchedCount = 0
    let invalidCount = 0
    let conflictCount = 0

    for (let idx = 0; idx < dataRows.length; idx++) {
      const row = dataRows[idx]
      if (!row || row.every((cell) => !cell)) continue // Skip empty rows

      const rowObj: Record<string, unknown> = {}
      headers.forEach((header, colIdx) => {
        rowObj[header] = row[colIdx]
      })

      const rowIndex = idx + 2 // Excel row number (1-based + header)

      // Validate required fields
      if (
        !rowObj.bank_account ||
        !rowObj.txn_datetime ||
        !rowObj.amount ||
        !rowObj.description ||
        !rowObj.cash_in_type
      ) {
        previewRows.push({
          row_index: rowIndex,
          status: 'INVALID',
          reason: 'ข้อมูลไม่ครบ (ต้องมี bank_account, txn_datetime, amount, description, cash_in_type)',
          input_data: rowObj as unknown as CashInImportRow,
        })
        invalidCount++
        continue
      }

      // Validate amount
      const amount = parseFloat(String(rowObj.amount))
      if (isNaN(amount) || amount <= 0) {
        previewRows.push({
          row_index: rowIndex,
          status: 'INVALID',
          reason: 'amount ต้องเป็นตัวเลข > 0',
          input_data: rowObj as unknown as CashInImportRow,
        })
        invalidCount++
        continue
      }

      // Validate cash_in_type
      const cashInType = String(rowObj.cash_in_type).trim()
      if (!Object.keys(CASH_IN_TYPES).includes(cashInType)) {
        previewRows.push({
          row_index: rowIndex,
          status: 'INVALID',
          reason: `cash_in_type ไม่ถูกต้อง (ต้องเป็น: ${Object.keys(CASH_IN_TYPES).join(', ')})`,
          input_data: rowObj as unknown as CashInImportRow,
        })
        invalidCount++
        continue
      }

      // Validate note requirement for OTHER and OTHER_INCOME
      if ((cashInType === 'OTHER' || cashInType === 'OTHER_INCOME') && !rowObj.note) {
        previewRows.push({
          row_index: rowIndex,
          status: 'INVALID',
          reason: 'note จำเป็นเมื่อ cash_in_type = OTHER หรือ OTHER_INCOME',
          input_data: rowObj as unknown as CashInImportRow,
        })
        invalidCount++
        continue
      }

      // Validate txn_datetime format
      const txnDatetimeStr = String(rowObj.txn_datetime).trim()
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(txnDatetimeStr)) {
        previewRows.push({
          row_index: rowIndex,
          status: 'INVALID',
          reason: 'txn_datetime ต้องเป็นรูปแบบ YYYY-MM-DD HH:mm:ss',
          input_data: rowObj as unknown as CashInImportRow,
        })
        invalidCount++
        continue
      }

      // Validate bank_account
      const bankAccountStr = String(rowObj.bank_account).trim()
      const bankAccountId = accountMap.get(bankAccountStr.toLowerCase())
      if (!bankAccountId) {
        previewRows.push({
          row_index: rowIndex,
          status: 'INVALID',
          reason: `ไม่พบบัญชีธนาคาร "${bankAccountStr}" ในระบบ`,
          input_data: rowObj as unknown as CashInImportRow,
        })
        invalidCount++
        continue
      }

      // Try to match transaction
      const bankTxnId = rowObj.bank_txn_id ? String(rowObj.bank_txn_id).trim() : null
      let matchedTxn: BankTransaction | null = null

      if (bankTxnId) {
        // Primary match: by bank_txn_id (reference_id)
        const { data: txnByRef } = await supabase
          .from('bank_transactions')
          .select('*')
          .eq('created_by', user.id)
          .eq('reference_id', bankTxnId)
          .gt('deposit', 0)
          .single()

        matchedTxn = txnByRef
      }

      if (!matchedTxn) {
        // Fallback match: by composite key
        const txnDatetime = new Date(txnDatetimeStr)
        const txnDate = formatBangkok(txnDatetime, 'yyyy-MM-dd')

        // Note: We calculate time tolerance but don't use it since bank_transactions
        // only has txn_date (not txn_time). This is kept for future enhancement.
        // const startTime = new Date(txnDatetime.getTime() - 5 * 60 * 1000)
        // const endTime = new Date(txnDatetime.getTime() + 5 * 60 * 1000)

        // Normalize description for matching
        const normalizedDesc = String(rowObj.description)
          .trim()
          .replace(/\s+/g, ' ')
          .toLowerCase()

        const { data: candidates } = await supabase
          .from('bank_transactions')
          .select('*')
          .eq('created_by', user.id)
          .eq('bank_account_id', bankAccountId)
          .eq('txn_date', txnDate)
          .eq('deposit', amount)
          .gt('deposit', 0)

        if (candidates && candidates.length > 0) {
          // Further filter by description and time
          const filtered = candidates.filter((txn) => {
            const txnDesc = (txn.description || '').trim().replace(/\s+/g, ' ').toLowerCase()
            // Check description match
            if (txnDesc !== normalizedDesc) return false

            // Note: We don't have txn_time in bank_transactions, only txn_date
            // So we skip time-based filtering for now
            return true
          })

          if (filtered.length === 1) {
            matchedTxn = filtered[0]
          } else if (filtered.length > 1) {
            // Ambiguous match
            previewRows.push({
              row_index: rowIndex,
              status: 'UNMATCHED',
              reason: `พบหลายรายการที่ตรงกัน (${filtered.length} รายการ) - ไม่สามารถระบุได้แน่ชัด`,
              input_data: rowObj as unknown as CashInImportRow,
            })
            unmatchedCount++
            continue
          }
        }
      }

      if (!matchedTxn) {
        // No match found
        previewRows.push({
          row_index: rowIndex,
          status: 'UNMATCHED',
          reason: 'ไม่พบรายการที่ตรงกัน (ตรวจสอบ bank_account, txn_datetime, amount, description)',
          input_data: rowObj as unknown as CashInImportRow,
        })
        unmatchedCount++
        continue
      }

      // Check for conflicts
      if (matchedTxn.cash_in_type && matchedTxn.cash_in_type !== cashInType) {
        previewRows.push({
          row_index: rowIndex,
          status: 'CONFLICT',
          reason: 'รายการนี้จัดประเภทแล้ว (ประเภทต่างกับที่ import)',
          matched_txn_id: matchedTxn.id,
          current_cash_in_type: matchedTxn.cash_in_type,
          conflict_details: {
            current_type: matchedTxn.cash_in_type,
            new_type: cashInType,
          },
          input_data: rowObj as unknown as CashInImportRow,
        })
        conflictCount++
        continue
      }

      // Matched successfully
      previewRows.push({
        row_index: rowIndex,
        status: 'MATCHED',
        matched_txn_id: matchedTxn.id,
        current_cash_in_type: matchedTxn.cash_in_type,
        input_data: rowObj as unknown as CashInImportRow,
      })
      matchedCount++
    }

    return {
      success: true,
      data: {
        total_rows: previewRows.length,
        matched: matchedCount,
        unmatched: unmatchedCount,
        invalid: invalidCount,
        conflicts: conflictCount,
        rows: previewRows,
      },
    }
  } catch (error) {
    console.error('[Cash In Import Parse] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการอ่านไฟล์',
    }
  }
}

/**
 * Apply cash in import (bulk update matched rows)
 */
export async function applyCashInImport(
  matchedRows: CashInImportPreviewRow[]
): Promise<ApplyCashInImportResponse> {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    // Filter only MATCHED rows
    const rowsToUpdate = matchedRows.filter((row) => row.status === 'MATCHED' && row.matched_txn_id)

    if (rowsToUpdate.length === 0) {
      return { success: false, error: 'ไม่มีรายการที่ตรงเงื่อนไขสำหรับ update' }
    }

    // Prepare bulk update (use individual updates due to different values per row)
    let updatedCount = 0
    const errors: string[] = []

    for (const row of rowsToUpdate) {
      const { error: updateError } = await supabase
        .from('bank_transactions')
        .update({
          cash_in_type: row.input_data.cash_in_type as CashInType,
          // Note: We're not using cash_in_ref_type/cash_in_ref_id for template imports
          // as they're specific to manual classification workflow
          classified_at: new Date().toISOString(),
          classified_by: user.id,
        })
        .eq('id', row.matched_txn_id!)
        .eq('created_by', user.id) // RLS safety

      if (updateError) {
        errors.push(`Row ${row.row_index}: ${updateError.message}`)
      } else {
        updatedCount++
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        error: `อัปเดตสำเร็จ ${updatedCount} รายการ, ล้มเหลว ${errors.length} รายการ: ${errors.join('; ')}`,
      }
    }

    return {
      success: true,
      updated_count: updatedCount,
      message: `จัดประเภท ${updatedCount} รายการสำเร็จ`,
    }
  } catch (error) {
    console.error('[Cash In Import Apply] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล',
    }
  }
}
