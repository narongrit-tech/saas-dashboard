'use server'

import { createClient } from '@/lib/supabase/server'
import {
  CashInClassificationPayload,
  CashInSelectionSummary,
  GetCashInSelectionSummaryResponse,
  ApplyCashInTypeResponse,
  GetCashInTransactionsResponse,
  BankTransaction,
} from '@/types/bank'

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
