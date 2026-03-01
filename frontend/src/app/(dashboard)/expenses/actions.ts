'use server'

import { createClient } from '@/lib/supabase/server'
import { sanitizeCSVField } from '@/lib/csv'
import { CreateExpenseInput, UpdateExpenseInput, ExpenseCategory, ExpenseAttachment } from '@/types/expenses'
import { getBangkokNow, formatBangkok } from '@/lib/bangkok-time'

interface ActionResult {
  success: boolean
  error?: string
  data?: unknown
}

// BUSINESS RULE: Expenses must be categorized into exactly 4 types
// - Advertising: ค่าโฆษณา (ads, marketing spend)
// - COGS: ต้นทุนขาย (cost of goods sold - product cost, packaging)
// - Operating: ค่าดำเนินงาน (overhead, utilities, salaries, etc.)
// - Tax: ภาษี (VAT, withholding, and other taxes)
const VALID_CATEGORIES: ExpenseCategory[] = ['Advertising', 'COGS', 'Operating', 'Tax']

export async function createManualExpense(input: CreateExpenseInput): Promise<ActionResult> {
  try {
    // 1. Create Supabase server client and get user
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // 2. Validate input
    if (!input.expense_date || input.expense_date.trim() === '') {
      return { success: false, error: 'กรุณาระบุวันที่รายจ่าย' }
    }

    if (!VALID_CATEGORIES.includes(input.category)) {
      return { success: false, error: 'หมวดหมู่รายจ่ายไม่ถูกต้อง' }
    }

    if (input.amount <= 0) {
      return { success: false, error: 'จำนวนเงินต้องมากกว่า 0' }
    }

    // FINANCIAL SAFETY: Round amount to 2 decimal places (currency precision)
    const roundedAmount = Math.round(input.amount * 100) / 100

    // 3. Prepare description (use note or default)
    const description = input.note && input.note.trim() !== ''
      ? input.note.trim()
      : 'รายจ่ายทั่วไป'

    // 4. planned_date defaults to expense_date if not provided
    const plannedDate = input.planned_date && input.planned_date.trim() !== ''
      ? input.planned_date.trim()
      : input.expense_date

    // 5. Insert expense into database
    // New expenses start as DRAFT — user must Confirm Paid separately
    const { data: insertedExpense, error: insertError } = await supabase
      .from('expenses')
      .insert({
        category: input.category,
        subcategory: input.subcategory || null,
        amount: roundedAmount,
        expense_date: input.expense_date,
        description: description,
        source: 'manual',
        created_by: user.id,
        expense_status: 'DRAFT',
        planned_date: plannedDate,
        vendor: input.vendor || null,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error inserting expense:', insertError)
      return { success: false, error: `เกิดข้อผิดพลาด: ${insertError.message}` }
    }

    // 6. Create audit log (CREATE action)
    await supabase.rpc('create_expense_audit_log', {
      p_expense_id: insertedExpense.id,
      p_action: 'CREATE',
      p_performed_by: user.id,
      p_changes: {
        created: {
          category: input.category,
          subcategory: input.subcategory || null,
          amount: roundedAmount,
          expense_date: input.expense_date,
          description,
          expense_status: 'DRAFT',
          planned_date: plannedDate,
          vendor: input.vendor || null,
        },
      },
    })

    return { success: true, data: insertedExpense }
  } catch (error) {
    console.error('Unexpected error in createManualExpense:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

export async function updateExpense(
  expenseId: string,
  input: UpdateExpenseInput
): Promise<ActionResult> {
  try {
    // 1. Create Supabase server client and get user
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // 2. Validate input
    if (!input.expense_date || input.expense_date.trim() === '') {
      return { success: false, error: 'กรุณาระบุวันที่รายจ่าย' }
    }

    if (!VALID_CATEGORIES.includes(input.category)) {
      return { success: false, error: 'หมวดหมู่รายจ่ายไม่ถูกต้อง' }
    }

    if (input.amount <= 0) {
      return { success: false, error: 'จำนวนเงินต้องมากกว่า 0' }
    }

    // 3. Check if expense exists and belongs to user (RLS will also enforce this)
    const { data: existingExpense, error: fetchError } = await supabase
      .from('expenses')
      .select('*')
      .eq('id', expenseId)
      .single()

    if (fetchError || !existingExpense) {
      return { success: false, error: 'ไม่พบรายการค่าใช้จ่ายที่ต้องการแก้ไข' }
    }

    // Check ownership (defensive - RLS should also prevent this)
    if (existingExpense.created_by !== user.id) {
      return { success: false, error: 'คุณไม่มีสิทธิ์แก้ไขรายการนี้' }
    }

    // BUSINESS RULE: PAID expenses lock core fields — only notes/vendor are editable
    if (existingExpense.expense_status === 'PAID') {
      if (
        input.amount !== existingExpense.amount ||
        input.category !== existingExpense.category ||
        input.expense_date.split('T')[0] !== existingExpense.expense_date.split('T')[0]
      ) {
        return {
          success: false,
          error: 'รายการที่ยืนยันจ่ายแล้วไม่สามารถแก้ไขจำนวนเงิน ประเภท หรือวันที่ได้',
        }
      }

      // For PAID: only update notes/vendor
      const description = input.note && input.note.trim() !== ''
        ? input.note.trim()
        : existingExpense.description

      const { data: updatedExpense, error: updateError } = await supabase
        .from('expenses')
        .update({
          description: description,
          notes: input.note || null,
          vendor: input.vendor || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', expenseId)
        .select()
        .single()

      if (updateError) {
        return { success: false, error: `เกิดข้อผิดพลาด: ${updateError.message}` }
      }

      await supabase.rpc('create_expense_audit_log', {
        p_expense_id: expenseId,
        p_action: 'UPDATE',
        p_performed_by: user.id,
        p_changes: {
          before: { description: existingExpense.description, vendor: existingExpense.vendor },
          after: { description, vendor: input.vendor || null },
          note: 'PAID expense — only notes/vendor updated',
        },
      })

      return { success: true, data: updatedExpense }
    }

    // 4. DRAFT: full update allowed
    const roundedAmount = Math.round(input.amount * 100) / 100

    const description = input.note && input.note.trim() !== ''
      ? input.note.trim()
      : 'รายจ่ายทั่วไป'

    const { data: updatedExpense, error: updateError } = await supabase
      .from('expenses')
      .update({
        category: input.category,
        subcategory: input.subcategory || null,
        amount: roundedAmount,
        expense_date: input.expense_date,
        description: description,
        vendor: input.vendor || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', expenseId)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating expense:', updateError)
      return { success: false, error: `เกิดข้อผิดพลาด: ${updateError.message}` }
    }

    // 5. Create audit log (UPDATE action)
    await supabase.rpc('create_expense_audit_log', {
      p_expense_id: expenseId,
      p_action: 'UPDATE',
      p_performed_by: user.id,
      p_changes: {
        before: {
          category: existingExpense.category,
          subcategory: existingExpense.subcategory || null,
          amount: existingExpense.amount,
          expense_date: existingExpense.expense_date,
          description: existingExpense.description,
          vendor: existingExpense.vendor || null,
        },
        after: {
          category: input.category,
          subcategory: input.subcategory || null,
          amount: roundedAmount,
          expense_date: input.expense_date,
          description,
          vendor: input.vendor || null,
        },
      },
    })

    return { success: true, data: updatedExpense }
  } catch (error) {
    console.error('Unexpected error in updateExpense:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

export async function deleteExpense(expenseId: string): Promise<ActionResult> {
  try {
    // 1. Create Supabase server client and get user
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // 2. Check if expense exists and belongs to user (RLS will also enforce this)
    const { data: existingExpense, error: fetchError } = await supabase
      .from('expenses')
      .select('*')
      .eq('id', expenseId)
      .single()

    if (fetchError || !existingExpense) {
      return { success: false, error: 'ไม่พบรายการค่าใช้จ่ายที่ต้องการลบ' }
    }

    // Check ownership (defensive - RLS should also prevent this)
    if (existingExpense.created_by !== user.id) {
      return { success: false, error: 'คุณไม่มีสิทธิ์ลบรายการนี้' }
    }

    // 3. Create audit log BEFORE deleting (DELETE action)
    await supabase.rpc('create_expense_audit_log', {
      p_expense_id: expenseId,
      p_action: 'DELETE',
      p_performed_by: user.id,
      p_changes: {
        deleted: {
          category: existingExpense.category,
          subcategory: existingExpense.subcategory || null,
          amount: existingExpense.amount,
          expense_date: existingExpense.expense_date,
          description: existingExpense.description,
          expense_status: existingExpense.expense_status,
        },
      },
    })

    // 4. Hard delete from database (ON DELETE CASCADE removes attachments rows;
    //    Storage objects must be cleaned up separately if needed)
    const { error: deleteError } = await supabase
      .from('expenses')
      .delete()
      .eq('id', expenseId)

    if (deleteError) {
      console.error('Error deleting expense:', deleteError)
      return { success: false, error: `เกิดข้อผิดพลาด: ${deleteError.message}` }
    }

    return { success: true, data: { deletedId: expenseId } }
  } catch (error) {
    console.error('Unexpected error in deleteExpense:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

// ============================================================
// CONFIRM PAID
// ============================================================

export async function confirmExpensePaid(
  expenseId: string,
  paidDate: string
): Promise<ActionResult> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    if (!paidDate || paidDate.trim() === '') {
      return { success: false, error: 'กรุณาระบุวันที่จ่ายเงิน' }
    }

    // 1. Fetch expense and verify ownership + status
    const { data: expense, error: fetchError } = await supabase
      .from('expenses')
      .select('*')
      .eq('id', expenseId)
      .single()

    if (fetchError || !expense) {
      return { success: false, error: 'ไม่พบรายการค่าใช้จ่าย' }
    }

    if (expense.created_by !== user.id) {
      return { success: false, error: 'คุณไม่มีสิทธิ์ยืนยันรายการนี้' }
    }

    if (expense.expense_status === 'PAID') {
      return { success: false, error: 'รายการนี้ยืนยันจ่ายแล้ว' }
    }

    // 2. Require at least 1 attachment (slip)
    const { count: attachmentCount, error: countError } = await supabase
      .from('expense_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('expense_id', expenseId)

    if (countError) {
      return { success: false, error: 'เกิดข้อผิดพลาดในการตรวจสอบสลิป' }
    }

    if (!attachmentCount || attachmentCount === 0) {
      return { success: false, error: 'กรุณาแนบสลิปการจ่ายเงินก่อนยืนยัน' }
    }

    // 3. Update expense to PAID
    const now = new Date().toISOString()
    const { data: updatedExpense, error: updateError } = await supabase
      .from('expenses')
      .update({
        expense_status: 'PAID',
        paid_date: paidDate,
        paid_confirmed_at: now,
        paid_confirmed_by: user.id,
        updated_at: now,
      })
      .eq('id', expenseId)
      .select()
      .single()

    if (updateError) {
      return { success: false, error: `เกิดข้อผิดพลาด: ${updateError.message}` }
    }

    // 4. Audit log
    await supabase.rpc('create_expense_audit_log', {
      p_expense_id: expenseId,
      p_action: 'CONFIRM_PAID',
      p_performed_by: user.id,
      p_changes: {
        before: { expense_status: 'DRAFT' },
        after: { expense_status: 'PAID', paid_date: paidDate, paid_confirmed_at: now },
      },
    })

    return { success: true, data: updatedExpense }
  } catch (error) {
    console.error('Unexpected error in confirmExpensePaid:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

// ============================================================
// ATTACHMENTS
// ============================================================

export async function getExpenseAttachments(
  expenseId: string
): Promise<{ success: boolean; error?: string; data?: ExpenseAttachment[] }> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    const { data: attachments, error: fetchError } = await supabase
      .from('expense_attachments')
      .select('*')
      .eq('expense_id', expenseId)
      .order('uploaded_at', { ascending: true })

    if (fetchError) {
      return { success: false, error: 'เกิดข้อผิดพลาดในการดึงข้อมูลสลิป' }
    }

    // Generate signed URLs (valid for 1 hour)
    const attachmentsWithUrls = await Promise.all(
      (attachments || []).map(async (att) => {
        const { data: urlData } = await supabase.storage
          .from('expense-attachments')
          .createSignedUrl(att.file_path, 3600)

        return {
          ...att,
          signed_url: urlData?.signedUrl || null,
        } as ExpenseAttachment
      })
    )

    return { success: true, data: attachmentsWithUrls }
  } catch (error) {
    console.error('Unexpected error in getExpenseAttachments:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

export async function saveAttachmentMetadata(
  expenseId: string,
  filePath: string,
  fileName: string,
  fileType: string | null,
  fileSize: number | null
): Promise<{ success: boolean; error?: string; data?: ExpenseAttachment }> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    // Verify expense ownership before saving attachment
    const { data: expense, error: expenseError } = await supabase
      .from('expenses')
      .select('id, created_by')
      .eq('id', expenseId)
      .single()

    if (expenseError || !expense) {
      return { success: false, error: 'ไม่พบรายการค่าใช้จ่าย' }
    }

    if (expense.created_by !== user.id) {
      return { success: false, error: 'คุณไม่มีสิทธิ์แนบไฟล์ในรายการนี้' }
    }

    const { data: attachment, error: insertError } = await supabase
      .from('expense_attachments')
      .insert({
        expense_id: expenseId,
        file_path: filePath,
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        uploaded_by: user.id,
        created_by: user.id,
      })
      .select()
      .single()

    if (insertError) {
      return { success: false, error: `เกิดข้อผิดพลาด: ${insertError.message}` }
    }

    return { success: true, data: attachment as ExpenseAttachment }
  } catch (error) {
    console.error('Unexpected error in saveAttachmentMetadata:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

export async function deleteAttachment(attachmentId: string): Promise<ActionResult> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }
    }

    // Fetch attachment to get file_path and verify ownership
    const { data: attachment, error: fetchError } = await supabase
      .from('expense_attachments')
      .select('*')
      .eq('id', attachmentId)
      .single()

    if (fetchError || !attachment) {
      return { success: false, error: 'ไม่พบไฟล์แนบ' }
    }

    if (attachment.created_by !== user.id) {
      return { success: false, error: 'คุณไม่มีสิทธิ์ลบไฟล์นี้' }
    }

    // Delete from Storage first
    const { error: storageError } = await supabase.storage
      .from('expense-attachments')
      .remove([attachment.file_path])

    if (storageError) {
      console.error('Error deleting from storage:', storageError)
      // Continue to delete metadata even if storage delete fails
    }

    // Delete metadata row
    const { error: deleteError } = await supabase
      .from('expense_attachments')
      .delete()
      .eq('id', attachmentId)

    if (deleteError) {
      return { success: false, error: `เกิดข้อผิดพลาด: ${deleteError.message}` }
    }

    return { success: true }
  } catch (error) {
    console.error('Unexpected error in deleteAttachment:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

// ============================================================
// EXPORT & BULK
// ============================================================

interface ExportFilters {
  category?: string
  startDate?: string
  endDate?: string
  search?: string
  statusFilter?: 'All' | 'DRAFT' | 'PAID'
  dateBasis?: 'expense_date' | 'paid_date'
}

interface ExportResult {
  success: boolean
  error?: string
  csv?: string
  filename?: string
}

// Bulk selection types
export type SelectionMode = 'ids' | 'filtered'

export interface BulkSelectionFilters {
  category?: string
  status?: string
  startDate?: string
  endDate?: string
  search?: string
}

export interface SelectionSummary {
  success: boolean
  error?: string
  count?: number
  sumAmount?: number
  deletableCount?: number
  blockedCount?: number
  blockedReason?: string
}

export interface BulkDeleteResult {
  success: boolean
  error?: string
  deletedCount?: number
  blockedCount?: number
}

/**
 * Get summary of selected expenses
 * Mode 'ids': counts specific expense IDs
 * Mode 'filtered': counts all matching filter criteria
 * Returns count, sum, and deletable/blocked counts
 */
export async function getExpensesSelectionSummary(
  mode: SelectionMode,
  filters?: BulkSelectionFilters,
  ids?: string[]
): Promise<SelectionSummary> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    let query = supabase.from('expenses').select('id, amount, source, created_by')

    // Mode: specific IDs
    if (mode === 'ids') {
      if (!ids || ids.length === 0) {
        return {
          success: true,
          count: 0,
          sumAmount: 0,
          deletableCount: 0,
          blockedCount: 0,
        }
      }
      query = query.in('id', ids)
    }

    // Mode: filtered
    if (mode === 'filtered' && filters) {
      if (filters.category && filters.category !== 'All') {
        query = query.eq('category', filters.category)
      }

      if (filters.status && filters.status !== 'All') {
        query = query.eq('expense_status', filters.status)
      }

      if (filters.startDate) {
        query = query.gte('expense_date', filters.startDate)
      }

      if (filters.endDate) {
        const { toZonedTime } = await import('date-fns-tz')
        const { endOfDay } = await import('date-fns')
        const bangkokDate = toZonedTime(new Date(filters.endDate), 'Asia/Bangkok')
        const endOfDayBangkok = endOfDay(bangkokDate)
        query = query.lte('expense_date', endOfDayBangkok.toISOString())
      }

      if (filters.search && filters.search.trim()) {
        query = query.or(
          `description.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`
        )
      }
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching selection summary:', error)
      return { success: false, error: 'เกิดข้อผิดพลาดในการดึงข้อมูล' }
    }

    if (!data || data.length === 0) {
      return {
        success: true,
        count: 0,
        sumAmount: 0,
        deletableCount: 0,
        blockedCount: 0,
      }
    }

    // Filter: user can only delete their own expenses (RLS enforcement)
    const ownExpenses = data.filter((e) => e.created_by === user.id)

    // Calculate summary
    const count = ownExpenses.length
    const sumAmount = ownExpenses.reduce((sum, e) => sum + e.amount, 0)
    const blockedCount = data.length - ownExpenses.length

    return {
      success: true,
      count,
      sumAmount: Math.round(sumAmount * 100) / 100,
      deletableCount: count,
      blockedCount,
      blockedReason: blockedCount > 0
        ? 'บางรายการไม่สามารถลบได้เนื่องจากไม่ใช่รายการของคุณ'
        : undefined,
    }
  } catch (error) {
    console.error('Unexpected error in getExpensesSelectionSummary:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

/**
 * Delete selected expenses in bulk
 * Mode 'ids': deletes specific expense IDs
 * Mode 'filtered': deletes all matching filter criteria
 * Creates audit logs for all deleted expenses
 * Respects RLS: only deletes user's own expenses
 */
export async function deleteExpensesSelected(
  mode: SelectionMode,
  filters?: BulkSelectionFilters,
  ids?: string[]
): Promise<BulkDeleteResult> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // Step 1: Fetch expenses to delete (with full data for audit logs)
    let query = supabase
      .from('expenses')
      .select('*')
      .eq('created_by', user.id) // RLS: Only user's own expenses

    // Mode: specific IDs
    if (mode === 'ids') {
      if (!ids || ids.length === 0) {
        return {
          success: true,
          deletedCount: 0,
          blockedCount: 0,
        }
      }
      query = query.in('id', ids)
    }

    // Mode: filtered
    if (mode === 'filtered' && filters) {
      if (filters.category && filters.category !== 'All') {
        query = query.eq('category', filters.category)
      }

      if (filters.status && filters.status !== 'All') {
        query = query.eq('expense_status', filters.status)
      }

      if (filters.startDate) {
        query = query.gte('expense_date', filters.startDate)
      }

      if (filters.endDate) {
        const { toZonedTime } = await import('date-fns-tz')
        const { endOfDay } = await import('date-fns')
        const bangkokDate = toZonedTime(new Date(filters.endDate), 'Asia/Bangkok')
        const endOfDayBangkok = endOfDay(bangkokDate)
        query = query.lte('expense_date', endOfDayBangkok.toISOString())
      }

      if (filters.search && filters.search.trim()) {
        query = query.or(
          `description.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`
        )
      }
    }

    const { data: expensesToDelete, error: fetchError } = await query

    if (fetchError) {
      console.error('Error fetching expenses to delete:', fetchError)
      return { success: false, error: 'เกิดข้อผิดพลาดในการดึงข้อมูล' }
    }

    if (!expensesToDelete || expensesToDelete.length === 0) {
      return {
        success: true,
        deletedCount: 0,
        blockedCount: 0,
      }
    }

    // Step 2: Create audit logs for all expenses (BEFORE deletion)
    const auditPromises = expensesToDelete.map((expense) =>
      supabase.rpc('create_expense_audit_log', {
        p_expense_id: expense.id,
        p_action: 'DELETE',
        p_performed_by: user.id,
        p_changes: {
          deleted: {
            category: expense.category,
            subcategory: expense.subcategory || null,
            amount: expense.amount,
            expense_date: expense.expense_date,
            description: expense.description,
            expense_status: expense.expense_status,
          },
        },
      })
    )

    await Promise.all(auditPromises)

    // Step 3: Bulk delete expenses (single query)
    const expenseIds = expensesToDelete.map((e) => e.id)
    const { error: deleteError } = await supabase
      .from('expenses')
      .delete()
      .in('id', expenseIds)
      .eq('created_by', user.id) // Double-check RLS

    if (deleteError) {
      console.error('Error deleting expenses:', deleteError)
      return { success: false, error: `เกิดข้อผิดพลาด: ${deleteError.message}` }
    }

    return {
      success: true,
      deletedCount: expensesToDelete.length,
      blockedCount: 0,
    }
  } catch (error) {
    console.error('Unexpected error in deleteExpensesSelected:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

/**
 * Export Expenses to CSV
 * Supports status filter and cash-basis date (paid_date) option
 */
export async function exportExpenses(filters: ExportFilters): Promise<ExportResult> {
  try {
    // 1. Authenticate user
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    const isCashBasis = filters.dateBasis === 'paid_date'
    const dateColumn = isCashBasis ? 'paid_date' : 'expense_date'

    // 2. Build query with filters
    let query = supabase
      .from('expenses')
      .select('*')
      .order(dateColumn, { ascending: false })

    // Apply category filter
    if (filters.category && filters.category !== 'All') {
      query = query.eq('category', filters.category)
    }

    // Apply status filter
    if (filters.statusFilter && filters.statusFilter !== 'All') {
      query = query.eq('expense_status', filters.statusFilter)
    }

    // Cash-basis: only rows that have a paid_date
    if (isCashBasis) {
      query = query.not('paid_date', 'is', null)
    }

    // Apply date filters (against the chosen date column)
    if (filters.startDate) {
      query = query.gte(dateColumn, filters.startDate)
    }

    if (filters.endDate) {
      const { toZonedTime } = await import('date-fns-tz')
      const { endOfDay } = await import('date-fns')
      const bangkokDate = toZonedTime(new Date(filters.endDate), 'Asia/Bangkok')
      const endOfDayBangkok = endOfDay(bangkokDate)
      query = query.lte(dateColumn, endOfDayBangkok.toISOString())
    }

    // Apply search filter
    if (filters.search && filters.search.trim()) {
      query = query.or(
        `description.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`
      )
    }

    // PAGINATION: Handle more than 1000 rows (Supabase limit)
    let allExpenses: any[] = []
    let from = 0
    const pageSize = 1000
    let hasMore = true

    while (hasMore) {
      const { data, error } = await query.range(from, from + pageSize - 1)

      if (error) {
        console.error('Error fetching expenses for export:', error)
        return { success: false, error: 'เกิดข้อผิดพลาดในการดึงข้อมูล' }
      }

      if (data && data.length > 0) {
        allExpenses = allExpenses.concat(data)
        hasMore = data.length === pageSize
        from += pageSize
      } else {
        hasMore = false
      }
    }

    if (allExpenses.length === 0) {
      return { success: false, error: 'ไม่พบข้อมูลที่จะ export' }
    }

    // 3. Generate CSV content
    const headers = [
      'Date',
      'Status',
      'Category',
      'Subcategory',
      'Amount',
      'Vendor',
      'Description',
      'Notes',
      'Paid Date',
      'Created At',
    ]

    const rows = allExpenses.map((expense) => {
      const dateValue = isCashBasis
        ? sanitizeCSVField(expense.paid_date || '')
        : sanitizeCSVField(expense.expense_date)

      return [
        dateValue,
        sanitizeCSVField(expense.expense_status || 'PAID'),
        sanitizeCSVField(expense.category),
        sanitizeCSVField(expense.subcategory || ''),
        sanitizeCSVField(expense.amount),
        sanitizeCSVField(expense.vendor || ''),
        sanitizeCSVField(expense.description),
        sanitizeCSVField(expense.notes || ''),
        sanitizeCSVField(expense.paid_date || ''),
        sanitizeCSVField(expense.created_at),
      ].join(',')
    })

    const csvContent = [headers.join(','), ...rows].join('\n')

    // 4. Generate filename with Bangkok timezone
    const now = getBangkokNow()
    const dateStr = formatBangkok(now, 'yyyyMMdd-HHmmss')
    const basisSuffix = isCashBasis ? '-cash-basis' : ''
    const filename = `expenses${basisSuffix}-${dateStr}.csv`

    return {
      success: true,
      csv: csvContent,
      filename,
    }
  } catch (error) {
    console.error('Unexpected error in exportExpenses:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}
